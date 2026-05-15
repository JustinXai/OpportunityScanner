// Opportunity Radar V2 - 主入口
// 半自动扫描器
// 特性：防重复采集 + 搜索词裂变进化 + 一次性运行锁

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'yaml';
import 'dotenv/config';

import type { OpportunitySignal, ScanRun, RadarConfig } from './types.js';

// 数据源
import { ProductHuntRunner } from './sources/producthunt.js';
import { GitHubRunner } from './sources/github.js';
import { HackerNewsRunner } from './sources/hackernews.js';
import { RedditRunner } from './sources/reddit.js';
import { IndieHackersRunner } from './sources/indiehackers.js';
import { TelegramRunner } from './sources/telegram.js';
import { DevToRunner } from './sources/devto.js';
import { StackOverflowRunner } from './sources/stackoverflow.js';

// 进化引擎
import { ScanCacheManager, EvolutionEngine } from './evolution-engine.js';

// 分类器
import { SignalClassifier } from './classifiers/signal-classifier.js';

// 评分引擎
import { ScoringEngine } from './scoring/scoring-engine.js';

// 输出生成器
import { generateOutputFiles, generateRunRecord } from './generators/output-generator.js';

// 一次性运行锁
const LOCK_FILE = path.join(process.cwd(), 'logs', 'scan.lock');

function acquireLock(): boolean {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      const lockTime = new Date(lockData.time).getTime();
      const now = Date.now();
      const elapsed = (now - lockTime) / 1000 / 60; // 分钟

      if (elapsed < 60) {
        console.log(`\n🔒 扫描正在运行中 (已运行 ${Math.round(elapsed)} 分钟)`);
        console.log(`   上次启动: ${lockData.time}`);
        return false;
      }

      // 锁超时，删除旧锁
      fs.unlinkSync(LOCK_FILE);
    }

    // 创建新锁
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      time: new Date().toISOString(),
      pid: process.pid
    }), 'utf-8');

    return true;
  } catch {
    return true;
  }
}

function releaseLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {}
}

/**
 * Opportunity Radar V2
 */
export class OpportunityRadar {
  private config: RadarConfig;
  private runId: string;
  private cache: ScanCacheManager;
  private evolution: EvolutionEngine;

  constructor(config?: Partial<RadarConfig>) {
    this.runId = this.generateRunId();
    this.config = this.loadConfig(config);

    // 初始化进化引擎
    this.cache = new ScanCacheManager();
    this.evolution = new EvolutionEngine(this.cache);
  }

  /**
   * 加载配置
   */
  private loadConfig(overrides?: Partial<RadarConfig>): RadarConfig {
    const defaultConfig: RadarConfig = {
      deepseek_api_key: process.env.DEEPSEEK_API_KEY,
      serper_api_key: process.env.SERPER_API_KEY,
      ph_api_token: process.env.PH_API_TOKEN,
      github_token: process.env.GITHUB_TOKEN,
      enabled_sources: ['product_hunt', 'github', 'hacker_news', 'reddit', 'indie_hackers', 'telegram', 'dev_to', 'stack_overflow'],
      scan_interval_days: 2,
      max_signals_per_source: 50,
      build_threshold: 85,
      probe_threshold: 72,
      watch_threshold: 55,
      require_fit_for_build: 4,
      output_dir: './runs',
      runs_dir: './runs'
    };

    return { ...defaultConfig, ...overrides };
  }

  /**
   * 生成运行 ID
   */
  private generateRunId(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  /**
   * 加载关键词配置
   */
  private loadKeywords(): any {
    try {
      const configPath = path.join(process.cwd(), 'keywords.yaml');
      if (fs.existsSync(configPath)) {
        return yaml.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch {}
    return {};
  }

  /**
   * 运行扫描
   */
  async run(): Promise<ScanRun> {
    // 获取锁
    if (!acquireLock()) {
      console.log('❌ 已有扫描进程运行中，请等待完成或1小时后重试');
      process.exit(1);
    }

    console.log('='.repeat(60));
    console.log('🎯 OPPORTUNITY RADAR V2');
    console.log('📡 半自动扫描器 - Signal Event 驱动');
    console.log('🧠 引擎: DeepSeek 分类 + 规则评分');
    console.log('🔄 进化: 关键词裂变 + 防重复采集');
    console.log('='.repeat(60));
    console.log(`📅 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    console.log(`🔖 Run ID: ${this.runId}\n`);

    // 显示进化统计
    const evoStats = this.evolution.getStats();
    console.log(`📊 进化引擎 v${evoStats.version}:`);
    console.log(`   成功关键词: ${evoStats.successfulCount}`);
    console.log(`   关键词池: ${Object.entries(evoStats.poolSizes).map(([k, v]) => `${k}:${v}`).join(', ')}`);
    console.log('');

    // 显示缓存统计
    const cacheStats = this.cache.getStats();
    console.log(`💾 扫描缓存:`);
    console.log(`   已扫描信号: ${cacheStats.totalScanned}`);
    console.log(`   金矿信号: ${cacheStats.goldSignals}`);
    console.log('');

    const startTime = Date.now();

    const run: ScanRun = {
      run_id: this.runId,
      started_at: new Date().toISOString(),
      completed_at: '',
      sources_scanned: [],
      raw_signals_count: 0,
      classified_signals_count: 0,
      signals: [],
      summary: {
        ignore_count: 0,
        watch_count: 0,
        probe_count: 0,
        build_count: 0,
        merge_count: 0
      }
    };

    try {
      // ========== 第一步：采集原始信号 ==========
      console.log('\n📡 [STAGE 1] 采集原始信号...\n');

      const keywords = this.loadKeywords();
      const rawSignals = await this.collectSignals(keywords);

      console.log(`\n   📊 共采集 ${rawSignals.length} 条原始信号`);

      // 保存原始信号
      const rawJsonlPath = path.join(this.config.output_dir, this.runId, 'raw.jsonl');
      fs.mkdirSync(path.dirname(rawJsonlPath), { recursive: true });
      fs.writeFileSync(rawJsonlPath, rawSignals.map(s => JSON.stringify(s)).join('\n'), 'utf-8');

      run.raw_signals_count = rawSignals.length;

      // ========== 第二步：LLM 分类 ==========
      if (rawSignals.length > 0) {
        console.log('\n🧠 [STAGE 2] LLM 分类...\n');

        const classifier = new SignalClassifier({
          api_key: this.config.deepseek_api_key
        });

        const classifiedSignals = await classifier.classify(rawSignals);

        console.log(`\n   📊 成功分类 ${classifiedSignals.length} 条信号`);

        run.classified_signals_count = classifiedSignals.length;

        // ========== 第三步：评分和决策 ==========
        console.log('\n📊 [STAGE 3] 评分和决策...\n');

        const scoringEngine = new ScoringEngine({
          build_threshold: this.config.build_threshold,
          probe_threshold: this.config.probe_threshold,
          watch_threshold: this.config.watch_threshold,
          require_fit_for_build: this.config.require_fit_for_build
        });

        const scoredSignals = scoringEngine.scoreAll(classifiedSignals);

        // 更新摘要
        run.summary = scoringEngine.getSummary(scoredSignals);
        run.signals = scoredSignals;

        // ========== 第四步：生成输出文件 ==========
        console.log('\n📁 [STAGE 4] 生成输出文件...\n');

        await generateOutputFiles(scoredSignals, {
          output_dir: this.config.output_dir,
          run_id: this.runId
        });
      }

      // 生成运行记录
      run.completed_at = new Date().toISOString();
      generateRunRecord(run, this.config.output_dir);

      // 更新缓存
      this.cache.updateLastScan();
      this.cache.save();
      this.evolution.save();

      // ========== 完成 ==========
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log('\n' + '='.repeat(60));
      console.log('✅ 扫描完成！');
      console.log(`📊 总耗时: ${elapsed}s`);
      console.log(`📡 原始信号: ${run.raw_signals_count}`);
      console.log(`🧠 分类信号: ${run.classified_signals_count}`);
      console.log(`📈 BUILD: ${run.summary.build_count}`);
      console.log(`🔗 MERGE: ${run.summary.merge_count}`);
      console.log(`👀 PROBE: ${run.summary.probe_count}`);
      console.log(`🔭 WATCH: ${run.summary.watch_count}`);
      console.log(`🚫 IGNORE: ${run.summary.ignore_count}`);
      console.log('='.repeat(60));

    } catch (error: any) {
      console.error(`\n❌ 扫描失败: ${error.message}`);
      run.completed_at = new Date().toISOString();
    } finally {
      // 释放锁
      releaseLock();
    }

    return run;
  }

  /**
   * 采集信号
   */
  private async collectSignals(keywords: any): Promise<import('./types.js').RawSignal[]> {
    const allSignals: import('./types.js').RawSignal[] = [];
    const sources = this.config.enabled_sources;

    // Product Hunt
    if (sources.includes('product_hunt')) {
      try {
        const phRunner = new ProductHuntRunner(this.cache, this.evolution);
        const signals = await phRunner.fetchRecentProducts(7, 50);
        allSignals.push(...signals);
      } catch (error: any) {
        console.log(`   ⚠️ Product Hunt 采集失败: ${error.message}`);
      }
    }

    // GitHub
    if (sources.includes('github')) {
      try {
        const ghRunner = new GitHubRunner({ github_token: this.config.github_token });
        const topics = keywords?.github_topics || ['openai-api', 'llm-gateway', 'mcp', 'agent-framework'];
        const signals = await ghRunner.searchByTopics(topics, 15);
        allSignals.push(...signals);
      } catch (error: any) {
        console.log(`   ⚠️ GitHub 采集失败: ${error.message}`);
      }
    }

    // Hacker News
    if (sources.includes('hacker_news')) {
      try {
        const hnRunner = new HackerNewsRunner();
        const keywordList = [
          'AI gateway', 'LLM', 'MCP server', 'API billing', 'agent tools',
          'coding agent', 'model routing'
        ];
        const signals = await hnRunner.search(keywordList, 20);
        allSignals.push(...signals);
      } catch (error: any) {
        console.log(`   ⚠️ Hacker News 采集失败: ${error.message}`);
      }
    }

    // Reddit
    if (sources.includes('reddit')) {
      try {
        const redditRunner = new RedditRunner(this.cache, this.evolution);
        const painKeywords = keywords?.core_tracks?.ai_api_gateway?.pain_keywords || [
          'overcharged', 'fake model', 'quota disappeared', 'billing surprise'
        ];
        const moneyKeywords = keywords?.money_terms?.medium_value || [
          '$ MRR', 'paying customers', 'Stripe'
        ];
        const painSignals = await redditRunner.searchPainPoints(painKeywords);
        const moneySignals = await redditRunner.searchRevenue(moneyKeywords);
        allSignals.push(...painSignals, ...moneySignals);
      } catch (error: any) {
        console.log(`   ⚠️ Reddit 采集失败: ${error.message}`);
      }
    }

    // Indie Hackers
    if (sources.includes('indie_hackers')) {
      try {
        const ihRunner = new IndieHackersRunner(this.cache, this.evolution);
        const keywords = [
          'API billing', 'LLM cost', 'AI gateway', 'SaaS MRR', 'developer tool'
        ];
        const signals = await ihRunner.search(keywords, 20);
        allSignals.push(...signals);
      } catch (error: any) {
        console.log(`   ⚠️ Indie Hackers 采集失败: ${error.message}`);
      }
    }

    // Telegram
    if (sources.includes('telegram')) {
      try {
        const tgRunner = new TelegramRunner();
        const signals = await tgRunner.fetchAllChannels();
        allSignals.push(...signals);
      } catch (error: any) {
        console.log(`   ⚠️ Telegram 采集失败: ${error.message}`);
      }
    }

    // DEV.to
    if (sources.includes('dev_to')) {
      try {
        const devRunner = new DevToRunner();
        const signals = await devRunner.fetchAllTags();
        allSignals.push(...signals);
      } catch (error: any) {
        console.log(`   ⚠️ DEV.to 采集失败: ${error.message}`);
      }
    }

    // Stack Overflow
    if (sources.includes('stack_overflow')) {
      try {
        const soRunner = new StackOverflowRunner();
        const signals = await soRunner.fetchAllTags();
        allSignals.push(...signals);
      } catch (error: any) {
        console.log(`   ⚠️ Stack Overflow 采集失败: ${error.message}`);
      }
    }

    // 去重（基于扫描缓存）
    const uniqueSignals = this.cache.filterDuplicates(allSignals);

    return uniqueSignals;
  }
}

/**
 * 主函数
 */
async function main() {
  const radar = new OpportunityRadar();
  await radar.run();
}

// 运行
main().catch(console.error);
