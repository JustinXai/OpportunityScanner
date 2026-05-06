// src/generators/actionPlanGenerator.ts
// 行动方案生成器：从商业痛点生成诊断-治疗-附加价值的完整行动方案
// 升级产出：从"推荐工具"到"提供行动"
// 升级 v2.0：新增"夯爆"时代运营动作
//
// 模仿医生看诊的结构化输出：
// - 诊断 (Diagnosis)：清晰指出"病灶"
// - 治疗方案 (Fix Plan)：提供可执行的"药方"
// - 附加价值 (GeoSEO Playbook)：提供额外"保健建议"
// - 运营动作 (Growth Actions)：社群引流/知识付费/GEO策略

import type {
  BusinessPainSignal,
  BossChatSignal,
  ActionableOpportunity,
  Diagnosis,
  FixPlan,
  GeoSEOPlaybook,
  ProfitKillerType,
  ProfitKillerSeverity
} from '../types.js';
import { ProfitKillerType as PKT } from '../types.js';
import {
  BusinessValueTier,
  rankBusinessValue,
  detectSOSSignals,
  generateActionRecommendation,
  EnhancedSignalResult,
  assessServiceOpportunity
} from '../analyzers/scoringEngine.js';

// ============================================================
// 新增 v2.0：运营动作类型定义
// ============================================================

/**
 * 社群引流钩子
 */
export interface CommunityHook {
  /** 钩子类型 */
  type: 'reddit_reply' | 'facebook_group' | 'linkedin_post' | 'discord_invite';
  /** 目标平台 */
  platform: string;
  /** 钩子内容 */
  hook: string;
  /** 行动号召 */
  callToAction: string;
  /** 预计效果 */
  expectedEngagement: 'high' | 'medium' | 'low';
}

/**
 * 知识付费钩子
 */
export interface KnowledgeProductHook {
  /** 产品类型 */
  productType: 'checklist' | 'template' | 'course' | 'template_pack' | 'audit_tool';
  /** 标题 */
  title: string;
  /** 朋友圈/社交文案 */
  socialCopy: string;
  /** 钩子 */
  hook: string;
  /** 行动号召 */
  callToAction: string;
}

/**
 * GEO关键词建议
 */
export interface GEOSuggestion {
  /** 关键词类型 */
  type: 'long_tail' | 'question' | 'comparison' | 'how_to';
  /** 关键词 */
  keyword: string;
  /** 月搜索量估算 */
  estimatedMonthlyVolume: number;
  /** 竞争程度 */
  competition: 'low' | 'medium' | 'high';
  /** 应用场景 */
  useCase: string;
}

/**
 * 运营动作完整输出
 */
export interface GrowthActions {
  /** 社群引流钩子 */
  communityHooks: CommunityHook[];
  /** 知识付费钩子（仅对人上人层级生效） */
  knowledgeProductHooks: KnowledgeProductHook[];
  /** GEO关键词建议 */
  geoSuggestions: GEOSuggestion[];
  /** 行动优先级 */
  priorityAction: string;
}

// ============================================================
// 服务包模板定义
// ============================================================

interface ServicePackage {
  name: string;
  description: string;
  deliverables: string[];
  estimatedHours: number;
  priceRange: { min: number; max: number; currency: string };
}

/**
 * 针对三大利润杀手的服务包模板
 */
const SERVICE_PACKAGES: Record<ProfitKillerType, ServicePackage[]> = {
  [PKT.RETURNS_CHARGEBACKS]: [
    {
      name: '订单安全审计套餐',
      description: '全面分析你的订单数据，识别拒付和退货欺诈模式',
      deliverables: [
        '最近90天拒付订单分析报告',
        '退货欺诈高风险特征清单',
        '订单风险评分系统配置指南',
        '拒付争议处理SOP文档'
      ],
      estimatedHours: 8,
      priceRange: { min: 299, max: 499, currency: 'USD' }
    },
    {
      name: '反欺诈系统实施',
      description: '部署自动化反欺诈工具，实时拦截可疑订单',
      deliverables: [
        '欺诈检测规则配置',
        '可疑订单自动标记系统',
        '风险订单处理工作流',
        '员工反欺诈培训材料'
      ],
      estimatedHours: 16,
      priceRange: { min: 799, max: 1499, currency: 'USD' }
    }
  ],

  [PKT.DISCOUNT_ABUSE]: [
    {
      name: '折扣策略审计套餐',
      description: '审计你所有的折扣规则，识别利润漏洞',
      deliverables: [
        '当前折扣规则完整清单',
        '折扣叠加风险分析报告',
        '折扣规则优化建议',
        '防止折扣堆叠的配置指南'
      ],
      estimatedHours: 6,
      priceRange: { min: 199, max: 349, currency: 'USD' }
    },
    {
      name: '智能折扣系统',
      description: '设置折扣规则引擎，防止利润侵蚀',
      deliverables: [
        '折扣优先级规则配置',
        '自动折扣上限设置',
        '折扣效果追踪仪表板',
        '促销ROI计算模板'
      ],
      estimatedHours: 12,
      priceRange: { min: 499, max: 999, currency: 'USD' }
    }
  ],

  [PKT.INVENTORY_SHIPPING]: [
    {
      name: '物流成本审计',
      description: '分析你的运费设置，对比实际承运商费率',
      deliverables: [
        '当前运费配置分析',
        '承运商费率对比报告',
        '运费定价优化建议',
        '物流供应商推荐清单'
      ],
      estimatedHours: 8,
      priceRange: { min: 249, max: 449, currency: 'USD' }
    },
    {
      name: '库存优化方案',
      description: '清理滞销库存，优化库存结构',
      deliverables: [
        '库存健康度评估报告',
        '滞销商品清单及处置建议',
        '库存周转率优化方案',
        '库存管理系统配置'
      ],
      estimatedHours: 12,
      priceRange: { min: 399, max: 799, currency: 'USD' }
    }
  ]
};

/**
 * 通用服务包（混合问题）
 */
const GENERIC_PACKAGES: ServicePackage[] = [
  {
    name: '商业诊断完整套餐',
    description: '全面诊断你的电商业务，识别所有利润漏洞',
    deliverables: [
      '三大利润杀手全面审计',
      '月损失估算及优先级排序',
      '定制化解决方案路线图',
      '实施效果跟踪指标'
    ],
    estimatedHours: 20,
    priceRange: { min: 999, max: 1999, currency: 'USD' }
  }
];

// ============================================================
// 行动方案生成器主类
// ============================================================

export class ActionPlanGenerator {
  /**
   * 从商业痛感信号生成完整的行动方案
   */
  generateActionPlan(painSignal: BusinessPainSignal): ActionableOpportunity {
    // 生成诊断
    const diagnosis = this.generateDiagnosis(painSignal);

    // 生成治疗方案
    const fixPlan = this.generateFixPlan(painSignal, diagnosis);

    // 生成附加价值
    const geoSEOPlaybook = this.generateGeoSEOPlaybook(painSignal, diagnosis);

    // v2.0 新增：生成运营动作
    const growthActions = this.generateGrowthActions(painSignal);

    // v3.0 新增：生成搞客户行动（针对高分机会）
    const serviceAssessment = assessServiceOpportunity(painSignal);
    const clientAcquisitionAction = serviceAssessment.isResultsDeliveryOpportunity
      ? this.generateClientAcquisitionAction(painSignal, serviceAssessment)
      : undefined;

    // 综合评分
    const scoring = this.calculateScoring(painSignal, diagnosis, fixPlan);

    return {
      id: `opp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      source: {
        platform: painSignal.platform as any,
        title: painSignal.title,
        url: painSignal.url,
        postedAt: painSignal.timestamp
      },
      diagnosis,
      fixPlan,
      geoSEOPlaybook,
      growthActions,
      clientAcquisitionAction,
      scoring,
      tags: this.generateTags(painSignal),
      status: 'new'
    };
  }

  // ============================================================
  // v2.0 新增：生成运营动作
  // ============================================================

  /**
   * 生成"夯爆"时代的运营动作
   */
  private generateGrowthActions(painSignal: BusinessPainSignal): ActionableOpportunity['growthActions'] {
    // 1. 生成社群引流钩子
    const communityHooks = this.generateCommunityHooks(painSignal);

    // 2. 生成知识付费钩子（仅对"人上人"层级生效）
    const businessValue = rankBusinessValue(painSignal);
    const knowledgeProductHooks = businessValue.tier === BusinessValueTier.ELITE
      ? this.generateKnowledgeProductHooks(painSignal)
      : undefined;

    // 3. 生成GEO关键词建议
    const geoSuggestions = this.generateGEOSuggestions(painSignal);

    // 4. 生成优先级行动
    const sosSignal = detectSOSSignals(painSignal);
    const serviceAssessment = assessServiceOpportunity(painSignal);
    const priorityAction = generateActionRecommendation({
      signal: painSignal,
      businessValue,
      sosSignal,
      serviceAssessment,
      enhancedScore: 0,
      tier: businessValue.tier,
      isHighPriority: false
    });

    return {
      communityHooks,
      knowledgeProductHooks,
      geoSuggestions,
      priorityAction
    };
  }

  // ============================================================
  // v3.0 新增：生成搞客户行动
  // ============================================================

  /**
   * 生成"搞客户"行动建议
   * 针对高分结果交付型机会，自动生成获客策略
   */
  private generateClientAcquisitionAction(
    painSignal: BusinessPainSignal,
    serviceAssessment: { serviceabilityLevel: string; acquisitionChannel: string; soloLevel: string; totalServiceScore: number }
  ): ActionableOpportunity['clientAcquisitionAction'] {
    const killer = painSignal.profitKillers[0];
    const killerName = killer ? this.getKillerName(killer.type) : '业务痛点';
    const text = `${painSignal.title} ${painSignal.description}`.toLowerCase();

    // 1. 搜索量估算
    const searchVolumeEstimate = this.estimateSearchVolume(text, killerName);

    // 2. 推荐获客渠道
    const recommendedChannels = this.getRecommendedChannels(serviceAssessment, killerName);

    // 3. 服务包装话术
    const servicePitch = this.generateServicePitch(painSignal, killerName, serviceAssessment);

    // 4. 建议定价方案
    const pricing = this.generatePricing(serviceAssessment, killerName);

    // 5. 快速启动建议
    const quickStart = this.generateQuickStart(serviceAssessment, killerName);

    // 6. 预期收益估算
    const revenueEstimate = this.estimateRevenue(serviceAssessment, killerName);

    return {
      searchVolumeEstimate,
      recommendedChannels,
      servicePitch,
      pricing,
      quickStart,
      revenueEstimate
    };
  }

  /**
   * 估算搜索量
   */
  private estimateSearchVolume(
    text: string,
    killerName: string
  ): NonNullable<ActionableOpportunity['clientAcquisitionAction']>['searchVolumeEstimate'] {
    // 基于关键词估算搜索量
    const keywordMap: Record<string, { volume: number; competition: 'low' | 'medium' | 'high' }> = {
      'chargeback': { volume: 5400, competition: 'high' },
      '退货欺诈': { volume: 3200, competition: 'medium' },
      '折扣滥用': { volume: 2100, competition: 'low' },
      '退货': { volume: 8800, competition: 'high' },
      '拒付': { volume: 2400, competition: 'medium' },
      '运费': { volume: 6600, competition: 'high' },
      '库存': { volume: 5900, competition: 'medium' },
      'audit': { volume: 8100, competition: 'high' },
      'profit': { volume: 4800, competition: 'medium' },
      'refund': { volume: 7200, competition: 'high' }
    };

    // 提取最相关的关键词
    let bestMatch: { keyword: string; volume: number; competition: 'low' | 'medium' | 'high' } = {
      keyword: killerName,
      volume: 2400,
      competition: 'medium'
    };

    for (const [keyword, data] of Object.entries(keywordMap)) {
      if (text.includes(keyword)) {
        if (data.volume > bestMatch.volume) {
          bestMatch = { keyword, volume: data.volume, competition: data.competition };
        }
      }
    }

    return {
      keyword: bestMatch.keyword,
      monthlyVolume: bestMatch.volume,
      competition: bestMatch.competition,
      source: 'keyword_data_estimate'
    };
  }

  /**
   * 推荐获客渠道
   */
  private getRecommendedChannels(
    serviceAssessment: { serviceabilityLevel: string; acquisitionChannel: string; soloLevel: string },
    killerName: string
  ): NonNullable<ActionableOpportunity['clientAcquisitionAction']>['recommendedChannels'] {
    const channels = [];

    if (serviceAssessment.acquisitionChannel === 'direct-platform' || serviceAssessment.serviceabilityLevel === 'results-delivery') {
      channels.push({
        channel: 'upwork' as const,
        priority: 'primary' as const,
        action: `搜索 "${killerName} Shopify" 相关工作，立即投标`,
        expectedCPL: 50
      });
      channels.push({
        channel: 'fiverr' as const,
        priority: 'primary' as const,
        action: `创建 "${killerName} for Shopify" 服务 gig`,
        expectedCPL: 30
      });
    }

    channels.push({
      channel: 'reddit' as const,
      priority: 'secondary' as const,
      action: `在 r/shopify, r/ecommerce 发帖分享 "${killerName} 解决方案"`,
      expectedCPL: 20
    });

    channels.push({
      channel: 'facebook_groups' as const,
      priority: 'secondary' as const,
      action: `加入 Shopify Seller Groups，分享专业内容引流`,
      expectedCPL: 15
    });

    if (serviceAssessment.soloLevel === 'easy') {
      channels.push({
        channel: 'personal_website' as const,
        priority: 'experimental' as const,
        action: `搭建落地页，用 SEO 长期获客`,
        expectedCPL: 80
      });
    }

    return channels;
  }

  /**
   * 生成服务包装话术
   */
  private generateServicePitch(
    painSignal: BusinessPainSignal,
    killerName: string,
    serviceAssessment: { serviceabilityLevel: string }
  ): NonNullable<ActionableOpportunity['clientAcquisitionAction']>['servicePitch'] {
    const killer = painSignal.profitKillers[0];
    const killerDesc = killer ? killer.description : '';

    return {
      headline: `Stop Losing Money to ${killerName} - Get Your Money Back in 48 Hours`,
      elevatorPitch: `I'll audit your Shopify store for ${killerName.toLowerCase()} issues and show you exactly where your profit is leaking. Most sellers find 500-2000 in recoverable losses in their first audit.`,
      valueProposition: `- Free profit leak diagnosis (15 min)
- Detailed ${killerName.toLowerCase()} audit report
- Step-by-step fix recommendations
- 30-day follow-up support`,
      socialProof: `helped 50+ Shopify sellers recover an average of $1,200/month`
    };
  }

  /**
   * 生成定价方案
   */
  private generatePricing(
    serviceAssessment: { serviceabilityLevel: string; totalServiceScore: number },
    killerName: string
  ): NonNullable<ActionableOpportunity['clientAcquisitionAction']>['pricing'] {
    // 基于评分决定定价水平
    const isHighValue = serviceAssessment.totalServiceScore >= 50;
    const basePrice = isHighValue ? 149 : 79;
    const standardPrice = isHighValue ? 299 : 199;
    const premiumPrice = isHighValue ? 499 : 349;

    return {
      currency: 'USD',
      tiers: [
        {
          name: 'Starter',
          price: basePrice,
          deliverables: [
            `${killerName} audit report`,
            'Top 5 issues identified',
            'Basic fix instructions'
          ],
          targetClient: 'New sellers with <$5k/month revenue'
        },
        {
          name: 'Standard',
          price: standardPrice,
          deliverables: [
            'Complete store audit',
            'Full fix implementation',
            '30-day email support',
            'Prevention checklist'
          ],
          targetClient: 'Growing stores $5k-$50k/month'
        },
        {
          name: 'Premium',
          price: premiumPrice,
          deliverables: [
            'Everything in Standard',
            'Priority 24hr delivery',
            '3x 30-min video calls',
            'Custom automation scripts',
            'Quarterly check-ins'
          ],
          targetClient: 'High-volume stores $50k+/month'
        }
      ],
      recommendedTier: isHighValue ? 'standard' : 'starter'
    };
  }

  /**
   * 生成快速启动建议
   */
  private generateQuickStart(
    serviceAssessment: { acquisitionChannel: string },
    killerName: string
  ): NonNullable<ActionableOpportunity['clientAcquisitionAction']>['quickStart'] {
    return {
      day1: `1. 创建 Upwork/Fiverr 账号
2. 搜索 "${killerName} Shopify" 了解市场需求
3. 准备 3-5 个服务模板`,
      week1: `1. 发布 2 个服务 gig
2. 每天投标 5-10 个相关工作
3. 在 Reddit r/shopify 回复 1 个相关帖子
4. 加入 3 个 Facebook Seller Groups`,
      month1: `1. 优化服务描述，基于客户反馈
2. 建立 3-5 个成功案例
3. 考虑搭建个人落地页
4. 测试定价策略，提升转化率`
    };
  }

  /**
   * 估算预期收益
   */
  private estimateRevenue(
    serviceAssessment: { serviceabilityLevel: string; acquisitionChannel: string; soloLevel: string },
    killerName: string
  ): NonNullable<ActionableOpportunity['clientAcquisitionAction']>['revenueEstimate'] {
    // 基础数据
    let monthlyClients = 2;
    let avgDealSize = 199;
    let difficulty: 'easy' | 'medium' | 'hard' = 'medium';

    if (serviceAssessment.acquisitionChannel === 'direct-platform' && serviceAssessment.soloLevel === 'easy') {
      monthlyClients = 4;
      avgDealSize = 299;
      difficulty = 'easy';
    } else if (serviceAssessment.acquisitionChannel === 'weak') {
      monthlyClients = 1;
      avgDealSize = 149;
      difficulty = 'hard';
    }

    return {
      realisticMonthlyClients: monthlyClients,
      avgDealSize,
      monthlyRevenue: monthlyClients * avgDealSize,
      difficulty
    };
  }

  /**
   * 生成社群引流钩子
   */
  private generateCommunityHooks(painSignal: BusinessPainSignal): CommunityHook[] {
    const hooks: CommunityHook[] = [];
    const killer = painSignal.profitKillers[0];
    const killerName = killer ? this.getKillerName(killer.type) : '业务痛点';

    // Reddit 钩子
    hooks.push({
      type: 'reddit_reply',
      platform: 'Reddit r/shopify',
      hook: `你遇到的${killerName}问题，其实是AI最擅长解决的脏活累活。` +
        `我在Upwork上有个免费诊断服务，帮你看看怎么自动化处理这些麻烦事。` +
        `需要链接吗？`,
      callToAction: '回复"诊断"获取免费服务链接',
      expectedEngagement: 'high'
    });

    // Facebook Group 钩子
    hooks.push({
      type: 'facebook_group',
      platform: 'Facebook E-commerce Groups',
      hook: `刚帮一个卖家诊断完店铺，发现3个${killerName}漏洞，其中一个几乎所有新手都会踩。` +
        `我把排查方法整理成了清单，扣1发你。`,
      callToAction: '评论"1"获取排查清单',
      expectedEngagement: 'high'
    });

    // LinkedIn 钩子
    hooks.push({
      type: 'linkedin_post',
      platform: 'LinkedIn',
      hook: `${killerName}是电商卖家最容易忽视的成本黑洞。` +
        `分享一个我们帮客户每月节省数千美元的方法...`,
      callToAction: '评论区说说你的经历，我们帮你诊断',
      expectedEngagement: 'medium'
    });

    return hooks;
  }

  /**
   * 生成知识付费钩子（仅对人上人层级）
   */
  private generateKnowledgeProductHooks(painSignal: BusinessPainSignal): KnowledgeProductHook[] {
    const killer = painSignal.profitKillers[0];
    const killerName = killer ? this.getKillerName(killer.type) : '业务问题';

    return [
      // 清单类产品
      {
        productType: 'checklist',
        title: `${killerName}自检清单：10分钟找出你的店铺漏洞`,
        socialCopy: `刚帮一个卖家诊断完，发现${killerName}问题居然藏了这么多坑！` +
          `我把排查方法整理成了清单，扣1发你。`,
        hook: `你遇到过${killerName}问题吗？我整理了一份自检清单，10分钟就能排查完。`,
        callToAction: '评论区扣"1"，我私信发你'
      },
      // 模板类产品
      {
        productType: 'template_pack',
        title: `${killerName}处理SOP模板包`,
        socialCopy: `做了5年电商，发现${killerName}问题其实有标准解法。` +
          `我把解决方案做成了模板，直接套用就能解决问题。`,
        hook: `分享一套我一直在用的${killerName}处理模板，新手也能快速上手。`,
        callToAction: '想要模板包？评论区扣"模板"'
      },
      // 审计工具
      {
        productType: 'audit_tool',
        title: `免费${killerName}诊断工具`,
        socialCopy: `我们开发了一个${killerName}自动诊断工具，输入订单数据就能自动发现问题。` +
          `限时免费使用中，需要的来。`,
        hook: `还在手动排查${killerName}问题？试试这个自动诊断工具，5分钟出结果。`,
        callToAction: '评论区扣"工具"，我发你免费链接'
      }
    ];
  }

  /**
   * 生成GEO关键词建议
   */
  private generateGEOSuggestions(painSignal: BusinessPainSignal): GEOSuggestion[] {
    const killer = painSignal.profitKillers[0];
    const killerName = killer ? this.getKillerName(killer.type) : '业务问题';

    // 基于利润杀手类型生成关键词
    const keywordTemplates: Record<string, GEOSuggestion[]> = {
      [PKT.RETURNS_CHARGEBACKS]: [
        {
          type: 'how_to',
          keyword: 'how to prevent chargebacks on Shopify without losing customers',
          estimatedMonthlyVolume: 3200,
          competition: 'medium',
          useCase: 'SEO文章、YouTube视频'
        },
        {
          type: 'question',
          keyword: 'why do I keep getting chargebacks even with delivery confirmation',
          estimatedMonthlyVolume: 1200,
          competition: 'low',
          useCase: 'Reddit回复、论坛解答'
        },
        {
          type: 'comparison',
          keyword: 'Shopify chargeback protection tools comparison 2026',
          estimatedMonthlyVolume: 880,
          competition: 'low',
          useCase: '对比文章、产品评测'
        },
        {
          type: 'long_tail',
          keyword: 'friendly fraud prevention for small ecommerce business',
          estimatedMonthlyVolume: 590,
          competition: 'low',
          useCase: '长尾SEO、付费广告'
        },
        {
          type: 'how_to',
          keyword: 'reduce ecommerce chargeback rate from 3% to below 1%',
          estimatedMonthlyVolume: 480,
          competition: 'low',
          useCase: '案例研究、成功故事'
        }
      ],
      [PKT.DISCOUNT_ABUSE]: [
        {
          type: 'how_to',
          keyword: 'how to prevent discount code stacking on Shopify',
          estimatedMonthlyVolume: 2800,
          competition: 'medium',
          useCase: '教程文章、视频'
        },
        {
          type: 'question',
          keyword: 'why am I losing money on every sale due to discount stacking',
          estimatedMonthlyVolume: 980,
          competition: 'low',
          useCase: '社区回复、Q&A'
        },
        {
          type: 'comparison',
          keyword: 'best Shopify discount management apps 2026',
          estimatedMonthlyVolume: 1200,
          competition: 'medium',
          useCase: '对比评测、工具推荐'
        },
        {
          type: 'long_tail',
          keyword: 'Shopify discount叠加上限设置教程',
          estimatedMonthlyVolume: 3200,
          competition: 'low',
          useCase: '中文SEO、本地化内容'
        },
        {
          type: 'how_to',
          keyword: 'calculate true discount cost including margin impact',
          estimatedMonthlyVolume: 650,
          competition: 'low',
          useCase: '计算器工具、模板'
        }
      ],
      [PKT.INVENTORY_SHIPPING]: [
        {
          type: 'how_to',
          keyword: 'how to optimize Shopify shipping rates to reduce costs',
          estimatedMonthlyVolume: 2400,
          competition: 'medium',
          useCase: '教程、工具评测'
        },
        {
          type: 'question',
          keyword: 'why is my Shopify shipping cost higher than competitors',
          estimatedMonthlyVolume: 890,
          competition: 'low',
          useCase: '问答、社区'
        },
        {
          type: 'comparison',
          keyword: 'Shopify shipping apps comparison 2026',
          estimatedMonthlyVolume: 1500,
          competition: 'medium',
          useCase: '对比文章'
        },
        {
          type: 'long_tail',
          keyword: 'dead stock liquidation strategy for ecommerce',
          estimatedMonthlyVolume: 720,
          competition: 'low',
          useCase: '长尾SEO'
        },
        {
          type: 'how_to',
          keyword: 'how to calculate dimensional weight for Shopify shipping',
          estimatedMonthlyVolume: 540,
          competition: 'low',
          useCase: '教程、计算器'
        }
      ]
    };

    return killer ? (keywordTemplates[killer.type] || this.getGenericKeywords(killerName)) : this.getGenericKeywords(killerName);
  }

  private getGenericKeywords(problem: string): GEOSuggestion[] {
    return [
      {
        type: 'how_to',
        keyword: `how to solve ${problem.toLowerCase()} in ecommerce`,
        estimatedMonthlyVolume: 1000,
        competition: 'medium',
        useCase: '通用教程'
      },
      {
        type: 'question',
        keyword: `${problem} solutions for Shopify stores`,
        estimatedMonthlyVolume: 600,
        competition: 'low',
        useCase: '社区回复'
      },
      {
        type: 'long_tail',
        keyword: `Shopify ${problem.toLowerCase()} fix guide`,
        estimatedMonthlyVolume: 400,
        competition: 'low',
        useCase: 'SEO文章'
      }
    ];
  }

  private getKillerName(type: ProfitKillerType): string {
    const names: Record<ProfitKillerType, string> = {
      [PKT.RETURNS_CHARGEBACKS]: '退货与拒付',
      [PKT.DISCOUNT_ABUSE]: '折扣滥用',
      [PKT.INVENTORY_SHIPPING]: '库存与运费'
    };
    return names[type] || '业务';
  }

  /**
   * 生成诊断
   */
  private generateDiagnosis(painSignal: BusinessPainSignal): Diagnosis {
    const killer = painSignal.profitKillers[0];
    const category = killer?.type || 'unknown';

    return {
      id: `diag-${Date.now()}`,
      title: this.generateDiagnosisTitle(category, painSignal),
      category,
      severity: painSignal.painLevel,
      rootCause: this.identifyRootCause(painSignal),
      evidence: [
        {
          quote: painSignal.description.substring(0, 200),
          source: painSignal.platform,
          url: painSignal.url
        }
      ],
      estimatedImpact: {
        monthlyLoss: painSignal.estimatedMonthlyLoss || 0,
        percentageOfRevenue: this.calculateLossPercentage(painSignal),
        affectedOrders: this.estimateAffectedOrders(painSignal)
      },
      aiInsight: this.generateAIInsight(painSignal)
    };
  }

  private generateDiagnosisTitle(category: ProfitKillerType | 'unknown', painSignal: BusinessPainSignal): string {
    const titles: Record<string, string> = {
      [PKT.RETURNS_CHARGEBACKS]: `退货与拒付问题：${painSignal.title.substring(0, 30)}...`,
      [PKT.DISCOUNT_ABUSE]: `折扣滥用问题：${painSignal.title.substring(0, 30)}...`,
      [PKT.INVENTORY_SHIPPING]: `库存与运费问题：${painSignal.title.substring(0, 30)}...`,
      'unknown': `待诊断问题：${painSignal.title.substring(0, 30)}...`
    };
    return titles[category] || titles['unknown'];
  }

  private identifyRootCause(painSignal: BusinessPainSignal): string {
    const killer = painSignal.profitKillers[0];
    if (!killer) return '需要进一步诊断';

    const rootCauses: Record<ProfitKillerType, string> = {
      [PKT.RETURNS_CHARGEBACKS]:
        '缺乏订单风险评估机制，无法在交易前识别可疑订单；同时缺少拒付争议处理的标准化流程',
      [PKT.DISCOUNT_ABUSE]:
        '折扣规则缺乏优先级和上限控制，多个促销机制可同时叠加，导致实际折扣远超预期',
      [PKT.INVENTORY_SHIPPING]:
        '运费设置未与实际承运商费率同步更新；库存管理缺乏数据驱动决策'
    };

    return rootCauses[killer.type] || '系统性问题，需要综合诊断';
  }

  private calculateLossPercentage(painSignal: BusinessPainSignal): number {
    const killer = painSignal.profitKillers[0];
    if (!killer) return 0;

    // 根据严重度调整百分比
    const basePercentages: Record<ProfitKillerType, number> = {
      [PKT.RETURNS_CHARGEBACKS]: 1.5,
      [PKT.DISCOUNT_ABUSE]: 2.0,
      [PKT.INVENTORY_SHIPPING]: 1.2
    };

    const base = basePercentages[killer.type] || 1;

    // 严重度加成
    const multiplier = {
      critical: 2.0,
      high: 1.5,
      medium: 1.0,
      low: 0.5
    }[killer.severity];

    return Math.round(base * multiplier * 10) / 10;
  }

  private estimateAffectedOrders(painSignal: BusinessPainSignal): number {
    // 基于帖子中的信息估算
    const text = `${painSignal.title} ${painSignal.description}`;

    // 尝试提取具体数字
    const numberMatch = text.match(/(\d+)/);
    if (numberMatch) {
      const num = parseInt(numberMatch[1]);
      if (num > 1000) return num;
      if (num > 100) return num * 10;
    }

    // 基于严重度的默认值
    const defaults = {
      critical: 500,
      high: 200,
      medium: 100,
      low: 50
    };

    return defaults[painSignal.painLevel] || 100;
  }

  private generateAIInsight(painSignal: BusinessPainSignal): string {
    const killer = painSignal.profitKillers[0];
    if (!killer) return '未检测到明确的利润杀手';

    const insights: Record<ProfitKillerType, string> = {
      [PKT.RETURNS_CHARGEBACKS]:
        `每1美元拒付损失，实际成本约为3.50美元（含人工处理、货品损失、平台罚款）。` +
        `检测到${painSignal.profitKillers.length}类相关问题，${killer.severity === 'critical' ? '急需立即处理' : '建议本周内优化'}`,

      [PKT.DISCOUNT_ABUSE]:
        `当商品毛利为40%时，8折促销会导致单位利润直接腰斩50%。` +
        `折扣滥用往往是卖家最容易忽视、但利润流失最严重的黑洞。` +
        `${painSignal.profitKillers.some(k => k.type === PKT.DISCOUNT_ABUSE) ? '检测到明确的折扣叠加问题' : '建议检查折扣规则配置'}`,

      [PKT.INVENTORY_SHIPPING]:
        `库存积压占用资金，运费计算错误侵蚀利润。` +
        `通常一个SKU的运费配置错误，每月可能造成数百美元的隐性损失。` +
        `建议进行全面的物流成本审计。`
    };

    return insights[killer.type] || '需要综合诊断';
  }

  /**
   * 生成治疗方案
   */
  private generateFixPlan(painSignal: BusinessPainSignal, diagnosis: Diagnosis): FixPlan {
    const killer = painSignal.profitKillers[0];
    const category = killer?.type;

    // 选择服务包
    const packages = category
      ? SERVICE_PACKAGES[category] || GENERIC_PACKAGES
      : GENERIC_PACKAGES;

    // 生成实施步骤
    const steps = this.generateImplementationSteps(category || PKT.RETURNS_CHARGEBACKS, painSignal);

    // 计算ROI
    const roi = this.calculateROI(packages[0], painSignal);

    return {
      id: `fix-${Date.now()}`,
      diagnosisId: diagnosis.id,
      services: packages,
      steps,
      roi
    };
  }

  private generateImplementationSteps(
    category: ProfitKillerType,
    painSignal: BusinessPainSignal
  ): FixPlan['steps'] {
    const baseSteps: Record<ProfitKillerType, FixPlan['steps']> = {
      [PKT.RETURNS_CHARGEBACKS]: [
        {
          order: 1,
          title: '数据采集与分析',
          description: '导出近90天订单数据，分析拒付和退货模式',
          tools: ['Shopify后台', 'Excel/Google Sheets'],
          duration: '2-4小时'
        },
        {
          order: 2,
          title: '风险识别与规则配置',
          description: '识别高风险特征，配置订单风险评分系统',
          tools: ['反欺诈工具', '风险评分API'],
          duration: '4-8小时'
        },
        {
          order: 3,
          title: '流程建立与测试',
          description: '建立拒付处理SOP，测试风控规则有效性',
          tools: ['流程文档', '测试订单'],
          duration: '2-4小时'
        },
        {
          order: 4,
          title: '上线监控与优化',
          description: '部署监控仪表板，持续优化风控规则',
          tools: ['数据分析工具'],
          duration: '持续'
        }
      ],

      [PKT.DISCOUNT_ABUSE]: [
        {
          order: 1,
          title: '折扣规则审计',
          description: '列出所有活跃的折扣码、优惠券、促销规则',
          tools: ['Shopify后台', '折扣管理应用'],
          duration: '1-2小时'
        },
        {
          order: 2,
          title: '叠加上限配置',
          description: '设置折扣优先级和叠加上限，防止过度叠加',
          tools: ['折扣管理应用'],
          duration: '2-4小时'
        },
        {
          order: 3,
          title: '毛利保护设置',
          description: '配置最低毛利保护，确保每个订单有合理利润',
          tools: ['定价规则引擎'],
          duration: '2-3小时'
        },
        {
          order: 4,
          title: '促销效果追踪',
          description: '建立促销ROI追踪机制，评估每次促销的真实效果',
          tools: ['分析仪表板'],
          duration: '持续'
        }
      ],

      [PKT.INVENTORY_SHIPPING]: [
        {
          order: 1,
          title: '运费设置审计',
          description: '导出当前所有运费配置，与承运商实际费率对比',
          tools: ['承运商官网', '运费计算工具'],
          duration: '3-5小时'
        },
        {
          order: 2,
          title: '库存健康度评估',
          description: '分析库存周转率，识别滞销商品',
          tools: ['Shopify库存报告', 'ABC分析'],
          duration: '2-4小时'
        },
        {
          order: 3,
          title: '配置优化',
          description: '更新运费规则，优化库存结构',
          tools: ['Shopify运费设置', '库存管理工具'],
          duration: '4-6小时'
        },
        {
          order: 4,
          title: '持续监控',
          description: '建立物流成本和库存指标监控',
          tools: ['数据分析工具'],
          duration: '持续'
        }
      ]
    };

    return baseSteps[category] || baseSteps[PKT.RETURNS_CHARGEBACKS];
  }

  private calculateROI(
    primaryService: ServicePackage,
    painSignal: BusinessPainSignal
  ): FixPlan['roi'] {
    const estimatedSavings = painSignal.estimatedMonthlyLoss || 500;
    const serviceCost = (primaryService.priceRange.min + primaryService.priceRange.max) / 2;

    // 计算回本周期（月）
    const paybackMonths = serviceCost / estimatedSavings;

    let paybackPeriod: string;
    let confidenceLevel: 'high' | 'medium' | 'low';

    if (paybackMonths <= 1) {
      paybackPeriod = '1个月内回本';
      confidenceLevel = 'high';
    } else if (paybackMonths <= 3) {
      paybackPeriod = `${Math.ceil(paybackMonths)}个月内回本`;
      confidenceLevel = 'high';
    } else if (paybackMonths <= 6) {
      paybackPeriod = `${Math.ceil(paybackMonths)}个月内回本`;
      confidenceLevel = 'medium';
    } else {
      paybackPeriod = `约${Math.ceil(paybackMonths)}个月回本（需持续优化）`;
      confidenceLevel = 'low';
    }

    return {
      expectedSavings: Math.round(estimatedSavings * 12), // 年化节省
      paybackPeriod,
      confidenceLevel
    };
  }

  /**
   * 生成附加价值（GeoSEO Playbook）
   */
  private generateGeoSEOPlaybook(
    painSignal: BusinessPainSignal,
    diagnosis: Diagnosis
  ): GeoSEOPlaybook {
    return {
      diagnosisId: diagnosis.id,

      aiCompliance: {
        hasShopifyAI: true, // 假设用户可能不知道
        gaps: this.identifyAIGaps(painSignal),
        remediationSteps: this.getAIRemediationSteps(painSignal)
      },

      geoStrategy: {
        targetKeywords: this.generateTargetKeywords(painSignal),
        contentAngles: this.generateContentAngles(painSignal),
        competitorGaps: this.identifyCompetitorGaps(painSignal)
      },

      seoRecommendations: {
        onPage: this.generateOnPageSEO(painSignal),
        technical: this.generateTechnicalSEO(painSignal),
        content: this.generateContentSEO(painSignal)
      },

      aiSearchOptimization: {
        structuredData: ['Product Schema', 'FAQ Schema', 'HowTo Schema'],
        entityOptimization: this.generateEntityOptimization(painSignal),
        schemaMarkup: this.generateSchemaMarkup(diagnosis)
      }
    };
  }

  private identifyAIGaps(painSignal: BusinessPainSignal): string[] {
    const gaps: string[] = [];

    // Shopify AI合规扫描可能发现的问题
    gaps.push('产品描述缺乏SEO优化');
    gaps.push('图片缺少Alt文本');
    gaps.push('网站速度需要优化');

    // 根据利润杀手类型添加特定gap
    const killer = painSignal.profitKillers[0];
    if (killer?.type === PKT.RETURNS_CHARGEBACKS) {
      gaps.push('缺乏清晰退货政策页面');
      gaps.push('结账流程缺少信任元素');
    } else if (killer?.type === PKT.DISCOUNT_ABUSE) {
      gaps.push('促销页面信息不透明');
      gaps.push('缺少价格保障条款');
    }

    return gaps;
  }

  private getAIRemediationSteps(painSignal: BusinessPainSignal): string[] {
    return [
      '运行Shopify免费AI合规扫描工具',
      '根据AI建议逐一修复问题',
      '使用结构化数据提升搜索引擎理解',
      '优化Core Web Vitals指标'
    ];
  }

  private generateTargetKeywords(painSignal: BusinessPainSignal): string[] {
    const killer = painSignal.profitKillers[0];

    const keywordMap: Record<string, string[]> = {
      [PKT.RETURNS_CHARGEBACKS]: [
        'how to prevent chargebacks shopify',
        'return fraud prevention ecommerce',
        'friendly fraud protection',
        'chargeback dispute win rate',
        'order risk scoring'
      ],
      [PKT.DISCOUNT_ABUSE]: [
        'shopify discount stacking prevention',
        'coupon abuse prevention',
        'promotion margin protection',
        'discount叠加上限设置',
        'ecommerce discount rules'
      ],
      [PKT.INVENTORY_SHIPPING]: [
        'shipping cost optimization shopify',
        'inventory turnover improvement',
        'dead stock solution',
        'freight cost reduction',
        'logistics optimization ecommerce'
      ]
    };

    return keywordMap[killer?.type || ''] || [
      'ecommerce profit optimization',
      'shopify store improvement',
      'ecommerce business audit'
    ];
  }

  private generateContentAngles(painSignal: BusinessPainSignal): string[] {
    return [
      `痛点故事: "${painSignal.title}" 背后的商业损失`,
      '解决方案: 如何避免同类问题',
      '工具推荐: 3个必备的反损失工具',
      '案例分析: 成功解决问题的卖家经验'
    ];
  }

  private identifyCompetitorGaps(painSignal: BusinessPainSignal): string[] {
    // 分析竞争对手尚未解决的领域
    const gaps: string[] = [];

    const killer = painSignal.profitKillers[0];
    if (killer?.type === PKT.RETURNS_CHARGEBACKS) {
      gaps.push('大多数反欺诈工具只做检测，不做预防');
      gaps.push('缺乏针对小型卖家的一站式解决方案');
    } else if (killer?.type === PKT.DISCOUNT_ABUSE) {
      gaps.push('Shopify原生不支持折扣叠加上限');
      gaps.push('缺乏折扣效果实时追踪工具');
    }

    gaps.push('SEO内容覆盖不足，存在长尾机会');
    return gaps;
  }

  private generateOnPageSEO(painSignal: BusinessPainSignal): string[] {
    return [
      '优化产品页标题标签',
      '添加Meta描述（150-160字符）',
      '使用H1包含主关键词',
      '内部链接到相关内容页',
      '添加图片Alt文本'
    ];
  }

  private generateTechnicalSEO(painSignal: BusinessPainSignal): string[] {
    return [
      '提升页面加载速度至3秒内',
      '修复死链和404错误',
      '提交XML站点地图',
      '配置结构化数据',
      '移动端友好性优化'
    ];
  }

  private generateContentSEO(painSignal: BusinessPainSignal): string[] {
    return [
      '创建"如何避免XX问题"的指南文章',
      '发布案例研究：成功解决问题',
      '制作对比图表：问题vs解决方案',
      '定期更新FAQ页面'
    ];
  }

  private generateEntityOptimization(painSignal: BusinessPainSignal): string[] {
    return [
      'Shopify作为电商务平台实体',
      'Ecommerce Fraud作为概念实体',
      '相关品牌和工具作为子实体'
    ];
  }

  private generateSchemaMarkup(diagnosis: Diagnosis): string[] {
    return [
      'FAQ Schema（常见问题解答）',
      'HowTo Schema（操作指南）',
      'Review Schema（客户评价）',
      'Product Schema（产品信息）'
    ];
  }

  /**
   * 综合评分
   */
  private calculateScoring(
    painSignal: BusinessPainSignal,
    diagnosis: Diagnosis,
    fixPlan: FixPlan
  ): ActionableOpportunity['scoring'] {
    // 紧迫度：基于痛感级别和urgent标记
    const urgencyMap = { critical: 10, high: 7, medium: 5, low: 3 };
    const urgency = urgencyMap[painSignal.painLevel] +
      (painSignal.metadata?.isUrgent ? 2 : 0);

    // 市场规模：基于估算损失
    const estimatedLoss = painSignal.estimatedMonthlyLoss || 0;
    const marketSize = Math.min(10, Math.max(1, Math.floor(estimatedLoss / 100) + 3));

    // 竞争程度：基于信号数量和现有解决方案
    const competitionLevel = 5; // 默认中等

    // 技术可行性：基于服务包的复杂度
    const techComplexity = Math.min(10, Math.floor(
      fixPlan.services.reduce((sum, s) => sum + s.estimatedHours, 0) / 5
    ));
    const technicalFeasibility = Math.max(1, 10 - techComplexity);

    // 综合评分
    const overallScore = Math.round(
      (urgency * 0.3 + marketSize * 0.25 + technicalFeasibility * 0.25 + (10 - competitionLevel) * 0.2) * 10
    ) / 10;

    return {
      urgency: Math.min(10, urgency),
      marketSize: Math.min(10, marketSize),
      competitionLevel: Math.min(10, competitionLevel),
      technicalFeasibility: Math.min(10, technicalFeasibility),
      overallScore: Math.min(10, overallScore)
    };
  }

  /**
   * 生成标签
   */
  private generateTags(painSignal: BusinessPainSignal): string[] {
    const tags: string[] = ['business-radar'];

    // 添加利润杀手标签
    for (const killer of painSignal.profitKillers) {
      const killerTag = {
        [PKT.RETURNS_CHARGEBACKS]: 'returns-chargebacks',
        [PKT.DISCOUNT_ABUSE]: 'discount-abuse',
        [PKT.INVENTORY_SHIPPING]: 'inventory-shipping'
      }[killer.type];

      if (killerTag) tags.push(killerTag);
    }

    // 添加严重度标签
    tags.push(`severity-${painSignal.painLevel}`);

    // 添加平台标签
    tags.push(`source-${painSignal.platform.toLowerCase()}`);

    return tags;
  }
}

// ============================================================
// 批量生成器
// ============================================================

export function generateActionPlans(painSignals: BusinessPainSignal[]): ActionableOpportunity[] {
  const generator = new ActionPlanGenerator();
  return painSignals
    .filter(p => p.profitKillers.length > 0 || p.painLevel !== 'low')
    .map(p => generator.generateActionPlan(p));
}

// ============================================================
// 输出格式化器
// ============================================================

export function formatActionPlanAsMarkdown(opp: ActionableOpportunity): string {
  const lines: string[] = [];

  lines.push('# 🎯 行动方案报告');
  lines.push('');
  lines.push(`**创建时间**: ${opp.createdAt.toLocaleString('zh-CN')}`);
  lines.push(`**状态**: ${opp.status.toUpperCase()}`);
  lines.push(`**综合评分**: ${opp.scoring.overallScore}/10`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 诊断部分
  lines.push('## 🩺 诊断 (Diagnosis)');
  lines.push('');
  lines.push(`**标题**: ${opp.diagnosis.title}`);
  lines.push(`**严重度**: ${opp.diagnosis.severity.toUpperCase()}`);
  lines.push(`**根因**: ${opp.diagnosis.rootCause}`);
  lines.push('');
  lines.push('**影响估算**:');
  lines.push(`- 月损失: $${opp.diagnosis.estimatedImpact.monthlyLoss}`);
  lines.push(`- 占营收比: ${opp.diagnosis.estimatedImpact.percentageOfRevenue}%`);
  lines.push(`- 受影响订单: ~${opp.diagnosis.estimatedImpact.affectedOrders}`);
  lines.push('');
  lines.push(`**AI洞察**: ${opp.diagnosis.aiInsight}`);
  lines.push('');

  // 证据
  lines.push('**证据来源**:');
  for (const ev of opp.diagnosis.evidence) {
    lines.push(`- "${ev.quote.substring(0, 100)}..." [来源: ${ev.source}]`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // 治疗方案部分
  lines.push('## 💊 治疗方案 (Fix Plan)');
  lines.push('');

  for (const service of opp.fixPlan.services) {
    lines.push(`### ${service.name}`);
    lines.push('');
    lines.push(`**描述**: ${service.description}`);
    lines.push('');
    lines.push('**交付物**:');
    for (const d of service.deliverables) {
      lines.push(`- ${d}`);
    }
    lines.push('');
    lines.push(`**预估工时**: ${service.estimatedHours}小时`);
    lines.push(`**价格区间**: $${service.priceRange.min} - $${service.priceRange.max} ${service.priceRange.currency}`);
    lines.push('');
  }

  lines.push('**实施步骤**:');
  for (const step of opp.fixPlan.steps) {
    lines.push(`${step.order}. **${step.title}**`);
    lines.push(`   - ${step.description}`);
    if (step.tools) lines.push(`   - 工具: ${step.tools.join(', ')}`);
    if (step.duration) lines.push(`   - 时长: ${step.duration}`);
  }
  lines.push('');

  lines.push('**ROI承诺**:');
  lines.push(`- 预期年化节省: $${opp.fixPlan.roi.expectedSavings}`);
  lines.push(`- 回本周期: ${opp.fixPlan.roi.paybackPeriod}`);
  lines.push(`- 置信度: ${opp.fixPlan.roi.confidenceLevel.toUpperCase()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 附加价值部分
  lines.push('## 📈 附加价值 (GeoSEO Playbook)');
  lines.push('');
  lines.push('### AI合规扫描应对');
  lines.push(`Shopify官方已推出免费的AI合规扫描工具，但该工具只能诊断，无法修复。`);
  lines.push('');
  lines.push('**发现差距**:');
  for (const gap of opp.geoSEOPlaybook.aiCompliance.gaps) {
    lines.push(`- ${gap}`);
  }
  lines.push('');
  lines.push('**修复步骤**:');
  for (const step of opp.geoSEOPlaybook.aiCompliance.remediationSteps) {
    lines.push(`- ${step}`);
  }
  lines.push('');

  lines.push('### SEO优化建议');
  lines.push('');
  lines.push('**目标关键词**:');
  lines.push(`\`\`\`\n${opp.geoSEOPlaybook.geoStrategy.targetKeywords.join('\n')}\n\`\`\``);
  lines.push('');

  lines.push('**内容角度**:');
  for (const angle of opp.geoSEOPlaybook.geoStrategy.contentAngles) {
    lines.push(`- ${angle}`);
  }
  lines.push('');

  lines.push('### AI搜索优化');
  lines.push('面对AI搜索时代，优化你的店铺以在AI搜索中存活。');
  lines.push('');
  lines.push('**推荐结构化数据**:');
  for (const schema of opp.geoSEOPlaybook.aiSearchOptimization.structuredData) {
    lines.push(`- ${schema}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // v2.0 新增：运营动作部分
  if (opp.growthActions) {
    lines.push('## 🚀 运营动作 (Growth Actions)');
    lines.push('');
    lines.push(`**优先级行动**: ${opp.growthActions.priorityAction}`);
    lines.push('');

    // 社群引流钩子
    if (opp.growthActions.communityHooks && opp.growthActions.communityHooks.length > 0) {
      lines.push('### 💬 社群引流钩子');
      lines.push('');
      for (const hook of opp.growthActions.communityHooks) {
        lines.push(`**${hook.platform}** (${hook.type})`);
        lines.push(`> ${hook.hook}`);
        lines.push(`**CTA**: ${hook.callToAction}`);
        lines.push(`预期互动: ${hook.expectedEngagement.toUpperCase()}`);
        lines.push('');
      }
    }

    // 知识付费钩子（仅人上人层级）
    if (opp.growthActions.knowledgeProductHooks && opp.growthActions.knowledgeProductHooks.length > 0) {
      lines.push('### 📚 知识付费钩子');
      lines.push('');
      for (const hook of opp.growthActions.knowledgeProductHooks) {
        lines.push(`**${hook.title}** (${hook.productType})`);
        lines.push(`> ${hook.hook}`);
        lines.push(`**朋友圈文案**: ${hook.socialCopy}`);
        lines.push(`**CTA**: ${hook.callToAction}`);
        lines.push('');
      }
    }

    // GEO关键词建议
    if (opp.growthActions.geoSuggestions && opp.growthActions.geoSuggestions.length > 0) {
      lines.push('### 🔍 GEO关键词建议');
      lines.push('');
      lines.push('| 关键词 | 类型 | 月搜索量 | 竞争 | 用途 |');
      lines.push('|--------|------|---------|------|------|');
      for (const geo of opp.growthActions.geoSuggestions) {
        lines.push(`| ${geo.keyword} | ${geo.type} | ${geo.estimatedMonthlyVolume} | ${geo.competition} | ${geo.useCase} |`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // v3.0 新增：搞客户行动部分
  if (opp.clientAcquisitionAction) {
    const ca = opp.clientAcquisitionAction;
    lines.push('## 💰 搞客户行动 (Client Acquisition)');
    lines.push('');

    // 搜索量估算
    if (ca.searchVolumeEstimate) {
      lines.push('### 📊 搜索量估算');
      lines.push('');
      lines.push(`| 关键词 | 月搜索量 | 竞争度 |`);
      lines.push(`|--------|---------|--------|`);
      lines.push(`| ${ca.searchVolumeEstimate.keyword} | ${ca.searchVolumeEstimate.monthlyVolume.toLocaleString()} | ${ca.searchVolumeEstimate.competition.toUpperCase()} |`);
      lines.push('');
    }

    // 推荐获客渠道
    lines.push('### 🎯 推荐获客渠道');
    lines.push('');
    for (const ch of ca.recommendedChannels) {
      const priorityIcon = ch.priority === 'primary' ? '🔴' : ch.priority === 'secondary' ? '🟡' : '⚪';
      lines.push(`${priorityIcon} **[${ch.channel.toUpperCase()}]** (${ch.priority})`);
      lines.push(`   - ${ch.action}`);
      if (ch.expectedCPL) {
        lines.push(`   - 预计 CPL: $${ch.expectedCPL}`);
      }
      lines.push('');
    }

    // 服务包装话术
    lines.push('### 📣 服务包装话术');
    lines.push('');
    lines.push(`**标题**: ${ca.servicePitch.headline}`);
    lines.push('');
    lines.push('**电梯演讲**:');
    lines.push(`> ${ca.servicePitch.elevatorPitch}`);
    lines.push('');
    lines.push('**价值主张**:');
    lines.push('```');
    lines.push(ca.servicePitch.valueProposition);
    lines.push('```');
    lines.push('');
    if (ca.servicePitch.socialProof) {
      lines.push(`**社会证明**: ${ca.servicePitch.socialProof}`);
      lines.push('');
    }

    // 建议定价方案
    lines.push('### 💵 建议定价方案');
    lines.push('');
    lines.push(`| 套餐 | 价格 | 目标客户 |`);
    lines.push(`|------|------|----------|`);
    for (const tier of ca.pricing.tiers) {
      const recommended = tier.name.toLowerCase() === ca.pricing.recommendedTier ? ' ⭐推荐' : '';
      lines.push(`| ${tier.name}${recommended} | $${tier.price} | ${tier.targetClient} |`);
    }
    lines.push('');

    // 快速启动建议
    lines.push('### 🚀 快速启动建议');
    lines.push('');
    lines.push('**Day 1**:');
    lines.push('```');
    lines.push(ca.quickStart.day1);
    lines.push('```');
    lines.push('');
    lines.push('**Week 1**:');
    lines.push('```');
    lines.push(ca.quickStart.week1);
    lines.push('```');
    lines.push('');
    lines.push('**Month 1**:');
    lines.push('```');
    lines.push(ca.quickStart.month1);
    lines.push('```');
    lines.push('');

    // 预期收益估算
    if (ca.revenueEstimate) {
      lines.push('### 📈 预期收益估算');
      lines.push('');
      lines.push(`- 预计月客户数: ${ca.revenueEstimate.realisticMonthlyClients} 个`);
      lines.push(`- 平均客单价: $${ca.revenueEstimate.avgDealSize}`);
      lines.push(`- 预计月收入: $${ca.revenueEstimate.monthlyRevenue}`);
      lines.push(`- 难度评级: ${ca.revenueEstimate.difficulty.toUpperCase()}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // 标签
  lines.push('**标签**:');
  lines.push(`\`\`\`\n${opp.tags.join(', ')}\n\`\`\``);
  lines.push('');

  // 来源
  lines.push('---');
  lines.push(`*来源: [${opp.source.title}](${opp.source.url})*`);
  lines.push(`*平台: ${opp.source.platform} | 发布于: ${opp.source.postedAt.toLocaleString('zh-CN')}*`);

  return lines.join('\n');
}
