// Reddit 搜索采集器 V2
// 使用 Serper 搜索 + 进化引擎
// 支持关键词裂变和防重复采集

import { v4 as uuidv4 } from 'uuid';
import type { RawSignal } from '../types.js';
import { SerperClient } from '../serper-client.js';
import { ScanCacheManager, EvolutionEngine } from '../evolution-engine.js';

export class RedditRunner {
  private serper: SerperClient;
  private evolution: EvolutionEngine;
  private cache: ScanCacheManager;

  constructor(cache: ScanCacheManager, evolution: EvolutionEngine) {
    this.cache = cache;
    this.evolution = evolution;
    this.serper = new SerperClient(cache);
  }

  /**
   * 搜索 Reddit 痛点
   */
  async searchPainPoints(keywords?: string[]): Promise<RawSignal[]> {
    const baseKeywords = keywords || [
      'API broken', 'API not working', 'LLM cost too high',
      'overcharged', 'fake model', 'quota disappeared',
      'rate limited', 'billing surprise', 'API key leaked',
      'API gateway alternative', 'LLM proxy broken'
    ];

    console.log(`\n💬 [Reddit] 搜索痛点 (${baseKeywords.length} 个关键词)...`);

    // 获取进化后的关键词
    const evolvedKeywords = this.evolution.getNextKeywords('reddit', baseKeywords);
    const searchKeywords = evolvedKeywords.slice(0, 15);

    const signals: RawSignal[] = [];

    for (const keyword of searchKeywords) {
      const query = `"${keyword}" site:reddit.com`;
      const results = await this.serper.searchWithDedup(query, { num: 10 });

      for (const item of results) {
        if (!item.link?.includes('/r/') || !item.link?.includes('/comments/')) continue;

        signals.push({
          id: uuidv4(),
          source_type: 'reddit',
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
    this.evolution.recordQueryPerformance('reddit', 'pain_points', signals.length, 0);

    console.log(`   ✅ 采集到 ${signals.length} 个 Reddit 痛点信号`);
    return signals;
  }

  /**
   * 搜索赚钱自曝
   */
  async searchRevenue(keywords?: string[]): Promise<RawSignal[]> {
    const baseKeywords = keywords || [
      'MRR reached', '$ MRR', 'paying customers',
      'first revenue', 'Stripe screenshot', 'hit $',
      'SaaS revenue', 'side project income'
    ];

    console.log(`\n💰 [Reddit] 搜索 MRR 自曝...`);

    const evolvedKeywords = this.evolution.getNextKeywords('reddit', baseKeywords);
    const searchKeywords = evolvedKeywords.slice(0, 10);

    const signals: RawSignal[] = [];

    for (const keyword of searchKeywords) {
      const query = `"${keyword}" site:reddit.com`;
      const results = await this.serper.searchWithDedup(query, { num: 8 });

      for (const item of results) {
        if (!item.link?.includes('/r/')) continue;

        signals.push({
          id: uuidv4(),
          source_type: 'reddit',
          source_url: item.link,
          source_title: item.title,
          source_date: new Date().toISOString().split('T')[0],
          raw_content: `${item.title}\n${item.snippet || ''}`,
          discovered_at: new Date().toISOString(),
          keywords_matched: [keyword]
        });

        this.cache.markScanned(item.link, item.title);
      }

      await this.sleep(1000);
    }

    this.evolution.recordQueryPerformance('reddit', 'revenue', signals.length, 0);

    console.log(`   ✅ 采集到 ${signals.length} 个 Reddit 赚钱信号`);
    return signals;
  }

  /**
   * 搜索特定子版
   */
  async searchSubreddits(subreddits: string[], keywords: string[]): Promise<RawSignal[]> {
    console.log(`\n💬 [Reddit] 搜索特定子版...`);

    const signals: RawSignal[] = [];

    for (const subreddit of subreddits.slice(0, 5)) {
      for (const keyword of keywords.slice(0, 5)) {
        const query = `"${keyword}" site:reddit.com/r/${subreddit}`;
        const results = await this.serper.searchWithDedup(query, { num: 8 });

        for (const item of results) {
          signals.push({
            id: uuidv4(),
            source_type: 'reddit',
            source_url: item.link,
            source_title: item.title,
            source_date: new Date().toISOString().split('T')[0],
            raw_content: `${item.title}\n${item.snippet || ''}`,
            discovered_at: new Date().toISOString(),
            keywords_matched: [keyword, subreddit]
          });

          this.cache.markScanned(item.link, item.title);
        }

        await this.sleep(800);
      }
    }

    return signals;
  }

  /**
   * 从关键词裂变新搜索
   */
  async fissionAndSearch(baseKeywords: string[]): Promise<RawSignal[]> {
    console.log(`\n🔀 [Reddit] 关键词裂变搜索...`);

    // 先执行基础搜索获取结果
    const allResults: RawSignal[] = [];

    for (const kw of baseKeywords.slice(0, 10)) {
      const query = `"${kw}" site:reddit.com`;
      const results = await this.serper.searchWithDedup(query, { num: 15 });

      for (const item of results) {
        allResults.push({
          id: uuidv4(),
          source_type: 'reddit',
          source_url: item.link,
          source_title: item.title,
          source_date: new Date().toISOString().split('T')[0],
          raw_content: `${item.title}\n${item.snippet || ''}`,
          discovered_at: new Date().toISOString(),
          keywords_matched: [kw]
        });
      }

      await this.sleep(1000);
    }

    // 裂变新关键词
    const newKeywords = this.evolution.fissionKeywords('reddit', allResults, allResults);

    if (newKeywords.length > 0) {
      console.log(`   🧬 裂变出 ${newKeywords.length} 个新关键词: ${newKeywords.slice(0, 5).join(', ')}...`);

      // 用新关键词搜索
      for (const kw of newKeywords.slice(0, 10)) {
        const query = `"${kw}" site:reddit.com`;
        const results = await this.serper.searchWithDedup(query, { num: 10 });

        for (const item of results) {
          allResults.push({
            id: uuidv4(),
            source_type: 'reddit',
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

    console.log(`   ✅ 共采集 ${allResults.length} 个信号（含裂变）`);
    return allResults;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
