// src/analyzers/twitterDataAnalyzer.ts
// Twitter 数据分析器：对原始推文进行清洗、过滤、分类、排序
// 从采集到的 TwitterSignal 中筛选出高质量内容用于发布

import type { TwitterSignal, TwitterAnalysisResult } from '../types.js';

// ============================================================
// 分析配置
// ============================================================

export interface TwitterAnalyzerConfig {
  /** 最低参与度阈值 */
  minEngagementScore?: number;
  /** 最低点赞数 */
  minLikes?: number;
  /** 最低转发数 */
  minRetweets?: number;
  /** 是否过滤 bot 账号 */
  filterBots?: boolean;
  /** 情感过滤 */
  sentimentFilter?: ('positive' | 'neutral' | 'negative')[];
  /** 病毒性过滤 */
  viralityFilter?: ('low' | 'medium' | 'high' | 'viral')[];
  /** 最大输出数量 */
  maxResults?: number;
  /** 语言 */
  language?: 'en' | 'pt' | 'mixed';
}

const DEFAULT_CONFIG: Required<TwitterAnalyzerConfig> = {
  minEngagementScore: 10,
  minLikes: 5,
  minRetweets: 2,
  filterBots: true,
  sentimentFilter: ['positive', 'neutral', 'negative'],
  viralityFilter: ['low', 'medium', 'high', 'viral'],
  maxResults: 20,
  language: 'en'
};

// ============================================================
// Bot 检测规则
// ============================================================

const BOT_PATTERNS = [
  /^(?=.*\b(free|follow|retweet|dm|check out)\b).*$/i,
  // 典型 bot 文案: "Free followers! Follow me!"
  /^.{0,20}(click|link|buy now|offer|sale|discount|limited time)/i,
  // 短链接或可疑短句开头
  /https?:\/\/(bit\.ly|tinyurl|t\.co|goo\.gl)/i,
  // URL 短链
  /\b(earn|money|work from home|make \$|passive income)\b/i,
  // 赚钱类诈骗
  /^(?=.*\b(one|1)\b)(?=.*\b(follow|like)\b).*$/i,
  // "Follow 1, like 1"
  /^(?=.*\b(contest|giveaway|winner|prize)\b).*$/i,
  // 抽奖类
  /\b(crypto|bitcoin|ethereum|nft|whale)\b.*\b(free|giveaway|airdrop)\b/i
  // 加密货币诈骗
];

const BOT_USERNAMES = [
  /^(follow|like|retweet|subscribe)/i,
  /(_bot|_robot|_auto)$/i,
  /^(999|000|111|123)_/i,
  // 数字用户名
  /^.{30,}$/
  // 过长用户名
];

const TRUSTED_ACCOUNTS = new Set([
  'sama', 'karpathy', 'ylecun', 'hwchung27', 'kaboron',
  'techcrunch', 'wired', 'thehackernews', 'verge',
  'emollick', 'jima_vg', 'drjimfan', 'bindu Reddy',
  'AndrewYNg', 'JeffDean', 'demabordes', 'roaborothy'
]);

// ============================================================
// 主分析器
// ============================================================

export class TwitterDataAnalyzer {
  private config: Required<TwitterAnalyzerConfig>;
  private logger: (msg: string) => void;

  constructor(
    config: TwitterAnalyzerConfig = {},
    logger: (msg: string) => void = console.log
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * 主入口: 分析一批 Twitter 信号
   */
  analyze(signals: TwitterSignal[]): TwitterAnalysisResult {
    this.logger(`[TwitterAnalyzer] 输入 ${signals.length} 条原始推文`);

    // Step 1: 清洗
    const cleaned = this.clean(signals);
    this.logger(`[TwitterAnalyzer] 清洗后: ${cleaned.length} 条`);

    // Step 2: 过滤
    const filtered = this.filter(cleaned);
    this.logger(`[TwitterAnalyzer] 过滤后: ${filtered.length} 条`);

    // Step 3: 分类
    const categorized = this.categorize(filtered);
    this.logger(`[TwitterAnalyzer] 分类完成: ${Object.keys(categorized.categories).length} 个分类`);

    // Step 4: 排序
    const ranked = this.rank(categorized);
    this.logger(`[TwitterAnalyzer] 排序完成，最优: ${ranked.topSignals[0]?.content.substring(0, 50)}...`);

    // Step 5: 提取高质量内容
    const summary = this.generateSummary(ranked);

    return {
      ...ranked,
      summary,
      config: this.config
    };
  }

  // ============================================================
  // Step 1: 清洗 - 规范化数据
  // ============================================================

  private clean(signals: TwitterSignal[]): TwitterSignal[] {
    return signals
      .map(s => this.cleanSignal(s))
      .filter((s): s is TwitterSignal => {
        // 过滤掉明显无效的
        return (
          s.content.trim().length > 10 &&
          s.content.trim().length < 5000 &&
          s.author.username.length > 0
        );
      });
  }

  private cleanSignal(signal: TwitterSignal): TwitterSignal {
    // 规范化内容: 去除多余空白、规范化链接
    let content = signal.content
      .replace(/\s+/g, ' ')
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // 去除零宽字符
      .trim();

    // 规范化 URL (不改变功能链接)
    // 保留原始链接用于展示

    // 去重 emoji 序列
    content = content.replace(/(.)\1{4,}/g, '$1$1$1'); // 超过4个连续相同字符截断

    return {
      ...signal,
      content,
      hashtags: signal.hashtags.map(h => h.toLowerCase()),
      engagementScore: this.normalizeEngagementScore(signal)
    };
  }

  private normalizeEngagementScore(signal: TwitterSignal): number {
    // 综合参与度: 点赞 + 转发*3 + 评论*2
    return (
      signal.engagement.likes +
      signal.engagement.retweets * 3 +
      signal.engagement.replies * 2
    );
  }

  // ============================================================
  // Step 2: 过滤 - 移除低质量/bot/无效内容
  // ============================================================

  private filter(signals: TwitterSignal[]): TwitterSignal[] {
    let result = signals;

    // 过滤参与度
    result = result.filter(
      s =>
        s.engagementScore >= this.config.minEngagementScore ||
        s.engagement.likes >= this.config.minLikes ||
        s.engagement.retweets >= this.config.minRetweets
    );

    // 过滤情感
    result = result.filter(s =>
      this.config.sentimentFilter.includes(s.sentiment)
    );

    // 过滤病毒性
    result = result.filter(s =>
      this.config.viralityFilter.includes(s.viralityLevel)
    );

    // Bot 过滤
    if (this.config.filterBots) {
      result = result.filter(s => !this.isBot(s));
    }

    // 去除重复内容
    result = this.deduplicate(result);

    return result;
  }

  private isBot(signal: TwitterSignal): boolean {
    const content = signal.content;
    const username = signal.author.username;

    // 检查信任账号白名单
    if (TRUSTED_ACCOUNTS.has(username.toLowerCase())) {
      return false;
    }

    // 检查用户名 bot 模式
    for (const pattern of BOT_USERNAMES) {
      if (pattern.test(username)) {
        this.logger(`[TwitterAnalyzer] Bot检测(用户名): @${username}`);
        return true;
      }
    }

    // 检查内容 bot 模式
    for (const pattern of BOT_PATTERNS) {
      if (pattern.test(content)) {
        this.logger(`[TwitterAnalyzer] Bot检测(内容): ${content.substring(0, 50)}...`);
        return true;
      }
    }

    // 检查关注者异常低
    if (
      signal.author.followersCount > 0 &&
      signal.engagementScore > 100 &&
      signal.author.followersCount < 100
    ) {
      // 高参与但几乎无关注者 -> bot
      this.logger(`[TwitterAnalyzer] Bot检测(异常参与): @${username} followers=${signal.author.followersCount}`);
      return true;
    }

    // 检查是否全是链接
    const linkCount = (content.match(/https?:\/\//g) || []).length;
    if (linkCount > 3) {
      return true;
    }

    return false;
  }

  private deduplicate(signals: TwitterSignal[]): TwitterSignal[] {
    const seen = new Set<string>();
    return signals.filter(s => {
      // 基于内容的 hash 去重
      const normalized = s.content.toLowerCase().replace(/https?:\/\/\S+/g, '').trim();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }

  // ============================================================
  // Step 3: 分类 - 按主题/情感/类型分组
  // ============================================================

  private categorize(
    signals: TwitterSignal[]
  ): {
    signals: TwitterSignal[];
    categories: Record<string, TwitterSignal[]>;
    topSignals: TwitterSignal[];
  } {
    const categories: Record<string, TwitterSignal[]> = {
      breaking_news: [],
      opinion_analysis: [],
      product_launch: [],
      funding_investment: [],
      job_market: [],
      tutorial_howto: [],
      opinion_poll: [],
      other: []
    };

    for (const signal of signals) {
      const category = this.classifyByContent(signal);
      categories[category].push(signal);
    }

    return {
      signals,
      categories,
      topSignals: []
    };
  }

  private classifyByContent(signal: TwitterSignal): string {
    const content = signal.content.toLowerCase();
    const hashtags = signal.hashtags.map(h => h.toLowerCase());
    const combined = `${content} ${hashtags.join(' ')}`;

    // Breaking News: 突发新闻/重大事件
    if (
      /\b(breaking|just in|announcement|announced|revealed|launched|released|unveiled)\b/.test(combined)
    ) {
      return 'breaking_news';
    }

    // Opinion/Analysis: 观点分析
    if (
      /\b(think|believe|opinion|analysis|my take|hot take|cold take|perspective|view|believe)\b/.test(combined)
    ) {
      return 'opinion_analysis';
    }

    // Product Launch: 产品发布
    if (
      /\b(new|launch|release|introducing|announcing|drop|dropping)\b/.test(combined) &&
      /\b(tool|app|product|feature|plugin|extension|platform|service)\b/.test(combined)
    ) {
      return 'product_launch';
    }

    // Funding/Investment: 融资投资
    if (
      /\b(raised|funding|Series|invested|investment|valuation|acquired|acquisition|\$\d+M|\$\d+B)\b/.test(combined)
    ) {
      return 'funding_investment';
    }

    // Job Market: 就业市场
    if (
      /\b(job|layoff|hiring| hired| unemployed|career|job market|replaced|automation)\b/.test(combined)
    ) {
      return 'job_market';
    }

    // Tutorial/How-to: 教程指南
    if (
      /\b(how to|tutorial|guide|step by step|learn|teaching|built|demo|code|example)\b/.test(combined)
    ) {
      return 'tutorial_howto';
    }

    // Opinion Poll: 投票/问答
    if (
      /\b(poll|vote|should|would you|what do you|ask|question|thoughts)\b/.test(combined)
    ) {
      return 'opinion_poll';
    }

    return 'other';
  }

  // ============================================================
  // Step 4: 排序 - 综合评分排序
  // ============================================================

  private rank(result: {
    signals: TwitterSignal[];
    categories: Record<string, TwitterSignal[]>;
    topSignals: TwitterSignal[];
  }): {
    signals: TwitterSignal[];
    categories: Record<string, TwitterSignal[]>;
    topSignals: TwitterSignal[];
  } {
    // 综合排序: 参与度 x 0.5 + 信任账号加权 x 0.3 + 病毒性加权 x 0.2
    const scored = result.signals.map(signal => ({
      signal,
      score:
        signal.engagementScore * 0.5 +
        (TRUSTED_ACCOUNTS.has(signal.author.username.toLowerCase()) ? 500 : 0) * 0.3 +
        ({ low: 0, medium: 50, high: 200, viral: 1000 }[signal.viralityLevel] ?? 0) * 0.2
    }));

    scored.sort((a, b) => b.score - a.score);

    const rankedSignals = scored.map(s => s.signal);
    const rankedCategories: Record<string, TwitterSignal[]> = {};

    for (const [cat, sigs] of Object.entries(result.categories)) {
      rankedCategories[cat] = sigs.sort(
        (a, b) => b.engagementScore - a.engagementScore
      );
    }

    return {
      signals: rankedSignals,
      categories: rankedCategories,
      topSignals: rankedSignals.slice(0, this.config.maxResults)
    };
  }

  // ============================================================
  // Step 5: 生成摘要
  // ============================================================

  private generateSummary(result: {
    signals: TwitterSignal[];
    categories: Record<string, TwitterSignal[]>;
    topSignals: TwitterSignal[];
  }): TwitterAnalysisSummary {
    const totalSignals = result.signals.length;

    const sentimentBreakdown = {
      positive: result.signals.filter(s => s.sentiment === 'positive').length,
      neutral: result.signals.filter(s => s.sentiment === 'neutral').length,
      negative: result.signals.filter(s => s.sentiment === 'negative').length
    };

    const viralityBreakdown = {
      low: result.signals.filter(s => s.viralityLevel === 'low').length,
      medium: result.signals.filter(s => s.viralityLevel === 'medium').length,
      high: result.signals.filter(s => s.viralityLevel === 'high').length,
      viral: result.signals.filter(s => s.viralityLevel === 'viral').length
    };

    const categoryBreakdown: Record<string, number> = {};
    for (const [cat, sigs] of Object.entries(result.categories)) {
      categoryBreakdown[cat] = sigs.length;
    }

    const totalEngagement = result.signals.reduce(
      (sum, s) => sum + s.engagementScore,
      0
    );

    return {
      totalSignals,
      sentimentBreakdown,
      viralityBreakdown,
      categoryBreakdown,
      totalEngagement,
      topKeywords: this.extractTopKeywords(result.signals),
      topHashtags: this.extractTopHashtags(result.signals)
    };
  }

  private extractTopKeywords(signals: TwitterSignal[]): string[] {
    const freq = new Map<string, number>();
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'under', 'again',
      'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
      'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
      'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
      'just', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while',
      'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
      'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
      'i', 'my', 'me', 'what', 'which', 'who', 'whom', 'being', 'we', 've',
      're', 'll', 'd', 's', 't', 'don', 'doesn', 'didn', 'won', 'wouldn',
      'couldn', 'shouldn', 'hasn', 'haven', 'hadn', 'isn', 'aren', 'wasn',
      'weren', 'also', 'get', 'got', 'getting', 'make', 'made', 'making'
    ]);

    for (const signal of signals) {
      const words = signal.content
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, '')
        .replace(/@\w+/g, '')
        .replace(/#\w+/g, '')
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w) && !/^\d+$/.test(w));

      for (const word of words) {
        freq.set(word, (freq.get(word) ?? 0) + 1);
      }
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word]) => word);
  }

  private extractTopHashtags(signals: TwitterSignal[]): string[] {
    const freq = new Map<string, number>();
    for (const signal of signals) {
      for (const tag of signal.hashtags) {
        freq.set(tag, (freq.get(tag) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag]) => tag);
  }
}

// ============================================================
// 类型定义 (引用自 types.ts)
// ============================================================

export interface TwitterAnalysisSummary {
  totalSignals: number;
  sentimentBreakdown: {
    positive: number;
    neutral: number;
    negative: number;
  };
  viralityBreakdown: {
    low: number;
    medium: number;
    high: number;
    viral: number;
  };
  categoryBreakdown: Record<string, number>;
  totalEngagement: number;
  topKeywords: string[];
  topHashtags: string[];
}

// ============================================================
// 便捷函数
// ============================================================

export function analyzeTwitterData(
  signals: TwitterSignal[],
  config?: TwitterAnalyzerConfig,
  logger?: (msg: string) => void
): TwitterAnalysisResult {
  const analyzer = new TwitterDataAnalyzer(config, logger);
  return analyzer.analyze(signals);
}
