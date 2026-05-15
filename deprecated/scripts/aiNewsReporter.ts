// src/scripts/aiNewsReporter.ts
// AI 热点新闻采集 + 推特文案生成工具
// 用途：每天只发 2-3 条推特 + 10 条英文新闻汇总，供用户挑选多发纯文案推特
//
// 使用方式:
//   npx tsx src/scripts/aiNewsReporter.ts
//   npx tsx src/scripts/aiNewsReporter.ts --max-tweets 3 --max-news 10
//   npx tsx src/scripts/aiNewsReporter.ts --sources rss,hn,arxiv
//
// 输出:
//   - 2-3 个推文文案（每条含英文 + 中文双语），每个文案附一张 AI 生成的图片
//   - 10 条最热门的英文 AI 新闻汇总（纯摘要，用户可挑选多发）
//   - 最终输出到 reports/ai-news-report-YYYY-MM-DD.md

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { NewsRssFetcher } from '../fetchers/newsRssFetcher.js';
import { HNAlgoliaFetcher } from '../fetchers/hnAlgoliaFetcher.js';
import { ResearchFetcher } from '../fetchers/researchFetcher.js';
import { ContentGenerator } from '../generators/ContentGenerator.js';
import { MultiSourceMerger } from '../services/MultiSourceMerger.js';
import type { RSSNewsItem, HackerNewsAlgoliaItem, ResearchItem, UnifiedSignal } from '../types.js';
import { DataSource } from '../types.js';

dotenv.config();

// ============================================================
// CLI 参数解析
// ============================================================

interface CliArgs {
  maxTweets: number;
  maxNews: number;
  sources: string[];
  image: boolean;
  output: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    maxTweets: 3,
    maxNews: 10,
    sources: ['rss', 'hn', 'arxiv'],
    image: true,
    output: ''
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--max-tweets' && args[i + 1]) {
      result.maxTweets = parseInt(args[++i], 10);
    } else if (arg === '--max-news' && args[i + 1]) {
      result.maxNews = parseInt(args[++i], 10);
    } else if (arg === '--sources' && args[i + 1]) {
      result.sources = args[++i].split(',');
    } else if (arg === '--no-image') {
      result.image = false;
    } else if (arg === '--output' && args[i + 1]) {
      result.output = args[++i];
    }
  }

  return result;
}

// ============================================================
// 日志
// ============================================================

function createLogger(prefix: string) {
  return (msg: string) => {
    const ts = new Date().toISOString().substring(11, 19);
    console.log(`[${ts}] [${prefix}] ${msg}`);
  };
}

const log = {
  rss: createLogger('RSS'),
  hn: createLogger('HN'),
  arxiv: createLogger('ArXiv'),
  merge: createLogger('Merger'),
  gen: createLogger('Generator'),
  main: createLogger('Main'),
  image: createLogger('Image')
};

// ============================================================
// Phase 1: 多源数据采集
// ============================================================

async function fetchFromRSS(): Promise<RSSNewsItem[]> {
  log.rss('开始抓取 RSS 新闻源...');
  try {
    const fetcher = new NewsRssFetcher({}, log.rss);
    const items = await fetcher.fetchAll();
    log.rss(`RSS 抓取完成: ${items.length} 条`);
    return items;
  } catch (err: any) {
    log.rss(`RSS 抓取失败: ${err.message}`);
    return [];
  }
}

async function fetchFromHN(): Promise<HackerNewsAlgoliaItem[]> {
  log.hn('开始抓取 Hacker News...');
  try {
    const fetcher = new HNAlgoliaFetcher(
      { daysBack: 3, maxResults: 30, minScore: 5, requestInterval: 1200 },
      log.hn
    );
    const items = await fetcher.fetchAll();
    log.hn(`HN 抓取完成: ${items.length} 条`);
    return items;
  } catch (err: any) {
    log.hn(`HN 抓取失败: ${err.message}`);
    return [];
  }
}

async function fetchFromArxiv(): Promise<ResearchItem[]> {
  log.arxiv('开始抓取研究论文...');
  try {
    const fetcher = new ResearchFetcher({ daysBack: 7, arxivMaxResults: 20 }, log.arxiv);
    const items = await fetcher.fetchAll();
    log.arxiv(`ArXiv 抓取完成: ${items.length} 条`);
    return items;
  } catch (err: any) {
    log.arxiv(`ArXiv 抓取失败: ${err.message}`);
    return [];
  }
}

async function fetchAllSources(sources: string[]): Promise<{
  rss: RSSNewsItem[];
  hn: HackerNewsAlgoliaItem[];
  arxiv: ResearchItem[];
}> {
  log.main('='.repeat(60));
  log.main('Phase 1: 多源数据采集');
  log.main(`启用数据源: ${sources.join(', ')}`);
  log.main('='.repeat(60));

  const tasks: Promise<unknown>[] = [];
  const results: { rss: RSSNewsItem[]; hn: HackerNewsAlgoliaItem[]; arxiv: ResearchItem[] } = {
    rss: [],
    hn: [],
    arxiv: []
  };

  if (sources.includes('rss')) {
    tasks.push(fetchFromRSS().then(r => { results.rss = r; }));
  }
  if (sources.includes('hn')) {
    tasks.push(fetchFromHN().then(r => { results.hn = r; }));
  }
  if (sources.includes('arxiv')) {
    tasks.push(fetchFromArxiv().then(r => { results.arxiv = r; }));
  }

  await Promise.all(tasks);

  log.main(`数据采集完成: RSS ${results.rss.length} | HN ${results.hn.length} | ArXiv ${results.arxiv.length}`);
  return results;
}

// ============================================================
// Phase 2: 去重合并 + 评分排序
// ============================================================

function mergeAndRank(
  rss: RSSNewsItem[],
  hn: HackerNewsAlgoliaItem[],
  arxiv: ResearchItem[]
): UnifiedSignal[] {
  log.merge('开始合并去重...');

  const merger = new MultiSourceMerger({ maxSignals: 100 }, log.merge);
  const result = merger.merge({ rssItems: rss, hnItems: hn, researchItems: arxiv });

  log.merge(`合并完成: 总 ${result.totalCount} -> 去重后 ${result.deduplicatedCount} -> 取前 ${result.signals.length}`);

  return result.signals;
}

// ============================================================
// Phase 3: 筛选用于推文的信号（用于文案生成）
// ============================================================

function selectTopSignals(signals: UnifiedSignal[], count: number): UnifiedSignal[] {
  const aiKeywords = [
    'AI', 'artificial intelligence', 'machine learning', 'LLM', 'GPT', 'Claude',
    'ChatGPT', 'OpenAI', 'Anthropic', 'Gemini', 'model', 'neural', 'deep learning',
    'diffusion', 'transformer', 'RAG', 'embedding', 'fine-tuning', 'inference',
    'agent', 'reasoning', 'multimodal', 'vision', 'hugging face', 'langchain',
    'vllm', 'ollama', 'stable diffusion', 'midjourney', 'dall-e', 'sora',
    'perplexity', 'mistral', 'grok', 'gemini', 'llama', 'phi', 'qwen',
    'kimi', 'doubao', 'copilot', 'cursor', 'claude code', 'devin',
    'automation', 'coding', 'programming', 'research', 'benchmark', 'SOTA'
  ];

  const isAIRelated = (s: UnifiedSignal): boolean => {
    const text = `${s.title} ${s.body} ${s.tags.join(' ')}`.toLowerCase();
    return aiKeywords.some(kw => text.includes(kw.toLowerCase()));
  };

  // 先过滤出 AI 相关内容，再按分数排序
  const aiSignals = signals.filter(isAIRelated);
  const nonAISignals = signals.filter(s => !isAIRelated(s));

  log.merge(`AI 相关信号: ${aiSignals.length} / 总共 ${signals.length}`);

  // 优先选 AI 相关内容，不够再用其他
  const combined = [...aiSignals, ...nonAISignals];
  const selected = combined.slice(0, count);
  log.merge(`选取 ${selected.length} 条（AI相关 ${Math.min(count, aiSignals.length)} + 其他 ${Math.max(0, count - aiSignals.length)}）`);
  return selected;
}

// ============================================================
// Phase 4: 生成推文文案 + 图片
// ============================================================

function buildTwitterSignal(signal: UnifiedSignal): {
  id: string;
  url: string;
  content: string;
  author: { username: string; displayName: string; followersCount: number };
  postedAt: Date;
  matchedKeywords: string[];
  engagement: { likes: number; retweets: number; replies: number; views: number };
  engagementScore: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  isRetweet: boolean;
  isQuoted: boolean;
  hashtags: string[];
  mentions: string[];
  viralityLevel: 'low' | 'medium' | 'high' | 'viral';
  rawData: Record<string, unknown>;
} {
  // 从 UnifiedSignal 中提取 hashtag
  const tags = signal.tags || [];
  const hashtags = tags
    .filter(t => !t.includes(' '))
    .slice(0, 5)
    .map(t => (t.startsWith('#') ? t : `#${t}`));

  // 估算 viralityLevel
  let viralityLevel: 'low' | 'medium' | 'high' | 'viral' = 'medium';
  if (signal.score > 500) viralityLevel = 'viral';
  else if (signal.score > 200) viralityLevel = 'high';
  else if (signal.score > 50) viralityLevel = 'medium';
  else viralityLevel = 'low';

  return {
    id: signal.id,
    url: signal.url,
    content: signal.title + (signal.body ? '\n\n' + signal.body.slice(0, 200) : ''),
    author: {
      username: signal.sourceName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase().slice(0, 15) || 'ai_news',
      displayName: signal.sourceName,
      followersCount: Math.round(signal.score * 10)
    },
    postedAt: signal.publishedAt,
    matchedKeywords: tags,
    engagement: {
      likes: Math.round(signal.score * 0.5),
      retweets: Math.round(signal.score * 0.2),
      replies: Math.round(signal.score * 0.1),
      views: Math.round(signal.score * 10)
    },
    engagementScore: signal.score,
    sentiment: signal.sentiment,
    isRetweet: false,
    isQuoted: false,
    hashtags,
    mentions: [],
    viralityLevel,
    rawData: {}
  };
}

async function generateTweetContent(
  signals: UnifiedSignal[],
  count: number,
  generateImage: boolean
): Promise<{
  contents: TweetContent[];
  failedSignals: UnifiedSignal[];
}> {
  const apiKey = process.env.LINKAI_API_KEY;
  const apiBase = process.env.LINKAI_API_BASE || 'https://api1.link-ai.cc';

  if (!apiKey) {
    log.gen('LINKAI_API_KEY 未设置，使用规则生成备选文案');
    return generateFallbackContent(signals.slice(0, count), generateImage);
  }

  log.gen('='.repeat(60));
  log.gen('Phase 2: 生成推文文案 + 图片');
  log.gen(`生成数量: ${count} | 图片生成: ${generateImage}`);
  log.gen('='.repeat(60));

  const topSignals = selectTopSignals(signals, count);
  const twitterSignals = topSignals.map(s => buildTwitterSignal(s));

  const generator = new ContentGenerator(
    {
      apiBase,
      apiKey,
      maxConcurrency: 2,
      textModel: process.env.LINKAI_TEXT_MODEL || 'claude-opus-4-5-20251101',
      imageModel: process.env.LINKAI_IMAGE_MODEL || 'gpt-image-2',
      maxTweetLength: 250,
      generateImage,
      imageSize: '1024x1024',
      imageN: 1,
      outputLanguages: ['en'],
      systemPrompt:
        'You are a Twitter Growth Expert specializing in viral AI news content. ' +
        'Write punchy, engaging tweets that grab attention. ' +
        'Use casual, viral English style with emojis and hashtags. ' +
        'Max 250 characters. Include 1-2 relevant hashtags. End with a question or engaging CTA.'
    },
    log.gen
  );

  const twitterContents = await generator.generateAll(twitterSignals);

  // 为每条内容单独生成中文版本
  const contents: TweetContent[] = await Promise.all(
    twitterContents.map(async (c) => {
      const en = c.texts.en || '';
      const zh = await generateChineseTweet(signalToZH(c.sourceSignal), apiKey, apiBase);
      return {
        en,
        zh,
        imageUrl: c.imageUrl,
        sourceTitle: c.sourceSignal.content.split('\n')[0].slice(0, 80),
        sourceUrl: c.sourceSignal.url
      };
    })
  );

  return { contents, failedSignals: [] };
}

function signalToZH(signal: ReturnType<typeof buildTwitterSignal>): string {
  return `${signal.content}\n\n来源: @${signal.author.username}`;
}

async function generateChineseTweet(
  rawData: string,
  apiKey: string,
  apiBase: string
): Promise<string> {
  const prompt = `Write a tweet in Simplified Chinese (简体中文) based on this AI news:

${rawData}

[TASK]:
- Max 250 characters (STRICTLY enforced).
- Structure: Hook (震惊/有趣) + Value (一句话价值) + Call to Action.
- Style: Punchy, humorous, natural Chinese internet language. No formal corporate speak.
- Use 1-2 relevant hashtags in Chinese (e.g., #AI #人工智能) or mix with English.
- End with a question or engaging statement.

[RULES - CRITICAL]:
1. Output EXACTLY 1 tweet in Simplified Chinese.
2. Character count MUST be under 250 (including spaces and hashtags).
3. Do NOT include quotes, backticks, or any formatting markers.
4. Start with a HOOK that grabs attention immediately.
5. Add 1-2 emojis naturally placed.
6. End with either a question or a short CTA.
7. Make it feel like a real Chinese tech influencer wrote it.`;

  try {
    const response = await axios.post(
      `${apiBase}/v1/chat/completions`,
      {
        model: process.env.LINKAI_TEXT_MODEL || 'claude-opus-4-5-20251101',
        messages: [
          {
            role: 'system',
            content: '你是 Twitter 增长专家，擅长写病毒式传播的 AI 新闻推文。你的风格是：标题党 + 有趣 + 接地气。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.9,
        max_tokens: 300
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        timeout: 60000
      }
    );

    const content = response.data.choices?.[0]?.message?.content?.trim();
    if (!content) return '生成失败';

    return content
      .replace(/^["'"""]/, '')
      .replace(/["'"""]$/, '')
      .trim()
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ');
  } catch {
    return '【中文生成失败，请使用英文版本】';
  }
}

function generateFallbackContent(
  signals: UnifiedSignal[],
  generateImage: boolean
): { contents: TweetContent[]; failedSignals: UnifiedSignal[] } {
  log.gen('使用规则生成备选文案（API Key 未配置）');

  const templates = [
    {
      en: 'AI is moving faster than most people realize. The next breakthrough is already in the labs. Stay curious. #AI #MachineLearning',
      zh: 'AI 的发展速度超出大多数人的想象，下一个突破已经在实验室里了。保持好奇。#AI #机器学习'
    },
    {
      en: 'Hot take: AI won\'t replace your job, but someone using AI will. The real question is: are you learning? #AI #FutureOfWork',
      zh: '热门观点：AI 不会取代你的工作，但会用 AI 的人会。每天学一点 AI，保持竞争力。#AI #未来工作'
    },
    {
      en: 'Just in: Another major AI development that\'s about to change everything. The pace of innovation is absolutely insane right now. #AI #TechNews',
      zh: '突发：又一个重大 AI 进展即将改变一切。创新的速度现在绝对疯狂。#AI #科技新闻'
    },
    {
      en: 'The AI wave isn\'t slowing down. Companies spending billions, researchers publishing daily, and the best is yet to come. #AI #Innovation',
      zh: 'AI 浪潮不会放缓。公司投入数十亿，研究人员每天发表论文，最好的还在后面。#AI #创新'
    },
    {
      en: 'If you\'re not paying attention to AI right now, you\'re missing the biggest shift since the internet. What\'s your take? #AI #Trends',
      zh: '如果你现在不关注 AI，你正在错过自互联网以来最大的变革。你怎么看？#AI #趋势'
    }
  ];

  const contents: TweetContent[] = signals.slice(0, 3).map((signal, i) => {
    const tpl = templates[i % templates.length];
    return {
      en: tpl.en,
      zh: tpl.zh,
      imageUrl: undefined,
      sourceTitle: signal.title.slice(0, 80),
      sourceUrl: signal.url
    };
  });

  return { contents, failedSignals: signals.slice(3) };
}

// ============================================================
// 辅助函数: 抓取网页 og:image
// ============================================================

async function fetchOgImage(url: string): Promise<string | undefined> {
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const html = response.data as string;

    // 尝试多种 og:image 标签格式
    const ogPatterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']og:image["']/i,
      /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']image["']/i
    ];

    for (const pattern of ogPatterns) {
      const match = html.match(pattern);
      if (match?.[1] && match[1].startsWith('http')) {
        return match[1];
      }
    }

    // Twitter card image 作为备选
    const twitterPattern = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i;
    const twitterMatch = html.match(twitterPattern);
    if (twitterMatch?.[1] && twitterMatch[1].startsWith('http')) {
      return twitterMatch[1];
    }

    return undefined;
  } catch {
    return undefined;
  }
}

// ============================================================
// Phase 5: 生成 10 条新闻英文汇总
// ============================================================

async function generateNewsSummaries(
  signals: UnifiedSignal[],
  count: number
): Promise<NewsSummary[]> {
  log.main('='.repeat(60));
  log.main(`Phase 3: 生成 ${count} 条新闻英文汇总`);
  log.main('='.repeat(60));

  const apiKey = process.env.LINKAI_API_KEY;
  const apiBase = process.env.LINKAI_API_BASE || 'https://api1.link-ai.cc';

  const topSignals = signals.slice(0, count);

  if (!apiKey) {
    log.main('使用规则生成备选摘要（API Key 未配置）');
    return topSignals.map((s, i) => ({
      index: i + 1,
      title: s.title,
      url: s.url,
      source: s.sourceName,
      publishedAt: s.publishedAt,
      summary: s.body ? s.body.slice(0, 200) : s.title,
      sentiment: s.sentiment,
      score: s.score
    }));
  }

  try {
    const summaries: NewsSummary[] = [];
    const batchSize = 3;

    for (let i = 0; i < topSignals.length; i += batchSize) {
      const batch = topSignals.slice(i, i + batchSize);

      // 并行获取 og:image 和摘要
      const results = await Promise.all(
        batch.map(async (signal) => {
          const [ogImageUrl, summary] = await Promise.all([
            fetchOgImage(signal.url),
            summarizeSingleNews(signal, apiKey, apiBase)
          ]);
          return { signal, ogImageUrl, summary };
        })
      );

      results.forEach(({ signal, ogImageUrl, summary }) => {
        summaries.push({
          index: summaries.length + 1,
          title: signal.title,
          url: signal.url,
          source: signal.sourceName,
          publishedAt: signal.publishedAt,
          summary,
          sentiment: signal.sentiment,
          score: signal.score,
          ogImageUrl
        });
      });

      if (i + batchSize < topSignals.length) {
        await sleep(2000);
      }
    }

    return summaries;
  } catch (err: any) {
    log.main(`生成摘要失败: ${err.message}，使用默认摘要`);
    return topSignals.map((s, i) => ({
      index: i + 1,
      title: s.title,
      url: s.url,
      source: s.sourceName,
      publishedAt: s.publishedAt,
      summary: s.body ? s.body.slice(0, 200) : s.title,
      sentiment: s.sentiment,
      score: s.score,
      ogImageUrl: undefined
    }));
  }
}

async function summarizeSingleNews(signal: UnifiedSignal, apiKey: string, apiBase: string): Promise<string> {
  const prompt = `You are a tech journalist. Write a concise English summary (2-3 sentences) of this AI news article. Focus on the key insight and why it matters.

Title: ${signal.title}
Source: ${signal.sourceName}
Content: ${(signal.body || signal.title).slice(0, 500)}

Rules:
- Write in English
- 2-3 sentences max
- Start with the most important finding
- Include why it matters for AI practitioners`;

  try {
    const response = await axios.post(
      `${apiBase}/v1/chat/completions`,
      {
        model: process.env.LINKAI_TEXT_MODEL || 'claude-opus-4-5-20251101',
        messages: [
          { role: 'system', content: 'You are a concise tech journalist.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 200
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        timeout: 30000
      }
    );

    const content = response.data.choices?.[0]?.message?.content?.trim();
    return content || signal.body?.slice(0, 200) || signal.title;
  } catch {
    return signal.body?.slice(0, 200) || signal.title;
  }
}

// ============================================================
// Phase 6: 生成图片（独立于文案）
// ============================================================

async function generateImagesForTweets(
  tweets: TweetContent[],
  apiKey: string,
  apiBase: string
): Promise<void> {
  if (!apiKey || !process.env.LINKAI_IMAGE_MODEL) {
    log.image('跳过图片生成：API Key 或图片模型未配置');
    return;
  }

  log.image('开始生成推文配图...');
  const imageModel = process.env.LINKAI_IMAGE_MODEL || 'gpt-image-2';

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    if (!tweet.imageUrl) {
      try {
        const imagePrompt = `Create a Twitter post image about this AI news topic:

Title: ${tweet.sourceTitle}

Style requirements:
- Salvador Dali style mixed with cyberpunk aesthetics
- Exaggerated caricature / Visual satire
- Surrealist satirical collage
- Vibrant neon colors with dramatic shadows
- Information density: chaotic but readable
- Must include 3-5 bold keywords ON the image (e.g., "AI REVOLUTION", "GAME CHANGER", "THE FUTURE IS NOW")
- Square format (1024x1024)
- High contrast for Twitter dark/light mode
- Viral, shareable, eye-catching design`;

        const response = await axios.post(
          `${apiBase}/v1/images/generations`,
          {
            model: imageModel,
            prompt: imagePrompt,
            n: 1,
            size: '1024x1024',
            response_format: 'url'
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`
            },
            timeout: 120000
          }
        );

        const imageData = response.data.data?.[0];
        if (imageData?.url) {
          tweet.imageUrl = imageData.url;
          log.image(`图 ${i + 1}/${tweets.length} 生成成功`);
        }
      } catch (err: any) {
        log.image(`图 ${i + 1}/${tweets.length} 生成失败: ${err.message}`);
      }

      await sleep(3000);
    }
  }
}

// ============================================================
// Phase 7: 生成最终报告 (Markdown)
// ============================================================

interface TweetContent {
  en: string;
  zh: string;
  imageUrl?: string;
  sourceTitle: string;
  sourceUrl: string;
}

interface NewsSummary {
  index: number;
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  summary: string;
  sentiment: string;
  score: number;
  ogImageUrl?: string;
}

function generateMarkdownReport(
  tweets: TweetContent[],
  summaries: NewsSummary[],
  args: CliArgs
): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  let report = '';
  report += '# AI 热点新闻推文报告\n';
  report += `**生成时间**: ${timeStr} (UTC+8)\n`;
  report += `**数据源**: ${args.sources.join(', ')}\n`;
  report += '\n---\n\n';

  // 推文文案区
  report += '## 推文文案 (2-3 条，每条中英双语 + 配图)\n\n';
  report += '> 直接复制使用，或挑选感兴趣的配图发布\n\n';

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    report += `### 推文 ${i + 1}\n\n`;
    report += '**英文版:**\n';
    report += '```\n';
    report += tweet.en + '\n';
    report += '```\n\n';
    report += '**中文版:**\n';
    report += '```\n';
    report += tweet.zh + '\n';
    report += '```\n\n';
    if (tweet.imageUrl) {
      report += `**配图**: ![Tweet ${i + 1}](${tweet.imageUrl})\n\n`;
    } else {
      report += '**配图**: 未生成（可使用原链接图片）\n\n';
    }
    report += `**来源**: ${tweet.sourceTitle}\n`;
    report += `**链接**: ${tweet.sourceUrl}\n`;
    report += '\n---\n\n';
  }

  // 新闻汇总区
  report += `## 英文新闻汇总 (${summaries.length} 条)\n\n`;
  report += '> 以下是最热门的 AI 新闻，可挑选感兴趣的单独发布纯文案推特\n\n';

  for (const item of summaries) {
    const date = item.publishedAt instanceof Date
      ? item.publishedAt.toLocaleDateString('en-US', { timeZone: 'Asia/Shanghai' })
      : String(item.publishedAt).split('T')[0];
    const sentimentEmoji = item.sentiment === 'positive' ? '🟢' : item.sentiment === 'negative' ? '🔴' : '🟡';
    const scoreStr = item.score > 0 ? `⭐ ${Math.round(item.score)}` : '';

    report += `### ${item.index}. ${item.title}\n\n`;
    report += `- **来源**: ${item.source} | **日期**: ${date} ${sentimentEmoji} ${scoreStr}\n`;
    report += `- **摘要**: ${item.summary}\n`;

    // 突出显示原始链接，方便截图
    report += `- **🔗 原始链接**: ${item.url}\n`;

    if (item.ogImageUrl) {
      report += `- **📸 素材图片**: ![${item.title}](${item.ogImageUrl})\n`;
      report += `  (素材图片链接: ${item.ogImageUrl})\n`;
    }

    report += '\n';
  }

  report += '---\n\n';
  report += '*由 OpportunityScanner 自动生成*\n';

  return report;
}

function generateTextReport(
  tweets: TweetContent[],
  summaries: NewsSummary[],
  args: CliArgs
): string {
  const now = new Date();
  const timeStr = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  let report = '';
  report += '=' .repeat(70) + '\n';
  report += 'AI 热点新闻推文报告\n';
  report += `生成时间: ${timeStr} (UTC+8)\n`;
  report += `数据源: ${args.sources.join(', ')}\n`;
  report += '='.repeat(70) + '\n\n';

  report += '【推文文案 - 每条含英文 + 中文双语】\n';
  report += '-'.repeat(70) + '\n\n';

  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    report += `【推文 ${i + 1}】\n`;
    report += `英文: ${tweet.en}\n`;
    report += `中文: ${tweet.zh}\n`;
    if (tweet.imageUrl) {
      report += `配图: ${tweet.imageUrl}\n`;
    }
    report += `来源: ${tweet.sourceTitle}\n`;
    report += `链接: ${tweet.sourceUrl}\n\n`;
  }

  report += '-'.repeat(70) + '\n';
  report += `【英文新闻汇总 - ${summaries.length} 条】\n`;
  report += '-'.repeat(70) + '\n\n';

  for (const item of summaries) {
    const date = item.publishedAt instanceof Date
      ? item.publishedAt.toLocaleDateString('en-US', { timeZone: 'Asia/Shanghai' })
      : String(item.publishedAt).split('T')[0];
    report += `${item.index}. [${item.source}] ${date}\n`;
    report += `   ${item.title}\n`;
    report += `   ${item.summary}\n`;
    report += `   原始链接: ${item.url}\n`;
    if (item.ogImageUrl) {
      report += `   素材图片: ${item.ogImageUrl}\n`;
    }
    report += '\n';
  }

  report += '-'.repeat(70) + '\n';
  report += '由 OpportunityScanner 自动生成\n';

  return report;
}

// ============================================================
// Phase 8: 保存报告
// ============================================================

async function saveReports(
  markdownReport: string,
  textReport: string,
  tweets: TweetContent[],
  summaries: NewsSummary[],
  args: CliArgs
): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const reportsDir = path.join(process.cwd(), 'reports');

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // 保存 Markdown 报告
  const mdPath = path.join(reportsDir, `ai-news-report-${dateStr}.md`);
  fs.writeFileSync(mdPath, markdownReport, 'utf-8');
  log.main(`Markdown 报告已保存: ${mdPath}`);

  // 保存纯文本报告
  const txtPath = path.join(reportsDir, `ai-news-report-${dateStr}.txt`);
  fs.writeFileSync(txtPath, textReport, 'utf-8');
  log.main(`文本报告已保存: ${txtPath}`);

  // 保存 JSON 数据（方便程序处理）
  const jsonPath = path.join(reportsDir, `ai-news-report-${dateStr}.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        args,
        tweets,
        summaries,
        stats: {
          tweetCount: tweets.length,
          summaryCount: summaries.length
        }
      },
      null,
      2
    ),
    'utf-8'
  );
  log.main(`JSON 数据已保存: ${jsonPath}`);

  // 下载推文配图
  for (let i = 0; i < tweets.length; i++) {
    const tweet = tweets[i];
    if (tweet.imageUrl && tweet.imageUrl.startsWith('http')) {
      try {
        const imageResponse = await axios.get(tweet.imageUrl, { responseType: 'arraybuffer' });
        const imagePath = path.join(reportsDir, `tweet-${i + 1}-${dateStr}.png`);
        fs.writeFileSync(imagePath, imageResponse.data);
        log.main(`推文配图 ${i + 1} 已保存: ${imagePath}`);
      } catch (err: any) {
        log.main(`推文配图 ${i + 1} 下载失败: ${err.message}`);
      }
    }
  }

  // 下载新闻素材图片
  for (const item of summaries) {
    if (item.ogImageUrl) {
      const safeName = item.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').slice(0, 30);
      const imagePath = path.join(reportsDir, `news-${item.index}-${safeName}.jpg`);
      try {
        const imageResponse = await axios.get(item.ogImageUrl, { responseType: 'arraybuffer' });
        fs.writeFileSync(imagePath, imageResponse.data);
        log.main(`新闻 ${item.index} 素材图片已保存: ${imagePath}`);
      } catch (err: any) {
        log.main(`新闻 ${item.index} 素材图片下载失败: ${err.message}`);
      }
      await sleep(1000);
    }
  }

  return mdPath;
}

// ============================================================
// 辅助函数
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatElapsed(startTime: number): string {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  const startTime = Date.now();
  const args = parseArgs();

  log.main('='.repeat(60));
  log.main('OpportunityScanner - AI 热点新闻推文生成器');
  log.main('='.repeat(60));
  log.main(`参数: maxTweets=${args.maxTweets}, maxNews=${args.maxNews}, sources=[${args.sources.join(', ')}], image=${args.image}`);

  try {
    // Phase 1: 采集
    const sources = await fetchAllSources(args.sources);

    // Phase 2: 合并去重
    const mergedSignals = mergeAndRank(sources.rss, sources.hn, sources.arxiv);

  if (mergedSignals.length === 0) {
    log.main('未采集到任何数据，退出');
    return;
  }

  log.main(`采集信号总数: ${mergedSignals.length}`);

  // Phase 3: 生成推文文案（AI 过滤 + 评分排序）
  const { contents: tweets } = await generateTweetContent(
    mergedSignals,
    args.maxTweets,
    args.image
  );

  // Phase 4: 生成新闻汇总（使用同样的 AI 过滤逻辑）
  const aiKeywords = [
    'AI', 'artificial intelligence', 'machine learning', 'LLM', 'GPT', 'Claude',
    'ChatGPT', 'OpenAI', 'Anthropic', 'Gemini', 'model', 'neural', 'deep learning',
    'diffusion', 'transformer', 'RAG', 'embedding', 'fine-tuning', 'inference',
    'agent', 'reasoning', 'multimodal', 'vision', 'hugging face', 'langchain',
    'vllm', 'ollama', 'stable diffusion', 'midjourney', 'dall-e', 'sora',
    'perplexity', 'mistral', 'grok', 'llama', 'phi', 'qwen',
    'kimi', 'doubao', 'copilot', 'cursor', 'claude code', 'devin',
    'automation', 'coding', 'programming', 'research', 'benchmark', 'SOTA',
    'model', 'training', 'dataset', 'alignment', 'safety', 'scaling'
  ];

  const isAIRelated = (s: UnifiedSignal): boolean => {
    const text = `${s.title} ${s.body} ${s.tags.join(' ')}`.toLowerCase();
    return aiKeywords.some(kw => text.includes(kw.toLowerCase()));
  };

  const aiSignals = mergedSignals.filter(isAIRelated);
  const nonAISignals = mergedSignals.filter(s => !isAIRelated(s));
  const sortedForSummaries = [...aiSignals, ...nonAISignals];
  log.main(`AI 相关新闻: ${aiSignals.length} / ${mergedSignals.length}`);

  const summaries = await generateNewsSummaries(sortedForSummaries, args.maxNews);

    // Phase 5: 生成报告
    log.main('='.repeat(60));
    log.main('Phase 4: 生成报告');
    log.main('='.repeat(60));

    const markdownReport = generateMarkdownReport(tweets, summaries, args);
    const textReport = generateTextReport(tweets, summaries, args);

    // Phase 6: 保存
    const reportPath = await saveReports(markdownReport, textReport, tweets, summaries, args);

    // 输出到控制台
    console.log('\n' + '='.repeat(60));
    console.log('推文文案预览:');
    console.log('='.repeat(60));
    for (let i = 0; i < tweets.length; i++) {
      const t = tweets[i];
      console.log(`\n[推文 ${i + 1}]`);
      console.log(`EN: ${t.en}`);
      console.log(`ZH: ${t.zh}`);
      if (t.imageUrl) console.log(`IMG: ${t.imageUrl}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('英文新闻汇总预览:');
    console.log('='.repeat(60));
    for (const s of summaries.slice(0, 5)) {
      console.log(`\n${s.index}. ${s.title}`);
      console.log(`   ${s.summary.slice(0, 100)}...`);
      console.log(`   ${s.url}`);
    }
    if (summaries.length > 5) {
      console.log(`\n... 还有 ${summaries.length - 5} 条，详见报告`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`报告已保存: ${reportPath}`);
    console.log(`总耗时: ${formatElapsed(startTime)}`);
    console.log('='.repeat(60));
    console.log('\n完成！请打开报告文件查看完整内容。');
  } catch (err: any) {
    console.error('\n[ERROR]', err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
