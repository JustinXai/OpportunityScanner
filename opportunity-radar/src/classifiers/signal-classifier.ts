// LLM 分类器
// 使用 DeepSeek 分析原始信号，输出 OpportunitySignal

import axios from 'axios';
import type { RawSignal, ClassificationResult, OpportunitySignal, SignalLevel, Decision } from '../types.js';

const CLASSIFIER_PROMPT = `你是一个创业机会侦察员，不写行业趋势报告。

请分析下面这条公开信号，输出 JSON。

要求：
1. 不要夸大。
2. 区分事实、推断、猜测。
3. 只记录可验证公开信息。
4. 如果没有付费证据，money_signal_level 不得超过 2。
5. 如果和 RutaAPI/API Doctor 没有协同，fit_with_rutaapi 不得超过 2；
   - 0 = 完全无关
   - 1 = 只是 AI 大类相关
   - 2 = 同为开发者工具
   - 3 = 可写内容蹭流量
   - 4 = 可变成 API Doctor 功能
   - 5 = 可直接增强 RutaAPI 主线
6. 如果只是泛 AI 工具，默认 decision=WATCH 或 IGNORE。
7. 只有满足"高 fit + 高痛点 + 可 7 天验证"的机会，才能 decision=BUILD 或 MERGE_INTO_CURRENT。

输入：
{raw_item}

输出 JSON：
{
  "company_or_product": "",
  "one_line_pitch": "",
  "source_date": "",
  "fact_summary": "",
  "money_signal": "",
  "money_signal_level": 0,
  "pain_signal": "",
  "pain_signal_level": 0,
  "infra_signal": "",
  "distribution_signal": "",
  "trust_signal": "",
  "hidden_demand": "",
  "likely_buyer": "",
  "fit_with_rutaapi": 0,
  "fit_with_api_doctor": 0,
  "solo_founder_feasibility": 0,
  "compliance_risk": 0,
  "distraction_risk": 0,
  "radar_score": 0,
  "decision": "IGNORE|WATCH|PROBE|BUILD|MERGE_INTO_CURRENT",
  "next_action": ""
}`;

interface ClassifierConfig {
  api_key?: string;
  model?: string;
  max_concurrency?: number;
}

export class SignalClassifier {
  private apiKey: string;
  private model: string;
  private maxConcurrency: number;

  constructor(config: ClassifierConfig = {}) {
    this.apiKey = config.api_key || process.env.DEEPSEEK_API_KEY || '';
    this.model = config.model || 'deepseek-chat';
    this.maxConcurrency = config.max_concurrency || 3;
  }

  /**
   * 批量分类信号
   */
  async classify(signals: RawSignal[]): Promise<OpportunitySignal[]> {
    console.log(`\n🧠 [Classifier] 开始分类 ${signals.length} 条信号...`);

    const results: OpportunitySignal[] = [];
    const batches = this.chunkArray(signals, this.maxConcurrency);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`   📦 批次 ${i + 1}/${batches.length} (${batch.length} 条)`);

      const batchResults = await Promise.all(
        batch.map(signal => this.classifySingle(signal))
      );

      for (const result of batchResults) {
        if (result) {
          results.push(result);
        }
      }

      // 批次间延迟
      if (i < batches.length - 1) {
        await this.sleep(2000);
      }
    }

    console.log(`   ✅ 成功分类 ${results.length} 条信号`);
    return results;
  }

  /**
   * 单条分类
   */
  async classifySingle(raw: RawSignal): Promise<OpportunitySignal | null> {
    const startTime = Date.now();

    try {
      const client = axios.create({
        baseURL: 'https://api.deepseek.com/v1',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      });

      const input = `来源: ${raw.source_type}
标题: ${raw.source_title}
日期: ${raw.source_date}
内容: ${raw.raw_content.substring(0, 1000)}
匹配关键词: ${raw.keywords_matched.join(', ')}
链接: ${raw.source_url}`;

      const response = await client.post('/chat/completions', {
        model: this.model,
        messages: [
          { role: 'system', content: '你是一个创业机会侦察员。分析信号时保持客观，只输出 JSON，不要其他内容。' },
          { role: 'user', content: CLASSIFIER_PROMPT.replace('{raw_item}', input) }
        ],
        temperature: 0.3,
        max_tokens: 1500
      });

      const content = response.data.choices[0].message.content;
      const result = this.parseJson(content);

      if (!result) {
        console.log(`   ⚠️ 解析失败: ${raw.source_title.substring(0, 30)}...`);
        return null;
      }

      // 转换为 OpportunitySignal
      return this.toOpportunitySignal(raw, result);

    } catch (error: any) {
      console.log(`   ❌ 分类失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 解析 JSON
   */
  private parseJson(content: string): ClassificationResult | null {
    try {
      // 尝试提取 JSON
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return null;

      const data = JSON.parse(match[0]);

      // 验证必填字段
      if (!data.decision || !['IGNORE', 'WATCH', 'PROBE', 'BUILD', 'MERGE_INTO_CURRENT'].includes(data.decision)) {
        data.decision = 'WATCH';
      }

      // 确保数值在范围内
      data.money_signal_level = this.clamp(data.money_signal_level || 0, 0, 5);
      data.pain_signal_level = this.clamp(data.pain_signal_level || 0, 0, 5);
      data.fit_with_rutaapi = this.clamp(data.fit_with_rutaapi || 0, 0, 5);
      data.fit_with_api_doctor = this.clamp(data.fit_with_api_doctor || 0, 0, 5);
      data.solo_founder_feasibility = this.clamp(data.solo_founder_feasibility || 0, 0, 5);
      data.compliance_risk = this.clamp(data.compliance_risk || 0, 0, 5);
      data.distraction_risk = this.clamp(data.distraction_risk || 0, 0, 5);
      data.radar_score = Math.max(0, Math.min(100, data.radar_score || 0));

      return data as ClassificationResult;

    } catch {
      return null;
    }
  }

  /**
   * 转换为 OpportunitySignal
   */
  private toOpportunitySignal(raw: RawSignal, result: ClassificationResult): OpportunitySignal {
    return {
      id: raw.id,
      discovered_at: raw.discovered_at,
      source_type: raw.source_type,
      source_url: raw.source_url,
      source_title: raw.source_title,
      source_date: raw.source_date,

      company_or_product: result.company_or_product || raw.source_title,
      category: this.inferCategory(raw.keywords_matched),
      one_line_pitch: result.one_line_pitch || '',
      tags: raw.keywords_matched,

      money_signal: result.money_signal || '',
      money_signal_level: result.money_signal_level as SignalLevel,
      traction_signal: result.infra_signal || '',
      pain_signal: result.pain_signal || '',
      infra_signal: result.infra_signal || '',
      distribution_signal: result.distribution_signal || '',
      trust_signal: result.trust_signal || '',

      hidden_demand: result.hidden_demand || '',
      likely_buyer: result.likely_buyer || '',
      why_now: result.fact_summary || '',
      competitors: [],
      user_complaint_keywords: raw.keywords_matched,

      fit_with_rutaapi: result.fit_with_rutaapi as SignalLevel,
      fit_with_api_doctor: result.fit_with_api_doctor as SignalLevel,
      solo_founder_feasibility: result.solo_founder_feasibility as SignalLevel,
      can_ship_in_7_days: result.solo_founder_feasibility >= 3,

      compliance_risk: result.compliance_risk as SignalLevel,
      competition_risk: result.distraction_risk as SignalLevel,
      data_confidence: 3,

      radar_score: result.radar_score,
      decision: result.decision as Decision,
      next_action: result.next_action || this.defaultAction(result.decision as Decision)
    };
  }

  /**
   * 推断类别
   */
  private inferCategory(keywords: string[]): string {
    const keywordStr = keywords.join(' ').toLowerCase();

    if (keywordStr.includes('gateway') || keywordStr.includes('routing') || keywordStr.includes('billing')) {
      return 'AI API Gateway';
    }
    if (keywordStr.includes('mcp') || keywordStr.includes('agent')) {
      return 'Agent/MCP';
    }
    if (keywordStr.includes('mrr') || keywordStr.includes('revenue') || keywordStr.includes('stripe')) {
      return 'Revenue/SaaS';
    }
    if (keywordStr.includes('llm') || keywordStr.includes('openai') || keywordStr.includes('gpt')) {
      return 'LLM/AI';
    }

    return 'General';
  }

  /**
   * 默认动作
   */
  private defaultAction(decision: Decision): string {
    switch (decision) {
      case 'BUILD':
        return '立即启动 MVP';
      case 'MERGE_INTO_CURRENT':
        return '合并到 RutaAPI 或 API Doctor';
      case 'PROBE':
        return '做 landing page 验证需求';
      case 'WATCH':
        return '继续观察，等待更多信息';
      case 'IGNORE':
      default:
        return '跳过，专注其他机会';
    }
  }

  /**
   * 限制数值范围
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * 数组分块
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
