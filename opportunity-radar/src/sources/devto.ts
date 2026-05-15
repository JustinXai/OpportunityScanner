// DEV.to 采集器
// 采集开发者技术博客和讨论
// 官方免费 API，无需 Key

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { RawSignal } from '../types.js';

interface DevToConfig {
  tags?: string[];
  max_articles?: number;
}

// 重点标签
const DEFAULT_TAGS = [
  'javascript', 'typescript', 'python', 'rust', 'golang',
  'react', 'vue', 'nextjs', 'deno', 'bun',
  'api', 'graphql', 'rest', 'webdev',
  'opensource', 'devops', 'cloud', 'aws',
  'career', 'productivity', 'ai', 'chatgpt',
  'beginners', 'tutorial', 'discuss'
];

export class DevToRunner {
  private config: DevToConfig;
  private baseUrl = 'https://dev.to/api';

  constructor(config: DevToConfig = {}) {
    this.config = {
      tags: config.tags || DEFAULT_TAGS,
      max_articles: config.max_articles || 30
    };
  }

  /**
   * 按标签获取文章
   */
  async fetchByTag(tag: string): Promise<RawSignal[]> {
    console.log(`   📝 [DEV.to] 采集 #${tag}...`);

    const signals: RawSignal[] = [];

    try {
      const response = await axios.get(`${this.baseUrl}/articles`, {
        params: {
          tag,
          per_page: this.config.max_articles,
          top: 7 // 最近7天的热门
        },
        timeout: 15000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'OpportunityScanner/2.0'
        }
      });

      const articles = response.data || [];

      for (const article of articles) {
        const signal = this.articleToSignal(article, tag);
        if (signal) {
          signals.push(signal);
        }
      }

      console.log(`   ✅ #${tag}: ${signals.length} 篇文章`);

    } catch (error: any) {
      console.log(`   ⚠️ #${tag}: ${error.message}`);
    }

    return signals;
  }

  /**
   * 获取最新文章
   */
  async fetchLatest(perPage: number = 30): Promise<RawSignal[]> {
    console.log(`\n📝 [DEV.to] 采集最新文章...`);

    const signals: RawSignal[] = [];

    try {
      const response = await axios.get(`${this.baseUrl}/articles`, {
        params: {
          per_page: perPage,
          state: 'fresh'
        },
        timeout: 15000
      });

      const articles = response.data || [];

      for (const article of articles) {
        const signal = this.articleToSignal(article, 'fresh');
        if (signal) {
          signals.push(signal);
        }
      }

    } catch (error: any) {
      console.log(`   ❌ 获取最新文章失败: ${error.message}`);
    }

    console.log(`   📊 共采集 ${signals.length} 篇文章`);
    return signals;
  }

  /**
   * 搜索文章
   */
  async search(query: string): Promise<RawSignal[]> {
    console.log(`   📝 [DEV.to] 搜索 "${query}"...`);

    const signals: RawSignal[] = [];

    try {
      const response = await axios.get(`${this.baseUrl}/articles`, {
        params: {
          per_page: 20,
          tag: query
        },
        timeout: 15000
      });

      const articles = response.data || [];

      for (const article of articles) {
        const signal = this.articleToSignal(article, query);
        if (signal) {
          signals.push(signal);
        }
      }

    } catch (error: any) {
      console.log(`   ⚠️ 搜索失败: ${error.message}`);
    }

    return signals;
  }

  /**
   * 批量采集所有标签
   */
  async fetchAllTags(): Promise<RawSignal[]> {
    console.log(`\n📝 [DEV.to] 开始采集 ${this.config.tags?.length} 个标签...`);

    const allSignals: RawSignal[] = [];

    // 重点标签优先
    const priorityTags = ['api', 'devops', 'ai', 'chatgpt', 'discuss', 'opensource'];
    const otherTags = (this.config.tags || []).filter(t => !priorityTags.includes(t));

    // 先采重点标签
    for (const tag of priorityTags) {
      const signals = await this.fetchByTag(tag);
      allSignals.push(...signals);
      await this.sleep(500);
    }

    // 再采其他标签（限制数量）
    for (const tag of otherTags.slice(0, 5)) {
      const signals = await this.fetchByTag(tag);
      allSignals.push(...signals);
      await this.sleep(500);
    }

    console.log(`   📊 共采集 ${allSignals.length} 条 DEV.to 信号`);
    return allSignals;
  }

  /**
   * 文章转信号
   */
  private articleToSignal(article: any, matchedTag: string): RawSignal | null {
    const title = article.title || '';
    const description = article.description || '';
    const text = article.body_markdown || '';
    const content = `${title}\n\n${description}\n\n${text}`.substring(0, 2000);

    // 检查是否相关
    if (!this.isRelevant(content)) return null;

    return {
      id: uuidv4(),
      source_type: 'dev_to',
      source_url: article.url || `https://dev.to/article/${article.id}`,
      source_title: title,
      source_date: article.published_at?.split('T')[0] || new Date().toISOString().split('T')[0],
      raw_content: content,
      discovered_at: new Date().toISOString(),
      keywords_matched: [
        matchedTag,
        ...(article.tag_list || []),
        ...this.extractKeywords(content)
      ]
    };
  }

  /**
   * 检查是否相关
   */
  private isRelevant(text: string): boolean {
    const keywords = [
      'api', 'llm', 'gpt', 'openai', 'billing', 'payment',
      'agent', 'mcp', 'gateway', 'token', 'cost', 'saas',
      'tool', 'plugin', 'extension', 'library', 'framework',
      'problem', 'issue', 'help', 'tutorial', 'how to',
      'mrr', 'revenue', 'startup', 'launch', 'product'
    ];

    const lower = text.toLowerCase();
    return keywords.some(k => lower.includes(k));
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    const keywords = [
      'OpenAI', 'API', 'LLM', 'GPT', 'Claude', 'billing',
      'payment', 'subscription', 'token', 'cost', 'SaaS',
      'agent', 'MCP', 'gateway', 'plugin', 'extension',
      'MRR', 'revenue', 'startup', 'launch'
    ];

    return keywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
