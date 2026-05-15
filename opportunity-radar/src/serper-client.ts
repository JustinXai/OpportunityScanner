// Serper 搜索客户端
// 统一封装所有基于 Serper 的搜索请求
// 支持防重复采集和查询性能跟踪

import axios, { AxiosInstance } from 'axios';
import type { RawSignal } from './types.js';
import { ScanCacheManager } from './evolution-engine.js';

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  position?: number;
}

interface SearchOptions {
  site?: string;
  num?: number;
  gl?: string;
  hl?: string;
}

export class SerperClient {
  private client: AxiosInstance;
  private cache: ScanCacheManager;

  constructor(cache: ScanCacheManager) {
    this.cache = cache;
    this.client = axios.create({
      baseURL: 'https://google.serper.dev/search',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY || '',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
  }

  /**
   * 执行搜索
   */
  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SerperResult[]> {
    const { num = 10 } = options;

    try {
      const response = await this.client.post('', {
        q: query,
        num
      });

      return response.data?.organic || [];
    } catch (error: any) {
      console.log(`   ⚠️ 搜索失败 "${query}": ${error.message}`);
      return [];
    }
  }

  /**
   * 搜索并过滤已扫描的结果
   */
  async searchWithDedup(
    query: string,
    options: SearchOptions = {}
  ): Promise<SerperResult[]> {
    // 标记查询已运行
    this.cache.markQueryRun(query);

    const results = await this.search(query, options);

    // 过滤已扫描过的
    return results.filter(r => !this.cache.hasScanned(r.link, r.title));
  }

  /**
   * 批量搜索
   */
  async batchSearch(
    queries: string[],
    options: SearchOptions = {},
    delayMs: number = 1500
  ): Promise<Map<string, SerperResult[]>> {
    const results = new Map<string, SerperResult[]>();

    for (const query of queries) {
      // 检查是否已运行
      if (this.cache.hasQueryRun(query)) {
        console.log(`   ⏭️ 跳过已运行查询: "${query}"`);
        continue;
      }

      const items = await this.searchWithDedup(query, options);
      results.set(query, items);

      // 避免请求过快
      if (delayMs > 0) {
        await this.sleep(delayMs);
      }
    }

    return results;
  }

  /**
   * 搜索特定网站
   */
  async searchSite(
    keywords: string[],
    site: string,
    maxPerKeyword: number = 10
  ): Promise<RawSignal[]> {
    const signals: RawSignal[] = [];

    for (const keyword of keywords) {
      const query = `"${keyword}" site:${site}`;
      const results = await this.searchWithDedup(query, { num: maxPerKeyword });

      for (const item of results) {
        const signal = this.itemToSignal(item, keyword, site);
        if (signal) {
          signals.push(signal);
          this.cache.markScanned(item.link, item.title);
        }
      }

      await this.sleep(1200);
    }

    return signals;
  }

  /**
   * 通用搜索结果转信号
   */
  private itemToSignal(
    item: SerperResult,
    keyword: string,
    site: string
  ): RawSignal | null {
    const url = item.link || '';

    // 验证 URL
    if (!url || !url.includes(site)) return null;

    const title = item.title || '';

    return {
      id: '', // 由调用方生成
      source_type: this.siteToSourceType(site),
      source_url: url,
      source_title: title,
      source_date: new Date().toISOString().split('T')[0],
      raw_content: `${title}\n${item.snippet || ''}`,
      discovered_at: new Date().toISOString(),
      keywords_matched: [keyword]
    };
  }

  /**
   * 网站转源类型
   */
  private siteToSourceType(site: string): any {
    const mapping: Record<string, any> = {
      'reddit.com': 'reddit',
      'producthunt.com': 'product_hunt',
      'indiehackers.com': 'indie_hackers',
      'twitter.com': 'twitter',
      'x.com': 'twitter',
      'github.com': 'github'
    };

    return mapping[site] || 'manual';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
