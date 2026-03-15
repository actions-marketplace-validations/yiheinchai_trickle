/**
 * trickle dashboard --local — serves a self-contained observability dashboard
 * that reads directly from .trickle/ files. No backend needed.
 *
 * Shows: alerts, function timing, call trace, DB queries, errors, memory profile.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

function readJsonl(filePath: string): unknown[] {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function generateDashboardHtml(trickleDir: string): string {
  const alerts = readJsonl(path.join(trickleDir, 'alerts.jsonl'));
  const queries = readJsonl(path.join(trickleDir, 'queries.jsonl'));
  const observations = readJsonl(path.join(trickleDir, 'observations.jsonl'));
  const calltrace = readJsonl(path.join(trickleDir, 'calltrace.jsonl'));
  const errors = readJsonl(path.join(trickleDir, 'errors.jsonl'));
  const profile = readJsonl(path.join(trickleDir, 'profile.jsonl'));
  const variables = readJsonl(path.join(trickleDir, 'variables.jsonl'));

  const critical = (alerts as any[]).filter(a => a.severity === 'critical').length;
  const warnings = (alerts as any[]).filter(a => a.severity === 'warning').length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>trickle dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
  h1 { color: #58a6ff; font-size: 24px; margin-bottom: 8px; }
  h2 { color: #8b949e; font-size: 14px; font-weight: normal; margin-bottom: 24px; }
  h3 { color: #58a6ff; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; }
  .card .label { color: #8b949e; font-size: 12px; text-transform: uppercase; }
  .card .value { font-size: 28px; font-weight: 600; margin-top: 4px; }
  .card .value.critical { color: #f85149; }
  .card .value.warning { color: #d29922; }
  .card .value.ok { color: #3fb950; }
  .section { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #8b949e; padding: 8px; border-bottom: 1px solid #21262d; font-weight: 500; }
  td { padding: 8px; border-bottom: 1px solid #21262d; }
  .severity-critical { color: #f85149; font-weight: 600; }
  .severity-warning { color: #d29922; }
  .severity-info { color: #58a6ff; }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; }
  .tag-critical { background: #f8514922; color: #f85149; }
  .tag-warning { background: #d2992222; color: #d29922; }
  .tag-ok { background: #3fb95022; color: #3fb950; }
  .bar { height: 6px; background: #21262d; border-radius: 3px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 3px; }
  .suggestion { color: #8b949e; font-size: 12px; margin-top: 4px; }
  .empty { color: #484f58; text-align: center; padding: 24px; }
</style>
</head>
<body>
<h1>trickle</h1>
<h2>Runtime Observability Dashboard</h2>

<div class="grid">
  <div class="card">
    <div class="label">Alerts</div>
    <div class="value ${critical > 0 ? 'critical' : warnings > 0 ? 'warning' : 'ok'}">${critical > 0 ? critical + ' critical' : warnings > 0 ? warnings + ' warnings' : 'All clear'}</div>
  </div>
  <div class="card">
    <div class="label">Functions</div>
    <div class="value">${observations.length}</div>
  </div>
  <div class="card">
    <div class="label">Variables</div>
    <div class="value">${variables.length}</div>
  </div>
  <div class="card">
    <div class="label">DB Queries</div>
    <div class="value">${queries.length}</div>
  </div>
  <div class="card">
    <div class="label">Errors</div>
    <div class="value ${errors.length > 0 ? 'critical' : 'ok'}">${errors.length}</div>
  </div>
  <div class="card">
    <div class="label">Call Trace</div>
    <div class="value">${calltrace.length} events</div>
  </div>
</div>

${alerts.length > 0 ? `
<div class="section">
  <h3>Alerts</h3>
  <table>
    <tr><th>Severity</th><th>Category</th><th>Message</th><th>Suggestion</th></tr>
    ${(alerts as any[]).map(a => `
    <tr>
      <td><span class="tag tag-${a.severity}">${a.severity}</span></td>
      <td>${a.category}</td>
      <td>${a.message}</td>
      <td class="suggestion">${a.suggestion || ''}</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

${observations.length > 0 ? `
<div class="section">
  <h3>Functions (by execution time)</h3>
  <table>
    <tr><th>Function</th><th>Module</th><th>Duration</th><th>Async</th></tr>
    ${(observations as any[]).sort((a: any, b: any) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, 20).map((f: any) => `
    <tr>
      <td class="mono">${f.functionName}</td>
      <td>${f.module || ''}</td>
      <td>${f.durationMs ? f.durationMs.toFixed(1) + 'ms' : '—'}</td>
      <td>${f.isAsync ? 'async' : ''}</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

${queries.length > 0 ? `
<div class="section">
  <h3>Database Queries (by duration)</h3>
  <table>
    <tr><th>Driver</th><th>Query</th><th>Duration</th><th>Rows</th></tr>
    ${(queries as any[]).sort((a: any, b: any) => (b.durationMs || 0) - (a.durationMs || 0)).slice(0, 20).map((q: any) => `
    <tr>
      <td><span class="tag tag-ok">${q.driver || 'sql'}</span></td>
      <td class="mono">${(q.query || '').substring(0, 80)}</td>
      <td>${q.durationMs ? q.durationMs.toFixed(1) + 'ms' : '—'}</td>
      <td>${q.rowCount ?? '—'}</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

${profile.length > 0 ? `
<div class="section">
  <h3>Memory Profile</h3>
  <table>
    <tr><th>Event</th><th>RSS</th><th>Heap</th><th>Peak Heap</th></tr>
    ${(profile as any[]).map((p: any) => `
    <tr>
      <td>${p.event}</td>
      <td>${p.rssKb ? (p.rssKb / 1024).toFixed(1) + ' MB' : '—'}</td>
      <td>${p.heapKb ? (p.heapKb / 1024).toFixed(1) + ' MB' : '—'}</td>
      <td>${p.peakHeapKb ? (p.peakHeapKb / 1024).toFixed(1) + ' MB' : '—'}</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

${errors.length > 0 ? `
<div class="section">
  <h3>Errors</h3>
  <table>
    <tr><th>Type</th><th>Message</th><th>File</th><th>Line</th></tr>
    ${(errors as any[]).slice(0, 10).map((e: any) => `
    <tr>
      <td class="severity-critical">${e.type || 'Error'}</td>
      <td>${(e.message || e.error || '').substring(0, 100)}</td>
      <td class="mono">${e.file || ''}</td>
      <td>${e.line || ''}</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

<div style="color: #484f58; font-size: 11px; margin-top: 24px; text-align: center;">
  trickle — runtime observability for JS &amp; Python &bull; ${new Date().toLocaleString()}
</div>
</body>
</html>`;
}

export function serveDashboard(opts: { port?: number; dir?: string }): void {
  const port = opts.port || 4321;
  const trickleDir = opts.dir || path.join(process.cwd(), '.trickle');

  if (!fs.existsSync(trickleDir)) {
    console.log(chalk.yellow('  No .trickle/ directory found. Run your app with trickle first.'));
    return;
  }

  // Run monitor to generate alerts
  try {
    const { runMonitor } = require('./monitor');
    runMonitor({ dir: trickleDir });
  } catch {}

  const server = http.createServer((req, res) => {
    if (req.url === '/api/data') {
      // JSON API endpoint for programmatic access
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      const data = {
        alerts: readJsonl(path.join(trickleDir, 'alerts.jsonl')),
        functions: readJsonl(path.join(trickleDir, 'observations.jsonl')),
        queries: readJsonl(path.join(trickleDir, 'queries.jsonl')),
        errors: readJsonl(path.join(trickleDir, 'errors.jsonl')),
        profile: readJsonl(path.join(trickleDir, 'profile.jsonl')),
        calltrace: readJsonl(path.join(trickleDir, 'calltrace.jsonl')),
      };
      res.end(JSON.stringify(data));
      return;
    }
    // Serve dashboard HTML
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(generateDashboardHtml(trickleDir));
  });

  server.listen(port, () => {
    console.log('');
    console.log(chalk.bold('  trickle dashboard'));
    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log(`  Dashboard: ${chalk.cyan(`http://localhost:${port}`)}`);
    console.log(`  API:       ${chalk.cyan(`http://localhost:${port}/api/data`)}`);
    console.log(chalk.gray('  ' + '─'.repeat(50)));
    console.log(chalk.gray('  Press Ctrl+C to stop'));
    console.log('');

    // Open in browser
    const { exec } = require('child_process');
    if (process.platform === 'darwin') exec(`open http://localhost:${port}`);
    else if (process.platform === 'linux') exec(`xdg-open http://localhost:${port}`);
  });
}
