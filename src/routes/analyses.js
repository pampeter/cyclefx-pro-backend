import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import {
  classifyStructure, detectLevel1, suggestLevel2Zone, level3Status,
  entryStatus, computeConfidence, getSignalStatus,
} from "../strategyEngine.js";

const router = Router();
router.use(requireAuth);

// Create an analysis from 30M candles + optional Level 2 zone.
// v2: runs the full Strategy Engine (swing structure, BOS/CHoCH, Level 1,
// suggested zone) instead of the v1 naive monotonic bias check.
router.post("/", async (req, res) => {
  const { pair, candles, zoneTop, zoneBottom } = req.body;
  const structure = classifyStructure(candles);
  const { bias, reason } = structure;
  const l1 = detectLevel1(structure);
  const suggestedZone = suggestLevel2Zone(l1);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const analysisResult = await client.query(
      `INSERT INTO analyses (user_id, pair, bias, level1_from, level1_to, level2_zone_top, level2_zone_bottom)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.userId, pair, bias, l1?.from ?? null, l1?.to ?? null, zoneTop ?? null, zoneBottom ?? null]
    );
    const analysis = analysisResult.rows[0];

    for (let i = 0; i < (candles || []).length; i++) {
      const c = candles[i];
      await client.query(
        `INSERT INTO candles_30m (analysis_id, sequence_index, open, high, low, close)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [analysis.id, i, c.open, c.high, c.low, c.close]
      );
    }
    await client.query("COMMIT");
    res.status(201).json({
      analysis, reason,
      structure: { labeledSwings: structure.labeledSwings, lastBOS: structure.lastBOS, lastCHoCH: structure.lastCHoCH },
      suggestedZone,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Failed to save analysis" });
  } finally {
    client.release();
  }
});

router.get("/", async (req, res) => {
  const result = await pool.query(`SELECT * FROM analyses WHERE user_id = $1 ORDER BY created_at DESC`, [req.userId]);
  res.json(result.rows);
});

// Update the current price to evaluate Level 3 expansion status.
router.patch("/:id/price", async (req, res) => {
  const { currentPrice } = req.body;
  const result = await pool.query(`SELECT * FROM analyses WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  const analysis = result.rows[0];
  if (!analysis) return res.status(404).json({ error: "Analysis not found" });

  const status = level3Status({
    currentPrice: Number(currentPrice),
    zoneTop: analysis.level2_zone_top,
    zoneBottom: analysis.level2_zone_bottom,
    bias: analysis.bias,
  });
  const updated = await pool.query(
    `UPDATE analyses SET level3_status = $1 WHERE id = $2 RETURNING *`,
    [status, analysis.id]
  );
  res.json(updated.rows[0]);
});

// Submit 1-minute confirmation checklist; returns entry status per strategy rules.
router.post("/:id/confirmations", async (req, res) => {
  const { reachedZone, engulfing, bos, rejection } = req.body;
  const result = await pool.query(`SELECT * FROM analyses WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  const analysis = result.rows[0];
  if (!analysis) return res.status(404).json({ error: "Analysis not found" });

  const status = entryStatus({ reachedZone, engulfing, bos, rejection, level3: analysis.level3_status });
  const inserted = await pool.query(
    `INSERT INTO confirmations (analysis_id, reached_zone, engulfing_candle, break_of_structure, rejection_candle, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [analysis.id, !!reachedZone, !!engulfing, !!bos, !!rejection, status]
  );
  res.status(201).json(inserted.rows[0]);
});

// Strategy Card: the single endpoint the dashboard's Strategy Card widget calls.
// Recomputes structure from the stored candles and rolls up bias, level,
// zone, confirmation status, confidence score, and BUY/SELL/WAIT/INVALID.
router.get("/:id/strategy-card", async (req, res) => {
  const analysisRes = await pool.query(`SELECT * FROM analyses WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  const analysis = analysisRes.rows[0];
  if (!analysis) return res.status(404).json({ error: "Analysis not found" });

  const candlesRes = await pool.query(
    `SELECT open, high, low, close FROM candles_30m WHERE analysis_id = $1 ORDER BY sequence_index ASC`,
    [analysis.id]
  );
  const confirmRes = await pool.query(
    `SELECT * FROM confirmations WHERE analysis_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [analysis.id]
  );
  const confirmations = confirmRes.rows[0] || {};

  const structure = classifyStructure(candlesRes.rows);
  const l3 = level3Status({
    currentPrice: req.query.currentPrice, zoneTop: analysis.level2_zone_top,
    zoneBottom: analysis.level2_zone_bottom, bias: structure.bias,
  });
  const es = entryStatus({
    reachedZone: confirmations.reached_zone, engulfing: confirmations.engulfing_candle,
    bos: confirmations.break_of_structure, rejection: confirmations.rejection_candle, level3: l3,
  });
  const { score, breakdown } = computeConfidence({
    structure,
    zone: { top: analysis.level2_zone_top, bottom: analysis.level2_zone_bottom },
    confirmations: {
      engulfing: confirmations.engulfing_candle, bos: confirmations.break_of_structure, rejection: confirmations.rejection_candle,
    },
    level3: l3,
  });
  const signal = getSignalStatus({ bias: structure.bias, entryStatus: es, confidence: score });

  await pool.query(
    `UPDATE analyses SET confidence_score = $1, signal_status = $2,
       market_structure = $3, last_structure_event = $4 WHERE id = $5`,
    [score, signal, structure.bias === "unclear" ? null : structure.bias,
     structure.lastBOS ? "BOS" : structure.lastCHoCH ? "CHoCH" : null, analysis.id]
  );

  res.json({
    bias: structure.bias,
    marketStructure: structure.reason,
    currentLevel: l3 === "expansion" ? "Level 3 (Expansion)" : (analysis.level2_zone_top ? "Level 2 (Decision Zone)" : "Level 1 (Impulse)"),
    decisionZone: { top: analysis.level2_zone_top, bottom: analysis.level2_zone_bottom },
    confirmationStatus: es,
    confidence: { score, breakdown },
    signal,
  });
});

export default router;
