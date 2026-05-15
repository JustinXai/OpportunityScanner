# Opportunity Scanner

商机扫描器 - 多平台数据采集 + AI 分析

## 项目架构

### V1: 僵尸插件扫描 (`src/OpportunityHunter.ts`)
- 专注扫描停更/崩溃的 Chrome 扩展、VSCode 插件
- 数据来源：Twitter、Chrome Web Store、VSCode Marketplace
- 搜索引擎：Serper API
- AI 分析：DeepSeek
- 搜索词自我进化引擎

### V2: Signal Event 扫描 (`opportunity-radar/`)
- 基于 Signal Event 而非项目扫描
- 多数据源：Product Hunt、GitHub、Hacker News、Reddit、Indie Hackers
- LLM 分类 + 规则评分
- 输出 4 个文件：signals.csv、opportunity-ledger.md、action-board.md、weekly-radar-summary.md

## 快速开始

### V1 扫描器

```bash
npm run scan
```

### V2 扫描器

```bash
npm run radar
```

## 环境变量

```bash
# Serper API (V1 必需)
SERPER_API_KEY=your_serper_key

# DeepSeek API (V1 & V2 必需)
DEEPSEEK_API_KEY=your_deepseek_key

# GitHub Token (可选，提高 API 限制)
GITHUB_TOKEN=your_github_token
```

## 定时执行 (Docker)

```yaml
# docker-compose.yml
command: >
  sh -c "while true; do 
    npm run scan; 
    sleep 172800; 
  done"
```

## 项目结构

```
├── src/                    # V1 僵尸扫描器
│   ├── OpportunityHunter.ts
│   ├── EmailService.ts
│   └── types.ts
├── opportunity-radar/      # V2 Signal Event 扫描器
│   ├── src/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── sources/
│   │   ├── classifiers/
│   │   ├── scoring/
│   │   └── generators/
│   ├── keywords.yaml
│   └── docs/
├── deprecated/             # 废弃文件（可删除）
└── logs/                  # 运行日志
```
