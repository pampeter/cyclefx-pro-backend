import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const totals = await pool.query(
    `SELECT
       COUNT(*) AS total_trades,
       COUNT(*) FILTER (WHERE result = 'win') AS wins,
       COUNT(*) FILTER (WHERE result = 'loss') AS losses,
       ROUND(AVG(risk_reward) FILTER (WHERE risk_reward IS NOT NULL), 2) AS avg_rr
     FROM journal_entries WHERE user_id = $1`,
    [req.userId]
  );

  const bySetup = await pool.query(
    `SELECT setup_type,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE result = 'win') AS wins
     FROM journal_entries WHERE user_id = $1 GROUP BY setup_type ORDER BY wins DESC`,
    [req.userId]
  );

  const monthly = await pool.query(
    `SELECT * FROM journal_performance WHERE user_id = $1 ORDER BY month`,
    [req.userId]
  );

  const t = totals.rows[0];
  const closed = Number(t.wins) + Number(t.losses);
  res.json({
    totalTrades: Number(t.total_trades),
    winRate: closed ? +((t.wins / closed) * 100).toFixed(1) : 0,
    lossRate: closed ? +((t.losses / closed) * 100).toFixed(1) : 0,
    avgRR: t.avg_rr,
    bestSetups: bySetup.rows,
    monthly: monthly.rows,
  });
});

export default router;
