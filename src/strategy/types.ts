// ============================================================================
// /strategy/types.ts — shared type contracts for the PPMCS engine family.
// ----------------------------------------------------------------------------
// WHY THIS FILE EXISTS: every module in /strategy, /backtesting, /execution
// and /data needs to agree on what a "candle," a "symbol," a "level," and a
// "signal" look like. Defining them once here means PPMCSStrategyEngine,
// ReplayEngine, and the future TradingView chart module can all be built
// against the same shapes without importing each other's internals.
//
// NOTHING IN THIS FILE ENCODES STRATEGY RULES. It only describes data shapes.
// The actual PPMCS rules (how Level 1/2/3 are detected, what confirms a
// continuation vs a reversal, etc.) are intentionally NOT decided here —
// see PPMCSStrategyEngine.ts for the placeholder methods awaiting your
// chart examples.
// ============================================================================

/** A single OHLC candle on any timeframe. Timestamps are epoch milliseconds. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Supported timeframes. Extend as needed — nothing downstream assumes only these two. */
export type Timeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "H6" | "D1";

/** Any MT5-style symbol. Deliberately a plain string, not an enum — see SymbolManager
 *  for the registry of known symbols (XAUUSD, USDJPY, EURUSD, GBPUSD, NAS100, US30, ...).
 *  The engine must never branch on a specific symbol string; symbol-specific
 *  metadata (pip size, contract size) belongs in SymbolManager, not in strategy logic. */
export type SymbolName = string;

export type Bias = "bullish" | "bearish" | "ranging" | "unclear";

/** A detected swing point on the structure (fractal high/low). */
export interface SwingPoint {
  time: number;
  price: number;
  type: "high" | "low";
  label?: string; // e.g. "HH" | "HL" | "LH" | "LL" — assigned once PPMCS rules are defined
}

/** A price level — could be Level 1's impulse boundary, a support/resistance
 *  line, or any other single-price marker the strategy cares about. */
export interface Level {
  id: string;
  price: number;
  label: string;
  createdAt: number;
}

/** A price range — used for Level 2 (decision zone) and any other zone concept. */
export interface Zone {
  id: string;
  top: number;
  bottom: number;
  label: string;
  createdAt: number;
}

/** Output of detecting Level 1 (impulse). Shape is stable; the detection
 *  logic behind it is a placeholder until PPMCS rules are supplied. */
export interface Level1Result {
  detected: boolean;
  level?: Level;
  meta?: Record<string, unknown>;
}

/** Output of detecting Level 2 (decision zone). */
export interface Level2Result {
  detected: boolean;
  zone?: Zone;
  meta?: Record<string, unknown>;
}

/** Output of detecting Level 3 (expansion/continuation). */
export interface Level3Result {
  detected: boolean;
  level?: Level;
  meta?: Record<string, unknown>;
}

/** A "decision point" is PPMCS terminology for the moment price must choose
 *  to continue or reverse relative to the cycle. Exact detection TBD. */
export interface DecisionPointResult {
  detected: boolean;
  time?: number;
  price?: number;
  meta?: Record<string, unknown>;
}

/** Result of asking "did price confirm continuation of the existing cycle?" */
export interface ContinuationResult {
  confirmed: boolean;
  confidence?: number; // 0-100, reserved for once confirmation rules exist
  meta?: Record<string, unknown>;
}

/** Result of asking "did price confirm a reversal of the existing cycle?" */
export interface ReversalResult {
  confirmed: boolean;
  confidence?: number;
  meta?: Record<string, unknown>;
}

/** Where a given cycle currently sits. CycleCounter owns advancing this. */
export type CyclePhase = "idle" | "level1" | "level2" | "level3" | "complete" | "invalidated";

export interface CycleState {
  symbol: SymbolName;
  timeframe: Timeframe;
  phase: CyclePhase;
  cycleIndex: number; // increments each time a new cycle starts
  level1?: Level;
  level2?: Zone;
  level3?: Level;
  startedAt?: number;
  updatedAt?: number;
}

/** The final rollup the UI (Strategy Card / dashboard) consumes. */
export type SignalStatus = "BUY_READY" | "SELL_READY" | "WAIT" | "INVALID" | "NOT_IMPLEMENTED";

export interface StrategySignal {
  symbol: SymbolName;
  timeframe: Timeframe;
  bias: Bias;
  cycle: CycleState;
  confidence: number; // 0-100
  status: SignalStatus;
  generatedAt: number;
  meta?: Record<string, unknown>;
}

/** Context object passed into every engine call. Bundles the current symbol/
 *  timeframe/candle history so no module needs to reach into global state. */
export interface EngineContext {
  symbol: SymbolName;
  timeframe: Timeframe;
  candles: Candle[]; // history available so far — NEVER includes future candles during replay
}

// ============================================================================
// V6 additions — Daily Cycle, 6-Hour Structure, PPMCS Level, QP Engine,
// Execution Engine. See DailyCycleEngine.ts / SixHourStructureEngine.ts /
// QPEngine.ts / execution/ExecutionEngine.ts for the logic; this section is
// only the shared shapes, same convention as the rest of this file.
// ============================================================================

/** Raw multi-timeframe input for the V6 orchestrator. Only M30 and M1 are
 *  required from the data source (what MT5CandleProvider already supplies);
 *  daily and 6-hour candles are aggregated internally via CandleAggregator. */
export interface PPMCSMarketData {
  symbol: SymbolName;
  m30: Candle[];
  m1: Candle[];
}

export type DailyCyclePattern = "double_top" | "double_bottom" | "none";

export interface DailyCycleState {
  dailyBias: Bias;
  cycleStart: number | null; // epoch ms — when the current cycle was confirmed to start
  cycleEnd: number | null;   // projected end (cycleStart + 24h), null until cycleStart known
  cycleProgress: number;     // 0-1, how far through the projected cycle "now" is
  currentDailyCycle: number; // increments each time a new cycle is confirmed
  confirmedPattern: DailyCyclePattern;
  meta?: Record<string, unknown>;
}

export type SixHourTrend = "bullish" | "bearish" | "transition";

export interface SixHourStructureState {
  trend: SixHourTrend;
  reason: string;
  labeledSwings: SwingPoint[];
}

export type PPMCSLevel = "NONE" | "LEVEL1" | "LEVEL2" | "LEVEL3";
export type PPMCSOpportunity = 0 | 1 | 2 | 3; // 0 = none active yet

export type PPMCSEngineState = "WAITING" | "WATCHING" | "DECISION" | "READY" | "EXECUTING" | "INVALID";

export interface QPLevel {
  price: number;
  kind: "spacing" | "mid";
  index: number; // signed offset from the reference price, in spacing units
}

export interface QPLevelSet {
  symbol: SymbolName;
  referencePrice: number;
  spacingPips: number;
  midPips: number;
  levels: QPLevel[];
  nearestSupport: QPLevel | null;
  nearestResistance: QPLevel | null;
}

/** Output of ExecutionEngine — the 1-minute BOS -> retest -> confirmation
 *  sequence. `phase` lets the UI show exactly what the engine is watching
 *  for next, per the mission brief's "show exactly what the engine is
 *  thinking" requirement for replay. */
export type ExecutionPhase = "idle" | "waiting_bos" | "waiting_retest" | "waiting_confirmation" | "ready" | "invalidated";

export interface ExecutionSignal {
  phase: ExecutionPhase;
  direction: "bullish" | "bearish";
  brokenLevel?: number;
  retestPrice?: number;
  confirmationCandle?: Candle;
  reason: string;
}

/** The full V6 rollup — everything the PPMCS Engine dashboard panel needs. */
export interface PPMCSSignal {
  symbol: SymbolName;
  currentPrice: number | null;
  dailyCycle: DailyCycleState;
  sixHour: SixHourStructureState;
  currentLevel: PPMCSLevel;
  currentOpportunity: PPMCSOpportunity;
  currentState: PPMCSEngineState;
  qp: QPLevelSet | null;
  execution: ExecutionSignal | null;
  status: SignalStatus;
  generatedAt: number;
  meta?: Record<string, unknown>;
}
