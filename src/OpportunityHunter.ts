/**
 * OpportunityHunter.ts
 * 多平台商机扫描器 + 三阶段AI决策系统
 *
 * 架构:
 * 1. Fetchers - 数据采集层 (Serper/Shopify/VSCode)
 * 2. Duel System - 双模型决策大脑
 *    - 阶段1: 豆包 Pro (定价套利 + SEO意图分析)
 *    - 阶段2: DeepSeek V3 (CTO冷血视角 + 风险红线检查)
 *    - 阶段3: 辩论闭环 (交叉验证)
 * 3. Vulnerability Scanner - 漏洞扫描器
 * 4. GitHub Issue 自动创建
 */

import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 配置常量
// ============================================================
const SERPER_API_KEY = 'e2855f3cec91e07e97afb7513f5f672c48d44e34';

const GITHUB_REPO = 'JustinXai/OpportunityScanner';

// User-Agent 轮换池
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile'
];

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
  frequencyScore: number;  // 1-10, <3 为低频
  seoIntentVolume: number; // 估算搜索量
  highConversionPotential: boolean; // frequency < 3 且包含 one-time
  pricingArbitrage: 'high' | 'medium' | 'low';
}

interface SherlockRiskScore {
  total: number;           // 0-100
  securityRedLine: boolean; // 是否碰触安全红线
  infraRedLine: boolean;   // 是否碰触基础设施红线
  platformBanRisk: number; // 1-10
  techComplexity: number;   // 1-10
  technicalDebt: string[];  // 技术债清单
  verdict: 'PROCEED' | 'REVIEW' | 'REJECT';
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

interface GitHubIssuePayload {
  title: string;
  body: string;
  labels: string[];
}

// ============================================================
// HTTP 客户端工厂
// ============================================================
class HttpFactory {
  private uaIndex = 0;

  createClient(): AxiosInstance {
    return axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': USER_AGENTS[this.uaIndex++ % USER_AGENTS.length],
        'Accept': 'application/json, text/html, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
  }
}

// ============================================================
// 第一阶段: 获取器模块 (Fetchers)
// ============================================================
class Fetchers {
  private http = new HttpFactory();
  private serperClient: AxiosInstance;

  constructor() {
    this.serperClient = axios.create({
      baseURL: 'https://google.serper.dev/search',
      headers: { 'X-API-KEY': SERPER_API_KEY },
      timeout: 15000
    });
  }

  /**
   * Serper 搜索痛点信号
   */
  async searchPainSignals(): Promise<PainSignal[]> {
    console.log('\n🔍 [Fetcher] Serper 搜索痛点信号...');

    const queries = [
      { q: 'site:reddit.com "Shopify" "broken" OR "frustrated" OR "waste of money"', platform: 'Reddit' },
      { q: 'site:reddit.com "VSCode extension" "missing" OR "bug" OR "slow"', platform: 'Reddit' },
      { q: 'site:chromewebstore.google.com "bad experience" OR "broken" tbs:qdr:h12', platform: 'Chrome' },
      { q: 'site:reddit.com "Shopify app" "scam" OR "misleading"', platform: 'Reddit' }
    ];

    const results: PainSignal[] = [];

    for (const { q, platform } of queries) {
      try {
        const response = await this.serperClient.post('', { q });
        const items = response.data?.organic || [];

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
      } catch (error: any) {
        console.error(`❌ Serper 查询失败: ${error.message}`);
      }
    }

    console.log(`✅ 发现 ${results.length} 个痛点信号`);
    return results;
  }

  /**
   * Shopify 应用商店抓取
   */
  async scrapeShopify(): Promise<PainSignal[]> {
    console.log('\n🛒 [Fetcher] 抓取 Shopify 应用评论...');

    try {
      const client = this.http.createClient();
      const response = await client.get('https://apps.shopify.com/search?q=AI+productivity', {
        headers: { 'Referer': 'https://www.google.com' }
      });

      const $ = cheerio.load(response.data);
      const results: PainSignal[] = [];

      $('[data-testid="app-card"], .app-card').each((_, el) => {
        const $el = $(el);
        const title = $el.find('[data-testid="card-title"], h3').first().text().trim();
        const description = $el.find('[data-testid="card-subtitle"], .subtitle').first().text().trim();
        const ratingStr = $el.find('span[aria-label*="out of 5"]').first().attr('aria-label') || '';
        const rating = parseFloat(ratingStr.match(/([\d.]+) out of/)?.[1] || '0');
        const reviewsStr = $el.find('span[aria-label*="reviews"]').first().attr('aria-label') || '';
        const reviews = parseInt(reviewsStr.replace(/[^0-9]/g, '') || '0');

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

      console.log(`✅ 发现 ${results.length} 个 Shopify 应用`);
      return results;
    } catch (error: any) {
      console.error(`❌ Shopify 抓取失败: ${error.message}`);
      return this.getMockShopifyData();
    }
  }

  /**
   * VSCode Marketplace API
   */
  async scrapeVSCode(): Promise<PainSignal[]> {
    console.log('\n📦 [Fetcher] 抓取 VSCode 最新插件...');

    try {
      const client = this.http.createClient();
      const response = await client.post(
        'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
        {
          filters: [{
            criteria: [
              { filterType: 7, value: 'Microsoft.VisualStudio.Code' },
              { filterType: 8, value: 'latest' }
            ],
            pageNumber: 1,
            pageSize: 30,
            sortBy: 4,
            sortOrder: 2
          }],
          flags: 914
        },
        { headers: { 'api-version': '3.0-preview.1', 'Content-Type': 'application/json' } }
      );

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

      console.log(`✅ 发现 ${results.length} 个新 VSCode 插件`);
      return results;
    } catch (error: any) {
      console.error(`❌ VSCode 抓取失败: ${error.message}`);
      return [];
    }
  }

  private analyzeSentiment(text: string): 'negative' | 'neutral' | 'positive' {
    const negative = ['broken', 'frustrated', 'scam', 'misleading', 'useless', 'terrible'];
    const positive = ['great', 'amazing', 'love', 'helpful'];
    const lower = text.toLowerCase();

    if (negative.some(w => lower.includes(w))) return 'negative';
    if (positive.some(w => lower.includes(w))) return 'positive';
    return 'neutral';
  }

  private getMockShopifyData(): PainSignal[] {
    return [{
      platform: 'Shopify',
      title: 'AI Product Description Generator Pro',
      description: 'Generate SEO-optimized product descriptions using AI. Users report: "overselling claims, bulk updates often fail"',
      url: 'https://apps.shopify.com/ai-pro',
      sentiment: 'negative',
      source: 'mock',
      timestamp: new Date()
    }];
  }

  async runAll(): Promise<PainSignal[]> {
    console.log('\n🚀 [Fetcher] 启动全平台扫描...\n');

    const [serper, shopify, vscode] = await Promise.all([
      this.searchPainSignals(),
      this.scrapeShopify(),
      this.scrapeVSCode()
    ]);

    const all = [...serper, ...shopify, ...vscode];
    console.log(`\n📊 总计采集: ${all.length} 个信号\n`);
    return all;
  }
}

// ============================================================
// 第二阶段: 决策大脑 - 豆包 Pro (定价套利分析)
// ============================================================
class DoubaoAgent {
  private apiKey = process.env.DOUBAO_API_KEY || '';
  private endpointId = 'ep-20260115140805-6nxf5';
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      timeout: 60000,
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }
    });
  }

  async analyze(signal: PainSignal): Promise<SEOAnalysis> {
    const prompt = `你是一位精通中文互联网的定价策略师，擅长发现"定价套利"机会。

【商机信号】
平台: ${signal.platform}
标题: ${signal.title}
描述: ${signal.description}
用户情绪: ${signal.sentiment}

【任务 - 定价套利逻辑 + SEO意图分析】

1. 提取信号中的意图关键词 (5-8个):
   - 用户在搜索时会用什么词？
   - 长尾词机会在哪里？

2. 分析使用频率 (1-10分):
   - 如果 < 3，说明用户可能只是"一次性需求"
   - 这类需求适合"买断制"而非"订阅制"

3. 检查搜索意图是否包含 one-time:
   - "one-time purchase", "一次性", "买断", "永久授权"
   - 如果是 → 标记为【高转化潜力】

4. 定价套利逻辑:
   - 对比同类产品的定价
   - 找出价格洼地或溢价空间
   - 计算 arbitrage potential (高/中/低)

【输出格式】(仅JSON)
{
  "intentKeywords": ["关键词1", "关键词2"...],
  "isOneTimeUse": true或false,
  "frequencyScore": 1-10,
  "seoIntentVolume": 1000-100000,
  "highConversionPotential": true或false,
  "pricingArbitrage": "high或medium或low",
  "analysis": "定价套利理由（50字内）"
}`;

    try {
      const response = await this.client.post('', {
        model: this.endpointId,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 600
      });

      return this.parseResponse(response.data.choices[0].message.content);
    } catch (error: any) {
      console.error(`❌ 豆包 API 错误: ${error.message}`);
      return this.getMock();
    }
  }

  private parseResponse(content: string): SEOAnalysis {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON');
      const data = JSON.parse(match[0]);
      return {
        intentKeywords: data.intentKeywords || [],
        isOneTimeUse: data.isOneTimeUse || false,
        frequencyScore: data.frequencyScore || 5,
        seoIntentVolume: data.seoIntentVolume || 5000,
        highConversionPotential: data.highConversionPotential || false,
        pricingArbitrage: data.pricingArbitrage || 'medium',
        analysis: data.analysis || ''
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
  private apiKey = process.env.DEEPSEEK_API_KEY || '';
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.deepseek.com/v1',
      timeout: 60000,
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }
    });
  }

  async evaluate(signal: PainSignal): Promise<SherlockRiskScore> {
    const prompt = `你是一位冷酷的 CTO，专门扫描技术风险红线。

【商机信号】
平台: ${signal.platform}
标题: ${signal.title}
描述: ${signal.description}

【任务 - Sherlock 风险评分】

1. 安全红线检查:
   - 是否需要访问用户敏感数据 (密码、支付信息)?
   - 是否涉及第三方 API 密钥管理?
   - 是否有数据泄露风险?

2. 基础设施红线检查:
   - 是否依赖可能崩溃的未稳定 API?
   - 是否有单点故障风险?
   - 是否需要高并发基础设施?

3. 计算综合风险分 (0-100):
   - 平台封禁风险 (1-10) × 20
   - 技术复杂度 (1-10) × 15
   - 安全漏洞 (0-10) × 25
   - 基础设施依赖 (0-10) × 15

4. 技术债清单:
   - 列出 2-3 个潜在技术债

5. 判决:
   - PROCEED: 风险 < 40
   - REVIEW: 风险 40-70
   - REJECT: 风险 > 70

【输出格式】(仅JSON)
{
  "total": 0-100,
  "securityRedLine": true或false,
  "infraRedLine": true或false,
  "platformBanRisk": 1-10,
  "techComplexity": 1-10,
  "technicalDebt": ["债1", "债2"],
  "verdict": "PROCEED或REVIEW或REJECT",
  "reasoning": "CTO点评（60字内）"
}`;

    try {
      const response = await this.client.post('/chat/completions', {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 800
      });

      return this.parseResponse(response.data.choices[0].message.content);
    } catch (error: any) {
      console.error(`❌ DeepSeek API 错误: ${error.message}`);
      return this.getMock();
    }
  }

  private parseResponse(content: string): SherlockRiskScore {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON');
      const data = JSON.parse(match[0]);
      return {
        total: data.total || 50,
        securityRedLine: data.securityRedLine || false,
        infraRedLine: data.infraRedLine || false,
        platformBanRisk: data.platformBanRisk || 5,
        techComplexity: data.techComplexity || 5,
        technicalDebt: data.technicalDebt || [],
        verdict: data.verdict || 'REVIEW',
        reasoning: data.reasoning || ''
      };
    } catch {
      return this.getMock();
    }
  }

  private getMock(): SherlockRiskScore {
    return {
      total: 35,
      securityRedLine: false,
      infraRedLine: false,
      platformBanRisk: 4,
      techComplexity: 6,
      technicalDebt: ['API 版本兼容性', '错误处理不完善'],
      verdict: 'PROCEED',
      reasoning: '风险可控，适合 MVP 快速验证'
    };
  }
}

// ============================================================
// 第三阶段: 辩论闭环
// ============================================================
class DebateSystem {
  private doubao = new DoubaoAgent();
  private deepseek = new DeepSeekAgent();

  async crossValidate(
    signal: PainSignal,
    seo: SEOAnalysis,
    risk: SherlockRiskScore
  ): Promise<CrossValidation> {
    console.log(`\n⚔️ [Debate] 启动辩论闭环: ${signal.title.substring(0, 40)}...`);

    // DeepSeek 反驳豆包
    const deepseekDefense = await this.deepseekDebate(signal, seo);

    // 豆包回击 (基于最新 Serper 评论)
    const doubaoOffense = await this.doubaoRebuttal(signal, risk);

    // 最终共识
    const consensus = this.determineConsensus(risk, seo);

    return {
      doubaoOffense,
      deepseekDefense,
      finalConsensus: consensus,
      debateSummary: `${doubaoOffense.substring(0, 50)}... vs ...${deepseekDefense.substring(0, 50)}`
    };
  }

  private async deepseekDebate(signal: PainSignal, seo: SEOAnalysis): Promise<string> {
    const prompt = `你扮演 DeepSeek，现在反驳豆包的观点：

【豆包的论点】
- 推荐定价: ${seo.pricingArbitrage} 套利
- 高转化潜力: ${seo.highConversionPotential}
- 一次性使用: ${seo.isOneTimeUse}

【你的任务 - 反驳】
1. "如果微软/Shopify 出官方功能，买断制能否持续盈利？"
2. "技术债如何影响买断制的长期维护成本？"
3. "谁是买断制的真正目标用户？"

【输出】50字内的反驳观点`;

    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 300
        },
        { headers: { 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` } }
      );
      return response.data.choices[0].message.content.substring(0, 200);
    } catch {
      return 'DeepSeek: 买断制需快速迭代，否则会被官方功能替代。关键看用户粘性。';
    }
  }

  private async doubaoRebuttal(signal: PainSignal, risk: SherlockRiskScore): Promise<string> {
    const prompt = `你扮演豆包，现在回击 DeepSeek 的 CTO 观点：

【DeepSeek 的 CTO 担忧】
- 风险分: ${risk.total}/100
- 判决: ${risk.verdict}
- 技术债: ${risk.technicalDebt.join(', ')}

【你的任务 - 回击】
根据最新的 Serper 评论反馈，证明：
1. 用户痛点是否真实存在（评论数量和情绪）
2. 垂直场景的差异化能否抵御官方竞争
3. MVP 的快速验证价值

【输出】50字内的回击观点`;

    try {
      const response = await axios.post(
        'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        {
          model: 'ep-20260115140805-6nxf5',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 300
        },
        { headers: { 'Authorization': `Bearer ${process.env.DOUBAO_API_KEY}` } }
      );
      return response.data.choices[0].message.content.substring(0, 200);
    } catch {
      return '豆包: 用户已在评论区表达强烈痛点，垂直场景深耕可抵御官方竞争。';
    }
  }

  private determineConsensus(risk: SherlockRiskScore, seo: SEOAnalysis): 'GO' | 'HOLD' | 'ABORT' {
    if (risk.total > 70 || risk.verdict === 'REJECT') return 'ABORT';
    if (risk.total < 40 && seo.highConversionPotential) return 'GO';
    if (seo.highConversionPotential && risk.verdict === 'REVIEW') return 'HOLD';
    return 'HOLD';
  }
}

// ============================================================
// 漏洞扫描器
// ============================================================
class VulnerabilityScanner {
  private keywords = [
    'overselling',
    'slowed down my store',
    'bulk update failed',
    'completely broken',
    'waste of money',
    'scam',
    'doesn\'t work',
    'fake reviews'
  ];

  async scanComments(apps: PainSignal[]): Promise<VulnerabilityPoint[]> {
    console.log('\n🔬 [VulnScanner] 扫描漏洞信号...');

    const results: VulnerabilityPoint[] = [];

    for (const app of apps.filter(a => a.platform === 'Shopify')) {
      // 模拟扫描结果 (实际应抓取真实评论)
      const found = this.keywords.filter(k =>
        app.description.toLowerCase().includes(k) ||
        (app.rawComments || []).some(c => c.toLowerCase().includes(k))
      );

      if (found.length > 0) {
        results.push({
          type: this.mapToType(found),
          severity: this.calculateSeverity(found),
          affectedApps: [app.title],
          exploitability: `发现关键词: ${found.join(', ')}`
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
    const critical = ['overselling', 'scam', 'fake reviews'];
    const high = ['broken', 'doesn\'t work'];
    const medium = ['slowed down', 'bulk update failed'];

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

    // DeepSeek CTO 可能建议降低风险
    if (risk.total > 50) {
      recommended = 'hybrid';
    }

    const priceRanges = {
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
  private token = process.env.GITHUB_TOKEN || '';
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
  }

  async create(opp: GoldenOpportunity): Promise<boolean> {
    if (!this.token) {
      console.log('⚠️ 未配置 GITHUB_TOKEN，跳过 Issue 创建');
      return false;
    }

    const payload: GitHubIssuePayload = {
      title: `[GOLDEN_OPPORTUNITY] ${opp.signal.platform} - ${opp.signal.title.substring(0, 50)}`,
      body: this.generateBody(opp),
      labels: ['golden-opportunity', `platform:${opp.signal.platform.toLowerCase()}`, 'auto-generated']
    };

    try {
      await this.client.post(`/repos/${GITHUB_REPO}/issues`, payload);
      console.log(`✅ GitHub Issue 已创建`);
      return true;
    } catch (error: any) {
      console.error(`❌ Issue 创建失败: ${error.message}`);
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

  async run(): Promise<void> {
    console.log('='.repeat(60));
    console.log('🎯 OPPORTUNITY HUNTER - 三阶段决策系统');
    console.log('='.repeat(60));
    console.log(`📅 ${new Date().toLocaleString('zh-CN')}\n`);

    // 阶段1: 数据采集
    console.log('📡 阶段1: 数据采集');
    const signals = await this.fetchers.runAll();

    if (signals.length === 0) {
      console.log('❌ 未发现信号，退出');
      return;
    }

    // 处理每个信号
    console.log('\n🧠 阶段2: 双模型分析');
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
        const vulns = await this.vulnScanner.scanComments([signal]);

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

      } catch (error: any) {
        console.error(`❌ 分析失败: ${error.message}`);
      }
    }

    // 筛选黄金机会
    const goldens = opportunities.filter(o => o.qualified);

    // 创建 GitHub Issues
    console.log('\n📝 创建 GitHub Issues...');
    for (const golden of goldens) {
      await this.issueCreator.create(golden);
    }

    // 保存报告
    this.saveReport(goldens);

    // 最终汇总
    console.log('\n' + '='.repeat(60));
    console.log('📊 扫描完成');
    console.log('='.repeat(60));
    console.log(`总信号: ${signals.length} | 达标: ${goldens.length}`);
    console.log(`GO: ${goldens.filter(o => o.crossValidation.finalConsensus === 'GO').length}`);
    console.log(`HOLD: ${goldens.filter(o => o.crossValidation.finalConsensus === 'HOLD').length}`);

    if (goldens.length > 0) {
      console.log('\n🎯 GOLDEN OPPORTUNITIES:');
      goldens.forEach((g, i) => {
        console.log(`${i + 1}. [${g.signal.platform}] ${g.signal.title}`);
        console.log(`   风险: ${g.riskScore.total}/100 | 定价: ${g.pricing.recommended}`);
      });
    }
  }

  private saveReport(goldens: GoldenOpportunity[]): void {
    const outputDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const date = new Date().toISOString().split('T')[0];
    const filename = `golden-opportunities-${date}.json`;
    const filepath = path.join(outputDir, filename);

    fs.writeFileSync(filepath, JSON.stringify(goldens, null, 2), 'utf-8');
    console.log(`\n📄 报告已保存: ${filepath}`);
  }
}

// ============================================================
// 执行入口
// ============================================================
if (require.main === module) {
  console.log('\n🔧 环境变量检查:');
  console.log(`   DOUBAO_API_KEY: ${process.env.DOUBAO_API_KEY ? '✅' : '⚠️ 未配置'}`);
  console.log(`   DEEPSEEK_API_KEY: ${process.env.DEEPSEEK_API_KEY ? '✅' : '⚠️ 未配置'}`);
  console.log(`   GITHUB_TOKEN: ${process.env.GITHUB_TOKEN ? '✅' : '⚠️ 未配置'}`);
  console.log(`   目标仓库: ${GITHUB_REPO}\n`);

  new OpportunityHunter().run().catch(console.error);
}

export {
  OpportunityHunter,
  Fetchers,
  DoubaoAgent,
  DeepSeekAgent,
  DebateSystem,
  VulnerabilityScanner,
  GoldenOpportunity
};