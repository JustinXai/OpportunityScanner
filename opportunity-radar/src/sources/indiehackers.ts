// Indie Hackers 搜索采集器 V2
// 使用 Serper 搜索 + 进化引擎
// 采集真实创业者和独立开发者的讨论

import { v4 as uuidv4 } from 'uuid';
import type { RawSignal } from '../types.js';
import { SerperClient } from '../serper-client.js';
import { ScanCacheManager, EvolutionEngine } from '../evolution-engine.js';

export class IndieHackersRunner {
  private serper: SerperClient;
  private evolution: EvolutionEngine;
  private cache: ScanCacheManager;

  constructor(cache: ScanCacheManager, evolution: EvolutionEngine) {
    this.cache = cache;
    this.evolution = evolution;
    this.serper = new SerperClient(cache);
  }

  /**
   * 搜索 Indie Hackers
   */
  async search(keywords?: string[], maxResults: number = 20): Promise<RawSignal[]> {
    const baseKeywords = keywords || [
      'API billing SaaS', 'LLM cost tracking', 'AI gateway',
      'developer tool MRR', 'SaaS pricing', 'API monetization',
      'usage based billing', 'token billing', 'MCP server'
    ];

    console.log(`\n🚀 [IndieHackers] 搜索 (${baseKeywords.length} 个关键词)...`);

    // 获取进化后的关键词
    const evolvedKeywords = this.evolution.getNextKeywords('indiehackers', baseKeywords);
    const searchKeywords = evolvedKeywords.slice(0, 12);

    const signals: RawSignal[] = [];

    for (const keyword of searchKeywords) {
      const query = `"${keyword}" site:indiehackers.com`;
      const results = await this.serper.searchWithDedup(query, { num: maxResults });

      for (const item of results) {
        if (!item.link?.includes('indiehackers.com')) continue;

        signals.push({
          id: uuidv4(),
          source_type: 'indie_hackers',
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

    // 记录性能
    this.evolution.recordQueryPerformance('indiehackers', 'search', signals.length, 0);

    // 关键词裂变
    const newKeywords = this.evolution.fissionKeywords('indiehackers', signals, signals);
    if (newKeywords.length > 0) {
      console.log(`   🧬 裂变出 ${newKeywords.length} 个新关键词`);

      for (const kw of newKeywords.slice(0, 5)) {
        const query = `"${kw}" site:indiehackers.com`;
        const results = await this.serper.searchWithDedup(query, { num: 10 });

        for (const item of results) {
          signals.push({
            id: uuidv4(),
            source_type: 'indie_hackers',
            source_url: item.link,
            source_title: item.title,
            source_date: new Date().toISOString().split('T')[0],
            raw_content: `${item.title}\n${item.snippet || ''}`,
            discovered_at: new Date().toISOString(),
            keywords_matched: [kw, 'fission']
          });

          this.cache.markScanned(item.link, item.title);
        }

        await this.sleep(1000);
      }
    }

    console.log(`   ✅ 采集到 ${signals.length} 个 Indie Hackers 信号`);
    return signals;
  }

  /**
   * 搜索收入自曝
   */
  async searchRevenue(): Promise<RawSignal[]> {
    console.log(`\n💰 [IndieHackers] 搜索收入自曝...`);

    const keywords = [
      'MRR reached', 'revenue milestone', 'first $',
      'paying customers', 'SaaS growth', 'monthly revenue'
    ];

    const signals: RawSignal[] = [];

    for (const keyword of keywords) {
      const query = `"${keyword}" site:indiehackers.com`;
      const results = await this.serper.searchWithDedup(query, { num: 15 });

      for (const item of results) {
        signals.push({
          id: uuidv4(),
          source_type: 'indie_hackers',
          source_url: item.link,
          source_title: item.title,
          source_date: new Date().toISOString().split('T')[0],
          raw_content: `${item.title}\n${item.snippet || ''}`,
          discovered_at: new Date().toISOString(),
          keywords_matched: [keyword, 'revenue']
        });

        this.cache.markScanned(item.link, item.title);
      }

      await this.sleep(1000);
    }

    console.log(`   ✅ 采集到 ${signals.length} 个收入自曝`);
    return signals;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
