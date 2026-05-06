// src/generators/zombieReportGenerator.ts
// Chrome 僵尸插件套利报告生成器
//
// 输出格式：
// 1. Markdown 报告（人类可读）
// 2. JSON 数据（程序处理）
// 3. 邮件文本（发送通知）

import * as fs from 'fs';
import * as path from 'path';
import type { AnalyzedZombie } from '../analyzers/chromeZombieAnalyzer.js';

// ============================================================
// 报告配置
// ============================================================

export interface ZombieReportConfig {
  /** 报告输出目录 */
  outputDir?: string;
  /** 是否生成 Markdown */
  generateMarkdown?: boolean;
  /** 是否生成 JSON */
  generateJson?: boolean;
  /** 是否生成邮件文本 */
  generateEmail?: boolean;
  /** 最大显示数量 */
  maxDisplay?: number;
}

// ============================================================
// 报告生成器
// ============================================================

export class ZombieReportGenerator {
  private config: Required<ZombieReportConfig>;

  constructor(config: ZombieReportConfig = {}) {
    this.config = {
      outputDir: config.outputDir || path.join(process.cwd(), 'reports'),
      generateMarkdown: config.generateMarkdown ?? true,
      generateJson: config.generateJson ?? true,
      generateEmail: config.generateEmail ?? true,
      maxDisplay: config.maxDisplay ?? 10
    };
  }

  /**
   * 生成完整报告
   */
  generate(analyzedZombies: AnalyzedZombie[]): ZombieReportResult {
    console.log(`[ZombieReport] 生成报告: ${analyzedZombies.length} 个僵尸插件目标`);

    // 确保输出目录存在
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const results: ZombieReportResult = {
      markdownPath: '',
      jsonPath: '',
      emailPath: '',
      summary: this.generateSummary(analyzedZombies),
      generatedAt: new Date()
    };

    // 生成 Markdown 报告
    if (this.config.generateMarkdown) {
      const markdown = this.generateMarkdown(analyzedZombies, timestamp);
      results.markdownPath = path.join(this.config.outputDir, `zombie-report-${timestamp}.md`);
      fs.writeFileSync(results.markdownPath, markdown, 'utf-8');
      console.log(`[ZombieReport] Markdown 报告已保存: ${results.markdownPath}`);
    }

    // 生成 JSON 数据
    if (this.config.generateJson) {
      const json = this.generateJson(analyzedZombies);
      results.jsonPath = path.join(this.config.outputDir, `zombie-report-${timestamp}.json`);
      fs.writeFileSync(results.jsonPath, JSON.stringify(json, null, 2), 'utf-8');
      console.log(`[ZombieReport] JSON 数据已保存: ${results.jsonPath}`);
    }

    // 生成邮件文本
    if (this.config.generateEmail) {
      const email = this.generateEmailText(analyzedZombies);
      results.emailPath = path.join(this.config.outputDir, `zombie-email-${timestamp}.txt`);
      fs.writeFileSync(results.emailPath, email, 'utf-8');
      console.log(`[ZombieReport] 邮件文本已保存: ${results.emailPath}`);
    }

    return results;
  }

  // ============================================================
  // Markdown 报告生成
  // ============================================================

  private generateMarkdown(analyzedZombies: AnalyzedZombie[], timestamp: string): string {
    const lines: string[] = [];

    lines.push('# 🧟 Chrome 僵尸插件套利机会报告');
    lines.push('');
    lines.push(`**生成时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} (UTC+8)`);
    lines.push(`**目标数量**: ${analyzedZombies.length} 个`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // 摘要统计
    lines.push('## 📊 扫描摘要');
    lines.push('');
    lines.push(this.generateSummaryTable(analyzedZombies));
    lines.push('');

    // 详细目标列表
    lines.push('## 🎯 僵尸插件目标详情');
    lines.push('');

    for (let i = 0; i < Math.min(analyzedZombies.length, this.config.maxDisplay); i++) {
      const { signal, score } = analyzedZombies[i];
      const analysis = signal.reviewAnalysis;

      lines.push(`### ${i + 1}. ${signal.name}`);
      lines.push('');
      lines.push(`**评分**: ${score.total}/100 | **需求热度**: ${score.breakdown.demandScore}/40 | **失效证明**: ${score.breakdown.complaintScore}/30 | **修复难度**: ${score.breakdown.difficultyScore}/20 | **窗口期**: ${score.breakdown.windowScore}/10`);
      lines.push('');
      lines.push('| 字段 | 值 |');
      lines.push('|------|-----|');
      lines.push(`| 插件ID | \`${signal.id}\` |`);
      lines.push(`| 安装量 | ${signal.installCount.toLocaleString()} 用户 |`);
      lines.push(`| 评分 | ${signal.rating}/5 (${signal.ratingCount.toLocaleString()} 条评价) |`);
      lines.push(`| 版本 | ${signal.version} |`);
      lines.push(`| 最后更新 | ${signal.lastUpdated.toLocaleDateString()} |`);
      lines.push(`| 商店链接 | [点击访问](${signal.storeUrl}) |`);
      lines.push('');

      // v4.5: 评论深度分析
      if (analysis) {
        lines.push('## 🔥 用户怨念分析 (v4.5)');
        lines.push('');
        lines.push('| 分析项 | 值 |');
        lines.push('|--------|-----|');
        lines.push(`| 😡 怨气等级 | **${analysis.userRageLevel}%** |`);
        lines.push(`| 平均评分 | ${analysis.avgRating}/5 |`);
        lines.push(`| 负面评论占比 | ${analysis.negativeRatio}% |`);
        lines.push(`| ⚠️ MV3 损坏 | ${analysis.mv3Broken ? '**是** - 明确的市场机会!' : '否'} |`);
        lines.push('');

        if (analysis.painPoints.length > 0) {
          lines.push(`**😤 用户最强怨念**: ${analysis.painPoints.slice(0, 3).map(p => `\`${p}\``).join(', ')}`);
          lines.push('');
        }

        if (analysis.requestedFeatures.length > 0) {
          lines.push('**✨ 用户最想要的功能**:');
          for (const feature of analysis.requestedFeatures.slice(0, 2)) {
            lines.push(`- "${feature}"`);
          }
          lines.push('');
        }

        // 杀手级 Slogan
        if (analysis.bestSlogan) {
          lines.push('## 💡 杀手级 Slogan');
          lines.push('');
          lines.push('```');
          lines.push(analysis.bestSlogan);
          lines.push('```');
          lines.push('');
        }

        // 杀手功能
        if (analysis.killerFeature) {
          lines.push(`**🎯 杀手功能**: ${analysis.killerFeature}`);
          lines.push('');
        }

        lines.push('---');
        lines.push('');
      }

      // 失效评论
      if (signal.recentNegativeReviews.length > 0) {
        lines.push('**用户抱怨摘录**:');
        lines.push('');
        for (const review of signal.recentNegativeReviews.slice(0, 3)) {
          const ratingStars = '⭐'.repeat(review.rating);
          lines.push(`> "${review.content}" — ${review.author} ${ratingStars} ${review.date.toLocaleDateString()}`);
        }
        lines.push('');
      }

      // 定价建议
      lines.push('**💰 定价建议**');
      lines.push('');
      lines.push(`- 推荐模式: **${score.pricingSuggestion.recommended.toUpperCase()}**`);
      lines.push(`- 价格区间: ${score.pricingSuggestion.priceRange}`);
      lines.push(`- 收入预估: $${score.pricingSuggestion.estimatedRevenue.conservative}-${score.pricingSuggestion.estimatedRevenue.optimistic}/月`);
      lines.push('');

      // 行动方案
      lines.push('**📋 行动方案**');
      lines.push('');
      for (const action of score.actionPlan.slice(0, 4)) {
        lines.push(`- ${action}`);
      }
      lines.push('');

      lines.push('---');
      lines.push('');
    }

    // 行动话术
    lines.push('## 📣 截流话术模板');
    lines.push('');
    lines.push('针对每个目标插件，可使用以下截流话术：');
    lines.push('');

    for (const { signal, score } of analyzedZombies.slice(0, 3)) {
      const name = signal.name;
      lines.push(`### ${name}`);
      lines.push('');
      lines.push('**搜索词**:');
      lines.push(`- "${name} alternative"`);
      lines.push(`- "${name} not working"`);
      lines.push(`- "${name} broken"`);
      lines.push('');
      lines.push('**截流话术**:');
      lines.push('```');
      lines.push(`🔧 "${name}" 原作者已停更，我们接手修复并持续更新！`);
      lines.push(`搜索 "Ultimate ${name}" 或 "${name} Fixed" 获取最新版`);
      lines.push(`永久买断 $${Math.round(score.pricingSuggestion.estimatedRevenue.conservative / 10)} 起，比订阅更划算！`);
      lines.push('```');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('*由 OpportunityScanner 自动生成*');

    return lines.join('\n');
  }

  private generateSummaryTable(analyzedZombies: AnalyzedZombie[]): string {
    const totalInstalls = analyzedZombies.reduce((sum, z) => sum + z.signal.installCount, 0);
    const avgScore = analyzedZombies.length > 0
      ? Math.round(analyzedZombies.reduce((sum, z) => sum + z.score.total, 0) / analyzedZombies.length)
      : 0;
    const totalPotentialRevenue = analyzedZombies.reduce(
      (sum, z) => sum + z.score.pricingSuggestion.estimatedRevenue.optimistic, 0
    );

    const lines: string[] = [];
    lines.push('| 指标 | 数值 |');
    lines.push('|------|------|');
    lines.push(`| 僵尸插件目标 | ${analyzedZombies.length} 个 |`);
    lines.push(`| 总安装量 | ${(totalInstalls / 1000000).toFixed(1)}M 用户 |`);
    lines.push(`| 平均评分 | ${avgScore}/100 |`);
    lines.push(`| 潜在月收入 | $${totalPotentialRevenue.toLocaleString()} |`);
    lines.push(`| 最高评分目标 | ${analyzedZombies[0]?.signal.name || 'N/A'} (${analyzedZombies[0]?.score.total || 0}分) |`);

    return lines.join('\n');
  }

  private generateSummary(analyzedZombies: AnalyzedZombie[]): ZombieReportSummary {
    const totalInstalls = analyzedZombies.reduce((sum, z) => sum + z.signal.installCount, 0);
    const avgScore = analyzedZombies.length > 0
      ? Math.round(analyzedZombies.reduce((sum, z) => sum + z.score.total, 0) / analyzedZombies.length)
      : 0;

    return {
      targetCount: analyzedZombies.length,
      totalInstalls,
      avgScore,
      topTarget: analyzedZombies[0]?.signal.name || null,
      topScore: analyzedZombies[0]?.score.total || 0,
      potentialMonthlyRevenue: analyzedZombies.reduce(
        (sum, z) => sum + z.score.pricingSuggestion.estimatedRevenue.optimistic, 0
      ),
      potentialMonthlyRevenueConservative: analyzedZombies.reduce(
        (sum, z) => sum + z.score.pricingSuggestion.estimatedRevenue.conservative, 0
      )
    };
  }

  // ============================================================
  // JSON 数据生成
  // ============================================================

  private generateJson(analyzedZombies: AnalyzedZombie[]): ZombieReportJson {
    return {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      summary: this.generateSummary(analyzedZombies),
      targets: analyzedZombies.map(({ signal, score }) => ({
        id: signal.id,
        name: signal.name,
        storeUrl: signal.storeUrl,
        installCount: signal.installCount,
        rating: signal.rating,
        ratingCount: signal.ratingCount,
        lastUpdated: signal.lastUpdated.toISOString(),
        version: signal.version,
        score: score.total,
        scoreBreakdown: score.breakdown,
        verdict: score.verdict,
        verdictReason: score.verdictReason,
        pricing: score.pricingSuggestion,
        actionPlan: score.actionPlan,
        recentNegativeReviews: signal.recentNegativeReviews.map((r: any) => ({
          content: r.content,
          author: r.author,
          date: r.date.toISOString(),
          rating: r.rating,
          sentiment: r.sentiment
        }))
      }))
    };
  }

  // ============================================================
  // 邮件文本生成
  // ============================================================

  generateEmailText(analyzedZombies: AnalyzedZombie[]): string {
    const lines: string[] = [];

    lines.push('🧟 Chrome 僵尸插件套利机会报告');
    lines.push('========================================');
    lines.push(`时间: ${new Date().toLocaleString('zh-CN')}`);
    lines.push(`目标: ${analyzedZombies.length} 个僵尸插件`);
    lines.push('========================================');
    lines.push('');

    for (let i = 0; i < Math.min(analyzedZombies.length, 5); i++) {
      const { signal, score } = analyzedZombies[i];

      lines.push(`【目标 ${i + 1}】${signal.name}`);
      lines.push(`评分: ${score.total}/100 | 安装量: ${signal.installCount.toLocaleString()} 用户`);
      lines.push(`最后更新: ${signal.lastUpdated.toLocaleDateString()}`);
      lines.push(`定价: ${score.pricingSuggestion.recommended} - ${score.pricingSuggestion.priceRange}`);
      lines.push(`预估月收入: $${score.pricingSuggestion.estimatedRevenue.conservative}-${score.pricingSuggestion.estimatedRevenue.optimistic}`);
      lines.push(`商店链接: ${signal.storeUrl}`);
      lines.push('');

      // 截流话术
      lines.push('截流话术:');
      lines.push(`"${signal.name}" 原作者已停更，我们接手修复！`);
      lines.push(`搜索 "Ultimate ${signal.name}" 获取最新版`);
      lines.push(`永久买断 $${Math.round(score.pricingSuggestion.estimatedRevenue.conservative / 10)} 起`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    if (analyzedZombies.length > 5) {
      lines.push(`... 还有 ${analyzedZombies.length - 5} 个目标，详见完整报告`);
      lines.push('');
    }

    lines.push('========================================');
    lines.push('由 OpportunityScanner 自动生成');

    return lines.join('\n');
  }
}

// ============================================================
// 类型定义
// ============================================================

export interface ZombieReportResult {
  markdownPath: string;
  jsonPath: string;
  emailPath: string;
  summary: ZombieReportSummary;
  generatedAt: Date;
}

export interface ZombieReportSummary {
  targetCount: number;
  totalInstalls: number;
  avgScore: number;
  topTarget: string | null;
  topScore: number;
  potentialMonthlyRevenue: number;
  potentialMonthlyRevenueConservative: number;
}

export interface ZombieReportJson {
  version: string;
  generatedAt: string;
  summary: ZombieReportSummary;
  targets: ZombieTargetJson[];
}

export interface ZombieTargetJson {
  id: string;
  name: string;
  storeUrl: string;
  installCount: number;
  rating: number;
  ratingCount: number;
  lastUpdated: string;
  version: string;
  score: number;
  scoreBreakdown: {
    demandScore: number;
    complaintScore: number;
    difficultyScore: number;
    windowScore: number;
  };
  verdict: string;
  verdictReason: string;
  pricing: {
    recommended: string;
    priceRange: string;
    monetizationStrategy: string;
    estimatedRevenue: {
      conservative: number;
      optimistic: number;
      unit: string;
    };
  };
  actionPlan: string[];
  recentNegativeReviews: {
    content: string;
    author: string;
    date: string;
    rating: number;
    sentiment: string;
  }[];
}

// ============================================================
// 便捷函数
// ============================================================

export function generateZombieReport(
  analyzedZombies: AnalyzedZombie[],
  config?: ZombieReportConfig
): ZombieReportResult {
  const generator = new ZombieReportGenerator(config);
  return generator.generate(analyzedZombies);
}
