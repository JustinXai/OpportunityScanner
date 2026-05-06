// src/fetchers/chromeZombieFetcher.ts
// Chrome 僵尸插件套利数据采集器
//
// 使用 Tinyfish AI Agent API 自动发现 Chrome Web Store 中的"僵尸插件"
//
// 僵尸插件定义：
// - 安装量 > 10,000 用户
// - 最后更新早于 2025年1月1日（停更超过1年半）
// - 近期差评激增（"not working", "broken", "needs fix" 等）
//
// API 限制：
// - 搜索 API：每分钟 5 次
// - 抓取 API：每分钟 25 次
// - 所有网络错误必须捕获，不影响主流程
//
// Tinyfish API 文档：
// Endpoint: https://agent.tinyfish.ai/v1/automation/run-sse
// 认证: X-API-Key

import axios, { AxiosInstance } from 'axios';

// ============================================================
// 类型定义
// ============================================================

export interface ExtensionBasic {
  id: string;
  name: string;
  storeUrl: string;
  installCount: number;
  lastUpdated?: Date;
  rating?: number;
}

export interface ExtensionDetail {
  id: string;
  name: string;
  storeUrl: string;
  description: string;
  author: string;
  installCount: number;
  rating: number;
  ratingCount: number;
  lastUpdated: Date;
  version: string;
  usersText: string;
  category?: string;
}

export interface Review {
  author: string;
  rating: number;
  date: Date;
  content: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  isStale: boolean;
}

export interface ZombieTarget {
  id: string;
  name: string;
  storeUrl: string;
  installCount: number;
  lastUpdated: Date;
  rating: number;
  ratingCount: number;
  version: string;
  recentNegativeReviews: Review[];
  summary: string;
  searchQuery: string;
  discoveredAt: Date;
}

// ============================================================
// API 配置
// ============================================================

export interface ZombieFetcherConfig {
  /** Tinyfish API Key */
  tinyfishApiKey: string;
  /** 并发限制（搜索阶段建议1，抓取阶段建议2） */
  concurrency?: number;
  /** 搜索 API 请求间隔 (ms)，每分钟5次限制 -> 12秒间隔 */
  searchInterval?: number;
  /** 抓取 API 请求间隔 (ms)，每分钟25次限制 -> 2.4秒间隔，实际用3秒 */
  fetchInterval?: number;
  /** 最大目标数量 */
  maxTargets?: number;
  /** 最小安装量阈值 */
  minInstalls?: number;
  /** 停更阈值（早于此日期视为僵尸），默认 2025-01-01 */
  staleThreshold?: Date;
  /** 是否包含模拟数据（API Key 未配置时） */
  useMockData?: boolean;
  /** 日志函数 */
  logger?: (msg: string) => void;
}

interface DefaultConfig {
  concurrency: number;
  searchInterval: number;
  fetchInterval: number;
  maxTargets: number;
  minInstalls: number;
  staleThreshold: Date;
  useMockData: boolean;
  logger: (msg: string) => void;
}

const DEFAULT_CONFIG: DefaultConfig = {
  concurrency: 2,
  searchInterval: 13000,
  fetchInterval: 3000,
  maxTargets: 5,
  minInstalls: 10000,
  staleThreshold: new Date('2025-01-01'),
  useMockData: false,
  logger: console.log
};

// ============================================================
// 差评关键词
// ============================================================

const NEGATIVE_PATTERNS = [
  /\b(not working|doesn't work|does not work|won't work|won't load)\b/i,
  /\b(broken|stopped working|stop working|broken by update)\b/i,
  /\b(useless|incomplete|unfixed|still broken|never fixed)\b/i,
  /\b(please fix|needs update|needs to be updated|out of date)\b/i,
  /\b(bad|terrible|worst|scam|fraud|disappointed)\b/i,
  /\b(dead|abandoned|abandonware|no longer|deprecated)\b/i
];

// ============================================================
// 主采集器
// ============================================================

export class ChromeZombieFetcher {
  private config: DefaultConfig;
  private http: AxiosInstance;
  private apiKey: string;
  private searchHistory: Date[] = [];
  private fetchHistory: Date[] = [];

  constructor(config: ZombieFetcherConfig) {
    if (!config.tinyfishApiKey) {
      throw new Error('Tinyfish API Key is required');
    }

    this.apiKey = config.tinyfishApiKey;

    this.config = {
      concurrency: config.concurrency ?? DEFAULT_CONFIG.concurrency,
      searchInterval: config.searchInterval ?? DEFAULT_CONFIG.searchInterval,
      fetchInterval: config.fetchInterval ?? DEFAULT_CONFIG.fetchInterval,
      maxTargets: config.maxTargets ?? DEFAULT_CONFIG.maxTargets,
      minInstalls: config.minInstalls ?? DEFAULT_CONFIG.minInstalls,
      staleThreshold: config.staleThreshold ?? DEFAULT_CONFIG.staleThreshold,
      useMockData: config.useMockData ?? DEFAULT_CONFIG.useMockData,
      logger: config.logger ?? DEFAULT_CONFIG.logger
    };

    this.http = axios.create({
      timeout: 60000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.config.logger(`[ZombieFetcher] 初始化完成，配置:`);
    this.config.logger(`  - 搜索间隔: ${this.config.searchInterval}ms`);
    this.config.logger(`  - 抓取间隔: ${this.config.fetchInterval}ms`);
    this.config.logger(`  - 停更阈值: ${this.config.staleThreshold.toISOString()}`);
  }

  /**
   * 主入口：发现僵尸插件
   */
  async fetchAll(): Promise<ZombieTarget[]> {
    this.config.logger('[ZombieFetcher] ========== 开始僵尸插件发现流程 ==========');

    // 如果配置了使用模拟数据，直接返回
    if (this.config.useMockData) {
      this.config.logger('[ZombieFetcher] 模式: 模拟数据');
      return this.getMockData();
    }

    try {
      // 阶段1: 用 Tinyfish Agent 搜索僵尸插件线索
      const candidates = await this.searchZombieExtensions();

      if (candidates.length === 0) {
        this.config.logger('[ZombieFetcher] 未发现候选插件');
        return [];
      }

      this.config.logger(`[ZombieFetcher] 阶段1完成: 发现 ${candidates.length} 个候选插件`);

      // 阶段2: 获取每个候选插件的详细信息
      const targets = await this.fetchExtensionDetails(candidates);

      // 阶段3: 过滤出真正的僵尸插件
      const zombies = this.filterZombies(targets);

      this.config.logger(`[ZombieFetcher] ========== 完成: 发现 ${zombies.length} 个僵尸插件 ==========`);

      return zombies;
    } catch (err) {
      this.config.logger(`[ZombieFetcher] 采集过程出错: ${err}`);
      return [];
    }
  }

  // ============================================================
  // 阶段1: Tinyfish Agent 搜索僵尸插件
  // ============================================================

  private async searchZombieExtensions(): Promise<ExtensionBasic[]> {
    this.config.logger('[ZombieFetcher] 阶段1: Tinyfish Agent 搜索僵尸插件...');

    // 搜索关键词列表（针对不同领域的僵尸插件）
    const searchQueries = [
      'instagram video controls',
      'chrome extension "not working" "broken"',
      'ad blocker "broken" "not working" 2025',
      'productivity chrome extension abandoned',
      'developer tools chrome extension "not working"'
    ];

    const candidates: ExtensionBasic[] = [];

    for (const query of searchQueries) {
      try {
        const result = await this.callTinyfishAgent(query, 'search');
        const parsed = this.parseSearchResult(result, query);

        this.config.logger(`[ZombieFetcher] [${query}] -> ${parsed.length} 个候选`);
        candidates.push(...parsed);

        // 尊重速率限制
        await this.waitForSearchRateLimit();
      } catch (err) {
        this.config.logger(`[ZombieFetcher] 搜索失败 [${query}]: ${err}`);
      }
    }

    return candidates;
  }

  /**
   * 调用 Tinyfish Agent API
   */
  private async callTinyfishAgent(query: string, type: 'search' | 'fetch'): Promise<string> {
    const endpoint = 'https://agent.tinyfish.ai/v1/automation/run-sse';

    // API 必填字段：url 和 goal
    const url = type === 'search'
      ? 'https://chromewebstore.google.com/'
      : query; // 抓取时 query 就是目标 URL

    const goal = type === 'search'
      ? this.buildSearchPrompt(query)
      : this.buildFetchPrompt();

    this.config.logger(`[ZombieFetcher] [Tinyfish] ${type} -> ${query.substring(0, 40)}...`);

    try {
      const response = await this.http.post(
        endpoint,
        {
          url,
          goal,
          browser_profile: 'lite',
          api_integration: 'opportunity-scanner',
          agent_config: {
            mode: 'default',
            max_steps: 50
          }
        },
        {
          timeout: 180000,
          responseType: 'stream', // SSE 需要流式处理
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );

      // SSE 流式响应处理
      return await this.parseSseStream(response.data);
    } catch (err: any) {
      const status = err.response?.status;
      const errorData = err.response?.data?.error;
      const msg = errorData?.message || err.message;
      const code = errorData?.code;

      if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
        this.config.logger(`[ZombieFetcher] 速率限制，等待后重试...`);
        await this.sleep(60000);
        throw new Error('RATE_LIMIT');
      }

      if (status === 401 || status === 403 || code === 'INVALID_API_KEY' || code === 'UNAUTHORIZED') {
        this.config.logger(`[ZombieFetcher] API Key 无效或已过期`);
        throw new Error('AUTH_FAILED');
      }

      if (code === 'INSUFFICIENT_CREDITS') {
        this.config.logger(`[ZombieFetcher] API 余额不足`);
        throw new Error('INSUFFICIENT_CREDITS');
      }

      this.config.logger(`[ZombieFetcher] API 调用失败 (${status}): ${msg}`);
      throw err;
    }
  }

  /**
   * 解析 SSE 流
   */
  private parseSseStream(stream: AsyncIterable<Buffer | string>): Promise<string> {
    return new Promise((resolve, reject) => {
      let accumulatedData = '';
      let completeEvent: any = null;
      let tfApiResults: any[] = [];

      const processEvent = (event: any) => {
        if (event.type === 'COMPLETE') {
          completeEvent = event;
        } else if (event.type === 'TF_API_RESULT') {
          // 收集 API 搜索/抓取结果
          if (event.result) {
            if (Array.isArray(event.result)) {
              tfApiResults.push(...event.result);
            } else {
              tfApiResults.push(event.result);
            }
          }
        } else if (event.type === 'PROGRESS') {
          this.config.logger(`[ZombieFetcher] 进度: ${event.purpose || '处理中...'}`);
        }
        // HEARTBEAT 忽略
      };

      const finish = () => {
        // 优先使用 TF_API_RESULT
        if (tfApiResults.length > 0) {
          resolve(JSON.stringify(tfApiResults));
          return;
        }

        // 其次使用 COMPLETE 事件
        if (completeEvent?.result) {
          if (typeof completeEvent.result === 'string') {
            resolve(completeEvent.result);
          } else {
            resolve(JSON.stringify(completeEvent.result));
          }
          return;
        }

        // 使用累积的原始数据
        if (accumulatedData.trim()) {
          resolve(accumulatedData.trim());
          return;
        }

        this.config.logger(`[ZombieFetcher] 未收到有效结果`);
        resolve('');
      };

      // 处理流数据
      (async () => {
        try {
          for await (const chunk of stream) {
            const text = chunk.toString();
            accumulatedData += text;

            // 解析 SSE 事件
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                try {
                  const event = JSON.parse(jsonStr);
                  processEvent(event);
                } catch (e) {
                  // 非 JSON 数据，忽略
                }
              }
            }

            // 检查是否收到 COMPLETE 事件
            if (completeEvent?.status === 'COMPLETED') {
              finish();
              return;
            }
          }

          // 流结束
          finish();
        } catch (err) {
          reject(err);
        }
      })();
    });
  }

  /**
   * 解析 SSE 响应（回退方法，用于非流式响应）
   */
  private parseSseResponse(data: any): string {
    // 如果是已完成的事件流，找 COMPLETE 事件
    if (data?.type === 'COMPLETE') {
      const result = data.result;
      if (typeof result === 'string') return result;
      if (typeof result === 'object') return JSON.stringify(result);
    }

    // 如果是 TF_API_RESULT 事件
    if (data?.type === 'TF_API_RESULT') {
      const result = data.result;
      if (Array.isArray(result)) return JSON.stringify(result);
      if (typeof result === 'string') return result;
      return JSON.stringify(result);
    }

    // 回退：直接返回 data
    if (typeof data === 'string') return data;
    if (typeof data === 'object') {
      // 尝试各种可能的结果字段
      return data.output
        || data.result
        || data.text
        || data.content
        || data.response
        || data.message
        || JSON.stringify(data);
    }

    return String(data);
  }

  /**
   * 搜索提示词（Search Prompt）
   */
  private buildSearchPrompt(keyword: string): string {
    return `在 https://chromewebstore.google.com/ 上，搜索关键词 "${keyword}"。

在搜索结果中，找出那些用户数显示超过 10,000（比如 "100,000 users"）的插件，然后逐一检查这些插件的详情页，重点关注两点：
1. 检查它们的"最后更新日期"(Updated)，如果早于 2025年1月1日（比如 "February 23, 2023" 这样格式），说明作者已经弃坑。
2. 检查它们的"用户评论"(Reviews)，如果在最近1个月内，出现大量 "not working", "broken", "needs immediate fix" 这类词，就说明用户急需解决方案。

请最终输出2个最符合条件的、评价最差的插件，列出：
- 它们的名字
- 确切用户数（格式如 "100,000 users"）
- "最后更新日期"（格式如 "February 23, 2023"）
- 以及至少3条最有代表性的负面评论原文

输出格式（JSON数组）：
[
  {
    "name": "插件完整名称",
    "storeUrl": "https://chromewebstore.google.com/detail/xxx/插件ID",
    "installCount": 100000,
    "lastUpdated": "February 23, 2023",
    "negativeReviews": ["负面评论1", "负面评论2", "负面评论3"]
  }
]

如果没有找到符合条件的插件，返回空数组 []。`;
  }

  /**
   * 内容抓取提示词（Fetch Prompt）
   */
  private buildFetchPrompt(): string {
    return `请抓取当前页面（Chrome Web Store 插件详情页）的详细信息：
1. 确切的用户数（格式如 "100,000 users"）
2. "Updated" 字段的具体日期
3. "Additional Information" 区域中 "Version" 项显示的具体版本号
4. "Rating" 和评分人数

输出格式（JSON）：
{
  "name": "插件名称",
  "installCount": 100000,
  "lastUpdated": "具体日期",
  "version": "版本号",
  "rating": 3.5,
  "ratingCount": 1234
}`;
  }

  /**
   * 解析 Tinyfish Agent 搜索结果
   */
  private parseSearchResult(raw: string, query: string): ExtensionBasic[] {
    if (!raw || raw.trim().length === 0) {
      this.config.logger(`[ZombieFetcher] 搜索结果为空`);
      return [];
    }

    const trimmed = raw.trim();
    let parsed: any[] | null = null;

    // 策略1: 尝试直接解析整个字符串
    try {
      const parsed1 = JSON.parse(trimmed);
      if (Array.isArray(parsed1)) {
        parsed = parsed1;
      } else if (typeof parsed1 === 'object' && parsed1 !== null) {
        // 可能结果在某个字段中
        const candidates = parsed1.result || parsed1.data || parsed1.output || parsed1.items || parsed1.extensions;
        if (Array.isArray(candidates)) {
          parsed = candidates;
        }
      }
    } catch (e) { /* 继续其他策略 */ }

    // 策略2: 提取 [...] JSON 数组
    if (!parsed) {
      const match = trimmed.match(/\[[\s\S]*?\]/);
      if (match) {
        try {
          const arr = JSON.parse(match[0]);
          if (Array.isArray(arr)) parsed = arr;
        } catch (e) { /* 尝试修复 */ }
      }
    }

    // 策略3: 智能修复不完整 JSON
    if (!parsed) {
      parsed = this.tryFixIncompleteJson(trimmed);
    }

    // 策略4: 提取多个独立 JSON 对象
    if (!parsed || parsed.length === 0) {
      parsed = this.extractJsonObjects(trimmed);
    }

    if (parsed && parsed.length > 0) {
      const results = this.mapSearchResults(parsed);
      if (results.length > 0) {
        this.config.logger(`[ZombieFetcher] 解析到 ${results.length} 个插件`);
        return results;
      }
    }

    this.config.logger(`[ZombieFetcher] 无法解析搜索结果`);
    return [];
  }

  /**
   * 智能修复不完整的 JSON
   */
  private tryFixIncompleteJson(text: string): any[] | null {
    // 尝试找到完整的 JSON 数组
    const lastBracket = text.lastIndexOf('[');
    const lastBrace = text.lastIndexOf('{');

    if (lastBracket < 0 || lastBrace < 0) return null;

    // 从 [ 截取到最后一个 }
    if (lastBracket < lastBrace) {
      const candidate = text.substring(lastBracket);
      try {
        const arr = JSON.parse(candidate);
        if (Array.isArray(arr)) return arr;
      } catch (e) {
        // 尝试去掉末尾多余字符
        const trimmed = candidate.replace(/[,\s]+$/, '');
        try {
          const arr = JSON.parse(trimmed);
          if (Array.isArray(arr)) return arr;
        } catch (e2) { /* 继续 */ }
      }
    }

    return null;
  }

  /**
   * 从文本中提取所有有效的 JSON 对象
   */
  private extractJsonObjects(text: string): any[] {
    const results: any[] = [];
    // 匹配完整的 JSON 对象（支持嵌套）
    const regex = /\{(?:[^{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*\}/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      try {
        const obj = JSON.parse(match[0]);
        if (this.isValidExtension(obj)) {
          results.push(obj);
        }
      } catch (e) { /* 不是有效 JSON */ }
    }

    return results;
  }

  /**
   * 检查是否是有效的插件对象
   */
  private isValidExtension(obj: any): boolean {
    if (typeof obj !== 'object' || obj === null) return false;
    return !!(obj.name || obj.extensionName || obj.title);
  }

  /**
   * 映射搜索结果数组
   */
  private mapSearchResults(arr: any[]): ExtensionBasic[] {
    return arr
      .filter((item: any) => item && this.isValidExtension(item))
      .map((item: any) => ({
        id: this.extractExtId(item.storeUrl || item.url || item.link || ''),
        name: item.name || item.extensionName || item.title || 'Unknown',
        storeUrl: item.storeUrl || item.url || item.link || '',
        installCount: this.parseInstallCount(
          item.installCount || item.users || item.userCount ||
          item.installs || item.downloads || item.count || '0'
        ),
        lastUpdated: this.parseDate(
          item.lastUpdated || item.updatedAt || item.updated ||
          item.lastUpdate || item.date || ''
        ),
        rating: item.rating ? parseFloat(item.rating) : undefined
      }))
      .filter(ext => ext.installCount > 0 || ext.name !== 'Unknown'); // 过滤无效结果
  }

  /**
   * 正则回退：从纯文本中提取插件信息
   */
  private parseSearchResultFallback(raw: string, query: string): ExtensionBasic[] {
    const results: ExtensionBasic[] = [];

    // 提取 URL
    const urlMatches = raw.match(/https:\/\/chromewebstore\.google\.com\/detail\/[^\s\)\]"']+/gi);
    if (!urlMatches) return results;

    for (const url of urlMatches.slice(0, 5)) {
      const id = this.extractExtId(url);
      const name = this.extractNameFromUrl(url) || `Extension ${id}`;

      // 尝试在周围文本中提取安装量
      const urlContext = raw;
      const installMatch = urlContext.match(new RegExp(`(${this.escapeRegex(id)}[\\s\\S]{0,200}?(\\d[\\d,]+(?:\\s*(?:million|thousand|m|k)\\s*users?))`, 'i'));
      const installCount = installMatch
        ? this.parseInstallCount(installMatch[2] || '0')
        : 0;

      // 尝试提取更新日期
      const dateMatch = urlContext.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s+\d{4}/gi);
      const lastUpdated = dateMatch ? this.parseDate(dateMatch[0]) : undefined;

      results.push({
        id,
        name,
        storeUrl: url,
        installCount,
        lastUpdated,
        rating: undefined
      });
    }

    return results;
  }

  // ============================================================
  // 阶段2: 获取插件详情
  // ============================================================

  private async fetchExtensionDetails(candidates: ExtensionBasic[]): Promise<ExtensionDetail[]> {
    this.config.logger(`[ZombieFetcher] 阶段2: 获取 ${candidates.length} 个插件详情...`);

    const details: ExtensionDetail[] = [];
    const batchSize = this.config.concurrency;

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);

      try {
        const results = await Promise.all(
          batch.map(c => this.fetchExtensionDetail(c))
        );

        for (const detail of results) {
          if (detail) {
            details.push(detail);
          }
        }

        this.config.logger(`[ZombieFetcher] 批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(candidates.length / batchSize)} 完成`);

        // 尊重速率限制
        if (i + batchSize < candidates.length) {
          await this.sleep(this.config.fetchInterval);
        }
      } catch (err) {
        this.config.logger(`[ZombieFetcher] 批次失败: ${err}`);
      }
    }

    return details;
  }

  private async fetchExtensionDetail(candidate: ExtensionBasic): Promise<ExtensionDetail | null> {
    try {
      // 优先用 Tinyfish Agent 抓取详情
      const result = await this.callTinyfishAgent(candidate.storeUrl, 'fetch');
      return this.parseDetailResult(result, candidate);
    } catch (err) {
      this.config.logger(`[ZombieFetcher] 详情抓取失败 [${candidate.name}]: ${err}`);
      // 回退到基础数据
      return {
        id: candidate.id,
        name: candidate.name,
        storeUrl: candidate.storeUrl,
        description: '',
        author: 'Unknown',
        installCount: candidate.installCount,
        rating: candidate.rating || 3.0,
        ratingCount: 0,
        lastUpdated: candidate.lastUpdated || new Date(Date.now() - 500 * 24 * 60 * 60 * 1000),
        version: '1.0',
        usersText: `${candidate.installCount.toLocaleString()} users`
      };
    }
  }

  /**
   * 解析 Tinyfish Agent 详情结果
   */
  private parseDetailResult(raw: string, candidate: ExtensionBasic): ExtensionDetail | null {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        return {
          id: candidate.id,
          name: data.name || candidate.name,
          storeUrl: candidate.storeUrl,
          description: data.description || '',
          author: data.author || 'Unknown',
          installCount: this.parseInstallCount(data.installCount || data.usersText || String(candidate.installCount)),
          rating: parseFloat(data.rating) || candidate.rating || 3.0,
          ratingCount: parseInt(data.ratingCount) || 0,
          lastUpdated: this.parseDate(data.lastUpdated || data.updatedAt || ''),
          version: data.version || '1.0',
          usersText: data.usersText || `${candidate.installCount.toLocaleString()} users`
        };
      }
    } catch (err) {
      this.config.logger(`[ZombieFetcher] 详情 JSON 解析失败: ${err}`);
    }

    return null;
  }

  // ============================================================
  // 阶段3: 过滤僵尸插件
  // ============================================================

  private filterZombies(details: ExtensionDetail[]): ZombieTarget[] {
    const zombies: ZombieTarget[] = [];

    for (const detail of details) {
      const isAbandoned = detail.lastUpdated < this.config.staleThreshold;
      const hasEnoughUsers = detail.installCount >= this.config.minInstalls;
      const hasLowRating = detail.rating < 3.5;

      if (isAbandoned && hasEnoughUsers) {
        zombies.push({
          id: detail.id,
          name: detail.name,
          storeUrl: detail.storeUrl,
          installCount: detail.installCount,
          lastUpdated: detail.lastUpdated,
          rating: detail.rating,
          ratingCount: detail.ratingCount,
          version: detail.version,
          recentNegativeReviews: [],
          summary: this.buildSummary(detail),
          searchQuery: detail.storeUrl,
          discoveredAt: new Date()
        });

        this.config.logger(
          `[ZombieFetcher] 僵尸插件: ${detail.name} | ` +
          `${detail.installCount.toLocaleString()} users | ` +
          `更新: ${detail.lastUpdated.toISOString().split('T')[0]} | ` +
          `评分: ${detail.rating}/5`
        );
      } else {
        this.config.logger(
          `[ZombieFetcher] 跳过: ${detail.name} | ` +
          `安装:${detail.installCount} 更新:${detail.lastUpdated.toISOString().split('T')[0]} | ` +
          `${isAbandoned ? '✅停更' : '❌活跃'} ${hasEnoughUsers ? '✅高安装' : '❌低安装'}`
        );
      }
    }

    return zombies
      .sort((a, b) => b.installCount - a.installCount)
      .slice(0, this.config.maxTargets);
  }

  private buildSummary(detail: ExtensionDetail): string {
    const daysSinceUpdate = Math.floor(
      (Date.now() - detail.lastUpdated.getTime()) / (1000 * 60 * 60 * 24)
    );
    const months = Math.round(daysSinceUpdate / 30);

    return [
      `安装量: ${detail.installCount.toLocaleString()} 用户`,
      `停更时间: ${months} 个月 (${detail.lastUpdated.toLocaleDateString()})`,
      `当前评分: ${detail.rating}/5 (${detail.ratingCount.toLocaleString()} 条评价)`,
      `版本: ${detail.version}`
    ].join(' | ');
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private extractExtId(url: string): string {
    const match = url.match(/chromewebstore\.google\.com\/detail\/[^\/]+\/([^\/\?#]+)/i);
    return match?.[1] || url.split('/').pop() || 'unknown';
  }

  private extractNameFromUrl(url: string): string {
    const match = url.match(/chromewebstore\.google\.com\/detail\/([^\/]+)/i);
    if (match?.[1]) {
      return match[1]
        .replace(/-/g, ' ')
        .replace(/[a-z]_[a-z]/g, (m) => m[0] + ' ' + m[2].toUpperCase())
        .replace(/\b\w/g, c => c.toUpperCase());
    }
    return 'Unknown Extension';
  }

  parseInstallCount(text: string): number {
    if (!text) return 0;

    const str = String(text).replace(/,/g, '').trim();
    const match = str.match(/([\d.]+)\s*(million|m\b|thousand|k\b)?/i);

    if (!match) return 0;

    let count = parseFloat(match[1]);
    const suffix = (match[2] || '').toLowerCase();

    if (suffix.includes('million') || suffix === 'm') count *= 1000000;
    else if (suffix.includes('thousand') || suffix === 'k') count *= 1000;

    return Math.round(count);
  }

  parseDate(text: string): Date {
    if (!text) return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    // 匹配 "February 23, 2023" 或 "Feb 23, 2023" 格式
    const match = text.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i
    );

    if (match) {
      const [, month, day, year] = match;
      const months: Record<string, number> = {
        january: 0, february: 1, march: 2, april: 3,
        may: 4, june: 5, july: 6, august: 7,
        september: 8, october: 9, november: 10, december: 11
      };
      return new Date(
        parseInt(year),
        months[month.toLowerCase()] || 0,
        parseInt(day)
      );
    }

    // 回退：尝试直接解析
    const parsed = new Date(text);
    if (!isNaN(parsed.getTime())) return parsed;

    return new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  }

  // ============================================================
  // 速率限制控制
  // ============================================================

  private async waitForSearchRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // 清理 1 分钟前的记录
    this.searchHistory = this.searchHistory.filter(t => t.getTime() > oneMinuteAgo);

    if (this.searchHistory.length >= 4) {  // 留1次余量
      const oldest = this.searchHistory[0];
      const waitTime = 60000 - (now - oldest.getTime()) + 1000;
      if (waitTime > 0) {
        this.config.logger(`[ZombieFetcher] 搜索速率限制: 等待 ${Math.round(waitTime / 1000)}s`);
        await this.sleep(waitTime);
      }
    }

    this.searchHistory.push(new Date());
  }

  private async waitForFetchRateLimit(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    this.fetchHistory = this.fetchHistory.filter(t => t.getTime() > oneMinuteAgo);

    if (this.fetchHistory.length >= 24) {  // 留1次余量
      const oldest = this.fetchHistory[0];
      const waitTime = 60000 - (now - oldest.getTime()) + 1000;
      if (waitTime > 0) {
        await this.sleep(waitTime);
      }
    }

    this.fetchHistory.push(new Date());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ============================================================
  // 模拟数据（API Key 未配置时使用）
  // ============================================================

  private getMockData(): ZombieTarget[] {
    this.config.logger('[ZombieFetcher] 使用模拟僵尸插件数据');

    return [
      {
        id: 'ckldibgkhfin',
        name: 'Controls for Instagram Videos',
        storeUrl: 'https://chromewebstore.google.com/detail/controls-for-instagram-v/ckldibgkhfin',
        installCount: 100000,
        lastUpdated: new Date('2023-02-15'),
        rating: 2.3,
        ratingCount: 847,
        version: '2.1.4',
        recentNegativeReviews: [
          {
            author: 'VideoCreator42',
            rating: 1,
            date: new Date('2025-12-10'),
            content: 'Completely broken after latest Instagram update. Please fix ASAP!',
            sentiment: 'negative',
            isStale: true
          },
          {
            author: 'MarketingPro',
            rating: 1,
            date: new Date('2025-11-28'),
            content: 'Not working for 2 weeks. Developer abandoned this extension.',
            sentiment: 'negative',
            isStale: true
          },
          {
            author: 'SmallBizOwner',
            rating: 2,
            date: new Date('2025-11-15'),
            content: 'Stopped working after Instagram changed their UI. Needs urgent fix.',
            sentiment: 'negative',
            isStale: true
          }
        ],
        summary: '安装量: 100,000 用户 | 停更时间: 34 个月 (2023-02-15) | 评分: 2.3/5',
        searchQuery: 'instagram video controls',
        discoveredAt: new Date()
      },
      {
        id: 'bmodheader',
        name: 'ModHeader',
        storeUrl: 'https://chromewebstore.google.com/detail/modheader/bmodheader',
        installCount: 300000,
        lastUpdated: new Date('2022-08-20'),
        rating: 2.8,
        ratingCount: 2341,
        version: '3.4.5',
        recentNegativeReviews: [
          {
            author: 'DevOpsGuy',
            rating: 1,
            date: new Date('2025-12-01'),
            content: 'MV3 update broke everything. Developer gone for months.',
            sentiment: 'negative',
            isStale: true
          },
          {
            author: 'SecurityResearcher',
            rating: 2,
            date: new Date('2025-11-20'),
            content: 'Completely broken since Chrome MV3 migration. No alternative found.',
            sentiment: 'negative',
            isStale: true
          },
          {
            author: 'QAEngineer',
            rating: 1,
            date: new Date('2025-10-15'),
            content: 'Developer abandoned this project. Broken for 3 months. URGENT FIX NEEDED.',
            sentiment: 'negative',
            isStale: true
          }
        ],
        summary: '安装量: 300,000 用户 | 停更时间: 42 个月 (2022-08-20) | 评分: 2.8/5',
        searchQuery: 'header modifier chrome extension',
        discoveredAt: new Date()
      }
    ];
  }
}

// ============================================================
// 便捷函数
// ============================================================

export async function fetchZombiePlugins(
  apiKey: string,
  config?: Partial<ZombieFetcherConfig>
): Promise<ZombieTarget[]> {
  const fetcher = new ChromeZombieFetcher({ tinyfishApiKey: apiKey, ...config });
  return fetcher.fetchAll();
}
