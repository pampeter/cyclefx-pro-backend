import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { pair } = req.query;
  const result = pair
    ? await pool.query(`SELECT * FROM sr_levels WHERE user_id = $1 AND pair = $2 ORDER BY price DESC`, [req.userId, pair])
    : await pool.query(`SELECT * FROM sr_levels WHERE user_id = $1 ORDER BY price DESC`, [req.userId]);
  res.json(result.rows);
});

router.post("/", async (req, res) => {
  const { pair, label, price, kind } = req.body;
  const result = await pool.query(
    `INSERT INTO sr_levels (user_id, pair, label, price, kind) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.userId, pair, label || null, price, kind || "level"]
  );
  res.status(201).json(result.rows[0]);
});

router.delete("/:id", async (req, res) => {
  await pool.query(`DELETE FROM sr_levels WHERE id = $1 AND user_id = $2`, [req.params.id, req.userId]);
  res.status(204).end();
});

export default router;
