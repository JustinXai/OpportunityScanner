/**
 * EmailService - 邮件通知服务
 * 扫描完成后将结果发送到指定邮箱
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string[];
}

interface ScanSummary {
  date: string;
  totalSignals: number;
  qualifiedCount: number;
  goCount: number;
  holdCount: number;
  issuesCreated: number;
  duration: string;
  errors: string[];
}

interface GoldenOpportunity {
  signal: {
    platform: string;
    title: string;
    description: string;
    url: string;
    source: string;
  };
  seo: {
    intentKeywords: string[];
    isOneTimeUse: boolean;
    frequencyScore: number;
    highConversionPotential: boolean;
    pricingArbitrage: 'high' | 'medium' | 'low';
    analysis: string;
  };
  risk: {
    total: number;
    securityRedLine: boolean;
    platformBanRisk: number;
  };
  crossValidation: {
    finalConsensus: 'GO' | 'HOLD' | 'REJECT';
    deepseekDefense: string;
    doubaoOffense: string;
  };
}

class EmailService {
  private transporter: Transporter | null = null;
  private config: EmailConfig | null = null;

  /**
   * 初始化邮件服务
   * @returns 是否配置成功
   */
  initialize(): boolean {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587');
    const secure = process.env.SMTP_SECURE === 'true';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || '';
    const to = process.env.SMTP_TO?.split(',').map(e => e.trim()).filter(Boolean) || [];

    if (!host || !user || !pass || to.length === 0) {
      console.log('   📧 邮件服务未配置 (SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_TO)，跳过邮件通知');
      return false;
    }

    this.config = { host, port, secure, user, pass, from, to };

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });

    console.log(`   📧 邮件服务已初始化 (${user} → ${to.join(', ')})`);
    return true;
  }

  /**
   * 发送扫描结果邮件
   */
  async sendScanReport(summary: ScanSummary, opportunities: GoldenOpportunity[]): Promise<boolean> {
    if (!this.transporter || !this.config) {
      console.log('   📧 邮件服务未就绪，跳过发送');
      return false;
    }

    const goOpportunities = opportunities.filter(o => o.crossValidation.finalConsensus === 'GO');
    const holdOpportunities = opportunities.filter(o => o.crossValidation.finalConsensus === 'HOLD');

    const subject = `🎯 商机扫描报告 [${summary.date}] - ${summary.goCount > 0 ? '发现 ' + summary.goCount + ' 个金矿!' : '暂无金矿'}`;

    const html = this.buildEmailHtml(summary, goOpportunities, holdOpportunities);
    const text = this.buildEmailText(summary, goOpportunities, holdOpportunities);

    try {
      const info = await this.transporter.sendMail({
        from: `"商机扫描器" <${this.config.from}>`,
        to: this.config.to.join(', '),
        subject,
        text,
        html
      });

      console.log(`   📧 邮件已发送: ${info.messageId}`);
      return true;
    } catch (error) {
      console.error(`   📧 邮件发送失败: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  private buildEmailHtml(summary: ScanSummary, goOpps: GoldenOpportunity[], holdOpps: GoldenOpportunity[]): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .summary { background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px; margin-bottom: 20px; }
    .stats { display: flex; gap: 20px; flex-wrap: wrap; }
    .stat { background: white; padding: 15px 25px; border-radius: 8px; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .stat-value { font-size: 28px; font-weight: bold; color: #667eea; }
    .stat-label { color: #666; font-size: 14px; }
    .section { margin-bottom: 25px; }
    .section-title { color: #333; border-bottom: 2px solid #667eea; padding-bottom: 10px; margin-bottom: 15px; font-size: 18px; }
    .opportunity { background: #fff; border-left: 4px solid #667eea; padding: 15px; margin-bottom: 15px; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .opportunity.go { border-left-color: #10b981; }
    .opportunity.hold { border-left-color: #f59e0b; }
    .opportunity-title { font-size: 16px; font-weight: bold; color: #1a1a1a; margin-bottom: 8px; }
    .opportunity-meta { color: #666; font-size: 13px; margin-bottom: 10px; }
    .opportunity-keywords { margin-top: 8px; }
    .keyword { display: inline-block; background: #e0e7ff; color: #4338ca; padding: 3px 10px; border-radius: 12px; font-size: 12px; margin: 2px; }
    .opportunity-link { margin-top: 10px; }
    .opportunity-link a { color: #667eea; text-decoration: none; }
    .error { background: #fef2f2; border-left-color: #ef4444; padding: 10px; border-radius: 4px; color: #991b1b; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="header">
    <h1 style="margin:0;">🎯 商机扫描报告</h1>
    <p style="margin:10px 0 0 0;">${summary.date}</p>
  </div>
  
  <div class="summary">
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${summary.totalSignals}</div>
        <div class="stat-label">采集信号</div>
      </div>
      <div class="stat">
        <div class="stat-value">${summary.goCount}</div>
        <div class="stat-label">金矿 🏆</div>
      </div>
      <div class="stat">
        <div class="stat-value">${summary.holdCount}</div>
        <div class="stat-label">观望</div>
      </div>
      <div class="stat">
        <div class="stat-value">${summary.issuesCreated}</div>
        <div class="stat-label">已创建 Issue</div>
      </div>
      <div class="stat">
        <div class="stat-value">${summary.duration}s</div>
        <div class="stat-label">耗时</div>
      </div>
    </div>
  </div>

  ${summary.errors.length > 0 ? `
  <div class="section">
    <div class="section-title">⚠️ 错误信息</div>
    ${summary.errors.map(e => `<div class="error">${e}</div>`).join('')}
  </div>
  ` : ''}

  ${goOpps.length > 0 ? `
  <div class="section">
    <div class="section-title">🏆 金矿机会 (GO)</div>
    ${goOpps.map(opp => this.buildOpportunityHtml(opp, 'go')).join('')}
  </div>
  ` : ''}

  ${holdOpps.length > 0 ? `
  <div class="section">
    <div class="section-title">⏸️ 观望机会 (HOLD)</div>
    ${holdOpps.map(opp => this.buildOpportunityHtml(opp, 'hold')).join('')}
  </div>
  ` : ''}

  ${goOpps.length === 0 && holdOpps.length === 0 ? `
  <div class="section">
    <div class="section-title">📭 扫描结果</div>
    <p>本次扫描未发现符合条件的商业机会。</p>
  </div>
  ` : ''}

  <div class="footer">
    由 OpportunityScanner 自动生成 | ${new Date().toLocaleString('zh-CN')}
  </div>
</body>
</html>`;
  }

  private buildOpportunityHtml(opp: GoldenOpportunity, type: 'go' | 'hold'): string {
    const riskLevel = opp.risk.total > 70 ? '🔴 高风险' : opp.risk.total > 40 ? '🟡 中风险' : '🟢 低风险';
    const arbitrage = { high: '💰 高套利', medium: '💵 中套利', low: '💴 低套利' };

    return `
<div class="opportunity ${type}">
  <div class="opportunity-title">${opp.signal.title}</div>
  <div class="opportunity-meta">
    📍 ${opp.signal.platform} | ${riskLevel} | ${arbitrage[opp.seo.pricingArbitrage]}
  </div>
  <div class="opportunity-keywords">
    ${opp.seo.intentKeywords.map(k => `<span class="keyword">${k}</span>`).join('')}
  </div>
  <p>${opp.seo.analysis.substring(0, 200)}${opp.seo.analysis.length > 200 ? '...' : ''}</p>
  <div class="opportunity-link">
    <a href="${opp.signal.url}" target="_blank">🔗 查看来源</a>
  </div>
</div>`;
  }

  private buildEmailText(summary: ScanSummary, goOpps: GoldenOpportunity[], holdOpps: GoldenOpportunity[]): string {
    const lines = [
      '🎯 商机扫描报告',
      '================',
      `日期: ${summary.date}`,
      `采集信号: ${summary.totalSignals}`,
      `金矿 (GO): ${summary.goCount}`,
      `观望 (HOLD): ${summary.holdCount}`,
      `创建 Issue: ${summary.issuesCreated}`,
      `耗时: ${summary.duration}s`,
      '',
    ];

    if (summary.errors.length > 0) {
      lines.push('⚠️ 错误:', ...summary.errors.map(e => `  - ${e}`), '');
    }

    if (goOpps.length > 0) {
      lines.push('🏆 金矿机会:', '');
      goOpps.forEach((opp, i) => {
        lines.push(`${i + 1}. ${opp.signal.title}`);
        lines.push(`   平台: ${opp.signal.platform} | 风险: ${opp.risk.total}/100`);
        lines.push(`   关键词: ${opp.seo.intentKeywords.join(', ')}`);
        lines.push(`   来源: ${opp.signal.url}`);
        lines.push('');
      });
    }

    return lines.join('\n');
  }

  /**
   * 验证邮件配置
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.verify();
      console.log('   📧 SMTP 连接验证成功');
      return true;
    } catch (error) {
      console.error(`   📧 SMTP 连接验证失败: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }
}

export const emailService = new EmailService();
