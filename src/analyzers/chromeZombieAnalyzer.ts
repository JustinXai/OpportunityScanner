// src/analyzers/chromeZombieAnalyzer.ts
// Chrome 僵尸插件套利评分分析器 v5.5
// 深度漏洞探测版 - 增加崩溃密度评分项
//
// 评分模型（100分制）：
// 1. 需求热度 (40%): 安装量越大分越高
// 2. 失效证明 (30%): 负面评论占比越高分越高
// 3. 修复难度 (20%): 权限少 + GitHub 有仓库 = 难度低
// 4. 窗口期 (10%): 最后更新越久远，窗口越大
//
// v5.5 新增：
// 5. 崩溃密度 (30分): 评论中"not working"比例 -> 直接给满分
// 6. 开发者无响应 (+10分): 用户提到开发者失联

import type { ExtensionDetail, Review } from '../fetchers/chromeZombieFetcher.js';
import type { ZombieTarget } from '../fetchers/freeChromeZombieFetcher.js';

// ============================================================
// 评分结果
// ============================================================

export interface ZombieScore {
  total: number;
  breakdown: {
    demandScore: number;       // 需求热度 0-40
    complaintScore: number;    // 失效证明 0-30
    difficultyScore: number;    // 修复难度 0-20
    windowScore: number;       // 窗口期 0-10
    crashDensity: number;      // 崩溃密度 0-30 (v5.5新增)
    developerUnresponsive: number; // 开发者无响应 0-10 (v5.5新增)
  };
  verdict: 'ZOMBIE_TARGET' | 'WATCH' | 'SKIP';
  verdictReason: string;
  pricingSuggestion: PricingSuggestion;
  actionPlan: string[];
}

export interface PricingSuggestion {
  recommended: 'lifetime' | 'subscription' | 'freemium';
  priceRange: string;
  monetizationStrategy: string;
  estimatedRevenue: {
    conservative: number;  // 月收入保守估算
    optimistic: number;    // 月收入乐观估算
    unit: 'USD';
  };
  conversionAssumptions: {
    installBase: number;
    conversionRate: number;
    avgDealSize: number;
  };
}

export interface AnalyzedZombie {
  signal: ZombieTarget;
  score: ZombieScore;
  generatedAt: Date;
}

// ============================================================
// 常量定义
// ============================================================

const DEMAND_THRESHOLDS = {
  EXCEPTIONAL: 500000,  // 50万+ -> 40分
  HIGH: 100000,         // 10万+ -> 30分
  MEDIUM: 10000          // 1万+ -> 20分
};

const DAYS_SINCE_UPDATE_THRESHOLDS = {
  RECENT: 180,    // 半年内 -> 0分
  MODERATE: 365,  // 1年内 -> 5分
  OLD: 730        // 2年+ -> 10分
};

const PERMISSIONS_COMPLEXITY = {
  SIMPLE: ['activeTab', 'storage', 'alarms', 'contextMenus'],
  MODERATE: ['tabs', 'webRequest', 'webNavigation', 'cookies'],
  COMPLEX: ['<all_urls>', 'webRequestBlocking', 'management', 'downloads', 'history']
};

// ============================================================
// 主分析器
// ============================================================

export class ChromeZombieAnalyzer {
  /**
   * 分析僵尸插件并计算套利评分
   */
  analyze(target: ZombieTarget): AnalyzedZombie {
    const score = this.calculateScore(target);
    const pricing = this.suggestPricing(target, score);
    const actionPlan = this.generateActionPlan(target, score);
    let verdict = this.determineVerdict(score);
    let total = score.demandScore + score.complaintScore + score.difficultyScore + score.windowScore;

    // v4.5: 评论深度分析增强评分
    if (target.reviewAnalysis) {
      const { userRageLevel, mv3Broken, negativeRatio, crashDensity, developerUnresponsive } = target.reviewAnalysis;

      // MV3 问题 -> 额外 +10 分（明确的市场机会）
      if (mv3Broken) {
        total += 10;
      }

      // 高怨气等级 -> 额外 +5 分
      if (userRageLevel >= 70) {
        total += 5;
      }

      // 负面评论多 -> 额外 +5 分
      if (negativeRatio >= 50) {
        total += 5;
      }

      // v5.5: 崩溃密度评分 (0-30分)
      // 核心逻辑：如果最近 10 条评论中有 5 条以上包含 "not working"，给 30 分满分
      score.crashDensity = Math.min(30, crashDensity || 0);
      total += score.crashDensity;

      // v5.5: 开发者无响应 (+10分)
      // 用户提到开发者不响应 -> 额外奖励
      if (developerUnresponsive) {
        score.developerUnresponsive = 10;
        total += 10;
      }

      // 最高 130 分封顶 (基础100 + 崩溃密度30)
      total = Math.min(130, total);

      // 重新判断 verdict
      verdict = this.determineVerdict({ ...score, total });
    }

    return {
      signal: target,
      score: {
        total,
        breakdown: score,
        verdict,
        verdictReason: this.getVerdictReason(score, verdict, total),
        pricingSuggestion: pricing,
        actionPlan
      },
      generatedAt: new Date()
    };
  }

  /**
   * 批量分析
   */
  analyzeAll(targets: ZombieTarget[]): AnalyzedZombie[] {
    return targets
      .map(t => this.analyze(t))
      .filter(a => a.score.verdict === 'ZOMBIE_TARGET')
      .sort((a, b) => b.score.total - a.score.total);
  }

  // ============================================================
  // 评分计算
  // ============================================================

  private calculateScore(target: ZombieTarget): ZombieScore['breakdown'] {
    const ext: ExtensionDetail = {
      id: target.id,
      name: target.name,
      storeUrl: target.storeUrl,
      description: '',
      author: 'Unknown',
      installCount: target.installCount,
      rating: target.rating,
      ratingCount: target.ratingCount,
      lastUpdated: target.lastUpdated,
      version: target.version,
      usersText: `${target.installCount.toLocaleString()} users`
    };

    return {
      demandScore: this.calculateDemandScore(ext.installCount),
      complaintScore: this.calculateComplaintScore(ext, target.recentNegativeReviews),
      difficultyScore: this.calculateDifficultyScore(ext),
      windowScore: this.calculateWindowScore(ext.lastUpdated),
      crashDensity: 0, // v5.5: 在 analyze() 中计算
      developerUnresponsive: 0 // v5.5: 在 analyze() 中计算
    };
  }

  /**
   * 需求热度评分 (0-40分)
   * 安装量越大，市场需求越明确
   */
  private calculateDemandScore(installCount: number): number {
    if (installCount >= DEMAND_THRESHOLDS.EXCEPTIONAL) return 40;
    if (installCount >= DEMAND_THRESHOLDS.HIGH) return 30;
    if (installCount >= DEMAND_THRESHOLDS.MEDIUM) return 20;
    return 10;
  }

  /**
   * 失效证明评分 (0-30分)
   * 负面评论占比越高，证明用户痛点越强烈
   */
  private calculateComplaintScore(ext: ExtensionDetail, complaints: Review[]): number {
    if (complaints.length === 0) {
      // 无评论数据时，根据评分和更新时间估算
      if (ext.rating < 2.5) return 20;
      if (ext.rating < 3.5) return 10;
      return 5;
    }

    const negativeReviews = complaints.filter(r => r.sentiment === 'negative' || r.isStale);
    const staleRatio = negativeReviews.length / complaints.length;

    if (staleRatio >= 0.5) return 30;  // 50%+ 负面
    if (staleRatio >= 0.3) return 20;  // 30%+ 负面
    if (staleRatio >= 0.1) return 10;  // 10%+ 负面
    return 5;
  }

  /**
   * 修复难度评分 (0-20分)
   * 权限越少 = 修复难度低 = 分高
   */
  private calculateDifficultyScore(ext: ExtensionDetail): number {
    let score = 10; // 默认中等难度

    // 简单权限 -> 容易修复
    // Chrome MV3 迁移相关扩展有现成的修复方案
    const simplePermPatterns = ['storage', 'activeTab', 'alarms'];
    const complexPermPatterns = ['<all_urls>', 'webRequestBlocking', 'management'];

    const permStr = JSON.stringify(ext).toLowerCase();

    if (simplePermPatterns.some(p => permStr.includes(p)) && !complexPermPatterns.some(p => permStr.includes(p))) {
      score += 5;
    }

    // 检查是否是 Manifest V3 相关问题（基于版本和评论内容）
    const isMV3Related = permStr.includes('mv3') || permStr.includes('manifest v3') ||
                          permStr.includes('service worker') || permStr.includes('declarative');

    if (isMV3Related) {
      // MV3 迁移问题有大量社区解决方案，容易修复
      score += 5;
    }

    return Math.min(20, score);
  }

  /**
   * 窗口期评分 (0-10分)
   * 插件停更越久，替代窗口越大
   */
  private calculateWindowScore(lastUpdated: Date): number {
    const daysSinceUpdate = Math.floor(
      (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceUpdate >= DAYS_SINCE_UPDATE_THRESHOLDS.OLD) return 10;
    if (daysSinceUpdate >= DAYS_SINCE_UPDATE_THRESHOLDS.MODERATE) return 5;
    if (daysSinceUpdate >= DAYS_SINCE_UPDATE_THRESHOLDS.RECENT) return 2;
    return 0;
  }

  // ============================================================
  // 定价建议
  // ============================================================

  private suggestPricing(target: ZombieTarget, score: ZombieScore['breakdown']): PricingSuggestion {
    const totalScore = (
      score.demandScore + score.complaintScore + score.difficultyScore + score.windowScore +
      (score.crashDensity || 0) + (score.developerUnresponsive || 0)
    );
    const installCount = target.installCount;
    const rating = target.rating;
    const mv3Broken = target.reviewAnalysis?.mv3Broken || false;

    // v5.5: 根据崩溃密度调整定价策略
    const hasHighCrashDensity = (score.crashDensity || 0) >= 20;

    // 根据安装量和评分决定定价模式
    let recommended: PricingSuggestion['recommended'];
    let priceRange: string;

    // 高崩溃密度 -> 订阅制（用户急迫解决问题）
    if (hasHighCrashDensity) {
      recommended = 'subscription';
      priceRange = '$9-29/月 或 $79-249/年（急迫需求，订阅制更合理）';
    } else if (installCount >= 100000 && rating < 3) {
      // 高安装 + 低评分 = 用户急迫 = 订阅制
      recommended = 'subscription';
      priceRange = '$9-29/月 或 $79-199/年';
    } else if (installCount >= 50000) {
      // 中高安装 = freemium
      recommended = 'freemium';
      priceRange = '免费基础 + $19-49 高级版';
    } else {
      // 其他 = lifetime
      recommended = 'lifetime';
      priceRange = '$29-149 买断';
    }

    // v5.5: MV3 问题插件定价更高
    if (mv3Broken && recommended === 'lifetime') {
      priceRange = priceRange.replace(/\$29-149/, '$49-199');
    }

    // 收入估算
    const installBase = installCount;
    const conversionRate = (rating < 3 || hasHighCrashDensity) ? 0.003 : 0.001; // 低评分或高崩溃 = 高转化意愿
    const avgDealSize = recommended === 'subscription' ? 15 : (hasHighCrashDensity ? 69 : 50);

    return {
      recommended,
      priceRange,
      monetizationStrategy: this.getMonetizationStrategy(target, recommended, hasHighCrashDensity),
      estimatedRevenue: {
        conservative: Math.round(installBase * conversionRate * avgDealSize * 0.3),
        optimistic: Math.round(installBase * conversionRate * avgDealSize * 0.8),
        unit: 'USD'
      },
      conversionAssumptions: {
        installBase,
        conversionRate,
        avgDealSize
      }
    };
  }

  private getMonetizationStrategy(target: ZombieTarget, recommended: PricingSuggestion['recommended'], highCrashDensity?: boolean): string {
    const strategies: Record<string, string> = {
      lifetime: '强调"一次购买、永久使用"，对比原插件停更风险，突出修复保障',
      subscription: '强调"持续更新、官方支持"，月费低门槛，对比原插件被淘汰风险',
      freemium: '免费版提供基础功能，高级版解锁全部功能，降低用户试用门槛'
    };

    let strategy = strategies[recommended] || strategies.lifetime;

    // v5.5: 高崩溃密度插件的营销策略
    if (highCrashDensity) {
      strategy = '紧迫感营销：强调"原插件已彻底崩溃，我们已修复"，配合限时优惠促成转化';
    }

    // MV3 问题插件的营销策略
    if (target.reviewAnalysis?.mv3Broken) {
      strategy += '。重点强调"100% MV3 兼容"，这是用户最关心的技术点';
    }

    return strategy;
  }

  // ============================================================
  // 行动方案
  // ============================================================

  private generateActionPlan(target: ZombieTarget, score: ZombieScore['breakdown']): string[] {
    const actions: string[] = [];
    const analysis = target.reviewAnalysis;

    // v5.5: 包含技术修复建议
    if (analysis?.fixRecommendations && analysis.fixRecommendations.length > 0) {
      actions.push('【技术修复方案】');
      analysis.fixRecommendations.slice(0, 3).forEach((rec, i) => {
        actions.push(`  ${i + 1}. ${rec}`);
      });
      actions.push('');
    }

    // 1. 快速验证
    actions.push(`验证插件失效情况：搜索"${target.name} not working"，确认用户痛点真实性`);

    // 2. 技术分析
    if (analysis?.technicalErrors && analysis.technicalErrors.length > 0) {
      actions.push(`技术分析：重点排查 ${analysis.technicalErrors.join('、')} 问题`);
    } else {
      actions.push('技术评估：分析页面注入/修改逻辑，确定 MV3 兼容性方案');
    }

    // 3. 命名策略
    actions.push(`命名方案: "${target.name} Fixed" / "Ultimate ${target.name}" / "${target.name} Pro"`);

    // 4. 上架策略
    actions.push('上架 Chrome Web Store，设置 7 天试用期激活码');

    // 5. 营销方案
    if (score.crashDensity >= 20) {
      actions.push('营销重点：强调"已修复原作者所有 Bug"，利用现有崩溃评论引流');
    } else if (analysis?.mv3Broken) {
      actions.push('营销重点：强调"100% MV3 兼容"，这是用户最关心的技术点');
    } else {
      actions.push('利用现有差评作为素材，突出"修复版"vs"原版已废弃"的对比');
    }

    // 6. 差异化
    if (score.difficultyScore >= 15) {
      actions.push('技术门槛较低，专注于用户体验和界面优化即可');
    } else {
      actions.push('需要深入分析原版逻辑，优先解决用户核心痛点');
    }

    // v5.5: 开发者无响应警告
    if (analysis?.developerUnresponsive) {
      actions.push('⚠️ 开发者已失联：用户正在寻找替代方案，这是最佳进入时机');
    }

    return actions;
  }

  // ============================================================
  // 判决
  // ============================================================

  private determineVerdict(score: ZombieScore['breakdown'] & { total?: number }): ZombieScore['verdict'] {
    const total = score.total ?? (
      score.demandScore + score.complaintScore + score.difficultyScore + score.windowScore +
      (score.crashDensity || 0) + (score.developerUnresponsive || 0)
    );

    if (total >= 70) return 'ZOMBIE_TARGET';
    if (total >= 45) return 'WATCH';
    return 'SKIP';
  }

  private getVerdictReason(score: ZombieScore['breakdown'], verdict: ZombieScore['verdict'], total?: number): string {
    const scoreTotal = total ?? (
      score.demandScore + score.complaintScore + score.difficultyScore + score.windowScore +
      (score.crashDensity || 0) + (score.developerUnresponsive || 0)
    );
    const reasons: string[] = [];

    if (score.demandScore >= 30) {
      reasons.push(`需求热度高(${score.demandScore}分): 安装量超过10万`);
    } else if (score.demandScore < 20) {
      reasons.push(`需求热度低(${score.demandScore}分): 安装量不足`);
    }

    if (score.complaintScore >= 20) {
      reasons.push(`失效证明充分(${score.complaintScore}分): 负面评论占比高`);
    }

    if (score.difficultyScore >= 15) {
      reasons.push(`修复难度低(${score.difficultyScore}分): GitHub有仓库+权限简单`);
    }

    if (score.windowScore >= 5) {
      reasons.push(`窗口期大(${score.windowScore}分): 停更超过1年`);
    }

    // v5.5: 崩溃密度说明
    if (score.crashDensity > 0) {
      reasons.push(`🔥 崩溃密度高(${score.crashDensity}分): 用户强烈抱怨插件失效`);
    }

    // v5.5: 开发者无响应说明
    if (score.developerUnresponsive > 0) {
      reasons.push(`⚠️ 开发者失联(+${score.developerUnresponsive}分): 用户求助无门`);
    }

    if (verdict === 'ZOMBIE_TARGET') {
      return `综合评分 ${scoreTotal}/130，符合僵尸插件特征：${reasons.join('，')}`;
    } else if (verdict === 'WATCH') {
      return `综合评分 ${scoreTotal}/130，需要进一步验证：${reasons.join('，')}`;
    } else {
      return `综合评分 ${scoreTotal}/130，不符合僵尸插件标准`;
    }
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  getDemandLabel(installCount: number): string {
    if (installCount >= 1000000) return '🔥 爆款 (>100万用户)';
    if (installCount >= 500000) return '⭐ 高热 (50-100万用户)';
    if (installCount >= 100000) return '📈 热门 (10-50万用户)';
    if (installCount >= 10000) return '📊 稳定 (1-10万用户)';
    return '📉 小众 (<1万用户)';
  }

  getWindowLabel(daysSinceUpdate: number): string {
    if (daysSinceUpdate >= 730) return '⚠️ 长期停更 (>2年)';
    if (daysSinceUpdate >= 365) return '🕐 中期停更 (1-2年)';
    if (daysSinceUpdate >= 180) return '⏰ 近期停更 (6-12月)';
    return '✅ 近期更新 (<6月)';
  }
}

// ============================================================
// 便捷函数
// ============================================================

export function analyzeZombiePlugin(signal: ZombieTarget): AnalyzedZombie {
  const analyzer = new ChromeZombieAnalyzer();
  return analyzer.analyze(signal);
}

export function analyzeAllZombiePlugins(signals: ZombieTarget[]): AnalyzedZombie[] {
  const analyzer = new ChromeZombieAnalyzer();
  return analyzer.analyzeAll(signals);
}
