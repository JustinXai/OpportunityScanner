// src/fetchers/freeChromeZombieFetcher.ts
// Chrome 僵尸插件套利数据采集器 - 免费方案 v2.0
//
// 数据源（全部免费）：
// 1. Serper API - Google 搜索，有免费额度
// 2. 直接爬取 Chrome Web Store 搜索页
// 3. DuckDuckGo HTML 搜索
// 4. GitHub API - 查找开源插件
//
// 僵尸插件定义：
// - 安装量 >= 30,000 用户
// - 最后更新早于 2024年1月1日（停更超过1年）
// - 优先搜索特定类型的僵尸插件
//
// 优化特性：
// - 每次扫描 300+ 款插件
// - 记录已扫描插件，避免重复
// - 并发加速

import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import * as fs from 'fs';
import * as path from 'path';

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
  painKeywords: string[];
}

export interface ReviewAnalysis {
  reviews: Review[];
  avgRating: number;
  negativeRatio: number;
  painPoints: string[];
  requestedFeatures: string[];
  monetizationSignals: string[];
  mv3Broken: boolean;
  userRageLevel: number;
  bestSlogan: string;
  killerFeature: string;
  // v5.5 新增
  crashDensity: number;
  developerUnresponsive: boolean;
  technicalErrors: string[];
  fixRecommendations: string[];
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
  reviewAnalysis?: ReviewAnalysis;
  summary: string;
  searchQuery: string;
  discoveredAt: Date;
}

// ============================================================
// 配置
// ============================================================

export interface FreeZombieFetcherConfig {
  serperApiKey?: string;
  githubToken?: string;
  concurrency?: number;
  requestInterval?: number;
  maxTargets?: number;
  minInstalls?: number;
  staleThreshold?: Date;
  useMockData?: boolean;
  logger?: (msg: string) => void;
}

interface DefaultConfig {
  concurrency: number;
  requestInterval: number;
  maxTargets: number;
  minInstalls: number;
  staleThreshold: Date;
  useMockData: boolean;
  logger: (msg: string) => void;
}

const DEFAULT_CONFIG: DefaultConfig = {
  concurrency: 2,  // 降低并发避免被限流
  requestInterval: 3000,  // 增加请求间隔
  maxTargets: 10,
  minInstalls: 30000,
  staleThreshold: new Date('2024-01-01'),
  useMockData: false,
  logger: console.log
};

// 搜索关键词 - 针对可能已停更的插件类型
const STORE_SEARCH_QUERIES = [
  // Instagram 相关（高停更率）
  'instagram video downloader',
  'instagram photo download',
  'instagram story saver',
  'instagram for chrome',
  // 社交媒体
  'twitter extension chrome',
  'facebook video downloader chrome',
  'tiktok downloader chrome',
  // 工具类（易停更）
  'pdf viewer chrome extension',
  'screenshot chrome extension',
  'screen recorder chrome',
  'ad blocker chrome',
  'password manager chrome',
  // 开发工具
  'json viewer chrome',
  'color picker chrome extension',
  ' rulers chrome extension',
  // 生产力
  'todo list chrome extension',
  'notes chrome extension',
  'bookmark manager chrome',
  // 媒体
  'youtube downloader chrome',
  'video downloader chrome',
  'music downloader chrome',
  // 电商
  'amazon price tracker chrome',
  'aliexpress checker chrome',
  // 其他
  'translate chrome extension',
  'dictionary chrome extension',
  'grammar checker chrome'
];

// Serper 搜索关键词 - 直接搜索插件名称/类型
const SERPER_KEYWORDS = [
  // 直接搜索插件
  'site:chromewebstore.google.com instagram video downloader',
  'site:chromewebstore.google.com pdf viewer',
  'site:chromewebstore.google.com screen recorder',
  'site:chromewebstore.google.com screenshot tool',
  'site:chromewebstore.google.com json viewer',
  'site:chromewebstore.google.com color picker',
  // 搜索停更插件
  '"chrome extension" "last updated 2023" OR "last updated 2024"',
  '"discontinued" chrome extension popular',
  '"abandoned" chrome extension 2024'
];

// ============================================================
// 主采集器
// ============================================================

export class FreeChromeZombieFetcher {
  private config: DefaultConfig;
  private serperHttp: AxiosInstance;
  private storeHttp: AxiosInstance;
  private githubHttp: AxiosInstance;
  private ddgHttp: AxiosInstance;
  private serperApiKey?: string;
  private githubToken?: string;
  private visitedFile: string;
  private visitedIds: Set<string>;
  private scannedCount: number = 0;

  constructor(config: FreeZombieFetcherConfig) {
    this.serperApiKey = config.serperApiKey;
    this.githubToken = config.githubToken;

    // 加载已访问的插件记录
    this.visitedFile = path.join(process.cwd(), 'data', 'scanned-extensions.json');
    this.visitedIds = this.loadVisitedIds();

    // Serper API
    this.serperHttp = axios.create({
      baseURL: 'https://google.serper.dev',
      timeout: 60000,  // 增加超时
      headers: {
        'X-API-KEY': config.serperApiKey || '',
        'Content-Type': 'application/json'
      }
    });

    // Chrome Web Store
    this.storeHttp = axios.create({
      timeout: 60000,  // 增加超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    // GitHub
    this.githubHttp = axios.create({
      baseURL: 'https://api.github.com',
      timeout: 60000,  // 增加超时
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        ...(config.githubToken ? { 'Authorization': `token ${config.githubToken}` } : {})
      }
    });

    // DuckDuckGo
    this.ddgHttp = axios.create({
      timeout: 60000,  // 增加超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html'
      }
    });

    this.config = {
      concurrency: config.concurrency ?? DEFAULT_CONFIG.concurrency,
      requestInterval: config.requestInterval ?? DEFAULT_CONFIG.requestInterval,
      maxTargets: config.maxTargets ?? DEFAULT_CONFIG.maxTargets,
      minInstalls: config.minInstalls ?? DEFAULT_CONFIG.minInstalls,
      staleThreshold: config.staleThreshold ?? DEFAULT_CONFIG.staleThreshold,
      useMockData: config.useMockData ?? DEFAULT_CONFIG.useMockData,
      logger: config.logger ?? DEFAULT_CONFIG.logger
    };

    this.config.logger(`[FreeZombieFetcher] 初始化完成`);
    this.config.logger(`  - 最小安装量: ${this.config.minInstalls.toLocaleString()}`);
    this.config.logger(`  - 停更阈值: ${this.config.staleThreshold.toISOString().split('T')[0]}`);
    this.config.logger(`  - 已扫描记录: ${this.visitedIds.size} 个`);
  }

  /**
   * 加载已访问的插件 ID
   */
  private loadVisitedIds(): Set<string> {
    try {
      if (fs.existsSync(this.visitedFile)) {
        const data = JSON.parse(fs.readFileSync(this.visitedFile, 'utf-8'));
        return new Set(data.ids || []);
      }
    } catch (e) { /* 忽略 */ }
    return new Set();
  }

  /**
   * 保存已访问的插件 ID
   */
  private saveVisitedIds(): void {
    try {
      const dir = path.dirname(this.visitedFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.visitedFile, JSON.stringify({
        ids: Array.from(this.visitedIds),
        lastUpdated: new Date().toISOString()
      }, null, 2));
    } catch (e) {
      this.config.logger(`[FreeZombieFetcher] 保存访问记录失败: ${e}`);
    }
  }

  /**
   * 主入口
   */
  async fetchAll(): Promise<ZombieTarget[]> {
    this.config.logger('[FreeZombieFetcher] ========== 开始僵尸插件发现流程 v2.0 ==========');

    if (this.config.useMockData) {
      return this.getMockData();
    }

    try {
      // 阶段1: 批量采集候选插件（目标 300+）
      const candidates = await this.discoverCandidates();

      this.config.logger(`[FreeZombieFetcher] 阶段1完成: 发现 ${candidates.length} 个候选插件`);
      this.scannedCount = candidates.length;

      if (candidates.length === 0) {
        return [];
      }

      // 阶段2: 获取详细信息
      const targets = await this.fetchDetails(candidates);

      // 阶段3: 过滤僵尸插件
      const zombies = this.filterZombies(targets);

      // 阶段4: 采集并分析评论
      const zombiesWithReviews = await this.fetchAndAnalyzeReviews(zombies);

      // 保存扫描记录
      this.saveVisitedIds();

      this.config.logger(`[FreeZombieFetcher] ========== 完成: 发现 ${zombiesWithReviews.length} 个僵尸插件 ==========`);

      return zombiesWithReviews;
    } catch (err) {
      this.config.logger(`[FreeZombieFetcher] 采集过程出错: ${err}`);
      return [];
    }
  }

  // ============================================================
  // 阶段1: 批量发现候选插件
  // ============================================================

  private async discoverCandidates(): Promise<ExtensionBasic[]> {
    this.config.logger('[FreeZombieFetcher] 阶段1: 批量发现候选插件...');

    const candidates: ExtensionBasic[] = [];
    const limit = pLimit(this.config.concurrency);

    // 并发执行所有搜索任务
    const tasks = [];

    // 1. Serper 搜索
    if (this.serperApiKey) {
      tasks.push(limit(() => this.searchWithSerper()));
    }

    // 2. DuckDuckGo 搜索
    tasks.push(limit(() => this.searchWithDuckDuckGo()));

    // 3. Chrome Store 批量爬取
    tasks.push(limit(() => this.crawlChromeStoreBatch()));

    // 4. GitHub 搜索
    if (this.githubToken) {
      tasks.push(limit(() => this.searchGitHub()));
    }

    // 并发执行
    const results = await Promise.allSettled(tasks);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        candidates.push(...result.value);
      }
    }

    // 去重并过滤已访问
    const unique = this.deduplicateCandidates(candidates);
    return unique.slice(0, 400); // 限制数量
  }

  /**
   * Serper API 搜索
   */
  private async searchWithSerper(): Promise<ExtensionBasic[]> {
    const candidates: ExtensionBasic[] = [];

    for (const keyword of SERPER_KEYWORDS) {
      try {
        this.config.logger(`[FreeZombieFetcher] Serper: ${keyword.substring(0, 50)}...`);

        const response = await this.serperHttp.post('/search', {
          q: keyword,
          num: 10
        });

        const results = response.data?.organic || [];

        for (const result of results) {
          const url = result.url || '';

          // 只接受 Chrome Web Store 链接
          if (!url.includes('chromewebstore.google.com')) continue;

          const idMatch = url.match(/\/detail\/[^\/]+\/([a-zA-Z0-9_-]+)/);
          if (!idMatch) continue;

          const id = idMatch[1];
          if (this.visitedIds.has(id)) continue;

          candidates.push({
            id,
            name: result.title?.replace(/ - Chrome Web Store$/i, '').trim() || id,
            storeUrl: url,
            installCount: 0,
            lastUpdated: undefined,
            rating: undefined
          });
        }

        await this.sleep(this.config.requestInterval);
      } catch (err: any) {
        this.config.logger(`[FreeZombieFetcher] Serper 失败: ${err.message}`);
      }
    }

    return candidates;
  }

  /**
   * DuckDuckGo 搜索
   */
  private async searchWithDuckDuckGo(): Promise<ExtensionBasic[]> {
    const candidates: ExtensionBasic[] = [];

    const ddgKeywords = [
      'site:chromewebstore.google.com "not working" OR "broken"',
      'chrome extension abandoned 2024 site:github.com OR site:reddit.com'
    ];

    for (const keyword of ddgKeywords) {
      try {
        this.config.logger(`[FreeZombieFetcher] DuckDuckGo: ${keyword.substring(0, 40)}...`);

        const response = await this.ddgHttp.get('https://html.duckduckgo.com/html/', {
          params: { q: keyword }
        });

        const $ = cheerio.load(response.data);

        $('.result__a').each((_, el) => {
          const href = $(el).attr('href') || '';
          const title = $(el).text().trim();

          if (href.includes('chromewebstore.google.com')) {
            const idMatch = href.match(/\/detail\/[^\/]+\/([a-zA-Z0-9_-]+)/);
            if (idMatch && !this.visitedIds.has(idMatch[1])) {
              candidates.push({
                id: idMatch[1],
                name: title,
                storeUrl: href,
                installCount: 0,
                lastUpdated: undefined,
                rating: undefined
              });
            }
          }
        });

        await this.sleep(this.config.requestInterval);
      } catch (err: any) {
        this.config.logger(`[FreeZombieFetcher] DuckDuckGo 失败: ${err.message}`);
      }
    }

    return candidates;
  }

  /**
   * 批量爬取 Chrome Web Store
   */
  private async crawlChromeStoreBatch(): Promise<ExtensionBasic[]> {
    const candidates: ExtensionBasic[] = [];
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    for (const query of STORE_SEARCH_QUERIES) {
      try {
        this.config.logger(`[FreeZombieFetcher] Chrome Store: ${query}`);

        const response = await axios.get(
          `https://chromewebstore.google.com/search/${encodeURIComponent(query)}`,
          { headers, timeout: 30000 }
        );

        const $ = cheerio.load(response.data);

        $('a[href*="/detail/"]').each((_, el) => {
          let href = $(el).attr('href') || '';

          if (href.startsWith('./')) {
            href = 'https://chromewebstore.google.com' + href.substring(1);
          }

          const idMatch = href.match(/\/detail\/[^\/]+\/([a-zA-Z0-9_-]+)/);
          if (!idMatch || !href.includes('chromewebstore.google.com')) return;

          const id = idMatch[1];
          if (this.visitedIds.has(id)) return;

          // 名称在相邻的兄弟 div 中的 h2.CiI2if 里
          // 结构: <a>...</a><div><div><h2 class="CiI2if">名称</h2>
          let name = '';
          const parent = $(el).parent();
          if (parent.length) {
            name = parent.next('div').find('h2.CiI2if').text().trim();
            if (!name) {
              name = parent.next('div').next('div').find('h2.CiI2if').first().text().trim();
            }
          }

          // 如果还是找不到，直接用链接的 aria-labelledby 关联
          if (!name) {
            const ariaLabelledby = $(el).attr('aria-labelledby');
            if (ariaLabelledby) {
              name = $(`#${ariaLabelledby}`).text().trim();
            }
          }

          // 如果还是找不到，使用 id 作为名称
          if (!name) {
            name = id;
          }

          candidates.push({
            id,
            name: name.substring(0, 100),
            storeUrl: href,
            installCount: 0,
            lastUpdated: undefined,
            rating: undefined
          });
        });

        await this.sleep(this.config.requestInterval);
      } catch (err: any) {
        // 超时或网络错误时继续下一个，不中断整个流程
        const msg = err.message?.includes('timeout') ? '超时' : '失败';
        this.config.logger(`[FreeZombieFetcher] Chrome Store ${msg}: ${query} - ${err.message?.substring(0, 50)}`);
      }
    }

    return candidates;
  }

  /**
   * GitHub 搜索
   */
  private async searchGitHub(): Promise<ExtensionBasic[]> {
    const candidates: ExtensionBasic[] = [];

    try {
      this.config.logger('[FreeZombieFetcher] 搜索 GitHub...');

      const response = await this.githubHttp.get('/search/repositories', {
        params: {
          q: 'chrome extension NOT maintained OR abandoned OR broken',
          sort: 'stars',
          per_page: 50
        }
      });

      const repos = response.data?.items || [];

      for (const repo of repos) {
        const id = repo.name;
        if (this.visitedIds.has(id)) continue;

        candidates.push({
          id,
          name: repo.name,
          storeUrl: repo.html_url,
          installCount: repo.stargazers_count * 10,
          lastUpdated: new Date(repo.pushed_at),
          rating: undefined
        });
      }
    } catch (err: any) {
      this.config.logger(`[FreeZombieFetcher] GitHub 失败: ${err.message}`);
    }

    return candidates;
  }

  /**
   * 去重
   */
  private deduplicateCandidates(candidates: ExtensionBasic[]): ExtensionBasic[] {
    const seen = new Set<string>();
    return candidates.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }

  // ============================================================
  // 阶段2: 获取详细信息
  // ============================================================

  private async fetchDetails(candidates: ExtensionBasic[]): Promise<ExtensionDetail[]> {
    this.config.logger('[FreeZombieFetcher] 阶段2: 获取详细信息...');

    const details: ExtensionDetail[] = [];
    const limit = pLimit(this.config.concurrency);

    const tasks = candidates.map(candidate =>
      limit(async () => {
        try {
          // 标记为已访问
          this.visitedIds.add(candidate.id);

          if (candidate.storeUrl.includes('chromewebstore.google.com')) {
            return await this.crawlExtensionDetail(candidate);
          } else if (candidate.storeUrl.includes('github.com')) {
            return this.parseGitHubRepo(candidate);
          }
        } catch (err: any) {
          this.config.logger(`[FreeZombieFetcher] 详情获取失败 [${candidate.name}]: ${err.message}`);
        }
        return null;
      })
    );

    const results = await Promise.all(tasks);
    return results.filter((r): r is ExtensionDetail => r !== null);
  }

  /**
   * 爬取 Chrome Store 详情页
   */
  private async crawlExtensionDetail(candidate: ExtensionBasic): Promise<ExtensionDetail | null> {
    const url = candidate.storeUrl;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://chromewebstore.google.com/'
    };

    try {
      const response = await axios.get(url, { headers, timeout: 30000 });
      const $ = cheerio.load(response.data);
      const bodyText = $('body').text();

      const name = $('h1').first().text().trim() || candidate.name;
      const description = $('meta[name="description"]').attr('content') || '';

      // 提取安装量
      let installCount = 0;
      const installMatch = bodyText.match(/([\d,]+(?:\.\d+)?)\s*(?:million|M)?\s*(?:users?|install|download)/i);
      if (installMatch) {
        const numStr = installMatch[1].replace(/,/g, '');
        if (installMatch[0].toLowerCase().includes('million') || installMatch[0].includes('M')) {
          installCount = Math.round(parseFloat(numStr) * 1000000);
        } else {
          installCount = parseInt(numStr);
        }
      }

      // 提取更新日期
      let lastUpdated = candidate.lastUpdated || new Date('2020-01-01');
      const updatedMatch = bodyText.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s+\d{4}/i);
      if (updatedMatch) {
        const parsed = new Date(updatedMatch[0]);
        if (!isNaN(parsed.getTime())) lastUpdated = parsed;
      }

      // 提取版本
      let version = '';
      const versionMatch = bodyText.match(/Version[:\s]+([^\s\n,]+)/i);
      if (versionMatch) version = versionMatch[1];

      // 提取评分
      let rating = 0;
      const ratingMatch = bodyText.match(/(\d\.\d)\s*(?:star|out of\s*5)/i);
      if (ratingMatch) rating = parseFloat(ratingMatch[1]);

      this.config.logger(`[FreeZombieFetcher] 详情: ${name} | ${installCount.toLocaleString()} 用户 | ${lastUpdated.toISOString().split('T')[0]}`);

      return {
        id: candidate.id,
        name,
        storeUrl: candidate.storeUrl,
        description: description.substring(0, 500),
        author: 'Unknown',
        installCount,
        rating,
        ratingCount: 0,
        lastUpdated,
        version,
        usersText: `${installCount.toLocaleString()} users`,
        category: undefined
      };
    } catch (err: any) {
      this.config.logger(`[FreeZombieFetcher] 详情页失败: ${err.message}`);
      return null;
    }
  }

  /**
   * 解析 GitHub 仓库
   */
  private parseGitHubRepo(candidate: ExtensionBasic): ExtensionDetail {
    return {
      id: candidate.id,
      name: candidate.name,
      storeUrl: candidate.storeUrl,
      description: '',
      author: candidate.name.split('/')[0] || 'Unknown',
      installCount: candidate.installCount,
      rating: 0,
      ratingCount: 0,
      lastUpdated: candidate.lastUpdated || new Date('2020-01-01'),
      version: 'N/A',
      usersText: `${candidate.installCount.toLocaleString()} stars`
    };
  }

  // ============================================================
  // 阶段3: 过滤僵尸插件
  // ============================================================

  private filterZombies(targets: ExtensionDetail[]): ZombieTarget[] {
    this.config.logger('[FreeZombieFetcher] 阶段3: 过滤僵尸插件...');
    this.config.logger(`[FreeZombieFetcher] 共 ${targets.length} 个候选，阈值: ${this.config.minInstalls} 安装量 / ${this.config.staleThreshold.toISOString().split('T')[0]} 停更`);

    return targets
      .filter(target => {
        // 检查安装量
        if (target.installCount < this.config.minInstalls) {
          return false;
        }

        // 检查停更时间
        if (target.lastUpdated > this.config.staleThreshold) {
          return false;
        }

        return true;
      })
      .map(target => ({
        id: target.id,
        name: target.name,
        storeUrl: target.storeUrl,
        installCount: target.installCount,
        lastUpdated: target.lastUpdated,
        rating: target.rating,
        ratingCount: target.ratingCount,
        version: target.version,
        recentNegativeReviews: [],
        summary: this.generateSummary(target),
        searchQuery: 'batch-scan',
        discoveredAt: new Date()
      }));
  }

  // ============================================================
  // 阶段4: 采集并分析评论（新增）
  // ============================================================

  private async fetchAndAnalyzeReviews(zombies: ZombieTarget[]): Promise<ZombieTarget[]> {
    if (zombies.length === 0) return zombies;

    this.config.logger(`[FreeZombieFetcher] 阶段4: 采集评论分析...`);

    const limit = pLimit(this.config.concurrency);

    const tasks = zombies.map(zombie =>
      limit(async () => {
        try {
          this.config.logger(`[FreeZombieFetcher] 采集评论: ${zombie.name}`);

          // 导入并使用评论分析器
          const { fetchLatestReviews, analyzeReviews } = await import('./reviewFetcher.js');

          // 采集评论
          const reviews = await fetchLatestReviews(
            zombie.id,
            zombie.storeUrl,
            zombie.lastUpdated,
            this.config.requestInterval
          );

          // 分析评论
          const analysis = analyzeReviews(reviews, zombie.name);

          // 更新僵尸目标
          zombie.recentNegativeReviews = reviews;
          zombie.reviewAnalysis = analysis;

          this.config.logger(`[FreeZombieFetcher] 评论分析: ${zombie.name} | 怨气 ${analysis.userRageLevel}% | MV3损坏: ${analysis.mv3Broken}`);

          return zombie;
        } catch (err) {
          this.config.logger(`[FreeZombieFetcher] 评论采集失败: ${err}`);
          return zombie;
        }
      })
    );

    return await Promise.all(tasks);
  }

  private generateSummary(target: ExtensionDetail): string {
    const monthsSinceUpdate = Math.floor(
      (Date.now() - target.lastUpdated.getTime()) / (1000 * 60 * 60 * 24 * 30)
    );

    return `${target.name} - ${target.installCount.toLocaleString()} 用户，` +
           `停更约 ${monthsSinceUpdate} 个月，` +
           `最后版本 ${target.version}。` +
           (target.rating > 0 ? `评分 ${target.rating}/5。` : '');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // 模拟数据
  // ============================================================

  private getMockData(): ZombieTarget[] {
    return [{
      id: 'mock-extension',
      name: 'Mock Zombie Extension',
      storeUrl: 'https://chromewebstore.google.com/detail/mock/abcd123',
      installCount: 50000,
      lastUpdated: new Date('2023-06-15'),
      rating: 2.5,
      ratingCount: 234,
      version: '1.2.0',
      recentNegativeReviews: [],
      summary: 'Mock extension - 50,000 用户，停更约 24 个月。',
      searchQuery: 'mock',
      discoveredAt: new Date()
    }];
  }
}
