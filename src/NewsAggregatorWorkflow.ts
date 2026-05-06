// src/NewsAggregatorWorkflow.ts
// 全源新闻聚合工作流 - 多源并行采集 + 统一处理
//
// 流程: Fetch[RSS+arXiv+HN+Twitter] -> Merge -> Analyze -> Generate -> Send
//
// 使用方法:
//   import { NewsAggregatorWorkflow } from './NewsAggregatorWorkflow.js';
//   const workflow = new NewsAggregatorWorkflow(config);
//   await workflow.run();

import { TwitterFetcher } from './fetchers/twitterFetcher.js';
import { NewsRssFetcher, AI_NEWS_FEEDS } from './fetchers/newsRssFetcher.js';
import { ResearchFetcher } from './fetchers/researchFetcher.js';
import { HNAlgoliaFetcher, AI_KEYWORD_TEMPLATES } from './fetchers/hnAlgoliaFetcher.js';
import { MultiSourceMerger } from './services/MultiSourceMerger.js';
import { ContentGenerator, createDefaultContentGenerator } from './generators/ContentGenerator.js';
import { TwitterEmailService, createTwitterEmailService } from './services/TwitterEmailService.js';
import type {
  RSSNewsItem,
  ResearchItem,
  HackerNewsAlgoliaItem,
  TwitterSignal,
  UnifiedSignal,
  MultiSourceResult,
  AggregatorWorkflowState,
  TwitterContent
} from './types.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 配置
// ============================================================

export interface AggregatorConfig {
  /** 流程控制 */
  phases?: {
    fetchRSS?: boolean;
    fetchResearch?: boolean;
    fetchHN?: boolean;
    fetchTwitter?: boolean;
    merge?: boolean;
    analyze?: boolean;
    generateText?: boolean;
    generateImage?: boolean;
    sendEmail?: boolean;
  };
  /** RSS 配置 */
  rss?: {
    enabled?: boolean;
    feeds?: string[]; // feed name 列表，留空使用全部
    maxItemsPerFeed?: number;
  };
  /** Research 配置 */
  research?: {
    enabled?: boolean;
    arxivCategories?: string[];
    maxResults?: number;
    daysBack?: number;
    includeHuggingFace?: boolean;
  };
  /** HN Algolia 配置 */
  hn?: {
    enabled?: boolean;
    keywords?: string[];
    daysBack?: number;
    minScore?: number;
  };
  /** Twitter 配置 */
  twitter?: {
    enabled?: boolean;
    keywords?: string[];
    maxResults?: number;
    daysBack?: number;
    method?: 'snscrape' | 'rss' | 'mock';
  };
  /** Merger 配置 */
  merger?: {
    similarityThreshold?: number;
    maxSignals?: number;
    minScore?: number;
  };
  /** 生成器配置 */
  generator?: {
    apiKey: string;
    apiBase?: string;
    maxConcurrency?: number;
    maxTweetLength?: number;
    generateImage?: boolean;
  };
  /** 邮件配置 */
  email?: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
    to: string[];
  };
  logger?: (msg: string) => void;
  logDir?: string;
  outputDir?: string;
}

const DEFAULT_CONFIG: AggregatorConfig = {
  phases: {
    fetchRSS: true,
    fetchResearch: true,
    fetchHN: true,
    fetchTwitter: true,
    merge: true,
    analyze: true,
    generateText: true,
    generateImage: true,
    sendEmail: true
  },
  rss: { enabled: true, feeds: [], maxItemsPerFeed: 20 },
  research: { enabled: true, arxivCategories: ['cs.AI', 'cs.LG', 'cs.CL'], maxResults: 30, daysBack: 7, includeHuggingFace: true },
  hn: {
    enabled: true,
    keywords: AI_KEYWORD_TEMPLATES.modelRelease
      .concat(AI_KEYWORD_TEMPLATES.toolLaunch)
      .concat(AI_KEYWORD_TEMPLATES.devTools),
    daysBack: 3,
    minScore: 5
  },
  twitter: { enabled: true, keywords: ['AI tools launch', 'GPT-5', 'Claude 4', 'AI startup funding'], maxResults: 20, daysBack: 3, method: 'rss' },
  merger: { similarityThreshold: 0.75, maxSignals: 30, minScore: 0 },
  generator: { apiKey: '', apiBase: 'https://api1.link-ai.cc', maxConcurrency: 3, maxTweetLength: 250, generateImage: true },
  email: { host: '', port: 587, secure: false, user: '', pass: '', from: '', to: [] },
  logger: console.log,
  logDir: '/app/logs',
  outputDir: '/app/reports'
};

// ============================================================
// 主工作流
// ============================================================

export class NewsAggregatorWorkflow {
  private config: AggregatorConfig;
  private logger: (msg: string) => void;
  private state: AggregatorWorkflowState;

  private rssItems: RSSNewsItem[] = [];
  private researchItems: ResearchItem[] = [];
  private hnItems: HackerNewsAlgoliaItem[] = [];
  private twitterSignals: TwitterSignal[] = [];
  private mergedSignals: UnifiedSignal[] = [];
  private generatedContents: TwitterContent[] = [];

  constructor(config: AggregatorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = this.config.logger ?? console.log;
    this.state = this.initState();
  }

  private initState(): AggregatorWorkflowState {
    return {
      phase: 'fetch',
      progress: 0,
      sources: { rss: { fetched: 0 }, research: { fetched: 0 }, hn: { fetched: 0 }, twitter: { fetched: 0 } },
      mergedCount: 0,
      analyzedCount: 0,
      generatedCount: 0,
      sentCount: 0,
      errors: [],
      startedAt: new Date()
    };
  }

  async run(): Promise<AggregatorWorkflowState> {
    const startTime = Date.now();
    this.logBanner();

    try {
      // Phase 1: 并行采集所有源
      await this.phaseFetchAll();

      // Phase 2: 合并去重
      if (this.config.phases?.merge !== false) {
        await this.phaseMerge();
      }

      // Phase 3: 分析
      if (this.config.phases?.analyze !== false) {
        await this.phaseAnalyze();
      }

      // Phase 4: 生成文案+配图
      if (this.config.phases?.generateText !== false || this.config.phases?.generateImage !== false) {
        await this.phaseGenerate();
      }

      // Phase 5: 发送邮件
      if (this.config.phases?.sendEmail !== false) {
        await this.phaseSendEmail();
      }

      this.state.phase = 'complete';
      this.state.progress = 100;
      this.state.finishedAt = new Date();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logSuccess(elapsed);
      this.saveReport();

      return this.state;
    } catch (err: any) {
      this.state.phase = 'error';
      this.state.errors.push(err.message);
      this.state.finishedAt = new Date();
      this.logger(`[Workflow] 工作流异常: ${err.message}`);
      throw err;
    }
  }

  // ============================================================
  // Phase 1: 并行采集所有源
  // ============================================================

  private async phaseFetchAll(): Promise<void> {
    this.state.phase = 'fetch';
    this.state.progress = 10;
    this.logPhase('FETCH', '开始并行采集 4 个数据源...');

    const tasks: Promise<void>[] = [];

    // RSS 新闻
    if (this.config.phases?.fetchRSS !== false && this.config.rss?.enabled !== false) {
      tasks.push(this.fetchRSS());
    }

    // 研究论文
    if (this.config.phases?.fetchResearch !== false && this.config.research?.enabled !== false) {
      tasks.push(this.fetchResearch());
    }

    // HN Algolia
    if (this.config.phases?.fetchHN !== false && this.config.hn?.enabled !== false) {
      tasks.push(this.fetchHN());
    }

    // Twitter
    if (this.config.phases?.fetchTwitter !== false && this.config.twitter?.enabled !== false) {
      tasks.push(this.fetchTwitter());
    }

    const results = await Promise.allSettled(tasks);
    const failed = results.filter(r => r.status === 'rejected');

    if (failed.length > 0) {
      this.logger(`[Fetch] ${failed.length} 个源失败`);
    }

    this.state.progress = 35;
    this.logFetchSummary();
  }

  private async fetchRSS(): Promise<void> {
    const feeds = this.config.rss?.feeds?.length
      ? AI_NEWS_FEEDS.filter(f => this.config.rss!.feeds!.includes(f.name))
      : AI_NEWS_FEEDS;

    const fetcher = new NewsRssFetcher({
      feeds,
      maxItemsPerFeed: this.config.rss?.maxItemsPerFeed ?? 20
    }, msg => this.logger(`[RSS] ${msg}`));

    this.rssItems = await fetcher.fetchAll();
    this.state.sources.rss.fetched = this.rssItems.length;
  }

  private async fetchResearch(): Promise<void> {
    const fetcher = new ResearchFetcher({
      arxivCategories: this.config.research?.arxivCategories ?? ['cs.AI', 'cs.LG', 'cs.CL'],
      arxivMaxResults: this.config.research?.maxResults ?? 30,
      daysBack: this.config.research?.daysBack ?? 7,
      includeHuggingFace: this.config.research?.includeHuggingFace ?? true
    }, msg => this.logger(`[Research] ${msg}`));

    this.researchItems = await fetcher.fetchAll();
    this.state.sources.research.fetched = this.researchItems.length;
  }

  private async fetchHN(): Promise<void> {
    const fetcher = new HNAlgoliaFetcher({
      keywords: this.config.hn?.keywords ?? AI_KEYWORD_TEMPLATES.modelRelease
        .concat(AI_KEYWORD_TEMPLATES.toolLaunch)
        .concat(AI_KEYWORD_TEMPLATES.devTools),
      daysBack: this.config.hn?.daysBack ?? 3,
      minScore: this.config.hn?.minScore ?? 5
    }, msg => this.logger(`[HN] ${msg}`));

    this.hnItems = await fetcher.fetchAll();
    this.state.sources.hn.fetched = this.hnItems.length;
  }

  private async fetchTwitter(): Promise<void> {
    const daysBack = this.config.twitter?.daysBack ?? 3;
    const fetcher = new TwitterFetcher({
      keywords: this.config.twitter?.keywords ?? ['AI tools launch', 'GPT-5', 'Claude 4', 'AI startup funding'],
      maxResults: this.config.twitter?.maxResults ?? 20,
      since: new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000),
      method: this.config.twitter?.method ?? 'rss',
      languages: ['en', 'pt']
    }, msg => this.logger(`[Twitter] ${msg}`));

    this.twitterSignals = await fetcher.fetchAll();
    this.state.sources.twitter.fetched = this.twitterSignals.length;
  }

  private logFetchSummary(): void {
    const total = this.state.sources.rss.fetched +
      this.state.sources.research.fetched +
      this.state.sources.hn.fetched +
      this.state.sources.twitter.fetched;

    this.logger(`[Fetch] 采集汇总:`);
    this.logger(`         RSS: ${this.state.sources.rss.fetched} 条`);
    this.logger(`         Research: ${this.state.sources.research.fetched} 条`);
    this.logger(`         HN Algolia: ${this.state.sources.hn.fetched} 条`);
    this.logger(`         Twitter: ${this.state.sources.twitter.fetched} 条`);
    this.logger(`         总计: ${total} 条`);
  }

  // ============================================================
  // Phase 2: 合并去重
  // ============================================================

  private async phaseMerge(): Promise<void> {
    this.state.phase = 'merge';
    this.state.progress = 40;
    this.logPhase('MERGE', '开始合并多源数据...');

    const merger = new MultiSourceMerger(
      this.config.merger,
      msg => this.logger(`[Merge] ${msg}`)
    );

    const result: MultiSourceResult = merger.merge({
      rssItems: this.rssItems.length ? this.rssItems : undefined,
      researchItems: this.researchItems.length ? this.researchItems : undefined,
      hnItems: this.hnItems.length ? this.hnItems : undefined,
      twitterSignals: this.twitterSignals.length ? this.twitterSignals : undefined
    });

    this.mergedSignals = result.signals;
    this.state.mergedCount = result.signals.length;
    this.state.errors.push(...result.errors);

    this.logger(`[Merge] 来源分布:`);
    for (const breakdown of result.sourceBreakdown) {
      this.logger(`         ${breakdown.source}: ${breakdown.count} 条`);
    }

    this.state.progress = 50;
  }

  // ============================================================
  // Phase 3: 分析（复用 Twitter analyzer 的逻辑）
  // ============================================================

  private async phaseAnalyze(): Promise<void> {
    this.state.phase = 'analyze';
    this.state.progress = 55;
    this.logPhase('ANALYZE', '开始分析数据...');

    // 简单分析：统计标签、来源分布
    const tagFreq = new Map<string, number>();
    const sourceFreq = new Map<string, number>();

    for (const signal of this.mergedSignals) {
      sourceFreq.set(signal.source, (sourceFreq.get(signal.source) ?? 0) + 1);
      for (const tag of signal.tags) {
        tagFreq.set(tag, (tagFreq.get(tag) ?? 0) + 1);
      }
    }

    this.logger(`[Analyze] 来源分布:`);
    for (const [source, count] of sourceFreq) {
      this.logger(`         ${source}: ${count} 条`);
    }

    this.logger(`[Analyze] 热门标签: ${[...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}(${v})`).join(', ')}`);

    this.state.analyzedCount = this.mergedSignals.length;
    this.state.progress = 60;
  }

  // ============================================================
  // Phase 4: 生成文案+配图
  // ============================================================

  private async phaseGenerate(): Promise<void> {
    this.state.phase = 'generate';
    this.state.progress = 65;
    this.logPhase('GENERATE', '开始生成文案和配图...');

    if (!this.config.generator?.apiKey) {
      this.logger('[Generate] 未配置 LINKAI_API_KEY，跳过');
      return;
    }

    if (this.mergedSignals.length === 0) {
      this.logger('[Generate] 无数据，跳过');
      return;
    }

    const generator = createDefaultContentGenerator(
      this.config.generator.apiKey,
      msg => this.logger(`[Generate] ${msg}`)
    );

    // 将 UnifiedSignal 转换为 TwitterSignal 格式供 ContentGenerator 使用
    const twitterSignals: TwitterSignal[] = this.mergedSignals.map((signal, i) => ({
      platform: 'twitter',
      url: signal.url,
      content: `${signal.title}\n\n${signal.body}`.substring(0, 500),
      author: {
        username: signal.sourceName.replace(/[^a-zA-Z0-9_]/g, '_'),
        displayName: signal.sourceName,
        followersCount: 0
      },
      postedAt: signal.publishedAt,
      matchedKeywords: signal.tags,
      engagement: { likes: Math.floor(signal.score), retweets: 0, replies: 0, views: 0 },
      engagementScore: signal.score,
      sentiment: signal.sentiment,
      isRetweet: false,
      isQuoted: false,
      hashtags: signal.tags.slice(0, 5),
      mentions: [],
      viralityLevel: signal.score > 100 ? 'viral' : signal.score > 30 ? 'high' : signal.score > 10 ? 'medium' : 'low',
      rawData: signal.rawData as unknown as Record<string, unknown>
    }));

    this.generatedContents = await generator.generateAll(twitterSignals);
    this.state.generatedCount = this.generatedContents.length;

    this.logger(`[Generate] 成功生成 ${this.generatedContents.length} 条内容`);
    this.state.progress = 85;
  }

  // ============================================================
  // Phase 5: 发送邮件
  // ============================================================

  private async phaseSendEmail(): Promise<void> {
    this.state.phase = 'send';
    this.state.progress = 90;
    this.logPhase('EMAIL', '开始发送邮件...');

    if (this.generatedContents.length === 0) {
      this.logger('[Email] 无内容，跳过');
      return;
    }

    if (!this.config.email?.host || !this.config.email?.user || !this.config.email?.to?.length) {
      this.logger('[Email] SMTP 未配置完整，跳过');
      return;
    }

    const emailService = createTwitterEmailService({
      host: this.config.email.host,
      port: this.config.email.port ?? 587,
      secure: this.config.email.secure ?? false,
      user: this.config.email.user,
      pass: this.config.email.pass,
      from: this.config.email.from || `OpportunityScanner <${this.config.email.user}>`,
      to: this.config.email.to
    }, msg => this.logger(`[Email] ${msg}`));

    const connected = await emailService.verifyConnection();
    if (!connected) {
      this.state.errors.push('SMTP 连接失败');
      return;
    }

    const result = await emailService.sendReport(this.generatedContents);
    if (result.success) {
      this.state.sentCount = this.generatedContents.length;
      this.logger(`[Email] 发送成功: ${result.messageId}`);
    } else {
      this.state.errors.push(result.error ?? '邮件发送失败');
    }

    await emailService.close();
    this.state.progress = 100;
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private logBanner(): void {
    this.logger('');
    this.logger('╔════════════════════════════════════════════════════════╗');
    this.logger('║  📡 News Aggregator Workflow v4.0                   ║');
    this.logger('║  Multi-Source: RSS + arXiv + HN + Twitter          ║');
    this.logger('╚════════════════════════════════════════════════════════╝');
    this.logger('');
  }

  private logPhase(phase: string, message: string): void {
    this.logger('');
    this.logger(`▶ ${phase}: ${message}`);
    this.logger('─'.repeat(60));
  }

  private logSuccess(elapsed: string): void {
    this.logger('');
    this.logger('╔════════════════════════════════════════════════════════╗');
    this.logger('║  ✅ 工作流完成!                                      ║');
    this.logger('╠════════════════════════════════════════════════════════╣');
    this.logger(`║  📡 RSS:        ${String(this.state.sources.rss.fetched).padEnd(4)} 条                               ║`);
    this.logger(`║  📚 Research:   ${String(this.state.sources.research.fetched).padEnd(4)} 条                               ║`);
    this.logger(`║  🗞️  HN:        ${String(this.state.sources.hn.fetched).padEnd(4)} 条                               ║`);
    this.logger(`║  🐦 Twitter:    ${String(this.state.sources.twitter.fetched).padEnd(4)} 条                               ║`);
    this.logger(`║  🔀 合并去重:  ${String(this.state.mergedCount).padEnd(4)} 条                               ║`);
    this.logger(`║  ✍️  生成:      ${String(this.state.generatedCount).padEnd(4)} 条                               ║`);
    this.logger(`║  📧 发送:      ${String(this.state.sentCount).padEnd(4)} 条                               ║`);
    this.logger(`║  ⏱️  耗时:      ${elapsed.padEnd(8)} 秒                      ║`);
    if (this.state.errors.length > 0) {
      this.logger(`║  ⚠️  错误:      ${String(this.state.errors.length).padEnd(4)} 条                               ║`);
    }
    this.logger('╚════════════════════════════════════════════════════════╝');
    this.logger('');
  }

  private saveReport(): void {
    const outputDir = this.config.outputDir ?? '/app/reports';
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const basePath = path.join(outputDir, `aggregator-report-${timestamp}`);

      fs.writeFileSync(`${basePath}.json`, JSON.stringify({
        state: this.state,
        signals: this.mergedSignals.map(s => ({
          title: s.title,
          url: s.url,
          source: s.source,
          score: s.score,
          sentiment: s.sentiment
        })),
        contents: this.generatedContents.map(c => ({
          title: c.sourceSignal.content.substring(0, 60),
          text_en: c.texts.en,
          text_pt: c.texts.pt,
          imageUrl: c.imageUrl
        }))
      }, null, 2));

      const mdLines = [
        '# 📡 News Aggregator Report',
        `**${new Date().toLocaleString()}**`,
        '',
        '## Sources',
        `- RSS News: ${this.state.sources.rss.fetched}`,
        `- Research: ${this.state.sources.research.fetched}`,
        `- HN Algolia: ${this.state.sources.hn.fetched}`,
        `- Twitter: ${this.state.sources.twitter.fetched}`,
        '',
        `## Merged: ${this.state.mergedCount} signals`,
        `## Generated: ${this.state.generatedCount} tweets`,
        `## Sent: ${this.state.sentCount} emails`,
        '',
        '## Top Signals',
        ...this.mergedSignals.slice(0, 10).map((s, i) =>
          `${i + 1}. [${s.sourceName}] ${s.title}\n   ${s.url}`
        )
      ];

      fs.writeFileSync(`${basePath}.md`, mdLines.join('\n'));
      this.logger(`[Report] 已保存: ${basePath}.json`);
    } catch (err: any) {
      this.logger(`[Report] 保存失败: ${err.message}`);
    }
  }

  getState(): AggregatorWorkflowState {
    return { ...this.state };
  }

  getContents(): TwitterContent[] {
    return [...this.generatedContents];
  }

  getSignals(): UnifiedSignal[] {
    return [...this.mergedSignals];
  }
}

// ============================================================
// 环境变量配置
// ============================================================

export function createAggregatorConfigFromEnv(): AggregatorConfig {
  const {
    LINKAI_API_KEY = '',
    LINKAI_API_BASE = 'https://api1.link-ai.cc',
    SMTP_HOST = '',
    SMTP_PORT = '587',
    SMTP_SECURE = 'false',
    SMTP_USER = '',
    SMTP_PASS = '',
    SMTP_FROM = '',
    EMAIL_TO = '',
    RSS_FEEDS_ENABLED = 'true',
    RESEARCH_FEEDS_ENABLED = 'true',
    HN_ALGOLIA_ENABLED = 'true',
    TWITTER_ENABLED = 'true',
    TWITTER_DEFAULT_METHOD = 'rss',
    TWITTER_KEYWORDS = 'AI tools launch,GPT-5,Claude 4,AI startup funding',
    MAX_CONCURRENCY = '3',
    MAX_TWEET_LENGTH = '250',
    LOG_DIR = '/app/logs',
    OUTPUT_DIR = '/app/reports'
  } = process.env as Record<string, string>;

  const twitterKeywords = TWITTER_KEYWORDS.split(',').map(k => k.trim()).filter(Boolean);

  return {
    phases: {
      fetchRSS: RSS_FEEDS_ENABLED === 'true',
      fetchResearch: RESEARCH_FEEDS_ENABLED === 'true',
      fetchHN: HN_ALGOLIA_ENABLED === 'true',
      fetchTwitter: TWITTER_ENABLED === 'true',
      merge: true,
      analyze: true,
      generateText: true,
      generateImage: true,
      sendEmail: !!(SMTP_HOST && SMTP_USER && SMTP_PASS && EMAIL_TO)
    },
    twitter: {
      enabled: TWITTER_ENABLED === 'true',
      keywords: twitterKeywords,
      maxResults: 20,
      daysBack: 3,
      method: TWITTER_DEFAULT_METHOD as 'snscrape' | 'rss' | 'mock'
    },
    generator: {
      apiKey: LINKAI_API_KEY,
      apiBase: LINKAI_API_BASE,
      maxConcurrency: parseInt(MAX_CONCURRENCY),
      maxTweetLength: parseInt(MAX_TWEET_LENGTH),
      generateImage: true
    },
    email: {
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT),
      secure: SMTP_SECURE === 'true',
      user: SMTP_USER,
      pass: SMTP_PASS,
      from: SMTP_FROM || `OpportunityScanner <${SMTP_USER}>`,
      to: EMAIL_TO ? EMAIL_TO.split(',').map(e => e.trim()) : []
    },
    logDir: LOG_DIR,
    outputDir: OUTPUT_DIR
  };
}

export async function runAggregatorWorkflow(): Promise<AggregatorWorkflowState> {
  const config = createAggregatorConfigFromEnv();
  const workflow = new NewsAggregatorWorkflow(config);
  return workflow.run();
}
