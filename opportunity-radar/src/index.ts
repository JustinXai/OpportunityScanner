// Opportunity Radar V2 - 主入口
// 半自动扫描器

import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'yaml';

import type { OpportunitySignal, ScanRun, RadarConfig } from './types.js';

// 数据源
import { ProductHuntRunner } from './sources/producthunt.js';
import { GitHubRunner } from './sources/github.js';
import { HackerNewsRunner } from './sources/hackernews.js';
import { RedditRunner } from './sources/reddit.js';
import { IndieHackersRunner } from './sources/indiehackers.js';

// 分类器
import { SignalClassifier } from './classifiers/signal-classifier.js';

// 评分引擎
import { ScoringEngine } from './scoring/scoring-engine.js';

// 输出生成器
import { generateOutputFiles, generateRunRecord } from './generators/output-generator.js';

/**
 * Opportunity Radar V2
 */
export class OpportunityRadar {
  private config: RadarConfig;
  private runId: string;

  constructor(config?: Partial<RadarConfig>) {
    this.runId = this.generateRunId();
    this.config = this.loadConfig(config);
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
      enabled_sources: ['product_hunt', 'github', 'hacker_news', 'reddit', 'indie_hackers'],
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
    console.log('='.repeat(60));
    console.log('🎯 OPPORTUNITY RADAR V2');
    console.log('📡 半自动扫描器 - Signal Event 驱动');
    console.log('🧠 引擎: DeepSeek 分类 + 规则评分');
    console.log('='.repeat(60));
    console.log(`📅 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    console.log(`🔖 Run ID: ${this.runId}\n`);

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

      // 生成运行记录
      run.completed_at = new Date().toISOString();
      generateRunRecord(run, this.config.output_dir);

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
        const phRunner = new ProductHuntRunner({ ph_api_token: this.config.ph_api_token });
        const signals = await phRunner.fetchRecentProducts(7, 50);
        allSignals.push(...signals);
        this.addSource(sources, 'product_hunt');
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
        this.addSource(sources, 'github');
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
        this.addSource(sources, 'hacker_news');
      } catch (error: any) {
        console.log(`   ⚠️ Hacker News 采集失败: ${error.message}`);
      }
    }

    // Reddit
    if (sources.includes('reddit')) {
      try {
        const redditRunner = new RedditRunner({ serper_api_key: this.config.serper_api_key });

        // 痛点关键词
        const painKeywords = keywords?.core_tracks?.ai_api_gateway?.pain_keywords || [
          'overcharged', 'fake model', 'quota disappeared', 'billing surprise'
        ];

        // 赚钱自曝
        const moneyKeywords = keywords?.money_terms?.medium_value || [
          '$ MRR', 'paying customers', 'Stripe'
        ];

        const painSignals = await redditRunner.searchPainPoints();
        const moneySignals = await redditRunner.searchRevenue();

        allSignals.push(...painSignals, ...moneySignals);
        this.addSource(sources, 'reddit');
      } catch (error: any) {
        console.log(`   ⚠️ Reddit 采集失败: ${error.message}`);
      }
    }

    // Indie Hackers
    if (sources.includes('indie_hackers')) {
      try {
        const ihRunner = new IndieHackersRunner();
        const keywords = [
          'API billing', 'LLM cost', 'AI gateway', 'SaaS MRR', 'developer tool'
        ];
        const signals = await ihRunner.search(keywords, 20);
        allSignals.push(...signals);
        this.addSource(sources, 'indie_hackers');
      } catch (error: any) {
        console.log(`   ⚠️ Indie Hackers 采集失败: ${error.message}`);
      }
    }

    // 去重
    const uniqueSignals = this.deduplicateSignals(allSignals);

    return uniqueSignals;
  }

  /**
   * 添加已扫描的源
   */
  private addSource(sources: string[], source: string): void {
    // 跟踪已扫描的源
  }

  /**
   * 信号去重
   */
  private deduplicateSignals(signals: import('./types.js').RawSignal[]): import('./types.js').RawSignal[] {
    const seen = new Set<string>();
    return signals.filter(s => {
      const key = s.source_url || s.source_title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
