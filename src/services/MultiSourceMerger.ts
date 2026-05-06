// src/services/MultiSourceMerger.ts
// 多源数据合并去重服务
//
// 接收所有数据源的输出，统一转换为 UnifiedSignal，
// 按标题相似度和 URL 去重，并按优先级排序

import type {
  RSSNewsItem,
  ResearchItem,
  HackerNewsAlgoliaItem,
  TwitterSignal,
  UnifiedSignal,
  MultiSourceResult,
  DataSource
} from '../types.js';
import { DataSource as DS, SOURCE_PRIORITY } from '../types.js';

// ============================================================
// 配置
// ============================================================

export interface MergerConfig {
  /** 去重相似度阈值 (0-1) */
  similarityThreshold?: number;
  /** 最大输出数量 */
  maxSignals?: number;
  /** 是否启用来源权重排序 */
  sortByPriority?: boolean;
  /** 最小评分阈值 */
  minScore?: number;
}

const DEFAULT_CONFIG: Required<MergerConfig> = {
  similarityThreshold: 0.75,
  maxSignals: 50,
  sortByPriority: true,
  minScore: 0
};

// ============================================================
// 主合并器
// ============================================================

export class MultiSourceMerger {
  private config: Required<MergerConfig>;
  private logger: (msg: string) => void;

  constructor(
    config: MergerConfig = {},
    logger: (msg: string) => void = console.log
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * 合并所有数据源
   */
  merge(params: {
    rssItems?: RSSNewsItem[];
    researchItems?: ResearchItem[];
    hnItems?: HackerNewsAlgoliaItem[];
    twitterSignals?: TwitterSignal[];
  }): MultiSourceResult {
    this.logger('[Merger] 开始合并多源数据...');

    const errors: string[] = [];
    const signals: UnifiedSignal[] = [];
    const sourceBreakdown: MultiSourceResult['sourceBreakdown'] = [];

    // 1. 转换 RSS
    if (params.rssItems?.length) {
      const converted = params.rssItems.map(item => this.fromRSS(item));
      signals.push(...converted);
      sourceBreakdown.push({ source: DS.RSS_NEWS, count: converted.length });
      this.logger(`[Merger] RSS: +${converted.length} 条`);
    }

    // 2. 转换 Research
    if (params.researchItems?.length) {
      const converted = params.researchItems.map(item => this.fromResearch(item));
      signals.push(...converted);
      sourceBreakdown.push({ source: DS.RESEARCH, count: converted.length });
      this.logger(`[Merger] Research: +${converted.length} 条`);
    }

    // 3. 转换 HN Algolia
    if (params.hnItems?.length) {
      const converted = params.hnItems.map(item => this.fromHN(item));
      signals.push(...converted);
      sourceBreakdown.push({ source: DS.HN_ALGOLIA, count: converted.length });
      this.logger(`[Merger] HN Algolia: +${converted.length} 条`);
    }

    // 4. 转换 Twitter
    if (params.twitterSignals?.length) {
      const converted = params.twitterSignals.map(signal => this.fromTwitter(signal));
      signals.push(...converted);
      sourceBreakdown.push({ source: DS.TWITTER, count: converted.length });
      this.logger(`[Merger] Twitter: +${converted.length} 条`);
    }

    // 5. 过滤低分
    const beforeFilter = signals.length;
    const filtered = signals.filter(s => s.score >= this.config.minScore);
    if (filtered.length < beforeFilter) {
      this.logger(`[Merger] 过滤低分: ${beforeFilter} -> ${filtered.length}`);
    }

    // 6. 去重
    const deduplicated = this.deduplicate(filtered);
    this.logger(`[Merger] 去重: ${filtered.length} -> ${deduplicated.length}`);

    // 7. 排序
    const sorted = this.sort(deduplicated);
    const final = sorted.slice(0, this.config.maxSignals);

    this.logger(`[Merger] 最终: ${final.length} 条 (最多 ${this.config.maxSignals})`);

    return {
      signals: final,
      sourceBreakdown,
      totalCount: signals.length,
      deduplicatedCount: deduplicated.length,
      errors
    };
  }

  // ============================================================
  // 转换函数
  // ============================================================

  private fromRSS(item: RSSNewsItem): UnifiedSignal {
    return {
      id: `rss-${item.id}`,
      title: item.title,
      body: item.description,
      url: item.link,
      source: DS.RSS_NEWS,
      sourceName: item.source,
      publishedAt: item.publishedAt,
      discoveredAt: new Date(),
      score: item.isAIBranded ? 60 : 30,
      sentiment: item.sentiment,
      tags: item.categories,
      rawData: item
    };
  }

  private fromResearch(item: ResearchItem): UnifiedSignal {
    const tags = [
      ...item.relevanceTags,
      ...item.categories.slice(0, 3),
      'research',
      'paper'
    ];

    return {
      id: `research-${item.id}`,
      title: item.title,
      body: item.paperAbstract,
      url: item.pdfUrl || `https://arxiv.org/abs/${item.arxivId}`,
      source: DS.RESEARCH,
      sourceName: `arXiv ${item.primaryCategory}`,
      publishedAt: item.publishedAt,
      discoveredAt: new Date(),
      score: item.engagementScore + 20, // 研究类加权
      sentiment: 'neutral',
      tags,
      rawData: item
    };
  }

  private fromHN(item: HackerNewsAlgoliaItem): UnifiedSignal {
    const tags = ['hackernews', 'tech'];

    return {
      id: `hn-${item.objectId}`,
      title: item.title,
      body: item.storyText || item.title,
      url: item.url,
      source: DS.HN_ALGOLIA,
      sourceName: 'Hacker News',
      publishedAt: item.createdAt,
      discoveredAt: new Date(),
      score: item.points + item.numComments * 0.5,
      sentiment: 'neutral',
      tags,
      rawData: item
    };
  }

  private fromTwitter(signal: TwitterSignal): UnifiedSignal {
    return {
      id: `twitter-${signal.url.split('/').pop()}`,
      title: signal.content,
      body: signal.content,
      url: signal.url,
      source: DS.TWITTER,
      sourceName: `@${signal.author.username}`,
      publishedAt: signal.postedAt,
      discoveredAt: new Date(),
      score: signal.engagementScore,
      sentiment: signal.sentiment,
      tags: signal.hashtags,
      rawData: signal
    };
  }

  // ============================================================
  // 去重算法
  // ============================================================

  private deduplicate(signals: UnifiedSignal[]): UnifiedSignal[] {
    const seen = new Map<string, UnifiedSignal>();

    for (const signal of signals) {
      // 完全相同 URL -> 跳过
      if (seen.has(signal.url)) continue;

      // 检查标题相似度
      const normalized = this.normalize(signal.title);
      let isDupe = false;

      for (const [, existing] of seen) {
        const existingNorm = this.normalize(existing.title);
        if (this.similarity(normalized, existingNorm) > this.config.similarityThreshold) {
          isDupe = true;
          break;
        }
      }

      if (!isDupe) {
        seen.set(signal.url, signal);
      }
    }

    return [...seen.values()];
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '')
      .replace(/@\w+/g, '')
      .replace(/#[^\s]+/g, '')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 字符串相似度 (Jaccard)
   */
  private similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const wordsA = new Set(a.split(' ').filter(w => w.length > 2));
    const wordsB = new Set(b.split(' ').filter(w => w.length > 2));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  // ============================================================
  // 排序算法
  // ============================================================

  private sort(signals: UnifiedSignal[]): UnifiedSignal[] {
    if (!this.config.sortByPriority) {
      return signals.sort((a, b) => b.score - a.score);
    }

    return signals.sort((a, b) => {
      // 优先级权重: 0.3
      // 分数权重: 0.5
      // 时间权重: 0.2 (越新越高)
      const now = Date.now();
      const ageA = (now - a.publishedAt.getTime()) / (1000 * 60 * 60); // 小时
      const ageB = (now - b.publishedAt.getTime()) / (1000 * 60 * 60);

      const priorityA = SOURCE_PRIORITY[a.source] ?? 10;
      const priorityB = SOURCE_PRIORITY[b.source] ?? 10;

      const timeScoreA = Math.max(0, 100 - ageA * 0.5);
      const timeScoreB = Math.max(0, 100 - ageB * 0.5);

      const scoreA = priorityA * 0.3 + a.score * 0.5 + timeScoreA * 0.2;
      const scoreB = priorityB * 0.3 + b.score * 0.5 + timeScoreB * 0.2;

      return scoreB - scoreA;
    });
  }
}

// ============================================================
// 便捷函数
// ============================================================

export function createMerger(
  config?: MergerConfig,
  logger?: (msg: string) => void
): MultiSourceMerger {
  return new MultiSourceMerger(config, logger);
}

export function mergeSources(params: {
  rssItems?: RSSNewsItem[];
  researchItems?: ResearchItem[];
  hnItems?: HackerNewsAlgoliaItem[];
  twitterSignals?: TwitterSignal[];
}, config?: MergerConfig, logger?: (msg: string) => void): MultiSourceResult {
  const merger = new MultiSourceMerger(config, logger);
  return merger.merge(params);
}
