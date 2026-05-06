// src/analyzers/commercialPainAnalyzer.ts
// 商业痛感分析引擎 v3.0：从"修理工模式"升级到"商业顾问模式"
//
// 升级核心：
// 1. 三大利润杀手（原有）
// 2. 三大高价值服务方向（新增）：
//    - AI自动化咨询：帮卖家处理定制化AI应用问题
//    - 传统卖家数字化：大龄卖家、"一人公司"模式
//    - 利润漏洞诊断：广告、订单、库存堵漏洞

import type {
  BossChatSignal,
  BusinessPainSignal,
  ProfitKillerSeverity,
  ProfitKillerType
} from '../types.js';
import { ProfitKillerType as ProfitKillerTypeEnum } from '../types.js';

// ============================================================
// 利润杀手检测规则定义
// ============================================================

interface PainDetectionRule {
  type: ProfitKillerType;
  keywords: RegExp[];
  phrases: string[];
  severityBoost: number; // 匹配时额外增加的严重度
  estimatedLossPercent: number; // 估算月损失占营收比
  evidenceWeight: number; // 证据权重
}

/**
 * 三大利润杀手检测规则库
 */
const PROFIT_KILLER_RULES: PainDetectionRule[] = [
  // ============================================================
  // 杀手1: 退货与拒付
  // ============================================================
  {
    type: ProfitKillerTypeEnum.RETURNS_CHARGEBACKS,
    keywords: [
      /chargeback/i,
      /return.*fraud/i,
      /refund.*dispute/i,
      /item.*not.*received/i,
      /friendly.*fraud/i,
      /"didn't.*receive"/i,
      /"never.*received"/i,
      /"item.*not.*as.*described"/i,
      /"not.*as.*described"/i,
      /dispute.*rate/i,
      /refund.*rate/i,
      /return.*rate/i
    ],
    phrases: [
      'chargeback rate',
      'friendly fraud',
      'item not received',
      'return fraud',
      'refund dispute',
      'disputing charge'
    ],
    severityBoost: 3,
    estimatedLossPercent: 1.5, // 平均1.5%的营收损失
    evidenceWeight: 1.2
  },

  // ============================================================
  // 杀手2: 折扣滥用
  // ============================================================
  {
    type: ProfitKillerTypeEnum.DISCOUNT_ABUSE,
    keywords: [
      /discount.*stack/i,
      /stacking.*discount/i,
      /coupon.*abuse/i,
      /promo.*code.*stack/i,
      /discount.*叠加/i,
      /折扣.*叠加/i,
      /multiple.*discount/i,
      /combine.*discount/i,
      /loyalty.*discount/i,
      /referral.*discount/i,
      /points.*discount/i,
      /margin.*destroy/i,
      /margin.*kill/i,
      /margin.*erod/i,
      /selling.*at.*loss/i,
      /below.*cost/i,
      /discounting.*too.*much/i
    ],
    phrases: [
      'discount stacking',
      'margin destroyed',
      'stacking coupons',
      'multiple discounts',
      'discount abuse',
      'selling at loss'
    ],
    severityBoost: 2,
    estimatedLossPercent: 2.0, // 折扣滥用平均损失2%营收
    evidenceWeight: 1.0
  },

  // ============================================================
  // 杀手3: 库存与运费
  // ============================================================
  {
    type: ProfitKillerTypeEnum.INVENTORY_SHIPPING,
    keywords: [
      /shipping.*cost/i,
      /shipping.*rate/i,
      /freight.*cost/i,
      /overstock/i,
      /inventory.*stuck/i,
      /dead.*stock/i,
      /slow.*moving.*inventory/i,
      /stock.*level/i,
      /inventory.*discrepancy/i,
      /warehouse.*error/i,
      /fulfillment.*cost/i,
      /delivery.*cost/i,
      /logistics.*problem/i,
      /shipping.*overcharge/i,
      /weight.*miscalculation/i,
      /dimensional.*weight/i
    ],
    phrases: [
      'shipping cost',
      'overstock issue',
      'inventory stuck',
      'dead stock',
      'fulfillment problem',
      'shipping overcharge'
    ],
    severityBoost: 1,
    estimatedLossPercent: 1.2, // 库存/运费平均损失1.2%
    evidenceWeight: 0.9
  }
];

// ============================================================
// v3.0 新增：三大高价值服务方向检测
// "商业顾问模式"的核心升级
// ============================================================

/**
 * 高价值服务方向枚举
 */
export enum HighValueServiceDirection {
  /** AI自动化咨询师：帮卖家处理定制化AI应用问题 */
  AI_CONSULTING = 'ai-automation-consulting',
  /** 传统卖家数字化：帮大龄卖家/一人公司数字化转型 */
  DIGITAL_TRANSITION = 'digital-transition',
  /** 利润漏洞诊断：帮商家找问题、堵漏洞 */
  PROFIT_AUDIT = 'profit-audit'
}

/**
 * 高价值服务方向检测结果
 */
export interface HighValueServiceResult {
  direction: HighValueServiceDirection;
  serviceName: string;
  description: string;
  marketOpportunity: string;
  recommendedPricing: string;
  matchedKeywords: string[];
  confidence: number; // 0-1
}

/**
 * AI自动化咨询关键词
 */
const AI_CONSULTING_KEYWORDS = [
  /AI.*automation/i, /chatgpt.*business/i, /gpt.*integration/i,
  /AI.*agent/i, /artificial.*intelligence.*workflow/i,
  /zapier.*alternative/i, /make\.com.*alternative/i,
  /automation.*tool.*recommend/i, /build.*AI.*workflow/i,
  /custom.*AI.*solution/i, /prompt.*engineering/i,
  /AI.*implementation/i, /codex.*for.*shopify/i,
  /copilot.*setup/i, /AI.*set.*up/i,
  /notion.*AI/i, /automation.*confused/i,
  /too.*complex.*AI/i, /don't.*understand.*AI/i
];

/**
 * 传统卖家数字化关键词
 */
const DIGITAL_TRANSITION_KEYWORDS = [
  /sell.*online/i, /start.*selling/i, /how.*to.*sell.*internet/i,
  /digital.*marketing/i, /online.*presence/i, /go.*digital/i,
  /tiktok.*shop/i, /tiktok.*selling/i, /whatsapp.*business/i,
  /facebook.*shop/i, /instagram.*shopping/i, /multi.*channel.*selling/i,
  /not.*tech.*savvy/i, /don't.*understand.*tech/i,
  /need.*simple.*solution/i, /overwhelmed.*by.*tech/i,
  /too.*complicated/i, /one.*person.*business/i,
  /solopreneur/i, /side.*hustle/i, /first.*time.*selling/i,
  /new.*to.*ecommerce/i, /beginner.*seller/i,
  /older.*seller/i, /传统.*转型/i, /老龄.*卖家/i
];

/**
 * 利润漏洞诊断关键词
 */
const PROFIT_AUDIT_KEYWORDS = [
  /profit.*audit/i, /where.*is.*money.*going/i, /loss.*analysis/i,
  /profit.*leak/i, /money.*leaking/i, /money.*disappearing/i,
  /hidden.*cost/i, /unexpected.*expense/i, /surprise.*fee/i,
  /ad.*spend.*not.*converting/i, /advertising.*roi/i,
  /ads.*not.*working/i, /conversion.*rate.*low/i,
  /cart.*abandonment/i, /abandoned.*cart.*recovery/i,
  /sales.*good.*profit.*bad/i, /revenue.*but.*no.*profit/i,
  /fee.*too.*high/i, /shopify.*fee.*high/i,
  /transaction.*fee/i, /payment.*processing.*fee/i,
  /cost.*analysis/i, /margins.*squeezed/i
];

// ============================================================
// 痛感级别阈值
// ============================================================

interface SeverityThreshold {
  level: 'critical' | 'high' | 'medium' | 'low';
  minScore: number;
}

const SEVERITY_THRESHOLDS: SeverityThreshold[] = [
  { level: 'critical', minScore: 8 },
  { level: 'high', minScore: 5 },
  { level: 'medium', minScore: 2 },
  { level: 'low', minScore: 0 }
];

// ============================================================
// 紧迫度评估
// ============================================================

interface UrgencyMapping {
  urgency: 'immediate' | 'week' | 'month';
  keywords: RegExp[];
}

const URGENCY_MAPPINGS: UrgencyMapping[] = [
  {
    urgency: 'immediate',
    keywords: [
      /urgent|asap|immediately|emergency|right.now|critical|deadline/i,
      /killing.*business|losing.*money|bankrupt|shut.*down/i
    ]
  },
  {
    urgency: 'week',
    keywords: [
      /this.*week|next.*week|within.*days|days.*ago|recent/i
    ]
  },
  {
    urgency: 'month',
    keywords: [
      /month|weeks|sometimes|occasionally|every.*time/i
    ]
  }
];

// ============================================================
// 商业痛感分析器主类
// ============================================================

export class CommercialPainAnalyzer {
  /**
   * 分析老板聊天群信号，提取商业痛感
   * v3.0: 同时检测三大利润杀手和高价值服务方向
   */
  analyzeSignal(signal: BossChatSignal): BusinessPainSignal {
    const combinedText = `${signal.title} ${signal.description} ${signal.originalText || ''}`;

    // 检测三大利润杀手
    const detectedKillers = this.detectProfitKillers(combinedText);

    // v3.0 新增：检测高价值服务方向
    const highValueServices = this.detectHighValueServices(combinedText);

    // 计算痛感级别
    const painLevel = this.calculatePainLevel(detectedKillers, signal);

    // 估算月损失
    const estimatedMonthlyLoss = this.estimateMonthlyLoss(detectedKillers, signal);

    return {
      platform: signal.platform,
      title: signal.title,
      description: signal.description,
      url: signal.url,
      sentiment: signal.sentiment,
      source: signal.platform,
      timestamp: signal.postedAt,
      rawText: signal.originalText || signal.description,
      profitKillers: detectedKillers,
      estimatedMonthlyLoss,
      painLevel,
      metadata: {
        budget: signal.budget,
        tags: signal.tags,
        responseCount: signal.responseCount,
        isUrgent: signal.isUrgent,
        // v3.0 新增：高价值服务方向
        highValueServices,
        highValueInsight: this.generateHighValueServiceInsight(highValueServices)
      }
    };
  }

  /**
   * 批量分析多个信号
   */
  analyzeSignals(signals: BossChatSignal[]): BusinessPainSignal[] {
    return signals.map(signal => this.analyzeSignal(signal));
  }

  /**
   * 核心检测逻辑：检测三大利润杀手
   */
  private detectProfitKillers(text: string): ProfitKillerSeverity[] {
    const results: ProfitKillerSeverity[] = [];
    const lowerText = text.toLowerCase();

    for (const rule of PROFIT_KILLER_RULES) {
      const matchResult = this.matchRule(rule, lowerText, text);

      if (matchResult.score > 0) {
        results.push({
          type: rule.type,
          severity: this.scoreToSeverity(matchResult.score),
          estimatedLossPercent: rule.estimatedLossPercent,
          evidenceCount: matchResult.matchCount,
          urgency: this.detectUrgency(text),
          description: matchResult.description
        });
      }
    }

    return results;
  }

  /**
   * 匹配规则
   */
  private matchRule(
    rule: PainDetectionRule,
    lowerText: string,
    originalText: string
  ): { score: number; matchCount: number; description: string } {
    let score = 0;
    let matchCount = 0;
    const matchedPhrases: string[] = [];

    // 匹配关键词
    for (const keyword of rule.keywords) {
      if (keyword.test(lowerText)) {
        score += 1;
        matchCount += 1;
        matchedPhrases.push(keyword.source);
      }
    }

    // 匹配短语
    for (const phrase of rule.phrases) {
      if (lowerText.includes(phrase.toLowerCase())) {
        score += 1;
        matchCount += 1;
        matchedPhrases.push(phrase);
      }
    }

    // 应用严重度加成
    score += rule.severityBoost * Math.min(matchCount, 3);

    // 生成描述
    const typeLabel = this.getTypeLabel(rule.type);
    const description = matchCount > 0
      ? `${typeLabel} 迹象: ${matchedPhrases.slice(0, 3).join(', ')}`
      : '';

    return { score, matchCount, description };
  }

  /**
   * 分数转严重度
   */
  private scoreToSeverity(score: number): 'critical' | 'high' | 'medium' | 'low' {
    for (const threshold of SEVERITY_THRESHOLDS) {
      if (score >= threshold.minScore) {
        return threshold.level;
      }
    }
    return 'low';
  }

  /**
   * 计算整体痛感级别
   */
  private calculatePainLevel(
    killers: ProfitKillerSeverity[],
    signal: BossChatSignal
  ): 'critical' | 'high' | 'medium' | 'low' {
    if (killers.length === 0) return 'low';

    // 最高严重度
    const maxSeverity = killers.reduce((max, k) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[k.severity] > severityOrder[max] ? k.severity : max;
    }, 'low' as 'critical' | 'high' | 'medium' | 'low');

    // 紧急标记加成
    if (signal.isUrgent && maxSeverity !== 'critical') {
      return maxSeverity === 'high' ? 'critical' : 'high';
    }

    // 多杀手叠加
    if (killers.length >= 2) {
      return maxSeverity === 'critical' ? 'critical' : 'high';
    }

    return maxSeverity;
  }

  /**
   * 检测紧迫度
   */
  private detectUrgency(text: string): 'immediate' | 'week' | 'month' {
    const lowerText = text.toLowerCase();

    for (const mapping of URGENCY_MAPPINGS) {
      for (const keyword of mapping.keywords) {
        if (keyword.test(lowerText)) {
          return mapping.urgency;
        }
      }
    }

    return 'month';
  }

  /**
   * 估算月损失
   */
  private estimateMonthlyLoss(
    killers: ProfitKillerSeverity[],
    signal: BossChatSignal
  ): number {
    if (killers.length === 0) return 0;

    // 基础估算：假设中型电商月营收$50,000
    const baseRevenue = 50000;

    // 计算综合损失百分比
    const totalLossPercent = killers.reduce((sum, k) => sum + k.estimatedLossPercent, 0);

    // 紧迫度加成
    const urgencyMultiplier = {
      immediate: 1.5,
      week: 1.2,
      month: 1.0
    };

    const urgency = killers[0]?.urgency || 'month';
    const multiplier = urgencyMultiplier[urgency];

    // 估算损失
    const estimatedLoss = baseRevenue * (totalLossPercent / 100) * multiplier;

    // 如果有Upwork预算，用预算作为参考
    if (signal.budget) {
      return Math.max(estimatedLoss, signal.budget);
    }

    return Math.round(estimatedLoss);
  }

  /**
   * 获取类型标签
   */
  private getTypeLabel(type: ProfitKillerType): string {
    const labels: Record<ProfitKillerType, string> = {
      [ProfitKillerTypeEnum.RETURNS_CHARGEBACKS]: '退货与拒付',
      [ProfitKillerTypeEnum.DISCOUNT_ABUSE]: '折扣滥用',
      [ProfitKillerTypeEnum.INVENTORY_SHIPPING]: '库存与运费'
    };
    return labels[type];
  }

  // ============================================================
  // v3.0 新增：高价值服务方向检测
  // ============================================================

  /**
   * 检测高价值服务方向
   * 商业顾问模式的核心：识别三大高价值服务机会
   */
  detectHighValueServices(text: string): HighValueServiceResult[] {
    const results: HighValueServiceResult[] = [];
    const lowerText = text.toLowerCase();

    // 1. AI自动化咨询
    const aiMatches = AI_CONSULTING_KEYWORDS.filter(k => k.test(lowerText));
    if (aiMatches.length > 0) {
      results.push({
        direction: HighValueServiceDirection.AI_CONSULTING,
        serviceName: 'AI自动化咨询师',
        description: '帮卖家处理定制化的AI应用问题（GPT集成、工作流自动化、提示词工程）',
        marketOpportunity: 'Zapier替代品抱怨扎堆，Codex/Copilot难用，市场急需AI自动化落地服务',
        recommendedPricing: '咨询费$150-300/小时；项目制$500-3000；月订阅$99-299',
        matchedKeywords: aiMatches.map(k => k.source),
        confidence: Math.min(1, aiMatches.length / 2)
      });
    }

    // 2. 传统卖家数字化
    const digitalMatches = DIGITAL_TRANSITION_KEYWORDS.filter(k => k.test(lowerText));
    if (digitalMatches.length > 0) {
      results.push({
        direction: HighValueServiceDirection.DIGITAL_TRANSITION,
        serviceName: '传统卖家数字化顾问',
        description: '帮大龄卖家、"一人公司"模式进行数字化转型',
        marketOpportunity: '大量传统行业卖家出海，不懂技术，需要"手把手"指导',
        recommendedPricing: '起步套餐$299-599；月服务$99-199；按次咨询$100-200',
        matchedKeywords: digitalMatches.map(k => k.source),
        confidence: Math.min(1, digitalMatches.length / 2)
      });
    }

    // 3. 利润漏洞诊断
    const profitMatches = PROFIT_AUDIT_KEYWORDS.filter(k => k.test(lowerText));
    if (profitMatches.length > 0) {
      results.push({
        direction: HighValueServiceDirection.PROFIT_AUDIT,
        serviceName: '利润漏洞诊断师',
        description: '帮商家分析广告、订单、库存环节，找问题、堵漏洞',
        marketOpportunity: '"销售很好但没钱赚"是普遍痛点，诊断服务市场需求大',
        recommendedPricing: '诊断报告$199-499；深度审计$999-1999；月跟踪服务$299-599',
        matchedKeywords: profitMatches.map(k => k.source),
        confidence: Math.min(1, profitMatches.length / 2)
      });
    }

    return results;
  }

  /**
   * 获取高价值服务方向的洞察
   */
  generateHighValueServiceInsight(results: HighValueServiceResult[]): string {
    if (results.length === 0) {
      return '未检测到高价值服务机会';
    }

    const services = results.map(r => r.serviceName).join(' + ');

    if (results.length === 1) {
      const r = results[0];
      return `🎯 高价值服务方向: ${r.serviceName} | ${r.marketOpportunity.substring(0, 30)}...`;
    }

    return `🎯 多元服务机会: ${services} | 综合置信度 ${Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length * 100)}%`;
  }

  /**
   * 生成洞察摘要
   */
  generateInsight(painSignal: BusinessPainSignal): string {
    if (painSignal.profitKillers.length === 0) {
      return '未检测到明确的利润杀手迹象';
    }

    const killers = painSignal.profitKillers;
    const maxSeverity = killers.reduce((max, k) => {
      const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[k.severity] > severityOrder[max] ? k.severity : max;
    }, 'low' as 'critical' | 'high' | 'medium' | 'low');

    const typeLabels = killers.map(k => this.getTypeLabel(k.type)).join(' + ');
    const lossStr = painSignal.estimatedMonthlyLoss
      ? `，估算月损失 $${painSignal.estimatedMonthlyLoss}`
      : '';

    const severityMessage = {
      critical: '🔴 危急：需要立即处理',
      high: '🟠 严重：建议本周内解决',
      medium: '🟡 中等：可安排计划处理',
      low: '🟢 轻微：持续关注'
    }[maxSeverity];

    return `${severityMessage} | 检测到利润杀手: ${typeLabels}${lossStr}`;
  }
}

// ============================================================
// AI增强版分析器（可选）
// ============================================================

export interface AIInsightResult {
  summary: string;
  rootCause: string;
  recommendedActions: string[];
  riskFactors: string[];
}

/**
 * 使用AI提炼商业洞察
 * 从原始文本中提取更深入的洞察
 */
export async function extractAIInsight(
  signal: BossChatSignal,
  apiKey: string
): Promise<AIInsightResult> {
  const prompt = `你是一位电商商业分析师，专门识别电商卖家的利润损失源头。

【原始帖子】
标题: ${signal.title}
正文: ${signal.description}
平台: ${signal.platform}
标签: ${signal.tags?.join(', ') || '无'}

【任务】
分析这个帖子，识别三大利润杀手中的哪些正在影响这位卖家：
1. 退货与拒付 - 退货欺诈、拒付产生的真实损失
2. 折扣滥用 - 不合理的折扣叠加和频繁打折
3. 库存与运费 - 库存积压、运费计算错误

【输出要求】
请用JSON格式输出：
{
  "summary": "一句话总结核心痛点",
  "rootCause": "根本原因分析（50字内）",
  "recommendedActions": ["可执行建议1", "可执行建议2", "可执行建议3"],
  "riskFactors": ["潜在风险因素1", "风险因素2"]
}

【输出】
只输出JSON，不要其他内容。`;

  try {
    // 这里可以接入实际的AI API
    // 为了简化，暂时返回基于规则的推断
    const analyzer = new CommercialPainAnalyzer();
    const pain = analyzer.analyzeSignal(signal);

    const killerLabels = pain.profitKillers.map(k =>
      ({
        [ProfitKillerTypeEnum.RETURNS_CHARGEBACKS]: '退货与拒付问题',
        [ProfitKillerTypeEnum.DISCOUNT_ABUSE]: '折扣滥用问题',
        [ProfitKillerTypeEnum.INVENTORY_SHIPPING]: '库存与运费问题'
      })[k.type]
    ).filter(Boolean);

    return {
      summary: `卖家面临${killerLabels.join('、') || '待确认'}的挑战${pain.estimatedMonthlyLoss ? `，估算月损失约$${pain.estimatedMonthlyLoss}` : ''}`,
      rootCause: pain.profitKillers[0]?.description || '需要进一步诊断',
      recommendedActions: generateRecommendations(pain),
      riskFactors: identifyRiskFactors(pain)
    };
  } catch (error) {
    return {
      summary: '无法生成AI洞察',
      rootCause: '分析过程出错',
      recommendedActions: [],
      riskFactors: []
    };
  }
}

function generateRecommendations(pain: BusinessPainSignal): string[] {
  const recommendations: string[] = [];

  for (const killer of pain.profitKillers) {
    switch (killer.type) {
      case ProfitKillerTypeEnum.RETURNS_CHARGEBACKS:
        recommendations.push(
          '分析近期拒付订单，识别高风险特征模式',
          '启用订单风险评分系统，标记可疑订单',
          '收集签收证明，建立拒付争议处理流程'
        );
        break;
      case ProfitKillerTypeEnum.DISCOUNT_ABUSE:
        recommendations.push(
          '审计当前所有折扣码和促销规则',
          '设置折扣叠加上限，防止利润侵蚀',
          '建立折扣ROI评估机制'
        );
        break;
      case ProfitKillerTypeEnum.INVENTORY_SHIPPING:
        recommendations.push(
          '审核运费设置，与实际承运商费率对比',
          '清理滞销库存，优化库存周转率',
          '评估第三方物流(3PL)替代方案'
        );
        break;
    }
  }

  return recommendations.length > 0 ? recommendations : ['建议进行全面的商业审计'];
}

function identifyRiskFactors(pain: BusinessPainSignal): string[] {
  const risks: string[] = [];

  for (const killer of pain.profitKillers) {
    switch (killer.type) {
      case ProfitKillerTypeEnum.RETURNS_CHARGEBACKS:
        risks.push(
          '高拒付率可能触发支付网关处罚或账户暂停',
          '退货欺诈可能导致库存损失和二次销售成本'
        );
        break;
      case ProfitKillerTypeEnum.DISCOUNT_ABUSE:
        risks.push(
          '利润侵蚀可能导致现金流紧张',
          '无限制折扣可能损害品牌定位'
        );
        break;
      case ProfitKillerTypeEnum.INVENTORY_SHIPPING:
        risks.push(
          '库存积压占用大量资金',
          '运费误差可能导致定价失误'
        );
        break;
    }
  }

  if (pain.estimatedMonthlyLoss && pain.estimatedMonthlyLoss > 1000) {
    risks.push(`月损失$${pain.estimatedMonthlyLoss}可能影响业务可持续性`);
  }

  return risks;
}

// ============================================================
// 导出便捷函数
// ============================================================

export function analyzeCommercialPain(signals: BossChatSignal[]): BusinessPainSignal[] {
  const analyzer = new CommercialPainAnalyzer();
  return analyzer.analyzeSignals(signals);
}
