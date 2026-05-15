// Product Hunt 数据采集器
// 采集 Product Hunt 上的新产品，了解定位和热度

import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { RawSignal } from '../types.js';
import * as fs from 'fs';
import * as yaml from 'yaml';

interface PHEdge {
  node: PHProduct;
}

interface PHProduct {
  id: string;
  name: string;
  tagline: string;
  description: string;
  url: string;
  votesCount: number;
  commentsCount: number;
  topics?: {
    edges: Array<{ node: { name: string } }>;
  };
  featuredAt: string;
  maker?: Array<{
    id: string;
    name: string;
    url: string;
  }>;
}

interface PHConfig {
  ph_api_token?: string;
  keywords?: {
    producthunt_tags?: string[];
  };
}

export class ProductHuntRunner {
  private client: AxiosInstance;
  private config: PHConfig;

  constructor(config: PHConfig = {}) {
    this.config = config;
    this.client = axios.create({
      baseURL: 'https://api.producthunt.com/v2/api/graphql',
      headers: {
        'Authorization': `Bearer ${config.ph_api_token || process.env.PH_API_TOKEN || ''}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 30000
    });
  }

  /**
   * 获取最近的产品
   */
  async fetchRecentProducts(days: number = 7, limit: number = 50): Promise<RawSignal[]> {
    console.log(`\n🏆 [ProductHunt] 采集最近 ${days} 天的产品...`);

    const signals: RawSignal[] = [];
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    try {
      // 尝试 GraphQL API
      const query = `
        query GetPosts($postedAfter: DateTime, $first: Int) {
          posts(postedAfter: $postedAfter, first: $first, order: VOTES) {
            edges {
              node {
                id
                name
                tagline
                description
                url
                votesCount
                commentsCount
                topics {
                  edges {
                    node {
                      name
                    }
                  }
                }
                featuredAt
                maker {
                  id
                  name
                  url
                }
              }
            }
          }
        }
      `;

      const response = await this.client.post('', {
        query,
        variables: {
          postedAfter: startDate.toISOString(),
          first: limit
        }
      });

      const edges: PHEdge[] = response.data?.data?.posts?.edges || [];

      for (const edge of edges) {
        const product = edge.node;
        const topics = product.topics?.edges?.map((e: { node: { name: string } }) => e.node.name) || [];

        // 检查是否匹配关键词
        const matchedTags = this.matchKeywords(topics);
        if (matchedTags.length > 0 || product.votesCount > 100) {
          signals.push(this.productToSignal(product, matchedTags));
        }
      }

      console.log(`   ✅ 采集到 ${signals.length} 个 Product Hunt 信号`);

    } catch (error: any) {
      console.log(`   ⚠️ Product Hunt API 失败: ${error.message}`);
      console.log(`   尝试网页爬取...`);
      // 降级到网页爬取
      return this.fetchViaWebScraping(days);
    }

    return signals;
  }

  /**
   * 网页爬取降级方案
   */
  private async fetchViaWebScraping(days: number): Promise<RawSignal[]> {
    console.log(`   [ProductHunt] 使用网页爬取模式...`);

    const signals: RawSignal[] = [];
    const endDate = new Date();

    try {
      // 使用 Serper API 搜索 Product Hunt
      const serperClient = axios.create({
        baseURL: 'https://google.serper.dev/search',
        headers: {
          'X-API-KEY': process.env.SERPER_API_KEY || '',
          'Content-Type': 'application/json'
        },
        timeout: 20000
      });

      const searchQuery = `site:producthunt.com "${endDate.getFullYear()}" AI OR API OR developer OR tool`;

      const response = await serperClient.post('', { q: searchQuery, num: 20 });
      const items = response.data?.organic || [];

      for (const item of items) {
        if (item.link?.includes('producthunt.com/posts')) {
          const match = item.title.match(/^([^—]+?)\s*[-–]\s*(.+)/);
          signals.push({
            id: uuidv4(),
            source_type: 'product_hunt',
            source_url: item.link || '',
            source_title: match ? match[2] : item.title,
            source_date: new Date().toISOString().split('T')[0],
            raw_content: item.snippet || '',
            discovered_at: new Date().toISOString(),
            keywords_matched: this.extractKeywords(item.snippet || item.title)
          });
        }
      }

    } catch (error: any) {
      console.log(`   ❌ Product Hunt 采集失败: ${error.message}`);
    }

    return signals;
  }

  /**
   * 产品转信号
   */
  private productToSignal(product: PHProduct, matchedTags: string[]): RawSignal {
    return {
      id: uuidv4(),
      source_type: 'product_hunt',
      source_url: `https://www.producthunt.com/posts/${product.id}`,
      source_title: product.name,
      source_date: product.featuredAt?.split('T')[0] || new Date().toISOString().split('T')[0],
      raw_content: `${product.name}: ${product.tagline}\n${product.description || ''}\nVotes: ${product.votesCount}, Comments: ${product.commentsCount}`,
      discovered_at: new Date().toISOString(),
      keywords_matched: matchedTags
    };
  }

  /**
   * 匹配关键词
   */
  private matchKeywords(topics: string[]): string[] {
    const config = this.loadKeywords();
    const targetTags = config?.producthunt_tags || ['artificial-intelligence', 'developer-tools', 'api'];
    const matched: string[] = [];

    for (const topic of topics) {
      const normalizedTopic = topic.toLowerCase().replace(/\s+/g, '-');
      if (targetTags.some((t: string) => normalizedTopic.includes(t.toLowerCase()) || t.toLowerCase().includes(normalizedTopic))) {
        matched.push(topic);
      }
    }

    return matched;
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    const keywords = [
      'AI', 'API', 'LLM', 'gateway', 'agent', 'MCP', 'billing',
      'developer', 'tool', 'SaaS', 'open-source', 'GPT', 'OpenAI'
    ];

    return keywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
  }

  /**
   * 加载关键词配置
   */
  private loadKeywords(): any {
    try {
      const configPath = './keywords.yaml';
      if (fs.existsSync(configPath)) {
        return yaml.parse(fs.readFileSync(configPath, 'utf-8'));
      }
    } catch {}
    return {};
  }
}
