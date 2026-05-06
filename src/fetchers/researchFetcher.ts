// src/fetchers/researchFetcher.ts
// AI 研究论文 & 模型发布采集器
//
// 数据源:
// - arXiv cs.AI/cs.LG/cs.CL 分类: https://export.arxiv.org/api/query
// - HuggingFace Daily Papers: https://huggingface.co/api/daily_papers
//
// 优点: 无需 API Key，第一时间获取前沿研究/模型发布
// 缺点: 内容偏学术，需要 LLM 提炼才能生成社交媒体文案

import axios from 'axios';
import type { ResearchItem } from '../types.js';

// ============================================================
// 配置
// ============================================================

export interface ResearchFetcherConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** arXiv 分类 */
  arxivCategories?: string[];
  /** arXiv 最大结果数 */
  arxivMaxResults?: number;
  /** 时间范围 (天数) */
  daysBack?: number;
  /** 是否包含 HuggingFace papers */
  includeHuggingFace?: boolean;
  /** 请求超时 */
  timeout?: number;
}

const DEFAULT_CONFIG: Required<ResearchFetcherConfig> = {
  enabled: true,
  arxivCategories: ['cs.AI', 'cs.LG', 'cs.CL'],
  arxivMaxResults: 30,
  daysBack: 7,
  includeHuggingFace: true,
  timeout: 30000
};

// ============================================================
// 主采集器
// ============================================================

export class ResearchFetcher {
  private config: Required<ResearchFetcherConfig>;
  private logger: (msg: string) => void;

  constructor(
    config: ResearchFetcherConfig = {},
    logger: (msg: string) => void = console.log
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * 抓取所有研究内容
   */
  async fetchAll(): Promise<ResearchItem[]> {
    if (!this.config.enabled) {
      this.logger('[ResearchFetcher] 模块未启用，跳过');
      return [];
    }

    this.logger('[ResearchFetcher] 开始采集研究论文和模型发布...');

    const results: ResearchItem[] = [];

    // 并行: arXiv + HuggingFace
    const tasks: Promise<ResearchItem[]>[] = [];

    // arXiv
    tasks.push(this.fetchArxiv());

    // HuggingFace
    if (this.config.includeHuggingFace) {
      tasks.push(this.fetchHuggingFace());
    }

    const settled = await Promise.allSettled(tasks);

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        results.push(...result.value);
        this.logger(`[ResearchFetcher] 来源 ${i === 0 ? 'arXiv' : 'HuggingFace'}: +${result.value.length} 条`);
      } else {
        this.logger(`[ResearchFetcher] 来源 ${i === 0 ? 'arXiv' : 'HuggingFace'} 失败: ${result.reason?.message}`);
      }
    }

    this.logger(`[ResearchFetcher] 共获取 ${results.length} 条研究内容`);
    return results;
  }

  // ============================================================
  // arXiv 采集
  // ============================================================

  private async fetchArxiv(): Promise<ResearchItem[]> {
    const sinceDate = new Date(Date.now() - this.config.daysBack * 24 * 60 * 60 * 1000);
    const categories = this.config.arxivCategories.join(' OR ');

    // 搜索查询: 分类 + 时间
    const query = `cat:(${categories}) AND submittedDate:[${this.formatArxivDate(sinceDate)} TO NOW]`;

    const url = 'https://export.arxiv.org/api/query';
    const params = new URLSearchParams({
      search_query: query,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      max_results: this.config.arxivMaxResults.toString()
    });

    this.logger(`[ResearchFetcher] arXiv: 抓取 ${this.config.arxivCategories.join(', ')}`);

    const response = await axios.get(`${url}?${params}`, {
      timeout: this.config.timeout,
      headers: {
        'User-Agent': 'OpportunityScanner/1.0 (Research Fetcher)',
        Accept: 'application/atom+xml, application/xml, text/xml'
      }
    });

    return this.parseArxivAtom(response.data as string);
  }

  private parseArxivAtom(xml: string): ResearchItem[] {
    const items: ResearchItem[] = [];

    // 匹配 <entry> 标签
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const entry = match[1];

      const title = this.extractArxivTag(entry, 'title');
      const summary = this.extractArxivTag(entry, 'summary');
      const authors = this.extractArxivAuthors(entry);
      const published = this.extractArxivTag(entry, 'published');
      const updated = this.extractArxivTag(entry, 'updated');
      const id = this.extractArxivTag(entry, 'id');
      const doi = this.extractArxivTag(entry, 'arxiv:doi');
      const primaryCategory = this.extractArxivTag(entry, 'arxiv:primary_category');

      // 提取 PDF 链接和 GitHub 链接
      const pdfLink = this.extractLink(entry, 'alternate', 'application/pdf') ||
        id?.replace('/abs/', '/pdf/') + '.pdf';
      const githubLink = this.extractRelatedLink(entry, 'application/x-bibtex');

      // 提取关键词
      const keywords = this.extractCategories(entry);

      // 评分（基于引用数等）
      const engagementScore = this.estimateArxivScore(title, summary);

      if (!title || !id) continue;

      items.push({
        id: this.hashString(id),
        title: title.replace(/\n/g, ' ').trim(),
        summary: summary.replace(/\n/g, ' ').trim().slice(0, 500),
        authors: authors.slice(0, 5), // 最多5个作者
        publishedAt: published ? new Date(published) : new Date(),
        updatedAt: updated ? new Date(updated) : undefined,
        arxivId: id.split('/').pop() || '',
        doi: doi || undefined,
        pdfUrl: pdfLink || undefined,
        githubUrl: githubLink || undefined,
        categories: keywords,
        primaryCategory: primaryCategory || '',
        engagementScore,
        paperAbstract: summary.replace(/\n/g, ' ').trim(),
        relevanceTags: this.extractRelevanceTags(title + ' ' + summary)
      });
    }

    return items;
  }

  private extractArxivTag(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    return match?.[1]?.trim() || '';
  }

  private extractArxivAuthors(xml: string): string[] {
    const authors: string[] = [];
    const regex = /<name>([^<]+)<\/name>/gi;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      authors.push(match[1].trim());
    }
    return authors;
  }

  private extractLink(xml: string, rel: string, type: string): string {
    const regex = new RegExp(`<link[^>]*rel=["']${rel}["'][^>]*href=["']([^"']+)["']`, 'i');
    let match = xml.match(regex);
    if (match?.[1]) return match[1];

    const typeRegex = new RegExp(`<link[^>]*type=["']${type}["'][^>]*href=["']([^"']+)["']`, 'i');
    match = xml.match(typeRegex);
    return match?.[1] || '';
  }

  private extractRelatedLink(xml: string, _type: string): string | undefined {
    // 查找 related links 中的 GitHub 链接
    const links: string[] = [];
    const regex = /<link[^>]*href=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      const href = match[1];
      if (href.includes('github.com')) {
        links.push(href);
      }
    }
    return links[0];
  }

  private extractCategories(xml: string): string[] {
    const cats: string[] = [];
    const regex = /<category[^>]*term=["']([^"']+)["']/gi;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      cats.push(match[1]);
    }
    return cats.slice(0, 5);
  }

  private extractRelevanceTags(text: string): string[] {
    const lower = text.toLowerCase();
    const tags: string[] = [];

    const tagMap: Record<string, string[]> = {
      'LLM/Large Language Model': ['large language model', 'LLM', 'language model', 'GPT', 'BERT', 'transformer'],
      'Vision/Image': ['vision', 'image generation', 'diffusion', 'stable diffusion', 'DALL-E', 'midjourney'],
      'RL/Reinforcement Learning': ['reinforcement learning', 'RL', 'reward', 'policy', 'agent'],
      'RAG/Retrieval': ['retrieval', 'RAG', 'vector', 'embedding', 'search'],
      'Fine-tuning': ['fine-tuning', 'fine-tune', 'LoRA', 'PEFT', 'adapt'],
      'Multimodal': ['multimodal', 'vision language', 'VLM', 'GPT-4V'],
      'Code/Programming': ['code generation', 'programming', 'software', 'GitHub Copilot'],
      'Safety/Alignment': ['safety', 'alignment', 'RLHF', 'constitutional AI', 'honesty'],
      'Benchmark/Evaluation': ['benchmark', 'evaluation', 'leaderboard', 'MMLU', 'HELM'],
      'Efficiency': ['efficiency', 'quantization', 'pruning', 'distillation', 'optimization']
    };

    for (const [tag, keywords] of Object.entries(tagMap)) {
      if (keywords.some(kw => lower.includes(kw))) {
        tags.push(tag);
      }
    }

    return tags.slice(0, 5);
  }

  private estimateArxivScore(title: string, summary: string): number {
    let score = 0;
    const text = (title + ' ' + summary).toLowerCase();

    // 高价值关键词加分
    const highValue = ['state-of-the-art', 'SOTA', 'best', 'new', 'novel', 'improve',
      'outperform', 'achieve', 'breakthrough', 'significant'];
    const lowValue = ['survey', 'review', 'preliminary', 'exploratory', 'pilot'];

    for (const kw of highValue) {
      if (text.includes(kw)) score += 5;
    }
    for (const kw of lowValue) {
      if (text.includes(kw)) score -= 3;
    }

    // arXiv ID 越新分数略高
    score += Math.max(0, 30 - text.length / 10); // 短摘要略加分

    return Math.max(0, Math.min(100, score));
  }

  private formatArxivDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  // ============================================================
  // HuggingFace Daily Papers 采集
  // ============================================================

  private async fetchHuggingFace(): Promise<ResearchItem[]> {
    this.logger('[ResearchFetcher] HuggingFace: 抓取 daily papers...');

    const response = await axios.get('https://huggingface.co/api/daily_papers', {
      timeout: this.config.timeout,
      headers: {
        'User-Agent': 'OpportunityScanner/1.0 (Research Fetcher)'
      }
    });

    const papers: HFSearchPaper[] = response.data;

    return papers.slice(0, 20).map(paper => ({
      id: this.hashString(paper.id || paper.title),
      title: paper.title,
      summary: paper.summary || paper.title,
      authors: paper.authors?.slice(0, 5).map((a: string) => a) || [],
      publishedAt: paper.published ? new Date(paper.published) : new Date(),
      arxivId: paper.arxiv?.id || paper.id?.split('/').pop() || '',
      pdfUrl: paper.arxiv?.pdf_url || undefined,
      githubUrl: paper.github_repo ? `https://github.com/${paper.github_repo}` : undefined,
      categories: paper.tags || [],
      primaryCategory: 'HuggingFace',
      engagementScore: (paper.votes || 0) + (paper.comments || 0) * 2,
      paperAbstract: paper.summary || paper.title,
      relevanceTags: this.extractRelevanceTags(paper.title + ' ' + (paper.summary || ''))
    }));
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

// ============================================================
// HuggingFace API 类型
// ============================================================

interface HFSearchPaper {
  id: string;
  title: string;
  summary?: string;
  authors?: string[];
  published?: string;
  arxiv?: {
    id: string;
    pdf_url?: string;
  };
  github_repo?: string;
  tags?: string[];
  votes?: number;
  comments?: number;
}

// ============================================================
// 便捷函数
// ============================================================

export function createResearchFetcher(
  config?: ResearchFetcherConfig,
  logger?: (msg: string) => void
): ResearchFetcher {
  return new ResearchFetcher(config, logger);
}

export async function fetchResearchContent(
  config?: ResearchFetcherConfig,
  logger?: (msg: string) => void
): Promise<ResearchItem[]> {
  const fetcher = new ResearchFetcher(config, logger);
  return fetcher.fetchAll();
}
