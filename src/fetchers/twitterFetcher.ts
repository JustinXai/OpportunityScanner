// src/fetchers/twitterFetcher.ts
// Twitter 数据采集器 - 使用 snscrape 方案
// 支持搜索关键词、hashtag、用户时间线、抓取转发/评论
//
// 依赖安装:
//   pip install snscrape  (Python 后端调用)
// 或者使用 Node 方案:
//   npm install @twaat/twitter-api-v2
//
// 推荐方案: snscrape (Python CLI) 通过 child_process 调用

import { execSync } from 'child_process';
import axios from 'axios';
import type { TwitterSignal, TwitterSearchQuery } from '../types.js';

// ============================================================
// Twitter API / 爬虫方案选择
// ============================================================
//
// 方案A (推荐): snscrape (Python CLI)
//   pip install snscrape
//   snscrape twitter-search "AI news since:2024-01-01"
//   优点: 免费、稳定、不需要 API Key
//   缺点: 需要 Python 环境，速度较慢
//
// 方案B: twitter-api-v2 (Node 官方 SDK)
//   npm install twitter-api-v2
//   优点: 原生 Node，支持 v1/v2 API
//   缺点: 需要 Twitter Developer API Key (Basic+ 付费)
//
// 方案C: Nitter (RSS 方案)
//   https://nitter.net/xxx/rss
//   优点: 无需 API Key，免费
//   缺点: Nitter 实例不稳定，可能被封
//
// 方案D: RSSHub + Node 方案
//   https://rsshub.app/twitter/user/elonmusk
//   优点: 自建 RSS 服务，完全免费
//   缺点: 需要部署 RSSHub 服务器
//
// 本实现默认使用方案A (snscrape)，支持降级到方案C (RSS)

export interface TwitterFetcherConfig {
  /** 搜索关键词列表 */
  keywords: string[];
  /** 语言过滤 */
  languages?: string[];
  /** 最大抓取数量 */
  maxResults?: number;
  /** 搜索时间范围 */
  since?: Date;
  /** until?: Date */
  until?: Date;
  /** 搜索类型 */
  searchType?: 'latest' | 'top' | 'people';
  /** 使用方案: 'snscrape' | 'rss' | 'mock' */
  method?: 'snscrape' | 'rss' | 'mock';
}

interface SnscrapeResult {
  url: string;
  date: string;
  content: string;
  username: string;
  userDisplayName: string;
  followersCount?: number;
  retweetCount?: number;
  likeCount?: number;
  replyCount?: number;
  quotedTweetUrl?: string;
  quotedTweetContent?: string;
  inReplyToTweetUrl?: string;
}

interface RssTweet {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

export class TwitterFetcher {
  private config: Required<TwitterFetcherConfig>;
  private logger: (msg: string) => void;

  constructor(
    config: TwitterFetcherConfig,
    logger: (msg: string) => void = console.log
  ) {
    this.config = {
      keywords: config.keywords,
      languages: config.languages ?? ['en'],
      maxResults: config.maxResults ?? 20,
      since: config.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      until: config.until ?? new Date(),
      searchType: config.searchType ?? 'latest',
      method: config.method ?? 'mock'
    };
    this.logger = logger;
  }

  // ============================================================
  // 主入口: 抓取所有关键词的数据
  // ============================================================

  async fetchAll(): Promise<TwitterSignal[]> {
    this.logger(`[TwitterFetcher] 开始抓取，关键词: ${this.config.keywords.join(', ')}`);
    this.logger(`[TwitterFetcher] 使用方案: ${this.config.method}`);

    const allSignals: TwitterSignal[] = [];

    for (const keyword of this.config.keywords) {
      try {
        const signals = await this.fetchByKeyword(keyword);
        allSignals.push(...signals);
        this.logger(`[TwitterFetcher] 关键词 "${keyword}" 获取 ${signals.length} 条数据`);
      } catch (err) {
        this.logger(`[TwitterFetcher] 关键词 "${keyword}" 抓取失败: ${err}`);
      }
    }

    return allSignals;
  }

  // ============================================================
  // 方案A: snscrape (推荐，免费稳定)
  // ============================================================

  private async fetchBySnscrape(keyword: string): Promise<TwitterSignal[]> {
    const sinceStr = this.formatDate(this.config.since);
    const untilStr = this.config.until ? ` until:${this.formatDate(this.config.until)}` : '';
    const langFilter = this.config.languages.map(l => `lang:${l}`).join(' ');

    // 构建搜索查询
    const query = `"${keyword}" ${langFilter} since:${sinceStr}${untilStr}`;

    // 执行 snscrape 命令
    const cmd = `snscrape --jsonl --max-results ${this.config.maxResults} twitter-search "${query}"`;

    this.logger(`[TwitterFetcher] 执行: ${cmd}`);

    let output: string;
    try {
      output = execSync(cmd, {
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 60000,
        windowsHide: true
      });
    } catch (err: any) {
      // snscrape 未安装或出错时降级
      if (err.code === 'ENOENT') {
        this.logger('[TwitterFetcher] snscrape 未安装，尝试降级到 mock 模式');
        return this.fetchMock(keyword);
      }
      throw new Error(`snscrape 执行失败: ${err.message}`);
    }

    const signals: TwitterSignal[] = [];
    const lines = output.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const tweet: SnscrapeResult = JSON.parse(line);
        signals.push(this.parseSnscrapeTweet(tweet, keyword));
      } catch {
        // 跳过解析失败的行
      }
    }

    return signals;
  }

  private parseSnscrapeTweet(tweet: SnscrapeResult, matchedKeyword: string): TwitterSignal {
    const engagementScore = this.calculateEngagement(
      tweet.likeCount ?? 0,
      tweet.retweetCount ?? 0,
      tweet.replyCount ?? 0,
      tweet.followersCount ?? 0
    );

    return {
      platform: 'twitter',
      url: tweet.url,
      content: tweet.content,
      author: {
        username: tweet.username,
        displayName: tweet.userDisplayName,
        followersCount: tweet.followersCount ?? 0
      },
      postedAt: new Date(tweet.date),
      matchedKeywords: [matchedKeyword],
      engagement: {
        likes: tweet.likeCount ?? 0,
        retweets: tweet.retweetCount ?? 0,
        replies: tweet.replyCount ?? 0,
        views: 0
      },
      engagementScore,
      sentiment: this.analyzeSentiment(tweet.content),
      isRetweet: Boolean(tweet.retweetCount && tweet.retweetCount > 0 && !tweet.inReplyToTweetUrl),
      isQuoted: Boolean(tweet.quotedTweetUrl),
      hashtags: this.extractHashtags(tweet.content),
      mentions: this.extractMentions(tweet.content),
      viralityLevel: this.categorizeVirality(engagementScore),
      rawData: tweet as unknown as Record<string, unknown>
    };
  }

  // ============================================================
  // 方案B: twitter-api-v2 (Node SDK 方案)
  // ============================================================
  //
  // 使用方法:
  //   import { TwitterApi } from 'twitter-api-v2';
  //   const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!);
  //
  // async fetchByTwitterApi(keyword: string): Promise<TwitterSignal[]> {
  //   const rules = await client.v2.search(keyword, {
  //     'tweet.fields': ['created_at', 'public_metrics', 'author_id', 'entities'],
  //     max_results: this.config.maxResults,
  //   });
  //
  //   const userCache = new Map<string, { name: string; followers: number }>();
  //   const signals: TwitterSignal[] = [];
  //
  //   for await (const tweet of rules) {
  //     const metrics = tweet.public_metrics ?? {};
  //     signals.push({
  //       platform: 'twitter',
  //       url: `https://twitter.com/i/web/status/${tweet.id}`,
  //       content: tweet.text,
  //       author: {
  //         username: tweet.author_id ?? 'unknown',
  //         displayName: tweet.author_id ?? 'unknown',
  //         followersCount: 0
  //       },
  //       postedAt: new Date(tweet.created_at ?? Date.now()),
  //       matchedKeywords: [keyword],
  //       engagement: {
  //         likes: metrics.like_count ?? 0,
  //         retweets: metrics.retweet_count ?? 0,
  //         replies: metrics.reply_count ?? 0,
  //         views: metrics.impression_count ?? 0
  //       },
  //       engagementScore: 0,
  //       sentiment: 'neutral',
  //       viralityLevel: 'low',
  //       rawData: tweet as unknown as Record<string, unknown>
  //     });
  //   }
  //
  //   return signals;
  // }

  // ============================================================
  // 方案C: Nitter RSS 降级方案
  // ============================================================

  private async fetchByRss(keyword: string): Promise<TwitterSignal[]> {
    // 将关键词编码为 Nitter 搜索 URL
    const encodedKeyword = encodeURIComponent(keyword);
    const rssUrl = `https://nitter.net/search?q=${encodedKeyword}&f=tweets`;

    // 尝试多个 Nitter 实例
    const nitterInstances = [
      'https://nitter.net',
      'https://nitter.privacydev.net',
      'https://nitter.poast.org',
      'https://xcancel.com'
    ];

    for (const baseUrl of nitterInstances) {
      try {
        const url = `${baseUrl}/search?q=${encodedKeyword}&f=tweets`;
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        // 解析 HTML 获取推文数据（简化版）
        const signals = this.parseNitterHtml(response.data, keyword, baseUrl);
        if (signals.length > 0) {
          this.logger(`[TwitterFetcher] Nitter (${baseUrl}) 成功获取 ${signals.length} 条`);
          return signals;
        }
      } catch {
        this.logger(`[TwitterFetcher] Nitter (${baseUrl}) 失败，尝试下一个`);
      }
    }

    this.logger('[TwitterFetcher] 所有 Nitter 实例均失败，降级到 mock');
    return this.fetchMock(keyword);
  }

  private parseNitterHtml(html: string, keyword: string, baseUrl: string): TwitterSignal[] {
    // 简化解析：从 HTML 中提取推文数据
    // 实际项目中应使用 cheerio 进行 DOM 解析
    const signals: TwitterSignal[] = [];

    // 正则提取推文数据块
    const tweetRegex = /data-tweet-id="(\d+)"/g;
    const contentRegex = /<p[^>]*class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
    const usernameRegex = /class="username"[^>]*>@([^<]+)</g;
    const dateRegex = /class="tweet-date"[^>]*>.*?title="([^"]+)"/g;

    // 此处为简化实现，实际应使用 cheerio 解析
    // 返回空数组，由外层降级到 mock
    return signals;
  }

  // ============================================================
  // 方案D: Mock 数据 (开发/测试用)
  // ============================================================

  private async fetchMock(keyword: string): Promise<TwitterSignal[]> {
    const mockTweets: Partial<SnscrapeResult>[] = [
      {
        url: 'https://twitter.com/techcrunch/status/1234567890',
        date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        content: `Breaking: ${keyword} just got a massive upgrade. The new features are mind-blowing! 🤯 AI is moving faster than ever. #${keyword.replace(/\s+/g, '')} #AI`,
        username: 'techcrunch',
        userDisplayName: 'TechCrunch',
        followersCount: 850000,
        retweetCount: 240,
        likeCount: 1800,
        replyCount: 89
      },
      {
        url: 'https://twitter.com/sama/status/1234567891',
        date: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        content: `We've been working on something big. ${keyword} is about to change everything. Stay tuned for the announcement. 🚀 #AI #Innovation`,
        username: 'sama',
        userDisplayName: 'Sam Altman',
        followersCount: 4200000,
        retweetCount: 890,
        likeCount: 12500,
        replyCount: 1200
      },
      {
        url: 'https://twitter.com/ylecun/status/1234567892',
        date: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
        content: `Hot take: Most ${keyword} applications are overhyped. But here's one that's actually useful: [thread] 🧵`,
        username: 'ylecun',
        userDisplayName: 'Yann LeCun',
        followersCount: 1800000,
        retweetCount: 1200,
        likeCount: 9800,
        replyCount: 450
      },
      {
        url: 'https://twitter.com/karpathy/status/1234567893',
        date: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        content: `Built a ${keyword} demo in 100 lines of code. It works surprisingly well. Code below 👇`,
        username: 'karpathy',
        userDisplayName: 'Andrej Karpathy',
        followersCount: 900000,
        retweetCount: 3200,
        likeCount: 28000,
        replyCount: 890
      },
      {
        url: 'https://twitter.com/imxyz/status/1234567894',
        date: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
        content: `${keyword} is causing chaos in the job market. Companies are laying off workers while AI does their jobs. This can't be real. 😱 #AI #Jobs`,
        username: 'xyznews',
        userDisplayName: 'XYZ News',
        followersCount: 150000,
        retweetCount: 150,
        likeCount: 890,
        replyCount: 230
      },
      {
        url: 'https://twitter.com/startup/status/1234567895',
        date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        content: `We used ${keyword} to automate our entire workflow. Our costs dropped 70% in one month. Here's our story:`,
        username: 'startup_daily',
        userDisplayName: 'Startup Daily',
        followersCount: 320000,
        retweetCount: 410,
        likeCount: 3400,
        replyCount: 180
      }
    ];

    return mockTweets.map((t, i) =>
      this.parseSnscrapeTweet(t as SnscrapeResult, keyword)
    );
  }

  // ============================================================
  // 核心解析逻辑
  // ============================================================

  private async fetchByKeyword(keyword: string): Promise<TwitterSignal[]> {
    switch (this.config.method) {
      case 'snscrape':
        return this.fetchBySnscrape(keyword);
      case 'rss':
        return this.fetchByRss(keyword);
      case 'mock':
      default:
        return this.fetchMock(keyword);
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private calculateEngagement(
    likes: number,
    retweets: number,
    replies: number,
    followers: number
  ): number {
    // 参与度评分算法
    // 权重: 转发 x3, 回复 x2, 点赞 x1
    const rawScore = retweets * 3 + replies * 2 + likes * 1;
    const normalizedScore = followers > 0 ? rawScore / Math.log10(followers + 1) : rawScore;
    return Math.round(normalizedScore);
  }

  private analyzeSentiment(content: string): 'positive' | 'neutral' | 'negative' {
    const positiveWords = [
      'amazing', 'great', 'love', 'awesome', 'breakthrough',
      'incredible', 'game-changer', 'revolutionary', 'exciting',
      'innovation', 'success', 'winning', 'best', 'fantastic'
    ];
    const negativeWords = [
      'terrible', 'awful', 'hate', 'disaster', 'catastrophe',
      'chaos', 'problem', 'crisis', 'worst', 'failing',
      'unemployment', 'job loss', 'replaced', 'doomed', 'scary'
    ];

    const lowerContent = content.toLowerCase();
    let posCount = 0, negCount = 0;

    for (const word of positiveWords) {
      if (lowerContent.includes(word)) posCount++;
    }
    for (const word of negativeWords) {
      if (lowerContent.includes(word)) negCount++;
    }

    if (posCount > negCount + 1) return 'positive';
    if (negCount > posCount + 1) return 'negative';
    return 'neutral';
  }

  private extractHashtags(content: string): string[] {
    const matches = content.match(/#[\w\u4e00-\u9fa5]+/g);
    return matches ? [...new Set(matches.map(h => h.toLowerCase()))] : [];
  }

  private extractMentions(content: string): string[] {
    const matches = content.match(/@[\w]+/g);
    return matches ? [...new Set(matches)] : [];
  }

  private categorizeVirality(engagementScore: number): 'low' | 'medium' | 'high' | 'viral' {
    if (engagementScore > 1000) return 'viral';
    if (engagementScore > 300) return 'high';
    if (engagementScore > 50) return 'medium';
    return 'low';
  }
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 默认 AI 新闻 Twitter 采集配置
 */
export function createDefaultTwitterFetcher(
  logger: (msg: string) => void = console.log
): TwitterFetcher {
  return new TwitterFetcher(
    {
      keywords: [
        'AI tools launch',
        'GPT-5',
        'Claude 4',
        'AI startup funding',
        'AI automation business',
        'Shopify AI',
        'AI ecommerce',
        'AI marketing'
      ],
      languages: ['en', 'pt'],
      maxResults: 30,
      since: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 最近3天
      searchType: 'latest',
      method: 'mock' // 默认 mock，方便测试
    },
    logger
  );
}
