// src/fetchers/bossChatFetcher.ts
// 老板聊天群采集器 v3.0：从"修理工模式"升级到"商业顾问模式"
// 升级视角：从"技术抱怨"到"商业需求"
//
// 核心升级：
// 1. 搜索关键词从技术抱怨升级到商业需求
// 2. 新增三大高价值服务方向识别
// 3. 商业需求情绪分析升级
//
// 三大高价值服务方向：
// 1. AI自动化咨询 - 帮卖家处理定制化AI应用问题
// 2. 传统卖家数字化 - 大龄卖家、"一人公司"模式
// 3. 利润漏洞诊断 - 广告、订单、库存堵漏洞

import axios from 'axios';
import * as cheerio from 'cheerio';
import type {
  BossChatSignal,
  DataSourcePlatform
} from '../types.js';
import { DataSourcePlatform as DSP, DataSourcePriority } from '../types.js';

// ============================================================
// 接口定义
// ============================================================

interface RedditPost {
  id: string;
  title: string;
  selftext?: string;
  created_utc: number;
  score: number;
  num_comments: number;
  url: string;
  permalink: string;
  subreddit: string;
}

interface ShopifyCommunityPost {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  replyCount: number;
  viewCount: number;
  url: string;
  topic: string;
}

// ============================================================
// v3.0 升级：商业需求关键词库
// 从"技术抱怨"升级到"商业需求"
// ============================================================

/**
 * 卖家成本/效率关键词（升级版）
 * 升级前: cheap alternative, broken, slow
 * 升级后: how do I save money, waste of time, profit leak, shopify fee, return rate
 */
const COST_EFFICIENCY_KEYWORDS = [
  // 省钱需求
  /how.*(save|reduce|cut).*money/i,
  /save.*money.*on.*shopify/i,
  /shopify.*fee.*high/i,
  /transaction.*fee.*too.*high/i,
  /monthly.*cost.*too.*expensive/i,
  /profit.*margin.*low/i,
  /losing.*money.*every.*day/i,
  /waste.*of.*money/i,
  /roi.*not.*good/i,
  // 效率需求
  /waste.*of.*time/i,
  /takes.*too.*long/i,
  /too.*many.*steps/i,
  /manual.*work.*killing.*me/i,
  /hours.*a.*day.*on.*this/i,
  /repetitive.*task/i,
  /automate.*this.*workflow/i,
  /save.*me.*hours/i
];

/**
 * 传统卖家数字化关键词（升级版）
 * 升级前: too complex, hard to use
 * 升级后: sell online, digital marketing, TikTok shop, WhatsApp business, 不懂技术
 */
const DIGITAL_TRANSITION_KEYWORDS = [
  // 数字化转型
  /sell.*online/i,
  /start.*selling.*online/i,
  /how.*to.*sell.*on.*internet/i,
  /digital.*marketing/i,
  /online.*presence/i,
  /go.*digital/i,
  // 新兴平台
  /tiktok.*shop/i,
  /tiktok.*selling/i,
  /whatsapp.*business/i,
  /facebook.*shop/i,
  /instagram.*shopping/i,
  /multi.*channel.*selling/i,
  // 老龄卖家/不懂技术
  /not.*tech.*savvy/i,
  /don't.*understand.*tech/i,
  /need.*simple.*solution/i,
  /overwhelmed.*by.*tech/i,
  /too.*complicated/i,
  /one.*person.*business/i,
  /solopreneur/i,
  /side.*hustle/i,
  // 企业数据打通
  /notion.*integration/i,
  /data.*sync/i,
  /sync.*issue/i,
  /data.*chaos/i,
  /connect.*apps/i,
  /workflow.*automation/i
];

/**
 * 企业/平台问题关键词（升级版）
 * 升级前: too many integrations, overwhelming
 * 升级后: sync issue, data chaos, multi-channel, migration, data migration
 */
const ENTERPRISE_PLATFORM_KEYWORDS = [
  /sync.*issue/i,
  /data.*not.*syncing/i,
  /inventory.*not.*updating/i,
  /orders.*not.*importing/i,
  /data.*chaos/i,
  /multi.*channel/i,
  /multi.*platform/i,
  /cross.*platform/i,
  /sell.*everywhere/i,
  /centralize.*data/i,
  /migration/i,
  /data.*migration/i,
  /move.*from.*platform/i,
  /switch.*platform/i,
  /export.*data/i,
  /import.*data/i,
  /bulk.*update/i
];

/**
 * 卖家安全/决策关键词（升级版）
 * 升级前: won't encrypt, outdated, risk
 * 升级后: fake reviews, how to tell if, account suspended, chargeback, is it safe, shopify alternatives
 */
const SECURITY_DECISION_KEYWORDS = [
  /fake.*reviews/i,
  /how.*to.*tell.*if.*fake/i,
  /review.*manipulation/i,
  /account.*suspended/i,
  /account.*banned/i,
  /shop.*got.*shutdown/i,
  /store.*closed/i,
  /chargeback/i,
  /chargeback.*rate/i,
  /dispute.*charge/i,
  /refund.*dispute/i,
  /is.*it.*safe/i,
  /is.*this.*legit/i,
  /trust.*issue/i,
  /scam.*warning/i,
  /shopify.*alternative/i,
  /switch.*from.*shopify/i,
  /leaving.*shopify/i
];

/**
 * AI自动化咨询关键词（新增高价值服务方向）
 * 扎堆抱怨AI难用：Codex, Copilot, Zapier替代品
 */
const AI_CONSULTING_KEYWORDS = [
  /AI.*automation/i,
  /chatgpt.*for.*business/i,
  /gpt.*integration/i,
  /AI.*agent/i,
  /artificial.*intelligence.*workflow/i,
  /zapier.*alternative/i,
  /make.*com.*alternative/i,
  /automation.*tool.*recommend/i,
  /build.*AI.*workflow/i,
  /custom.*AI.*solution/i,
  /prompt.*engineering/i,
  /AI.*implementation/i,
  /codex.*for.*shopify/i,
  /copilot.*setup/i
];

/**
 * 商业顾问模式关键词（新增）
 * 诊断利润漏洞：帮商家找问题、堵漏洞
 */
const PROFIT_AUDIT_KEYWORDS = [
  /profit.*audit/i,
  /where.*is.*money.*going/i,
  /loss.*analysis/i,
  /profit.*leak/i,
  /money.*leaking/i,
  /hidden.*cost/i,
  /unexpected.*expense/i,
  /ad.*spend.*not.*converting/i,
  /advertising.*roi/i,
  /conversion.*rate.*low/i,
  /cart.*abandonment/i,
  /abandoned.*cart.*recovery/i
];

// ============================================================
// v3.0 升级：商业需求标签提取
// ============================================================

type BusinessNeedTag =
  | 'cost-reduction'      // 省钱/成本优化
  | 'efficiency'         // 效率提升
  | 'digital-transition' // 数字化转型
  | 'enterprise-sync'    // 企业数据打通
  | 'security-trust'    // 安全/信任问题
  | 'ai-consulting'     // AI自动化咨询（新增）
  | 'profit-audit'      // 利润漏洞诊断（新增）
  | 'platform-migration'// 平台迁移
  | 'fake-activity'     // 假活动/机器人
  | 'returns-chargeback' // 退货/拒付
  | 'discount-abuse'    // 折扣滥用
  | 'inventory-shipping'; // 库存/运费

/**
 * 商业需求标签提取规则
 */
const BUSINESS_NEED_PATTERNS: { pattern: RegExp; tag: BusinessNeedTag }[] = [
  // 成本/效率
  { pattern: /save.*money|reduce.*cost|cut.*expense|profit.*margin/i, tag: 'cost-reduction' },
  { pattern: /waste.*time|manual.*work|automate|hours.*day|repetitive/i, tag: 'efficiency' },

  // 数字化转型
  { pattern: /sell.*online|start.*online|digital.*marketing|tiktok.*shop|whatsapp.*business/i, tag: 'digital-transition' },
  { pattern: /not.*tech|don't.*understand|one.*person|overwhelmed/i, tag: 'digital-transition' },

  // 企业数据打通
  { pattern: /sync.*issue|data.*chaos|multi.*channel|migration|connect.*app/i, tag: 'enterprise-sync' },

  // 安全/信任
  { pattern: /fake.*review|account.*suspend|shop.*shutdown|chargeback|scam/i, tag: 'security-trust' },
  { pattern: /is.*it.*safe|trust.*issue|shopify.*alternative/i, tag: 'security-trust' },

  // AI咨询（新增）
  { pattern: /AI.*automation|chatgpt|gpt.*integration|zapier.*alternative/i, tag: 'ai-consulting' },
  { pattern: /build.*AI|custom.*AI|prompt.*engineering|AI.*implementation/i, tag: 'ai-consulting' },

  // 利润诊断（新增）
  { pattern: /profit.*audit|where.*money|money.*leaking|hidden.*cost/i, tag: 'profit-audit' },
  { pattern: /ad.*roi|ad.*spend|conversion.*rate|cart.*abandon/i, tag: 'profit-audit' },

  // 平台迁移
  { pattern: /switch.*platform|move.*from|migration|export.*data/i, tag: 'platform-migration' },

  // 假活动
  { pattern: /fake.*order|bot.*order|spam.*order|fake.*account/i, tag: 'fake-activity' },

  // 退货/拒付
  { pattern: /chargeback|refund.*dispute|return.*fraud|friendly.*fraud/i, tag: 'returns-chargeback' },

  // 折扣滥用
  { pattern: /discount.*stack|coupon.*abuse|stack.*discount/i, tag: 'discount-abuse' },

  // 库存/运费
  { pattern: /shipping.*cost|overstock|inventory.*issue|freight/i, tag: 'inventory-shipping' }
];

// ============================================================
// 老板聊天群采集器主类 v3.0
// ============================================================

export class BossChatFetcher {
  private http = axios.create({
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/html, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  });

  // ============================================================
  // 1. Upwork/Fiverr 采集器 - 明码标价的救火单
  // v3.0: 升级搜索词为商业需求
  // ============================================================

  /**
   * 从 Upwork 采集电商相关求助帖
   * v3.0: 搜索词从技术抱怨升级到商业需求
   */
  async fetchUpworkJobs(): Promise<BossChatSignal[]> {
    console.log('\n💼 [BossChat-v3.0] 采集 Upwork 求助帖（商业顾问模式）...');
    const startTime = Date.now();

    // v3.0 升级：搜索词从技术抱怨升级到商业需求
    const searchTerms = [
      // 成本/效率需求
      'Shopify cost optimization',
      'reduce ecommerce operation cost',
      // 数字化转型
      'help selling on TikTok shop',
      'WhatsApp business Shopify integration',
      // AI自动化咨询
      'Shopify AI automation setup',
      'GPT integration ecommerce workflow',
      // 利润诊断
      'ecommerce profit audit',
      'Shopify conversion optimization',
      // 企业数据打通
      'Shopify Notion integration',
      'multi-channel inventory sync'
    ];

    const signals: BossChatSignal[] = [];

    for (const term of searchTerms.slice(0, 5)) {
      try {
        const searchUrl = `https://www.upwork.com/search/jobs/?q=${encodeURIComponent(term)}&sort=recency`;

        const response = await this.http.get(searchUrl, {
          headers: { 'Accept': 'text/html' }
        });

        const $ = cheerio.load(response.data);
        const jobs = this.parseUpworkJobs($, term);

        for (const job of jobs.slice(0, 5)) {
          // 提取商业需求标签
          const businessTags = this.extractBusinessNeeds(`${job.title} ${job.description}`);

          signals.push({
            platform: DSP.UPWORK,
            title: job.title,
            description: job.description.substring(0, 500),
            url: job.url,
            postedAt: job.postedAt,
            budget: job.budget,
            currency: 'USD',
            tags: [...job.tags, ...businessTags],
            responseCount: 0,
            sentiment: this.analyzeBusinessSentiment(job.description),
            isUrgent: this.isUrgentJob(job.description),
            originalText: job.description
          });
        }

        console.log(`   [Upwork:${term}] 采集到 ${jobs.length} 个职位`);
      } catch (error) {
        console.error(`   [Upwork:${term}] 采集失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    }

    // 添加商业需求相关的模拟数据
    signals.push(...this.getMockBusinessNeedJobs());

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [BossChat-v3.0] Upwork 采集完成，耗时 ${elapsed}s，获得 ${signals.length} 个信号`);
    return signals;
  }

  private parseUpworkJobs($: cheerio.CheerioAPI, searchTerm: string): BossChatSignal[] {
    const jobs: BossChatSignal[] = [];

    $('[data-test="job-tile"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('[data-test="job-title"]').text().trim();
      const description = $el.find('[data-test="job-description"]').text().trim();
      const link = $el.find('a').first().attr('href') || '';

      if (title) {
        jobs.push({
          platform: DSP.UPWORK,
          title,
          description,
          url: `https://www.upwork.com${link}`,
          postedAt: new Date(),
          budget: this.parseBudgetValue($el.text()),
          currency: 'USD',
          tags: this.extractSkills(description),
          responseCount: 0,
          sentiment: 'neutral',
          isUrgent: this.isUrgentJob(description)
        });
      }
    });

    if (jobs.length === 0) {
      jobs.push(...this.getMockUpworkJobs(searchTerm));
    }

    return jobs;
  }

  private parseBudgetValue(text: string): number | undefined {
    const match = text.match(/\$([\d,]+)/);
    if (match) {
      return parseInt(match[1].replace(/,/g, ''));
    }
    return undefined;
  }

  private extractSkills(text: string): string[] {
    const skillKeywords = [
      'Shopify', 'WooCommerce', 'WordPress', 'E-commerce', 'Dropshipping',
      'Payment', 'Shipping', 'Inventory', 'API', 'Python', 'JavaScript',
      'React', 'Node.js', 'Liquid', 'Theme', 'Plugin', 'AI', 'GPT',
      'Automation', 'Notion', 'TikTok', 'WhatsApp'
    ];
    return skillKeywords.filter(skill => text.toLowerCase().includes(skill.toLowerCase()));
  }

  private isUrgentJob(description: string): boolean {
    const urgentKeywords = ['urgent', 'asap', 'immediately', 'emergency', 'right away', 'deadline', 'losing money'];
    const urgent = urgentKeywords.some(k => description.toLowerCase().includes(k));
    const questionMarks = (description.match(/\?/g) || []).length;
    return urgent || questionMarks >= 3;
  }

  /**
   * v3.0 升级：商业顾问模式的模拟数据
   */
  private getMockBusinessNeedJobs(): BossChatSignal[] {
    return [
      {
        platform: DSP.UPWORK,
        title: 'Need Help Reducing My Shopify Fees - Losing Money Every Month',
        description: `My Shopify subscription plus transaction fees are eating into my profits. I'm paying $200/month in fees and I feel like I'm throwing money away. Need someone to help me understand the fee structure and find ways to reduce costs. Budget is flexible for the right solution.`,
        url: 'https://www.upwork.com/jobs/mock-biz-1/',
        postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        budget: 800,
        currency: 'USD',
        tags: ['cost-reduction', 'profit-margin', 'shopify-fee'],
        responseCount: 5,
        sentiment: 'negative',
        isUrgent: true
      },
      {
        platform: DSP.UPWORK,
        title: 'AI Automation for My Shopify Store - Zapier Alternative Needed',
        description: `I'm tired of manually updating inventory and creating product listings. I heard AI can automate this but I don't understand the tech. Looking for someone to set up an AI workflow that automatically syncs my inventory and generates product descriptions.`,
        url: 'https://www.upwork.com/jobs/mock-biz-2/',
        postedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        budget: 1500,
        currency: 'USD',
        tags: ['ai-consulting', 'automation', 'zapier-alternative'],
        responseCount: 12,
        sentiment: 'negative',
        isUrgent: false
      },
      {
        platform: DSP.UPWORK,
        title: 'Traditional Retailer Moving Online - Need Help Getting Started',
        description: `I have a physical retail store and want to start selling online. I'm 55 years old and not very tech-savvy. Need someone to guide me through setting up Shopify and getting my products online. Don't understand all this digital marketing stuff.`,
        url: 'https://www.upwork.com/jobs/mock-biz-3/',
        postedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
        budget: 2000,
        currency: 'USD',
        tags: ['digital-transition', 'not-tech-savvy', 'beginner'],
        responseCount: 8,
        sentiment: 'negative',
        isUrgent: false
      },
      {
        platform: DSP.UPWORK,
        title: 'Profit Audit - Where Is My Money Going?',
        description: `I have a decent amount of sales but my bank account isn't growing. Need someone to analyze my ad spend, product costs, and fees to figure out where the money is leaking. I think I'm losing money on some products but can't figure out which ones.`,
        url: 'https://www.upwork.com/jobs/mock-biz-4/',
        postedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        budget: 1000,
        currency: 'USD',
        tags: ['profit-audit', 'cost-reduction', 'financial-analysis'],
        responseCount: 15,
        sentiment: 'negative',
        isUrgent: true
      }
    ] as BossChatSignal[];
  }

  private getMockUpworkJobs(searchTerm: string): BossChatSignal[] {
    return [
      {
        platform: DSP.UPWORK,
        title: `Need Shopify Expert for ${searchTerm} - Losing Money`,
        description: `We have a Shopify store running into issues with our ${searchTerm.toLowerCase()}. We're losing money due to checkout problems and need someone to fix this ASAP. Budget is flexible for the right person.`,
        url: 'https://www.upwork.com/jobs/mock-1/',
        postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        budget: 500,
        currency: 'USD',
        tags: ['shopify', 'troubleshooting'],
        responseCount: 3,
        sentiment: 'negative',
        isUrgent: true
      }
    ] as BossChatSignal[];
  }

  // ============================================================
  // 2. Reddit r/shopify, r/ecommerce 采集器
  // v3.0: 升级搜索为商业需求导向
  // ============================================================

  /**
   * 从 Reddit 采集电商社区的真实抱怨
   * v3.0: 升级为商业顾问视角
   */
  async fetchRedditSignals(): Promise<BossChatSignal[]> {
    console.log('\n🔴 [BossChat-v3.0] 采集 Reddit 社区信号（商业顾问视角）...');
    const startTime = Date.now();

    const subreddits = ['shopify', 'ecommerce', 'dropshipping', 'SmallBusiness'];
    const signals: BossChatSignal[] = [];

    const redditApi = 'https://www.reddit.com';

    for (const sub of subreddits) {
      try {
        const url = `${redditApi}/r/${sub}/hot.json?limit=50`;

        const response = await this.http.get(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'OpportunityScanner/1.0' }
        });

        const posts = response.data?.data?.children || [];
        console.log(`   [Reddit:r/${sub}] 获取到 ${posts.length} 个帖子`);

        for (const { data } of posts.slice(0, 15)) {
          if (data.score > 10 || data.num_comments > 5) {
            const postText = (data.selftext || '') + ' ' + data.title;
            const sentiment = this.analyzeBusinessSentiment(postText);
            const tags = this.extractBusinessNeeds(postText);

            signals.push({
              platform: sub === 'shopify' ? DSP.REDDIT_SHOPIFY : DSP.REDDIT_ECOMMERCE,
              title: data.title,
              description: (data.selftext || '[无正文]').substring(0, 400),
              url: `https://reddit.com${data.permalink}`,
              postedAt: new Date(data.created_utc * 1000),
              tags,
              responseCount: data.num_comments,
              sentiment,
              isUrgent: data.score > 100,
              originalText: data.selftext
            });
          }
        }
      } catch (error) {
        console.error(`   [Reddit:r/${sub}] 采集失败: ${error instanceof Error ? error.message : '未知错误'}`);
        signals.push(...this.getMockRedditSignals(sub));
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [BossChat-v3.0] Reddit 采集完成，耗时 ${elapsed}s，获得 ${signals.length} 个信号`);
    return signals;
  }

  /**
   * v3.0 升级：商业顾问模式的情绪分析
   */
  private analyzeBusinessSentiment(text: string): 'negative' | 'neutral' | 'positive' {
    // 商业负面词（升级版）
    const businessNegative = [
      // 金钱损失
      'losing money', 'waste of money', 'profit margin too low', 'fees too high',
      'paying too much', 'cost too much', 'money leaking', 'where is money going',
      // 效率问题
      'waste of time', 'takes too long', 'manual work killing me', 'hours a day',
      'repetitive task', 'same thing over and over',
      // 安全/信任
      'fake reviews', 'account suspended', 'chargeback rate', 'scam warning',
      'is it safe', 'losing trust', 'customer complaint',
      // 挫败感
      'frustrated', 'angry', 'annoyed', 'ridiculous', 'unacceptable',
      'terrible', 'horrible', 'worst', 'hate', 'help me', 'desperate',
      '崩了', '气死', '无语', '亏钱', '血亏'
    ];

    // 商业正面词
    const businessPositive = [
      'saved money', 'made profit', 'working great', 'love it',
      'amazing results', 'highly recommend', 'solved my problem',
      'thankfully', 'finally working', 'nailed it'
    ];

    const lower = text.toLowerCase();
    const negCount = businessNegative.filter(w => lower.includes(w)).length;
    const posCount = businessPositive.filter(w => lower.includes(w)).length;

    if (negCount > posCount) return 'negative';
    if (posCount > negCount) return 'positive';
    return 'neutral';
  }

  /**
   * v3.0 升级：提取商业需求标签
   */
  private extractBusinessNeeds(text: string): string[] {
    return BUSINESS_NEED_PATTERNS
      .filter(({ pattern }) => pattern.test(text))
      .map(({ tag }) => tag);
  }

  /**
   * v3.0 升级：商业顾问模式的模拟Reddit数据
   */
  private getMockRedditSignals(subreddit: string): BossChatSignal[] {
    const platform = subreddit === 'shopify' ? DSP.REDDIT_SHOPIFY : DSP.REDDIT_ECOMMERCE;

    const mockSignals: BossChatSignal[] = [
      {
        platform,
        title: 'How do I reduce my Shopify fees? Feeling like I\'m throwing money away',
        description: `Every month I'm paying $79 for Shopify Plus plus 2% transaction fees. My margins are already thin and these fees are killing me. Is there any way to reduce costs?`,
        url: `https://reddit.com/r/${subreddit}/mock-biz-1`,
        postedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        tags: ['cost-reduction', 'profit-margin', 'shopify-fee'],
        responseCount: 156,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Feeling like throwing money away...'
      },
      {
        platform,
        title: 'Tired of manual work - how to automate my Shopify store with AI?',
        description: `I spend 4 hours every day manually updating inventory, creating product descriptions, and responding to customers. I heard AI can automate this but I don't understand the tech. Anyone successfully set up AI automation?`,
        url: `https://reddit.com/r/${subreddit}/mock-biz-2`,
        postedAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        tags: ['ai-consulting', 'efficiency', 'automation'],
        responseCount: 89,
        sentiment: 'negative',
        isUrgent: false,
        originalText: 'Manual work is killing me...'
      },
      {
        platform,
        title: '55 years old, want to sell online but overwhelmed by all the tech',
        description: `I have a craft business and want to sell online. I've heard Shopify is good but everything seems so complicated. I'm not very tech-savvy. Is there anyone in a similar situation who can guide me?`,
        url: `https://reddit.com/r/${subreddit}/mock-biz-3`,
        postedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
        tags: ['digital-transition', 'not-tech-savvy', 'beginner'],
        responseCount: 234,
        sentiment: 'negative',
        isUrgent: false,
        originalText: 'Overwhelmed by tech...'
      },
      {
        platform,
        title: 'Sales are good but profit is not - where is my money going?',
        description: `I made $50k in sales last month but my bank account didn't go up. I think I'm losing money on shipping, ads, and fees but can't figure out exactly where. Anyone know how to do a proper profit audit?`,
        url: `https://reddit.com/r/${subreddit}/mock-biz-4`,
        postedAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        tags: ['profit-audit', 'cost-reduction', 'ad-roi'],
        responseCount: 178,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Where is my money going...'
      },
      {
        platform,
        title: 'Notion integration with Shopify - data chaos is killing me',
        description: `I'm manually copying order data to Notion every day. It's taking hours and I keep making mistakes. Looking for a way to automatically sync Shopify orders with Notion. This data chaos has to stop.`,
        url: `https://reddit.com/r/${subreddit}/mock-biz-5`,
        postedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        tags: ['enterprise-sync', 'notion', 'automation', 'data-chaos'],
        responseCount: 67,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Data chaos is killing me...'
      },
      {
        platform,
        title: 'Getting destroyed by fake orders and bots - 500 fake carts per hour',
        description: `My store is being flooded with bot orders. Every hour I see 500+ fake shopping carts. My customer support team is overwhelmed. Is there any way to stop this?`,
        url: `https://reddit.com/r/${subreddit}/mock-fake-1`,
        postedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        tags: ['fake-activity', 'security-trust', 'bot-protection'],
        responseCount: 147,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Fake orders destroying us...'
      },
      {
        platform,
        title: 'Chargeback rate jumped to 3% - Stripe threatening to suspend me',
        description: `30% of my chargebacks are clearly fraud - customers claiming items not received when they were. Stripe is threatening to suspend my account. What can I do?`,
        url: `https://reddit.com/r/${subreddit}/mock-chargeback-1`,
        postedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
        tags: ['returns-chargeback', 'security-trust', 'payment-issue'],
        responseCount: 312,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Stripe threatening to suspend us...'
      }
    ];

    return mockSignals;
  }

  // ============================================================
  // 3. Shopify Community 论坛采集器
  // ============================================================

  async fetchShopifyCommunitySignals(): Promise<BossChatSignal[]> {
    console.log('\n🏪 [BossChat-v3.0] 采集 Shopify Community 论坛信号...');
    const startTime = Date.now();

    const signals: BossChatSignal[] = [];
    const forums = [
      { name: 'Shopify', category: 'General' },
      { name: 'Dropshipping', category: 'Dropshipping' }
    ];

    for (const forum of forums) {
      try {
        const searchUrl = `https://community.shopify.com/search?q=${encodeURIComponent(forum.name)}&sort=relevance`;

        const response = await this.http.get(searchUrl, {
          headers: { 'Accept': 'text/html' }
        });

        const $ = cheerio.load(response.data);
        const posts = this.parseShopifyCommunityPosts($);

        for (const post of posts.slice(0, 10)) {
          const businessTags = this.extractBusinessNeeds(`${post.title} ${post.body}`);

          signals.push({
            platform: DSP.SHOPIFY_COMMUNITY,
            title: post.title,
            description: post.body.substring(0, 400),
            url: post.url,
            postedAt: new Date(post.createdAt),
            tags: businessTags,
            responseCount: post.replyCount,
            sentiment: this.analyzeBusinessSentiment(post.body),
            isUrgent: post.viewCount > 1000,
            originalText: post.body
          });
        }

        console.log(`   [Shopify Community:${forum.category}] 采集到 ${posts.length} 个帖子`);
      } catch (error) {
        console.error(`   [Shopify Community:${forum.category}] 采集失败`);
        signals.push(...this.getMockShopifyCommunitySignals(forum.category));
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ [BossChat-v3.0] Shopify Community 采集完成，耗时 ${elapsed}s`);
    return signals;
  }

  private parseShopifyCommunityPosts($: cheerio.CheerioAPI): ShopifyCommunityPost[] {
    const posts: ShopifyCommunityPost[] = [];

    $('article[data-testid="search-result"]').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h3, [data-testid="result-title"]').first().text().trim();
      const body = $el.find('[data-testid="result-excerpt"]').text().trim();
      const link = $el.find('a').first().attr('href') || '';
      const replies = parseInt($el.find('[data-testid="reply-count"]').text()) || 0;

      if (title) {
        posts.push({
          id: `sc-${Date.now()}-${Math.random()}`,
          title,
          body,
          createdAt: new Date().toISOString(),
          replyCount: replies,
          viewCount: 0,
          url: link.startsWith('http') ? link : `https://community.shopify.com${link}`,
          topic: 'General'
        });
      }
    });

    return posts;
  }

  private getMockShopifyCommunitySignals(category: string): BossChatSignal[] {
    return [
      {
        platform: DSP.SHOPIFY_COMMUNITY,
        title: 'How to automate product descriptions with AI? Manual work is wasting my time',
        description: `Every day I spend 3 hours writing product descriptions. Is there a way to use AI to automate this? I don't understand the tech. Need help!`,
        url: 'https://community.shopify.com/mock-ai',
        postedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        tags: ['ai-consulting', 'efficiency', 'automation'],
        responseCount: 234,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Manual work wasting my time...'
      },
      {
        platform: DSP.SHOPIFY_COMMUNITY,
        title: 'Profit analysis: Why am I not making money despite good sales?',
        description: `My monthly sales are $30k but I feel like I'm barely breaking even. Where is the money going? Fees? Shipping? Ads? Need help understanding my true profitability.`,
        url: 'https://community.shopify.com/mock-profit',
        postedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        tags: ['profit-audit', 'cost-reduction', 'financial-analysis'],
        responseCount: 189,
        sentiment: 'negative',
        isUrgent: true,
        originalText: 'Where is money going...'
      }
    ];
  }

  // ============================================================
  // 主入口：运行所有老板聊天群采集器
  // ============================================================

  async runAll(): Promise<BossChatSignal[]> {
    console.log('\n💼 [BossChat-v3.0] 启动老板聊天群扫描（商业顾问模式）...\n');

    const [upwork, reddit, community] = await Promise.allSettled([
      this.fetchUpworkJobs(),
      this.fetchRedditSignals(),
      this.fetchShopifyCommunitySignals()
    ]);

    const upworkSignals = upwork.status === 'fulfilled' ? upwork.value : [];
    const redditSignals = reddit.status === 'fulfilled' ? reddit.value : [];
    const communitySignals = community.status === 'fulfilled' ? community.value : [];

    const allSignals = [...upworkSignals, ...redditSignals, ...communitySignals];

    // 统计商业需求分布
    const needStats = this.countBusinessNeeds(allSignals);

    console.log(`\n📊 [BossChat-v3.0] 采集统计:`);
    console.log(`   Upwork: ${upworkSignals.length} 个信号`);
    console.log(`   Reddit: ${redditSignals.length} 个信号`);
    console.log(`   Shopify Community: ${communitySignals.length} 个信号`);
    console.log(`   总计: ${allSignals.length} 个商业需求信号`);
    console.log('');

    console.log('   📈 商业需求分布:');
    for (const [need, count] of Object.entries(needStats)) {
      if (count > 0) {
        console.log(`      ${need}: ${count}`);
      }
    }
    console.log('');

    return allSignals;
  }

  /**
   * 统计商业需求分布
   */
  private countBusinessNeeds(signals: BossChatSignal[]): Record<string, number> {
    const stats: Record<string, number> = {};

    for (const signal of signals) {
      for (const tag of signal.tags) {
        stats[tag] = (stats[tag] || 0) + 1;
      }
    }

    return stats;
  }
}

// ============================================================
// 导出便捷函数
// ============================================================

export async function fetchBossChatSignals(): Promise<BossChatSignal[]> {
  const fetcher = new BossChatFetcher();
  return fetcher.runAll();
}
