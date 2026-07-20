import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { calculateRisk } from "../strategyEngine.js";

const router = Router();
router.use(requireAuth);

router.post("/", (req, res) => {
  try {
    const result = calculateRisk(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
