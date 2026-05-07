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
  successfulKeywords: string[];    // 成功发现金矿的关键词
  failedKeywords: string[];        // 没有发现机会的关键词
  ignoredPatterns: string[];       // 被过滤的噪音模式
  lastUpdated: string;
  // v5.6: 搜索词进化相关
  evolvedSearchQueries: string[];   // AI进化出的新搜索词
  queryPerformance: Record<string, { hits: number; goldFound: number; lastUsed: string }>;
  platformKeywordPool: {
    twitter: string[];
    chromeStore: string[];
    vscode: string[];
  };
  evolutionVersion: number;        // 进化代数
  lastEvolutionDate: string;      // 上次进化时间
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
      const data = JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf-8'));
      // 确保新字段存在（向后兼容）
      return {
        successfulKeywords: data.successfulKeywords || [],
        failedKeywords: data.failedKeywords || [],
        ignoredPatterns: data.ignoredPatterns || [],
        lastUpdated: data.lastUpdated || new Date().toISOString(),
        evolvedSearchQueries: data.evolvedSearchQueries || [],
        queryPerformance: data.queryPerformance || {},
        platformKeywordPool: data.platformKeywordPool || { twitter: [], chromeStore: [], vscode: [] },
        evolutionVersion: data.evolutionVersion || 1,
        lastEvolutionDate: data.lastEvolutionDate || ''
      };
    }
  } catch {}
  return {
    successfulKeywords: [],
    failedKeywords: [],
    ignoredPatterns: [],
    lastUpdated: new Date().toISOString(),
    evolvedSearchQueries: [],
    queryPerformance: {},
    platformKeywordPool: { twitter: [], chromeStore: [], vscode: [] },
    evolutionVersion: 1,
    lastEvolutionDate: ''
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
interface SuperGoldConditions {
  has100kUsers: boolean;
  recentNegativeComments: number;
  isSuperGold: boolean;
  superGoldBonus: number;
}

interface ComprehensiveAnalysis {
  score: number; // 0-150 (含超级金矿+迁移加成)
  verdict: 'GOLD' | 'WORTHY' | 'SKIP' | 'LOW_QUALITY';
  reasons: string[];
  actionPlan: string;
  pricing: string; // 必须具体，如 "$29 买断" 或 "$0.1/100次"
  seoKeywords: string[];
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  commentCount: number; // 评论区真实评论数
  signalQuality: 'HIGH' | 'MEDIUM' | 'LOW'; // 信号纯度
  migrationPotential: boolean; // 自动化用户搬运潜力
  migrationBonus: number; // 加分项 0-20
  superGoldConditions: SuperGoldConditions; // 超级金矿条件
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
// 搜索词进化引擎 v5.6
// ============================================================
class SearchEvolutionEngine {
  private learning: LearningData;

  constructor() {
    this.learning = loadLearningData();
  }

  /**
   * 获取进化后的搜索词（融合默认词 + 历史成功词 + 新探索词）
   */
  getEvolvedQueries(): {
    twitter: Array<{ q: string; category: string }>;
    chromeStore: Array<{ q: string; category: string }>;
    vscode: Array<{ q: string; category: string }>;
  } {
    console.log('\n🧬 [进化引擎] 正在生成进化搜索词...');

    const twitterQueries = this.evolveTwitterQueries();
    const chromeStoreQueries = this.evolveChromeStoreQueries();
    const vscodeQueries = this.evolveVscodeQueries();

    console.log(`   Twitter: ${twitterQueries.length} 个搜索词`);
    console.log(`   ChromeStore: ${chromeStoreQueries.length} 个搜索词`);
    console.log(`   VSCode: ${vscodeQueries.length} 个搜索词`);
    console.log(`   进化代数: v${this.learning.evolutionVersion}`);
    console.log(`   历史成功词: ${this.learning.successfulKeywords.length} 个`);

    return {
      twitter: twitterQueries,
      chromeStore: chromeStoreQueries,
      vscode: vscodeQueries
    };
  }

  /**
   * 进化 Twitter 搜索词
   */
  private evolveTwitterQueries(): Array<{ q: string; category: string }> {
    const queries: Array<{ q: string; category: string }> = [];

    // 基础崩溃抱怨词（高权重）
    queries.push(
      { q: '"broken" OR "stopped working" chrome extension reddit 2026', category: '崩溃抱怨' },
      { q: '"not working since" update chrome extension', category: '更新后崩溃' },
      { q: '"memory leak" OR "slow" chrome extension reddit', category: '性能问题' },
      { q: '"no longer working" chrome OR firefox extension', category: '彻底失效' },
      { q: '"chrome extension" "crash" OR "freeze" 2026', category: '崩溃冻结' },
    );

    // 替代需求词（高商业价值）
    queries.push(
      { q: '"need alternative" chrome extension "doesn\'t work"', category: '主动找替代' },
      { q: '"ModHeader alternative" OR "uBlock replacement" chrome', category: '替代品搜索' },
      { q: '"best" chrome extension "replacement" 2026', category: '最佳替代' },
      { q: '"abandoned" chrome extension "looking for" alternative', category: '放弃插件' },
    );

    // MV3 迁移失败词（2026年重点）
    queries.push(
      { q: '"manifest v3" broken OR not working alternative 2026', category: 'MV3失败' },
      { q: '"mv3" extension "broken" OR "stopped" chrome 2026', category: 'MV3崩溃' },
      { q: '"chrome update" "extension not working" 2026', category: '更新后崩溃' },
    );

    // 从历史成功关键词生成新搜索词
    if (this.learning.successfulKeywords.length > 0) {
      const recentSuccess = this.learning.successfulKeywords.slice(-10);
      for (const keyword of recentSuccess) {
        if (keyword.length > 3 && keyword.length < 30) {
          queries.push({
            q: `"${keyword}" extension "not working" OR "broken"`,
            category: '历史成功词扩展'
          });
        }
      }
    }

    // 从进化词池添加
    const evolvedPool = this.learning.platformKeywordPool.twitter;
    for (const query of evolvedPool.slice(0, 5)) {
      if (!queries.some(q => q.q === query)) {
        queries.push({ q: query, category: '进化词' });
      }
    }

    // 探索性搜索（扩大覆盖）
    queries.push(
      { q: '"extension" "broken" site:reddit.com -"[megathread]"', category: '探索-崩溃' },
      { q: '"addon" "stopped working" firefox OR chrome 2026', category: '探索-Firefox' },
    );

    return this.deduplicateQueries(queries);
  }

  /**
   * 进化 Chrome Store 搜索词
   */
  private evolveChromeStoreQueries(): Array<{ q: string; category: string }> {
    const queries: Array<{ q: string; category: string }> = [];

    // 基础差评词
    queries.push(
      { q: 'site:chromewebstore.google.com "broken since update" OR "stopped working" 2026', category: '更新崩溃' },
      { q: 'site:chromewebstore.google.com "one star" "useless" OR "waste"', category: '1星差评' },
      { q: '"chrome extension" "memory leak" OR "cpu high" reddit', category: '性能崩溃' },
      { q: 'site:chromewebstore.google.com "not working" "broken" reviews', category: '商店差评' },
    );

    // MV3 相关（2026年热点）
    queries.push(
      { q: '"chrome extension" "manifest v3" broken OR not working alternative', category: 'MV3失败' },
      { q: '"mv3" "broken" OR "doesn\'t work" chrome web store', category: 'MV3崩溃' },
    );

    // 替代需求
    queries.push(
      { q: '"ModHeader alternative" OR "uBlock replacement" chrome 2026', category: '替代需求' },
      { q: '"[插件名] alternative" chrome extension 2026', category: '通用替代' },
    );

    // Bug抱怨
    queries.push(
      { q: '"chrome extension" "buggy" OR "glitch" OR "error" 2026', category: 'Bug抱怨' },
      { q: '"chrome" "extension" "doesn\'t work anymore" 2026', category: '彻底失效' },
    );

    // 从历史成功关键词生成
    if (this.learning.successfulKeywords.length > 0) {
      const recentSuccess = this.learning.successfulKeywords.slice(-10);
      for (const keyword of recentSuccess) {
        if (keyword.length > 3 && keyword.length < 30) {
          queries.push({
            q: `site:chromewebstore.google.com "${keyword}" OR "${keyword} extension" reviews`,
            category: '历史成功词扩展'
          });
        }
      }
    }

    // 从进化词池添加
    const evolvedPool = this.learning.platformKeywordPool.chromeStore;
    for (const query of evolvedPool.slice(0, 5)) {
      if (!queries.some(q => q.q === query)) {
        queries.push({ q: query, category: '进化词' });
      }
    }

    // 探索性搜索
    queries.push(
      { q: 'site:reddit.com "chrome extension" "recommend" "broken" 2026', category: '探索-Reddit' },
    );

    return this.deduplicateQueries(queries);
  }

  /**
   * 进化 VSCode 搜索词
   */
  private evolveVscodeQueries(): Array<{ q: string; category: string }> {
    const queries: Array<{ q: string; category: string }> = [];

    // 崩溃抱怨
    queries.push(
      { q: '"VSCode" extension "broken" OR "crash" OR "freeze" 2026', category: 'VSCode崩溃' },
      { q: '"VSCode" "slow" OR "memory leak" extension reddit', category: 'VSCode性能' },
      { q: '"VSCode extension" "deprecated" OR "no longer supported"', category: 'VSCode放弃' },
      { q: '"VSCode" extension "incompatible" OR "error" after update', category: 'VSCode不兼容' },
    );

    // 替代需求
    queries.push(
      { q: '"VSCode" extension "alternative" OR "replacement" 2026', category: 'VSCode替代' },
      { q: '"VSCode" "best" extension "broken" OR "not working"', category: 'VSCode最佳替代' },
    );

    // 从进化词池添加
    const evolvedPool = this.learning.platformKeywordPool.vscode;
    for (const query of evolvedPool.slice(0, 3)) {
      if (!queries.some(q => q.q === query)) {
        queries.push({ q: query, category: '进化词' });
      }
    }

    return this.deduplicateQueries(queries);
  }

  /**
   * 去重搜索词
   */
  private deduplicateQueries(queries: Array<{ q: string; category: string }>): Array<{ q: string; category: string }> {
    const seen = new Set<string>();
    return queries.filter(q => {
      if (seen.has(q.q)) return false;
      seen.add(q.q);
      return true;
    });
  }

  /**
   * 记录搜索结果（用于学习）
   */
  recordSearchResult(query: string, category: string, signalsFound: number, goldFound: number): void {
    const learning = loadLearningData();

    // 更新查询性能
    if (!learning.queryPerformance[query]) {
      learning.queryPerformance[query] = { hits: 0, goldFound: 0, lastUsed: '' };
    }
    learning.queryPerformance[query].hits += signalsFound;
    learning.queryPerformance[query].goldFound += goldFound;
    learning.queryPerformance[query].lastUsed = new Date().toISOString();

    // 如果发现金矿，记录关键词
    if (goldFound > 0) {
      const keywords = this.extractKeywords(query);
      for (const keyword of keywords) {
        if (!learning.successfulKeywords.includes(keyword)) {
          learning.successfulKeywords.push(keyword);
        }
      }
    }

    // 如果没有找到任何信号，标记为失败词
    if (signalsFound === 0) {
      const keywords = this.extractKeywords(query);
      for (const keyword of keywords) {
        if (!learning.failedKeywords.includes(keyword)) {
          learning.failedKeywords.push(keyword);
        }
      }
    }

    saveLearningData(learning);
    this.learning = learning;
  }

  /**
   * 从搜索词提取关键词
   */
  private extractKeywords(query: string): string[] {
    // 移除搜索操作符和引号
    const cleaned = query
      .replace(/site:|OR|AND/gi, ' ')
      .replace(/["']/g, '')
      .trim();

    // 提取有意义的词
    const words = cleaned.split(/\s+/)
      .filter(w => w.length > 3 && w.length < 30)
      .filter(w => !['chrome', 'extension', 'plugin', 'reddit', '2026', 'not', 'working', 'broken'].includes(w.toLowerCase()));

    return [...new Set(words)];
  }

  /**
   * 触发 AI 进化（调用 DeepSeek 生成新搜索词）
   */
  async triggerEvolution(scanResults: { signalsFound: number; goldFound: number; topTools: string[] }): Promise<void> {
    console.log('\n🧬 [进化引擎] 触发 AI 搜索词进化...');

    if (scanResults.signalsFound < 20) {
      console.log('   信号太少，跳过进化（需要至少20个信号才能有效学习）');
      return;
    }

    const prompt = `你是一个 Chrome 扩展市场分析师，正在帮助优化商机扫描的搜索词。

当前扫描结果：
- 发现信号数: ${scanResults.signalsFound}
- 发现金矿数: ${scanResults.goldFound}
- 发现的热门工具: ${scanResults.topTools.slice(0, 5).join(', ') || '无'}

历史成功关键词: ${this.learning.successfulKeywords.slice(-20).join(', ') || '无'}
历史失败关键词: ${this.learning.failedKeywords.slice(-10).join(', ') || '无'}

请生成 10-15 个新的搜索词，用于发现更多僵尸 Chrome 扩展/VSCode 插件商机。

要求：
1. 包含抱怨类搜索词（如 "broken", "not working", "stopped"）
2. 包含替代需求类搜索词（如 "alternative", "replacement"）
3. 包含 MV3 相关搜索词
4. 基于历史成功词扩展新的变体
5. 避免历史失败词中出现的模式

输出格式（严格 JSON）：
{
  "twitterQueries": ["搜索词1", "搜索词2", ...],
  "chromeStoreQueries": ["搜索词1", "搜索词2", ...],
  "vscodeQueries": ["搜索词1", "搜索词2", ...]
}`;

    try {
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
        temperature: 0.7,
        max_tokens: 1000
      });

      const content = response.data.choices[0].message.content;
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        const data = JSON.parse(match[0]);

        const learning = loadLearningData();
        learning.evolutionVersion = (learning.evolutionVersion || 1) + 1;
        learning.lastEvolutionDate = new Date().toISOString();

        // 合并新搜索词
        if (data.twitterQueries) {
          learning.platformKeywordPool.twitter = [
            ...new Set([...(learning.platformKeywordPool.twitter || []), ...data.twitterQueries])
          ].slice(-50);
        }
        if (data.chromeStoreQueries) {
          learning.platformKeywordPool.chromeStore = [
            ...new Set([...(learning.platformKeywordPool.chromeStore || []), ...data.chromeStoreQueries])
          ].slice(-50);
        }
        if (data.vscodeQueries) {
          learning.platformKeywordPool.vscode = [
            ...new Set([...(learning.platformKeywordPool.vscode || []), ...data.vscodeQueries])
          ].slice(-50);
        }

        saveLearningData(learning);
        console.log(`   ✅ AI 进化完成！新进化代数: v${learning.evolutionVersion}`);
        console.log(`   新增 Twitter 词: ${data.twitterQueries?.length || 0} 个`);
        console.log(`   新增 ChromeStore 词: ${data.chromeStoreQueries?.length || 0} 个`);
        console.log(`   新增 VSCode 词: ${data.vscodeQueries?.length || 0} 个`);
      }
    } catch (error) {
      console.error(`   ❌ AI 进化失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
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

// 文章/数据报告过滤模式
const ARTICLE_PATTERNS = [
  /I Analyzed \d+/i,
  /data report/i,
  /list of \d+/i,
  /best of \d{4}/i,
  /statistic/i,
  /research study/i,
  /survey result/i,
  /case study/i,
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

function isArticleContent(title: string, snippet: string): boolean {
  const text = title + ' ' + snippet;
  for (const pattern of ARTICLE_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

// ============================================================
// 数据采集器
// ============================================================
class Fetchers {
  private http = new HttpFactory();
  private serperClient = this.http.createSerperClient();
  private evolutionEngine = new SearchEvolutionEngine();
  private queryStats: Map<string, { signals: number; gold: number }> = new Map();

  constructor() {
    console.log('[Fetchers] 搜索词进化引擎已初始化');
    console.log(`   当前进化代数: v${this.evolutionEngine.getEvolvedQueries().twitter.length}`);
  }

  /**
   * 采集 Twitter 上的抱怨
   */
  async fetchTwitterSignals(): Promise<PainSignal[]> {
    console.log('\n🐦 [Twitter] 采集 Twitter 抱怨信号...');

    // 使用进化搜索词
    const evolved = this.evolutionEngine.getEvolvedQueries();
    const queries = evolved.twitter;

    const results: PainSignal[] = [];

    for (const { q, category } of queries) {
      console.log(`   [${category}] ${q.substring(0, 40)}...`);
      try {
        const response = await this.serperClient.post('', { q, num: 10 });
        const items = response.data?.organic || [];

        let signalsFound = 0;
        
        for (const item of items.slice(0, 5)) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          
          // 过滤文章/数据报告（不浪费钱）
          if (isArticleContent(title, snippet)) {
            console.log(`      └─ [过滤] 文章/报告: ${title.substring(0, 30)}...`);
            continue;
          }
          
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

    // 记录查询统计用于学习
    this.queryStats.set('twitter', { signals: results.length, gold: 0 });

    console.log(`✅ Twitter: 获得 ${results.length} 个信号`);
    return results;
  }

  /**
   * 采集 Chrome Web Store 差评
   */
  async fetchChromeStoreSignals(): Promise<PainSignal[]> {
    console.log('\n🟢 [ChromeStore] 采集 Chrome 商店差评...');

    // 使用进化搜索词
    const evolved = this.evolutionEngine.getEvolvedQueries();
    const queries = evolved.chromeStore;

    const results: PainSignal[] = [];

    for (const { q, category } of queries) {
      console.log(`   [${category}] ${q.substring(0, 40)}...`);
      try {
        const response = await this.serperClient.post('', { q, num: 10 });
        const items = response.data?.organic || [];
        
        for (const item of items.slice(0, 5)) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          
          // 过滤文章/数据报告（不浪费钱）
          if (isArticleContent(title, snippet)) {
            console.log(`      └─ [过滤] 文章/报告: ${title.substring(0, 30)}...`);
            continue;
          }
          
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

    // 记录查询统计
    this.queryStats.set('chromeStore', { signals: results.length, gold: 0 });

    console.log(`✅ ChromeStore: 获得 ${results.length} 个信号`);
    return results;
  }

  /**
   * 采集 VSCode 僵尸扩展
   */
  async fetchVSCodeSignals(): Promise<PainSignal[]> {
    console.log('\n📦 [VSCode] 采集 VSCode 僵尸扩展...');

    // 使用进化搜索词
    const evolved = this.evolutionEngine.getEvolvedQueries();
    const queries = evolved.vscode;

    const results: PainSignal[] = [];

    for (const { q, category } of queries) {
      console.log(`   [${category}] ${q.substring(0, 40)}...`);
      try {
        const response = await this.serperClient.post('', { q, num: 10 });
        const items = response.data?.organic || [];
        
        for (const item of items.slice(0, 5)) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          
          // 过滤文章/数据报告（不浪费钱）
          if (isArticleContent(title, snippet)) {
            console.log(`      └─ [过滤] 文章/报告: ${title.substring(0, 30)}...`);
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

    // 记录查询统计
    this.queryStats.set('vscode', { signals: results.length, gold: 0 });

    console.log(`✅ VSCode: 获得 ${results.length} 个信号`);
    return results;
  }

  /**
   * 获取查询统计并触发进化学习
   */
  async triggerLearning(scanResults: { goldFound: number; topTools: string[] }): Promise<void> {
    const totalSignals = Array.from(this.queryStats.values()).reduce((sum, v) => sum + v.signals, 0);

    // 更新查询性能
    for (const [query, stats] of this.queryStats.entries()) {
      // 注意：这里只记录总数，详细查询性能由进化引擎处理
    }

    // 触发 AI 进化
    if (totalSignals >= 20) {
      await this.evolutionEngine.triggerEvolution({
        signalsFound: totalSignals,
        goldFound: scanResults.goldFound,
        topTools: scanResults.topTools
      });
    }
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
        const values = (results[i] as PromiseFulfilledResult<PainSignal[]>).value;
        signals.push(...values);
        values.forEach((s: PainSignal) => {
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
// DeepSeek 综合分析器（单一模型 - V5.0 进攻版）
// ============================================================
class DeepSeekAnalyzer {
  // 用于检测重复内容
  private lastTopics: string[] = [];
  private lastTopicCount = 0;

  async analyze(signal: PainSignal): Promise<ComprehensiveAnalysis> {
    console.log(`   [DeepSeek] 分析: ${signal.title.substring(0, 40)}...`);
    const startTime = Date.now();

    // 检测是否是重复话题
    const currentTopic = signal.title.toLowerCase().substring(0, 50);
    const isRepetitive = this.lastTopics.slice(-3).some(t => 
      this.calculateSimilarity(t, currentTopic) > 0.7
    );
    
    if (isRepetitive && this.lastTopicCount >= 2) {
      console.log(`   [DeepSeek] 检测到重复话题，强制维度跨越...`);
    }
    
    this.lastTopics.push(currentTopic);
    if (this.lastTopics.length > 10) this.lastTopics.shift();
    if (isRepetitive) this.lastTopicCount++;
    else this.lastTopicCount = 0;

    const dimensionHint = isRepetitive && this.lastTopicCount >= 2 
      ? '\n【维度跨越指令】前3个信号都是同一话题，请强制分析不同的具体工具/插件，不要复读同一篇文章。'
      : '';

    const prompt = `你同时兼任 CTO（首席技术官）和 CGO（首席增长官），必须同时考虑技术可行性和商业暴利潜力。${dimensionHint}

【商机信号】
平台: ${signal.platform}
标题: ${signal.title}
描述: ${signal.description}
链接: ${signal.url}

【任务】激进评估，挖掘暴利机会：

1. **信号纯度** (HIGH/MEDIUM/LOW)
   - 具体抱怨 vs 模糊抱怨？
   - 至少10条真实评论才值得

2. **市场规模** (1-100)
   - 月搜索量？
   - 用户痛点强度？

3. **竞争强度** (1-100)
   - 现有方案是否满足？
   - 空白市场？

4. **技术可行性** (1-100)
   - Chrome MV3 / VSCode 扩展
   - 开发周期？

5. **【超级金矿判定】+30分起跳!**
   如果同时满足以下条件，起跳分数 80 分：
   - 插件有 10万+ 用户
   - 48小时内出现 5条以上 "Broken"/"Useless"/"Waste" 评论
   - 这是用户的主动抱怨，不是数据报告
   
   满足 → 直接输出 score 80-120

6. **自动化用户搬运潜力** (额外+20分!)
   - 这个产品能否实现：自动检测用户电脑上已死的插件，一键迁移到更安全的替代品？
   - 能否成为插件分发入口？
   - 如果能实现自动化 → 直接 +20 分！

7. **【关键】定价必须具体**
   - 禁止说"免费增值"这种虚词！
   - 必须给出：买断 $X 或 按量 $Y/100次
   - 示例："$29 买断" 或 "$0.1/100次 API调用"

【输出格式】(严格JSON)
{
  "score": 0-150,
  "verdict": "GOLD|WORTHY|SKIP|LOW_QUALITY",
  "reasons": ["原因1", "原因2"],
  "actionPlan": "具体行动方案（包含MVP步骤）",
  "pricing": "具体价格，如 '$29 买断制' 或 '$0.1/100次API'",
  "seoKeywords": ["关键词1", "关键词2"],
  "priority": "HIGH|MEDIUM|LOW",
  "commentCount": 10,
  "signalQuality": "HIGH|MEDIUM|LOW",
  "migrationPotential": true或false,
  "migrationBonus": 0-20,
  "superGoldConditions": {
    "has100kUsers": true或false,
    "recentNegativeComments": 数量,
    "isSuperGold": true或false,
    "superGoldBonus": 0-30
  }
}

【判断标准】
- GOLD (100-150分): 超级金矿 + 自动化用户搬运 + 信号纯度高 + 具体定价
- WORTHY (60-99分): 满足部分条件
- SKIP (30-59分): 竞争激烈或技术难度高
- LOW_QUALITY (0-29分): 信号纯度低、论坛噪音、文章报道`;

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
        signalQuality: ['HIGH', 'MEDIUM', 'LOW'].includes(data.signalQuality) ? data.signalQuality : 'LOW',
        migrationPotential: Boolean(data.migrationPotential),
        migrationBonus: Number(data.migrationBonus) || 0,
        superGoldConditions: {
          has100kUsers: Boolean(data.superGoldConditions?.has100kUsers),
          recentNegativeComments: Number(data.superGoldConditions?.recentNegativeComments) || 0,
          isSuperGold: Boolean(data.superGoldConditions?.isSuperGold),
          superGoldBonus: Number(data.superGoldConditions?.superGoldBonus) || 0
        }
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
      signalQuality: 'LOW',
      migrationPotential: false,
      migrationBonus: 0,
      superGoldConditions: {
        has100kUsers: false,
        recentNegativeComments: 0,
        isSuperGold: false,
        superGoldBonus: 0
      }
    };
  }

  // 简单相似度计算
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union === 0 ? 0 : intersection / union;
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

### 📈 DeepSeek V5.2 综合评分
- **总分**: ${opp.analysis.score}/150
- **判决**: ${opp.analysis.verdict}
- **优先级**: ${opp.analysis.priority}
- **迁移潜力**: ${opp.analysis.migrationPotential ? '✅ 有' : '❌ 无'}
- **超级金矿**: ${opp.analysis.superGoldConditions.isSuperGold ? '🎱 YES (+' + opp.analysis.superGoldConditions.superGoldBonus + '分)' : '❌ No'}

**超级金矿条件:**
- 100万+用户: ${opp.analysis.superGoldConditions.has100kUsers ? '✅' : '❌'}
- 近48h负面评论: ${opp.analysis.superGoldConditions.recentNegativeComments}条

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
    console.log('🎯 OPPORTUNITY HUNTER v5.6');
    console.log('📡 专注: Twitter / Chrome Store / VSCode');
    console.log('🧠 引擎: DeepSeek 单一综合判断');
    console.log('🧬 进化: 搜索词自我进化已启用');
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

      // v5.6: 触发搜索词进化学习
      try {
        const topTools = goldens.slice(0, 5).map(o => this.extractToolName(o.signal.title));
        await this.fetchers.triggerLearning({
          goldFound: goldens.length,
          topTools
        });
      } catch (learnError) {
        console.error(`   ⚠️ 进化学习失败: ${learnError instanceof Error ? learnError.message : '未知错误'}`);
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

  // 自动创建必要的目录（宿主机适配）
  const dirs = ['logs', 'reports', 'data'];
  for (const dir of dirs) {
    try {
      const dirPath = path.join(process.cwd(), dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`✅ 创建目录: ${dirPath}`);
      }
    } catch (err) {
      console.warn(`⚠️ 无法创建目录 ${dir}:`, err instanceof Error ? err.message : err);
    }
  }

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
