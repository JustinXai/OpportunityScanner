# Opportunity Radar V2 - 评分文档

## 评分公式

```
Radar Score =
  Money Evidence * 25
+ Pain Evidence * 20
+ Recency * 15
+ Distribution Signal * 15
+ RutaAPI/API Doctor Fit * 15
+ Solo Feasibility * 10
- Compliance Risk * 10
- Distraction Risk * 15
```

## Money Evidence 分级

| 分数 | 证据 |
|------|------|
| 0 | 只有想法 |
| 1 | 有 upvotes / comments / followers |
| 2 | 有注册用户 / waitlist / GitHub star |
| 3 | 自曝 MRR / paying customers |
| 4 | verified listing / Stripe screenshot / TrustMRR / 公开利润 |
| 5 | 多个独立来源证明，或成熟竞品长期投放 |

## Pain Evidence 分级

| 分数 | 证据 |
|------|------|
| 0 | 没有痛点 |
| 1 | 创始人自己说有痛点 |
| 2 | 评论区有人问怎么做 |
| 3 | 多个用户抱怨同类问题 |
| 4 | GitHub issue / Reddit / forum 反复出现 |
| 5 | 付费用户仍在骂，说明刚需强 |

## Fit 分级

| 分数 | 含义 |
|------|------|
| 0 | 完全无关 |
| 1 | 只是 AI 大类相关 |
| 2 | 同为开发者工具 |
| 3 | 可写内容蹭流量 |
| 4 | 可变成 API Doctor 功能 |
| 5 | 可直接增强 RutaAPI 主线 |

## 决策阈值

| 决策 | 分数范围 |
|------|----------|
| BUILD | >= 85 + 高 Fit + 高 Money |
| MERGE | >= 85 + Fit >= 4 + Money >= 3 |
| PROBE | >= 72 |
| WATCH | >= 55 |
| IGNORE | < 55 |
