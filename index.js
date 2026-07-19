import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

import authRoutes from "./routes/auth.js";
import analysesRoutes from "./routes/analyses.js";
import calculatorRoutes from "./routes/calculator.js";
import srLevelsRoutes from "./routes/srLevels.js";
import journalRoutes from "./routes/journal.js";
import performanceRoutes from "./routes/performance.js";
import mt5Routes from "./routes/mt5.js";

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.resolve("uploads")));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/analyses", analysesRoutes);
app.use("/api/calculator", calculatorRoutes);
app.use("/api/sr-levels", srLevelsRoutes);
app.use("/api/journal", journalRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/mt5", mt5Routes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`CycleFX Pro API listening on port ${PORT}`));
