// src/fetchers/trendingFetcher.ts
// 趋势数据采集器：从 HN、GitHub Trending、Stack Overflow 获取技术趋势和潜在商机

import axios from 'axios';

// ============================================================
// 接口定义
// ============================================================
export interface TrendingSignal {
  title: string;
  url: string;
  sourcePlatform: 'hackernews' | 'github-trending' | 'stackoverflow';
  identifier: string;   // 平台唯一标识
  metadata: Record<string, unknown>;
}

// ============================================================
// Hacker News
// ============================================================

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  type?: string;
  by?: string;
  time?: number;
  descendants?: number;
  kids?: number[];
}

/**
 * 获取 Hacker News 热门帖子中包含"发布/上线"关键词的高分内容
 */
export async function fetchHackerNewsTrends(): Promise<TrendingSignal[]> {
  // TODO: 如 FirebaseIO 受限，可考虑镜像 https://hacker-news.firebaseio.com/v0/topstories.json
  const TOP_IDS_URL = 'https://hacker-news.firebaseio.com/v0/topstories.json';
  const ITEM_URL = (id: number) =>
    `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

  try {
    console.log('[HN] Fetching top story IDs...');
    const res = await fetch(TOP_IDS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ids: number[] = (await res.json()) as number[];

    // 取前 50 个并行拉详情（HN 并发容忍度高）
    const top50 = ids.slice(0, 50);
    const items = await Promise.all(
      top50.map(async (id): Promise<HNItem | null> => {
        try {
          const r = await fetch(ITEM_URL(id));
          if (!r.ok) return null;
          return await r.json() as HNItem | null;
        } catch {
          return null;
        }
      })
    );

    const LAUNCH_KEYWORDS = ['show hn', 'launch', 'just shipped', 'announcing', 'open source'];

    const signals: TrendingSignal[] = [];
    for (const item of items) {
      if (!item || item.type !== 'story' || !item.title) continue;
      const title = item.title;
      const score = item.score ?? 0;
      if (score <= 50) continue;
      const lower = title.toLowerCase();
      if (!LAUNCH_KEYWORDS.some(k => lower.includes(k))) continue;

      signals.push({
        title,
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        sourcePlatform: 'hackernews',
        identifier: `hn-${item.id}`,
        metadata: {
          score,
          author: item.by,
          comments: item.descendants ?? 0,
          timestamp: item.time ? new Date(item.time * 1000) : null
        }
      });
    }

    console.log(`[HN] Filtered ${signals.length} launch/show-HN posts (score > 50)`);
    return signals;
  } catch (err: any) {
    console.error(`[HN] Failed: ${err.message}`);
    return [];
  }
}

// ============================================================
// GitHub Trending
// ============================================================

interface GithubSearchItem {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
}

interface GithubSearchResponse {
  items: GithubSearchItem[];
}

/**
 * 获取 GitHub 近期高星仓库，使用 GitHub 官方 Search API
 */
export async function fetchGitHubTrending(): Promise<TrendingSignal[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[GitHub-Trending] GITHUB_TOKEN not set in environment, skipping...');
    return [];
  }

  const API = 'https://api.github.com/search/repositories';
  const params = {
    q: 'stars:>100 pushed:>2026-01-01',
    sort: 'stars',
    order: 'desc',
    per_page: 30
  };

  try {
    console.log('[GitHub-Trending] Fetching via GitHub Search API...');
    const res = await axios.get<GithubSearchResponse>(API, {
      params,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'OpportunityScanner/1.0'
      },
      timeout: 15000
    });

    const items = res.data.items ?? [];

    // 前置过滤：移除非商业化项目（文档类、配置文件等）
    const NOISY_LANGUAGES = ['Markdown', 'HTML', 'CSS', 'Shell', 'Dockerfile'];
    const COMMERCIAL_KEYWORDS = [
      'tool', 'api', 'automation', 'plugin', 'extension',
      'sdk', 'framework', 'cli', 'generator', 'converter'
    ];

    let filtered = items.filter(item => {
      const lang = item.language ?? '';
      const desc = (item.description ?? '').toLowerCase();
      const isNoisyLang = NOISY_LANGUAGES.includes(lang);
      const hasCommercialSignal = COMMERCIAL_KEYWORDS.some(k => desc.includes(k));
      return !isNoisyLang || hasCommercialSignal;
    });

    // 如果过滤后不足 10 条，放宽语言限制（只排除 Markdown）
    if (filtered.length < 10) {
      filtered = items.filter(item => (item.language ?? '') !== 'Markdown');
    }

    // 商业噪音过滤：移除公共资源类项目（awesome-list、curated、interview 等）
    // 这类仓库虽然 star 高，但本质是学习资源合集，不具备商业化潜力
    const NOISE_PATTERNS = [
      'awesome', 'curated-list', 'curated-resources', 'resources',
      'free-programming-books', 'roadmap', 'style-guide',
      'interview-preparation', 'coding-interview', 'wiki', 'awesome-list'
    ];

    filtered = filtered.filter(repo => {
      const desc = (repo.description ?? '').toLowerCase();
      // 规则1：描述命中噪音关键词 → 丢弃
      if (NOISE_PATTERNS.some(p => desc.includes(p))) return false;
      // 规则2：超高分仓库（star > 100k）且描述为空或极短 → 视为公共资源，丢弃
      if (repo.stargazers_count > 100000 && desc.length < 20) return false;
      return true;
    });

    const signals: TrendingSignal[] = [];

    for (const repo of filtered) {
      signals.push({
        title: repo.full_name,
        url: repo.html_url,
        sourcePlatform: 'github-trending',
        identifier: repo.full_name,
        metadata: {
          description: repo.description,
          stars: repo.stargazers_count,
          language: repo.language
        }
      });
    }

    console.log(`[GitHub-Trending] ${filtered.length} repos after noise filter (from ${items.length} total)`);
    return signals;
  } catch (err: any) {
    const msg = err.response?.data?.message ?? err.message;
    console.error(`[GitHub-Trending] Failed: ${msg}`);
    return [];
  }
}

// ============================================================
// Stack Overflow
// ============================================================

interface SOQuestion {
  question_id?: number;
  title?: string;
  score?: number;
  answer_count?: number;
  link?: string;
  tags?: string[];
  creation_date?: number;
  is_answered?: boolean;
}

/**
 * 获取 Stack Overflow 上 score > 20 且 answer_count === 0 的"完全无人解决"问题。
 * 只保留高关注度且零答案的痛点——这是最强烈的商机信号。
 */
export async function fetchStackOverflowPainPoints(): Promise<TrendingSignal[]> {
  const BASE = 'https://api.stackexchange.com/2.3/search/advanced';
  const QUERIES = [
    // VSCode 扩展痛点（高频、零答案）
    'VSCode extension API not working',
    'VSCode Marketplace review API broken',
    // Chrome 扩展痛点
    'chrome extension manifest v3 storage localStorage broken',
    // Shopify 电商痛点
    'Shopify webhook not firing order paid',
    // 独立开发者工具缺失
    'looking for self-hosted alternative to expensive SaaS tool',
    // Notion 集成痛点
    'Notion API automation broken 2026'
  ];
  // TODO: 未来可增加 "site:shopify.com" 等站点限定查询，覆盖更多细分场景

  try {
    console.log('[SO] Fetching Stack Overflow pain points...');
    const signals: TrendingSignal[] = [];

    await Promise.all(
      QUERIES.map(async (q) => {
        const url = `${BASE}?pagesize=30&sort=votes&order=desc&q=${encodeURIComponent(q)}&site=stackoverflow&filter=!-*jbN*Cqbrcb`;
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const data = await res.json() as { items?: SOQuestion[] };
          const items = data.items ?? [];

          for (const item of items) {
            const score = item.score ?? 0;
            const answers = item.answer_count ?? 0;
            // 严选：score > 20（广泛用户关注）且 answer_count === 0（完全无人解决）
            if (score <= 20 || answers !== 0) continue;

            signals.push({
              title: item.title ?? '',
              url: item.link ?? '',
              sourcePlatform: 'stackoverflow',
              identifier: `so-${item.question_id}`,
              metadata: {
                score,
                answer_count: answers,
                tags: item.tags ?? [],
                creation_date: item.creation_date
                  ? new Date(item.creation_date * 1000)
                  : null
              }
            });
          }
        } catch {
          // 单个查询失败不影响其他
        }
      })
    );

    // 按 score 降序，去重
    const deduped = Array.from(
      new Map(signals.map(s => [s.identifier, s])).values()
    ).sort((a, b) => {
      const sa = (a.metadata.score as number) ?? 0;
      const sb = (b.metadata.score as number) ?? 0;
      return sb - sa;
    });

    console.log(`[SO] ${deduped.length} absolute pain points (score > 20, answers === 0)`);
    return deduped;
  } catch (err: any) {
    console.error(`[SO] Failed: ${err.message}`);
    return [];
  }
}
