// Hacker News 数据采集器
// 采集开发者真实质疑和讨论

import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { RawSignal, SourceType } from '../types.js';

interface HNItem {
  id: number;
  title: string;
  url?: string;
  text?: string;
  by: string;
  score: number;
  time: number;
  descendants: number;
  kids?: number[];
  type: string;
}

export class HackerNewsRunner {
  private client: AxiosInstance;

  constructor() {
    // 使用 Algolia HN API
    this.client = axios.create({
      baseURL: 'https://hn.algolia.com/api/v1',
      headers: {
        'Accept': 'application/json'
      },
      timeout: 30000
    });
  }

  /**
   * 按关键词搜索
   */
  async search(keywords: string[], maxResults: number = 30): Promise<RawSignal[]> {
    console.log(`\n📰 [HackerNews] 搜索 HN 讨论...`);

    const signals: RawSignal[] = [];

    for (const keyword of keywords.slice(0, 5)) {
      try {
        const response = await this.client.get('/search', {
          params: {
            query: keyword,
            tags: 'story',
            hitsPerPage: Math.min(maxResults, 20)
          }
        });

        const hits = response.data.hits || [];

        for (const hit of hits) {
          signals.push(this.hitToSignal(hit, keyword));
        }

        console.log(`   🔍 "${keyword}": ${hits.length} 条结果`);

        await this.sleep(500);

      } catch (error: any) {
        console.log(`   ⚠️ 搜索 "${keyword}" 失败: ${error.message}`);
      }
    }

    // 去重
    const uniqueSignals = this.deduplicate(signals);

    console.log(`   ✅ 采集到 ${uniqueSignals.length} 个 HN 信号`);
    return uniqueSignals;
  }

  /**
   * 获取热门故事
   */
  async fetchTopStories(limit: number = 30): Promise<RawSignal[]> {
    console.log(`\n📰 [HackerNews] 获取热门故事...`);

    const signals: RawSignal[] = [];

    try {
      const response = await this.client.get('/search', {
        params: {
          query: '',
          tags: 'front_page',
          hitsPerPage: limit
        }
      });

      const hits = response.data.hits || [];

      for (const hit of hits) {
        const title = hit.title || '';
        // 只保留与技术/AI/API相关的
        if (this.isRelevant(title)) {
          signals.push(this.hitToSignal(hit, 'top-story'));
        }
      }

    } catch (error: any) {
      console.log(`   ❌ 获取热门故事失败: ${error.message}`);
    }

    console.log(`   ✅ 获取到 ${signals.length} 个热门 HN 信号`);
    return signals;
  }

  /**
   * 获取最新故事
   */
  async fetchRecentStories(days: number = 7): Promise<RawSignal[]> {
    console.log(`\n📰 [HackerNews] 获取最近故事...`);

    const signals: RawSignal[] = [];
    const keywords = [
      'AI', 'API', 'LLM', 'gateway', 'agent', 'MCP', 'billing',
      'startup', 'SaaS', 'developer tool'
    ];

    try {
      // 获取过去 N 天的故事
      const dateStr = this.getDateDaysAgo(days);

      for (const keyword of keywords) {
        const response = await this.client.get('/search', {
          params: {
            query: keyword,
            tags: 'story',
            hitsPerPage: 15,
            numericFilters: `created_at_i>${Math.floor(new Date(dateStr).getTime() / 1000)}`
          }
        });

        const hits = response.data.hits || [];

        for (const hit of hits) {
          signals.push(this.hitToSignal(hit, keyword));
        }

        await this.sleep(300);
      }

    } catch (error: any) {
      console.log(`   ❌ 获取最近故事失败: ${error.message}`);
    }

    const uniqueSignals = this.deduplicate(signals);

    console.log(`   ✅ 获取到 ${uniqueSignals.length} 个 HN 信号`);
    return uniqueSignals;
  }

  /**
   * HN Item 转信号
   */
  private hitToSignal(hit: any, matchedKeyword: string): RawSignal {
    const date = new Date(hit.created_at || hit.createdAt || Date.now());

    return {
      id: uuidv4(),
      source_type: 'hacker_news',
      source_url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source_title: hit.title || 'Untitled',
      source_date: date.toISOString().split('T')[0],
      raw_content: `${hit.title || ''}\n${hit.text || ''}\nPoints: ${hit.points || 0}, Comments: ${hit.num_comments || 0}`,
      discovered_at: new Date().toISOString(),
      keywords_matched: [matchedKeyword]
    };
  }

  /**
   * 检查是否相关
   */
  private isRelevant(title: string): boolean {
    const keywords = [
      'AI', 'API', 'LLM', 'gateway', 'agent', 'MCP', 'tool',
      'startup', 'SaaS', 'billing', 'developer', 'open-source'
    ];

    const lower = title.toLowerCase();
    return keywords.some(k => lower.includes(k.toLowerCase()));
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
   * 获取 N 天前的日期
   */
  private getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
