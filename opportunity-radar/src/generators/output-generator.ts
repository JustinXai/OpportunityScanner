// 输出生成器
// 生成 4 个输出文件

import * as fs from 'fs';
import * as path from 'path';
import type { OpportunitySignal, ScanRun } from '../types.js';

interface GeneratorConfig {
  output_dir: string;
  run_id: string;
}

/**
 * signals.csv 生成器
 */
function generateCSV(signals: OpportunitySignal[]): string {
  const headers = [
    'date', 'source', 'product', 'signal_type', 'raw_signal',
    'money_signal', 'money_level', 'pain_signal', 'pain_level',
    'fit_score', 'radar_score', 'decision', 'source_url'
  ];

  const rows = signals.map(s => [
    s.source_date,
    s.source_type,
    s.company_or_product,
    s.tags.join('|'),
    `"${(s.one_line_pitch || '').replace(/"/g, '""')}"`,
    `"${(s.money_signal || '').replace(/"/g, '""')}"`,
    s.money_signal_level,
    `"${(s.pain_signal || '').replace(/"/g, '""')}"`,
    0,
    Math.max(s.fit_with_rutaapi, s.fit_with_api_doctor),
    s.radar_score,
    s.decision,
    s.source_url
  ].join(','));

  return [headers.join(','), ...rows].join('\n');
}

/**
 * opportunity-ledger.md 生成器
 */
function generateOpportunityLedger(signals: OpportunitySignal[]): string {
  const lines: string[] = [];

  lines.push('# Opportunity Ledger');
  lines.push('');
  lines.push(`*生成时间: ${new Date().toLocaleString('zh-CN')}*`);
  lines.push('');
  lines.push('---\n');

  // 按类别分组
  const byCategory = new Map<string, OpportunitySignal[]>();
  for (const signal of signals) {
    const category = signal.category || 'Other';
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
    }
    byCategory.get(category)!.push(signal);
  }

  // 输出每个类别
  for (const [category, categorySignals] of byCategory) {
    lines.push(`## ${category}`);
    lines.push('');

    // 只输出 PROBE 以上的
    const actionable = categorySignals.filter(s =>
      ['BUILD', 'MERGE_INTO_CURRENT', 'PROBE'].includes(s.decision)
    );

    if (actionable.length === 0) {
      lines.push('*暂无高优先级机会*\n');
      continue;
    }

    for (const signal of actionable.slice(0, 10)) {
      lines.push(`### ${signal.company_or_product}`);
      lines.push('');
      lines.push(`**评分**: ${signal.radar_score} | **决策**: ${signal.decision}`);
      lines.push('');
      lines.push(`**一句话**: ${signal.one_line_pitch || signal.one_line_pitch}`);
      lines.push('');
      lines.push(`**证据**: ${signal.money_signal || signal.pain_signal || 'N/A'}`);
      lines.push('');
      lines.push(`**隐藏需求**: ${signal.hidden_demand || 'N/A'}`);
      lines.push('');
      lines.push(`**RutaAPI Fit**: ${signal.fit_with_rutaapi}/5 | **API Doctor Fit**: ${signal.fit_with_api_doctor}/5`);
      lines.push('');
      lines.push(`**动作**: ${signal.next_action}`);
      lines.push('');
      lines.push(`> 来源: ${signal.source_type} | [查看原文](${signal.source_url})`);
      lines.push('');
      lines.push('---\n');
    }
  }

  return lines.join('\n');
}

/**
 * action-board.md 生成器
 */
function generateActionBoard(signals: OpportunitySignal[]): string {
  const lines: string[] = [];

  lines.push('# Action Board');
  lines.push('');
  lines.push(`*生成时间: ${new Date().toLocaleString('zh-CN')}*`);
  lines.push('');
  lines.push('---\n');

  // BUILD NOW
  const builds = signals.filter(s => s.decision === 'BUILD');
  lines.push('## BUILD NOW');
  lines.push('');
  if (builds.length === 0) {
    lines.push('*暂无可立即启动的机会*\n');
  } else {
    for (const s of builds.slice(0, 5)) {
      lines.push(`### ${s.company_or_product}`);
      lines.push(`**原因**: ${s.money_signal || s.pain_signal}`);
      lines.push(`**Fit**: RutaAPI ${s.fit_with_rutaapi}/5, API Doctor ${s.fit_with_api_doctor}/5`);
      lines.push(`**动作**: ${s.next_action}`);
      lines.push('');
      lines.push(`> [查看详情](${s.source_url})`);
      lines.push('');
    }
  }
  lines.push('---\n');

  // MERGE INTO CURRENT
  const merges = signals.filter(s => s.decision === 'MERGE_INTO_CURRENT');
  lines.push('## MERGE INTO CURRENT');
  lines.push('');
  if (merges.length === 0) {
    lines.push('*暂无可合并到现有产品的机会*\n');
  } else {
    for (const s of merges.slice(0, 5)) {
      lines.push(`### ${s.company_or_product}`);
      lines.push(`**原因**: ${s.hidden_demand || s.money_signal || s.pain_signal}`);
      lines.push(`**目标**: ${s.fit_with_rutaapi >= 4 ? 'RutaAPI' : 'API Doctor'}`);
      lines.push(`**动作**: ${s.next_action}`);
      lines.push('');
      lines.push(`> [查看详情](${s.source_url})`);
      lines.push('');
    }
  }
  lines.push('---\n');

  // PROBE
  const probes = signals.filter(s => s.decision === 'PROBE');
  lines.push('## PROBE');
  lines.push('');
  if (probes.length === 0) {
    lines.push('*暂无需要验证的机会*\n');
  } else {
    for (const s of probes.slice(0, 5)) {
      lines.push(`### ${s.company_or_product}`);
      lines.push(`**机会**: ${s.one_line_pitch || s.hidden_demand}`);
      lines.push(`**验证方式**: ${s.next_action}`);
      lines.push('');
    }
  }
  lines.push('---\n');

  // WATCH
  const watches = signals.filter(s => s.decision === 'WATCH');
  lines.push('## WATCH');
  lines.push('');
  if (watches.length === 0) {
    lines.push('*暂无需要观察的机会*\n');
  } else {
    for (const s of watches.slice(0, 10)) {
      lines.push(`- [ ] **${s.company_or_product}** (${s.radar_score}分) - ${s.one_line_pitch || s.hidden_demand || 'N/A'}`);
    }
    lines.push('');
  }
  lines.push('---\n');

  // IGNORE
  const ignores = signals.filter(s => s.decision === 'IGNORE');
  lines.push('## IGNORE');
  lines.push('');
  lines.push('*这些机会不符合当前战略，暂时忽略：*\n');
  for (const s of ignores.slice(0, 10)) {
    lines.push(`- ~~${s.company_or_product}~~ (${s.radar_score}分) - ${s.one_line_pitch || 'N/A'}`);
  }

  return lines.join('\n');
}

/**
 * weekly-radar-summary.md 生成器
 */
function generateWeeklySummary(signals: OpportunitySignal[]): string {
  const lines: string[] = [];
  const topSignals = signals.slice(0, 5);
  const buildSignals = signals.filter(s => s.decision === 'BUILD' || s.decision === 'MERGE_INTO_CURRENT');
  const probeSignals = signals.filter(s => s.decision === 'PROBE');
  const watches = signals.filter(s => s.decision === 'WATCH');

  lines.push('# Weekly Radar Summary');
  lines.push('');
  lines.push(`**生成时间**: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} (UTC+8)`);
  lines.push(`**扫描信号数**: ${signals.length}`);
  lines.push('');
  lines.push('---\n');

  // Q1: 最高分新机会
  lines.push('## 1. 本周最高分新机会是什么？');
  lines.push('');
  if (topSignals.length > 0) {
    const top = topSignals[0];
    lines.push(`**${top.company_or_product}** - ${top.radar_score}分`);
    lines.push('');
    lines.push(`> ${top.one_line_pitch || top.hidden_demand || 'N/A'}`);
    lines.push('');
    lines.push(`**决策**: ${top.decision} | **动作**: ${top.next_action}`);
    lines.push('');
  } else {
    lines.push('*本周暂无显著机会*\n');
  }
  lines.push('---\n');

  // Q2: 主线判断变化
  lines.push('## 2. 有没有改变 RutaAPI 主线判断？');
  lines.push('');
  const rutaFits = signals.filter(s => s.fit_with_rutaapi >= 4);
  if (rutaFits.length > 0) {
    lines.push(`发现 **${rutaFits.length}** 个与 RutaAPI 高度相关的信号：`);
    lines.push('');
    for (const s of rutaFits.slice(0, 3)) {
      lines.push(`- **${s.company_or_product}**: ${s.hidden_demand || s.one_line_pitch}`);
    }
  } else {
    lines.push('暂无影响 RutaAPI 主线的信号。');
  }
  lines.push('');
  lines.push('---\n');

  // Q3: 必须立刻做的
  lines.push('## 3. 有没有必须立刻做的页面/功能？');
  lines.push('');
  if (buildSignals.length > 0) {
    lines.push(`**${buildSignals.length}** 个 BUILD/MERGE 机会：`);
    lines.push('');
    for (const s of buildSignals.slice(0, 3)) {
      lines.push(`### ${s.company_or_product}`);
      lines.push(`**原因**: ${s.hidden_demand || s.money_signal || s.pain_signal}`);
      lines.push(`**下一步**: ${s.next_action}`);
      lines.push('');
    }
  } else if (probeSignals.length > 0) {
    lines.push(`暂无 BUILD 机会，但有 **${probeSignals.length}** 个 PROBE 机会可验证：`);
    lines.push('');
    for (const s of probeSignals.slice(0, 2)) {
      lines.push(`- **${s.company_or_product}**: ${s.next_action}`);
    }
  } else {
    lines.push('暂无紧急行动项。');
  }
  lines.push('');
  lines.push('---\n');

  // Q4: 需要进圈的
  lines.push('## 4. 有没有需要进圈/找人问的圈子？');
  lines.push('');
  const socialSignals = signals.filter(s =>
    ['reddit', 'hacker_news', 'indie_hackers'].includes(s.source_type)
  );
  if (socialSignals.length > 0) {
    lines.push(`发现 **${socialSignals.length}** 个社区讨论值得关注：`);
    lines.push('');
    for (const s of socialSignals.slice(0, 3)) {
      lines.push(`- **${s.company_or_product}** (r/${s.source_type}): ${s.one_line_pitch || s.hidden_demand || 'N/A'}`);
    }
  } else {
    lines.push('暂无需要深入社区的需求。');
  }
  lines.push('');
  lines.push('---\n');

  // Q5: 应该放弃的
  lines.push('## 5. 有没有应该放弃的诱惑？');
  lines.push('');
  const ignoreSignals = signals.filter(s => s.decision === 'IGNORE');
  if (ignoreSignals.length > 0) {
    lines.push(`**${ignoreSignals.length}** 个低分机会应该忽略：`);
    lines.push('');
    for (const s of ignoreSignals.slice(0, 5)) {
      lines.push(`- ~~${s.company_or_product}~~ - ${s.competitors?.[0] ? `竞品: ${s.competitors[0]}` : '不符合战略'}`);
    }
    lines.push('');
    lines.push('*保持专注，不要被噪音分散注意力。*');
  } else {
    lines.push('暂无需要主动放弃的机会。');
  }
  lines.push('');
  lines.push('---\n');

  lines.push('*由 Opportunity Radar V2 自动生成*');

  return lines.join('\n');
}

/**
 * 生成所有输出文件
 */
export async function generateOutputFiles(
  signals: OpportunitySignal[],
  config: GeneratorConfig
): Promise<void> {
  const runDir = path.join(config.output_dir, config.run_id);

  // 创建目录
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  // 1. signals.csv
  const csvPath = path.join(runDir, 'signals.csv');
  fs.writeFileSync(csvPath, generateCSV(signals), 'utf-8');
  console.log(`   📄 signals.csv -> ${csvPath}`);

  // 2. opportunity-ledger.md
  const ledgerPath = path.join(runDir, 'opportunity-ledger.md');
  fs.writeFileSync(ledgerPath, generateOpportunityLedger(signals), 'utf-8');
  console.log(`   📋 opportunity-ledger.md -> ${ledgerPath}`);

  // 3. action-board.md
  const boardPath = path.join(runDir, 'action-board.md');
  fs.writeFileSync(boardPath, generateActionBoard(signals), 'utf-8');
  console.log(`   ✅ action-board.md -> ${boardPath}`);

  // 4. weekly-radar-summary.md
  const summaryPath = path.join(runDir, 'weekly-radar-summary.md');
  fs.writeFileSync(summaryPath, generateWeeklySummary(signals), 'utf-8');
  console.log(`   📰 weekly-radar-summary.md -> ${summaryPath}`);

  // 保存原始 JSON
  const jsonPath = path.join(runDir, 'signals.json');
  fs.writeFileSync(jsonPath, JSON.stringify(signals, null, 2), 'utf-8');
  console.log(`   💾 signals.json -> ${jsonPath}`);

  console.log(`\n✅ 所有文件已生成到 ${runDir}`);
}

/**
 * 生成运行记录
 */
export function generateRunRecord(run: ScanRun, outputDir: string): void {
  const recordPath = path.join(outputDir, 'runs', 'run-history.json');

  let history: ScanRun[] = [];
  if (fs.existsSync(recordPath)) {
    try {
      history = JSON.parse(fs.readFileSync(recordPath, 'utf-8'));
    } catch {}
  }

  history.push(run);
  if (history.length > 52) { // 保留一年
    history = history.slice(-52);
  }

  fs.writeFileSync(recordPath, JSON.stringify(history, null, 2), 'utf-8');
}
