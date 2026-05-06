// src/fetchers/hnAlgoliaFetcher.ts
// Hacker News Algolia 搜索采集器
//
// 使用 HN 官方 Algolia Search API，无需 Key
// 相比 Firebase API，支持更精确的关键词过滤
//
// API: https://hn.algolia.com/api/v1/search
// 文档: https://hn.algolia.com/docs/api-reference/rest-api
//
// 优点: 无需 Key，支持复杂查询，HN 官方推荐方式
// 缺点: 免费版有速率限制 (10 req/10s)

import axios from 'axios';
import type { HackerNewsAlgoliaItem } from '../types.js';

// ============================================================
// 配置
// ============================================================

export interface HNAlgoliaFetcherConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** 搜索关键词 (OR 组合) */
  keywords?: string[];
  /** 时间范围 */
  daysBack?: number;
  /** 每关键词最大结果 */
  maxResults?: number;
  /** 最低分数阈值 */
  minScore?: number;
  /** 请求超时 */
  timeout?: number;
  /** 请求间隔 (ms) */
  requestInterval?: number;
}

const DEFAULT_CONFIG: Required<HNAlgoliaFetcherConfig> = {
  enabled: true,
  keywords: [
    'AI', 'LLM', 'GPT', 'Claude', 'machine learning', 'neural network',
    'ChatGPT', 'OpenAI', 'Anthropic', 'stable diffusion', 'Hugging Face',
    'LangChain', 'RAG', 'vector database', 'embedding', 'fine-tuning'
  ],
  daysBack: 3,
  maxResults: 30,
  minScore: 10,
  timeout: 20000,
  requestInterval: 1200 // Algolia 限制: ~10 req/10s
};

// ============================================================
// 内置 AI 关键词模板
// ============================================================

export const AI_KEYWORD_TEMPLATES = {
  // 模型发布
  modelRelease: [
    'OpenAI GPT', 'Anthropic Claude', 'Google Gemini', 'Meta LLaMA',
    'Mistral AI', 'Mistral', 'Grok', 'Command R', 'Perplexity',
    'model release', 'new model', 'model launch', 'GPT-5', 'Claude 4'
  ],
  // 工具发布
  toolLaunch: [
    'launch', 'open source', 'released', 'announced', 'new tool',
    'AI tool', 'AI product', 'startup launch'
  ],
  // 研究论文
  research: [
    'paper', 'research', 'arxiv', 'benchmark', 'study',
    'trained on', 'fine-tuning', 'pretrained', 'SOTA'
  ],
  // 商业/融资
  business: [
    'funding', 'raised', 'Series', 'investment', 'acquired',
    'million', 'billion valuation', 'startup', 'venture'
  ],
  // 开发者工具
  devTools: [
    'Python library', 'GitHub repo', 'framework', 'API', 'SDK',
    'LangChain', 'LlamaIndex', 'LangSmith', 'vLLM', 'Ollama'
  ]
};

// ============================================================
// 主采集器
// ============================================================

export class HNAlgoliaFetcher {
  private config: Required<HNAlgoliaFetcherConfig>;
  private logger: (msg: string) => void;
  private lastRequestTime = 0;

  constructor(
    config: HNAlgoliaFetcherConfig = {},
    logger: (msg: string) => void = console.log
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * 抓取所有关键词的 HN 内容
   */
  async fetchAll(): Promise<HackerNewsAlgoliaItem[]> {
    if (!this.config.enabled) {
      this.logger('[HNFetcher] 模块未启用，跳过');
      return [];
    }

    this.logger(`[HNFetcher] 开始采集 HN Algolia，关键词: ${this.config.keywords.length} 个`);

    const results: HackerNewsAlgoliaItem[] = [];

    // 分批并行查询，避免触发速率限制
    const BATCH_SIZE = 3;
    const batches: string[][] = [];

    for (let i = 0; i < this.config.keywords.length; i += BATCH_SIZE) {
      batches.push(this.config.keywords.slice(i, i + BATCH_SIZE));
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.logger(`[HNFetcher] 批次 ${i + 1}/${batches.length}: ${batch.slice(0, 3).join(', ')}...`);

      const tasks = batch.map(kw => this.queryKeyword(kw));
      const settled = await Promise.allSettled(tasks);

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(...result.value);
        }
      }

      // 批次间间隔
      if (i < batches.length - 1) {
        await this.sleep(this.config.requestInterval * 2);
      }
    }

    this.logger(`[HNFetcher] 去重前: ${results.length} 条`);
    const deduplicated = this.deduplicate(results);
    this.logger(`[HNFetcher] 去重后: ${deduplicated.length} 条`);

    return deduplicated;
  }

  /**
   * 查询单个关键词
   */
  private async queryKeyword(keyword: string): Promise<HackerNewsAlgoliaItem[]> {
    await this.rateLimitWait();

    const sinceDate = new Date(Date.now() - this.config.daysBack * 24 * 60 * 60 * 1000);
    const numericRange = Math.floor(sinceDate.getTime() / 1000);

    const params = new URLSearchParams({
      query: keyword,
      tags: 'story',
      numericFilters: `created_at_i>${numericRange},points>${this.config.minScore}`,
      hitsPerPage: this.config.maxResults.toString(),
      attributesToRetrieve: [
        'title', 'url', 'author', 'points', 'num_comments',
        'created_at', 'objectID', '_tags', 'story_text'
      ].join(','),
      attributesToSnippet: 'title:30,story_text:50',
      snippetEllipsisText: '...'
    });

    try {
      const response = await axios.get<HNHitResponse>(
        `https://hn.algolia.com/api/v1/search?${params}`,
        {
          timeout: this.config.timeout,
          headers: {
            'User-Agent': 'OpportunityScanner/1.0 (HN Fetcher)',
            Accept: 'application/json'
          }
        }
      );

      this.logger(`[HNFetcher] "${keyword}": ${response.data.nbHits} 条匹配`);

      return response.data.hits.map(hit => this.parseHit(hit, keyword));
    } catch (err: any) {
      this.logger(`[HNFetcher] "${keyword}" 查询失败: ${err.message}`);
      return [];
    }
  }

  private parseHit(hit: HNHit, matchedKeyword: string): HackerNewsAlgoliaItem {
    return {
      id: hit.objectID,
      title: hit.title,
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      author: hit.author || 'anonymous',
      points: hit.points || 0,
      numComments: hit.num_comments || 0,
      createdAt: hit.created_at ? new Date(hit.created_at) : new Date(),
      objectId: hit.objectID,
      storyText: hit._snippetResult?.story_text?.value || hit.story_text || '',
      matchedKeyword,
      tags: hit._tags || []
    };
  }

  /**
   * 去重: 相同 URL 或标题相似度 > 0.8
   */
  private deduplicate(items: HackerNewsAlgoliaItem[]): HackerNewsAlgoliaItem[] {
    const seen = new Map<string, HackerNewsAlgoliaItem>();

    // 按分数降序
    items.sort((a, b) => b.points - a.points);

    for (const item of items) {
      // 完全相同 URL
      if (seen.has(item.url)) {
        const existing = seen.get(item.url)!;
        // 保留分数更高的
        if (item.points > existing.points) {
          seen.set(item.url, item);
        }
        continue;
      }

      // 标题相似去重
      const normalized = this.normalizeTitle(item.title);
      let isDupe = false;

      for (const [, existing] of seen) {
        if (this.titleSimilarity(normalized, this.normalizeTitle(existing.title)) > 0.8) {
          isDupe = true;
          break;
        }
      }

      if (!isDupe) {
        seen.set(item.url, item);
      }
    }

    return [...seen.values()].sort((a, b) => b.points - a.points);
  }

  private normalizeTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  private titleSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const wordsA = new Set(a.split(' '));
    const wordsB = new Set(b.split(' '));

    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  /**
   * Algolia 速率限制: ~10 req/10s
   */
  private async rateLimitWait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;

    if (elapsed < this.config.requestInterval) {
      await this.sleep(this.config.requestInterval - elapsed);
    }

    this.lastRequestTime = Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================
// Algolia API 类型
// ============================================================

interface HNHitResponse {
  hits: HNHit[];
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  processingTimeMS: number;
  query: string;
}

interface HNHit {
  objectID: string;
  title: string;
  url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at?: string;
  _tags?: string[];
  story_text?: string;
  _snippetResult?: {
    story_text?: { value: string; matchLevel: string };
    title?: { value: string; matchLevel: string };
  };
}

// ============================================================
// 便捷函数
// ============================================================

export function createHNAlgoliaFetcher(
  config?: HNAlgoliaFetcherConfig,
  logger?: (msg: string) => void
): HNAlgoliaFetcher {
  return new HNAlgoliaFetcher(config, logger);
}

export async function fetchHNAlgolia(
  config?: HNAlgoliaFetcherConfig,
  logger?: (msg: string) => void
): Promise<HackerNewsAlgoliaItem[]> {
  const fetcher = new HNAlgoliaFetcher(config, logger);
  return fetcher.fetchAll();
}
