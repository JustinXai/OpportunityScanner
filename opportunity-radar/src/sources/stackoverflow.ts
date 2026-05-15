// Stack Overflow 采集器
// 采集技术问答和真实问题
// Stack Exchange API 免费

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { RawSignal } from '../types.js';

interface StackOverflowConfig {
  tags?: string[];
  max_questions?: number;
}

// 重点标签
const DEFAULT_TAGS = [
  'javascript', 'python', 'typescript', 'react', 'node.js',
  'api', 'rest', 'graphql', 'http', 'authentication',
  'json', 'database', 'postgresql', 'mongodb', 'mysql',
  'docker', 'kubernetes', 'aws', 'azure', 'google-cloud',
  'git', 'github', 'ci-cd', 'devops',
  'openai', 'chatgpt', 'llm', 'nlp', 'ai',
  'security', 'oauth', 'api-key', 'authentication',
  'performance', 'caching', 'redis', 'microservices'
];

export class StackOverflowRunner {
  private config: StackOverflowConfig;
  private baseUrl = 'https://api.stackexchange.com/2.3';

  constructor(config: StackOverflowConfig = {}) {
    this.config = {
      tags: config.tags || DEFAULT_TAGS,
      max_questions: config.max_questions || 30
    };
  }

  /**
   * 按标签获取问题
   */
  async fetchByTag(tag: string): Promise<RawSignal[]> {
    console.log(`   🔧 [StackOverflow] 采集 [${tag}]...`);

    const signals: RawSignal[] = [];

    try {
      const response = await axios.get(`${this.baseUrl}/questions`, {
        params: {
          order: 'desc',
          sort: 'activity',
          tagged: tag,
          site: 'stackoverflow',
          pagesize: this.config.max_questions,
          filter: 'withbody' // 包含正文
        },
        timeout: 15000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'OpportunityScanner/2.0 (contact@opportunity-scanner.com)'
        }
      });

      const items = response.data?.items || [];

      for (const question of items) {
        const signal = this.questionToSignal(question, tag);
        if (signal) {
          signals.push(signal);
        }
      }

      console.log(`   ✅ [${tag}]: ${signals.length} 个问题`);

    } catch (error: any) {
      console.log(`   ⚠️ [${tag}]: ${error.message}`);
    }

    return signals;
  }

  /**
   * 搜索问题
   */
  async search(query: string): Promise<RawSignal[]> {
    console.log(`   🔧 [StackOverflow] 搜索 "${query}"...`);

    const signals: RawSignal[] = [];

    try {
      const response = await axios.get(`${this.baseUrl}/search/advanced`, {
        params: {
          order: 'desc',
          sort: 'relevance',
          q: query,
          site: 'stackoverflow',
          pagesize: 30,
          filter: 'withbody'
        },
        timeout: 15000
      });

      const items = response.data?.items || [];

      for (const question of items) {
        const signal = this.questionToSignal(question, query);
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
   * 获取热门问题（按浏览量）
   */
  async fetchHotQuestions(limit: number = 30): Promise<RawSignal[]> {
    console.log(`\n🔧 [StackOverflow] 获取热门问题...`);

    const signals: RawSignal[] = [];

    try {
      const response = await axios.get(`${this.baseUrl}/questions`, {
        params: {
          order: 'desc',
          sort: 'votes',
          site: 'stackoverflow',
          pagesize: limit,
          filter: 'withbody'
        },
        timeout: 15000
      });

      const items = response.data?.items || [];

      for (const question of items) {
        const signal = this.questionToSignal(question, 'hot');
        if (signal) {
          signals.push(signal);
        }
      }

    } catch (error: any) {
      console.log(`   ❌ 获取热门问题失败: ${error.message}`);
    }

    console.log(`   📊 共采集 ${signals.length} 个问题`);
    return signals;
  }

  /**
   * 批量采集所有标签
   */
  async fetchAllTags(): Promise<RawSignal[]> {
    console.log(`\n🔧 [StackOverflow] 开始采集 ${this.config.tags?.length} 个标签...`);

    const allSignals: RawSignal[] = [];

    // 重点标签优先
    const priorityTags = ['api', 'openai', 'llm', 'chatgpt', 'rest', 'authentication'];
    const otherTags = (this.config.tags || []).filter(t => !priorityTags.includes(t));

    // 先采重点标签
    for (const tag of priorityTags) {
      const signals = await this.fetchByTag(tag);
      allSignals.push(...signals);
      await this.sleep(1000);
    }

    // 再采其他标签
    for (const tag of otherTags.slice(0, 8)) {
      const signals = await this.fetchByTag(tag);
      allSignals.push(...signals);
      await this.sleep(800);
    }

    console.log(`   📊 共采集 ${allSignals.length} 条 StackOverflow 信号`);
    return allSignals;
  }

  /**
   * 问题转信号
   */
  private questionToSignal(question: any, matchedTag: string): RawSignal | null {
    const title = question.title || '';
    const body = question.body || '';
    const content = `${title}\n\n${body}`.substring(0, 2000);

    // 检查是否相关
    if (!this.isRelevant(content)) return null;

    // 提取标签
    const tags = question.tags || [];

    // 提取采纳答案（如果有）
    let answerPreview = '';
    if (question.accepted_answer_id) {
      answerPreview = '\n\n[已采纳答案存在]';
    }

    return {
      id: uuidv4(),
      source_type: 'stack_overflow',
      source_url: question.link || `https://stackoverflow.com/q/${question.question_id}`,
      source_title: title,
      source_date: new Date((question.creation_date || 0) * 1000).toISOString().split('T')[0],
      raw_content: content + answerPreview,
      discovered_at: new Date().toISOString(),
      keywords_matched: [
        matchedTag,
        ...tags,
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
      'problem', 'issue', 'error', 'how to', 'help',
      'authentication', 'oauth', 'rate limit', 'quota',
      'webhook', 'streaming', 'timeout', 'performance'
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
      'payment', 'token', 'cost', 'gateway', 'proxy',
      'authentication', 'OAuth', 'API key', 'rate limit',
      'webhook', 'streaming', 'timeout', 'SaaS'
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
