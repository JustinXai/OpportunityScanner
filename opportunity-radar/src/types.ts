// Opportunity Radar V2 - 类型定义
// Signal Event 扫描器核心数据结构

export type SourceType =
  | "product_hunt"
  | "reddit"
  | "indie_hackers"
  | "flippa"
  | "github"
  | "hacker_news"
  | "google_search"
  | "ads_library"
  | "manual";

export type Decision =
  | "IGNORE"
  | "WATCH"
  | "PROBE"
  | "BUILD"
  | "MERGE_INTO_CURRENT";

export type SignalLevel = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * 机会信号 - 扫描器的基本单位
 */
export interface OpportunitySignal {
  // 唯一标识
  id: string;

  // ========== 来源信息 ==========
  discovered_at: string;
  source_type: SourceType;
  source_url: string;
  source_title: string;
  source_date: string;

  // ========== 原始对象 ==========
  company_or_product: string;
  category: string;
  one_line_pitch: string;
  tags: string[];

  // ========== 证据信号 ==========
  money_signal: string;
  money_signal_level: SignalLevel;
  traction_signal: string;
  pain_signal: string;
  infra_signal: string;
  distribution_signal: string;
  trust_signal: string;

  // ========== 解析 ==========
  hidden_demand: string;
  likely_buyer: string;
  why_now: string;
  competitors: string[];
  user_complaint_keywords: string[];

  // ========== 和 RutaAPI/API Doctor 的协同 ==========
  fit_with_rutaapi: SignalLevel;
  fit_with_api_doctor: SignalLevel;
  solo_founder_feasibility: SignalLevel;
  can_ship_in_7_days: boolean;

  // ========== 风险 ==========
  compliance_risk: SignalLevel;
  competition_risk: SignalLevel;
  data_confidence: SignalLevel;

  // ========== 总分和决策 ==========
  radar_score: number;
  decision: Decision;
  next_action: string;
}

/**
 * 原始信号（LLM 分类前）
 */
export interface RawSignal {
  id: string;
  source_type: SourceType;
  source_url: string;
  source_title: string;
  source_date: string;
  raw_content: string;
  discovered_at: string;
  keywords_matched: string[];
}

/**
 * LLM 分类结果
 */
export interface ClassificationResult {
  company_or_product: string;
  one_line_pitch: string;
  source_date: string;
  fact_summary: string;
  money_signal: string;
  money_signal_level: SignalLevel;
  pain_signal: string;
  pain_signal_level: SignalLevel;
  infra_signal: string;
  distribution_signal: string;
  trust_signal: string;
  hidden_demand: string;
  likely_buyer: string;
  fit_with_rutaapi: SignalLevel;
  fit_with_api_doctor: SignalLevel;
  solo_founder_feasibility: SignalLevel;
  compliance_risk: SignalLevel;
  distraction_risk: SignalLevel;
  missing_reason?: string;
  radar_score: number;
  decision: Decision;
  next_action: string;
}

/**
 * 扫描配置
 */
export interface RadarConfig {
  // API Keys
  deepseek_api_key?: string;
  serper_api_key?: string;
  ph_api_token?: string;
  github_token?: string;

  // 扫描范围
  enabled_sources: SourceType[];
  scan_interval_days: number;
  max_signals_per_source: number;

  // 评分阈值
  build_threshold: number;
  probe_threshold: number;
  watch_threshold: number;
  require_fit_for_build: SignalLevel;

  // 输出目录
  output_dir: string;
  runs_dir: string;
}

/**
 * 扫描运行结果
 */
export interface ScanRun {
  run_id: string;
  started_at: string;
  completed_at: string;
  sources_scanned: SourceType[];
  raw_signals_count: number;
  classified_signals_count: number;
  signals: OpportunitySignal[];
  summary: {
    ignore_count: number;
    watch_count: number;
    probe_count: number;
    build_count: number;
    merge_count: number;
  };
}
