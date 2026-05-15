# Opportunity Radar V2 - 数据源文档

## 第一层：强结构化源（每 2-3 天扫）

### Product Hunt

**为什么扫**: 新产品密度高，能看到 positioning

**采集方式**: Product Hunt GraphQL API（降级到 Serper 网页爬取）

**重点字段**: product, tag, launch date, votes, followers, tag

### GitHub

**为什么扫**: 看开源基础设施真实热度

**采集方式**: GitHub Search API

**重点字段**: stars, forks, recent commits, issues, topics

### Hacker News

**为什么扫**: 看开发者真实质疑

**采集方式**: Algolia HN API

**重点字段**: comments, points, 技术争议

### Reddit

**为什么扫**: 看真实抱怨和小 MRR

**采集方式**: Serper 搜索（Reddit 数据访问限制）

**重点字段**: MRR 自曝, 抱怨, 用户画像

### Indie Hackers

**为什么扫**: 看 MRR 自曝和失败复盘

**采集方式**: Serper 搜索 + 手动摘录

**重点字段**: MRR, 渠道, 失败点, 评论

---

## 第二层：补充源（手动/定期）

### Flippa

**为什么扫**: 看真实挂牌收入、利润、MRR

**采集方式**: 初期手动/半自动，不建议硬爬

**重点字段**: MRR, profit, margin, churn, age

### NPM / PyPI

**为什么扫**: 看开发工具真实采用

**采集方式**: registry API

**重点字段**: downloads, 版本更新

### Ads Library

**为什么扫**: 看谁在持续投广告

**采集方式**: Meta/Google 透明工具，优先手动

**重点字段**: active ads, 文案, 落地页
