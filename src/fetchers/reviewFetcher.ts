// src/fetchers/reviewFetcher.ts
// Chrome Web Store 评论采集器 v5.5
// 深度漏洞探测版 - 直接抓取评论页，提取崩溃密度

import axios from 'axios';
import * as cheerio from 'cheerio';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================
// 崩溃密度关键词（深度漏洞探测）
// ============================================================
const CRASH_KEYWORDS = [
  'not working', 'broken', 'stopped working', 'dead', 'useless',
  'trash', 'garbage', 'scam', 'awful', 'terrible', 'worst',
  'crash', 'freeze', 'bug', 'error', 'glitch', 'fails',
  'waste', 'disappointed', 'refund', 'refuse'
];

const MV3_KEYWORDS = [
  'mv3', 'manifest v3', 'v3', 'chrome update',
  'greyed out', 'grayed out', 'disabled', 'icon grey', 'greyed out'
];

const DEVELOPER_DEAD_KEYWORDS = [
  'developer not responding', 'no response', 'abandoned', 'discontinued',
  'no support', 'unresponsive', 'developer is gone', 'left us'
];

// 技术错误模式
const TECHNICAL_ERROR_PATTERNS = [
  { pattern: /CSS selector.*?(?:changed|invalid|error)/i, type: 'CSS选择器变更' },
  { pattern: /API(?:_|\s)permission(?:s)? (?:revoked|removed|changed|denied)/i, type: 'API权限被收回' },
  { pattern: /manifest\.json/i, type: 'Manifest配置错误' },
  { pattern: /service\s*worker/i, type: 'Service Worker问题' },
  { pattern: /content script/i, type: 'Content Script失效' },
  { pattern: /storage\.local|chrome\.storage/i, type: 'Storage API问题' },
  { pattern: /CORS|cross.origin/i, type: 'CORS跨域问题' },
  { pattern: /declarativeNetRequest|webRequest/i, type: '请求拦截API变更' },
  { pattern: /host.?permissions?|permissions/i, type: '权限配置问题' },
  { pattern: /background\.js|background\.ts/i, type: 'Background脚本错误' }
];

export interface Review {
  author: string;
  rating: number; // 1-5
  date: Date;
  content: string;
  isStale: boolean; // 是否是停更后的评论
  sentiment: 'positive' | 'neutral' | 'negative';
  painKeywords: string[];
  isCrashRelated: boolean; // 是否是崩溃相关
  isMv3Related: boolean; // 是否是MV3相关
  developerDeadMention: boolean; // 是否提到开发者失联
  technicalErrors: string[]; // 技术报错类型
}

export interface ReviewAnalysis {
  reviews: Review[];
  avgRating: number;
  negativeRatio: number;
  painPoints: string[];
  requestedFeatures: string[];
  monetizationSignals: string[];
  mv3Broken: boolean; // Manifest V3 失效
  userRageLevel: number; // 0-100
  bestSlogan: string;
  killerFeature: string;
  crashDensity: number; // 崩溃密度评分 (0-30)
  developerUnresponsive: boolean; // 开发者无响应标记
  technicalErrors: string[]; // 技术报错类型
  fixRecommendations: string[]; // 修复建议
}

// ============================================================
// v5.5: 深度评论抓取函数
// ============================================================

/**
 * 深度抓取 Chrome Web Store 评论页
 * 针对 Stage 1 搜到的安装量 > 5万且停更的项目，直接构造评论页 URL
 */
export async function fetchExtensionReviews(
  extensionId: string,
  extensionName: string,
  requestInterval: number = 2000
): Promise<Review[]> {
  const reviews: Review[] = [];
  const reviewUrl = `https://chromewebstore.google.com/detail/${extensionId}/reviews`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Referer': 'https://chromewebstore.google.com/'
  };

  try {
    console.log(`[ReviewFetcher] 深度抓取评论: ${extensionName}`);
    console.log(`[ReviewFetcher] URL: ${reviewUrl}`);

    const response = await axios.get(reviewUrl, {
      headers,
      timeout: 30000
    });

    const $ = cheerio.load(response.data);
    const bodyText = $('body').text();

    // 方法1: 从 JSON-LD 中提取评论
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '');
        if (data['@type'] === 'Product' || data['@type'] === 'WebApplication') {
          const aggregateRating = data.aggregateRating;
          if (aggregateRating?.review) {
            const reviewsList = Array.isArray(aggregateRating.review)
              ? aggregateRating.review
              : [aggregateRating.review];

            for (const r of reviewsList.slice(0, 20)) { // 限制20条
              const content = r.reviewBody || r.description || '';
              const lowerContent = content.toLowerCase();

              reviews.push({
                author: r.author?.name || 'Anonymous',
                rating: parseInt(String(r.reviewRating?.ratingValue)) || 3,
                date: new Date(r.datePublished || Date.now()),
                content: content,
                isStale: false,
                sentiment: 'neutral',
                painKeywords: extractPainKeywords(content),
                isCrashRelated: isCrashRelated(lowerContent),
                isMv3Related: isMv3Related(lowerContent),
                developerDeadMention: isDeveloperDead(lowerContent),
                technicalErrors: extractTechnicalErrors(content)
              });
            }
          }
        }
      } catch (e) { /* 忽略 */ }
    });

    // 方法2: 从页面 DOM 结构提取评论 (新版本 Chrome Store)
    if (reviews.length < 5) {
      // 尝试从用户评价区域提取
      const reviewContainers = $('[class*="review"], [data-review-id]');

      reviewContainers.each((_, el) => {
        if (reviews.length >= 20) return false;

        const $el = $(el);
        const content = $el.find('[class*="review-body"], [class*="reviewContent"], [class*="text"]').first().text().trim();
        const author = $el.find('[class*="author"], [class*="reviewer"]').first().text().trim() || 'User';
        const ratingStr = $el.find('[class*="star"], [class*="rating"]').first().attr('aria-label') || '';
        const rating = parseInt(ratingStr.match(/(\d)/)?.[1] || '3');
        const dateStr = $el.find('[class*="date"], [class*="time"]').first().text().trim();
        const date = parseReviewDate(dateStr) || new Date();

        if (content.length > 10) {
          const lowerContent = content.toLowerCase();
          reviews.push({
            author: author.substring(0, 50),
            rating,
            date,
            content,
            isStale: false,
            sentiment: rating <= 2 ? 'negative' : (rating >= 4 ? 'positive' : 'neutral'),
            painKeywords: extractPainKeywords(content),
            isCrashRelated: isCrashRelated(lowerContent),
            isMv3Related: isMv3Related(lowerContent),
            developerDeadMention: isDeveloperDead(lowerContent),
            technicalErrors: extractTechnicalErrors(content)
          });
        }
      });
    }

    // 方法3: 从页面文本中提取评论片段 (兜底)
    if (reviews.length < 5) {
      const reviewPatterns = [
        /"([^"]{20,500})"\s*\n?\s*(\d+)\s*(?:star|out)/gi,
        /([A-Za-z0-9_]+)\s+(?:years?|months?|days?)\s+ago\s*\n([\s\S]{20,500}?)(?=\n[A-Za-z]|$)/gi
      ];

      for (const pattern of reviewPatterns) {
        let match;
        while ((match = pattern.exec(bodyText)) !== null && reviews.length < 20) {
          const content = (match[2] || match[1] || '').trim();
          if (content.length > 10) {
            const ratingStr = match[1]?.match(/\d+/)?.[0] || '3';
            const rating = Math.min(5, Math.max(1, parseInt(ratingStr) || 3));
            const lowerContent = content.toLowerCase();

            reviews.push({
              author: 'User',
              rating,
              date: new Date(),
              content: content.substring(0, 500),
              isStale: false,
              sentiment: rating <= 2 ? 'negative' : (rating >= 4 ? 'positive' : 'neutral'),
              painKeywords: extractPainKeywords(content),
              isCrashRelated: isCrashRelated(lowerContent),
              isMv3Related: isMv3Related(lowerContent),
              developerDeadMention: isDeveloperDead(lowerContent),
              technicalErrors: extractTechnicalErrors(content)
            });
          }
        }
      }
    }

    console.log(`[ReviewFetcher] 获取到 ${reviews.length} 条评论`);

    // 延迟避免被限流
    await new Promise(r => setTimeout(r, requestInterval));
  } catch (err) {
    console.log(`[ReviewFetcher] 评论抓取失败: ${err}`);
  }

  return reviews.slice(0, 20); // 最多返回20条
}

/**
 * 兼容旧接口
 */
export async function fetchLatestReviews(
  extensionId: string,
  storeUrl: string,
  lastUpdated: Date,
  requestInterval: number = 2000
): Promise<Review[]> {
  const reviews: Review[] = [];

  const reviewUrl = storeUrl.includes('chromewebstore.google.com')
    ? `${storeUrl}/reviews`
    : `https://chromewebstore.google.com/detail/${extensionId}/reviews`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://chromewebstore.google.com/'
  };

  try {
    const response = await axios.get(reviewUrl, { headers, timeout: 30000 });
    const $ = cheerio.load(response.data);
    const bodyText = $('body').text();

    // 从 JSON-LD 提取
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '');
        if (data['@type'] === 'Product' || data['@type'] === 'WebApplication') {
          const aggregateRating = data.aggregateRating;
          if (aggregateRating?.review) {
            const reviewsList = Array.isArray(aggregateRating.review)
              ? aggregateRating.review
              : [aggregateRating.review];

            for (const r of reviewsList.slice(0, 20)) {
              const content = r.reviewBody || r.description || '';
              const lowerContent = content.toLowerCase();

              reviews.push({
                author: r.author?.name || 'Anonymous',
                rating: parseInt(String(r.reviewRating?.ratingValue)) || 3,
                date: new Date(r.datePublished || Date.now()),
                content: content,
                isStale: false,
                sentiment: 'neutral',
                painKeywords: extractPainKeywords(content),
                isCrashRelated: isCrashRelated(lowerContent),
                isMv3Related: isMv3Related(lowerContent),
                developerDeadMention: isDeveloperDead(lowerContent),
                technicalErrors: extractTechnicalErrors(content)
              });
            }
          }
        }
      } catch (e) { /* 忽略 */ }
    });

    // 兜底: 返回占位评论
    if (reviews.length === 0) {
      reviews.push({
        author: 'detected_by_ai',
        rating: 3,
        date: new Date(),
        content: '[评论数据需通过 Chrome Web Store 页面采集]',
        isStale: false,
        sentiment: 'neutral',
        painKeywords: [],
        isCrashRelated: false,
        isMv3Related: false,
        developerDeadMention: false,
        technicalErrors: []
      });
    }

    await new Promise(r => setTimeout(r, requestInterval));
  } catch (err) {
    console.log(`[ReviewFetcher] 获取评论失败: ${err}`);
  }

  return reviews;
}

// ============================================================
// 辅助函数
// ============================================================

function extractPainKeywords(content: string): string[] {
  const lower = content.toLowerCase();
  return CRASH_KEYWORDS.filter(k => lower.includes(k));
}

function isCrashRelated(content: string): boolean {
  return CRASH_KEYWORDS.some(k => content.includes(k));
}

function isMv3Related(content: string): boolean {
  return MV3_KEYWORDS.some(k => content.includes(k));
}

function isDeveloperDead(content: string): boolean {
  return DEVELOPER_DEAD_KEYWORDS.some(k => content.includes(k));
}

function extractTechnicalErrors(content: string): string[] {
  const errors: string[] = [];
  for (const { pattern, type } of TECHNICAL_ERROR_PATTERNS) {
    if (pattern.test(content)) {
      errors.push(type);
    }
  }
  return errors;
}

function parseReviewDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  const now = new Date();
  const lower = dateStr.toLowerCase();

  // 解析相对时间
  const minuteMatch = lower.match(/(\d+)\s*min/i);
  const hourMatch = lower.match(/(\d+)\s*hour/i);
  const dayMatch = lower.match(/(\d+)\s*day/i);
  const weekMatch = lower.match(/(\d+)\s*week/i);
  const monthMatch = lower.match(/(\d+)\s*month/i);
  const yearMatch = lower.match(/(\d+)\s*year/i);

  if (yearMatch) {
    return new Date(now.getTime() - parseInt(yearMatch[1]) * 365 * 24 * 60 * 60 * 1000);
  }
  if (monthMatch) {
    return new Date(now.getTime() - parseInt(monthMatch[1]) * 30 * 24 * 60 * 60 * 1000);
  }
  if (weekMatch) {
    return new Date(now.getTime() - parseInt(weekMatch[1]) * 7 * 24 * 60 * 60 * 1000);
  }
  if (dayMatch) {
    return new Date(now.getTime() - parseInt(dayMatch[1]) * 24 * 60 * 60 * 1000);
  }
  if (hourMatch) {
    return new Date(now.getTime() - parseInt(hourMatch[1]) * 60 * 60 * 1000);
  }
  if (minuteMatch) {
    return new Date(now.getTime() - parseInt(minuteMatch[1]) * 60 * 1000);
  }

  // 尝试直接解析
  try {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed;
  } catch (e) { /* 忽略 */ }

  return null;
}

// ============================================================
// 评论分析 v5.5 - 增强版
// ============================================================

export function analyzeReviews(reviews: Review[], extensionName: string): ReviewAnalysis {
  if (reviews.length === 0) {
    return {
      reviews: [],
      avgRating: 0,
      negativeRatio: 0,
      painPoints: [],
      requestedFeatures: [],
      monetizationSignals: [],
      mv3Broken: false,
      userRageLevel: 0,
      bestSlogan: '',
      killerFeature: '',
      crashDensity: 0,
      developerUnresponsive: false,
      technicalErrors: [],
      fixRecommendations: []
    };
  }

  // 统计评分
  const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
  const avgRating = totalRating / reviews.length;
  const negativeReviews = reviews.filter(r => r.rating <= 2);
  const negativeRatio = negativeReviews.length / reviews.length;

  // 收集所有评论文本
  const allText = reviews.map(r => r.content).join(' ').toLowerCase();

  // v5.5: 检测 MV3 问题
  const mv3Broken = MV3_KEYWORDS.some(k => allText.includes(k));

  // v5.5: 检测开发者无响应
  const developerUnresponsive = reviews.some(r => r.developerDeadMention);

  // v5.5: 提取所有技术错误类型
  const allTechnicalErrors = new Set<string>();
  reviews.forEach(r => r.technicalErrors.forEach(e => allTechnicalErrors.add(e)));
  const technicalErrors = Array.from(allTechnicalErrors);

  // 提取痛点
  const painPointsSet = new Set<string>();
  for (const review of negativeReviews) {
    review.painKeywords.forEach(k => painPointsSet.add(k));
  }
  const painPoints = Array.from(painPointsSet);

  // v5.5: 计算崩溃密度 (核心新增!)
  // 逻辑：如果最近 10 条评论中有 5 条以上包含 "not working"，给 30 分满分
  const recentReviews = reviews.slice(0, 10);
  const crashCount = recentReviews.filter(r => r.isCrashRelated).length;
  const crashDensity = crashCount >= 5 ? 30 : Math.round((crashCount / 10) * 30);

  // 提取功能请求
  const requestedFeaturesSet = new Set<string>();
  const featureKeywords = ['wish', 'would be nice', 'please add', 'should have', 'need', 'want', 'feature', 'missing', 'would love'];
  for (const review of reviews) {
    const content = review.content.toLowerCase();
    for (const keyword of featureKeywords) {
      if (content.includes(keyword)) {
        const sentences = review.content.split(/[.!?]/);
        for (const sentence of sentences) {
          if (sentence.toLowerCase().includes(keyword) && sentence.length > 10 && sentence.length < 200) {
            const trimmed = sentence.trim();
            requestedFeaturesSet.add(trimmed);
          }
        }
      }
    }
  }
  const requestedFeatures = Array.from(requestedFeaturesSet);

  // 检测变现信号
  const monetizationSignalsSet = new Set<string>();
  const monetizationKeywords = ['pay', 'paid', 'premium', 'subscription', 'ad', 'ads', 'advertisement', 'buy', 'purchase', 'worth'];
  for (const review of reviews) {
    const content = review.content.toLowerCase();
    for (const keyword of monetizationKeywords) {
      if (content.includes(keyword)) {
        const sentences = review.content.split(/[.!?]/);
        for (const sentence of sentences) {
          if (sentence.toLowerCase().includes(keyword) && sentence.length > 10) {
            const trimmed = sentence.trim();
            monetizationSignalsSet.add(trimmed);
          }
        }
      }
    }
  }
  const monetizationSignals = Array.from(monetizationSignalsSet);

  // v5.5: 计算用户怨气等级 (增强版 - 包含崩溃密度)
  const rageFactors = {
    avgRatingPenalty: (5 - avgRating) * 12, // 最高 60 分
    negativeRatioPenalty: negativeRatio * 20, // 最高 20 分
    painPointBonus: Math.min(painPoints.length * 2, 10), // 最高 10 分
    mv3Bonus: mv3Broken ? 10 : 0, // MV3 问题 +10
    crashDensityBonus: crashDensity * 0.5, // 崩溃密度贡献
    developerDeadBonus: developerUnresponsive ? 10 : 0 // 开发者失联 +10
  };
  const userRageLevel = Math.min(100, Math.round(
    rageFactors.avgRatingPenalty +
    rageFactors.negativeRatioPenalty +
    rageFactors.painPointBonus +
    rageFactors.mv3Bonus +
    rageFactors.crashDensityBonus +
    rageFactors.developerDeadBonus
  ));

  // v5.5: 生成修复建议
  const fixRecommendations = generateFixRecommendations(technicalErrors, mv3Broken, painPoints);

  // 生成杀手级 Slogan
  const bestSlogan = generateSlogan(extensionName, painPoints, avgRating, mv3Broken, crashDensity >= 20);

  // 识别杀手功能
  const killerFeature = identifyKillerFeature(requestedFeatures, painPoints, mv3Broken);

  return {
    reviews,
    avgRating: Math.round(avgRating * 10) / 10,
    negativeRatio: Math.round(negativeRatio * 100),
    painPoints: painPoints.slice(0, 5),
    requestedFeatures: requestedFeatures.slice(0, 3),
    monetizationSignals: monetizationSignals.slice(0, 3),
    mv3Broken,
    userRageLevel,
    bestSlogan,
    killerFeature,
    crashDensity,
    developerUnresponsive,
    technicalErrors,
    fixRecommendations
  };
}

/**
 * v5.5: 生成修复建议
 */
function generateFixRecommendations(technicalErrors: string[], mv3Broken: boolean, painPoints: string[]): string[] {
  const recommendations: string[] = [];

  // 基于技术错误类型生成建议
  if (technicalErrors.includes('CSS选择器变更')) {
    recommendations.push('修复 CSS 选择器：使用 MutationObserver 动态检测 DOM 变化，或使用更稳定的选择器');
  }
  if (technicalErrors.includes('API权限被收回')) {
    recommendations.push('权限申请重构：使用可选权限声明(optional_permissions)，处理权限被拒绝的场景');
  }
  if (technicalErrors.includes('Service Worker问题')) {
    recommendations.push('Service Worker 更新：实现版本控制和缓存策略，处理 SW 更新失败的情况');
  }
  if (technicalErrors.includes('Content Script失效')) {
    recommendations.push('Content Script 重新注入：使用 run_at:"document_idle" 并实现动态注入逻辑');
  }
  if (technicalErrors.includes('Storage API问题')) {
    recommendations.push('存储层重构：添加 localStorage 降级方案，处理 quota 超限异常');
  }
  if (technicalErrors.includes('CORS跨域问题')) {
    recommendations.push('CORS 处理：使用 background script 代理请求，或申请 host permissions');
  }
  if (technicalErrors.includes('请求拦截API变更')) {
    recommendations.push('MV3 迁移：将 webRequest 迁移到 declarativeNetRequest，重写过滤规则');
  }
  if (technicalErrors.includes('权限配置问题')) {
    recommendations.push('权限清单更新：审查 manifest.json 中的 permissions 和 host_permissions');
  }
  if (technicalErrors.includes('Background脚本错误')) {
    recommendations.push('Background 重构：实现错误边界和消息队列，处理连接断开情况');
  }

  // 基于 MV3 问题生成建议
  if (mv3Broken) {
    recommendations.push('Manifest V3 全面迁移：重构为 MV3 架构，使用 declarativeNetRequest 替代 blocking webRequest');
    recommendations.push('Service Worker 化：所有后台逻辑迁移到 SW，设置合理的 updateInterval');
  }

  // 基于痛点生成建议
  if (painPoints.includes('crash') || painPoints.includes('freeze')) {
    recommendations.push('稳定性优化：添加 try-catch 包裹异步操作，实现内存泄漏检测');
  }
  if (painPoints.includes('slow')) {
    recommendations.push('性能优化：使用 Web Worker 处理计算密集任务，延迟加载非关键资源');
  }
  if (painPoints.includes('bug')) {
    recommendations.push('测试覆盖：添加单元测试和 E2E 测试，自动化回归检测');
  }

  // 兜底建议
  if (recommendations.length === 0) {
    recommendations.push('快速复刻策略：克隆原插件核心逻辑，修复已知问题，保持 UI 一致');
    recommendations.push('差异化定位：增加 1-2 个独家功能，优化用户体验，保持持续更新');
  }

  return recommendations.slice(0, 5);
}

/**
 * 生成杀手级 Slogan
 */
function generateSlogan(
  name: string,
  painPoints: string[],
  avgRating: number,
  mv3Broken: boolean,
  highCrashDensity: boolean
): string {
  const baseName = name.split(' ')[0] || name;

  // 高崩溃密度 -> 强调稳定
  if (highCrashDensity) {
    return `${baseName} Pro: 10x More Stable. Finally, It Just Works. No Crashes.`;
  }

  // MV3 相关的 slogan
  if (mv3Broken) {
    return `${baseName} Pro: The Only ${baseName} That Actually Works in 2026. Zero Ads, 100% MV3.`;
  }

  // 高怨气 -> 强调解决问题
  if (avgRating < 3) {
    if (painPoints.includes('broken') || painPoints.includes('not working')) {
      return `${baseName} Pro: Finally, It Just Works. No Ads, No Bloat, Pure ${baseName}.`;
    }
    if (painPoints.includes('slow') || painPoints.includes('bug')) {
      return `${baseName} Pro: 10x Faster, 100% Bug-Free. Built for 2026.`;
    }
    if (painPoints.includes('ad') || painPoints.includes('ads')) {
      return `${baseName} Pro: The Clean Version. No Ads, No Tracking, Just ${baseName}.`;
    }
  }

  // 中等评分 -> 强调现代化
  return `${baseName} Pro: The Modern Take on ${baseName}. Faster, Cleaner, MV3-Ready.`;
}

/**
 * 识别杀手功能
 */
function identifyKillerFeature(features: string[], painPoints: string[], mv3Broken: boolean): string {
  if (mv3Broken) {
    return '100% MV3 Compatible: Built from scratch for Chrome 2026';
  }

  if (painPoints.includes('slow')) {
    return 'Speed Optimization: 10x faster startup, instant results';
  }
  if (painPoints.includes('broken') || painPoints.includes('not working')) {
    return 'MV3 Compatibility: Fully tested and working with latest Chrome';
  }
  if (painPoints.includes('ad') || painPoints.includes('ads')) {
    return 'Ad-Free Forever: Clean UI with zero distractions';
  }
  if (painPoints.includes('bug') || painPoints.includes('crash')) {
    return 'Bug-Free Guarantee: Enterprise-grade stability testing';
  }

  if (features.length > 0) {
    return `AI-Powered ${features[0].split(' ').slice(0, 3).join(' ')}...`;
  }

  return 'Essential Mode: Lightweight, fast, does one thing perfectly';
}
