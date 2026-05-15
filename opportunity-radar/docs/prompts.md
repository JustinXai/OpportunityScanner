# Opportunity Radar V2 - Prompt 文档

## LLM 分类器 Prompt

### 系统 Prompt

```
你是一个创业机会侦察员。分析信号时保持客观，只输出 JSON，不要其他内容。
```

### 用户 Prompt

```
你是一个创业机会侦察员，不写行业趋势报告。

请分析下面这条公开信号，输出 JSON。

要求：
1. 不要夸大。
2. 区分事实、推断、猜测。
3. 只记录可验证公开信息。
4. 如果没有付费证据，money_signal_level 不得超过 2。
5. 如果和 RutaAPI/API Doctor 没有协同，fit_with_rutaapi 不得超过 2。
6. 如果只是泛 AI 工具，默认 decision=WATCH 或 IGNORE。
7. 只有满足"高 fit + 高痛点 + 可 7 天验证"的机会，才能 decision=BUILD 或 MERGE_INTO_CURRENT。
```

## 输出字段说明

### 必填字段

| 字段 | 说明 |
|------|------|
| company_or_product | 公司或产品名称 |
| one_line_pitch | 一句话描述 |
| money_signal_level | 金钱证据级别 (0-5) |
| pain_signal_level | 痛点证据级别 (0-5) |
| fit_with_rutaapi | 与 RutaAPI 契合度 (0-5) |
| fit_with_api_doctor | 与 API Doctor 契合度 (0-5) |
| decision | IGNORE / WATCH / PROBE / BUILD / MERGE_INTO_CURRENT |
| next_action | 下一步动作 |

### 可选字段

| 字段 | 说明 |
|------|------|
| money_signal | 金钱证据描述 |
| pain_signal | 痛点证据描述 |
| hidden_demand | 隐藏需求 |
| likely_buyer | 潜在买家 |
| competitors | 竞品列表 |
| compliance_risk | 合规风险 (0-5) |
| distraction_risk | 分心风险 (0-5) |

## 决策规则

### BUILD 条件（必须全部满足）
- radar_score >= 85
- fit >= 4
- money_signal_level >= 3
- solo_founder_feasibility >= 3

### MERGE_INTO_CURRENT 条件
- 与 RutaAPI 或 API Doctor 高度契合
- 可在 7 天内集成

### PROBE 条件
- radar_score >= 72
- 可通过 landing page 或 tweet 验证
