import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runScan } from "../src/lib/scanner";

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "Scheduled scans are disabled until CRON_SECRET is configured in the deployment environment." });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized cron request." });
  }

  try {
    const result = await runScan({ forceRefresh: true });
    return res.status(200).json({
      ok: result.results.some((item) => item.action !== "ERROR"),
      generatedAt: result.generatedAt,
      marketRegime: result.market.regime,
      scanned: result.results.length,
      warningCount: result.warnings.length
    });
  } catch {
    return res.status(502).json({ ok: false, error: "Scheduled scan failed." });
  }
}
