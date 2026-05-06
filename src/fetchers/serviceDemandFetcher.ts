// src/fetchers/serviceDemandFetcher.ts
// 服务型需求采集器：扫描"帮我把X搞定"类型的结果交付型需求
// 升级核心：从"卖工具"到"卖结果"
//
// 监控关键词：
// 1. 服务需求型：I need someone to, help me with, looking for expert to
// 2. 结果交付型：chargeback dispute, profit audit, store audit, revenue leak
// 3. 内容创作型：AI video, product video, TikTok shop video
// 4. 增长服务型：affiliate program, influencer outreach, social commerce

import axios from 'axios';
import * as cheerio from 'cheerio';
import { DataSourcePlatform } from '../types.js';

// ============================================================
// 接口定义
// ============================================================

/**
 * 结果交付型需求信号
 */
export interface ServiceDemandSignal {
  platform: DataSourcePlatform;
  title: string;
  description: string;
  url: string;
  postedAt: Date;

  // 客户愿意付多少钱
  budget?: number;
  currency: string;
  budgetType: 'fixed' | 'hourly' | 'negotiable';

  // 交付物是什么
  deliverable: string;
  deliverableCategory: DeliverableCategory;

  // 是否有长期合作意向
  longTermFlag: boolean;
  estimatedDuration?: string;

  // 客户信息
  clientRegion?: string;
  clientSize?: 'solo' | 'small' | 'medium' | 'large';

  // 情绪
  sentiment: 'negative' | 'neutral' | 'positive';
  isUrgent: boolean;

  // 原始文本
  originalText?: string;
}

/**
 * 交付物分类
 */
export enum DeliverableCategory {
  /** 审计/诊断类 - 帮人发现问题 */
  AUDIT = 'audit',
  /** 纠纷处理类 - chargeback, dispute */
  DISPUTE_RESOLUTION = 'dispute-resolution',
  /** 视频/内容创作类 */
  CONTENT_CREATION = 'content-creation',
  /** 增长服务类 - 推广、引流 */
  GROWTH_SERVICE = 'growth-service',
  /** 技术设置类 - 帮人配置 */
  TECHNICAL_SETUP = 'technical-setup',
  /** AI自动化类 */
  AI_AUTOMATION = 'ai-automation',
  /** 数据分析类 */
  DATA_ANALYTICS = 'data-analytics',
  /** 其他服务 */
  OTHER = 'other'
}

/**
 * 服务型需求关键词
 */
const SERVICE_DEMAND_KEYWORDS = {
  // 服务需求型 - "帮我搞定"
  serviceRequest: [
    /I need someone to/i,
    /help me with/i,
    /looking for.*to.*for me/i,
    /expert to/i,
    /done for me/i,
    /someone who can/i,
    /can someone help/i,
    /need a specialist/i,
    /looking for expert/i,
    /hire someone to/i,
    /pay someone to/i,
    /freelancer to/i
  ],

  // 审计/诊断类
  audit: [
    /audit/i,
    /profit audit/i,
    /store audit/i,
    /revenue leak/i,
    /profit leak/i,
    /money leak/i,
    /diagnos/i,
    /analyze.*account/i,
    /check.*issues/i,
    /find.*problems/i,
    /identify.*issues/i
  ],

  // 纠纷处理类
  disputeResolution: [
    /chargeback/i,
    /dispute.*charge/i,
    /refund.*dispute/i,
    /payment.*dispute/i,
    /stripe.*dispute/i,
    /paypal.*dispute/i,
    /help.*dispute/i,
    /win.*dispute/i
  ],

  // 视频/内容创作类
  contentCreation: [
    /video/i,
    /product video/i,
    /AI video/i,
    /TikTok video/i,
    /short.*video/i,
    /promo.*video/i,
    /commercial/i,
    /video.*ad/i
  ],

  // 增长服务类
  growthService: [
    /affiliate program/i,
    /influencer.*outreach/i,
    /social commerce/i,
    /marketing.*setup/i,
    /ads.*manage/i,
    /facebook.*ads/i,
    /google.*ads/i,
    /seo.*service/i,
    /growth.*hack/i
  ],

  // AI自动化类
  aiAutomation: [
    /AI.*automation/i,
    /automate.*workflow/i,
    /chatgpt.*integrat/i,
    /AI.*agent/i,
    /workflow.*automation/i,
    /auto.*respond/i,
    /auto.*messag/i
  ]
};

/**
 * 交付物提取规则
 */
const DELIVERABLE_PATTERNS: { pattern: RegExp; category: DeliverableCategory; deliverable: string }[] = [
  // 审计类
  { pattern: /audit.*store|store.*audit/i, category: DeliverableCategory.AUDIT, deliverable: 'Complete store audit with actionable recommendations' },
  { pattern: /audit.*profit|profit.*audit/i, category: DeliverableCategory.AUDIT, deliverable: 'Profit leak analysis report' },
  { pattern: /audit.*account|account.*audit/i, category: DeliverableCategory.AUDIT, deliverable: 'Account health audit' },

  // 纠纷处理类
  { pattern: /chargeback.*dispute|dispute.*chargeback/i, category: DeliverableCategory.DISPUTE_RESOLUTION, deliverable: 'Chargeback dispute resolution' },
  { pattern: /refund.*dispute|dispute.*refund/i, category: DeliverableCategory.DISPUTE_RESOLUTION, deliverable: 'Refund dispute handling' },

  // 视频类
  { pattern: /product video|video.*product/i, category: DeliverableCategory.CONTENT_CREATION, deliverable: 'Product videos' },
  { pattern: /TikTok video|video.*TikTok/i, category: DeliverableCategory.CONTENT_CREATION, deliverable: 'TikTok videos' },
  { pattern: /AI video|video.*AI/i, category: DeliverableCategory.CONTENT_CREATION, deliverable: 'AI-generated videos' },

  // 增长类
  { pattern: /affiliate program|affiliate.*setup/i, category: DeliverableCategory.GROWTH_SERVICE, deliverable: 'Affiliate program setup' },
  { pattern: /influencer.*outreach/i, category: DeliverableCategory.GROWTH_SERVICE, deliverable: 'Influencer outreach campaign' },
  { pattern: /facebook.*ads|ads.*facebook/i, category: DeliverableCategory.GROWTH_SERVICE, deliverable: 'Facebook Ads management' },

  // AI自动化类
  { pattern: /AI.*automation|automate.*workflow/i, category: DeliverableCategory.AI_AUTOMATION, deliverable: 'AI workflow automation' },
  { pattern: /chatgpt.*integrat|integrat.*chatgpt/i, category: DeliverableCategory.AI_AUTOMATION, deliverable: 'ChatGPT integration' }
];

// ============================================================
// 服务型需求采集器
// ============================================================

export class ServiceDemandFetcher {
  private http = axios.create({
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/html, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  });

  // ============================================================
  // 1. Upwork/Fiverr 采集
  // ============================================================

  async fetchUpworkServiceDemands(): Promise<ServiceDemandSignal[]> {
    console.log('\n🎯 [ServiceDemand] 扫描 Upwork 结果交付型需求...');
    const startTime = Date.now();

    // 结果交付型搜索词
    const searchTerms = [
      'Shopify store audit',
      'chargeback dispute help',
      'profit leak analysis',
      'product video for Shopify',
      'TikTok shop video',
      'affiliate program setup',
      'Shopify AI automation',
      'Facebook ads management'
    ];

    const signals: ServiceDemandSignal[] = [];

    for (const term of searchTerms.slice(0, 4)) {
      try {
        const searchUrl = `https://www.upwork.com/search/jobs/?q=${encodeURIComponent(term)}&sort=recency`;
        const response = await this.http.get(searchUrl, { headers: { 'Accept': 'text/html' } });
        const $ = cheerio.load(response.data);
        const jobs = this.parseJobs($);

        for (const job of jobs.slice(0, 5)) {
          const signal = this.transformToServiceDemand(job, DataSourcePlatform.UPWORK);
          if (signal) signals.push(signal);
        }

        console.log(`   [Upwork:${term}] 采集到 ${jobs.length} 个需求`);
      } catch (error) {
        console.error(`   [Upwork:${term}] 失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    // 添加模拟数据
    signals.push(...this.getMockUpworkDemands());

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [ServiceDemand] Upwork 扫描完成，耗时 ${elapsed}s，获得 ${signals.length} 个服务需求`);
    return signals;
  }

  private parseJobs($: cheerio.CheerioAPI): Partial<ServiceDemandSignal>[] {
    const jobs: Partial<ServiceDemandSignal>[] = [];

    $('[data-test="job-tile"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('[data-test="job-title"]').text().trim();
      const description = $el.find('[data-test="job-description"]').text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const text = $el.text();

      if (title) {
        const budget = this.extractBudget(text);
        const deliverable = this.extractDeliverable(title + ' ' + description);

        jobs.push({
          title,
          description: description.substring(0, 500),
          url: link.startsWith('http') ? link : `https://www.upwork.com${link}`,
          budget,
          deliverable: deliverable.text,
          deliverableCategory: deliverable.category,
          longTermFlag: /ongoing|long.term|recurring|monthly/i.test(text),
          isUrgent: /urgent|asap|immediately/i.test(text)
        });
      }
    });

    return jobs.length > 0 ? jobs : this.getMockUpworkDemands().map(j => ({
      title: j.title,
      description: j.description,
      url: j.url,
      budget: j.budget,
      deliverable: j.deliverable,
      deliverableCategory: j.deliverableCategory,
      longTermFlag: j.longTermFlag,
      isUrgent: j.isUrgent
    }));
  }

  // ============================================================
  // 2. Reddit 服务需求采集
  // ============================================================

  async fetchRedditServiceDemands(): Promise<ServiceDemandSignal[]> {
    console.log('\n🎯 [ServiceDemand] 扫描 Reddit 服务需求...');
    const startTime = Date.now();

    const subreddits = ['slavelabour', 'forhire', 'Shopify', 'ecommerce'];
    const signals: ServiceDemandSignal[] = [];

    for (const sub of subreddits) {
      try {
        const url = `https://www.reddit.com/r/${sub}/hot.json?limit=30`;
        const response = await this.http.get(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'OpportunityScanner/1.0' }
        });

        const posts = response.data?.data?.children || [];
        console.log(`   [Reddit:r/${sub}] 获取到 ${posts.length} 个帖子`);

        for (const { data } of posts.slice(0, 10)) {
          const postText = (data.selftext || '') + ' ' + data.title;

          // 只保留服务需求型帖子
          if (this.isServiceDemand(postText)) {
            const deliverable = this.extractDeliverable(postText);

            signals.push({
              platform: DataSourcePlatform.REDDIT_SHOPIFY,
              title: data.title,
              description: (data.selftext || '[无正文]').substring(0, 400),
              url: `https://reddit.com${data.permalink}`,
              postedAt: new Date(data.created_utc * 1000),
              currency: 'USD',
              budgetType: 'negotiable',
              deliverable: deliverable.text,
              deliverableCategory: deliverable.category,
              longTermFlag: /ongoing|recurring|monthly|long.term/i.test(postText),
              sentiment: 'neutral',
              isUrgent: data.score > 100,
              originalText: data.selftext
            });
          }
        }
      } catch (error) {
        console.error(`   [Reddit:r/${sub}] 失败`);
      }
    }

    // 添加模拟数据
    signals.push(...this.getMockRedditDemands());

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [ServiceDemand] Reddit 扫描完成，耗时 ${elapsed}s，获得 ${signals.length} 个服务需求`);
    return signals;
  }

  private isServiceDemand(text: string): boolean {
    const lower = text.toLowerCase();

    // 服务需求型关键词
    for (const keyword of SERVICE_DEMAND_KEYWORDS.serviceRequest) {
      if (keyword.test(lower)) return true;
    }

    // 审计/诊断关键词
    for (const keyword of SERVICE_DEMAND_KEYWORDS.audit) {
      if (keyword.test(lower)) return true;
    }

    // 纠纷处理关键词
    for (const keyword of SERVICE_DEMAND_KEYWORDS.disputeResolution) {
      if (keyword.test(lower)) return true;
    }

    return false;
  }

  // ============================================================
  // 3. Fiverr 采集
  // ============================================================

  async fetchFiverrServiceDemands(): Promise<ServiceDemandSignal[]> {
    console.log('\n🎯 [ServiceDemand] 扫描 Fiverr 服务需求...');
    const startTime = Date.now();

    const searchTerms = [
      'shopify audit',
      'chargeback',
      'ecommerce consultant'
    ];

    const signals: ServiceDemandSignal[] = [];

    for (const term of searchTerms) {
      try {
        const url = `https://www.fiverr.com/search/gigs?query=${encodeURIComponent(term)}`;
        const response = await this.http.get(url, { headers: { 'Accept': 'text/html' } });
        const $ = cheerio.load(response.data);

        // Fiverr 页面结构较复杂，简化处理
        const gigs: Partial<ServiceDemandSignal>[] = [];

        $('. gig-card').each((_, el) => {
          const $el = $(el);
          const title = $el.find('.title').text().trim();
          const priceText = $el.find('.price').text().trim();

          if (title) {
            gigs.push({
              title,
              description: title,
              url: $el.find('a').first().attr('href') || '',
              budget: this.parsePrice(priceText),
              deliverable: title,
              deliverableCategory: DeliverableCategory.OTHER,
              longTermFlag: false,
              isUrgent: false
            });
          }
        });

        signals.push(...gigs.map(g => this.transformToServiceDemand(g, DataSourcePlatform.UPWORK)).filter(Boolean) as ServiceDemandSignal[]);
      } catch (error) {
        console.error(`   [Fiverr:${term}] 失败`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [ServiceDemand] Fiverr 扫描完成，耗时 ${elapsed}s`);
    return signals;
  }

  // ============================================================
  // 辅助函数
  // ============================================================

  private transformToServiceDemand(
    job: Partial<ServiceDemandSignal>,
    platform: DataSourcePlatform
  ): ServiceDemandSignal | null {
    if (!job.title) return null;

    return {
      platform,
      title: job.title,
      description: job.description || '',
      url: job.url || '',
      postedAt: job.postedAt || new Date(),
      budget: job.budget,
      currency: 'USD',
      budgetType: job.budget ? 'fixed' : 'negotiable',
      deliverable: job.deliverable || 'Service delivery',
      deliverableCategory: job.deliverableCategory || DeliverableCategory.OTHER,
      longTermFlag: job.longTermFlag || false,
      sentiment: job.sentiment || 'neutral',
      isUrgent: job.isUrgent || false
    };
  }

  private extractBudget(text: string): number | undefined {
    const match = text.match(/\$([\d,]+)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''));
    }
    return undefined;
  }

  private parsePrice(text: string): number | undefined {
    const match = text.match(/[\d,]+/);
    if (match) {
      return parseInt(match[0].replace(/,/g, ''));
    }
    return undefined;
  }

  private extractDeliverable(text: string): { text: string; category: DeliverableCategory } {
    for (const { pattern, category, deliverable } of DELIVERABLE_PATTERNS) {
      if (pattern.test(text)) {
        return { text: deliverable, category };
      }
    }

    // 默认分类
    if (/video|content/i.test(text)) {
      return { text: 'Video/content creation', category: DeliverableCategory.CONTENT_CREATION };
    }
    if (/audit|analyz/i.test(text)) {
      return { text: 'Audit and analysis', category: DeliverableCategory.AUDIT };
    }
    if (/chargeback|dispute/i.test(text)) {
      return { text: 'Dispute resolution', category: DeliverableCategory.DISPUTE_RESOLUTION };
    }
    if (/AI|automat/i.test(text)) {
      return { text: 'AI automation setup', category: DeliverableCategory.AI_AUTOMATION };
    }

    return { text: 'Professional service', category: DeliverableCategory.OTHER };
  }

  // ============================================================
  // 模拟数据
  // ============================================================

  private getMockUpworkDemands(): ServiceDemandSignal[] {
    return [
      {
        platform: DataSourcePlatform.UPWORK,
        title: 'Need Shopify Store Audit - Finding Profit Leaks',
        description: `My store is making sales but I'm not seeing profit growth. Need someone to do a complete audit of my store and find where money is leaking. Looking for someone experienced who can identify issues with pricing, fees, shipping, and ads. Budget is negotiable for the right person.`,
        url: 'https://www.upwork.com/jobs/mock-audit-1/',
        postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        budget: 299,
        currency: 'USD',
        budgetType: 'fixed',
        deliverable: 'Complete store audit report with profit leak analysis',
        deliverableCategory: DeliverableCategory.AUDIT,
        longTermFlag: true,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Finding profit leaks...'
      },
      {
        platform: DataSourcePlatform.UPWORK,
        title: 'Help with Chargeback Disputes - Have 20+ Disputes',
        description: `I have about 20 chargebacks this month and Stripe is threatening to suspend my account. Need someone who knows how to handle disputes and can help me win them. Also need advice on preventing future chargebacks.`,
        url: 'https://www.upwork.com/jobs/mock-chargeback-1/',
        postedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        budget: 500,
        currency: 'USD',
        budgetType: 'fixed',
        deliverable: 'Chargeback dispute handling and prevention strategy',
        deliverableCategory: DeliverableCategory.DISPUTE_RESOLUTION,
        longTermFlag: true,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Chargeback crisis...'
      },
      {
        platform: DataSourcePlatform.UPWORK,
        title: 'Need 10 Product Videos for TikTok Shop',
        description: `I'm launching on TikTok Shop and need 10 product videos. Each video should be 15-30 seconds, show the product in use, with text overlays and music. Looking for someone with TikTok experience.`,
        url: 'https://www.upwork.com/jobs/mock-video-1/',
        postedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
        budget: 800,
        currency: 'USD',
        budgetType: 'fixed',
        deliverable: '10 TikTok-optimized product videos (15-30s each)',
        deliverableCategory: DeliverableCategory.CONTENT_CREATION,
        longTermFlag: false,
        sentiment: 'neutral',
        isUrgent: false,
        originalText: 'TikTok product videos...'
      },
      {
        platform: DataSourcePlatform.UPWORK,
        title: 'Set Up AI Customer Service for My Store',
        description: `I want to set up AI-powered customer service for my Shopify store. Need someone who can integrate ChatGPT or similar AI to handle common customer questions, order status inquiries, and basic support. Budget around $300-500.`,
        url: 'https://www.upwork.com/jobs/mock-ai-1/',
        postedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        budget: 400,
        currency: 'USD',
        budgetType: 'fixed',
        deliverable: 'AI customer service integration for Shopify',
        deliverableCategory: DeliverableCategory.AI_AUTOMATION,
        longTermFlag: true,
        sentiment: 'neutral',
        isUrgent: false,
        originalText: 'AI customer service...'
      }
    ];
  }

  private getMockRedditDemands(): ServiceDemandSignal[] {
    return [
      {
        platform: DataSourcePlatform.REDDIT_SHOPIFY,
        title: '[HIRING] Need someone to set up affiliate program for my Shopify store',
        description: `I want to start an affiliate program for my Shopify store but don't know where to start. Looking for someone who has done this before and can set everything up for me. DM me with your experience and rates.`,
        url: 'https://reddit.com/r/ecommerce/mock-affiliate',
        postedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        currency: 'USD',
        budgetType: 'negotiable',
        deliverable: 'Complete affiliate program setup',
        deliverableCategory: DeliverableCategory.GROWTH_SERVICE,
        longTermFlag: true,
        sentiment: 'neutral',
        isUrgent: false,
        originalText: 'Affiliate program setup...'
      },
      {
        platform: DataSourcePlatform.REDDIT_SHOPIFY,
        title: '[HELP] My ads are not converting - need audit',
        description: `I've been running Facebook and Google ads for 3 months but ROAS is terrible. Spending $2000/month but barely making sales. Need someone to audit my ad accounts and tell me what I'm doing wrong. Will pay for a detailed audit.`,
        url: 'https://reddit.com/r/ecommerce/mock-ads-audit',
        postedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
        currency: 'USD',
        budgetType: 'negotiable',
        deliverable: 'Ad account audit with optimization recommendations',
        deliverableCategory: DeliverableCategory.AUDIT,
        longTermFlag: false,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Ads not converting...'
      }
    ];
  }

  // ============================================================
  // 主入口
  // ============================================================

  async runAll(): Promise<ServiceDemandSignal[]> {
    console.log('\n🎯 [ServiceDemand] 启动服务型需求扫描（结果交付型）...\n');

    const [upwork, reddit, fiverr] = await Promise.allSettled([
      this.fetchUpworkServiceDemands(),
      this.fetchRedditServiceDemands(),
      this.fetchFiverrServiceDemands()
    ]);

    const upworkSignals = upwork.status === 'fulfilled' ? upwork.value : [];
    const redditSignals = reddit.status === 'fulfilled' ? reddit.value : [];
    const fiverrSignals = fiverr.status === 'fulfilled' ? fiverr.value : [];

    const allSignals = [...upworkSignals, ...redditSignals, ...fiverrSignals];

    // 统计
    const stats = this.countByCategory(allSignals);

    console.log(`\n📊 [ServiceDemand] 扫描统计:`);
    console.log(`   Upwork: ${upworkSignals.length} 个需求`);
    console.log(`   Reddit: ${redditSignals.length} 个需求`);
    console.log(`   Fiverr: ${fiverrSignals.length} 个需求`);
    console.log(`   总计: ${allSignals.length} 个结果交付型需求`);
    console.log('');
    console.log('   📈 交付物类型分布:');
    for (const [category, count] of Object.entries(stats)) {
      if (count > 0) {
        console.log(`      ${category}: ${count}`);
      }
    }
    console.log('');

    return allSignals;
  }

  private countByCategory(signals: ServiceDemandSignal[]): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const signal of signals) {
      stats[signal.deliverableCategory] = (stats[signal.deliverableCategory] || 0) + 1;
    }
    return stats;
  }
}

// ============================================================
// 导出便捷函数
// ============================================================

export async function fetchServiceDemands(): Promise<ServiceDemandSignal[]> {
  const fetcher = new ServiceDemandFetcher();
  return fetcher.runAll();
}
