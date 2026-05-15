// Product Hunt 数据采集器 V2
// 使用 Serper 搜索 + 直接网页抓取
// 降级方案：无需 API Key

import axios from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import type { RawSignal } from '../types.js';
import { SerperClient } from '../serper-client.js';
import { ScanCacheManager, EvolutionEngine } from '../evolution-engine.js';

export class ProductHuntRunner {
  private serper: SerperClient;
  private evolution: EvolutionEngine;
  private cache: ScanCacheManager;

  constructor(cache: ScanCacheManager, evolution: EvolutionEngine) {
    this.cache = cache;
    this.evolution = evolution;
    this.serper = new SerperClient(cache);
  }

  /**
   * 获取最近的产品
   */
  async fetchRecentProducts(days: number = 7, limit: number = 50): Promise<RawSignal[]> {
    console.log(`\n🏆 [ProductHunt] 采集最近 ${days} 天的产品...`);

    const signals: RawSignal[] = [];

    // 方法1: Serper 搜索
    const keywords = [
      'AI tool launched', 'developer API product',
      'SaaS launch', 'GPT wrapper launched',
      'AI agent product', 'LLM tool launch'
    ];

    for (const keyword of keywords.slice(0, 8)) {
      const query = `"${keyword}" site:producthunt.com`;
      const results = await this.serper.searchWithDedup(query, { num: 15 });

      for (const item of results) {
        if (!item.link?.includes('producthunt.com/posts')) continue;

        signals.push({
          id: uuidv4(),
          source_type: 'product_hunt',
          source_url: item.link,
          source_title: item.title,
          source_date: new Date().toISOString().split('T')[0],
          raw_content: `${item.title}\n${item.snippet || ''}`,
          discovered_at: new Date().toISOString(),
          keywords_matched: [keyword]
        });

        this.cache.markScanned(item.link, item.title);
      }

      await this.sleep(1200);
    }

    // 方法2: 直接抓取 PH 首页（备用）
    if (signals.length < 10) {
      const fallbackSignals = await this.fetchViaDirectScrape(limit);
      signals.push(...fallbackSignals);
    }

    // 记录性能
    this.evolution.recordQueryPerformance('producthunt', 'recent', signals.length, 0);

    console.log(`   ✅ 采集到 ${signals.length} 个 Product Hunt 信号`);
    return signals;
  }

  /**
   * 直接抓取 Product Hunt
   */
  private async fetchViaDirectScrape(limit: number): Promise<RawSignal[]> {
    console.log(`   [ProductHunt] 尝试直接抓取...`);

    const signals: RawSignal[] = [];

    try {
      const response = await axios.get('https://www.producthunt.com/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);

      // 解析产品卡片
      $('a[href*="/posts/"]').each((_, el) => {
        if (signals.length >= limit) return false;

        const $el = $(el);
        const title = $el.find('h3, [data-test="post-title"]').text().trim();
        const link = 'https://producthunt.com' + $el.attr('href');
        const tagline = $el.find('[data-test="post-tagline"], p').text().trim();

        if (title && link && !this.cache.hasScanned(link, title)) {
          signals.push({
            id: uuidv4(),
            source_type: 'product_hunt',
            source_url: link,
            source_title: title,
            source_date: new Date().toISOString().split('T')[0],
            raw_content: `${title}\n${tagline}`,
            discovered_at: new Date().toISOString(),
            keywords_matched: []
          });

          this.cache.markScanned(link, title);
        }
      });

    } catch (error: any) {
      console.log(`   ⚠️ 直接抓取失败: ${error.message}`);
    }

    return signals;
  }

  /**
   * 按标签搜索
   */
  async searchByTag(tag: string, limit: number = 30): Promise<RawSignal[]> {
    console.log(`   🏆 [ProductHunt] 搜索 #${tag}...`);

    const query = `"${tag}" site:producthunt.com`;
    const results = await this.serper.searchWithDedup(query, { num: limit });

    const signals: RawSignal[] = [];

    for (const item of results) {
      if (!item.link?.includes('producthunt.com/posts')) continue;

      signals.push({
        id: uuidv4(),
        source_type: 'product_hunt',
        source_url: item.link,
        source_title: item.title,
        source_date: new Date().toISOString().split('T')[0],
        raw_content: `${item.title}\n${item.snippet || ''}`,
        discovered_at: new Date().toISOString(),
        keywords_matched: [tag]
      });

      this.cache.markScanned(item.link, item.title);
    }

    return signals;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
