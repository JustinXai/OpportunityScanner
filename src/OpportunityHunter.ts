/**
 * OpportunityHunter.ts v2.0
 * 多平台商机扫描器 + 三阶段AI决策系统
 *
 * GitHub Actions 稳定运行版 (使用 tsx 运行器)
 */

// ============================================================
// 系统启动初始化
// ============================================================
console.log('--- SYSTEM_BOOT: ENGINE START ---');
process.on('uncaughtException', (err) => {
  console.error('FATAL_EXCEPTION:', err.stack || err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('FATAL_REJECTION:', reason);
  process.exit(1);
});

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import pLimit from 'p-limit';
import { EmailService } from './EmailService.js';

// ============================================================
// 环境变量验证
// ============================================================
interface EnvConfig {
  SERPER_API_KEY: string;
  DOUBAO_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  GITHUB_TOKEN: string;
  SMTP_CONFIGURED: boolean;
}

function validateEnvironment(): EnvConfig {
  console.log('\n========================================');
  console.log('🔍 开始环境变量检查...');
  console.log('========================================');

  const errors: string[] = [];

  const serper = process.env.SERPER_API_KEY;
  const doubao = process.env.DOUBAO_API_KEY;
  const deepseek = process.env.DEEPSEEK_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  // 只显示前4位，保护敏感信息
  console.log(`   SERPER_API_KEY: ${serper ? '✅ 已配置 (' + serper.substring(0, 4) + '...)' : '❌ 未配置'}`);
  console.log(`   DOUBAO_API_KEY: ${doubao ? '✅ 已配置 (' + doubao.substring(0, 4) + '...)' : '❌ 未配置'}`);
  console.log(`   DEEPSEEK_API_KEY: ${deepseek ? '✅ 已配置 (' + deepseek.substring(0, 4) + '...)' : '❌ 未配置'}`);
  console.log(`   GITHUB_TOKEN: ${githubToken ? '✅ 已配置 (' + githubToken.substring(0, 4) + '...)' : '❌ 未配置'}`);

  if (!serper) errors.push('Error: Environment variable SERPER_API_KEY is missing.');
  if (!doubao) errors.push('Error: Environment variable DOUBAO_API_KEY is missing.');
  if (!deepseek) errors.push('Error: Environment variable DEEPSEEK_API_KEY is missing.');
  if (!githubToken) errors.push('Error: Environment variable GITHUB_TOKEN is missing.');

  if (errors.length > 0) {
    process.stderr.write('\n❌ 环境变量检查失败:\n');
    errors.forEach(e => process.stderr.write(`   - ${e}\n`));
    process.stderr.write('\n请在 .env 文件或 GitHub Secrets 中配置这些变量。\n');
    process.stderr.write('========================================\n\n');
    process.exit(1);
  }

  console.log('✅ 所有环境变量验证通过');
  console.log('========================================\n');

  return {
    SERPER_API_KEY: serper!,
    DOUBAO_API_KEY: doubao!,
    DEEPSEEK_API_KEY: deepseek!,
    GITHUB_TOKEN: githubToken!,
    SMTP_CONFIGURED: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  };
}

const ENV = validateEnvironment();

const GITHUB_REPO = 'JustinXai/OpportunityScanner';

// ============================================================
// 日志文件初始化（Docker 部署时写入 /app/logs）
// ============================================================
function initFileLogger(): void {
  const logDir = process.env.LOG_DIR || '/app/logs';
  const timestamp = new Date().toISOString().split('T')[0];
  const logFile = path.join(logDir, `scan-${timestamp}.log`);
  
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args: unknown[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      originalLog.apply(console, args);
      logStream.write(`[${new Date().toISOString()}] ${msg}\n`);
    };
    
    console.error = (...args: unknown[]) => {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      originalError.apply(console, args);
      logStream.write(`[${new Date().toISOString()}] ERROR: ${msg}\n`);
    };
    
    console.log(`📁 日志文件: ${logFile}`);
  } catch (err) {
    console.error('⚠️ 无法创建日志文件:', err);
  }
}

// 开发环境跳过文件日志（Docker 时自动启用）
if (process.env.NODE_ENV === 'production') {
  initFileLogger();
}

// User-Agent 轮换池
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile'
];

// 并发控制
const CONCURRENCY_LIMIT = pLimit(3);

// ============================================================
// 安全保险丝 - Memory 文件管理
// ============================================================
interface MemoryData {
  last_run_time: string | null;
  consecutive_errors: number;
  daily_api_calls: number;
  last_api_reset: string;
}

const MEMORY_FILE = '/app/logs/memory.json';
const RUN_INTERVAL_MS = 60 * 60 * 1000; // 1小时
const MAX_DAILY_API_BUDGET = 100; // 每日 API 调用上限
const MAX_CONSECUTIVE_ERRORS = 3;
const SERPER_COST_PER_QUERY = 5; // 每次查询预估消耗

function loadMemory(): MemoryData {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.warn('⚠️ 无法读取 memory.json，将创建新的:', err);
  }
  return {
    last_run_time: null,
    consecutive_errors: 0,
    daily_api_calls: 0,
    last_api_reset: new Date().toISOString().split('T')[0]
  };
}

function saveMemory(memory: MemoryData): void {
  try {
    const dir = path.dirname(MEMORY_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (err) {
    console.error('⚠️ 无法保存 memory.json:', err);
  }
}

function checkRunInterval(memory: MemoryData): boolean {
  if (!memory.last_run_time) {
    console.log('📅 首次运行，跳过间隔检查');
    return true;
  }
  
  const lastRun = new Date(memory.last_run_time).getTime();
  const now = Date.now();
  const elapsed = now - lastRun;
  
  if (elapsed < RUN_INTERVAL_MS) {
    const remaining = Math.ceil((RUN_INTERVAL_MS - elapsed) / 60000);
    console.log(`⏰ 安全保险丝触发: 距离上次运行不足 1 小时`);
    console.log(`   上次运行: ${memory.last_run_time}`);
    console.log(`   需等待: ${remaining} 分钟`);
    console.log('🛡️ 进程安全退出');
    return false;
  }
  
  console.log(`📅 距离上次运行: ${Math.floor(elapsed / 60000)} 分钟，间隔检查通过`);
  return true;
}

function checkApiBudget(memory: MemoryData, estimatedCalls: number): void {
  const today = new Date().toISOString().split('T')[0];
  
  // 重置每日计数
  if (memory.last_api_reset !== today) {
    memory.daily_api_calls = 0;
    memory.last_api_reset = today;
  }
  
  const projectedTotal = memory.daily_api_calls + estimatedCalls;
  
  console.log('💰 API 预算检查:');
  console.log(`   今日已用: ${memory.daily_api_calls} / ${MAX_DAILY_API_BUDGET}`);
  console.log(`   本次预计: +${estimatedCalls} (每次 ~${SERPER_COST_PER_QUERY})`);
  console.log(`   预计总计: ${projectedTotal}`);
  
  if (projectedTotal > MAX_DAILY_API_BUDGET) {
    console.warn('⚠️⚠️⚠️ API 预算预警: 本次扫描将超过每日额度上限!');
    console.warn(`   当前已用: ${memory.daily_api_calls}`);
    console.warn(`   本次消耗: ~${estimatedCalls * SERPER_COST_PER_QUERY}`);
    console.warn(`   剩余额度: ${MAX_DAILY_API_BUDGET - memory.daily_api_calls}`);
    console.warn(`   请考虑设置 MAX_DAILY_API_BUDGET 环境变量`);
  } else {
    console.log(`   预算状态: ✅ 安全 (剩余 ${MAX_DAILY_API_BUDGET - projectedTotal})`);
  }
}

function handleError(memory: MemoryData): MemoryData {
  memory.consecutive_errors += 1;
  console.log(`⚠️ 连续错误计数: ${memory.consecutive_errors} / ${MAX_CONSECUTIVE_ERRORS}`);
  
  if (memory.consecutive_errors >= MAX_CONSECUTIVE_ERRORS) {
    console.error('🚨🚨🚨 连续错误达到上限，进入休眠模式');
    console.error(`   连续失败: ${memory.consecutive_errors} 次`);
    console.error(`   请检查日志并手动干预`);
    
    // 发送紧急邮件（如果配置了）
    if (ENV.SMTP_CONFIGURED) {
      console.log('📧 尝试发送紧急报警邮件...');
      // 邮件发送逻辑将在后续实现
    }
    
    // 休眠直到手动干预
    process.exit(1);
  }
  
  return memory;
}

function onSuccess(memory: MemoryData): MemoryData {
  memory.consecutive_errors = 0; // 重置错误计数
  memory.last_run_time = new Date().toISOString();
  return memory;
}

// ============================================================
// 类型定义
// ============================================================
interface PainSignal {
  platform: string;
  title: string;
  description: string;
  url: string;
  sentiment: 'negative' | 'neutral' | 'positive';
  rawComments?: string[];
  source: string;
  timestamp: Date;
}

interface SEOAnalysis {
  intentKeywords: string[];
  isOneTimeUse: boolean;
  frequencyScore: number;
  seoIntentVolume: number;
  highConversionPotential: boolean;
  pricingArbitrage: 'high' | 'medium' | 'low';
  analysis: string;
}

interface SherlockRiskScore {
  total: number;
  securityRedLine: boolean;
  infraRedLine: boolean;
  platformBanRisk: number;
  techComplexity: number;
  technicalDebt: string[];
  verdict: 'PROCEED' | 'REVIEW' | 'REJECT';
  reasoning: string;
}

interface PricingStrategy {
  recommended: 'lifetime' | 'subscription' | 'freemium' | 'hybrid';
  priceRange: string;
  arbitrageLogic: string;
  conversionOptimistic: string;
  conversionPessimistic: string;
}

interface VulnerabilityPoint {
  type: 'overselling' | 'bulk_update_failed' | 'slowed_down' | 'other';
  severity: 'critical' | 'high' | 'medium' | 'low';
  affectedApps: string[];
  exploitability: string;
}

interface CrossValidation {
  doubaoOffense: string;
  deepseekDefense: string;
  finalConsensus: 'GO' | 'HOLD' | 'ABORT';
  debateSummary: string;
}

interface GoldenOpportunity {
  id: string;
  signal: PainSignal;
  seoAnalysis: SEOAnalysis;
  riskScore: SherlockRiskScore;
  pricing: PricingStrategy;
  vulnerability: VulnerabilityPoint;
  crossValidation: CrossValidation;
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
// HTTP 客户端工厂
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
// 错误处理工具
// ============================================================
function handleAxiosError(error: unknown, context: string): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const message = error.message;
    const responseData = error.response?.data;

    let detailedError = `${context}: HTTP ${status || 'unknown'} (${statusText || 'No status text'}) - ${message}`;

    if (status === 401) {
      detailedError += '\n   └─ API 认证失败 (401)。请检查 API Key 是否正确。';
      detailedError += `\n   └─ 响应详情: ${JSON.stringify(responseData, null, 2)}`;
    } else if (status === 429) {
      detailedError += '\n   └─ 请求频率超限 (429)。API 配额可能已耗尽。';
      detailedError += `\n   └─ 响应详情: ${JSON.stringify(responseData, null, 2)}`;
    } else if (status === 403) {
      detailedError += '\n   └─ 访问被拒绝 (403)。可能缺少权限或 IP 白名单限制。';
      detailedError += `\n   └─ 响应详情: ${JSON.stringify(responseData, null, 2)}`;
    } else if (status === 400) {
      detailedError += '\n   └─ 请求参数错误 (400)。请检查 API 请求格式。';
      detailedError += `\n   └─ 响应详情: ${JSON.stringify(responseData, null, 2)}`;
    } else if (status === 500 || status === 502 || status === 503) {
      detailedError += '\n   └─ 服务器端错误，请稍后重试。';
      detailedError += `\n   └─ 响应详情: ${JSON.stringify(responseData, null, 2)}`;
    } else if (responseData) {
      detailedError += `\n   └─ 响应详情: ${JSON.stringify(responseData, null, 2)}`;
    }

    return detailedError;
  }

  if (error instanceof Error) {
    return `${context}: ${error.message}\n   └─ Stack: ${error.stack}`;
  }

  return `${context}: 未知错误类型 - ${JSON.stringify(error)}`;
}

// ============================================================
// 第一阶段: 获取器模块 (Fetchers)
// ============================================================
class Fetchers {
  private http = new HttpFactory();
  private serperClient = this.http.createSerperClient();

  async searchPainSignals(): Promise<PainSignal[]> {
    console.log('\n🔍 [Stage 1-1] Starting Serper search...');
    const startTime = Date.now();

    const queries = [
      { q: 'site:reddit.com Shopify broken OR frustrated OR waste of money', platform: 'Reddit' },
      { q: 'site:reddit.com "VSCode extension" missing OR bug OR slow', platform: 'Reddit' },
      { q: 'site:reddit.com "Shopify app" scam OR misleading', platform: 'Reddit' },
      { q: 'Shopify app "one time" OR "one-time" purchase OR lifetime deal', platform: 'General' }
    ];

    const results: PainSignal[] = [];

    for (let i = 0; i < queries.length; i++) {
      const { q, platform } = queries[i];
      console.log(`   [${i + 1}/${queries.length}] 查询: ${q.substring(0, 40)}...`);

      try {
        const response = await this.serperClient.post('', { q, num: 10 });
        const items = response.data?.organic || [];
        console.log(`      └─ 获得 ${items.length} 条结果`);

        for (const item of items.slice(0, 5)) {
          results.push({
            platform,
            title: item.title || '',
            description: (item.snippet || '').substring(0, 300),
            url: item.link || '',
            sentiment: this.analyzeSentiment(item.snippet || ''),
            source: 'serper',
            timestamp: new Date()
          });
        }
      } catch (error) {
        process.stderr.write(`      ❌ ${handleAxiosError(error, `Serper 查询 [${q.substring(0, 30)}...]`)}\n`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [Stage 1-1] Serper search completed in ${elapsed}s. Found ${results.length} pain signals.`);
    return results;
  }

  async scrapeShopify(): Promise<PainSignal[]> {
    console.log('\n🛒 [Stage 1-2] Starting Shopify scraping...');
    const startTime = Date.now();

    try {
      console.log('   └─ 正在请求 Shopify 应用商店...');
      const client = this.http.createClient({ 'Referer': 'https://www.google.com' });
      const response = await client.get('https://apps.shopify.com/search?q=AI+productivity');
      console.log('   └─ 收到响应，正在解析 HTML...');

      const $ = cheerio.load(response.data);
      const results: PainSignal[] = [];

      $('[data-testid="app-card"], .app-card').each((_, el) => {
        const $el = $(el);
        const title = $el.find('[data-testid="card-title"], h3').first().text().trim();
        const description = $el.find('[data-testid="card-subtitle"], .subtitle').first().text().trim();
        const ratingStr = $el.find('span[aria-label*="out of 5"]').first().attr('aria-label') || '';
        const rating = parseFloat(ratingStr.match(/([\d.]+) out of/)?.[1] || '0');

        if (title) {
          results.push({
            platform: 'Shopify',
            title,
            description,
            url: `https://apps.shopify.com${$el.find('a').first().attr('href') || ''}`,
            sentiment: rating < 3.5 ? 'negative' : 'neutral',
            source: 'shopify-storefront',
            timestamp: new Date()
          });
        }
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ [Stage 1-2] Shopify scraping completed in ${elapsed}s. Found ${results.length} apps.`);
      return results;
    } catch (error) {
      process.stderr.write(`   ❌ ${handleAxiosError(error, 'Shopify 抓取')}\n`);
      console.log('   └─ 使用模拟数据作为后备...');
      return this.getMockShopifyData();
    }
  }

  async scrapeVSCode(): Promise<PainSignal[]> {
    console.log('\n📦 [Stage 1-3] Starting VSCode Marketplace query...');
    const startTime = Date.now();

    try {
      console.log('   └─ 正在请求 VSCode Marketplace API...');
      const client = this.http.createClient();
      const response = await client.post(
        'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1',
        {
          filters: [{
            criteria: [
              { filterType: 7, value: 'Microsoft.VisualStudio.Code' },
              { filterType: 8, value: 'latest' }
            ],
            pageNumber: 1,
            pageSize: 30,
            sortBy: 4,
            sortOrder: 4
          }],
          flags: 914
        },
        { 
          headers: { 
            'Accept': 'application/json; charset=utf-8; api-version=7.2-preview.1',
            'Content-Type': 'application/json'
          } 
        }
      );
      console.log('   └─ 收到响应，正在解析扩展数据...');

      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
      const extensions = response.data?.results?.[0]?.extensions || [];
      const results: PainSignal[] = [];

      for (const ext of extensions) {
        const lastUpdated = new Date(ext.lastUpdated);
        if (lastUpdated > twelveHoursAgo) {
          results.push({
            platform: 'VSCode',
            title: ext.displayName || ext.extensionName,
            description: (ext.shortDescription || '').replace(/<[^>]*>/g, ''),
            url: `https://marketplace.visualstudio.com/items?itemName=${ext.extensionName}`,
            sentiment: 'neutral',
            source: 'vscode-marketplace',
            timestamp: lastUpdated
          });
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ [Stage 1-3] VSCode Marketplace query completed in ${elapsed}s. Found ${results.length} extensions.`);
      return results;
    } catch (error: any) {
      process.stderr.write(`   ❌ ${handleAxiosError(error, 'VSCode 抓取')}\n`);
      
      // 打印完整错误响应 headers 用于分析微软防爬策略
      if (error.response?.status) {
        console.error('=== VSCode API 错误响应 Headers ===');
        console.error(JSON.stringify(error.response.headers, null, 2));
        console.error('===================================');
      }
      if (error.response?.data) {
        console.error('=== VSCode API 错误响应 Body ===');
        console.error(JSON.stringify(error.response.data, null, 2));
        console.error('===================================');
      }
      return [];
    }
  }

  // ============================================================
  // Chrome MV3 金矿猎杀模块 - 专项监控5大流血领域
  // ============================================================
  async fetchChromeMV3GoldSignals(): Promise<PainSignal[]> {
    console.log('\n🏆 [Stage 1-5] Starting Chrome MV3 Gold Hunt...');
    const startTime = Date.now();

    // 5个金矿关键词
    const goldTargets = [
      { q: 'alternative to ModHeader Manifest V3', tag: 'ModHeader替代', weight: 'HIGH' },
      { q: 'WhatsApp web chat export broken chrome 2026', tag: 'WhatsApp数据导出', weight: 'HIGH' },
      { q: 'LLM context copy Markdown extension error', tag: 'LLM上下文导出', weight: 'HIGH' },
      { q: 'Auto refresh tab keep awake MV3 workaround', tag: 'Tab保活', weight: 'MEDIUM' },
      { q: 'lightweight API token counter chrome extension', tag: 'API计数', weight: 'MEDIUM' }
    ];

    // 情绪关键词过滤
    const negativePhrases = ['broken', 'useless now', 'paid subscription too expensive', 
                              'not working', 'stopped working', 'broken by update',
                              'too expensive', 'migration failed', 'no alternative'];
    const isNegative = (text: string) => negativePhrases.some(p => text.toLowerCase().includes(p));

    const results: PainSignal[] = [];

    for (let i = 0; i < goldTargets.length; i++) {
      const { q, tag, weight } = goldTargets[i];
      console.log(`   [${i + 1}/${goldTargets.length}] [${weight}] ${tag}: ${q}`);

      try {
        // 使用 Serper 搜索，过去24小时内容
        const response = await this.serperClient.post('', { 
          q,
          num: 10,
          tbs: 'qdr:d'  // 过去24小时
        });
        const items = response.data?.organic || [];

        for (const item of items.slice(0, 4)) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          const url = item.link || '';
          
          // 仅保留包含负面情绪的内容
          if (isNegative(title) || isNegative(snippet)) {
            results.push({
              platform: 'Chrome-MV3-GOLD',
              title: `[MV3_GOLD_HUNT][${weight}] ${tag}: ${title}`,
              description: `[情绪来源: ${url}] ${snippet}`.substring(0, 400),
              url,
              sentiment: 'negative',
              source: 'serper-mv3-gold',
              timestamp: new Date()
            });
            console.log(`      └─ 🎯 捕获负面信号: ${title.substring(0, 50)}...`);
          }
        }
      } catch (error) {
        process.stderr.write(`      ❌ ${handleAxiosError(error, `MV3 Gold [${tag}]`)}\n`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [Stage 1-5] Chrome MV3 Gold Hunt completed in ${elapsed}s. Found ${results.length} gold signals.`);
    return results;
  }

  // ============================================================
  // Chrome MV3 猎杀模块 - Manifest V3 专项搜索
  // ============================================================
  async fetchChromeMV3Signals(): Promise<PainSignal[]> {
    console.log('\n🔴 [Stage 1-6] Starting Chrome MV3 Signals Hunt...');
    const startTime = Date.now();

    const queries = [
      { q: '"alternative to" chrome extension "Manifest V3"', category: 'MV3替代' },
      { q: '"uBlock Origin" replacement chrome 2026', category: 'uBlock替代' },
      { q: 'site:reddit.com "broken" chrome extension', category: 'Reddit怨气' }
    ];

    const results: PainSignal[] = [];

    for (let i = 0; i < queries.length; i++) {
      const { q, category } = queries[i];
      console.log(`   [${i + 1}/${queries.length}] [${category}] ${q}`);

      try {
        const response = await this.serperClient.post('', { q, num: 10 });
        const items = response.data?.organic || [];

        for (const item of items.slice(0, 5)) {
          results.push({
            platform: 'Chrome-MV3',
            title: `[CHROME_MV3_HUNT][${category}] ${item.title || ''}`,
            description: `${item.snippet || ''}`.substring(0, 400),
            url: item.link || '',
            sentiment: this.analyzeSentiment(item.snippet || ''),
            source: 'serper-mv3',
            timestamp: new Date()
          });
        }
      } catch (error) {
        process.stderr.write(`      ❌ ${handleAxiosError(error, `MV3 [${category}]`)}\n`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [Stage 1-6] Chrome MV3 Signals Hunt completed in ${elapsed}s. Found ${results.length} signals.`);
    return results;
  }

  // ============================================================
  // Chrome MV3 "猎杀"模块 - 三维度废墟扫描
  // ============================================================
  async fetchChromeSignals(): Promise<PainSignal[]> {
    console.log('\n🔴 [Stage 1-4] Starting Chrome MV3 Hunt...');
    const startTime = Date.now();

    const queries = [
      // MV3 崩盘替代（核心情报）
      { q: '"alternative to" chrome extension "Manifest V3"', category: 'MV3替代' },
      { q: '"uBlock Origin" replacement chrome 2026', category: 'uBlock替代' },
      
      // Chrome Web Store 直接差评搜索
      { q: 'site:chromewebstore.google.com "one star" "broken" "manifest v3"', category: 'WebStore差评' },
      { q: 'site:chromewebstore.google.com "not working" "2026"', category: 'WebStore失效' },
      { q: 'site:chromewebstore.google.com review "useless" "paid"', category: 'WebStore抱怨' },
      
      // Reddit 怨气（有噪音过滤）
      { q: 'site:reddit.com "broken" chrome extension manifest v3 -scam -fake reviews', category: 'Reddit怨气' }
    ];

    const results: PainSignal[] = [];

    for (let i = 0; i < queries.length; i++) {
      const { q, category } = queries[i];
      console.log(`   [${i + 1}/${queries.length}] [${category}] ${q.substring(0, 35)}...`);

      try {
        const response = await this.serperClient.post('', { q, num: 8 });
        const items = response.data?.organic || [];

        for (const item of items.slice(0, 3)) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          const url = item.link || '';

          // Reddit 噪音过滤：降低无具体功能指向的信号优先级
          const isLowPriorityReddit = (
            url.includes('reddit.com') && 
            (title.toLowerCase().includes('scam') || title.toLowerCase().includes('fake reviews')) &&
            !snippet.match(/extension|plugin|tool|app|addon/i)
          );
          
          if (isLowPriorityReddit) {
            console.log(`      └─ [过滤] Reddit噪音（无具体工具名）: ${title.substring(0, 40)}...`);
            continue; // 跳过低优先级信号
          }

          // 提取被替代的产品名
          const altMatch = snippet.match(/alternative to ["']?([A-Za-z0-9\s]+?)["']?\s*(?:extension|chrome|plugin)/i);
          const targetProduct = altMatch ? altMatch[1].trim() : '';

          // 优先处理带具体工具名称的抱怨
          const hasSpecificTool = snippet.match(/extension|plugin|tool|app|addon/i);
          const priorityTag = hasSpecificTool ? '🔥HOT' : '📌MED';

          results.push({
            platform: 'Chrome-MV3',
            title: `[${priorityTag}][${category}] ${title}`,
            description: `[需求类型: ${category}]${targetProduct ? ` 替代品目标: ${targetProduct}` : ''} | ${snippet}`.substring(0, 400),
            url,
            sentiment: this.analyzeSentiment(snippet),
            source: 'serper-chrome-mv3',
            timestamp: new Date()
          });

          if (targetProduct) {
            console.log(`      └─ [${category}] 机会: 替代 "${targetProduct}"`);
          }
        }
      } catch (error) {
        process.stderr.write(`      ❌ ${handleAxiosError(error, `Chrome MV3 [${q.substring(0, 25)}...]`)}\n`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [Stage 1-4] Chrome MV3 Hunt completed in ${elapsed}s. Found ${results.length} signals.`);
    return results;
  }

  private analyzeSentiment(text: string): 'negative' | 'neutral' | 'positive' {
    const negative = ['broken', 'frustrated', 'scam', 'misleading', 'useless', 'terrible', 'failed'];
    const positive = ['great', 'amazing', 'love', 'helpful', 'excellent'];
    const lower = text.toLowerCase();

    if (negative.some(w => lower.includes(w))) return 'negative';
    if (positive.some(w => lower.includes(w))) return 'positive';
    return 'neutral';
  }

  private getMockShopifyData(): PainSignal[] {
    return [{
      platform: 'Shopify',
      title: 'AI Product Description Generator Pro',
      description: 'Generate SEO-optimized product descriptions. Users report: overselling claims, bulk updates often fail.',
      url: 'https://apps.shopify.com/ai-pro',
      sentiment: 'negative',
      source: 'mock',
      timestamp: new Date()
    }];
  }

  async runAll(): Promise<PainSignal[]> {
    console.log('\n🚀 [Fetcher] 启动全平台扫描...\n');

    const results = await Promise.allSettled([
      this.searchPainSignals(),
      this.scrapeShopify(),
      this.scrapeVSCode(),
      this.fetchChromeWebStoreSignals() // 新增 Chrome Web Store 直接采集
    ]);

    const signals: PainSignal[] = [];
    const platformCounts = { Chrome: 0, Shopify: 0, VSCode: 0, Reddit: 0, Other: 0 };
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        signals.push(...result.value);
        result.value.forEach(s => {
          if (s.platform?.includes('Chrome')) platformCounts.Chrome++;
          else if (s.platform === 'Shopify') platformCounts.Shopify++;
          else if (s.platform === 'VSCode') platformCounts.VSCode++;
          else if (s.source?.includes('reddit')) platformCounts.Reddit++;
          else platformCounts.Other++;
        });
      } else {
        console.error(`   ⚠️ 平台 ${['Serper', 'Shopify', 'VSCode', 'ChromeWebStore'][index]} 采集失败`);
      }
    });

    // 强制权重分配：确保 Chrome Web Store 和 VSCode 各至少 5 条
    const chromeSignals = signals.filter(s => s.platform?.includes('Chrome') || s.source === 'vscode-marketplace');
    const vscodeSignals = signals.filter(s => s.platform === 'VSCode' || s.source === 'vscode-marketplace');
    
    console.log(`   📊 当前分布: Chrome=${platformCounts.Chrome} | Shopify=${platformCounts.Shopify} | VSCode=${platformCounts.VSCode} | Reddit=${platformCounts.Reddit}`);
    
    // 补充 Chrome 信号（如果不足 5 条）
    if (platformCounts.Chrome < 5) {
      console.log(`   ⚠️ Chrome 信号不足(${platformCounts.Chrome})，补充搜索...`);
      const extraChrome = await this.fetchChromeMV3Signals();
      signals.push(...extraChrome.slice(0, 5 - platformCounts.Chrome));
    }
    
    // 补充 VSCode 信号（如果不足 5 条）
    if (platformCounts.VSCode < 5) {
      console.log(`   ⚠️ VSCode 信号不足(${platformCounts.VSCode})，补充搜索...`);
      const extraVSCode = await this.scrapeVSCodeFresh();
      signals.push(...extraVSCode.slice(0, 5 - platformCounts.VSCode));
    }

    console.log(`\n📊 总计采集: ${signals.length} 个信号\n`);
    return signals;
  }

  // Chrome Web Store 直接采集（新增）
  private async fetchChromeWebStoreSignals(): Promise<PainSignal[]> {
    console.log('   [WebStore] 正在从 Chrome Web Store 直接采集信号...');
    try {
      // 搜索 Chrome 商店中差评/崩溃的插件
      const badReviewQueries = [
        { q: 'site:chromewebstore.google.com "one star" "broken" manifest v3', category: 'WebStore差评' },
        { q: 'site:chromewebstore.google.com "not working" "2026"', category: 'WebStore失效' },
        { q: 'site:chromewebstore.google.com review "useless" extension', category: 'WebStore抱怨' }
      ];
      
      const results: PainSignal[] = [];
      for (const { q, category } of badReviewQueries) {
        const response = await this.serperClient.post('', { q, num: 8 });
        const items = response.data?.organic || [];
        for (const item of items.slice(0, 3)) {
          results.push({
            platform: 'Chrome-WebStore',
            title: `[${category}] ${item.title || 'Chrome插件投诉'}`,
            description: (item.snippet || '').substring(0, 400),
            url: item.link || '',
            sentiment: 'negative',
            source: 'chrome-webstore-direct',
            timestamp: new Date()
          });
        }
      }
      console.log(`   [WebStore] 采集到 ${results.length} 个 Chrome 商店信号`);
      return results;
    } catch (error) {
      console.error(`   ⚠️ Chrome Web Store 直接采集失败: ${error instanceof Error ? error.message : '未知错误'}`);
      return [];
    }
  }

  // VSCode 补充采集（新鲜度优先）
  private async scrapeVSCodeFresh(): Promise<PainSignal[]> {
    try {
      const client = this.http.createClient();
      const response = await client.post(
        'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1',
        {
          filters: [{
            criteria: [
              { filterType: 7, value: 'Microsoft.VisualStudio.Code' },
              { filterType: 8, value: 'latest' }
            ],
            pageNumber: 1,
            pageSize: 20,
            sortBy: 4,      // 热度上升最快
            sortOrder: 4    // 上升趋势
          }],
          flags: 914
        },
        { 
          headers: { 
            'Accept': 'application/json; charset=utf-8; api-version=7.2-preview.1',
            'Content-Type': 'application/json'
          } 
        }
      );
      const extensions = response.data?.results?.[0]?.extensions || [];
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      return extensions
        .filter((ext: any) => new Date(ext.lastUpdated) > oneWeekAgo)
        .slice(0, 10)
        .map((ext: any) => ({
          platform: 'VSCode',
          title: ext.displayName || ext.extensionName,
          description: (ext.shortDescription || '').replace(/<[^>]*>/g, ''),
          url: `https://marketplace.visualstudio.com/items?itemName=${ext.extensionName}`,
          sentiment: 'neutral',
          source: 'vscode-marketplace-fresh',
          timestamp: new Date()
        }));
    } catch {
      return [];
    }
  }
}

// ============================================================
// 第二阶段: 决策大脑 - 豆包 Pro (定价套利分析)
// ============================================================
class DoubaoAgent {
  private endpointId = 'ep-20260115140805-6nxf5';

  async analyze(signal: PainSignal): Promise<SEOAnalysis> {
    console.log(`   [AI-1] Starting Doubao analysis for: ${signal.title.substring(0, 30)}...`);
    const startTime = Date.now();

    const prompt = `你是一位增长黑客，专门评估"替代成本"和 SEO 抢占策略。

【商机信号】
平台: ${signal.platform}
标题: ${signal.title}
描述: ${signal.description}
用户情绪: ${signal.sentiment}

【核心任务 - 替代成本评估 + SEO 抢占策略 + 产品命名算法】

1. 替代成本分析:
   - 用户正在搜索哪个竞品的替代品？
   - 该竞品被用户如何评价（评分、评论）？
   - 用户切换到我们的成本有多高？

2. SEO 命名算法 (核心新增 - 三个命名公式):
   基于【寄生平台 SEO 习惯】，请给出 3 个产品命名建议：
   
   - 命名公式 A（截流型）：[竞品名称] Alternative: [核心功能描述]
     例: ModHeader Alternative: Lightweight Header Modifier
   
   - 命名公式 B（直击痛点型）：Clean [功能词] - No [用户讨厌的痛点]
     例: Clean Headers - No Popup Spam
   
   - 命名公式 C（极简型）：[核心动作] to [目标格式/结果]
     例: Page to Markdown, Chat to PDF, Tab to Notes

3. SEO 抢占策略:
   - 在评分均低于 3.0 的搜索结果中，如果我们首发获得 5 个 5 星��价
   - 能否在 1 周内冲上搜索第一页？

4. 意图关键词提取 (5-8个):
   - 用户在搜索时会用什么词？
   - 长尾词机会在哪里？

5. 使用频率分析 (1-10分):
   - 如果 < 3，说明用户可能只是"一次性需求"
   - 这类需求适合"买断制"而非"订阅制"

6. 定价套利逻辑:
   - 对比同类产品的定价
   - 找出价格洼地或溢价空间

7. 隐私评分:
   - 评估该功能是否可以用【局部权限(ActiveTab)】实现
   - 如果可以 → 预估转化率提升50%

8. 最终判决:
   - TARGET_ACQUIRED: 替代成本低 + SEO 可抢占 + 隐私友好
   - PROCEED: 增长可行
   - REVIEW: 需要进一步验证

【输出格式】(仅JSON，不要其他内容)
{
  "targetCompetitor": "竞品名称或null",
  "switchCost": "low或medium或high",
  "namingSuggestions": {
    "formulaA": "[竞品] Alternative: [功能描述]",
    "formulaB": "Clean [功能词] - No [痛点]",
    "formulaC": "[动作] to [目标格式]"
  },
  "bestNamingForSEO": "formulaA或formulaB或formulaC",
  "namingSEOWeightRanking": {
    "formulaA_rank": 1-10,
    "formulaB_rank": 1-10,
    "formulaC_rank": 1-10,
    "bestForChromeStore": "formulaA或formulaB或formulaC",
    "seoWeightReason": "哪个命名在Chrome商店自然搜索权重最高的理由"
  },
  "seoActionItems": ["行动项1", "行动项2"],
  "weekOneGoal": "第一周SEO目标描述",
  "intentKeywords": ["关键词1", "关键词2"],
  "isOneTimeUse": true或false,
  "frequencyScore": 1-10,
  "seoIntentVolume": 1000-100000,
  "highConversionPotential": true或false,
  "pricingArbitrage": "high或medium或low",
  "privacyScore": 1-10,
  "conversionBoostPercent": 0-100,
  "finalVerdict": "TARGET_ACQUIRED或PROCEED或REVIEW",
  "analysis": "增长分析（80字内）"
}`;

    try {
      console.log('   [AI-1] Sending request to Doubao API...');
      const client = axios.create({
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        timeout: 60000,
        headers: {
          'Authorization': `Bearer ${ENV.DOUBAO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const response = await client.post('', {
        model: this.endpointId,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 600
      });
      console.log('   [AI-1] Received response from Doubao API');

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`   [AI-1] Doubao analysis completed in ${elapsed}s`);
      return this.parseResponse(response.data.choices[0].message.content);
    } catch (error) {
      process.stderr.write(`   [AI-1] ❌ ${handleAxiosError(error, 'Doubao API 调用失败')}\n`);
      return this.getMock();
    }
  }

  private parseResponse(content: string): SEOAnalysis {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON found');
      const data = JSON.parse(match[0]);
      return {
        intentKeywords: Array.isArray(data.intentKeywords) ? data.intentKeywords : [],
        isOneTimeUse: Boolean(data.isOneTimeUse),
        frequencyScore: Number(data.frequencyScore) || 5,
        seoIntentVolume: Number(data.seoIntentVolume) || 5000,
        highConversionPotential: Boolean(data.highConversionPotential),
        pricingArbitrage: ['high', 'medium', 'low'].includes(data.pricingArbitrage)
          ? data.pricingArbitrage : 'medium',
        analysis: String(data.analysis || '')
      };
    } catch {
      return this.getMock();
    }
  }

  private getMock(): SEOAnalysis {
    return {
      intentKeywords: ['Shopify AI 描述生成', '批量产品优化', '一键翻译'],
      isOneTimeUse: true,
      frequencyScore: 2,
      seoIntentVolume: 8500,
      highConversionPotential: true,
      pricingArbitrage: 'high',
      analysis: '一次性需求 + 低频使用 = 买断制高转化'
    };
  }
}

// ============================================================
// 第二阶段: 决策大脑 - DeepSeek V3 (CTO 冷血视角)
// ============================================================
class DeepSeekAgent {
  async evaluate(signal: PainSignal): Promise<SherlockRiskScore> {
    console.log(`   [AI-2] Starting DeepSeek evaluation for: ${signal.title.substring(0, 30)}...`);
    const startTime = Date.now();

    const prompt = `你是一位 Chrome Extension 架构师，专门评估 MV3 可行性红利。

【商机信号】
平台: ${signal.platform}
标题: ${signal.title}
描述: ${signal.description}

【核心任务 - MV3 可行性红利评估 + SidePanel 判定】

1. 核心问题（必须回答）:
   该功能是否能完全利用 Chrome MV3 的 SidePanel API 实现？
   - sidePanel.setPanelBehavior 能否处理该交互流程？
   - 是否需要配合 offscreen 或 service worker？
   - 给出【是/否/部分】判定

2. 痛点溯源分析:
   - 该痛点是否源于老插件无法适配 Manifest V3？
   - 老牌插件(如uBlock、ModHeader)是否因架构锁定而无法迁移？
   - 用户正在寻找什么替代品？

3. 技术可行性评估:
   - 如果使用 chrome.sidePanel API，是否能实现该功能？
   - 如果使用 chrome.offscreen API 处理后台任务，是否可行？
   - 能否用【局部权限(ActiveTab)】替代【全站权限】？
   - 若能用局部权限 → 风险分直接降低 40分

4. 架构优势判断:
   - 我们的轻量级 MV3 实现 vs 老牌插件的臃肿 MV3 移植版
   - 评分差距: 功能完整度 vs 权限占用

5. 风险评分 (0-100):
   - 基础风险 (1-10) × 10
   - MV3迁移难度 (0-10) × 15
   - 权限复杂度 (0-10) × 15
   - 若能用局部权限 → 总分扣减 40分
   - 若老牌巨头无法迁移 → 再扣 15分

6. 判决:
   - TARGET_ACQUIRED: 老牌巨头无法适配 MV3 + 我们能用局部权限实现 → 极高确定性机会
   - PROCEED: 技术可行，风险可控
   - REVIEW: 需要进一步技术验证
   - REJECT: MV3 无法实现该功能

【输出格式】(仅JSON，不要其他内容)
{
  "sidePanelFullyFeasible": "是或否或部分",
  "sidePanelVerdict": "该功能是否能完全利用 SidePanel API 的判定理由",
  "painSourceMv3Related": true或false,
  "giantCannotMigrate": true或false,
  "mv3Architecture": {
    "sidePanelFeasible": true或false,
    "offscreenFeasible": true或false,
    "localPermissionAchievable": true或false,
    "alternativeApproach": "替代实现方案描述"
  },
  "permissionBonus": 0-40,
  "giantBonus": 0-15,
  "total": 0-100,
  "verdict": "TARGET_ACQUIRED或PROCEED或REVIEW或REJECT",
  "reasoning": "架构师点评（100字内）"
}`;

    try {
      console.log('   [AI-2] Sending request to DeepSeek API...');
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
        temperature: 0.5,
        max_tokens: 800
      });
      console.log('   [AI-2] Received response from DeepSeek API');

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`   [AI-2] DeepSeek evaluation completed in ${elapsed}s`);
      return this.parseResponse(response.data.choices[0].message.content);
    } catch (error) {
      process.stderr.write(`   [AI-2] ❌ ${handleAxiosError(error, 'DeepSeek API 调用失败')}\n`);
      return this.getMock();
    }
  }

  private parseResponse(content: string): SherlockRiskScore {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON found');
      const data = JSON.parse(match[0]);
      return {
        total: Number(data.total) || 50,
        securityRedLine: Boolean(data.securityRedLine),
        infraRedLine: Boolean(data.infraRedLine),
        platformBanRisk: Number(data.platformBanRisk) || 5,
        techComplexity: Number(data.techComplexity) || 5,
        technicalDebt: Array.isArray(data.technicalDebt) ? data.technicalDebt : [],
        verdict: ['TARGET_ACQUIRED', 'PROCEED', 'REVIEW', 'REJECT'].includes(data.verdict)
          ? data.verdict : 'REVIEW',
        reasoning: String(data.reasoning || '')
      };
    } catch {
      return this.getMock();
    }
  }

  private getMock(): SherlockRiskScore {
    return {
      total: 20,
      securityRedLine: false,
      infraRedLine: false,
      platformBanRisk: 2,
      techComplexity: 4,
      technicalDebt: ['MV3 API 兼容性', 'Chrome Web Store 审核'],
      verdict: 'TARGET_ACQUIRED',
      reasoning: '老牌插件无法迁移MV3，我们用局部权限可实现，极低风险'
    };
  }
}

// ============================================================
// 第三阶段: 辩论闭环
// ============================================================
class DebateSystem {
  private async deepseekDebate(seo: SEOAnalysis): Promise<string> {
    console.log('      [Debate-1] DeepSeek counter-argument...');
    const startTime = Date.now();

    const prompt = `你扮演 DeepSeek，现在反驳豆包的观点：

【豆包的论点】
- 推荐定价: ${seo.pricingArbitrage} 套利
- 高转化潜力: ${seo.highConversionPotential}
- 一次性使用: ${seo.isOneTimeUse}

【你的任务 - 反驳】
1. 如果微软/Shopify 出官方功能，买断制能否持续盈利？
2. 技术债如何影响买断制的长期维护成本？
3. 谁是买断制的真正目标用户？

【输出】50字内的反驳观点`;

    try {
      const client = axios.create({
        baseURL: 'https://api.deepseek.com/v1',
        timeout: 30000,
        headers: { 'Authorization': `Bearer ${ENV.DEEPSEEK_API_KEY}` }
      });

      const response = await client.post('/chat/completions', {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`      [Debate-1] DeepSeek counter-argument completed in ${elapsed}s`);
      return String(response.data.choices[0].message.content).substring(0, 200);
    } catch (error) {
      process.stderr.write(`      [Debate-1] ❌ ${handleAxiosError(error, 'DeepSeek 辩论')}\n`);
      return 'DeepSeek: 买断制需快速迭代，否则会被官方功能替代。关键看用户粘性。';
    }
  }

  private async doubaoRebuttal(risk: SherlockRiskScore): Promise<string> {
    console.log('      [Debate-2] Doubao rebuttal...');
    const startTime = Date.now();

    const prompt = `你扮演豆包，现在回击 DeepSeek 的 CTO 观点：

【DeepSeek 的 CTO 担忧】
- 风险分: ${risk.total}/100
- 判决: ${risk.verdict}
- 技术债: ${risk.technicalDebt.join(', ')}

【你的任务 - 回击】
根据最新市场反馈，证明：
1. 用户痛点是否真实存在（评论数量和情绪）
2. 垂直场景的差异化能否抵御官方竞争
3. MVP 的快速验证价值

【输出】50字内的回击观点`;

    try {
      const client = axios.create({
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        timeout: 30000,
        headers: { 'Authorization': `Bearer ${ENV.DOUBAO_API_KEY}` }
      });

      const response = await client.post('', {
        model: 'ep-20260115140805-6nxf5',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`      [Debate-2] Doubao rebuttal completed in ${elapsed}s`);
      return String(response.data.choices[0].message.content).substring(0, 200);
    } catch (error) {
      process.stderr.write(`      [Debate-2] ❌ ${handleAxiosError(error, '豆包 辩论')}\n`);
      return '豆包: 用户已在评论区表达强烈痛点，垂直场景深耕可抵御官方竞争。';
    }
  }

  private determineConsensus(risk: SherlockRiskScore, seo: SEOAnalysis): 'GO' | 'HOLD' | 'ABORT' {
    if (risk.total > 70 || risk.verdict === 'REJECT') return 'ABORT';
    if (risk.total < 40 && seo.highConversionPotential) return 'GO';
    if (seo.highConversionPotential && risk.verdict === 'REVIEW') return 'HOLD';
    return 'HOLD';
  }

  async crossValidate(signal: PainSignal, seo: SEOAnalysis, risk: SherlockRiskScore): Promise<CrossValidation> {
    console.log(`\n⚔️ [Debate] 启动辩论闭环...`);

    const [deepseekDefense, doubaoOffense] = await Promise.all([
      this.deepseekDebate(seo),
      this.doubaoRebuttal(risk)
    ]);

    const consensus = this.determineConsensus(risk, seo);

    return {
      doubaoOffense,
      deepseekDefense,
      finalConsensus: consensus,
      debateSummary: `${doubaoOffense.substring(0, 50)}... vs ...${deepseekDefense.substring(0, 50)}`
    };
  }
}

// ============================================================
// 漏洞扫描器
// ============================================================
class VulnerabilityScanner {
  private keywords = [
    { word: 'overselling', type: 'overselling' as const },
    { word: 'slowed down my store', type: 'slowed_down' as const },
    { word: 'bulk update failed', type: 'bulk_update_failed' as const },
    { word: 'completely broken', type: 'other' as const },
    { word: 'waste of money', type: 'other' as const },
    { word: "doesn't work", type: 'other' as const }
  ];

  scanComments(apps: PainSignal[]): VulnerabilityPoint[] {
    console.log('\n🔬 [VulnScanner] 扫描漏洞信号...');

    const results: VulnerabilityPoint[] = [];

    for (const app of apps.filter(a => a.platform === 'Shopify')) {
      const foundKeywords: string[] = [];

      for (const { word } of this.keywords) {
        if (app.description.toLowerCase().includes(word)) {
          foundKeywords.push(word);
        }
        if (app.rawComments?.some(c => c.toLowerCase().includes(word))) {
          foundKeywords.push(word);
        }
      }

      if (foundKeywords.length > 0) {
        const uniqueKeywords = [...new Set(foundKeywords)];
        results.push({
          type: this.mapToType(uniqueKeywords),
          severity: this.calculateSeverity(uniqueKeywords),
          affectedApps: [app.title],
          exploitability: `发现关键词: ${uniqueKeywords.join(', ')}`
        });
      }
    }

    console.log(`✅ 发现 ${results.length} 个漏洞点`);
    return results;
  }

  private mapToType(keywords: string[]): VulnerabilityPoint['type'] {
    if (keywords.includes('overselling')) return 'overselling';
    if (keywords.includes('bulk update failed')) return 'bulk_update_failed';
    if (keywords.includes('slowed down my store')) return 'slowed_down';
    return 'other';
  }

  private calculateSeverity(keywords: string[]): VulnerabilityPoint['severity'] {
    const critical = ['overselling', 'waste of money'];
    const high = ['completely broken', "doesn't work"];
    const medium = ['slowed down my store', 'bulk update failed'];

    if (keywords.some(k => critical.includes(k))) return 'critical';
    if (keywords.some(k => high.includes(k))) return 'high';
    if (keywords.some(k => medium.includes(k))) return 'medium';
    return 'low';
  }
}

// ============================================================
// 定价策略生成器
// ============================================================
class PricingGenerator {
  static generate(seo: SEOAnalysis, risk: SherlockRiskScore): PricingStrategy {
    let recommended: PricingStrategy['recommended'] = 'subscription';

    if (seo.highConversionPotential && seo.isOneTimeUse) {
      recommended = 'lifetime';
    } else if (seo.pricingArbitrage === 'high') {
      recommended = 'freemium';
    }

    if (risk.total > 50) {
      recommended = 'hybrid';
    }

    const priceRanges: Record<PricingStrategy['recommended'], string> = {
      'lifetime': '$49-199 (买断) + $20 升级费',
      'subscription': '$9-29/月 或 $99-299/年',
      'freemium': '免费基础 + $19-49/高级功能',
      'hybrid': '$29 终身 + $9/月 维护费'
    };

    return {
      recommended,
      priceRange: priceRanges[recommended],
      arbitrageLogic: seo.pricingArbitrage === 'high'
        ? '竞品定价 $199/年，我们 $49 买断 = 高套利空间'
        : '中等套利，需精细化运营',
      conversionOptimistic: `${Math.round(seo.seoIntentVolume * 0.02)} 次转化/月`,
      conversionPessimistic: `${Math.round(seo.seoIntentVolume * 0.005)} 次转化/月`
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
      title: `[GOLDEN_OPPORTUNITY] ${opp.signal.platform} - ${opp.signal.title.substring(0, 50)}`,
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
| 用户情绪 | ${opp.signal.sentiment} |

---

### 🔬 Sherlock Risk Score
\`\`\`json
{
  "total": ${opp.riskScore.total}/100,
  "securityRedLine": ${opp.riskScore.securityRedLine ? '⚠️ 是' : '✅ 否'},
  "infraRedLine": ${opp.riskScore.infraRedLine ? '⚠️ 是' : '✅ 否'},
  "platformBanRisk": ${opp.riskScore.platformBanRisk}/10,
  "techComplexity": ${opp.riskScore.techComplexity}/10,
  "technicalDebt": ${JSON.stringify(opp.riskScore.technicalDebt)},
  "verdict": "${opp.riskScore.verdict}"
}
\`\`\`

---

### 💰 Pricing Strategy
| 字段 | 值 |
|------|-----|
| 推荐模式 | **${opp.pricing.recommended.toUpperCase()}** |
| 价格区间 | ${opp.pricing.priceRange} |
| 套利逻辑 | ${opp.pricing.arbitrageLogic} |
| 乐观转化 | ${opp.pricing.conversionOptimistic} |
| 悲观转化 | ${opp.pricing.conversionPessimistic} |

---

### ⚠️ Vulnerability Point
| 字段 | 值 |
|------|-----|
| 类型 | ${opp.vulnerability.type} |
| 严重度 | ${opp.vulnerability.severity.toUpperCase()} |
| 影响应用 | ${opp.vulnerability.affectedApps.join(', ')} |
| 可利用性 | ${opp.vulnerability.exploitability} |

---

### 🔍 SEO Analysis
- 意图关键词: ${opp.seoAnalysis.intentKeywords.join(', ')}
- 一次性使用: ${opp.seoAnalysis.isOneTimeUse ? '✅ 是' : '❌ 否'}
- 使用频率: ${opp.seoAnalysis.frequencyScore}/10
- 高转化潜力: ${opp.seoAnalysis.highConversionPotential ? '✅ 是' : '❌ 否'}

---

### ⚔️ 辩论闭环结论
- **最终共识**: ${opp.crossValidation.finalConsensus}
- **豆包进攻**: ${opp.crossValidation.doubaoOffense.substring(0, 100)}...
- **DeepSeek防御**: ${opp.crossValidation.deepseekDefense.substring(0, 100)}...

---

### 📋 痛点描述
${opp.signal.description}

---
*自动生成于 ${new Date().toISOString()}*`;
  }
}

// ============================================================
// 主程序: 商机猎人
// ============================================================
class OpportunityHunter {
  private fetchers = new Fetchers();
  private doubao = new DoubaoAgent();
  private deepseek = new DeepSeekAgent();
  private debate = new DebateSystem();
  private vulnScanner = new VulnerabilityScanner();
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
    console.log('🎯 OPPORTUNITY HUNTER - 三阶段决策系统 v2.1');
    console.log('='.repeat(60));
    console.log(`📅 ${new Date().toLocaleString('zh-CN')}\n`);

    try {
      // 阶段1: 数据采集
      console.log('\n📡 [STAGE 1] 开始数据采集...\n');
      const fetchStartTime = Date.now();
      const signals = await this.fetchers.runAll();
      const fetchElapsed = ((Date.now() - fetchStartTime) / 1000).toFixed(2);
      result.signalsCount = signals.length;
      console.log(`\n📡 [STAGE 1] 数据采集完成，耗时 ${fetchElapsed}s，获得 ${signals.length} 个信号`);

      if (signals.length === 0) {
        console.log('⚠️ 未发现信号，将使用模拟数据继续...');
      }

      // 确保至少有数据可处理
      const workingSignals = signals.length > 0 ? signals : this.getFallbackSignals();

      // 阶段2: 双模型分析
      console.log('\n🧠 [STAGE 2] 开始双模型分析...\n');
      const analysisStartTime = Date.now();
      const opportunities = await this.processSignals(workingSignals);
      const analysisElapsed = ((Date.now() - analysisStartTime) / 1000).toFixed(2);
      result.goldensCount = opportunities.length;
      console.log(`\n🧠 [STAGE 2] 双模型分析完成，耗时 ${analysisElapsed}s，分析 ${opportunities.length} 个机会`);

      // 筛选黄金机会
      const goldens = opportunities.filter(o => o.qualified);

      // 阶段3: 创建 Issues
      if (goldens.length > 0) {
        console.log('\n📝 [STAGE 3] 开始创建 GitHub Issues...\n');
        const issueStartTime = Date.now();
        for (const golden of goldens) {
          const created = await this.issueCreator.create(golden);
          if (created) result.issuesCreated++;
        }
        const issueElapsed = ((Date.now() - issueStartTime) / 1000).toFixed(2);
        console.log(`\n📝 [STAGE 3] Issues 创建完成，耗时 ${issueElapsed}s`);
      } else {
        console.log('\n📝 [STAGE 3] 跳过 Issue 创建（无达标机会）');
      }

      // 保存报告
      this.saveReport(goldens);

      // 存储机会数据供邮件发送使用
      this.setProcessedOpportunities(opportunities);

      // 发送邮件通知（独立 try-catch，不影响主流程）
      try {
        const totalElapsed = ((Date.now() - totalStartTime) / 1000).toFixed(2);
        await this.sendEmailReport(result, goldens, totalElapsed);
      } catch (emailError) {
        console.error(`   ⚠️ 邮件发送失败（不影响脚本退出）: ${emailError instanceof Error ? emailError.message : '未知错误'}`);
      }

    } catch (error) {
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : '未知错误');
      console.error(`\n❌ [ERROR] 扫描异常: ${error instanceof Error ? error.message : '未知错误'}`);
      if (error instanceof Error && error.stack) {
        console.error(`   Stack: ${error.stack}`);
      }
    }

    // 最终汇总（所有变量提供默认值）
    const totalElapsed = ((Date.now() - totalStartTime) / 1000).toFixed(2);
    console.log('\n' + '='.repeat(60));
    if (result.goldensCount > 0) {
      console.log('🎉 扫描完成 - 发现金矿!');
    } else {
      console.log('✅ Scan completed: No high-value opportunities found.');
    }
    console.log('='.repeat(60));
    console.log(`📊 总耗时: ${totalElapsed || '0'}s`);
    console.log(`📊 总信号: ${result.signalsCount || 0} | 达标: ${result.goldensCount || 0}`);
    console.log(`📊 Issues 创建: ${result.issuesCreated || 0}`);
    if (result.errors.length > 0) {
      console.log(`📊 错误数: ${result.errors.length}`);
    }
    console.log('='.repeat(60) + '\n');

    return result;
  }

  private async processSignals(signals: PainSignal[]): Promise<GoldenOpportunity[]> {
    const opportunities: GoldenOpportunity[] = [];

    for (const signal of signals) {
      try {
        console.log(`\n📊 分析: ${signal.title.substring(0, 40)}...`);

        // 豆包 + DeepSeek 并发
        const [seo, risk] = await Promise.all([
          this.doubao.analyze(signal),
          this.deepseek.evaluate(signal)
        ]);

        // 漏洞扫描
        const vulns = this.vulnScanner.scanComments([signal]);

        // 定价策略
        const pricing = PricingGenerator.generate(seo, risk);

        // 辩论闭环
        const crossValidation = await this.debate.crossValidate(signal, seo, risk);

        // 判断是否达标
        const qualified = risk.verdict !== 'REJECT' && crossValidation.finalConsensus !== 'ABORT';

        const opp: GoldenOpportunity = {
          id: crypto.randomUUID(),
          signal,
          seoAnalysis: seo,
          riskScore: risk,
          pricing,
          vulnerability: vulns[0] || { type: 'other', severity: 'low', affectedApps: [], exploitability: '无明显漏洞' },
          crossValidation,
          qualified
        };

        opportunities.push(opp);

        // 实时输出
        console.log(`   📈 SEO体量: ${seo.seoIntentVolume} | 高转化: ${seo.highConversionPotential ? '✅' : '❌'}`);
        console.log(`   🛡️ 风险分: ${risk.total}/100 | 判决: ${risk.verdict}`);
        console.log(`   💰 定价: ${pricing.recommended} | ${pricing.priceRange}`);
        console.log(`   ⚔️ 共识: ${crossValidation.finalConsensus} | 达标: ${qualified ? '🎯 YES' : '❌ NO'}`);

      } catch (error) {
        console.error(`   ⚠️ 分析失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    return opportunities;
  }

  private getFallbackSignals(): PainSignal[] {
    console.log('⚠️ 使用模拟数据进行测试...');
    return [{
      platform: 'Shopify',
      title: 'AI Product Description Generator Pro',
      description: 'Generate SEO-optimized product descriptions using AI. Users report: overselling claims.',
      url: 'https://apps.shopify.com/ai-pro',
      sentiment: 'negative',
      source: 'fallback',
      timestamp: new Date()
    }];
  }

  private saveReport(goldens: GoldenOpportunity[]): void {
    try {
      const outputDir = path.join(process.cwd(), 'reports');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const date = new Date().toISOString().split('T')[0];
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `golden-opportunities-${date}.json`;
      const filepath = path.join(outputDir, filename);

      const report = {
        generatedAt: new Date().toISOString(),
        summary: {
          totalSignals: this.countSignals(goldens),
          qualifiedCount: goldens.length,
          goCount: goldens.filter(o => o.crossValidation.finalConsensus === 'GO').length,
          holdCount: goldens.filter(o => o.crossValidation.finalConsensus === 'HOLD').length
        },
        opportunities: goldens
      };

      fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');
      console.log(`\n📄 报告已保存: ${filepath}`);
    } catch (error) {
      console.error(`   ⚠️ 报告保存失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private countSignals(goldens: GoldenOpportunity[]): number {
    return goldens.length;
  }

  /**
   * 发送邮件报告 - 只发送 GO 共识的机会
   */
  private async sendEmailReport(result: ScanResult, goldens: GoldenOpportunity[], elapsed: string): Promise<void> {
    // 只筛选 GO 共识的机会
    const goOpportunities = goldens.filter(o => o.crossValidation.finalConsensus === 'GO');
    
    try {
      await EmailService.sendReport(this.formatGoReport(goOpportunities));
    } catch (error) {
      console.error(`   📧 邮件发送失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  /**
   * 获取所有 GO 共识的机会
   */
  getGoOpportunities(): GoldenOpportunity[] {
    return this.lastProcessedOpportunities?.filter(o => o.crossValidation.finalConsensus === 'GO') || [];
  }

  /**
   * 格式化 GO 报告文本
   */
  formatGoReport(opportunities: GoldenOpportunity[]): string {
    if (opportunities.length === 0) {
      return '本次扫描未发现金矿机会。';
    }

    const lines: string[] = [
      '🚀 发现金矿！商机研报',
      '========================================',
      `扫描时间: ${new Date().toLocaleString('zh-CN')}`,
      `金矿数量: ${opportunities.length}`,
      '========================================',
      ''
    ];

    opportunities.forEach((opp, index) => {
      lines.push(`【机会 ${index + 1}】`);
      lines.push(`平台: ${opp.signal.platform}`);
      lines.push(`标题: ${opp.signal.title}`);
      lines.push(`链接: ${opp.signal.url}`);
      lines.push(`风险评分: ${opp.riskScore.total}/100`);
      lines.push(`定价策略: ${opp.pricing.recommended} - ${opp.pricing.priceRange}`);
      lines.push(`SEO意图量: ${opp.seoAnalysis.seoIntentVolume}`);
      lines.push(`转化潜力: ${opp.seoAnalysis.highConversionPotential ? '高' : '中低'}`);
      lines.push(`套利级别: ${opp.seoAnalysis.pricingArbitrage}`);
      lines.push(`意图关键词: ${opp.seoAnalysis.intentKeywords.join(', ')}`);
      lines.push(`CTO点评: ${opp.riskScore.reasoning}`);
      lines.push(`辩论结论: ${opp.crossValidation.finalConsensus}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    lines.push('========================================');
    lines.push('由 OpportunityScanner 自动生成');

    return lines.join('\n');
  }

  // 用于存储最近处理的机会
  private lastProcessedOpportunities: GoldenOpportunity[] = [];

  /**
   * 内部方法：存储处理结果供外部访问
   */
  setProcessedOpportunities(opportunities: GoldenOpportunity[]): void {
    this.lastProcessedOpportunities = opportunities;
  }
}

// ============================================================
// 执行入口 - 全局错误捕获
// ============================================================
async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('🚀 Opportunity Hunter 启动中...');
  console.log('========================================');

  // ========== 安全保险丝检查 ==========
  console.log('🛡️ 执行安全保险丝检查...');
  const memory = loadMemory();
  
  // 1. 运行间隔检查
  if (!checkRunInterval(memory)) {
    console.log('⏰ 安全退出: 运行间隔不足');
    process.exit(0);
  }
  
  // 2. API 预算预警（预估 10 次查询）
  checkApiBudget(memory, 10);

  try {
    console.log('⏳ 初始化 OpportunityHunter 实例...');
    const hunter = new OpportunityHunter();

    console.log('⏳ 开始运行扫描任务...');
    const result = await hunter.run();

    console.log('\n========================================');
    console.log('📋 扫描结果汇总:');
    console.log('========================================');
    console.log(`   成功: ${result.success ? '✅' : '❌'}`);
    console.log(`   信号数: ${result.signalsCount}`);
    console.log(`   金矿数: ${result.goldensCount}`);
    console.log(`   Issues 创建: ${result.issuesCreated}`);

    if (result.errors.length > 0) {
      console.log('\n   ⚠️ 错误列表:');
      result.errors.forEach((err, i) => console.log(`      ${i + 1}. ${err}`));
    }

    console.log('========================================');

    if (!result.success) {
      console.error('\n❌ 扫描未成功完成，退出码 1');
      // 更新 memory - 错误计数
      const updatedMemory = handleError(memory);
      saveMemory(updatedMemory);
      process.exit(1);
    }

    // 成功 - 更新 memory
    const successMemory = onSuccess(memory);
    successMemory.daily_api_calls += 10; // 预估实际使用量
    saveMemory(successMemory);

    console.log('\n✅ 扫描任务完成，退出码 0\n');
    process.exit(0);

  } catch (error) {
    console.error('\n========================================');
    console.error('❌ BUSINESS_LOGIC_ERROR - 未捕获的异常');
    console.error('========================================');
    console.error(`错误类型: ${error?.constructor?.name || 'Unknown'}`);
    console.error(`错误消息: ${error instanceof Error ? error.message : String(error)}`);
    console.error('\n完整堆栈:');
    console.error(error instanceof Error ? error.stack : String(error));
    console.error('========================================\n');
    console.error('请检查环境变量配置和网络连接。');
    console.error('如问题持续，请在 GitHub Issues 反馈。\n');
    
    // 更新 memory - 错误计数
    const errorMemory = handleError(memory);
    saveMemory(errorMemory);
    
    process.exit(1);
  }
}

// 捕获未处理的 Promise  rejections
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  console.error('\n========================================');
  console.error('❌ BUSINESS_LOGIC_ERROR: UNHANDLED PROMISE REJECTION');
  console.error('========================================');
  console.error(`原因: ${reason instanceof Error ? reason.message : String(reason)}`);
  if (reason instanceof Error && reason.stack) {
    console.error(`堆栈: ${reason.stack}`);
  }
  console.error('========================================\n');
  process.exit(1);
});

// 捕获未处理的异常
process.on('uncaughtException', (error: Error) => {
  console.error('\n========================================');
  console.error('❌ BUSINESS_LOGIC_ERROR: UNCAUGHT EXCEPTION');
  console.error('========================================');
  console.error(`错误: ${error.message}`);
  console.error(`堆栈: ${error.stack}`);
  console.error('========================================\n');
  process.exit(1);
});

// 信号处理
process.on('SIGINT', () => {
  console.log('\n\n⚠️ 接收到中断信号，正在优雅退出...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n⚠️ 接收到终止信号，正在优雅退出...');
  process.exit(0);
});

main();

export {
  OpportunityHunter,
  Fetchers,
  DoubaoAgent,
  DeepSeekAgent,
  DebateSystem,
  VulnerabilityScanner,
  GoldenOpportunity,
  validateEnvironment
};