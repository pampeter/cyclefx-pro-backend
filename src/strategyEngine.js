// ============================================================================
// CycleFX Pro — Strategy Engine v2
// ----------------------------------------------------------------------------
// Pure, framework-agnostic logic. No DOM, no HTTP, no state — every function
// takes plain data in and returns plain data out, so this exact file (or a
// byte-for-byte port of it) is shared by the backend API, the React build,
// and the standalone phone PWA. When you change a rule, change it here first.
//
// ENGINEERING DECISIONS (documented per the request to not stop and ask):
//
// 1. Swing detection uses a fractal method: a candle at index i is a swing
//    high if its high is the max within a window of `lookback` candles on
//    each side (default 1 = classic 3-bar fractal). Same for swing lows.
//    This replaces the v1 "every single candle must rise" bias check, which
//    was a crude placeholder — real structure analysis compares swing points,
//    not every candle. v1's function is kept as `legacyMonotonicBias()` for
//    backward compatibility/reference only; nothing new calls it.
//
// 2. Market structure bias comes from the last two confirmed swing highs and
//    the last two confirmed swing lows: HH+HL => bullish, LH+LL => bearish,
//    anything else => ranging. Needs at least 2 swing highs and 2 swing lows,
//    so at least ~5 candles in practice.
//
// 3. BOS (Break of Structure) = price closes beyond the most recent swing
//    point *in the direction of the current bias* → continuation signal.
//    CHoCH (Change of Character) = price closes beyond the most recent swing
//    point *against* the current bias → first warning of a possible reversal.
//    These are mutually exclusive per bar.
//
// 4. Level 1 (Impulse) = the leg from the swing that started the current
//    bias to the most recent confirming swing extreme.
//
// 5. Level 2 (Decision Zone) is still a manual/discretionary input — that
//    was correct in v1 and stays true to the strategy. What's new: 
//    `suggestLevel2Zone()` offers a 38.2%–61.8% Fibonacci retracement of the
//    Level 1 leg as a *starting suggestion* the trader can accept or
//    override. It never auto-applies.
//
// 6. Confidence score (0–100) is a weighted sum of four components, chosen
//    to mirror how a discretionary trader actually evaluates a setup:
//      - Trend quality       (0–30): consistency of the swing sequence
//      - Market structure    (0–25): BOS confirms (full credit), CHoCH
//                                     warns (low credit), neither (0)
//      - Confirmation signals(0–25): engulfing / BOS(1M) / rejection,
//                                     ~8 pts each, capped at 25
//      - Decision zone quality(0–20): how well the manual zone lines up
//                                     with the 38.2–61.8% fib pocket of
//                                     the Level 1 leg
//    Weights are a reasonable default, not a backtested constant — they're
//    exposed as `CONFIDENCE_WEIGHTS` so they can be tuned later without
//    touching the scoring logic itself.
// ============================================================================

export const CONFIDENCE_WEIGHTS = {
  trendQuality: 30,
  marketStructure: 25,
  confirmationSignals: 25,
  zoneQuality: 20,
};

// ---------------------------------------------------------------------------
// 1. Swing detection
// ---------------------------------------------------------------------------
export function computeSwings(candles, lookback = 1) {
  const n = candles.length;
  const swings = []; // { index, type: 'high'|'low', price, time }
  for (let i = lookback; i < n - lookback; i++) {
    const c = candles[i];
    let isHigh = true, isLow = true;
    for (let k = 1; k <= lookback; k++) {
      if (candles[i - k].high >= c.high || candles[i + k].high >= c.high) isHigh = false;
      if (candles[i - k].low <= c.low || candles[i + k].low <= c.low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, type: "high", price: Number(c.high), time: c.time ?? i });
    if (isLow) swings.push({ index: i, type: "low", price: Number(c.low), time: c.time ?? i });
  }
  return swings;
}

// ---------------------------------------------------------------------------
// 2. Structure classification: bias + HH/HL/LH/LL labels + BOS/CHoCH
// ---------------------------------------------------------------------------
export function classifyStructure(candles, lookback = 1) {
  const swings = computeSwings(candles, lookback);
  const highs = swings.filter((s) => s.type === "high");
  const lows = swings.filter((s) => s.type === "low");

  if (highs.length < 2 || lows.length < 2) {
    return {
      bias: "unclear",
      reason: "Not enough confirmed swing points yet (need at least 2 swing highs and 2 swing lows).",
      swings, labeledSwings: [], lastBOS: null, lastCHoCH: null,
    };
  }

  const [h2, h1] = highs.slice(-2); // h2 older, h1 newer
  const [l2, l1] = lows.slice(-2);

  const higherHigh = h1.price > h2.price;
  const higherLow = l1.price > l2.price;
  const lowerHigh = h1.price < h2.price;
  const lowerLow = l1.price < l2.price;

  let bias = "ranging";
  let reason = "Mixed swing sequence — no clean HH/HL or LH/LL pattern.";
  if (higherHigh && higherLow) { bias = "bullish"; reason = "Most recent swings show a Higher High and a Higher Low."; }
  else if (lowerHigh && lowerLow) { bias = "bearish"; reason = "Most recent swings show a Lower High and a Lower Low."; }

  // Label the swings for display: HH / HL / LH / LL relative to the prior same-type swing
  const labeledSwings = [];
  let prevHigh = null, prevLow = null;
  for (const s of swings) {
    if (s.type === "high") {
      const label = prevHigh == null ? "H" : s.price > prevHigh.price ? "HH" : s.price < prevHigh.price ? "LH" : "EQ-H";
      labeledSwings.push({ ...s, label });
      prevHigh = s;
    } else {
      const label = prevLow == null ? "L" : s.price > prevLow.price ? "HL" : s.price < prevLow.price ? "LL" : "EQ-L";
      labeledSwings.push({ ...s, label });
      prevLow = s;
    }
  }

  // BOS / CHoCH: compare the latest close to the most recent swing high/low
  // that preceded it.
  const lastCandle = candles[candles.length - 1];
  const priorHigh = [...highs].reverse().find((s) => s.index < n_minus_1(candles));
  const priorLow = [...lows].reverse().find((s) => s.index < n_minus_1(candles));
  let lastBOS = null, lastCHoCH = null;

  if (bias === "bullish" && priorHigh && Number(lastCandle.close) > priorHigh.price) {
    lastBOS = { direction: "bullish", brokenLevel: priorHigh.price };
  } else if (bias === "bullish" && priorLow && Number(lastCandle.close) < priorLow.price) {
    lastCHoCH = { direction: "bearish-warning", brokenLevel: priorLow.price };
  } else if (bias === "bearish" && priorLow && Number(lastCandle.close) < priorLow.price) {
    lastBOS = { direction: "bearish", brokenLevel: priorLow.price };
  } else if (bias === "bearish" && priorHigh && Number(lastCandle.close) > priorHigh.price) {
    lastCHoCH = { direction: "bullish-warning", brokenLevel: priorHigh.price };
  }

  return { bias, reason, swings, labeledSwings, lastBOS, lastCHoCH, latestSwingHigh: h1, latestSwingLow: l1 };
}
function n_minus_1(candles) { return candles.length - 1; }

// Kept only for reference / backward compatibility — superseded by classifyStructure().
export function legacyMonotonicBias(candles) {
  if (!candles || candles.length < 3) return { bias: "unclear", reason: "Need at least 3 candles of 30M data." };
  const highs = candles.map((c) => Number(c.high));
  const lows = candles.map((c) => Number(c.low));
  let hh = true, hl = true, lh = true, ll = true;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i] <= highs[i - 1]) hh = false;
    if (lows[i] <= lows[i - 1]) hl = false;
    if (highs[i] >= highs[i - 1]) lh = false;
    if (lows[i] >= lows[i - 1]) ll = false;
  }
  if (hh && hl) return { bias: "bullish", reason: "Higher highs and higher lows." };
  if (lh && ll) return { bias: "bearish", reason: "Lower highs and lower lows." };
  return { bias: "ranging", reason: "No consistent HH/HL or LH/LL sequence." };
}

// ---------------------------------------------------------------------------
// 3. Level 1 — Impulse leg
// ---------------------------------------------------------------------------
export function detectLevel1(structure) {
  const { bias, latestSwingHigh, latestSwingLow } = structure;
  if (bias === "unclear" || bias === "ranging" || !latestSwingHigh || !latestSwingLow) return null;
  if (bias === "bullish") return { from: latestSwingLow.price, to: latestSwingHigh.price, direction: "up" };
  return { from: latestSwingHigh.price, to: latestSwingLow.price, direction: "down" };
}

// ---------------------------------------------------------------------------
// 4. Level 2 — Decision zone (manual input; this only *suggests* a starting box)
// ---------------------------------------------------------------------------
export function suggestLevel2Zone(level1) {
  if (!level1) return null;
  const { from, to } = level1;
  const range = Math.abs(to - from);
  const dir = to > from ? 1 : -1;
  // Retrace 38.2%-61.8% back from the impulse's endpoint
  const top = to - dir * range * 0.382;
  const bottom = to - dir * range * 0.618;
  return { top: Math.max(top, bottom), bottom: Math.min(top, bottom) };
}

function zoneQualityScore(zone, level1) {
  if (!zone || !zone.top || !zone.bottom || !level1) return 0;
  const suggested = suggestLevel2Zone(level1);
  if (!suggested) return 0;
  const zoneMid = (Number(zone.top) + Number(zone.bottom)) / 2;
  const suggestedMid = (suggested.top + suggested.bottom) / 2;
  const range = Math.abs(level1.to - level1.from) || 1;
  const distanceRatio = Math.abs(zoneMid - suggestedMid) / range;
  // Full credit if centered within the fib pocket, decaying linearly to 0 by 40% of range away
  const score = Math.max(0, 1 - distanceRatio / 0.4);
  return score * CONFIDENCE_WEIGHTS.zoneQuality;
}

// ---------------------------------------------------------------------------
// 5. Level 3 — Expansion status
// ---------------------------------------------------------------------------
export function level3Status({ currentPrice, zoneTop, zoneBottom, bias }) {
  const p = Number(currentPrice), t = Number(zoneTop), b = Number(zoneBottom);
  if (currentPrice === "" || currentPrice == null || isNaN(p) || isNaN(t) || isNaN(b)) return "waiting";
  if (bias === "bullish" && p > t) return "expansion";
  if (bias === "bearish" && p < b) return "expansion";
  if (p <= t && p >= b) return "in-zone";
  return "waiting";
}

// ---------------------------------------------------------------------------
// 6. Entry confirmation status (unchanged rule from v1: no signal without
//    confirmation; an unconfirmed break of the zone is explicitly invalid)
// ---------------------------------------------------------------------------
export function entryStatus({ reachedZone, engulfing, bos, rejection, level3 }) {
  const anyConfirmation = engulfing || bos || rejection;
  if (level3 === "expansion" && !anyConfirmation) return "invalid";
  if (reachedZone && anyConfirmation) return "valid";
  if (reachedZone && !anyConfirmation) return "waiting";
  return "idle";
}

// ---------------------------------------------------------------------------
// 7. Confidence score (0-100) + breakdown
// ---------------------------------------------------------------------------
export function computeConfidence({ structure, zone, confirmations, level3 }) {
  const w = CONFIDENCE_WEIGHTS;
  const breakdown = { trendQuality: 0, marketStructure: 0, confirmationSignals: 0, zoneQuality: 0 };

  // Trend quality: reward a longer run of swings agreeing with the bias.
  if (structure.bias === "bullish" || structure.bias === "bearish") {
    const relevant = structure.labeledSwings.filter((s) =>
      structure.bias === "bullish" ? s.label === "HH" || s.label === "HL" : s.label === "LH" || s.label === "LL"
    );
    const agreeing = relevant.length;
    breakdown.trendQuality = Math.min(1, agreeing / 4) * w.trendQuality; // 4+ agreeing swings = full marks
  }

  // Market structure: BOS confirms, CHoCH warns
  if (structure.lastBOS) breakdown.marketStructure = w.marketStructure;
  else if (structure.lastCHoCH) breakdown.marketStructure = w.marketStructure * 0.2;

  // Confirmation signals
  if (confirmations) {
    const each = w.confirmationSignals / 3;
    breakdown.confirmationSignals =
      (confirmations.engulfing ? each : 0) + (confirmations.bos ? each : 0) + (confirmations.rejection ? each : 0);
  }

  // Decision zone quality
  const level1 = detectLevel1(structure);
  breakdown.zoneQuality = zoneQualityScore(zone, level1);

  const score = Math.round(
    breakdown.trendQuality + breakdown.marketStructure + breakdown.confirmationSignals + breakdown.zoneQuality
  );
  return { score, breakdown };
}

// ---------------------------------------------------------------------------
// 8. Overall signal status for the Strategy Card
// ---------------------------------------------------------------------------
export function getSignalStatus({ bias, entryStatus: es, confidence }) {
  if (es === "invalid") return "INVALID";
  if (bias === "unclear" || bias === "ranging") return "WAIT";
  if (es === "valid" && confidence >= 70) return bias === "bullish" ? "BUY_READY" : "SELL_READY";
  return "WAIT";
}

// ---------------------------------------------------------------------------
// 9. Risk calculator (unchanged from v1)
// ---------------------------------------------------------------------------
export function calculateRisk({ entry, stop, riskPct, balance }) {
  entry = Number(entry); stop = Number(stop); riskPct = Number(riskPct); balance = Number(balance);
  if ([entry, stop, riskPct, balance].some((v) => Number.isNaN(v)) || entry === stop) {
    throw new Error("Invalid risk calculator inputs");
  }
  const direction = entry > stop ? 1 : -1;
  const riskAmount = balance * (riskPct / 100);
  const stopDistance = Math.abs(entry - stop);
  const positionSize = riskAmount / stopDistance;
  return {
    direction: direction === 1 ? "long" : "short",
    riskAmount, stopDistance, positionSize,
    takeProfit3R: entry + direction * stopDistance * 3,
    takeProfit4R: entry + direction * stopDistance * 4,
  };
}
