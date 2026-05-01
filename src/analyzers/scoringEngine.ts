// src/analyzers/scoringEngine.ts
// 评分引擎：负责在双 AI 分析结果之外，注入基于规则的惩罚与加分逻辑
// 与 EVO-3 Veto Learning、DeepSeek CTO 视角互补，不覆盖已有分数，只做增量调整

// ============================================================
// 类型定义（与 OpportunityHunter.ts 保持一致）
// ============================================================

export interface PainSignal {
  platform: string;
  title: string;
  description: string;
  url: string;
  sentiment: 'negative' | 'neutral' | 'positive';
  rawComments?: string[];
  source: string;
  timestamp: Date;
  category?: string;
  metadata?: Record<string, unknown>;
}

export interface SherlockRiskScore {
  total: number;
  securityRedLine: boolean;
  infraRedLine: boolean;
  platformBanRisk: number;
  techComplexity: number;
  technicalDebt: string[];
  verdict: 'PROCEED' | 'REVIEW' | 'REJECT';
  reasoning: string;
}

export interface SEOAnalysis {
  intentKeywords: string[];
  isOneTimeUse: boolean;
  frequencyScore: number;
  seoIntentVolume: number;
  highConversionPotential: boolean;
  pricingArbitrage: 'high' | 'medium' | 'low';
  analysis: string;
}

// ============================================================
// SoloHackerPenalty — 一人公司惩罚分
// ============================================================

interface PenaltyRule {
  /** 正则模式，不区分大小写 */
  pattern: RegExp;
  /** 惩罚分值 */
  deduction: number;
  /** 惩罚原因，用于报告展示 */
  reason: string;
}

const SOLO_HACKER_PENALTY_RULES: PenaltyRule[] = [
  // 需要持续威胁情报更新的领域
  {
    pattern: /\b(fraud|scam|security|threat|phishing|malware)\b/i,
    deduction: 40,
    reason: '需要持续威胁情报更新，一人团队难以维护'
  },
  // 合规门槛高，需要法律顾问
  {
    pattern: /\b(compliance|gdpr|hipaa|legal|tax|audit)\b/i,
    deduction: 30,
    reason: '合规门槛高，涉及法律/财务责任，一人团队风险大'
  },
  // 依赖平台 API，政策风险高
  {
    pattern: /\b(social\.?media|tiktok|instagram|youtube)\b/i,
    deduction: 20,
    reason: '依赖平台 API，政策/封号风险高，一人公司抗风险能力弱'
  },
  // 需要长期后台值守运维
  {
    pattern: /\b(monitor|alert|watchdog)\b/i,
    deduction: 25,
    reason: '需要长期后台值守运维，不适合一人公司的被动运营模式'
  },
  // 对接成本高，复杂集成
  {
    pattern: /\b(build.*flow|integration.*hub|unified.*dashboard)\b/i,
    deduction: 25,
    reason: '对接成本高，多系统集成复杂度超出 MVP 范围'
  },
  // 浏览器自动化 Agent 需持续对抗平台风控
  {
    pattern: /\bbrowser.*(use|harness|agent)\b/i,
    deduction: 30,
    reason: '浏览器自动化 Agent 需持续对抗平台风控，一人团队难以维护'
  },
  // AI Agent 平台需团队持续迭代
  {
    pattern: /\bai.*agent.*platform\b/i,
    deduction: 30,
    reason: 'AI Agent 平台需团队持续迭代 Prompt 和后端，一人团队迭代成本高'
  },
  // 开源替代品通常有社区维护，商业化难度高
  {
    pattern: /\bopensource.*alternative\b/i,
    deduction: 10,
    reason: '开源替代品通常有社区维护，用户付费意愿低，商业化难度高'
  },
  // 客服 AI 需训练数据和持续优化
  {
    pattern: /\b(chatbot|customer\.support\.ai)\b/i,
    deduction: 20,
    reason: '客服 AI 需训练数据和持续优化，单人难以维护高质量回复'
  },
  // 加密货币领域合规与市场风险极高
  {
    pattern: /\b(crypto|blockchain|defi)\b/i,
    deduction: 50,
    reason: '加密货币领域合规与市场风险极高，涉及监管不确定性'
  }
];

export interface SoloHackerPenaltyResult {
  /** 实际扣分（取所有匹配规则中的最高值） */
  deduction: number;
  /** 命中的惩罚原因，未命中则为 null */
  reason: string | null;
  /** 是否触发了一人公司惩罚 */
  triggered: boolean;
}

/**
 * 检测信号标题或分类是否命中一人公司不友好模式。
 * 取所有匹配规则中的最高扣分（避免重复扣分）。
 */
export function evaluateSoloHackerPenalty(signal: PainSignal): SoloHackerPenaltyResult {
  const text = [
    signal.title,
    signal.category ?? '',
    signal.description
  ].join(' ');

  let maxDeduction = 0;
  let hitReason: string | null = null;

  for (const rule of SOLO_HACKER_PENALTY_RULES) {
    if (rule.pattern.test(text)) {
      if (rule.deduction > maxDeduction) {
        maxDeduction = rule.deduction;
        hitReason = rule.reason;
      }
    }
  }

  return {
    deduction: maxDeduction,
    reason: hitReason,
    triggered: maxDeduction > 0
  };
}

// ============================================================
// 评分引擎主入口
// ============================================================

export interface ScoringResult {
  /** 调整后的风险总分（不低于 10） */
  adjustedRiskTotal: number;
  /** 原始风险总分 */
  originalRiskTotal: number;
  /** 一人公司惩罚 */
  soloHackerPenalty: SoloHackerPenaltyResult;
  /** 最终是否仍值得推进（risk <= 70 && adjustedRisk >= 10） */
  worthPursuing: boolean;
  /** 简短评语 */
  verdict: string;
}

/**
 * 综合评分入口。
 * 接收双 AI 分析结果，注入基于规则的增量调整，返回最终评分。
 *
 * 调用时机：在 DeepSeek.evaluate() 和 Doubao.analyze() 之后、
 * crossValidate() 之前或同期调用。
 */
export function computeFinalScore(
  signal: PainSignal,
  seo: SEOAnalysis,
  risk: SherlockRiskScore
): ScoringResult {
  // Step 1: 一人公司惩罚（取最高匹配项）
  const penalty = evaluateSoloHackerPenalty(signal);

  // Step 2: 写入 metadata，供报告使用
  if (signal.metadata && penalty.triggered) {
    signal.metadata['soloUnfriendlyReason'] = penalty.reason;
  }

  // Step 3: 计算调整后分数（最低不低于 10）
  const rawAdjusted = risk.total + penalty.deduction;
  const adjustedRiskTotal = Math.max(10, rawAdjusted);

  // Step 4: 判断是否仍值得推进
  const worthPursuing = adjustedRiskTotal <= 70;

  // Step 5: 生成评语
  let verdict: string;
  if (penalty.triggered) {
    verdict = `⚠️ 一人公司风险: ${penalty.reason}（扣${penalty.deduction}分）`;
  } else {
    verdict = '✅ 适合一人公司推进';
  }

  return {
    adjustedRiskTotal,
    originalRiskTotal: risk.total,
    soloHackerPenalty: penalty,
    worthPursuing,
    verdict
  };
}
