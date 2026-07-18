export type BotMode = "OFF" | "ANALYST" | "RADAR";

export interface BotParams {
  amt: number;
  amt_bait: number;
  side: "buy" | "sell";
  offset_ms: number;
  cycle_duration: number;
  w_t: number;
  l_t: number;
  t_bait_start: number;
  ms_time: number;
  bait_offset: number;
  attack_offset: number;
  p_real: number;
  p_bait: number;
  wait_pulse: number;
  symbol?: string;
}

export interface BotStats {
  success: number;
  failed: number;
  total_amount: number;
  avgLatency: number;
  pulse_idx: number;
  scissor_step: number;
}

export interface BotStatus {
  mode: BotMode;
  stats: BotStats;
  params: BotParams;
  targetHitTime: number;
  activeOrdersCount: number;
  baitOrderId: string | null;
  logs?: { id: number, timestamp: number, message: string, type: 'info' | 'error' | 'success' }[];
}
