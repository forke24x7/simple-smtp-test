// HTTP API for validated SMTP tests and streamed diagnostic results.
import express from "express";
import { configSchema } from "../shared/model.js";
import { runSMTPTest } from "./smtp.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  let active = 0;
  app.post("/api/test", async (req, res) => {
    const origin = req.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== req.get("host")) {
          res.status(403).json({ error: "Anfrage von einer fremden Website abgelehnt." });
          return;
        }
      } catch {
        res.status(403).json({ error: "Ungültiger Origin." });
        return;
      }
    }
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          error: "Bitte die Eingaben prüfen.",
          issues: parsed.error.issues.map((i) => ({ field: i.path[0], message: i.message })),
        });
      return;
    }
    if (active >= 4) {
      res.status(429).json({ error: "Vier Tests laufen bereits. Bitte kurz warten." });
      return;
    }
    active++;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    try {
      await runSMTPTest(parsed.data, (event) => {
        if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
    } finally {
      active--;
      res.end();
    }
  });
  app.use(
    (
      error: { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(error.status === 413 ? 413 : 400)
        .json({ error: error.status === 413 ? "Anfrage zu groß." : "Ungültige Anfrage." });
    },
  );
  return app;
}
