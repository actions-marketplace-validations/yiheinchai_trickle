/**
 * trickle diff-runs — compare two trickle runs side by side.
 *
 * Shows what changed between runs: new/removed functions, query changes,
 * performance regressions, new errors. Like git diff for runtime behavior.
 *
 * Usage:
 *   trickle diff-runs --before .trickle-before --after .trickle
 *   trickle diff-runs --snapshot            # save current as snapshot
 *   trickle diff-runs                       # compare current vs last snapshot
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

function readJsonl(fp: string): any[] {
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf-8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export interface RunDiff {
  functions: {
    added: string[];
    removed: string[];
    slowerBy: Array<{ name: string; beforeMs: number; afterMs: number; deltaMs: number }>;
    fasterBy: Array<{ name: string; beforeMs: number; afterMs: number; deltaMs: number }>;
  };
  queries: {
    beforeTotal: number;
    afterTotal: number;
    newPatterns: string[];
    removedPatterns: string[];
    nPlusOneBefore: number;
    nPlusOneAfter: number;
  };
  errors: {
    beforeCount: number;
    afterCount: number;
    newErrors: string[];
    resolvedErrors: string[];
  };
  alerts: {
    beforeCount: number;
    afterCount: number;
    newAlerts: string[];
    resolvedAlerts: string[];
  };
  verdict: 'improved' | 'regressed' | 'unchanged' | 'mixed';
}

function collectRunData(dir: string) {
  const observations = readJsonl(path.join(dir, 'observations.jsonl'));
  const queries = readJsonl(path.join(dir, 'queries.jsonl'));
  const errors = readJsonl(path.join(dir, 'errors.jsonl'));
  const alerts = readJsonl(path.join(dir, 'alerts.jsonl'));

  const funcMap = new Map<string, number>();
  for (const o of observations) {
    const key = `${o.module}.${o.functionName}`;
    funcMap.set(key, Math.max(funcMap.get(key) || 0, o.durationMs || 0));
  }

  const queryPatterns = new Map<string, number>();
  for (const q of queries) {
    const norm = (q.query || '').replace(/\s+/g, ' ').trim().replace(/'[^']*'/g, '?').replace(/\b\d+\b/g, '?');
    queryPatterns.set(norm, (queryPatterns.get(norm) || 0) + 1);
  }

  const errorMessages = new Set(errors.map((e: any) => (e.message || '').substring(0, 100)));
  const alertMessages = new Set(alerts.map((a: any) => (a.message || '').substring(0, 100)));

  return { funcMap, queryPatterns, errorMessages, alertMessages, queryCount: queries.length, errorCount: errors.length, alertCount: alerts.length };
}

export function diffRuns(beforeDir: string, afterDir: string): RunDiff {
  const before = collectRunData(beforeDir);
  const after = collectRunData(afterDir);

  // Functions
  const added = [...after.funcMap.keys()].filter(k => !before.funcMap.has(k));
  const removed = [...before.funcMap.keys()].filter(k => !after.funcMap.has(k));
  const slowerBy: RunDiff['functions']['slowerBy'] = [];
  const fasterBy: RunDiff['functions']['fasterBy'] = [];

  for (const [name, afterMs] of after.funcMap) {
    const beforeMs = before.funcMap.get(name);
    if (beforeMs && beforeMs > 0 && afterMs > 0) {
      const delta = afterMs - beforeMs;
      if (delta > beforeMs * 0.2 && delta > 1) slowerBy.push({ name, beforeMs, afterMs, deltaMs: delta });
      else if (delta < -beforeMs * 0.2 && delta < -1) fasterBy.push({ name, beforeMs, afterMs, deltaMs: delta });
    }
  }
  slowerBy.sort((a, b) => b.deltaMs - a.deltaMs);
  fasterBy.sort((a, b) => a.deltaMs - b.deltaMs);

  // Queries
  const afterPatterns = new Set(after.queryPatterns.keys());
  const beforePatterns = new Set(before.queryPatterns.keys());
  const newPatterns = [...afterPatterns].filter(p => !beforePatterns.has(p)).map(p => p.substring(0, 80));
  const removedPatterns = [...beforePatterns].filter(p => !afterPatterns.has(p)).map(p => p.substring(0, 80));
  const nPlusOneBefore = [...before.queryPatterns.values()].filter(c => c >= 3).length;
  const nPlusOneAfter = [...after.queryPatterns.values()].filter(c => c >= 3).length;

  // Errors
  const newErrors = [...after.errorMessages].filter(e => !before.errorMessages.has(e));
  const resolvedErrors = [...before.errorMessages].filter(e => !after.errorMessages.has(e));

  // Alerts
  const newAlerts = [...after.alertMessages].filter(a => !before.alertMessages.has(a));
  const resolvedAlerts = [...before.alertMessages].filter(a => !after.alertMessages.has(a));

  // Verdict
  const improvements = resolvedErrors.length + resolvedAlerts.length + fasterBy.length + (nPlusOneAfter < nPlusOneBefore ? 1 : 0);
  const regressions = newErrors.length + newAlerts.length + slowerBy.length + (nPlusOneAfter > nPlusOneBefore ? 1 : 0);
  const verdict: RunDiff['verdict'] = improvements > 0 && regressions === 0 ? 'improved' :
    regressions > 0 && improvements === 0 ? 'regressed' :
    improvements > 0 && regressions > 0 ? 'mixed' : 'unchanged';

  return {
    functions: { added, removed, slowerBy: slowerBy.slice(0, 5), fasterBy: fasterBy.slice(0, 5) },
    queries: { beforeTotal: before.queryCount, afterTotal: after.queryCount, newPatterns: newPatterns.slice(0, 5), removedPatterns: removedPatterns.slice(0, 5), nPlusOneBefore, nPlusOneAfter },
    errors: { beforeCount: before.errorCount, afterCount: after.errorCount, newErrors, resolvedErrors },
    alerts: { beforeCount: before.alertCount, afterCount: after.alertCount, newAlerts, resolvedAlerts },
    verdict,
  };
}

export interface DiffOptions {
  before?: string;
  after?: string;
  snapshot?: boolean;
  json?: boolean;
}

export function runDiffCommand(opts: DiffOptions): void {
  const trickleDir = process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');
  const snapshotDir = path.join(trickleDir, 'snapshot');

  // Snapshot mode: save current data
  if (opts.snapshot) {
    if (!fs.existsSync(trickleDir)) {
      console.log(chalk.yellow('\n  No .trickle/ data. Run trickle run first.\n'));
      return;
    }
    if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
    for (const f of ['observations.jsonl', 'queries.jsonl', 'errors.jsonl', 'alerts.jsonl', 'calltrace.jsonl']) {
      const src = path.join(trickleDir, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(snapshotDir, f));
    }
    console.log(chalk.green(`\n  Snapshot saved to ${snapshotDir}\n`));
    return;
  }

  // Diff mode
  const beforeDir = opts.before || snapshotDir;
  const afterDir = opts.after || trickleDir;

  if (!fs.existsSync(beforeDir)) {
    console.log(chalk.yellow('\n  No snapshot found. Run: trickle diff-runs --snapshot\n'));
    return;
  }

  const diff = diffRuns(beforeDir, afterDir);

  if (opts.json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }

  // Pretty print
  const verdictIcon = diff.verdict === 'improved' ? chalk.green('✓ IMPROVED') :
    diff.verdict === 'regressed' ? chalk.red('✗ REGRESSED') :
    diff.verdict === 'mixed' ? chalk.yellow('~ MIXED') : chalk.gray('= UNCHANGED');

  console.log('');
  console.log(chalk.bold('  trickle diff-runs'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  Verdict: ${verdictIcon}`);
  console.log('');

  if (diff.functions.added.length > 0)
    console.log(chalk.green(`  + ${diff.functions.added.length} new function(s): ${diff.functions.added.slice(0, 3).join(', ')}`));
  if (diff.functions.removed.length > 0)
    console.log(chalk.red(`  - ${diff.functions.removed.length} removed function(s): ${diff.functions.removed.slice(0, 3).join(', ')}`));
  if (diff.functions.slowerBy.length > 0)
    for (const s of diff.functions.slowerBy.slice(0, 3))
      console.log(chalk.red(`  ↑ ${s.name}: ${s.beforeMs.toFixed(0)}ms → ${s.afterMs.toFixed(0)}ms (+${s.deltaMs.toFixed(0)}ms)`));
  if (diff.functions.fasterBy.length > 0)
    for (const s of diff.functions.fasterBy.slice(0, 3))
      console.log(chalk.green(`  ↓ ${s.name}: ${s.beforeMs.toFixed(0)}ms → ${s.afterMs.toFixed(0)}ms (${s.deltaMs.toFixed(0)}ms)`));

  console.log(`  Queries: ${diff.queries.beforeTotal} → ${diff.queries.afterTotal}`);
  if (diff.queries.nPlusOneBefore !== diff.queries.nPlusOneAfter)
    console.log(`  N+1 patterns: ${diff.queries.nPlusOneBefore} → ${diff.queries.nPlusOneAfter}`);
  console.log(`  Errors: ${diff.errors.beforeCount} → ${diff.errors.afterCount}`);
  if (diff.errors.newErrors.length > 0) console.log(chalk.red(`  New errors: ${diff.errors.newErrors.join(', ').substring(0, 80)}`));
  if (diff.errors.resolvedErrors.length > 0) console.log(chalk.green(`  Resolved: ${diff.errors.resolvedErrors.join(', ').substring(0, 80)}`));

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');
}
