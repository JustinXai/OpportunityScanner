# Opportunity Radar V2

半自动扫描器 - Signal Event 驱动

## 快速开始

```bash
cd opportunity-radar
npm install
npm run scan
```

## 环境变量

```bash
export DEEPSEEK_API_KEY=your_deepseek_api_key
export SERPER_API_KEY=your_serper_api_key
export PH_API_TOKEN=your_producthunt_token  # 可选
export GITHUB_TOKEN=your_github_token      # 可选，提高 API 限制
```

## 输出文件

每次扫描会生成 4 个文件：

1. **signals.csv** - 所有原始信号的 CSV 格式
2. **opportunity-ledger.md** - 按类别合并的机会
3. **action-board.md** - 可执行的动作看板
4. **weekly-radar-summary.md** - 每周 5 个问题摘要

## 扫描源

- Product Hunt - 新产品密度
- GitHub - 开源基础设施热度
- Hacker News - 开发者讨论
- Reddit - 真实抱怨和 MRR 自曝
- Indie Hackers - 创业自曝和复盘
