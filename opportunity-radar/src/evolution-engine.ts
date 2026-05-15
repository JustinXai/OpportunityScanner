// Opportunity Radar - 自我进化引擎
// 1. 关键词裂变：根据采集结果自动生成新关键词
// 2. 防重复采集：基于扫描缓存，一轮只采集一次
// 3. 查询性能跟踪：记录每个查询的产出效率

import * as fs from 'fs';
import * as path from 'path';
import type { RawSignal } from './types.js';

interface QueryPerformance {
  query: string;
  results: number;
  goldSignals: number;
  lastRun: string;
}

interface LearnedData {
  successfulKeywords: string[];
  failedKeywords: string[];
  ignoredPatterns: string[];
  evolvedSearchQueries: Record<string, string[]>;
  queryPerformance: Record<string, QueryPerformance>;
  platformKeywordPool: Record<string, string[]>;
  lastUpdated: string;
  evolutionVersion: number;
}

interface ScanCache {
  scannedSignals: Record<string, {
    lastScanned: string;
    result: 'gold' | 'low_quality' | 'skip' | 'unknown';
  }>;
  scannedQueries: Record<string, string>;
  lastScanRun: string;
}

// ============ 扫描缓存 ============

const CACHE_FILE = path.join(process.cwd(), 'logs', 'scanned_cache.json');

export class ScanCacheManager {
  private cache: ScanCache;

  constructor() {
    this.cache = this.loadCache();
  }

  private loadCache(): ScanCache {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      }
    } catch {}
    return { scannedSignals: {}, scannedQueries: {}, lastScanRun: '' };
  }

  save(): void {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  /**
   * 检查是否已扫描过此 URL/标题
   */
  hasScanned(url: string, title: string): boolean {
    const key = this.normalizeKey(url || title);
    return key in this.cache.scannedSignals;
  }

  /**
   * 标记为已扫描
   */
  markScanned(url: string, title: string, result: 'gold' | 'low_quality' | 'skip' | 'unknown' = 'unknown'): void {
    const key = this.normalizeKey(url || title);
    this.cache.scannedSignals[key] = {
      lastScanned: new Date().toISOString(),
      result
    };
  }

  /**
   * 批量标记已扫描
   */
  markScannedBatch(signals: RawSignal[], results?: Record<string, 'gold' | 'low_quality' | 'skip' | 'unknown'>): void {
    for (const signal of signals) {
      const key = this.normalizeKey(signal.source_url || signal.source_title);
      this.cache.scannedSignals[key] = {
        lastScanned: new Date().toISOString(),
        result: results?.[signal.id] || 'unknown'
      };
    }
  }

  /**
   * 检查查询是否已执行过
   */
  hasQueryRun(query: string): boolean {
    const key = this.normalizeKey(query);
    return key in this.cache.scannedQueries;
  }

  /**
   * 标记查询已执行
   */
  markQueryRun(query: string): void {
    const key = this.normalizeKey(query);
    this.cache.scannedQueries[key] = new Date().toISOString();
  }

  /**
   * 更新最后扫描时间
   */
  updateLastScan(): void {
    this.cache.lastScanRun = new Date().toISOString();
  }

  /**
   * 过滤重复信号
   */
  filterDuplicates(signals: RawSignal[]): RawSignal[] {
    return signals.filter(s => !this.hasScanned(s.source_url, s.source_title));
  }

  /**
   * 获取统计
   */
  getStats(): { totalScanned: number; goldSignals: number; lastRun: string } {
    const goldSignals = Object.values(this.cache.scannedSignals)
      .filter(s => s.result === 'gold').length;

    return {
      totalScanned: Object.keys(this.cache.scannedSignals).length,
      goldSignals,
      lastRun: this.cache.lastScanRun
    };
  }

  private normalizeKey(str: string): string {
    return str.toLowerCase().trim().substring(0, 200);
  }
}

// ============ 进化引擎 ============

const LEARNING_FILE = path.join(process.cwd(), 'logs', 'learning_data.json');

export class EvolutionEngine {
  private learned: LearnedData;
  private cache: ScanCacheManager;

  constructor(cache: ScanCacheManager) {
    this.cache = cache;
    this.learned = this.loadLearned();
  }

  private loadLearned(): LearnedData {
    try {
      if (fs.existsSync(LEARNING_FILE)) {
        return JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf-8'));
      }
    } catch {}
    return {
      successfulKeywords: [],
      failedKeywords: [],
      ignoredPatterns: [],
      evolvedSearchQueries: {},
      queryPerformance: {},
      platformKeywordPool: {
        twitter: [],
        reddit: [],
        chromeStore: [],
        vscode: [],
        hackernews: [],
        indiehackers: []
      },
      lastUpdated: new Date().toISOString(),
      evolutionVersion: 1
    };
  }

  save(): void {
    fs.mkdirSync(path.dirname(LEARNING_FILE), { recursive: true });
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(this.learned, null, 2), 'utf-8');
  }

  /**
   * 记录查询性能
   */
  recordQueryPerformance(platform: string, query: string, results: number, goldSignals: number): void {
    const key = `${platform}:${query}`;
    this.learned.queryPerformance[key] = {
      query,
      results,
      goldSignals,
      lastRun: new Date().toISOString()
    };

    // 更新关键词池
    if (results > 5) {
      this.addToKeywordPool(platform, query);
    }

    // 记录成功/失败
    if (goldSignals > 0) {
      this.recordSuccess(query);
    } else if (results > 0) {
      this.recordFailure(query);
    }

    this.learned.lastUpdated = new Date().toISOString();
  }

  /**
   * 从结果中裂变新关键词
   */
  fissionKeywords(platform: string, signals: RawSignal[], results: RawSignal[]): string[] {
    const newKeywords: string[] = [];

    for (const signal of results) {
      // 提取高价值词
      const words = this.extractKeywords(signal.raw_content + ' ' + signal.source_title);

      for (const word of words) {
        // 跳过已知的
        if (this.isKnownKeyword(word)) continue;

        // 跳过太短或太长的
        if (word.length < 3 || word.length > 40) continue;

        newKeywords.push(word);
      }
    }

    // 去重并限制数量
    const unique = [...new Set(newKeywords)].slice(0, 20);

    // 添加到关键词池
    for (const kw of unique) {
      this.addToKeywordPool(platform, kw);
    }

    return unique;
  }

  /**
   * 获取下一轮搜索词
   */
  getNextKeywords(platform: string, baseKeywords: string[]): string[] {
    const pool = this.learned.platformKeywordPool[platform] || [];

    // 优先使用成功的关键词
    const successfulPool = this.learned.successfulKeywords;

    // 组合：基础词 + 成功词 + 池中词
    const all = [...new Set([...baseKeywords, ...successfulPool, ...pool])];

    // 过滤已在本轮运行过的
    return all.filter(k => !this.cache.hasQueryRun(k));
  }

  /**
   * 获取查询性能排名
   */
  getTopQueries(platform: string, limit: number = 10): string[] {
    const prefix = `${platform}:`;
    const entries = Object.entries(this.learned.queryPerformance)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => ({ ...v, query: k.replace(prefix, '') }))
      .sort((a, b) => b.goldSignals - a.goldSignals)
      .slice(0, limit);

    return entries.map(e => e.query);
  }

  /**
   * 添加到关键词池
   */
  addToKeywordPool(platform: string, keyword: string): void {
    if (!this.learned.platformKeywordPool[platform]) {
      this.learned.platformKeywordPool[platform] = [];
    }

    const pool = this.learned.platformKeywordPool[platform];
    if (!pool.includes(keyword)) {
      pool.push(keyword);
      // 限制池大小
      if (pool.length > 100) {
        pool.splice(0, pool.length - 100);
      }
    }
  }

  /**
   * 记录成功的关键词
   */
  recordSuccess(keyword: string): void {
    if (!this.learned.successfulKeywords.includes(keyword)) {
      this.learned.successfulKeywords.push(keyword);
    }
    // 从失败列表移除
    const failIdx = this.learned.failedKeywords.indexOf(keyword);
    if (failIdx > -1) {
      this.learned.failedKeywords.splice(failIdx, 1);
    }
  }

  /**
   * 记录失败的关键词
   */
  recordFailure(keyword: string): void {
    if (!this.learned.failedKeywords.includes(keyword)) {
      this.learned.failedKeywords.push(keyword);
    }
  }

  /**
   * 从内容提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 提取工具名、产品名、问题描述
    const patterns = [
      /(?:alternative|replacement|替代|instead of)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g,
      /(?:broken|not working|失效|崩溃)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g,
      /(?:need|looking for|需要|寻找)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g,
      /(?:alternative|替代)\s+to\s+([A-Z][a-zA-Z]+)/gi,
      /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:alternative|replacement|替代)/gi,
    ];

    const keywords: string[] = [];
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          keywords.push(match[1].trim());
        }
      }
    }

    return keywords;
  }

  /**
   * 检查是否为已知关键词
   */
  private isKnownKeyword(keyword: string): boolean {
    const lower = keyword.toLowerCase();
    return (
      this.learned.successfulKeywords.some(k => k.toLowerCase() === lower) ||
      this.learned.failedKeywords.some(k => k.toLowerCase() === lower)
    );
  }

  /**
   * 获取进化统计
   */
  getStats(): { version: number; successfulCount: number; poolSizes: Record<string, number> } {
    return {
      version: this.learned.evolutionVersion,
      successfulCount: this.learned.successfulKeywords.length,
      poolSizes: Object.fromEntries(
        Object.entries(this.learned.platformKeywordPool)
          .map(([k, v]) => [k, v.length])
      )
    };
  }
}
