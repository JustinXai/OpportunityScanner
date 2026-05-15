// Reddit 搜索采集器
// 采集真实抱怨和小 MRR 自曝

import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { RawSignal, SourceType } from '../types.js';

interface RedditConfig {
  serper_api_key?: string;
  keywords?: {
    reddit_search?: {
      subreddits?: string[];
      keywords?: string[];
    };
  };
}

export class RedditRunner {
  private client: AxiosInstance;
  private config: RedditConfig;

  constructor(config: RedditConfig = {}) {
    this.config = config;
    this.client = axios.create({
      baseURL: 'https://google.serper.dev/search',
      headers: {
        'X-API-KEY': config.serper_api_key || process.env.SERPER_API_KEY || '',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  /**
   * 搜索 Reddit
   */
  async search(keywords: string[], maxResults: number = 20): Promise<RawSignal[]> {
    console.log(`\n💬 [Reddit] 搜索 Reddit 讨论...`);

    const signals: RawSignal[] = [];

    for (const keyword of keywords.slice(0, 8)) {
      try {
        // 搜索 site:reddit.com
        const query = `"${keyword}" site:reddit.com`;

        const response = await this.client.post('', {
          q: query,
          num: maxResults
        });

        const items = response.data?.organic || [];

        for (const item of items) {
          const signal = this.itemToSignal(item, keyword);
          if (signal) {
            signals.push(signal);
          }
        }

        console.log(`   💬 "${keyword}": ${items.length} 条结果`);

        await this.sleep(1000);

      } catch (error: any) {
        console.log(`   ⚠️ 搜索 "${keyword}" 失败: ${error.message}`);
      }
    }

    const uniqueSignals = this.deduplicate(signals);

    console.log(`   ✅ 采集到 ${uniqueSignals.length} 个 Reddit 信号`);
    return uniqueSignals;
  }

  /**
   * 搜索特定子版
   */
  async searchSubreddits(keywords: string[], subreddits: string[]): Promise<RawSignal[]> {
    console.log(`\n💬 [Reddit] 搜索特定子版...`);

    const signals: RawSignal[] = [];

    for (const keyword of keywords.slice(0, 5)) {
      for (const subreddit of subreddits.slice(0, 5)) {
        try {
          const query = `"${keyword}" site:reddit.com/r/${subreddit}`;

          const response = await this.client.post('', {
            q: query,
            num: 10
          });

          const items = response.data?.organic || [];

          for (const item of items) {
            const signal = this.itemToSignal(item, keyword);
            if (signal) {
              signals.push(signal);
            }
          }

          await this.sleep(500);

        } catch (error: any) {
          console.log(`   ⚠️ 搜索 r/${subreddit} 失败`);
        }
      }
    }

    const uniqueSignals = this.deduplicate(signals);

    console.log(`   ✅ 采集到 ${uniqueSignals.length} 个子版信号`);
    return uniqueSignals;
  }

  /**
   * 搜索赚钱自曝
   */
  async searchRevenue(): Promise<RawSignal[]> {
    console.log(`\n💰 [Reddit] 搜索 MRR 自曝...`);

    const keywords = [
      '$ MRR', 'MRR in weeks', 'paying customers', 'first customer',
      'Stripe screenshot', 'TrustMRR', 'hit $', 'verified listing',
      'revenue', 'profit margin'
    ];

    return this.search(keywords, 15);
  }

  /**
   * 搜索痛点抱怨
   */
  async searchPainPoints(): Promise<RawSignal[]> {
    console.log(`\n😤 [Reddit] 搜索痛点抱怨...`);

    const keywords = [
      'overcharged', 'fake model', 'not working', 'refund',
      'quota disappeared', 'usage mismatch', 'token count wrong',
      'API key leaked', 'rate limited', 'billing surprise'
    ];

    return this.search(keywords, 15);
  }

  /**
   * Item 转信号
   */
  private itemToSignal(item: any, matchedKeyword: string): RawSignal | null {
    const url = item.link || '';

    // 只保留 Reddit 链接
    if (!url.includes('reddit.com')) return null;

    // 排除子版列表页
    if (url.includes('/r/') && !url.match(/\/r\/[\w]+\/comments\//)) return null;

    const title = item.title || '';

    return {
      id: uuidv4(),
      source_type: 'reddit',
      source_url: url,
      source_title: title,
      source_date: new Date().toISOString().split('T')[0],
      raw_content: `${title}\n${item.snippet || ''}`,
      discovered_at: new Date().toISOString(),
      keywords_matched: [matchedKeyword]
    };
  }

  /**
   * 去重
   */
  private deduplicate(signals: RawSignal[]): RawSignal[] {
    const seen = new Set<string>();
    return signals.filter(s => {
      if (seen.has(s.source_url)) return false;
      seen.add(s.source_url);
      return true;
    });
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
