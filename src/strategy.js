// DEPRECATED as of v2 — see strategyEngine.js for the current, actively-used logic.
// This file is kept only for backward compatibility with anything still importing it.
// Pure functions implementing the CycleFX Pro strategy rules.
// Kept isolated from Express/DB code so the exact same logic can be unit tested.

export function computeBias(candles) {
  // candles: [{ open, high, low, close }] chronological, oldest first
  if (!candles || candles.length < 3) {
    return { bias: "unclear", reason: "Need at least 3 candles of 30M data." };
  }
  const highs = candles.map((c) => Number(c.high));
  const lows = candles.map((c) => Number(c.low));

  let higherHighs = true, higherLows = true, lowerHighs = true, lowerLows = true;
  for (let i = 1; i < highs.length; i++) {
    if (highs[i] <= highs[i - 1]) higherHighs = false;
    if (lows[i] <= lows[i - 1]) higherLows = false;
    if (highs[i] >= highs[i - 1]) lowerHighs = false;
    if (lows[i] >= lows[i - 1]) lowerLows = false;
  }

  if (higherHighs && higherLows) return { bias: "bullish", reason: "Higher highs and higher lows." };
  if (lowerHighs && lowerLows) return { bias: "bearish", reason: "Lower highs and lower lows." };
  return { bias: "ranging", reason: "No consistent HH/HL or LH/LL sequence." };
}

export function detectLevel1(candles, bias) {
  if (!candles || candles.length < 2 || bias === "unclear") return null;
  const highs = candles.map((c) => Number(c.high));
  const lows = candles.map((c) => Number(c.low));
  if (bias === "bullish") {
    return { from: Math.min(...lows), to: Math.max(...highs) };
  }
  if (bias === "bearish") {
    return { from: Math.max(...highs), to: Math.min(...lows) };
  }
  return null;
}

export function level3Status({ currentPrice, zoneTop, zoneBottom, bias }) {
  if (currentPrice == null || zoneTop == null || zoneBottom == null) return "waiting";
  if (bias === "bullish" && currentPrice > zoneTop) return "expansion";
  if (bias === "bearish" && currentPrice < zoneBottom) return "expansion";
  if (currentPrice <= zoneTop && currentPrice >= zoneBottom) return "in-zone";
  return "waiting";
}

// Entry confirmation: no trade signal without confirmation; unconfirmed break = invalid setup.
export function entryStatus({ reachedZone, engulfing, bos, rejection, level3 }) {
  const anyConfirmation = engulfing || bos || rejection;
  if (level3 === "expansion" && !anyConfirmation) return "invalid";
  if (reachedZone && anyConfirmation) return "valid";
  if (reachedZone && !anyConfirmation) return "waiting";
  return "idle";
}

// Risk calculator: position size, and default 1:3 / 1:4 take-profit targets.
export function calculateRisk({ entry, stop, riskPct, balance }) {
  entry = Number(entry); stop = Number(stop); riskPct = Number(riskPct); balance = Number(balance);
  if ([entry, stop, riskPct, balance].some((n) => Number.isNaN(n)) || entry === stop) {
    throw new Error("Invalid risk calculator inputs");
  }
  const direction = entry > stop ? 1 : -1;
  const riskAmount = balance * (riskPct / 100);
  const stopDistance = Math.abs(entry - stop);
  const positionSize = riskAmount / stopDistance;
  return {
    direction: direction === 1 ? "long" : "short",
    riskAmount,
    stopDistance,
    positionSize,
    takeProfit3R: entry + direction * stopDistance * 3,
    takeProfit4R: entry + direction * stopDistance * 4,
  };
}
