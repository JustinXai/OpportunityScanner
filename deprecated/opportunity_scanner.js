/**
 * n8n Function Node - 商机扫描与双模型评估脚本
 *
 * 功能:
 * 1. 数据清洗 - 正则提取平台名称和核心动词
 * 2. 双模型路由 - DeepSeek-V3 + 豆包(Doubao-pro)
 * 3. 交叉对齐 - 智能优先级调整
 * 4. 标准JSON输出
 */

// ============================================================
// 配置区域
// ============================================================
const CONFIG = {
  deepseek: {
    model: 'deepseek-chat',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    apiKey: $env.DEEPSEEK_API_KEY || '',
    temperature: 0.3
  },
  doubao: {
    model: 'doubao-pro',
    apiUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    apiKey: $env.DOUBAO_API_KEY || '',
    temperature: 0.3
  },
  // 阈值配置
  thresholds: {
    riskScoreMax: 7.0,      // DeepSeek风险分超过此值则降低优先级
    trafficScoreMin: 4.0,   // 豆包流量分低于此值则降低优先级
    priorityBoost: 1.2,    // 双高分优先级提升系数
    priorityPenalty: 0.6    // 任一分低时优先级惩罚系数
  }
};

// ============================================================
// 数据清洗模块
// ============================================================
const DataCleaner = {
  // 已知平台名称列表（可扩展）
  knownPlatforms: [
    'Shopify', 'WordPress', 'Stripe', 'PayPal', 'Slack', 'Discord',
    'VSCode', 'GitHub', 'GitLab', 'Notion', 'Figma', 'Canva',
    'TikTok', 'Instagram', 'Twitter', 'X', 'YouTube', '小红书',
    '抖音', '微信', '微博', '知乎', 'B站', 'Bilibili',
    'Amazon', 'eBay', 'Etsy', 'AliExpress', '淘宝', '京东', '拼多多',
    'OpenAI', 'Anthropic', 'Google', 'Meta', 'Apple', 'Microsoft',
    'Salesforce', 'HubSpot', 'Zendesk', 'Intercom', 'Zapier',
    'AWS', 'Azure', 'GCP', 'Vercel', 'Netlify', 'Cloudflare',
    'React', 'Vue', 'Angular', 'Next.js', 'Nuxt', 'Flutter',
    'iOS', 'Android', 'macOS', 'Windows', 'Linux'
  ],

  // 核心动词列表
  coreVerbs: [
    '自动化', '同步', '导入', '导出', '抓取', '采集', '爬取',
    '生成', '创建', '构建', '制作', '编辑', '修改', '更新',
    '分析', '统计', '监控', '追踪', '检测', '识别',
    '发送', '接收', '推送', '通知', '提醒', '警报',
    '转换', '翻译', '整理', '分类', '标记', '标注',
    '备份', '恢复', '存储', '保存', '下载', '上传',
    '搜索', '查询', '筛选', '过滤', '查找',
    '报告', '汇总', '展示', '显示', '可视化'
  ],

  // 正则提取平台名称
  extractPlatforms(text) {
    const found = [];

    // 精确匹配已知平台
    for (const platform of this.knownPlatforms) {
      const regex = new RegExp(`\\b${this.escapeRegex(platform)}\\b`, 'gi');
      if (regex.test(text)) {
        found.push(platform);
      }
    }

    // 使用正则模式提取URL子域名
    const urlPattern = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+)\.(?:com|org|io|app|dev|co|net|ai|cc|xyz|info|biz|me|tw|hk|cn)/gi;
    let match;
    while ((match = urlPattern.exec(text)) !== null) {
      const domain = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      if (domain.length > 2 && !this.knownPlatforms.includes(domain) && !found.includes(domain)) {
        found.push(domain);
      }
    }

    // 提取 @用户名 格式
    const mentionPattern = /@([a-zA-Z0-9_]{2,30})/g;
    while ((match = mentionPattern.exec(text)) !== null) {
      if (!found.includes(match[1])) {
        found.push(match[1]);
      }
    }

    return [...new Set(found)]; // 去重
  },

  // 正则提取核心动词
  extractVerbs(text) {
    const found = [];

    for (const verb of this.coreVerbs) {
      const regex = new RegExp(this.escapeRegex(verb), 'gi');
      if (regex.test(text)) {
        found.push(verb);
      }
    }

    // 额外提取英文动词短语
    const englishVerbs = [
      'automate', 'sync', 'import', 'export', 'scrape', 'crawl', 'fetch',
      'generate', 'create', 'build', 'make', 'edit', 'update',
      'analyze', 'track', 'monitor', 'detect', 'identify',
      'send', 'push', 'notify', 'alert', 'convert', 'translate',
      'search', 'filter', 'find', 'backup', 'restore', 'download', 'upload'
    ];

    for (const verb of englishVerbs) {
      const regex = new RegExp(`\\b${verb}(s|ing|ed)?\\b`, 'gi');
      if (regex.test(text)) {
        found.push(verb);
      }
    }

    return [...new Set(found)];
  },

  // 转义正则特殊字符
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  // 主清洗函数
  clean(text) {
    return {
      platforms: this.extractPlatforms(text),
      verbs: this.extractVerbs(text),
      rawText: text,
      cleanedText: text
        .replace(/https?:\/\/[^\s]+/g, '[URL]')
        .replace(/@[a-zA-Z0-9_]+/g, '[MENTION]')
        .replace(/\s+/g, ' ')
        .trim()
    };
  }
};

// ============================================================
// DeepSeek API 调用
// ============================================================
async function callDeepSeek(data) {
  if (!CONFIG.deepseek.apiKey) {
    console.warn('DeepSeek API Key 未配置，使用模拟数据');
    return getMockDeepSeekResponse(data);
  }

  const prompt = `你是一个技术风险评估专家。请分析以下商机信息，评估其技术实现成本和平台封杀风险。

目标平台: ${data.platforms.join(', ') || '未识别'}
用户痛点: ${data.cleanedText}

请返回JSON格式的评估:
{
  "techComplexity": 1-10的分数,  // 技术实现复杂度 (1=非常简单, 10=极其复杂)
  "implementationCost": "低成本/中成本/高成本",
  "riskScore": 1-10的分数,        // 平台封杀风险 (1=几乎无风险, 10=极高风险)
  "riskFactors": ["风险因素1", "风险因素2"],
  "technicalRecommendations": ["技术建议1", "技术建议2"]
}`;

  try {
    const response = await fetch(CONFIG.deepseek.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.deepseek.apiKey}`
      },
      body: JSON.stringify({
        model: CONFIG.deepseek.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: CONFIG.deepseek.temperature
      })
    });

    const result = await response.json();
    return JSON.parse(result.choices[0].message.content);
  } catch (error) {
    console.error('DeepSeek API 调用失败:', error);
    return getMockDeepSeekResponse(data);
  }
}

function getMockDeepSeekResponse(data) {
  return {
    techComplexity: Math.floor(Math.random() * 5) + 3,
    implementationCost: ['低成本', '中成本', '高成本'][Math.floor(Math.random() * 3)],
    riskScore: Math.floor(Math.random() * 6) + 2,
    riskFactors: ['API政策变化', '官方工具限制', '反爬机制'],
    technicalRecommendations: ['使用官方API', '实现请求限流', '考虑备用方案']
  };
}

// ============================================================
// 豆包 API 调用
// ============================================================
async function callDoubao(data) {
  if (!CONFIG.doubao.apiKey) {
    console.warn('豆包 API Key 未配置，使用模拟数据');
    return getMockDoubaoResponse(data);
  }

  const prompt = `你是一个中文商业洞察专家。请基于中文商业直觉评估以下商机的SEO寄生潜力和一人公司变现路径。

目标平台: ${data.platforms.join(', ') || '未识别'}
用户痛点: ${data.cleanedText}

请返回JSON格式的评估:
{
  "seoPotential": 1-10的分数,     // SEO寄生潜力 (1=几乎无潜力, 10=极具潜力)
  "trafficScore": 1-10的分数,    // 流量获取能力
  "monetizationPath": "具体变现路径描述",
  "marketDemand": "市场需求评估",
  "competitionLevel": "低/中/高",
  "quickWinFactors": ["快速见效因素1", "快速见效因素2"]
}`;

  try {
    const response = await fetch(CONFIG.doubao.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.doubao.apiKey}`
      },
      body: JSON.stringify({
        model: CONFIG.doubao.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: CONFIG.doubao.temperature
      })
    });

    const result = await response.json();
    return JSON.parse(result.choices[0].message.content);
  } catch (error) {
    console.error('豆包 API 调用失败:', error);
    return getMockDoubaoResponse(data);
  }
}

function getMockDoubaoResponse(data) {
  return {
    seoPotential: Math.floor(Math.random() * 5) + 5,
    trafficScore: Math.floor(Math.random() * 5) + 4,
    monetizationPath: 'SaaS订阅 + 高级功能付费 + 定制化服务',
    marketDemand: '市场需求旺盛，用户付费意愿强',
    competitionLevel: ['低', '中', '高'][Math.floor(Math.random() * 3)],
    quickWinFactors: ['痛点明确', '解决方案清晰', '目标用户精准']
  };
}

// ============================================================
// 交叉对齐与优先级计算
// ============================================================
function calculatePriority(deepseekResult, doubaoResult) {
  const { thresholds } = CONFIG;

  let priorityScore = 5.0; // 默认优先级
  let adjustmentReasons = [];

  // 检查 DeepSeek 风险分
  if (deepseekResult.riskScore >= thresholds.riskScoreMax) {
    priorityScore *= thresholds.priorityPenalty;
    adjustmentReasons.push(`风险分过高(${deepseekResult.riskScore}/10)`);
  }

  // 检查豆包流量分
  if (doubaoResult.trafficScore <= thresholds.trafficScoreMin) {
    priorityScore *= thresholds.priorityPenalty;
    adjustmentReasons.push(`流量分过低(${doubaoResult.trafficScore}/10)`);
  }

  // 双高分提升
  if (deepseekResult.riskScore < thresholds.riskScoreMax &&
      doubaoResult.trafficScore > thresholds.trafficScoreMin + 2) {
    priorityScore *= thresholds.priorityBoost;
    adjustmentReasons.push('双模型评估均为高分');
  }

  // 技术复杂度影响
  if (deepseekResult.techComplexity <= 3) {
    priorityScore *= 1.15;
    adjustmentReasons.push('技术实现简单');
  } else if (deepseekResult.techComplexity >= 8) {
    priorityScore *= 0.8;
    adjustmentReasons.push('技术实现复杂');
  }

  return {
    score: Math.round(priorityScore * 10) / 10,
    reasons: adjustmentReasons.length > 0 ? adjustmentReasons : ['标准评估']
  };
}

// ============================================================
// SEO关键词生成
// ============================================================
function generateSEOKeywords(data, deepseekResult, doubaoResult) {
  const keywords = [];

  // 从平台名生成
  data.platforms.forEach(p => {
    keywords.push(`${p}自动化`);
    keywords.push(`${p}工具`);
    keywords.push(`${p}插件`);
    keywords.push(`${p}集成`);
  });

  // 从动词生成
  data.verbs.forEach(v => {
    keywords.push(`${v}软件`);
    keywords.push(`自动${v}`);
  });

  // 从风险评估生成
  if (deepseekResult.implementationCost === '低成本') {
    keywords.push('免费工具');
    keywords.push('低成本方案');
  }

  // 从变现路径生成
  if (doubaoResult.monetizationPath.includes('订阅')) {
    keywords.push('SaaS');
    keywords.push('月付工具');
  }

  return [...new Set(keywords)].slice(0, 15);
}

// ============================================================
// 估算MVP开发天数
// ============================================================
function estimateMVP(days, deepseekResult, doubaoResult) {
  const baseDays = deepseekResult.techComplexity * 1.5;

  let adjustment = 1.0;

  // 有API支持则减少天数
  if (deepseekResult.technicalRecommendations.some(r => r.includes('API'))) {
    adjustment -= 0.2;
  }

  // 需要反爬则增加天数
  if (deepseekResult.riskFactors.some(r => r.includes('反爬'))) {
    adjustment += 0.3;
  }

  return Math.max(1, Math.round(baseDays * adjustment));
}

// ============================================================
// 主处理函数
// ============================================================
async function processOpportunity(rawText) {
  // 1. 数据清洗
  const cleanedData = DataCleaner.clean(rawText);
  console.log('清洗后的数据:', cleanedData);

  // 2. 双模型路由（并行调用）
  const [deepseekResult, doubaoResult] = await Promise.all([
    callDeepSeek(cleanedData),
    callDoubao(cleanedData)
  ]);

  console.log('DeepSeek 评估:', deepseekResult);
  console.log('豆包 评估:', doubaoResult);

  // 3. 交叉对齐
  const priority = calculatePriority(deepseekResult, doubaoResult);

  // 4. 生成输出
  const seoKeywords = generateSEOKeywords(cleanedData, deepseekResult, doubaoResult);
  const estimatedDays = estimateMVP(estimatedDays, deepseekResult, doubaoResult);

  // 5. 构造最终JSON
  const verdict = {
    overall: priority.score >= 6 ? '推荐' : priority.score >= 4 ? '考虑' : '暂缓',
    deepseekSummary: `技术${deepseekResult.implementationCost}，风险${deepseekResult.riskScore}/10`,
    doubaoSummary: `流量潜力${doubaoResult.trafficScore}/10，变现${doubaoResult.monetizationPath}`
  };

  return {
    Target_Platform: cleanedData.platforms,
    Pain_Point_Summary: cleanedData.cleanedText,
    SEO_Keywords: seoKeywords,
    Estimated_MVP_Days: estimatedDays,
    Dual_Model_Verdict: verdict,
    priority: priority,
    models: {
      deepseek: deepseekResult,
      doubao: doubaoResult
    }
  };
}

// ============================================================
// n8n Function Node 入口
// ============================================================
const items = $input.all();

const results = [];

for (const item of items) {
  const rawText = item.json.text || item.json.content || item.json.raw || JSON.stringify(item.json);

  try {
    const result = await processOpportunity(rawText);
    results.push({
      json: result,
      pairedItem: item
    });
  } catch (error) {
    console.error('处理失败:', error);
    results.push({
      json: {
        error: true,
        message: error.message,
        originalText: rawText
      },
      pairedItem: item
    });
  }
}

// 按优先级排序
results.sort((a, b) => {
  const scoreA = a.json.priority?.score || 0;
  const scoreB = b.json.priority?.score || 0;
  return scoreB - scoreA;
});

return results.map(r => ({ json: r.json }));
