import { Router, Request, Response } from "express";
import { db } from "../db/connection";
import { listFunctions, getLatestSnapshot } from "../db/queries";

const router = Router();

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Route-style function name → { method, path } */
function parseRouteName(name: string): { method: string; path: string } | null {
  const match = name.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+)$/i);
  if (!match) return null;
  return { method: match[1].toUpperCase(), path: match[2] };
}

/**
 * GET /api/mock-config
 *
 * Returns all observed routes with their sample data, ready for mock server use.
 */
router.get("/", (_req: Request, res: Response) => {
  try {
    const { rows } = listFunctions(db, { limit: 500 });
    const routes: Array<{
      method: string;
      path: string;
      functionName: string;
      module: string;
      sampleInput: unknown;
      sampleOutput: unknown;
      observedAt: string;
    }> = [];

    for (const fn of rows) {
      const parsed = parseRouteName(fn.function_name as string);
      if (!parsed) continue; // Skip non-route functions

      const snapshot = getLatestSnapshot(db, fn.id as number);
      if (!snapshot) continue;

      routes.push({
        method: parsed.method,
        path: parsed.path,
        functionName: fn.function_name as string,
        module: fn.module as string,
        sampleInput: tryParseJson(snapshot.sample_input),
        sampleOutput: tryParseJson(snapshot.sample_output),
        observedAt: snapshot.observed_at as string,
      });
    }

    res.json({ routes });
  } catch (err) {
    console.error("Mock config error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
