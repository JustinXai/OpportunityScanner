/**
 * OpportunityHunter.ts v3.0
 * 商机扫描器 - 专注 Twitter/ChromeStore/VSCode 僵尸软件
 * DeepSeek 单一模型综合判断 + 自我进化功能
 */

import 'dotenv/config';

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import pLimit from 'p-limit';
import { EmailService } from './EmailService.js';
import type { PainSignal } from './types.js';

// ============================================================
// 调试信息
// ============================================================
console.log('\n========================================');
console.log('🔍 [DEBUG] 运行环境上下文:');
console.log('========================================');
console.log(`   NODE_ENV: ${process.env.NODE_ENV || '(未设置)'}`);
console.log(`   CWD: ${process.cwd()}`);
console.log(`   .env loaded: ${fs.existsSync('.env') ? 'YES' : 'NO'}`);
console.log(`   SERPER_API_KEY: ${process.env.SERPER_API_KEY ? 'SET' : 'NOT SET'}`);
console.log(`   DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? 'SET' : 'NOT SET'}`);
console.log('========================================\n');

// ============================================================
// 系统错误处理
// ============================================================
process.on('uncaughtException', (err) => {
  console.error('FATAL_EXCEPTION:', err.stack || err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('FATAL_REJECTION:', reason);
  process.exit(1);
});

// ============================================================
// 环境变量验证（简化：只需 SERPER + DEEPSEEK）
// ============================================================
interface EnvConfig {
  SERPER_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  GITHUB_TOKEN: string;
  SMTP_CONFIGURED: boolean;
}

function validateEnvironment(): EnvConfig {
  console.log('\n========================================');
  console.log('🔍 环境变量检查...');
  console.log('========================================');

  const serper = process.env.SERPER_API_KEY;
  const deepseek = process.env.DEEPSEEK_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  console.log(`   SERPER_API_KEY: ${serper ? '✅ (' + serper.substring(0, 4) + '...)' : '❌ 未配置'}`);
  console.log(`   DEEPSEEK_API_KEY: ${deepseek ? '✅ (' + deepseek.substring(0, 4) + '...)' : '❌ 未配置'}`);
  console.log(`   GITHUB_TOKEN: ${githubToken ? '✅ (' + githubToken.substring(0, 4) + '...)' : '❌ 未配置'}`);

  const errors: string[] = [];
  if (!serper) errors.push('SERPER_API_KEY 未配置');
  if (!deepseek) errors.push('DEEPSEEK_API_KEY 未配置');
  if (!githubToken) errors.push('GITHUB_TOKEN 未配置 (可选)');

  if (errors.length > 0) {
    process.stderr.write('\n❌ 环境变量检查失败:\n');
    errors.forEach(e => process.stderr.write(`   - ${e}\n`));
    process.exit(1);
  }

  console.log('✅ 环境变量验证通过\n');
  return {
    SERPER_API_KEY: serper!,
    DEEPSEEK_API_KEY: deepseek!,
    GITHUB_TOKEN: githubToken!,
    SMTP_CONFIGURED: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  };
}

const ENV = validateEnvironment();
const GITHUB_REPO = 'JustinXai/OpportunityScanner';

// ============================================================
// 自我进化配置
// ============================================================
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const SCANNED_CACHE_FILE = path.join(LOG_DIR, 'scanned_cache.json');
const LEARNING_FILE = path.join(LOG_DIR, 'learning_data.json');

interface ScannedItem {
  name: string;
  platform: string;
  lastScanned: string;
  result: 'gold' | 'skip' | 'low_quality';
  reason?: string;
}

interface LearningData {
  successfulKeywords: string[];
  failedKeywords: string[];
  ignoredPatterns: string[];
  lastUpdated: string;
}

function loadScannedCache(): ScannedItem[] {
  try {
    if (fs.existsSync(SCANNED_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(SCANNED_CACHE_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveScannedCache(items: ScannedItem[]): void {
  try {
    const dir = path.dirname(SCANNED_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SCANNED_CACHE_FILE, JSON.stringify(items, null, 2));
  } catch (err) {
    console.error('⚠️ 保存扫描缓存失败:', err);
  }
}

function loadLearningData(): LearningData {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      return JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf-8'));
    }
  } catch {}
  return {
    successfulKeywords: [],
    failedKeywords: [],
    ignoredPatterns: [],
    lastUpdated: new Date().toISOString()
  };
}

function saveLearningData(data: LearningData): void {
  try {
    const dir = path.dirname(LEARNING_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('⚠️ 保存学习数据失败:', err);
  }
}

function isRecentlyScanned(name: string): boolean {
  const cache = loadScannedCache();
  const item = cache.find(i => i.name.toLowerCase() === name.toLowerCase());
  if (!item) return false;
  const lastScan = new Date(item.lastScanned).getTime();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return lastScan > thirtyDaysAgo;
}

function markAsScanned(name: string, platform: string, result: 'gold' | 'skip' | 'low_quality', reason?: string): void {
  const cache = loadScannedCache();
  const existingIndex = cache.findIndex(i => i.name.toLowerCase() === name.toLowerCase());
  const item: ScannedItem = { name, platform, lastScanned: new Date().toISOString(), result, reason };
  
  if (existingIndex >= 0) {
    cache[existingIndex] = item;
  } else {
    cache.push(item);
  }
  
  // 保留最近 500 条记录
  if (cache.length > 500) {
    cache.splice(0, cache.length - 500);
  }
  
  saveScannedCache(cache);
}

// ============================================================
// 日志文件
// ============================================================
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

function initFileLogger(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `scan-${timestamp}.log`);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      originalLog.apply(console, args);
      logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
    };
    console.log(`📁 日志文件: ${logFile}`);
  } catch (err) {
    console.error('⚠️ 无法创建日志文件:', err);
  }
}

if (process.env.NODE_ENV === 'production') {
  initFileLogger();
}

// ============================================================
// User-Agent 池
// ============================================================
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile'
];

// ============================================================
// 类型定义
// ============================================================
interface ComprehensiveAnalysis {
  score: number; // 0-100
  verdict: 'GOLD' | 'WORTHY' | 'SKIP' | 'LOW_QUALITY';
  reasons: string[];
  actionPlan: string;
  pricing: string;
  seoKeywords: string[];
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  commentCount: number; // 评论区真实评论数
  signalQuality: 'HIGH' | 'MEDIUM' | 'LOW'; // 信号纯度
}

interface GoldenOpportunity {
  id: string;
  signal: PainSignal;
  analysis: ComprehensiveAnalysis;
  qualified: boolean;
}

interface ScanResult {
  success: boolean;
  signalsCount: number;
  goldensCount: number;
  issuesCreated: number;
  errors: string[];
}

// ============================================================
// HTTP 客户端
// ============================================================
class HttpFactory {
  private uaIndex = 0;

  createClient(extraHeaders: Record<string, string> = {}): AxiosInstance {
    return axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': USER_AGENTS[this.uaIndex++ % USER_AGENTS.length],
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...extraHeaders
      }
    });
  }

  createSerperClient(): AxiosInstance {
    return axios.create({
      baseURL: 'https://google.serper.dev/search',
      headers: {
        'X-API-KEY': ENV.SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });
  }
}

// ============================================================
// 错误处理
// ============================================================
function handleAxiosError(error: unknown, context: string): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    return `${context}: HTTP ${status || 'unknown'} - ${error.message}`;
  }
  if (error instanceof Error) {
    return `${context}: ${error.message}`;
  }
  return `${context}: 未知错误`;
}

// ============================================================
// 低质量内容过滤
// ============================================================
const NOISE_PATTERNS = [
  // 论坛噪音
  /^who (else|elsewhere)/i,
  /^(just|simply) (me|curious)/i,
  /^this (thread|post|comment) (is|seems)/i,
  /^has anyone (tried|found|used)/i,
  /^i don't (know|think|believe)/i,
  /^(lol|lmao|rofl|hilarious)/i,
  /^edit:.*(solved|fixed)/i,
  // 低质量评论
  /^same$/i,
  /^(me too|also this|and this)/i,
  /^(thanks?|thx|ty)/i,
  /^doesn'?t (work|exist|have)/i,
  /^(upvote|downvote|repost)/i,
  // 模糊抱怨
  /^it'?s (okay|fine|ok|not bad)/i,
  /^not sure/i,
  /^maybe (try|look)/i,
];

function isLowQualityContent(text: string): boolean {
  const trimmed = text.trim();
  
  // 太短
  if (trimmed.length < 20) return true;
  
  // 包含噪音模式
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  
  // 太多问号（通常是提问而非抱怨）
  const questionCount = (trimmed.match(/\?/g) || []).length;
  if (questionCount > 2) return true;
  
  // 没有具体产品/工具名
  const hasProductName = /extension|plugin|app|tool|software|service|platform/i.test(trimmed);
  if (!hasProductName) return true;
  
  return false;
}

// ============================================================
// 数据采集器
// ============================================================
class Fetchers {
  private http = new HttpFactory();
  private serperClient = this.http.createSerperClient();

  /**
   * 采集 Twitter 上的抱怨
   */
  async fetchTwitterSignals(): Promise<PainSignal[]> {
    console.log('\n🐦 [Twitter] 采集 Twitter 抱怨信号...');
    const learning = loadLearningData();
    
    const queries = [
      // 未更新僵尸软件
      { q: '"not updated" extension OR plugin OR app 2025 OR 2026', category: '未更新抱怨' },
      { q: '"last updated" chrome extension abandoned OR broken', category: '放弃插件' },
      { q: '"developer abandoned" extension OR plugin broken', category: '开发者放弃' },
      // 特定平台抱怨
      { q: 'site:twitter.com OR site:x.com chrome extension broken OR stopped working', category: '推特抱怨' },
      { q: '"VSCode extension" broken OR "no update" OR abandoned 2026', category: 'VSCode抱怨' },
    ];

    const results: PainSignal[] = [];

    for (const { q, category } of queries) {
      console.log(`   [${category}] ${q.substring(0, 40)}...`);
      try {
        const response = await this.serperClient.post('', { q, num: 10 });
        const items = response.data?.organic || [];
        
        for (const item of items.slice(0, 5)) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          
          // 过滤噪音
          if (isLowQualityContent(snippet)) {
            console.log(`      └─ [过滤] 低质量内容`);
            continue;
          }
          
          // 检查是否已扫描
          const toolName = this.extractToolName(title + ' ' + snippet);
          if (isRecentlyScanned(toolName)) {
            console.log(`      └─ [跳过] 已扫描: ${toolName}`);
            continue;
          }
          
          results.push({
            platform: 'Twitter',
            title: `[TWITTER][${category}] ${title}`,
            description: snippet.substring(0, 400),
            url: item.link || '',
            sentiment: 'negative',
            source: 'twitter-signal',
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error(`      ❌ ${handleAxiosError(error, 'Twitter')}`);
      }
    }

    console.log(`✅ Twitter: 获得 ${results.length} 个信号`);
    return results;
  }

  /**
   * 采集 Chrome Web Store 差评
   */
  async fetchChromeStoreSignals(): Promise<PainSignal[]> {
    console.log('\n🟢 [ChromeStore] 采集 Chrome 商店差评...');
    
    const queries = [
      // 1星差评
      { q: 'site:chromewebstore.google.com "one star" "not working" 2026', category: '1星差评' },
      { q: 'site:chromewebstore.google.com "one star" "broken" "manifest v3"', category: 'MV3崩溃' },
      // 未更新插件
      { q: 'site:chromewebstore.google.com "last updated" "not working" 2025 OR 2026', category: '未更新' },
      { q: '"chrome extension" abandoned OR "no longer supported" 2026', category: '放弃支持' },
      // 替换需求
      { q: '"alternative to" chrome extension "manifest v3" 2026', category: 'MV3替代' },
      { q: '"ModHeader" alternative OR replacement chrome', category: 'ModHeader替代' },
    ];

    const results: PainSignal[] = [];

    for (const { q, category } of queries) {
      console.log(`   [${category}] ${q.substring(0, 40)}...`);
      try {
        const response = await this.serperClient.post('', { q, num: 10 });
        const items = response.data?.organic || [];
        
        for (const item of items.slice(0, 5)) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          
          // 提取评论数（需要至少10条）
          const commentCount = this.extractCommentCount(snippet);
          if (commentCount > 0 && commentCount < 10) {
            console.log(`      └─ [过滤] 评论太少: ${commentCount}条`);
            continue;
          }
          
          // 过滤噪音
          if (isLowQualityContent(snippet)) {
            console.log(`      └─ [过滤] 低质量内容`);
            continue;
          }
          
          const toolName = this.extractToolName(title);
          if (isRecentlyScanned(toolName)) {
            console.log(`      └─ [跳过] 已扫描: ${toolName}`);
            continue;
          }
          
          results.push({
            platform: 'Chrome-Store',
            title: `[CHROME][${category}] ${title}`,
            description: `[评论数: ${commentCount}] ${snippet}`.substring(0, 400),
            url: item.link || '',
            sentiment: 'negative',
            source: 'chrome-store',
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error(`      ❌ ${handleAxiosError(error, 'ChromeStore')}`);
      }
    }

    console.log(`✅ ChromeStore: 获得 ${results.length} 个信号`);
    return results;
  }

  /**
   * 采集 VSCode 僵尸扩展
   */
  async fetchVSCodeSignals(): Promise<PainSignal[]> {
    console.log('\n📦 [VSCode] 采集 VSCode 僵尸扩展...');
    
    const queries = [
      // VSCode 扩展抱怨
      { q: 'site:marketplace.visualstudio.com "last updated" "not working"', category: 'VSCode未更新' },
      { q: '"VSCode extension" broken OR "stopped working" 2025 OR 2026', category: 'VSCode崩溃' },
      { q: '"VSCode" "no updates" OR "abandoned" OR "deprecated" extension', category: 'VSCode放弃' },
      // 具体扩展问题
      { q: 'site:reddit.com "VSCode" extension broken OR slow OR "not compatible"', category: 'VSCode Reddit' },
    ];

    const results: PainSignal[] = [];

    for (const { q, category } of queries) {
      console.log(`   [${category}] ${q.substring(0, 40)}...`);
      try {
        const response = await this.serperClient.post('', { q, num: 10 });
        const items = response.data?.organic || [];
        
        for (const item of items.slice(0, 5)) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          
          // 过滤噪音
          if (isLowQualityContent(snippet)) {
            console.log(`      └─ [过滤] 低质量内容`);
            continue;
          }
          
          const toolName = this.extractToolName(title);
          if (isRecentlyScanned(toolName)) {
            console.log(`      └─ [跳过] 已扫描: ${toolName}`);
            continue;
          }
          
          results.push({
            platform: 'VSCode',
            title: `[VSCODE][${category}] ${title}`,
            description: snippet.substring(0, 400),
            url: item.link || '',
            sentiment: 'negative',
            source: 'vscode-marketplace',
            timestamp: new Date()
          });
        }
      } catch (error) {
        console.error(`      ❌ ${handleAxiosError(error, 'VSCode')}`);
      }
    }

    console.log(`✅ VSCode: 获得 ${results.length} 个信号`);
    return results;
  }

  private extractToolName(text: string): string {
    // 提取插件/扩展名称
    const match = text.match(/(?:extension|plugin|addon|app|tool)[:\s]+["']?([A-Za-z0-9\s\-]+?)["']?(?:\s|$|\.|,)/i)
      || text.match(/"([^"]+)"\s+(?:extension|plugin|addon)/i)
      || text.match(/([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*)\s+(?:extension|plugin)/i);
    return match ? match[1].trim() : text.substring(0, 30).trim();
  }

  private extractCommentCount(snippet: string): number {
    const match = snippet.match(/(\d+)\s*(?:review|comment|rating)/i);
    return match ? parseInt(match[1]) : 0;
  }

  async runAll(): Promise<PainSignal[]> {
    console.log('\n🚀 [Fetcher] 启动三轮专注扫描 (Twitter/Chrome/VSCode)...\n');

    const results = await Promise.allSettled([
      this.fetchTwitterSignals(),
      this.fetchChromeStoreSignals(),
      this.fetchVSCodeSignals()
    ]);

    const signals: PainSignal[] = [];
    let counts = { Twitter: 0, Chrome: 0, VSCode: 0, Other: 0 };

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        signals.push(...results[i].value);
        results[i].value.forEach(s => {
          if (s.platform === 'Twitter') counts.Twitter++;
          else if (s.platform === 'Chrome-Store') counts.Chrome++;
          else if (s.platform === 'VSCode') counts.VSCode++;
          else counts.Other++;
        });
      }
    }

    console.log(`\n📊 采集完成: Twitter=${counts.Twitter} | Chrome=${counts.Chrome} | VSCode=${counts.VSCode} | 总计=${signals.length}\n`);
    return signals;
  }
}

// ============================================================
// DeepSeek 综合分析器（单一模型）
// ============================================================
class DeepSeekAnalyzer {
  async analyze(signal: PainSignal): Promise<ComprehensiveAnalysis> {
    console.log(`   [DeepSeek] 分析: ${signal.title.substring(0, 40)}...`);
    const startTime = Date.now();

    const prompt = `你是一位顶级商业分析师，专注于独立开发者的软件产品机会评估。

【商机信号】
平台: ${signal.platform}
标题: ${signal.title}
描述: ${signal.description}
链接: ${signal.url}

【任务】综合评估以下维度，给出单一判决：

1. **信号纯度评估** (HIGH/MEDIUM/LOW)
   - 评论/抱怨是否具体指出问题？
   - 是否有明确的用户数量（至少10条评论才值得）
   - 还是几句模糊的论坛抱怨？

2. **市场规模** (1-100)
   - 用户搜索意图有多强？
   - 每月搜索量估计？

3. **竞争强度** (1-100)
   - 现有解决方案是否满足需求？
   - 是否有明显的市场空白？

4. **技术可行性** (1-100)
   - MV3 Chrome 扩展可行性？
   - VSCode 扩展可行性？
   - 开发难度估计？

5. **商业潜力** (1-100)
   - 定价空间？
   - 目标用户付费意愿？

6. **行动优先级** (HIGH/MEDIUM/LOW)
   - 综合以上评估

7. **定价建议**
   - 买断制/订阅制/免费增值？

8. **行动方案**
   - 具体要做什么？

【输出格式】(严格JSON)
{
  "score": 0-100,
  "verdict": "GOLD|WORTHY|SKIP|LOW_QUALITY",
  "reasons": ["原因1", "原因2"],
  "actionPlan": "具体行动方案",
  "pricing": "定价建议",
  "seoKeywords": ["关键词1", "关键词2"],
  "priority": "HIGH|MEDIUM|LOW",
  "commentCount": 10,
  "signalQuality": "HIGH|MEDIUM|LOW"
}

判断标准：
- GOLD: 信号纯度高(至少10条具体评论) + 市场大 + 技术可行 + 商业潜力高
- WORTHY: 满足部分条件，值得跟进
- SKIP: 竞争激烈或技术难度高
- LOW_QUALITY: 信号纯度低(模糊抱怨、论坛噪音、评论<10条)`;

    try {
      console.log('   [DeepSeek] 发送请求...');
      const client = axios.create({
        baseURL: 'https://api.deepseek.com/v1',
        timeout: 60000,
        headers: {
          'Authorization': `Bearer ${ENV.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const response = await client.post('/chat/completions', {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 800
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`   [DeepSeek] 完成 (${elapsed}s)`);

      return this.parseResponse(response.data.choices[0].message.content);
    } catch (error) {
      console.error(`   [DeepSeek] ❌ ${handleAxiosError(error, 'DeepSeek API')}`);
      return this.getMock();
    }
  }

  private parseResponse(content: string): ComprehensiveAnalysis {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON');
      const data = JSON.parse(match[0]);
      return {
        score: Number(data.score) || 50,
        verdict: ['GOLD', 'WORTHY', 'SKIP', 'LOW_QUALITY'].includes(data.verdict) ? data.verdict : 'SKIP',
        reasons: Array.isArray(data.reasons) ? data.reasons : [],
        actionPlan: String(data.actionPlan || ''),
        pricing: String(data.pricing || ''),
        seoKeywords: Array.isArray(data.seoKeywords) ? data.seoKeywords : [],
        priority: ['HIGH', 'MEDIUM', 'LOW'].includes(data.priority) ? data.priority : 'LOW',
        commentCount: Number(data.commentCount) || 0,
        signalQuality: ['HIGH', 'MEDIUM', 'LOW'].includes(data.signalQuality) ? data.signalQuality : 'LOW'
      };
    } catch {
      return this.getMock();
    }
  }

  private getMock(): ComprehensiveAnalysis {
    return {
      score: 50,
      verdict: 'SKIP',
      reasons: ['API调用失败，使用默认结果'],
      actionPlan: '重新扫描',
      pricing: '待定',
      seoKeywords: [],
      priority: 'LOW',
      commentCount: 0,
      signalQuality: 'LOW'
    };
  }
}

// ============================================================
// GitHub Issue 创建器
// ============================================================
class GitHubIssueCreator {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        'Authorization': `Bearer ${ENV.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
  }

  async create(opp: GoldenOpportunity): Promise<boolean> {
    const payload = {
      title: `[GOLD] ${opp.signal.platform} - ${opp.signal.title.substring(0, 50)}`,
      body: this.generateBody(opp),
      labels: ['golden-opportunity', `platform:${opp.signal.platform.toLowerCase()}`, 'auto-generated']
    };

    try {
      await this.client.post(`/repos/${GITHUB_REPO}/issues`, payload);
      console.log(`   ✅ GitHub Issue 已创建`);
      return true;
    } catch (error) {
      console.error(`   ⚠️ ${handleAxiosError(error, 'Issue 创建')}`);
      return false;
    }
  }

  private generateBody(opp: GoldenOpportunity): string {
    return `## 🎯 GOLDEN OPPORTUNITY 发现报告

### 📊 基础信息
| 字段 | 值 |
|------|-----|
| 平台 | ${opp.signal.platform} |
| 标题 | ${opp.signal.title} |
| 链接 | ${opp.signal.url} |
| 信号纯度 | ${opp.analysis.signalQuality} |
| 评论数 | ${opp.analysis.commentCount} |

---

### 📈 DeepSeek 综合评分
- **总分**: ${opp.analysis.score}/100
- **判决**: ${opp.analysis.verdict}
- **优先级**: ${opp.analysis.priority}

**评估理由:**
${opp.analysis.reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}

---

### 💰 商业建议
**定价**: ${opp.analysis.pricing}

**行动方案**:
${opp.analysis.actionPlan}

**SEO关键词**:
${opp.analysis.seoKeywords.join(', ') || '（无）'}

---

### 📋 原信号描述
${opp.signal.description}

---
*自动生成于 ${new Date().toISOString()}*`;
  }
}

// ============================================================
// 主程序
// ============================================================
class OpportunityHunter {
  private fetchers = new Fetchers();
  private analyzer = new DeepSeekAnalyzer();
  private issueCreator = new GitHubIssueCreator();

  async run(): Promise<ScanResult> {
    const result: ScanResult = {
      success: true,
      signalsCount: 0,
      goldensCount: 0,
      issuesCreated: 0,
      errors: []
    };

    const totalStartTime = Date.now();

    console.log('='.repeat(60));
    console.log('🎯 OPPORTUNITY HUNTER v3.0');
    console.log('📡 专注: Twitter / Chrome Store / VSCode');
    console.log('🧠 引擎: DeepSeek 单一综合判断');
    console.log('🔄 自我进化: 已启用');
    console.log('='.repeat(60));
    console.log(`📅 ${new Date().toLocaleString('zh-CN')}\n`);

    try {
      // 阶段1: 数据采集
      console.log('\n📡 [STAGE 1] 数据采集...\n');
      const signals = await this.fetchers.runAll();
      result.signalsCount = signals.length;

      if (signals.length === 0) {
        console.log('⚠️ 未发现信号');
        return result;
      }

      // 阶段2: DeepSeek 分析
      console.log('\n🧠 [STAGE 2] DeepSeek 综合分析...\n');
      const opportunities = await this.processSignals(signals);
      result.goldensCount = opportunities.length;

      // 筛选黄金机会
      const goldens = opportunities.filter(o => o.qualified);

      // 阶段3: 创建 Issues
      if (goldens.length > 0) {
        console.log('\n📝 [STAGE 3] 创建 GitHub Issues...\n');
        for (const golden of goldens) {
          const created = await this.issueCreator.create(golden);
          if (created) result.issuesCreated++;
        }
      }

      // 保存报告
      this.saveReport(goldens);

      // 发送邮件
      try {
        const elapsed = ((Date.now() - totalStartTime) / 1000).toFixed(2);
        await EmailService.sendReport(this.formatReport(goldens, elapsed));
      } catch (emailError) {
        console.error(`   ⚠️ 邮件发送失败: ${emailError instanceof Error ? emailError.message : '未知错误'}`);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : '未知错误');
      console.error(`\n❌ 扫描异常: ${error instanceof Error ? error.message : '未知错误'}`);
    }

    const totalElapsed = ((Date.now() - totalStartTime) / 1000).toFixed(2);
    console.log('\n' + '='.repeat(60));
    console.log(`${result.goldensCount > 0 ? '🎉 扫描完成 - 发现金矿!' : '✅ 扫描完成'}`);
    console.log(`📊 总耗时: ${totalElapsed}s | 信号: ${result.signalsCount} | 金矿: ${result.goldensCount}`);
    console.log('='.repeat(60) + '\n');

    return result;
  }

  private async processSignals(signals: PainSignal[]): Promise<GoldenOpportunity[]> {
    const opportunities: GoldenOpportunity[] = [];

    for (const signal of signals) {
      try {
        console.log(`\n📊 分析: ${signal.title.substring(0, 40)}...`);

        const analysis = await this.analyzer.analyze(signal);

        // 判断是否达标
        const qualified = analysis.verdict === 'GOLD' || analysis.verdict === 'WORTHY';

        // 提取工具名
        const toolName = this.extractToolName(signal.title);

        // 标记已扫描
        markAsScanned(
          toolName,
          signal.platform,
          qualified ? 'gold' : (analysis.signalQuality === 'LOW' ? 'low_quality' : 'skip'),
          analysis.reasons[0]
        );

        // 更新学习数据
        this.updateLearningData(analysis, signal);

        opportunities.push({
          id: crypto.randomUUID(),
          signal,
          analysis,
          qualified
        });

        console.log(`   📈 评分: ${analysis.score} | 判决: ${analysis.verdict} | 达标: ${qualified ? '✅' : '❌'}`);

      } catch (error) {
        console.error(`   ⚠️ 分析失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    return opportunities;
  }

  private extractToolName(title: string): string {
    const match = title.match(/\[([^\]]+)\]\s*([^\[\]:]+)/)
      || title.match(/([A-Za-z0-9\s\-]+?)(?:\s+(?:extension|plugin|addon|app|alternative))/i);
    return match ? (match[2] || match[1]).trim() : title.substring(0, 30).trim();
  }

  private updateLearningData(analysis: ComprehensiveAnalysis, signal: PainSignal): void {
    const learning = loadLearningData();

    if (analysis.verdict === 'GOLD') {
      // 提取成功关键词
      const words = signal.title.split(/\s+/).filter(w => w.length > 4);
      learning.successfulKeywords = [...new Set([...learning.successfulKeywords, ...words])].slice(-50);
    } else if (analysis.verdict === 'LOW_QUALITY' || analysis.verdict === 'SKIP') {
      // 记录失败的关键词
      const words = signal.title.split(/\s+/).filter(w => w.length > 4);
      learning.failedKeywords = [...new Set([...learning.failedKeywords, ...words])].slice(-50);
    }

    saveLearningData(learning);
  }

  private saveReport(goldens: GoldenOpportunity[]): void {
    try {
      const outputDir = path.join(process.cwd(), 'reports');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const date = new Date().toISOString().split('T')[0];
      const filepath = path.join(outputDir, `golden-opportunities-${date}.json`);

      fs.writeFileSync(filepath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        summary: {
          totalSignals: goldens.length,
          goldCount: goldens.filter(o => o.analysis.verdict === 'GOLD').length,
          worthyCount: goldens.filter(o => o.analysis.verdict === 'WORTHY').length
        },
        opportunities: goldens
      }, null, 2), 'utf-8');

      console.log(`\n📄 报告已保存: ${filepath}`);
    } catch (error) {
      console.error(`   ⚠️ 报告保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private formatReport(goldens: GoldenOpportunity[], elapsed: string): string {
    if (goldens.length === 0) {
      return '本次扫描未发现金矿机会。';
    }

    const lines = [
      '🚀 商机扫描报告',
      '========================================',
      `扫描时间: ${new Date().toLocaleString('zh-CN')}`,
      `总耗时: ${elapsed}s`,
      `金矿数量: ${goldens.length}`,
      '========================================',
      ''
    ];

    goldens.forEach((opp, i) => {
      lines.push(`【机会 ${i + 1}】`);
      lines.push(`平台: ${opp.signal.platform}`);
      lines.push(`标题: ${opp.signal.title}`);
      lines.push(`评分: ${opp.analysis.score}/100`);
      lines.push(`判决: ${opp.analysis.verdict}`);
      lines.push(`信号纯度: ${opp.analysis.signalQuality}`);
      lines.push(`评论数: ${opp.analysis.commentCount}`);
      lines.push(`定价: ${opp.analysis.pricing}`);
      lines.push(`行动方案: ${opp.analysis.actionPlan}`);
      lines.push('');
    });

    lines.push('========================================');
    lines.push('由 OpportunityScanner v3.0 自动生成');

    return lines.join('\n');
  }
}

// ============================================================
// 入口
// ============================================================
async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('🚀 Opportunity Hunter 启动中...');
  console.log('========================================\n');

  try {
    const hunter = new OpportunityHunter();
    const result = await hunter.run();

    console.log('\n========================================');
    console.log('📋 扫描结果:');
    console.log(`   成功: ${result.success ? '✅' : '❌'}`);
    console.log(`   信号数: ${result.signalsCount}`);
    console.log(`   金矿数: ${result.goldensCount}`);
    console.log(`   Issues: ${result.issuesCreated}`);
    console.log('========================================\n');

    process.exit(result.success ? 0 : 1);

  } catch (error) {
    console.error('\n❌ 未捕获异常:', error instanceof Error ? error.message : '未知错误');
    process.exit(1);
  }
}

main();

export { OpportunityHunter, Fetchers, DeepSeekAnalyzer };
