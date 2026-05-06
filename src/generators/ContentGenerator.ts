// src/generators/ContentGenerator.ts
// Twitter 内容生成器：调用 Link-AI API 同时生成英文+葡语文案和配图
//
// Link-AI API 地址: https://api1.link-ai.cc
//
// 文本模型调用: /v1/chat/completions
// 绘图模型调用: /v1/images/generations  (gpt-image-2)
//
// 核心 Prompt 设计:
// - 英文推文: Hook(震惊/幽默) + Value(一句话价值) + CTA + Emojis + Hashtags
// - 葡语推文: 同样的结构，翻译适配巴西/葡萄牙市场
// - 配图 Prompt: 荒诞讽刺拼贴风格 (Salvador Dali + Cyberpunk)

import axios, { AxiosError } from 'axios';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import pLimit from 'p-limit';
import type { TwitterSignal, TwitterContent, LinkAIResponse, LinkAIImageResponse } from '../types.js';

// ============================================================
// 配置
// ============================================================

export interface ContentGeneratorConfig {
  /** Link-AI API Base URL */
  apiBase: string;
  /** Link-AI API Key */
  apiKey: string;
  /** 最大并发生成数 */
  maxConcurrency?: number;
  /** 模型名称 (文本) */
  textModel?: string;
  /** 模型名称 (图像) */
  imageModel?: string;
  /** 强制截断字符数 (Twitter 上限) */
  maxTweetLength?: number;
  /** 是否同时生成配图 */
  generateImage?: boolean;
  /** 图像尺寸 */
  imageSize?: '1024x1024' | '1024x1792' | '1792x1024';
  /** 图像数量 */
  imageN?: 1 | 2;
  /** 输出语言 */
  outputLanguages?: ('en' | 'pt')[];
  /** 系统提示词 (可选) */
  systemPrompt?: string;
}

const DEFAULT_CONFIG: Required<ContentGeneratorConfig> = {
  apiBase: 'https://api1.link-ai.cc',
  apiKey: '',
  maxConcurrency: 3,
  textModel: 'claude-opus-4-5-20251101',
  imageModel: 'gpt-image-2',
  maxTweetLength: 250,
  generateImage: false,  // 默认关闭图片生成
  imageSize: '1024x1024',
  imageN: 1,
  outputLanguages: ['en', 'pt'],
  systemPrompt: 'You are a Twitter Growth Expert. Your goal is to create viral, engaging content for AI news.'
};

// ============================================================
// Prompt 构建
// ============================================================

function buildViralPrompt(rawNewsData: string, language: 'en' | 'pt'): string {
  const langInstruction = language === 'pt'
    ? 'Write a tweet in Brazilian Portuguese (or European Portuguese).'
    : 'Write a tweet in English.';

  return `${langInstruction}

[TASK]:
- Max ${DEFAULT_CONFIG.maxTweetLength} characters (STRICTLY enforced).
- Structure: Hook (Shocking/Funny) + Value (1 sentence) + Call to Action.
- Style: Punchy, humorous, slightly absurd. No corporate speak.
- Use 2-3 relevant hashtags.
- End with a question or engaging statement.

[RULES - CRITICAL]:
1. Output EXACTLY 1 tweet in the specified language.
2. Character count MUST be under ${DEFAULT_CONFIG.maxTweetLength} (including spaces and hashtags).
3. Do NOT include quotes, backticks, or any formatting markers around the tweet.
4. Start with a HOOK that grabs attention immediately.
5. Add 1-2 emojis naturally placed.
6. End with either a question or a short CTA.

[INPUT DATA]:
${rawNewsData}`;
}

function buildImagePrompt(rawNewsData: string): string {
  return `Create a Twitter post image for this AI news:

${rawNewsData}

[IMAGE STYLE - MANDATORY]:
- Salvador Dali style mixed with cyberpunk aesthetics
- Exaggerated caricature / Visual satire
- Surrealist satirical collage, dystopian absurdity
- Vibrant neon colors with dramatic shadows
- Information density: chaotic but readable

[IMAGE CONTENT]:
- Must be an infographic style but visually chaotic/funny
- Include 3-5 bold keywords ON the image itself (e.g., "AI OVERLORD", "BYE BYE JOBS", "HUMAN: OBSOLETE")
- Convey the "Information density" of the news
- Mix retro-futuristic elements with modern AI imagery

[CONSTRAINTS]:
- Square format (1024x1024)
- No text beyond the 3-5 bold keywords
- High contrast for Twitter dark/light mode readability
- Viral, shareable, eye-catching design`;
}

// ============================================================
// 主生成器
// ============================================================

export class ContentGenerator {
  private config: Required<ContentGeneratorConfig>;
  private logger: (msg: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private limiter: any;

  constructor(
    config: ContentGeneratorConfig,
    logger: (msg: string) => void = console.log
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.limiter = pLimit(this.config.maxConcurrency);
  }

  /**
   * 主入口: 批量生成内容
   */
  async generateAll(
    signals: TwitterSignal[]
  ): Promise<TwitterContent[]> {
    if (signals.length === 0) {
      this.logger('[ContentGenerator] 无输入数据，跳过生成');
      return [];
    }

    this.logger(`[ContentGenerator] 开始生成 ${signals.length} 条内容`);
    this.logger(`[ContentGenerator] 配置: 并发=${this.config.maxConcurrency}, 图片=${this.config.generateImage}`);

    const tasks = signals.map(signal =>
      this.limiter(() => this.generateForSignal(signal))
    );

    const results = await Promise.allSettled(tasks);
    const successful = results
      .filter(
        (r): r is PromiseFulfilledResult<TwitterContent> =>
          r.status === 'fulfilled'
      )
      .map(r => r.value);

    this.logger(
      `[ContentGenerator] 成功 ${successful.length}/${signals.length} 条`
    );

    return successful;
  }

  /**
   * 单条推文生成
   */
  async generateForSignal(signal: TwitterSignal): Promise<TwitterContent> {
    const startTime = Date.now();
    this.logger(`[ContentGenerator] 生成中: ${signal.content.substring(0, 40)}...`);

    // Step 1: 并行生成英文 + 葡语文案
    const textResults = await this.generateText(signal);

    // Step 2: 生成配图 (如果启用)
    let imageUrl: string | undefined;
    if (this.config.generateImage) {
      imageUrl = await this.generateImage(signal);
    }

    const elapsed = Date.now() - startTime;
    this.logger(`[ContentGenerator] 完成 (${elapsed}ms): ${textResults.en?.substring(0, 40)}...`);

    return {
      sourceSignal: signal,
      texts: textResults,
      imageUrl,
      generatedAt: new Date(),
      metadata: {
        generationTimeMs: elapsed,
        model: this.config.textModel,
        imageModel: this.config.imageModel
      }
    };
  }

  // ============================================================
  // 文本生成: 英文 + 葡语 并行
  // ============================================================

  private async generateText(
    signal: TwitterSignal
  ): Promise<{ en?: string; pt?: string }> {
    const rawData = this.buildRawDataString(signal);
    const results: { en?: string; pt?: string } = {};

    // 并行请求
    const tasks: Promise<void>[] = [];

    if (this.config.outputLanguages.includes('en')) {
      tasks.push(
        this.callTextAPI(rawData, 'en').then(text => {
          results.en = text;
        })
      );
    }

    if (this.config.outputLanguages.includes('pt')) {
      tasks.push(
        this.callTextAPI(rawData, 'pt').then(text => {
          results.pt = text;
        })
      );
    }

    await Promise.all(tasks);

    // 强制截断到 Twitter 限制
    if (results.en) {
      results.en = this.enforceMaxLength(results.en, this.config.maxTweetLength);
    }
    if (results.pt) {
      results.pt = this.enforceMaxLength(results.pt, this.config.maxTweetLength);
    }

    return results;
  }

  private buildRawDataString(signal: TwitterSignal): string {
    const dataParts: string[] = [
      `来源: @${signal.author.username}`,
      signal.content,
      signal.hashtags.length > 0 ? `Hashtags: ${signal.hashtags.join(', ')}` : '',
      `参与度: ${signal.engagement.likes} 赞, ${signal.engagement.retweets} 转发`,
      `情感: ${signal.sentiment}`,
      `病毒性: ${signal.viralityLevel}`
    ].filter(Boolean);

    return dataParts.join('\n');
  }

  private async callTextAPI(
    rawData: string,
    language: 'en' | 'pt'
  ): Promise<string> {
    const prompt = buildViralPrompt(rawData, language);

    const messages: OpenAIMessage[] = [
      {
        role: 'system',
        content: this.config.systemPrompt
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    try {
      const response = await axios.post<LinkAIResponse>(
        `${this.config.apiBase}/v1/chat/completions`,
        {
          model: this.config.textModel,
          messages,
          temperature: 0.9,
          max_tokens: 300
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`
          },
          timeout: 60000
        }
      );

      const content = response.data.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new Error('Empty response from text API');
      }

      // 清理输出: 去除引号、前后空白
      const cleaned = this.cleanTweetText(content);

      this.logger(`[ContentGenerator] [${language.toUpperCase()}] ${cleaned.substring(0, 60)}...`);

      return cleaned;
    } catch (err) {
      const axiosErr = err as AxiosError;
      const msg = axiosErr.response
        ? `API错误 ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
        : `请求失败: ${axiosErr.message}`;

      this.logger(`[ContentGenerator] [${language.toUpperCase()}] ${msg}`);

      // 降级: 生成一个简单的备选文案
      return this.generateFallbackText(rawData, language);
    }
  }

  private cleanTweetText(text: string): string {
    return (
      text
        // 去除 Markdown 代码块标记
        .replace(/^```(?:json|text)?\s*/i, '')
        .replace(/\s*```$/i, '')
        // 去除前后引号
        .replace(/^["'""]/, '')
        .replace(/["'""]$/, '')
        // 去除前后空白
        .trim()
        // 去除可能残留的换行
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
    );
  }

  private enforceMaxLength(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    // 尝试在最后一个空格处截断
    const truncated = text.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > maxLength * 0.7) {
      return truncated.substring(0, lastSpace).trim();
    }

    // 如果无法找到合适断点，直接截断
    return truncated.trim();
  }

  private generateFallbackText(
    rawData: string,
    language: 'en' | 'pt'
  ): string {
    // 降级文案生成器 (简单的规则引擎)
    const enTemplates = [
      `AI is moving faster than you think. ${rawData.includes('launch') || rawData.includes('release') ? 'A new tool just dropped.' : 'This changes everything.'} What do you think? #AI #Tech`,
      `Hot take: ${rawData.includes('job') || rawData.includes('layoff') ? 'AI is reshaping the job market.' : 'This AI news is wild.'} Thread below. #AI #Innovation`,
      `You won\'t believe what just happened in AI. ${rawData.includes('GPT') || rawData.includes('Claude') ? 'A new model just dropped.' : 'Check this out.'} #AI #Breaking`
    ];

    const ptTemplates = [
      `A IA está evoluindo mais rápido do que você imagina. ${rawData.includes('lançamento') || rawData.includes('nova') ? 'Uma nova ferramenta acabou de sair.' : 'Isso muda tudo.'} O que você acha? #IA #Tech`,
      `Opinião quente: ${rawData.includes('emprego') || rawData.includes('demissão') ? 'A IA está transformando o mercado de trabalho.' : 'Essa notícia sobre IA é absurda.'} Veja abaixo. #IA #Inovação`,
      `Você não vai acreditar no que aconteceu na IA. ${rawData.includes('GPT') || rawData.includes('Claude') ? 'Um novo modelo acabou de ser lançado.' : 'Confira.'} #IA #Novidades`
    ];

    const templates = language === 'pt' ? ptTemplates : enTemplates;
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // ============================================================
  // 配图生成: gpt-image-2
  // ============================================================

  private async generateImage(signal: TwitterSignal): Promise<string | undefined> {
    const rawData = this.buildRawDataString(signal);
    const imagePrompt = buildImagePrompt(rawData);

    try {
      this.logger(`[ContentGenerator] [IMAGE] 请求生成配图...`);

      const response = await axios.post<LinkAIImageResponse>(
        `${this.config.apiBase}/v1/images/generations`,
        {
          model: this.config.imageModel,
          prompt: imagePrompt,
          n: this.config.imageN,
          size: this.config.imageSize,
          response_format: 'url'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`
          },
          timeout: 120000 // 图像生成可能需要更长时间
        }
      );

      const imageData = response.data.data?.[0];

      if (!imageData?.url && !imageData?.b64_json) {
        throw new Error('No image data returned');
      }

      const imageUrl = imageData.url || `data:image/png;base64,${imageData.b64_json}`;

      this.logger(`[ContentGenerator] [IMAGE] 生成成功: ${imageUrl.substring(0, 80)}...`);

      return imageUrl;
    } catch (err) {
      const axiosErr = err as AxiosError;
      const msg = axiosErr.response
        ? `API错误 ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`
        : `请求失败: ${axiosErr.message}`;

      this.logger(`[ContentGenerator] [IMAGE] 生成失败: ${msg}`);

      return undefined; // 图像失败不影响文案
    }
  }
}

// ============================================================
// 辅助类型
// ============================================================

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ============================================================
// 便捷函数
// ============================================================

export async function generateTwitterContent(
  signals: TwitterSignal[],
  config: ContentGeneratorConfig,
  logger?: (msg: string) => void
): Promise<TwitterContent[]> {
  const generator = new ContentGenerator(config, logger);
  return generator.generateAll(signals);
}

export function createDefaultContentGenerator(
  apiKey: string,
  logger: (msg: string) => void = console.log
): ContentGenerator {
  return new ContentGenerator(
    {
      apiBase: 'https://api1.link-ai.cc',
      apiKey,
      maxConcurrency: 3,
      textModel: 'claude-opus-4-5-20251101',
      imageModel: 'gpt-image-2',
      maxTweetLength: 250,
      generateImage: true,
      imageSize: '1024x1024',
      imageN: 1,
      outputLanguages: ['en', 'pt'],
      systemPrompt:
        'You are a Twitter Growth Expert specializing in viral AI news content. ' +
        'You write punchy, humorous tweets that grab attention. ' +
        'You MUST strictly enforce the character limit (250 chars max). ' +
        'You generate content in both English and Portuguese.'
    },
    logger
  );
}
