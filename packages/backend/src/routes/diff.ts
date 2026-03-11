import { Router, Request, Response } from "express";
import { db } from "../db/connection";
import { diffTypes } from "../services/type-differ";
import { TypeNode } from "../types";

const router = Router();

interface DriftEntry {
  functionName: string;
  module: string;
  language: string;
  from: { id: number; env: string; observed_at: string; type_hash: string };
  to: { id: number; env: string; observed_at: string; type_hash: string };
  diffs: Array<{ kind: string; path: string; from?: unknown; to?: unknown; type?: unknown }>;
}

// GET / — cross-function type drift report
// Query params:
//   since: ISO datetime string — only show changes after this time
//   env1, env2: compare latest snapshots across environments
//   env: filter functions by environment
router.get("/", (req: Request, res: Response) => {
  try {
    const { since, env1, env2, env } = req.query;

    if (env1 && env2) {
      // Cross-environment diff: for each function, compare latest snapshot in env1 vs env2
      const functionsStmt = db.prepare(`
        SELECT DISTINCT f.id, f.function_name, f.module, f.language
        FROM functions f
        JOIN type_snapshots s ON s.function_id = f.id
        WHERE s.env IN (?, ?)
        ORDER BY f.function_name
      `);
      const functions = functionsStmt.all(env1 as string, env2 as string) as Array<{
        id: number;
        function_name: string;
        module: string;
        language: string;
      }>;

      const snapshotStmt = db.prepare(`
        SELECT * FROM type_snapshots
        WHERE function_id = ? AND env = ?
        ORDER BY observed_at DESC
        LIMIT 1
      `);

      const entries: DriftEntry[] = [];

      for (const fn of functions) {
        const fromSnap = snapshotStmt.get(fn.id, env1 as string) as Record<string, unknown> | undefined;
        const toSnap = snapshotStmt.get(fn.id, env2 as string) as Record<string, unknown> | undefined;

        if (!fromSnap || !toSnap) continue;
        if (fromSnap.type_hash === toSnap.type_hash) continue;

        const fromArgs = JSON.parse(fromSnap.args_type as string) as TypeNode;
        const toArgs = JSON.parse(toSnap.args_type as string) as TypeNode;
        const fromReturn = JSON.parse(fromSnap.return_type as string) as TypeNode;
        const toReturn = JSON.parse(toSnap.return_type as string) as TypeNode;

        const diffs = [
          ...diffTypes(fromArgs, toArgs, "args"),
          ...diffTypes(fromReturn, toReturn, "return"),
        ];

        if (diffs.length > 0) {
          entries.push({
            functionName: fn.function_name,
            module: fn.module,
            language: fn.language,
            from: {
              id: fromSnap.id as number,
              env: fromSnap.env as string,
              observed_at: fromSnap.observed_at as string,
              type_hash: fromSnap.type_hash as string,
            },
            to: {
              id: toSnap.id as number,
              env: toSnap.env as string,
              observed_at: toSnap.observed_at as string,
              type_hash: toSnap.type_hash as string,
            },
            diffs,
          });
        }
      }

      res.json({
        mode: "cross-env",
        env1,
        env2,
        entries,
        total: entries.length,
      });
      return;
    }

    // Time-based diff: for each function, compare the two most recent snapshots
    // If `since` is provided, only consider functions with snapshots after that time
    let functionsQuery: string;
    const bindings: unknown[] = [];

    if (since) {
      if (env) {
        functionsQuery = `
          SELECT DISTINCT f.id, f.function_name, f.module, f.language
          FROM functions f
          JOIN type_snapshots s ON s.function_id = f.id
          WHERE s.observed_at >= ? AND s.env = ?
          ORDER BY f.function_name
        `;
        bindings.push(since as string, env as string);
      } else {
        functionsQuery = `
          SELECT DISTINCT f.id, f.function_name, f.module, f.language
          FROM functions f
          JOIN type_snapshots s ON s.function_id = f.id
          WHERE s.observed_at >= ?
          ORDER BY f.function_name
        `;
        bindings.push(since as string);
      }
    } else {
      if (env) {
        functionsQuery = `
          SELECT DISTINCT f.id, f.function_name, f.module, f.language
          FROM functions f
          JOIN type_snapshots s ON s.function_id = f.id
          WHERE s.env = ?
          ORDER BY f.function_name
        `;
        bindings.push(env as string);
      } else {
        functionsQuery = `
          SELECT DISTINCT f.id, f.function_name, f.module, f.language
          FROM functions f
          JOIN type_snapshots s ON s.function_id = f.id
          ORDER BY f.function_name
        `;
      }
    }

    const functions = db.prepare(functionsQuery).all(...bindings) as Array<{
      id: number;
      function_name: string;
      module: string;
      language: string;
    }>;

    // For each function, get the two most recent snapshots and diff them
    const latestTwoStmt = db.prepare(`
      SELECT * FROM type_snapshots
      WHERE function_id = ?
      ORDER BY observed_at DESC
      LIMIT 2
    `);

    const entries: DriftEntry[] = [];

    for (const fn of functions) {
      const snapshots = latestTwoStmt.all(fn.id) as Array<Record<string, unknown>>;

      if (snapshots.length < 2) continue;

      const [newer, older] = snapshots;
      if (newer.type_hash === older.type_hash) continue;

      const fromArgs = JSON.parse(older.args_type as string) as TypeNode;
      const toArgs = JSON.parse(newer.args_type as string) as TypeNode;
      const fromReturn = JSON.parse(older.return_type as string) as TypeNode;
      const toReturn = JSON.parse(newer.return_type as string) as TypeNode;

      const diffs = [
        ...diffTypes(fromArgs, toArgs, "args"),
        ...diffTypes(fromReturn, toReturn, "return"),
      ];

      if (diffs.length > 0) {
        entries.push({
          functionName: fn.function_name,
          module: fn.module,
          language: fn.language,
          from: {
            id: older.id as number,
            env: older.env as string,
            observed_at: older.observed_at as string,
            type_hash: older.type_hash as string,
          },
          to: {
            id: newer.id as number,
            env: newer.env as string,
            observed_at: newer.observed_at as string,
            type_hash: newer.type_hash as string,
          },
          diffs,
        });
      }
    }

    res.json({
      mode: "temporal",
      since: since || null,
      env: env || null,
      entries,
      total: entries.length,
    });
  } catch (err) {
    console.error("Diff report error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
