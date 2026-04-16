# Opportunity Hunter - 商机扫描器

多平台数据采集 + 双模型AI评估的自动化商机发现系统。

## 🎯 核心功能

| 模块 | 功能 | 技术栈 |
|------|------|--------|
| **Sensors** | VSCode/Reddit/Shopify/Chrome 数据采集 | Axios + Cheerio + RSS Parser |
| **Agentic Judge** | DeepSeek-V3 + 豆包-Pro 双模型评估 | 并行 API 调用 |
| **Scorer** | 综合评分算法 (0-100) | 风险修正模型 |
| **Reporter** | Markdown 表格自动生成 | 阈值过滤 (>80) |

## 📁 项目结构

```
OpportunityScanner/
├── src/
│   └── OpportunityHunter.ts    # 主逻辑 (700+ 行)
├── .github/workflows/
│   └── daily-scan.yml           # GitHub Actions 定时任务
├── reports/                     # 自动生成的报告目录
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入你的 API Keys
```

**所需 API:**
- DeepSeek: [platform.deepseek.com](https://platform.deepseek.com)
- 豆包: [volcengine.com](https://www.volcengine.com)

### 3. 本地运行

```bash
# 开发模式
npm run dev

# 或编译后运行
npm run build
npm start

# 一次性扫描
npm run scan
```

## 🔍 数据源说明

### VSCode Marketplace
- **API**: `POST https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery`
- **Header**: `api-version: 3.0-preview.1`
- **筛选**: 过去12小时更新 (`sortBy=4`, `sortOrder=2`)
- **字段**: 扩展名、评分、安装量、更新时间

### Reddit RSS
- **Subreddits**: `r/Shopify`, `r/vscode`, `r/chrome_extensions`
- **Feed**: `/new/.rss`
- **解析**: RSS 2.0 标准 (`pubDate` 过滤)

### Shopify App Store
- **搜索**: `https://apps.shopify.com/search?q=AI`
- **解析**: Cheerio DOM 遍历
  - 评分: `span[aria-label*="out of 5 stars"]`
  - 评价数: `span[aria-label*="reviews"]` (作为安装量代理)

### Chrome Web Store
- **策略**: Google Dorking
- **Query**: `site:chromewebstore.google.com/detail/ ("bad experience" OR "missing feature")`
- **时效**: 过去12小时 (`tbs=qdr:h12`)

## 🤖 双模型评估逻辑

### DeepSeek-V3 - "刻薄投资人"
**Prompt 角色**: 苛刻的风险投资人，擅长发现致命缺陷

**评估维度:**
1. `platformShutdownRisk` (1-10): 巨头屏蔽风险
   - 微软/Shopify 是否会推出官方替代品？
   - 历史案例: 类似功能是否曾被下架？
2. `techComplexity` (1-10): 技术实现复杂度
   - API 可用性、第三方集成数量、维护成本

### 豆包-Pro - "增长黑客"
**Prompt 角色**: 中文互联网流量变现专家

**评估维度:**
1. `seoKeywords` (list): SEO 寄生关键词列表
2. `userPaymentWillingness` (1-10): 付费意愿强度
   - 根据评论中 "missing feature" 等抱怨推断
   - 抱怨越强烈 → 付费意愿越高

## 📊 评分算法

```
综合分 = 100
  - (平台风险分 × 8)      // 最多扣 40 分
  - (技术复杂度 × 5)      // 最多扣 25 分
  + (付费意愿 × 8)        // 最多加 32 分
  + (SEO 关键词数 / 8 × 18) // 最多加 18 分
  + log10(评价数) × 5     // 最多加 15 分 (安装量代理)
```

**Golden Opportunity 阈值**: ≥ 80 分

### 优先级调整规则

| 条件 | 调整 |
|------|------|
| DeepSeek 风险分 ≥ 7 | 优先级 × 0.6 |
| 豆包流量�� ≤ 4 | 优先级 × 0.6 |
| 双高分(风险<7 & 流量>6) | 优先级 × 1.2 |
| 技术复杂度 ≤ 3 | 优先级 × 1.15 |

## 📝 输出格式

```markdown
# 📊 Golden Opportunities - 2026-01-15

| 平台 | 痛点描述 | 竞品弱点 | SEO关键词 | 综合分 |
|------|----------|----------|-----------|--------|
| VSCode | AI代码补全工具无法自... | 微软即将推出官方功... | vscode ai, ai代码补全... | 🟩 **92** |

## 📈 统计摘要
- Golden 总数: 3
- 平均分: 86.5
- 最高分: 92

## 🔍 详细分析
### AI Code Completion Enhancer
- **链接**: https://marketplace.visualstudio.com/...
- **DeepSeek**: 风险 3/10, 复杂度 4/10
- **豆包**: 付费意愿 9/10
- **SEO关键词**: vscode ai, ai代码补全, 代码智能提示
- **AI判断**: API限制较少 | 用户愿意为高级功能付费
```

## ⏰ GitHub Actions 定时任务

### 触发时间 (UTC)
| Cron 表达式 | 北京时间 | 说明 |
|-------------|----------|------|
| `0 1 * * *` | 09:00 | 早高峰扫描 |
| `0 13 * * *` | 21:00 | 晚高峰扫描 |

### 工作流步骤
1. ✅ Checkout 代码
2. ✅ Setup Node.js 20
3. ✅ `npm ci` 安装依赖
4. ✅ `npm run build` 编译 TS
5. ✅ 注入 API Keys (Secrets)
6. ✅ `npm start` 执行扫描
7. ✅ 生成 Markdown 报告
8. ✅ Commit 并推送到仓库
9. ✅ (可选) 失败通知

### 每周清理
- 每周日凌晨清理超过30天的旧报告

## 🔧 环境变量设置 (GitHub Secrets)

在仓库 Settings → Secrets → Actions 中添加:

| Key | Value 来源 |
|-----|-----------|
| `DEEPSEEK_API_KEY` | DeepSeek 开放平台 API Key |
| `DOUBAO_API_KEY` | 豆包/火山引擎 API Key |

## 🐛 故障排查

### VSCode API 403
- 原因: 未设置正确的 `api-version` header
- 解决: 脚本已内置 `3.0-preview.1`

### Reddit RSS 解析失败
- 原因: Reddit 限制未认证请求
- 解决: 添加 User-Agent header (已内置)

### Chrome Web Store 搜索无结果
- 原因: Google 反爬虫
- 解决: 使用高质量代理或更换搜索策略

### API 调用限额
- 建议: 为双模型设置独立的 API Keys
- 监控: 检查响应头 `x-ratelimit-remaining`

## 📈 扩展建议

1. **增加数据源**
   - Product Hunt
   - Hacker News
   - Indie Hackers
   - Twitter 趋势

2. **持久化存储**
   - 写入 SQLite/PostgreSQL
   - 建立历史评分追踪

3. **通知推送**
   - Slack/Discord Webhook
   - 邮件日报
   - 飞书/钉钉机器人

4. **仪表盘**
   - Next.js + Vercel
   - 可视化评分趋势
   - 手动标记处理状态

## 📄 License

MIT

---

**提示**: 请勿将真实的 API Keys 提交到 Git 仓库。使用 `.env` 文件本地存储。
