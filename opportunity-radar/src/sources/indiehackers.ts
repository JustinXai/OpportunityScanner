// Indie Hackers 采集器
// 采集 MRR 自曝和失败复盘

import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { RawSignal } from '../types.js';

export class IndieHackersRunner {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: 'https://google.serper.dev/search',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY || '',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  }

  /**
   * 搜索 Indie Hackers
   */
  async search(keywords: string[], maxResults: number = 20): Promise<RawSignal[]> {
    console.log(`\n💡 [IndieHackers] 搜索 Indie Hackers...`);

    const signals: RawSignal[] = [];

    for (const keyword of keywords.slice(0, 8)) {
      try {
        const query = `"${keyword}" site:indiehackers.com`;

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

        console.log(`   💡 "${keyword}": ${items.length} 条结果`);

        await this.sleep(1000);

      } catch (error: any) {
        console.log(`   ⚠️ 搜索 "${keyword}" 失败: ${error.message}`);
      }
    }

    const uniqueSignals = this.deduplicate(signals);

    console.log(`   ✅ 采集到 ${uniqueSignals.length} 个 Indie Hackers 信号`);
    return uniqueSignals;
  }

  /**
   * Item 转信号
   */
  private itemToSignal(item: any, matchedKeyword: string): RawSignal | null {
    const url = item.link || '';

    // 只保留 Indie Hackers 链接
    if (!url.includes('indiehackers.com')) return null;

    const title = item.title || '';

    return {
      id: uuidv4(),
      source_type: 'indie_hackers',
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
