// Telegram 采集器
// 采集 Telegram 公开频道的真人讨论
// 无需 API Key，直接抓取 t.me/s/ 页面

import axios from 'axios';
import * as cheerio from 'cheerio';
import { v4 as uuidv4 } from 'uuid';
import type { RawSignal } from '../types.js';

interface TelegramConfig {
  channels?: string[];
  max_messages_per_channel?: number;
}

// Telegram 公开频道列表 - 开发者/创业相关
const DEFAULT_CHANNELS = [
  // AI & Developer Tools
  'ChatGPTNews',
  'AINews',
  't_me_ai_news',
  'languagetools',
  'openai',
  '的人工智能',

  // Programming
  'progbots',
  'programming',
  'python',
  'javascript',
  'typescript',
  'golang',
  'rust',

  // DevOps & Infrastructure
  'devops_china',
  'devops',
  'docker',
  'kubernetes',

  // Indie / SaaS
  'indiehackers',
  'saas',
  'buildinpublic',
  'madewithai',
  'micro_saas',

  // API & Tools
  'apigee',
  'postman',
];

export class TelegramRunner {
  private config: TelegramConfig;

  constructor(config: TelegramConfig = {}) {
    this.config = {
      channels: config.channels || DEFAULT_CHANNELS,
      max_messages_per_channel: config.max_messages_per_channel || 50
    };
  }

  /**
   * 采集指定频道的消息
   */
  async fetchChannelMessages(channelUsername: string): Promise<RawSignal[]> {
    console.log(`   💬 [Telegram] 采集 @${channelUsername}...`);

    const signals: RawSignal[] = [];

    try {
      const url = `https://t.me/s/${channelUsername}`;
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        }
      });

      const $ = cheerio.load(response.data);
      const messages: any[] = [];

      // 解析每条消息
      $('.tgme_widget_message').each((_, el) => {
        const $el = $(el);

        // 提取消息文本
        const text = $el.find('.tgme_widget_message_text').text().trim();
        if (!text || text.length < 10) return;

        // 提取时间
        const timeEl = $el.find('.tgme_widget_message_meta time');
        const datetime = timeEl.attr('datetime') || '';
        const date = datetime ? datetime.split('T')[0] : new Date().toISOString().split('T')[0];

        // 提取浏览量
        const viewsText = $el.find('.tgme_widget_message_views').text();
        const views = this.parseViews(viewsText);

        // 提取回复数
        const repliesText = $el.find('.tgme_widget_message_replies').text();
        const replies = parseInt(repliesText) || 0;

        // 提取转发来源
        const forwardedFrom = $el.find('.tgme_widget_message_forwarded_from').text().trim();

        messages.push({
          text,
          date,
          views,
          replies,
          forwardedFrom,
          channel: channelUsername
        });
      });

      // 转换为信号
      for (const msg of messages.slice(0, this.config.max_messages_per_channel)) {
        if (this.isRelevant(msg.text)) {
          signals.push(this.messageToSignal(msg));
        }
      }

      console.log(`   ✅ @${channelUsername}: ${signals.length} 条相关消息`);

    } catch (error: any) {
      console.log(`   ⚠️ @${channelUsername}: ${error.message}`);
    }

    return signals;
  }

  /**
   * 批量采集所有频道
   */
  async fetchAllChannels(): Promise<RawSignal[]> {
    console.log(`\n💬 [Telegram] 开始采集 ${this.config.channels?.length} 个频道...`);

    const allSignals: RawSignal[] = [];

    for (const channel of this.config.channels || []) {
      const signals = await this.fetchChannelMessages(channel);
      allSignals.push(...signals);

      // 避免请求过快
      await this.sleep(1000);
    }

    console.log(`   📊 共采集 ${allSignals.length} 条 Telegram 信号`);
    return allSignals;
  }

  /**
   * 按关键词搜索频道
   */
  async searchChannels(keywords: string[]): Promise<RawSignal[]> {
    console.log(`\n💬 [Telegram] 按关键词搜索...`);

    // 重点关键词频道
    const keywordChannels: Record<string, string[]> = {
      'api': ['apigee', 'postman', 'apifull', 'api_developers'],
      'billing': ['saas', 'indiehackers', 'micro_saas'],
      'llm': ['ChatGPTNews', 'AINews', 'openai', 'languagetools'],
      'agent': ['ChatGPTNews', 'AINews', 'openai'],
      'gateway': ['devops', 'devops_china', 'kubernetes'],
      'mcp': ['AINews', 'ChatGPTNews', 'openai'],
    };

    const allSignals: RawSignal[] = [];
    const searchedChannels = new Set<string>();

    for (const keyword of keywords) {
      const channels = keywordChannels[keyword.toLowerCase()] || [];
      for (const channel of channels) {
        if (!searchedChannels.has(channel)) {
          searchedChannels.add(channel);
          const signals = await this.fetchChannelMessages(channel);
          allSignals.push(...signals);
          await this.sleep(800);
        }
      }
    }

    console.log(`   📊 关键词搜索获取 ${allSignals.length} 条信号`);
    return allSignals;
  }

  /**
   * 消息转信号
   */
  private messageToSignal(msg: any): RawSignal {
    return {
      id: uuidv4(),
      source_type: 'telegram',
      source_url: `https://t.me/s/${msg.channel}`,
      source_title: msg.channel,
      source_date: msg.date,
      raw_content: msg.text,
      discovered_at: new Date().toISOString(),
      keywords_matched: this.extractKeywords(msg.text)
    };
  }

  /**
   * 检查消息是否相关
   */
  private isRelevant(text: string): boolean {
    const keywords = [
      'api', 'llm', 'gpt', 'openai', 'billing', 'payment',
      'agent', 'mcp', 'gateway', 'token', 'cost', 'price',
      'subscription', 'saas', 'tool', 'plugin', 'extension',
      'broken', 'bug', 'issue', 'problem', 'help', 'how to',
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
      'payment', 'subscription', 'token', 'cost', 'price',
      'agent', 'MCP', 'gateway', 'plugin', 'extension',
      'SaaS', 'MRR', 'revenue', 'startup', 'launch',
      'problem', 'issue', 'help', 'how to', 'tool'
    ];

    return keywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
  }

  /**
   * 解析浏览量
   */
  private parseViews(text: string): number {
    if (!text) return 0;
    const cleaned = text.replace(/[^\d.KMB]/g, '');

    if (cleaned.includes('K')) {
      return parseFloat(cleaned) * 1000;
    } else if (cleaned.includes('M')) {
      return parseFloat(cleaned) * 1000000;
    }

    return parseInt(cleaned) || 0;
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
