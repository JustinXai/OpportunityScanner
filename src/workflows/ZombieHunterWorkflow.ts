// src/workflows/ZombieHunterWorkflow.ts
// Chrome 僵尸插件套利工作流编排
//
// 工作流：
// 1. 采集僵尸插件信号 (FreeChromeZombieFetcher - 免费方案)
// 2. 分析评分 (ChromeZombieAnalyzer)
// 3. 生成报告 (ZombieReportGenerator)
// 4. 保存报告 + 可选发送邮件
//
// 免费方案使用：
// - Serper API (搜索) - 有免费额度
// - 直接爬取 Chrome Web Store (无需 API)
// - GitHub API (查找开源插件) - 无需认证

import * as dotenv from 'dotenv';
import * as path from 'path';
import { FreeChromeZombieFetcher, type ZombieTarget } from '../fetchers/freeChromeZombieFetcher.js';
import { ChromeZombieAnalyzer, type AnalyzedZombie } from '../analyzers/chromeZombieAnalyzer.js';
import { ZombieReportGenerator } from '../generators/zombieReportGenerator.js';
import { EmailService } from '../EmailService.js';

dotenv.config();

// ============================================================
// 配置
// ============================================================

export interface ZombieWorkflowConfig {
  /** Serper API Key (免费搜索) */
  serperApiKey?: string;
  /** GitHub Token (可选) */
  githubToken?: string;
  /** 并发数 */
  concurrency?: number;
  /** 请求间隔 (ms) */
  requestInterval?: number;
  /** 最低安装量阈值 */
  minInstalls?: number;
  /** 停更阈值日期 */
  staleThreshold?: Date;
  /** 最高评分阈值 (超过此分数才进入报告) */
  minScore?: number;
  /** 最大输出数量 */
  maxTargets?: number;
  /** 是否发送邮件 */
  sendEmail?: boolean;
  /** 邮件接收人 */
  emailTo?: string;
  /** 输出目录 */
  outputDir?: string;
  /** 是否使用模拟数据（用于测试） */
  useMockData?: boolean;
}

// ============================================================
// 工作流状态
// ============================================================

export interface ZombieWorkflowState {
  phase: 'init' | 'fetch' | 'analyze' | 'report' | 'send' | 'complete' | 'error';
  progress: number;
  fetched: number;
  analyzed: number;
  targets: number;
  errors: string[];
  startedAt: Date;
  finishedAt?: Date;
}

// ============================================================
// 主工作流
// ============================================================

export class ZombieHunterWorkflow {
  private config: ZombieWorkflowConfig;
  private state: ZombieWorkflowState;

  constructor(config: ZombieWorkflowConfig = {}) {
    this.config = {
      serperApiKey: config.serperApiKey || process.env.SERPER_API_KEY || '',
      githubToken: config.githubToken || process.env.GITHUB_TOKEN || '',
      concurrency: config.concurrency || 2,  // 降低并发
      requestInterval: config.requestInterval || 3000,  // 增加间隔
      minInstalls: config.minInstalls || 30000,
      staleThreshold: config.staleThreshold || new Date('2024-01-01'),
      minScore: config.minScore || 60,
      maxTargets: config.maxTargets || 10,
      sendEmail: config.sendEmail ?? true,
      emailTo: config.emailTo || process.env.EMAIL_TO || '',
      outputDir: config.outputDir || path.join(process.cwd(), 'reports'),
      useMockData: config.useMockData ?? false
    };

    this.state = this.createInitialState();
  }

  private createInitialState(): ZombieWorkflowState {
    return {
      phase: 'init',
      progress: 0,
      fetched: 0,
      analyzed: 0,
      targets: 0,
      errors: [],
      startedAt: new Date()
    };
  }

  /**
   * 运行完整工作流
   */
  async run(): Promise<ZombieWorkflowState> {
    console.log('='.repeat(60));
    console.log('🧟 Chrome 僵尸插件套利猎人');
    console.log('='.repeat(60));
    console.log(`⏰ 开始时间: ${this.state.startedAt.toLocaleString()}`);

    try {
      // 阶段1: 数据采集
      this.state.phase = 'fetch';
      this.state.progress = 10;
      const signals = await this.fetchSignals();

      if (signals.length === 0) {
        console.log('[ZombieHunter] 未发现僵尸插件信号');
        this.state.phase = 'complete';
        this.state.progress = 100;
        return this.state;
      }

      this.state.fetched = signals.length;
      console.log(`[ZombieHunter] 采集完成: ${signals.length} 个插件信号`);

      // 阶段2: 分析评分
      this.state.phase = 'analyze';
      this.state.progress = 40;
      const analyzed = this.analyzeSignals(signals);

      this.state.analyzed = analyzed.length;
      console.log(`[ZombieHunter] 分析完成: ${analyzed.length} 个目标`);

      // 阶段3: 生成报告
      this.state.phase = 'report';
      this.state.progress = 70;
      const reportResult = this.generateReport(analyzed);

      this.state.targets = analyzed.length;
      console.log(`[ZombieHunter] 报告已生成: ${reportResult.markdownPath}`);

      // 阶段4: 发送邮件
      if (this.config.sendEmail && analyzed.length > 0) {
        this.state.phase = 'send';
        this.state.progress = 90;
        await this.sendEmailNotification(analyzed);
      }

      // 完成
      this.state.phase = 'complete';
      this.state.progress = 100;
      this.state.finishedAt = new Date();

      console.log('='.repeat(60));
      console.log('✅ 工作流完成');
      console.log(`📊 采集: ${this.state.fetched} | 分析: ${this.state.analyzed} | 目标: ${this.state.targets}`);
      console.log(`📄 报告: ${reportResult.markdownPath}`);
      console.log(`⏱️ 耗时: ${this.getElapsedTime()}`);
      console.log('='.repeat(60));

      return this.state;
    } catch (error) {
      this.state.phase = 'error';
      this.state.errors.push(error instanceof Error ? error.message : String(error));
      console.error('[ZombieHunter] 错误:', this.state.errors);
      throw error;
    }
  }

  // ============================================================
  // 阶段1: 数据采集
  // ============================================================

  private async fetchSignals(): Promise<ZombieTarget[]> {
    console.log('\n[阶段1/4] 开始采集僵尸插件信号...');
    console.log('[ZombieHunter] 采集源: Serper搜索 + Chrome Web Store 爬取 + GitHub');

    // 使用免费的采集器
    const fetcher = new FreeChromeZombieFetcher({
      serperApiKey: this.config.serperApiKey,
      githubToken: this.config.githubToken,
      concurrency: this.config.concurrency,
      requestInterval: this.config.requestInterval,
      minInstalls: this.config.minInstalls,
      staleThreshold: this.config.staleThreshold,
      useMockData: this.config.useMockData
    });

    const signals = await fetcher.fetchAll();

    console.log(`[阶段1/4] 完成: 发现 ${signals.length} 个插件信号`);
    return signals;
  }

  // ============================================================
  // 阶段2: 分析评分
  // ============================================================

  private analyzeSignals(signals: ZombieTarget[]): AnalyzedZombie[] {
    console.log(`\n[阶段2/4] 开始分析 ${signals.length} 个插件...`);

    const analyzer = new ChromeZombieAnalyzer();
    const analyzed = analyzer.analyzeAll(signals);

    // 按评分排序
    analyzed.sort((a, b) => b.score.total - a.score.total);

    // 限制数量
    const limited = analyzed.slice(0, this.config.maxTargets);

    console.log(`[阶段2/4] 完成: ${limited.length} 个僵尸插件目标 (总分 >= ${this.config.minScore})`);
    return limited;
  }

  // ============================================================
  // 阶段3: 生成报告
  // ============================================================

  private generateReport(analyzed: AnalyzedZombie[]): {
    markdownPath: string;
    jsonPath: string;
    emailPath: string;
  } {
    console.log(`\n[阶段3/4] 生成报告...`);

    const generator = new ZombieReportGenerator({
      outputDir: this.config.outputDir,
      maxDisplay: this.config.maxTargets
    });

    const result = generator.generate(analyzed);

    return {
      markdownPath: result.markdownPath,
      jsonPath: result.jsonPath,
      emailPath: result.emailPath
    };
  }

  // ============================================================
  // 阶段4: 发送邮件
  // ============================================================

  private async sendEmailNotification(analyzed: AnalyzedZombie[]): Promise<void> {
    console.log('\n[阶段4/4] 发送邮件通知...');

    const generator = new ZombieReportGenerator();
    const emailText = generator.generateEmailText(analyzed);

    try {
      await EmailService.sendReport(emailText);
      console.log('[阶段4/4] 邮件发送成功');
    } catch (error) {
      console.error('[阶段4/4] 邮件发送失败:', error);
      this.state.errors.push('邮件发送失败');
    }
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private getElapsedTime(): string {
    const elapsed = Date.now() - this.state.startedAt.getTime();
    const seconds = Math.round(elapsed / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  getState(): ZombieWorkflowState {
    return { ...this.state };
  }
}

// ============================================================
// 配置工厂
// ============================================================

export function createZombieWorkflowConfig(): ZombieWorkflowConfig {
  return {
    serperApiKey: process.env.SERPER_API_KEY,
    githubToken: process.env.GITHUB_TOKEN,
    concurrency: parseInt(process.env.MAX_CONCURRENCY || '2', 10),  // 降低并发
    requestInterval: 3000,  // 增加间隔
    minInstalls: 30000,
    staleThreshold: new Date('2024-01-01'),
    minScore: 60,
    maxTargets: 10,
    sendEmail: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
    emailTo: process.env.EMAIL_TO || '',
    outputDir: path.join(process.cwd(), 'reports'),
    useMockData: !process.env.SERPER_API_KEY
  };
}

// ============================================================
// 便捷函数
// ============================================================

export async function runZombieHunterWorkflow(
  config?: ZombieWorkflowConfig
): Promise<ZombieWorkflowState> {
  const workflow = new ZombieHunterWorkflow(config);
  return workflow.run();
}
