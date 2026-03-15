/**
 * trickle doctor — comprehensive health check that gives agents a complete
 * picture of an application's state in a single command.
 *
 * Combines: data freshness, alert summary, performance overview, error
 * summary, and environment info into one output.
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

export function runDoctor(opts: { json?: boolean }): void {
  const trickleDir = process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');

  if (!fs.existsSync(trickleDir)) {
    if (opts.json) {
      console.log(JSON.stringify({ status: 'no_data', message: 'No .trickle/ directory. Run trickle run <command> first.' }));
    } else {
      console.log(chalk.yellow('  No .trickle/ directory found. Run your app with trickle first.'));
    }
    return;
  }

  // Run monitor for fresh alerts
  try {
    const { runMonitor } = require('./monitor');
    runMonitor({ dir: trickleDir });
  } catch {}

  // Collect all data
  const alerts = readJsonl(path.join(trickleDir, 'alerts.jsonl'));
  const observations = readJsonl(path.join(trickleDir, 'observations.jsonl'));
  const variables = readJsonl(path.join(trickleDir, 'variables.jsonl'));
  const queries = readJsonl(path.join(trickleDir, 'queries.jsonl'));
  const errors = readJsonl(path.join(trickleDir, 'errors.jsonl'));
  const calltrace = readJsonl(path.join(trickleDir, 'calltrace.jsonl'));
  const profile = readJsonl(path.join(trickleDir, 'profile.jsonl'));
  const console_out = readJsonl(path.join(trickleDir, 'console.jsonl'));

  let env: any = {};
  try {
    const envFile = path.join(trickleDir, 'environment.json');
    if (fs.existsSync(envFile)) env = JSON.parse(fs.readFileSync(envFile, 'utf-8'));
  } catch {}

  // Data freshness
  let dataAge = 'unknown';
  try {
    const stat = fs.statSync(path.join(trickleDir, 'variables.jsonl'));
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < 60000) dataAge = `${Math.round(ageMs / 1000)}s ago`;
    else if (ageMs < 3600000) dataAge = `${Math.round(ageMs / 60000)}m ago`;
    else dataAge = `${Math.round(ageMs / 3600000)}h ago`;
  } catch {}

  // Performance summary
  const startProfile = profile.find((p: any) => p.event === 'start');
  const endProfile = profile.find((p: any) => p.event === 'end');
  const maxFunctionMs = Math.max(0, ...observations.map((o: any) => o.durationMs || 0));
  const slowFunctions = observations.filter((o: any) => o.durationMs > 100).sort((a: any, b: any) => (b.durationMs || 0) - (a.durationMs || 0));
  const slowQueries = queries.filter((q: any) => q.durationMs > 10).sort((a: any, b: any) => (b.durationMs || 0) - (a.durationMs || 0));

  const critical = alerts.filter((a: any) => a.severity === 'critical');
  const warnings = alerts.filter((a: any) => a.severity === 'warning');

  const report = {
    status: critical.length > 0 ? 'critical' : warnings.length > 0 ? 'warning' : errors.length > 0 ? 'error' : 'healthy',
    dataFreshness: dataAge,
    summary: {
      variables: variables.length,
      functions: observations.length,
      queries: queries.length,
      errors: errors.length,
      callTraceEvents: calltrace.length,
      consoleLines: console_out.length,
      alerts: { critical: critical.length, warning: warnings.length, total: alerts.length },
    },
    performance: {
      maxFunctionMs: Math.round(maxFunctionMs * 100) / 100,
      slowFunctions: slowFunctions.slice(0, 5).map((f: any) => ({ name: f.functionName, module: f.module, ms: f.durationMs })),
      slowQueries: slowQueries.slice(0, 5).map((q: any) => ({ query: q.query?.substring(0, 80), ms: q.durationMs, driver: q.driver })),
      memoryMb: endProfile ? Math.round((endProfile.rssKb || 0) / 1024) : null,
    },
    environment: {
      runtime: env.python ? `Python ${env.python.version?.split(' ')[0]}` : env.node ? `Node ${env.node.version}` : 'unknown',
      platform: env.python?.platform || (env.node ? `${env.node.platform}/${env.node.arch}` : 'unknown'),
      frameworks: env.frameworks || [],
    },
    alerts: alerts.slice(0, 10).map((a: any) => ({
      severity: a.severity,
      category: a.category,
      message: a.message,
      suggestion: a.suggestion,
    })),
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Pretty print
  console.log('');
  console.log(chalk.bold('  trickle doctor'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  // Status
  const statusIcon = report.status === 'healthy' ? chalk.green('✓ HEALTHY') :
    report.status === 'critical' ? chalk.red('✗ CRITICAL') :
    report.status === 'warning' ? chalk.yellow('⚠ WARNING') :
    chalk.red('✗ ERRORS');
  console.log(`  Status: ${statusIcon}  (data: ${dataAge})`);
  console.log(`  Runtime: ${report.environment.runtime} on ${report.environment.platform}`);
  if (report.environment.frameworks.length > 0) {
    console.log(`  Frameworks: ${report.environment.frameworks.join(', ')}`);
  }
  console.log('');

  // Counts
  console.log(`  ${chalk.bold('Data')}:  ${variables.length} vars | ${observations.length} functions | ${queries.length} queries | ${errors.length} errors`);
  console.log(`  ${chalk.bold('Alerts')}: ${critical.length} critical | ${warnings.length} warnings`);
  if (report.performance.memoryMb) {
    console.log(`  ${chalk.bold('Memory')}: ${report.performance.memoryMb}MB RSS`);
  }
  console.log('');

  // Top issues
  if (alerts.length > 0) {
    console.log(`  ${chalk.bold('Issues')}:`);
    for (const a of alerts.slice(0, 5)) {
      const icon = a.severity === 'critical' ? chalk.red('✗') : chalk.yellow('⚠');
      console.log(`    ${icon} ${a.message}`);
    }
    console.log('');
  }

  // Slow functions
  if (slowFunctions.length > 0) {
    console.log(`  ${chalk.bold('Slow Functions')}:`);
    for (const f of slowFunctions.slice(0, 3)) {
      console.log(`    ${f.functionName} (${f.module}) — ${f.durationMs?.toFixed(0)}ms`);
    }
    console.log('');
  }

  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(chalk.gray('  Use trickle doctor --json for structured output'));
  console.log('');
}
