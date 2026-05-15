// src/TwitterWorkflow.ts
// Twitter 资讯自动化发布助手 - 工作流编排器
//
// 流程: Fetch -> Analyze -> Generate (Text & Image) -> Send Email
//
// 使用方法:
//   import { TwitterWorkflow } from './TwitterWorkflow.js';
//   const workflow = new TwitterWorkflow(config);
//   await workflow.run();

import { TwitterFetcher, createDefaultTwitterFetcher } from './fetchers/twitterFetcher.js';
import { TwitterDataAnalyzer, analyzeTwitterData } from './analyzers/twitterDataAnalyzer.js';
import {
  ContentGenerator,
  generateTwitterContent,
  createDefaultContentGenerator
} from './generators/ContentGenerator.js';
import {
  TwitterEmailService,
  createTwitterEmailService
} from './services/TwitterEmailService.js';
import type {
  TwitterSignal,
  TwitterContent,
  TwitterWorkflowState,
  TwitterAnalysisResult
} from './types.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 配置
// ============================================================

export interface TwitterWorkflowConfig {
  /** 流程控制 */
  phases?: {
    fetch?: boolean;
    analyze?: boolean;
    generateText?: boolean;
    generateImage?: boolean;
    sendEmail?: boolean;
  };
  /** Twitter 采集配置 */
  fetch?: {
    keywords: string[];
    maxResults?: number;
    daysBack?: number;
    method?: 'snscrape' | 'rss' | 'mock';
    languages?: string[];
  };
  /** 分析配置 */
  analyze?: {
    minEngagementScore?: number;
    minLikes?: number;
    minRetweets?: number;
    filterBots?: boolean;
    maxResults?: number;
  };
  /** 内容生成配置 */
  generate?: {
    apiKey: string;
    apiBase?: string;
    textModel?: string;
    imageModel?: string;
    maxTweetLength?: number;
    maxConcurrency?: number;
    generateImage?: boolean;
    imageSize?: '1024x1024' | '1024x1792' | '1792x1024';
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
  /** 日志输出 */
  logger?: (msg: string) => void;
  /** 日志文件目录 */
  logDir?: string;
  /** 输出目录 */
  outputDir?: string;
}

const PROJECT_ROOT = path.join(process.cwd());

const DEFAULT_CONFIG: Required<TwitterWorkflowConfig> = {
  phases: {
    fetch: true,
    analyze: true,
    generateText: true,
    generateImage: true,
    sendEmail: true
  },
  fetch: {
    keywords: [
      'AI tools launch',
      'GPT-5',
      'Claude 4',
      'AI startup funding',
      'AI automation business',
      'Shopify AI',
      'AI ecommerce',
      'AI marketing'
    ],
    maxResults: 30,
    daysBack: 3,
    method: 'mock',
    languages: ['en', 'pt']
  },
  analyze: {
    minEngagementScore: 10,
    minLikes: 5,
    minRetweets: 2,
    filterBots: true,
    maxResults: 10
  },
  generate: {
    apiKey: '',
    apiBase: 'https://api1.link-ai.cc',
    textModel: 'claude-opus-4-5-20251101',
    imageModel: 'gpt-image-2',
    maxTweetLength: 250,
    maxConcurrency: 3,
    generateImage: false,  // 默认关闭图片生成，用户自己截图
    imageSize: '1024x1024'
  },
  email: {
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    from: '',
    to: []
  },
  logger: console.log,
  logDir: path.join(PROJECT_ROOT, 'logs'),
  outputDir: path.join(PROJECT_ROOT, 'reports')
};

// ============================================================
// 主工作流类
// ============================================================

export class TwitterWorkflow {
  private config: Required<TwitterWorkflowConfig>;
  private logger: (msg: string) => void;
  private state: TwitterWorkflowState;

  // 组件实例
  private fetcher?: TwitterFetcher;
  private analyzer?: TwitterDataAnalyzer;
  private generator?: ContentGenerator;
  private emailService?: TwitterEmailService;

  // 中间数据
  private fetchedSignals: TwitterSignal[] = [];
  private analyzedResult?: TwitterAnalysisResult;
  private generatedContents: TwitterContent[] = [];

  constructor(config: TwitterWorkflowConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = this.config.logger;
    this.state = this.initState();
  }

  private initState(): TwitterWorkflowState {
    return {
      phase: 'fetch',
      progress: 0,
      fetchedCount: 0,
      analyzedCount: 0,
      generatedCount: 0,
      sentCount: 0,
      errors: [],
      startedAt: new Date()
    };
  }

  // ============================================================
  // 公共 API
  // ============================================================

  /**
   * 运行完整工作流
   * Fetch -> Analyze -> Generate -> Send
   */
  async run(): Promise<TwitterWorkflowState> {
    const startTime = Date.now();
    this.logBanner();

    try {
      // Phase 1: Fetch (采集)
      if (this.config.phases.fetch) {
        await this.phaseFetch();
      }

      // Phase 2: Analyze (分析)
      if (this.config.phases.analyze) {
        await this.phaseAnalyze();
      }

      // Phase 3: Generate (生成文案+配图)
      if (this.config.phases.generateText || this.config.phases.generateImage) {
        await this.phaseGenerate();
      }

      // Phase 4: Send (发送邮件)
      if (this.config.phases.sendEmail) {
        await this.phaseSendEmail();
      }

      // 完成
      this.state.phase = 'complete';
      this.state.progress = 100;
      this.state.finishedAt = new Date();

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logSuccess(elapsed);
      this.saveResults();

      return this.state;
    } catch (err: any) {
      this.state.phase = 'error';
      this.state.errors.push(err.message);
      this.state.finishedAt = new Date();
      this.logger(`[TwitterWorkflow] ❌ 工作流异常: ${err.message}`);
      throw err;
    }
  }

  /**
   * 获取当前状态
   */
  getState(): TwitterWorkflowState {
    return { ...this.state };
  }

  /**
   * 获取生成的最终内容
   */
  getContents(): TwitterContent[] {
    return [...this.generatedContents];
  }

  // ============================================================
  // Phase 1: Fetch (数据采集)
  // ============================================================

  private async phaseFetch(): Promise<void> {
    this.state.phase = 'fetch';
    this.state.progress = 10;
    this.logPhase('FETCH', '开始采集 Twitter 数据...');

    try {
      this.fetcher = new TwitterFetcher(
        {
          keywords: this.config.fetch.keywords,
          maxResults: this.config.fetch.maxResults,
          since: new Date(Date.now() - (this.config.fetch.daysBack ?? 3) * 24 * 60 * 60 * 1000),
          method: this.config.fetch.method,
          languages: this.config.fetch.languages
        },
        msg => this.logger(`[Fetch] ${msg}`)
      );

      this.fetchedSignals = await this.fetcher.fetchAll();
      this.state.fetchedCount = this.fetchedSignals.length;

      this.logger(`[Fetch] ✅ 共采集 ${this.fetchedSignals.length} 条原始推文`);
      this.state.progress = 25;
    } catch (err: any) {
      this.state.errors.push(`[Fetch] ${err.message}`);
      this.logger(`[Fetch] ❌ 采集失败: ${err.message}`);
      // 不抛出异常，继续执行（使用空数据）
      this.fetchedSignals = [];
    }
  }

  // ============================================================
  // Phase 2: Analyze (数据分析)
  // ============================================================

  private async phaseAnalyze(): Promise<void> {
    this.state.phase = 'analyze';
    this.state.progress = 35;
    this.logPhase('ANALYZE', '开始分析 Twitter 数据...');

    if (this.fetchedSignals.length === 0) {
      this.logger('[Analyze] ⚠️ 无数据可分析，跳过');
      return;
    }

    try {
      this.analyzer = new TwitterDataAnalyzer(
        {
          minEngagementScore: this.config.analyze.minEngagementScore,
          minLikes: this.config.analyze.minLikes,
          minRetweets: this.config.analyze.minRetweets,
          filterBots: this.config.analyze.filterBots,
          maxResults: this.config.analyze.maxResults
        },
        msg => this.logger(`[Analyze] ${msg}`)
      );

      this.analyzedResult = this.analyzer.analyze(this.fetchedSignals);
      this.state.analyzedCount = this.analyzedResult.signals.length;

      this.logAnalysisSummary(this.analyzedResult.summary);

      this.state.progress = 50;
    } catch (err: any) {
      this.state.errors.push(`[Analyze] ${err.message}`);
      this.logger(`[Analyze] ❌ 分析失败: ${err.message}`);
      // 使用原始数据继续
      this.analyzedResult = {
        signals: this.fetchedSignals,
        categories: {},
        topSignals: this.fetchedSignals.slice(0, 10),
        summary: {
          totalSignals: this.fetchedSignals.length,
          sentimentBreakdown: { positive: 0, neutral: 0, negative: 0 },
          viralityBreakdown: { low: 0, medium: 0, high: 0, viral: 0 },
          categoryBreakdown: {},
          totalEngagement: 0,
          topKeywords: [],
          topHashtags: []
        },
        config: this.config.analyze as any
      };
    }
  }

  private logAnalysisSummary(summary: TwitterAnalysisResult['summary']): void {
    this.logger(`[Analyze] 📊 分析摘要:`);
    this.logger(`       总计: ${summary.totalSignals} 条`);
    this.logger(`       情感: 🟢${summary.sentimentBreakdown.positive} 🔵${summary.sentimentBreakdown.neutral} 🔴${summary.sentimentBreakdown.negative}`);
    this.logger(`       病毒性: 低${summary.viralityBreakdown.low} 中${summary.viralityBreakdown.medium} 高${summary.viralityBreakdown.high} 爆款${summary.viralityBreakdown.viral}`);
    this.logger(`       参与度总分: ${summary.totalEngagement.toLocaleString()}`);

    if (summary.topKeywords.length > 0) {
      this.logger(`       高频词: ${summary.topKeywords.slice(0, 8).join(', ')}`);
    }
    if (summary.topHashtags.length > 0) {
      this.logger(`       热门标签: ${summary.topHashtags.slice(0, 8).join(', ')}`);
    }
  }

  // ============================================================
  // Phase 3: Generate (内容生成 - 文案 + 配图)
  // ============================================================

  private async phaseGenerate(): Promise<void> {
    this.state.phase = 'generate';
    this.state.progress = 60;
    this.logPhase('GENERATE', '开始生成文案和配图...');

    const signalsToGenerate = this.analyzedResult?.topSignals ?? [];

    if (signalsToGenerate.length === 0) {
      this.logger('[Generate] ⚠️ 无数据可生成，跳过');
      return;
    }

    if (!this.config.generate.apiKey) {
      this.logger('[Generate] ⚠️ 未配置 LINKAI_API_KEY，跳过生成');
      return;
    }

    try {
      this.generator = createDefaultContentGenerator(
        this.config.generate.apiKey,
        msg => this.logger(`[Generate] ${msg}`)
      );

      // 并行生成所有内容
      this.generatedContents = await this.generator.generateAll(signalsToGenerate);
      this.state.generatedCount = this.generatedContents.length;

      this.logger(`[Generate] ✅ 成功生成 ${this.generatedContents.length} 条内容`);

      // 打印样本
      for (let i = 0; i < Math.min(3, this.generatedContents.length); i++) {
        const c = this.generatedContents[i];
        if (c.texts.en) {
          this.logger(`       🇬🇧 [${i + 1}] ${c.texts.en.substring(0, 80)}...`);
        }
        if (c.texts.pt) {
          this.logger(`       🇧🇷 [${i + 1}] ${c.texts.pt.substring(0, 80)}...`);
        }
      }

      this.state.progress = 80;
    } catch (err: any) {
      this.state.errors.push(`[Generate] ${err.message}`);
      this.logger(`[Generate] ❌ 生成失败: ${err.message}`);
    }
  }

  // ============================================================
  // Phase 4: Send Email (发送邮件)
  // ============================================================

  private async phaseSendEmail(): Promise<void> {
    this.state.phase = 'send';
    this.state.progress = 85;
    this.logPhase('EMAIL', '开始发送邮件...');

    if (this.generatedContents.length === 0) {
      this.logger('[Email] ⚠️ 无内容可发送，跳过');
      return;
    }

    if (!this.config.email.host || !this.config.email.user || !this.config.email.to.length) {
      this.logger('[Email] ⚠️ SMTP 未配置完整，跳过发送');
      this.logger('       请配置: SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_TO');
      return;
    }

    try {
      this.emailService = createTwitterEmailService(
        {
          host: this.config.email.host,
          port: this.config.email.port,
          secure: this.config.email.secure,
          user: this.config.email.user,
          pass: this.config.email.pass,
          from: this.config.email.from,
          to: this.config.email.to,
          subjectPrefix: '🐦'
        },
        msg => this.logger(`[Email] ${msg}`)
      );

      // 验证连接
      const connected = await this.emailService.verifyConnection();
      if (!connected) {
        throw new Error('SMTP connection verification failed');
      }

      // 发送报告
      const result = await this.emailService.sendReport(this.generatedContents);

      if (result.success) {
        this.state.sentCount = this.generatedContents.length;
        this.logger(`[Email] ✅ 邮件发送成功: ${result.messageId}`);
      } else {
        throw new Error(result.error ?? 'Unknown email error');
      }

      await this.emailService.close();
      this.state.progress = 100;
    } catch (err: any) {
      this.state.errors.push(`[Email] ${err.message}`);
      this.logger(`[Email] ❌ 发送失败: ${err.message}`);
    }
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private logBanner(): void {
    this.logger('');
    this.logger('╔══════════════════════════════════════════════════════╗');
    this.logger('║  🐦 Twitter 资讯自动化发布助手 v4.0                  ║');
    this.logger('║  OpportunityScanner · Twitter Automation System     ║');
    this.logger('╚══════════════════════════════════════════════════════╝');
    this.logger('');
  }

  private logPhase(phase: string, message: string): void {
    this.logger('');
    this.logger(`▶ ${phase}: ${message}`);
    this.logger('─'.repeat(60));
  }

  private logSuccess(elapsed: string): void {
    this.logger('');
    this.logger('╔══════════════════════════════════════════════════════╗');
    this.logger('║  ✅ 工作流完成!                                    ║');
    this.logger('╠══════════════════════════════════════════════════════╣');
    this.logger(`║  📊 采集: ${String(this.state.fetchedCount).padEnd(4)} 条                               ║`);
    this.logger(`║  📊 分析: ${String(this.state.analyzedCount).padEnd(4)} 条                               ║`);
    this.logger(`║  ✍️  生成: ${String(this.state.generatedCount).padEnd(4)} 条                               ║`);
    this.logger(`║  📧 发送: ${String(this.state.sentCount).padEnd(4)} 条                               ║`);
    this.logger(`║  ⏱️  耗时: ${elapsed.padEnd(6)} 秒                             ║`);
    if (this.state.errors.length > 0) {
      this.logger(`║  ⚠️  错误: ${String(this.state.errors.length).padEnd(4)} 条                               ║`);
    }
    this.logger('╚══════════════════════════════════════════════════════╝');
    this.logger('');
  }

  private saveResults(): void {
    const outputDir = this.config.outputDir;
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const basePath = path.join(outputDir, `twitter-report-${timestamp}`);

      // 保存 JSON
      fs.writeFileSync(
        `${basePath}.json`,
        JSON.stringify(
          {
            state: this.state,
            contents: this.generatedContents.map(c => ({
              sourceUrl: c.sourceSignal.url,
              author: c.sourceSignal.author.username,
              text_en: c.texts.en,
              text_pt: c.texts.pt,
              imageUrl: c.imageUrl,
              generatedAt: c.generatedAt
            })),
            summary: this.analyzedResult?.summary
          },
          null,
          2
        )
      );

      // 保存 Markdown 报告
      const mdContent = this.buildMarkdownReport();
      fs.writeFileSync(`${basePath}.md`, mdContent);

      this.logger(`[Report] 📄 报告已保存: ${basePath}.json`);
      this.logger(`[Report] 📄 Markdown: ${basePath}.md`);
    } catch (err: any) {
      this.logger(`[Report] ⚠️ 保存报告失败: ${err.message}`);
    }
  }

  private buildMarkdownReport(): string {
    const lines: string[] = [];
    const date = new Date().toLocaleString();

    lines.push('# 🐦 Twitter AI Content Report');
    lines.push('');
    lines.push(`**生成时间**: ${date}`);
    lines.push(`**采集数量**: ${this.state.fetchedCount}`);
    lines.push(`**分析数量**: ${this.state.analyzedCount}`);
    lines.push(`**生成数量**: ${this.state.generatedCount}`);
    lines.push(`**发送数量**: ${this.state.sentCount}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (let i = 0; i < this.generatedContents.length; i++) {
      const c = this.generatedContents[i];
      const s = c.sourceSignal;

      lines.push(`## ${i + 1}. @${s.author.username}`);
      lines.push('');
      lines.push(`📅 ${s.postedAt.toLocaleDateString()} | 🔗 [查看原推](${s.url})`);
      lines.push('');

      // 显示原推文内容
      lines.push('**📝 原推文:**');
      lines.push(`> ${s.content.substring(0, 300)}${s.content.length > 300 ? '...' : ''}`);
      lines.push('');

      // 显示参与度
      lines.push(`❤️ ${s.metrics.likes.toLocaleString()} | 🔄 ${s.metrics.retweets.toLocaleString()} | 💬 ${s.metrics.replies.toLocaleString()}`);
      lines.push('');

      lines.push('---');
      lines.push('');

      lines.push('### 🇬🇧 英文文案 (可直接复制)');
      lines.push('');
      lines.push(`\`\`\``);
      lines.push(c.texts.en ?? '(未生成)');
      lines.push(`\`\`\``);
      lines.push(`字符数: ${c.texts.en?.length ?? 0} / 250`);
      lines.push('');

      lines.push('### 🇧🇷 葡语文案 (可直接复制)');
      lines.push('');
      lines.push(`\`\`\``);
      lines.push(c.texts.pt ?? '(未生成)');
      lines.push(`\`\`\``);
      lines.push(`字符数: ${c.texts.pt?.length ?? 0} / 250`);
      lines.push('');

      // 如果有生成的图片
      if (c.imageUrl) {
        lines.push('### 🖼️ 配图');
        lines.push('');
        lines.push(`![Generated Image](${c.imageUrl})`);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    if (this.state.errors.length > 0) {
      lines.push('## ⚠️ Errors');
      lines.push('');
      for (const err of this.state.errors) {
        lines.push(`- ${err}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 从环境变量创建工作流配置
 */
export function createTwitterWorkflowFromEnv(): TwitterWorkflowConfig {
  const {
    LINKAI_API_KEY,
    LINKAI_API_BASE = 'https://api1.link-ai.cc',
    LINKAI_TEXT_MODEL = 'claude-opus-4-5-20251101',
    LINKAI_IMAGE_MODEL = 'gpt-image-2',
    TWITTER_KEYWORDS = 'AI tools launch,GPT-5,Claude 4,AI startup funding',
    TWITTER_MAX_RESULTS = '30',
    TWITTER_DAYS_BACK = '3',
    TWITTER_FETCH_METHOD = 'mock',
    TWITTER_LANGUAGES = 'en,pt',
    SMTP_HOST,
    SMTP_PORT = '587',
    SMTP_SECURE = 'false',
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
    EMAIL_TO,
    MAX_CONCURRENCY = '3',
    MAX_TWEET_LENGTH = '250',
    LOG_DIR = path.join(process.cwd(), 'logs'),
    OUTPUT_DIR = path.join(process.cwd(), 'reports')
  } = process.env as Record<string, string>;

  const keywords = TWITTER_KEYWORDS.split(',').map(k => k.trim()).filter(Boolean);

  return {
    phases: {
      fetch: true,
      analyze: true,
      generateText: true,
      generateImage: false,  // 默认关闭图片生成，用户自己截图
      sendEmail: !!(SMTP_HOST && SMTP_USER && SMTP_PASS && EMAIL_TO)
    },
    fetch: {
      keywords,
      maxResults: parseInt(TWITTER_MAX_RESULTS),
      daysBack: parseInt(TWITTER_DAYS_BACK),
      method: TWITTER_FETCH_METHOD as 'snscrape' | 'rss' | 'mock',
      languages: TWITTER_LANGUAGES.split(',').map(l => l.trim())
    },
    analyze: {
      minEngagementScore: 10,
      minLikes: 5,
      minRetweets: 2,
      filterBots: true,
      maxResults: 10
    },
    generate: {
      apiKey: LINKAI_API_KEY || '',
      apiBase: LINKAI_API_BASE,
      textModel: LINKAI_TEXT_MODEL,
      imageModel: LINKAI_IMAGE_MODEL,
      maxTweetLength: parseInt(MAX_TWEET_LENGTH),
      maxConcurrency: parseInt(MAX_CONCURRENCY),
      generateImage: true,
      imageSize: '1024x1024'
    },
    email: {
      host: SMTP_HOST || '',
      port: parseInt(SMTP_PORT),
      secure: SMTP_SECURE === 'true',
      user: SMTP_USER || '',
      pass: SMTP_PASS || '',
      from: SMTP_FROM || `OpportunityScanner <${SMTP_USER}>`,
      to: EMAIL_TO ? EMAIL_TO.split(',').map(e => e.trim()) : []
    },
    logDir: LOG_DIR,
    outputDir: OUTPUT_DIR
  };
}

/**
 * 快速启动 Twitter 自动化 (使用环境变量)
 */
export async function runTwitterWorkflow(): Promise<TwitterWorkflowState> {
  const config = createTwitterWorkflowFromEnv();
  const workflow = new TwitterWorkflow(config);
  return workflow.run();
}
