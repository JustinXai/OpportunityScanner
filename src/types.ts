// src/types.ts
// 所有模块共享的核心类型定义

export interface PainSignal {
  platform: string;
  title: string;
  description: string;
  url: string;
  sentiment: 'negative' | 'neutral' | 'positive';
  rawComments?: string[];
  source: string;
  timestamp: Date;
  category?: string;
  metadata?: Record<string, unknown>;
}

export interface SEOAnalysis {
  intentKeywords: string[];
  isOneTimeUse: boolean;
  frequencyScore: number;
  seoIntentVolume: number;
  highConversionPotential: boolean;
  pricingArbitrage: 'high' | 'medium' | 'low';
  analysis: string;
}

export interface SherlockRiskScore {
  total: number;
  securityRedLine: boolean;
  infraRedLine: boolean;
  platformBanRisk: number;
  techComplexity: number;
  technicalDebt: string[];
  verdict: 'PROCEED' | 'REVIEW' | 'REJECT' | 'TARGET_ACQUIRED';
  reasoning: string;
}
