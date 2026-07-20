import { Router } from "express";
import multer from "multer";
import path from "path";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.diskStorage({
    destination: "uploads/screenshots",
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.post("/", upload.single("screenshot"), async (req, res) => {
  const {
    tradeDate, pair, marketBias, setupType, entry, stopLoss, takeProfit,
    riskReward, result, notes, analysisId, srLevelIds,
  } = req.body;

  const screenshotUrl = req.file ? `/uploads/screenshots/${path.basename(req.file.path)}` : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO journal_entries
        (user_id, analysis_id, trade_date, pair, screenshot_url, market_bias, setup_type,
         entry_price, stop_loss, take_profit, risk_reward, result, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.userId, analysisId || null, tradeDate, pair, screenshotUrl, marketBias, setupType,
       entry, stopLoss, takeProfit || null, riskReward || null, result || "open", notes || null]
    );
    const entryRow = inserted.rows[0];

    const ids = srLevelIds ? JSON.parse(srLevelIds) : [];
    for (const srId of ids) {
      await client.query(
        `INSERT INTO journal_entry_sr_levels (journal_entry_id, sr_level_id) VALUES ($1,$2)`,
        [entryRow.id, srId]
      );
    }
    await client.query("COMMIT");
    res.status(201).json(entryRow);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Failed to save journal entry" });
  } finally {
    client.release();
  }
});

router.get("/", async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM journal_entries WHERE user_id = $1 ORDER BY trade_date DESC`,
    [req.userId]
  );
  res.json(result.rows);
});

router.patch("/:id", async (req, res) => {
  const { result, notes, takeProfit, riskReward } = req.body;
  const updated = await pool.query(
    `UPDATE journal_entries SET
      result = COALESCE($1, result), notes = COALESCE($2, notes),
      take_profit = COALESCE($3, take_profit), risk_reward = COALESCE($4, risk_reward)
     WHERE id = $5 AND user_id = $6 RETURNING *`,
    [result, notes, takeProfit, riskReward, req.params.id, req.userId]
  );
  if (!updated.rows[0]) return res.status(404).json({ error: "Not found" });
  res.json(updated.rows[0]);
});

router.delete("/:id", async (req, res) => {
  await pool.query(`DELETE FROM journal_entries WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  res.status(204).end();
});

export default router;
