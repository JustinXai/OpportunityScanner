// GitHub 数据采集器
// 采集开源基础设施的真实热度

import axios, { AxiosInstance } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { RawSignal, SourceType } from '../types.js';
import * as fs from 'fs';
import * as yaml from 'yaml';

interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  description: string;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  topics: string[];
  pushed_at: string;
  created_at: string;
  owner: {
    login: string;
    avatar_url: string;
  };
}

interface GitHubConfig {
  github_token?: string;
  keywords?: {
    github_topics?: string[];
  };
}

export class GitHubRunner {
  private client: AxiosInstance;
  private config: GitHubConfig;

  constructor(config: GitHubConfig = {}) {
    this.config = config;
    // GitHub API token (可选，未提供时使用更低限流)
    const token = config.github_token || process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    this.client = axios.create({
      baseURL: 'https://api.github.com',
      headers,
      timeout: 30000
    });
  }

  /**
   * 按主题搜索仓库
   */
  async searchByTopics(topics: string[], maxPerTopic: number = 10): Promise<RawSignal[]> {
    console.log(`\n📦 [GitHub] 按主题搜索仓库...`);

    const signals: RawSignal[] = [];
    const config = this.loadKeywords();
    const targetTopics = topics.length > 0 ? topics : (config?.github_topics || [
      'openai-api', 'llm-gateway', 'ai-gateway', 'model-routing', 'mcp', 'agent-framework'
    ]);

    for (const topic of targetTopics.slice(0, 10)) {
      try {
        const response = await this.client.get('/search/repositories', {
          params: {
            q: `topic:${topic} pushed:>${this.getDateMonthsAgo(3)}`,
            sort: 'stars',
            order: 'desc',
            per_page: maxPerTopic
          }
        });

        const repos = response.data.items || [];

        for (const repo of repos) {
          if (repo.stargazers_count >= 50) {  // 至少50 stars
            signals.push(this.repoToSignal(repo, topic));
          }
        }

        console.log(`   📂 Topic "${topic}": ${repos.length} 个仓库`);

        // 避免 API 限流
        await this.sleep(1000);

      } catch (error: any) {
        if (error.response?.status === 403) {
          console.log(`   ⚠️ GitHub API 限流，等待 60 秒...`);
          await this.sleep(60000);
        } else {
          console.log(`   ⚠️ 搜索 "${topic}" 失败: ${error.message}`);
        }
      }
    }

    console.log(`   ✅ 采集到 ${signals.length} 个 GitHub 信号`);
    return signals;
  }

  /**
   * 按关键词搜索
   */
  async searchByKeywords(keywords: string[], maxResults: number = 20): Promise<RawSignal[]> {
    console.log(`\n📦 [GitHub] 按关键词搜索...`);

    const signals: RawSignal[] = [];

    for (const keyword of keywords.slice(0, 10)) {
      try {
        const response = await this.client.get('/search/repositories', {
          params: {
            q: `${keyword} pushed:>${this.getDateMonthsAgo(6)}`,
            sort: 'stars',
            order: 'desc',
            per_page: Math.min(maxResults, 10)
          }
        });

        const repos = response.data.items || [];

        for (const repo of repos) {
          if (repo.stargazers_count >= 100) {
            signals.push(this.repoToSignal(repo, keyword));
          }
        }

        await this.sleep(1000);

      } catch (error: any) {
        console.log(`   ⚠️ 搜索 "${keyword}" 失败: ${error.message}`);
      }
    }

    console.log(`   ✅ 采集到 ${signals.length} 个 GitHub 信号`);
    return signals;
  }

  /**
   * 获取活跃仓库（近期有更新）
   */
  async fetchActiveRepos(minStars: number = 500): Promise<RawSignal[]> {
    console.log(`\n📦 [GitHub] 获取活跃仓库 (${minStars}+ stars)...`);

    const signals: RawSignal[] = [];

    try {
      // 搜索过去30天有更新的高星仓库
      const response = await this.client.get('/search/repositories', {
        params: {
          q: `pushed:>${this.getDateDaysAgo(30)} stars:>${minStars}`,
          sort: 'updated',
          order: 'desc',
          per_page: 30
        }
      });

      const repos = response.data.items || [];

      for (const repo of repos) {
        signals.push(this.repoToSignal(repo, 'active'));
      }

    } catch (error: any) {
      console.log(`   ❌ 获取活跃仓库失败: ${error.message}`);
    }

    console.log(`   ✅ 获取到 ${signals.length} 个活跃仓库`);
    return signals;
  }

  /**
   * 仓库转信号
   */
  private repoToSignal(repo: GitHubRepo, matchedTopic: string): RawSignal {
    return {
      id: uuidv4(),
      source_type: 'github',
      source_url: repo.html_url,
      source_title: repo.name,
      source_date: repo.pushed_at?.split('T')[0] || repo.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
      raw_content: `${repo.name}: ${repo.description || 'No description'}\nStars: ${repo.stargazers_count}, Forks: ${repo.forks_count}, Issues: ${repo.open_issues_count}\nTopics: ${repo.topics?.join(', ') || 'None'}\nLast push: ${repo.pushed_at}`,
      discovered_at: new Date().toISOString(),
      keywords_matched: [matchedTopic, ...(repo.topics || [])]
    };
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

  /**
   * 获取 N 个月前的日期
   */
  private getDateMonthsAgo(months: number): string {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    return date.toISOString().split('T')[0];
  }

  /**
   * 获取 N 天前的日期
   */
  private getDateDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
