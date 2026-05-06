// src/fetchers/newsRssFetcher.ts
// AI 新闻 RSS 聚合器
// 使用 rss-parser 抓取 TechCrunch AI / VentureBeat / The Verge AI 等来源
//
// 优点: 无需 API Key，完全免费，编辑精选信噪比高
// 缺点: 有一定延迟（通常几小时）

import axios from 'axios';
import type { RSSNewsItem } from '../types.js';

// ============================================================
// RSS Feed 配置
// ============================================================

export interface RSSFetcherConfig {
  /** 是否启用本模块 */
  enabled?: boolean;
  /** 抓取哪些 Feed */
  feeds?: RSSFeedConfig[];
  /** 请求超时 (ms) */
  timeout?: number;
  /** 请求间隔 (ms)，避免被限流 */
  requestInterval?: number;
  /** 最大每源条目数 */
  maxItemsPerFeed?: number;
}

export interface RSSFeedConfig {
  name: string;
  url: string;
  /** 优先级 (数字越小越高) */
  priority?: number;
  /** 是否启用 */
  enabled?: boolean;
  /** 过滤关键词 (留空则包含全部) */
  keywords?: string[];
  /** 排除关键词 */
  excludeKeywords?: string[];
}

const DEFAULT_CONFIG: Required<RSSFetcherConfig> = {
  enabled: true,
  feeds: [],
  timeout: 15000,
  requestInterval: 1000,
  maxItemsPerFeed: 20
};

// ============================================================
// 内置 AI 新闻 RSS Feeds
// ============================================================

export const AI_NEWS_FEEDS: RSSFeedConfig[] = [
  {
    name: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    priority: 1,
    keywords: [
      'AI', 'artificial intelligence', 'machine learning', 'LLM', 'GPT',
      'Claude', 'Gemini', 'ChatGPT', 'OpenAI', 'Anthropic', 'startup',
      'funding', 'launch', 'release', 'announced'
    ]
  },
  {
    name: 'VentureBeat AI',
    url: 'https://venturebeat.com/category/ai/feed/',
    priority: 2,
    keywords: [
      'AI', 'machine learning', 'deep learning', 'model', 'training',
      'inference', 'LLM', 'GPT', 'research', 'enterprise', 'tool'
    ]
  },
  {
    name: 'The Verge AI',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    priority: 3,
    keywords: [
      'AI', 'artificial intelligence', 'machine learning', 'robotics',
      'tech', 'Google', 'Microsoft', 'Apple', 'Meta', 'open source'
    ]
  },
  {
    name: 'MIT Technology Review',
    url: 'https://www.technologyreview.com/feed/',
    priority: 4,
    keywords: [
      'AI', 'artificial intelligence', 'machine learning', 'technology',
      'research', 'science', 'robotics', 'computing'
    ]
  },
  {
    name: 'Wired AI',
    url: 'https://www.wired.com/feed/tag/ai/latest/rss',
    priority: 5,
    keywords: [
      'AI', 'artificial intelligence', 'machine learning', 'culture',
      'policy', 'society', 'privacy', 'regulation'
    ]
  },
  {
    name: 'Ars Technica Tech',
    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab',
    priority: 6,
    keywords: [
      'AI', 'machine learning', 'computing', 'research', 'software',
      'OpenAI', 'Google', 'Microsoft', 'Meta', 'security'
    ]
  },
  {
    name: 'MarkTechPost',
    url: 'https://www.marktechpost.com/feed/',
    priority: 2,
    keywords: [
      'AI', 'machine learning', 'deep learning', 'LLM', 'GPT', 'Claude',
      'research', 'paper', 'model', 'OpenAI', 'Google', 'Meta', 'Anthropic'
    ]
  },
  {
    name: 'Hacker News Top',
    url: 'https://hnrss.org/frontpage',
    priority: 7,
    keywords: [
      'AI', 'machine learning', 'LLM', 'GPT', 'neural network',
      'startup', 'open source', 'Python', 'research', 'tool'
    ]
  }
];

// ============================================================
// 主采集器
// ============================================================

export class NewsRssFetcher {
  private config: Required<RSSFetcherConfig>;
  private logger: (msg: string) => void;

  constructor(
    config: RSSFetcherConfig = {},
    logger: (msg: string) => void = console.log
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (!this.config.feeds.length) {
      this.config.feeds = AI_NEWS_FEEDS;
    }
    this.logger = logger;
  }

  /**
   * 抓取所有已启用的 RSS Feed
   */
  async fetchAll(): Promise<RSSNewsItem[]> {
    if (!this.config.enabled) {
      this.logger('[RSSFetcher] 模块未启用，跳过');
      return [];
    }

    this.logger(`[RSSFetcher] 开始抓取 ${this.config.feeds.length} 个 RSS Feed`);

    const results: RSSNewsItem[] = [];

    for (const feed of this.config.feeds) {
      if (feed.enabled === false) {
        this.logger(`[RSSFetcher] 跳过: ${feed.name} (已禁用)`);
        continue;
      }

      try {
        const items = await this.fetchFeed(feed);
        results.push(...items);
        this.logger(`[RSSFetcher] ${feed.name}: +${items.length} 条`);
      } catch (err: any) {
        this.logger(`[RSSFetcher] ${feed.name} 失败: ${err.message}`);
      }

      // 间隔控制，避免被限流
      if (this.config.requestInterval > 0) {
        await this.sleep(this.config.requestInterval);
      }
    }

    this.logger(`[RSSFetcher] 共获取 ${results.length} 条 RSS 新闻`);
    return this.deduplicateByTitle(results);
  }

  /**
   * 抓取单个 Feed
   */
  private async fetchFeed(feed: RSSFeedConfig): Promise<RSSNewsItem[]> {
    const response = await axios.get(feed.url, {
      timeout: this.config.timeout,
      headers: {
        'User-Agent': 'OpportunityScanner/1.0 (RSS News Fetcher)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*'
      }
    });

    const xml = response.data as string;
    const items = this.parseRssXml(xml, feed);

    // 关键词过滤
    const filtered = this.filterByKeywords(items, feed);

    // 截断
    return filtered.slice(0, this.config.maxItemsPerFeed);
  }

  /**
   * 解析 RSS XML（不使用 rss-parser，避免依赖问题）
   * 兼容 RSS 2.0 和 Atom 格式
   */
  private parseRssXml(xml: string, feed: RSSFeedConfig): RSSNewsItem[] {
    const items: RSSNewsItem[] = [];

    // 匹配 <item> 或 <entry> 标签
    const itemRegex = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];

      const title = this.extractTag(itemXml, ['title']);
      const link = this.extractTag(itemXml, ['link']) || this.extractAtomLink(itemXml);
      const description = this.stripHtml(this.extractTag(itemXml, ['description', 'summary', 'content']) || '');
      const pubDate = this.extractTag(itemXml, ['pubDate', 'published', 'updated', 'dc:date']);
      const author = this.extractTag(itemXml, ['author', 'dc:creator', 'name']);
      const guid = this.extractTag(itemXml, ['guid', 'id']) || link;

      if (!title || !link) continue;

      items.push({
        id: this.hashString(guid || `${feed.name}:${title}`),
        title: title.trim(),
        link: link.trim(),
        description,
        source: feed.name,
        sourceUrl: feed.url,
        publishedAt: pubDate ? new Date(pubDate) : new Date(),
        author: author?.trim() || undefined,
        categories: this.extractCategories(itemXml),
        sentiment: this.estimateSentiment(title + ' ' + description),
        isAIBranded: this.isAIBranded(title + ' ' + description)
      });
    }

    return items;
  }

  private extractTag(xml: string, tags: string[]): string {
    for (const tag of tags) {
      // 标准标签
      const standardRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      let match = xml.match(standardRegex);
      if (match?.[1]) return this.decodeHtmlEntities(match[1].trim());

      // CDATA 包裹
      const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tag}>`, 'i');
      match = xml.match(cdataRegex);
      if (match?.[1]) return this.decodeHtmlEntities(match[1].trim());
    }
    return '';
  }

  private extractAtomLink(xml: string): string {
    // Atom 格式: <link href="..." rel="alternate"/>
    const match = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
    if (match?.[1]) return match[1];
    // 简化: <link>url</link>
    return this.extractTag(xml, ['link']);
  }

  private extractCategories(xml: string): string[] {
    const cats: string[] = [];
    const regex = /<category[^>]*>([^<]+)<\/category>/gi;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      cats.push(match[1].trim());
    }
    return cats;
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private filterByKeywords(items: RSSNewsItem[], feed: RSSFeedConfig): RSSNewsItem[] {
    if (!feed.keywords?.length && !feed.excludeKeywords?.length) {
      return items;
    }

    return items.filter(item => {
      const text = (item.title + ' ' + item.description).toLowerCase();

      // 排除关键词
      if (feed.excludeKeywords?.length) {
        if (feed.excludeKeywords.some(kw => text.includes(kw.toLowerCase()))) {
          return false;
        }
      }

      // 包含关键词（如果定义了的话）
      if (feed.keywords?.length) {
        return feed.keywords.some(kw => text.includes(kw.toLowerCase()));
      }

      return true;
    });
  }

  private estimateSentiment(text: string): 'positive' | 'neutral' | 'negative' {
    const lower = text.toLowerCase();
    const pos = ['launch', 'announce', 'release', 'breakthrough', 'amazing', 'revolutionary',
      'free', 'open source', 'improve', 'best', 'new'];
    const neg = ['fail', 'break', 'bug', 'issue', 'problem', 'lawsuit', 'ban', 'scandal',
      'disappoint', 'difficult', 'expensive', 'layoff', 'cut'];

    const posCount = pos.filter(w => lower.includes(w)).length;
    const negCount = neg.filter(w => lower.includes(w)).length;

    if (posCount > negCount + 1) return 'positive';
    if (negCount > posCount + 1) return 'negative';
    return 'neutral';
  }

  private isAIBranded(text: string): boolean {
    const aiTerms = [
      'AI', 'artificial intelligence', 'machine learning', 'LLM', 'GPT',
      'Claude', 'Gemini', 'ChatGPT', 'OpenAI', 'Anthropic', 'Hugging Face',
      'Stable Diffusion', 'Midjourney', 'LangChain', 'RAG', 'RAG', 'neural',
      'transformer', 'diffusion model', 'embedding', 'fine-tuning'
    ];
    const lower = text.toLowerCase();
    return aiTerms.some(term => lower.includes(term.toLowerCase()));
  }

  private deduplicateByTitle(items: RSSNewsItem[]): RSSNewsItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================
// 便捷函数
// ============================================================

export function createNewsRssFetcher(
  config?: RSSFetcherConfig,
  logger?: (msg: string) => void
): NewsRssFetcher {
  return new NewsRssFetcher(config, logger);
}

export async function fetchAINews(
  config?: RSSFetcherConfig,
  logger?: (msg: string) => void
): Promise<RSSNewsItem[]> {
  const fetcher = new NewsRssFetcher(config, logger);
  return fetcher.fetchAll();
}
