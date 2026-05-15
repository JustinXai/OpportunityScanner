// 评分引擎
// 基于规则计算 Radar Score

import type { OpportunitySignal, SignalLevel, Decision } from '../types.js';

interface ScoringConfig {
  build_threshold: number;
  probe_threshold: number;
  watch_threshold: number;
  require_fit_for_build: SignalLevel;
  require_money_level_for_build: SignalLevel;
}

const DEFAULT_CONFIG: ScoringConfig = {
  build_threshold: 85,
  probe_threshold: 72,
  watch_threshold: 55,
  require_fit_for_build: 4,
  require_money_level_for_build: 3
};

/**
 * 评分引擎
 *
 * Radar Score =
 *   Money Evidence * 25
 * + Pain Evidence * 20
 * + Recency * 15
 * + Distribution Signal * 15
 * + RutaAPI/API Doctor Fit * 15
 * + Solo Feasibility * 10
 * - Compliance Risk * 10
 * - Distraction Risk * 15
 */
export class ScoringEngine {
  private config: ScoringConfig;

  constructor(config: Partial<ScoringConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 计算 Radar Score
   */
  calculateScore(signal: OpportunitySignal): number {
    // 原始分数计算
    let score = 0;

    // Money Evidence * 25 (0-5 -> 0-125)
    score += (signal.money_signal_level || 0) * 25;

    // Pain Evidence * 20 (0-5 -> 0-100)
    score += this.calculatePainScore(signal) * 20;

    // Recency * 15
    score += this.calculateRecencyScore(signal) * 15;

    // Distribution Signal * 15
    score += this.calculateDistributionScore(signal) * 15;

    // RutaAPI/API Doctor Fit * 15
    score += this.calculateFitScore(signal) * 15;

    // Solo Feasibility * 10
    score += (signal.solo_founder_feasibility || 0) * 10;

    // - Compliance Risk * 10
    score -= (signal.compliance_risk || 0) * 10;

    // - Distraction Risk * 15
    score -= (signal.compliance_risk || 0) * 15; // competition_risk used as distraction_risk

    // 限制在 0-100
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * 计算痛点评分（考虑多维度）
   */
  private calculatePainScore(signal: OpportunitySignal): number {
    let painScore = signal.pain_signal ? 1 : 0;

    // 有明确的 pain_signal 文本
    if (signal.pain_signal) {
      painScore += 1;
    }

    // 有用户投诉关键词
    if (signal.user_complaint_keywords && signal.user_complaint_keywords.length > 0) {
      painScore += 1;
    }

    // 限制在 0-5
    return Math.min(5, painScore);
  }

  /**
   * 计算时效性评分
   */
  private calculateRecencyScore(signal: OpportunitySignal): number {
    const sourceDate = new Date(signal.source_date);
    const now = new Date();
    const daysAgo = Math.floor((now.getTime() - sourceDate.getTime()) / (1000 * 60 * 60 * 24));

    // 7天内: 5分
    if (daysAgo <= 7) return 5;
    // 14天内: 4分
    if (daysAgo <= 14) return 4;
    // 30天内: 3分
    if (daysAgo <= 30) return 3;
    // 60天内: 2分
    if (daysAgo <= 60) return 2;
    // 90天内: 1分
    if (daysAgo <= 90) return 1;

    return 0;
  }

  /**
   * 计算分发信号评分
   */
  private calculateDistributionScore(signal: OpportunitySignal): number {
    let score = 0;

    // 来源可靠性
    switch (signal.source_type) {
      case 'product_hunt':
        score += 2;
        break;
      case 'github':
        score += 2;
        break;
      case 'reddit':
        score += 1;
        break;
      case 'hacker_news':
        score += 2;
        break;
      case 'indie_hackers':
        score += 3;
        break;
      case 'flippa':
        score += 4;
        break;
      default:
        score += 1;
    }

    // 有 URL = 有分发渠道
    if (signal.source_url) {
      score += 1;
    }

    return Math.min(5, score);
  }

  /**
   * 计算 RutaAPI/API Doctor 契合度
   */
  private calculateFitScore(signal: OpportunitySignal): number {
    const rutaFit = signal.fit_with_rutaapi || 0;
    const apiDoctorFit = signal.fit_with_api_doctor || 0;

    // 取平均
    return Math.max(rutaFit, apiDoctorFit);
  }

  /**
   * 计算决策
   */
  calculateDecision(signal: OpportunitySignal): Decision {
    const score = this.calculateScore(signal);
    signal.radar_score = score;

    // BUILD 需要：高分数 + 高 fit + 高 money
    if (
      score >= this.config.build_threshold &&
      (signal.fit_with_rutaapi >= this.config.require_fit_for_build ||
       signal.fit_with_api_doctor >= this.config.require_fit_for_build) &&
      signal.money_signal_level >= this.config.require_money_level_for_build
    ) {
      return 'MERGE_INTO_CURRENT';
    }

    if (score >= this.config.build_threshold) {
      return 'BUILD';
    }

    if (score >= this.config.probe_threshold) {
      return 'PROBE';
    }

    if (score >= this.config.watch_threshold) {
      return 'WATCH';
    }

    return 'IGNORE';
  }

  /**
   * 批量评分并排序
   */
  scoreAll(signals: OpportunitySignal[]): OpportunitySignal[] {
    console.log(`\n📊 [Scoring] 评分 ${signals.length} 条信号...`);

    for (const signal of signals) {
      signal.radar_score = this.calculateScore(signal);
      signal.decision = this.calculateDecision(signal);
      signal.next_action = signal.next_action || this.defaultAction(signal.decision);
    }

    // 按分数降序排序
    signals.sort((a, b) => b.radar_score - a.radar_score);

    // 统计
    const summary = this.getSummary(signals);
    console.log(`   ✅ 评分完成`);
    console.log(`   📈 BUILD: ${summary.build_count}`);
    console.log(`   👀 PROBE: ${summary.probe_count}`);
    console.log(`   🔭 WATCH: ${summary.watch_count}`);
    console.log(`   🚫 IGNORE: ${summary.ignore_count}`);
    console.log(`   🔗 MERGE: ${summary.merge_count}`);

    return signals;
  }

  /**
   * 获取统计摘要
   */
  getSummary(signals: OpportunitySignal[]): { ignore_count: number; watch_count: number; probe_count: number; build_count: number; merge_count: number } {
    return {
      build_count: signals.filter(s => s.decision === 'BUILD').length,
      probe_count: signals.filter(s => s.decision === 'PROBE').length,
      watch_count: signals.filter(s => s.decision === 'WATCH').length,
      ignore_count: signals.filter(s => s.decision === 'IGNORE').length,
      merge_count: signals.filter(s => s.decision === 'MERGE_INTO_CURRENT').length
    };
  }

  /**
   * 默认动作
   */
  private defaultAction(decision: Decision): string {
    switch (decision) {
      case 'BUILD':
        return '立即启动 MVP，7 天内出 prototype';
      case 'MERGE_INTO_CURRENT':
        return '合并到 RutaAPI 或 API Doctor 功能线';
      case 'PROBE':
        return '做 landing page 或 tweet 验证需求';
      case 'WATCH':
        return '继续观察，等待更多信息';
      default:
        return '跳过，专注其他机会';
    }
  }
}
