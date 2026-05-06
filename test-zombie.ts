// test-zombie.ts - Test script for Chrome Zombie Hunter module
import { ChromeZombieFetcher } from './src/fetchers/chromeZombieFetcher.ts';
import { ChromeZombieAnalyzer } from './src/analyzers/chromeZombieAnalyzer.ts';
import { ZombieReportGenerator } from './src/generators/zombieReportGenerator.ts';

async function main() {
  console.log('===========================================');
  console.log('🧟 Chrome Zombie Hunter - Mock Data Test');
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
    console.log('');
  }

  if (zombies.length === 0) {
    console.log('❌ 未发现僵尸插件 (模拟数据为空)');
    process.exit(1);
  }

  // Test 2: Analyzer
  console.log('[测试2] 测试 Analyzer...');
  const analyzer = new ChromeZombieAnalyzer();
  const analyzed = analyzer.analyzeAll(zombies);
  console.log(`   分析完成: ${analyzed.length} 个目标\n`);

  for (const a of analyzed) {
    console.log(`   🎯 ${a.signal.name}`);
    console.log(`      总分: ${a.score.total}/100`);
    console.log(`      需求热度: ${a.score.breakdown.demandScore}/40`);
    console.log(`      失效证明: ${a.score.breakdown.complaintScore}/30`);
    console.log(`      修复难度: ${a.score.breakdown.difficultyScore}/20`);
    console.log(`      窗口期: ${a.score.breakdown.windowScore}/10`);
    console.log(`      判决: ${a.score.verdict}`);
    console.log(`      定价: ${a.score.pricingSuggestion.recommended} - ${a.score.pricingSuggestion.priceRange}`);
    console.log('');
  }

  // Test 3: Report Generator
  console.log('[测试3] 测试 Report Generator...');
  const generator = new ZombieReportGenerator({
    outputDir: './reports'
  });

  const result = generator.generate(analyzed);
  console.log(`   报告生成完成!`);
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
