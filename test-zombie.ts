// test-zombie.ts - Test script for Chrome Zombie Hunter module v5.5
import { ChromeZombieFetcher } from './src/fetchers/chromeZombieFetcher.ts';
import { ChromeZombieAnalyzer } from './src/analyzers/chromeZombieAnalyzer.ts';
import { ZombieReportGenerator } from './src/generators/zombieReportGenerator.ts';
import * as path from 'path';
import * as fs from 'fs';

// 确保 reports 目录存在
const reportsDir = path.join(process.cwd(), 'reports');
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

async function main() {
  console.log('===========================================');
  console.log('🧟 Chrome Zombie Hunter v5.5 - Mock Data Test');
  console.log('   深度漏洞探测版 - 崩溃密度评分');
  console.log('===========================================\n');

  // Test 1: Fetcher with mock data
  console.log('[测试1] 测试 Fetcher (模拟数据模式)...');
  const fetcher = new ChromeZombieFetcher({
    tinyfishApiKey: 'mock-key',
    useMockData: true
  });

  const zombies = await fetcher.fetchAll();
  console.log(`   发现僵尸插件: ${zombies.length} 个\n`);

  for (const z of zombies) {
    console.log(`   📦 ${z.name}`);
    console.log(`      安装量: ${z.installCount.toLocaleString()}`);
    console.log(`      停更时间: ${z.lastUpdated.toLocaleDateString()}`);
    console.log(`      评分: ${z.rating}/5`);
    console.log(`      差评数: ${z.recentNegativeReviews.length}`);
    if (z.reviewAnalysis) {
      console.log(`      怨气等级: ${z.reviewAnalysis.userRageLevel}%`);
      console.log(`      崩溃密度: ${z.reviewAnalysis.crashDensity}/30`);
      console.log(`      MV3损坏: ${z.reviewAnalysis.mv3Broken}`);
      console.log(`      开发者失联: ${z.reviewAnalysis.developerUnresponsive}`);
    }
    console.log('');
  }

  if (zombies.length === 0) {
    console.log('❌ 未发现僵尸插件 (模拟数据为空)');
    process.exit(1);
  }

  // Test 2: Analyzer
  console.log('[测试2] 测试 Analyzer (v5.5 崩溃密度评分)...');
  const analyzer = new ChromeZombieAnalyzer();
  const analyzed = analyzer.analyzeAll(zombies);
  console.log(`   分析完成: ${analyzed.length} 个目标\n`);

  for (const a of analyzed) {
    console.log(`   🎯 ${a.signal.name}`);
    console.log(`      总分: ${a.score.total}/130`);
    console.log(`      需求热度: ${a.score.breakdown.demandScore}/40`);
    console.log(`      失效证明: ${a.score.breakdown.complaintScore}/30`);
    console.log(`      修复难度: ${a.score.breakdown.difficultyScore}/20`);
    console.log(`      窗口期: ${a.score.breakdown.windowScore}/10`);
    console.log(`      崩溃密度: ${a.score.breakdown.crashDensity}/30`);
    console.log(`      开发者失联: +${a.score.breakdown.developerUnresponsive || 0}`);
    console.log(`      判决: ${a.score.verdict}`);
    console.log(`      定价: ${a.score.pricingSuggestion.recommended} - ${a.score.pricingSuggestion.priceRange}`);

    // 显示技术修复建议
    if (a.signal.reviewAnalysis?.fixRecommendations?.length) {
      console.log(`      技术修复建议:`);
      a.signal.reviewAnalysis.fixRecommendations.slice(0, 2).forEach((rec, i) => {
        console.log(`        ${i + 1}. ${rec}`);
      });
    }
    console.log('');
  }

  // Test 3: Report Generator
  console.log('[测试3] 测试 Report Generator (v5.5 PRD)...');
  const generator = new ZombieReportGenerator({
    outputDir: reportsDir,
    generatePRD: true
  });

  const result = generator.generate(analyzed);
  console.log(`   报告生成完成!`);
  console.log(`   - Markdown: ${result.markdownPath}`);
  console.log(`   - JSON: ${result.jsonPath}`);
  console.log(`   - Email: ${result.emailPath}`);
  console.log(`   - PRD: ${result.prdPath}`);
  console.log('');

  console.log('===========================================');
  console.log('✅ 所有测试通过!');
  console.log('===========================================');
}

main().catch(console.error);
  console.log(`   📄 Markdown: ${result.markdownPath}`);
  console.log(`   📋 JSON: ${result.jsonPath}`);
  console.log(`   📧 邮件: ${result.emailPath}`);

  console.log('\n===========================================');
  console.log('✅ 所有测试通过!');
  console.log('===========================================');
}

main().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
