/**
 * trickle security — scan runtime data for security issues.
 *
 * Detects:
 * - Secrets in variables/logs (API keys, passwords, tokens, connection strings)
 * - SQL injection patterns in queries
 * - Sensitive data in HTTP responses
 * - Hardcoded credentials
 *
 * Usage:
 *   trickle security              # scan and report
 *   trickle security --json       # structured output
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

interface SecurityFinding {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
  source: string;
  location?: string;
  evidence: string;
}

// Secret patterns
const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; severity: 'critical' | 'warning' }> = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/i, severity: 'critical' },
  { name: 'AWS Secret Key', pattern: /[0-9a-zA-Z/+=]{40}/, severity: 'warning' }, // too broad alone, checked with context
  { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/i, severity: 'critical' },
  { name: 'npm Token', pattern: /npm_[A-Za-z0-9]{36,}/i, severity: 'critical' },
  { name: 'Slack Token', pattern: /xox[baprs]-[0-9a-zA-Z-]{10,}/i, severity: 'critical' },
  { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey|api_secret)['":\s=]+['""]?([A-Za-z0-9_\-]{20,})/i, severity: 'warning' },
  { name: 'Password in string', pattern: /(?:password|passwd|pwd)['":\s=]+['""]?([^\s'"]{8,})/i, severity: 'critical' },
  { name: 'Bearer Token', pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i, severity: 'warning' },
  { name: 'Private Key', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/i, severity: 'critical' },
  { name: 'Connection String', pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+:[^\s'"]+@/i, severity: 'critical' },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i, severity: 'warning' },
];

// SQL injection indicators
const SQLI_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'String concatenation in query', pattern: /['"].*\+.*['"]|['"].*\$\{/i },
  { name: 'UNION SELECT', pattern: /UNION\s+(?:ALL\s+)?SELECT/i },
  { name: 'OR 1=1', pattern: /OR\s+['"]?1['"]?\s*=\s*['"]?1/i },
  { name: 'Comment injection', pattern: /--\s*$|\/\*.*\*\//i },
  { name: 'DROP/DELETE without WHERE', pattern: /(?:DROP|DELETE\s+FROM)\s+\w+\s*(?:;|$)/i },
];

function scanValue(value: unknown, source: string, location: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (!str || str.length < 10) return findings;

  for (const sp of SECRET_PATTERNS) {
    if (sp.pattern.test(str)) {
      // Skip common false positives
      if (sp.name === 'AWS Secret Key' && !str.includes('aws') && !str.includes('AWS')) continue;
      findings.push({
        severity: sp.severity,
        category: 'secret',
        message: `${sp.name} found in ${source}`,
        source,
        location,
        evidence: str.substring(0, 60).replace(/[A-Za-z0-9]{10,}/g, m => m.substring(0, 4) + '***'),
      });
      break; // One finding per value
    }
  }

  return findings;
}

export interface SecurityResult {
  findings: SecurityFinding[];
  scanned: { variables: number; queries: number; logs: number; observations: number };
  summary: { critical: number; warning: number; info: number };
}

export function runSecurityScan(opts?: { dir?: string; json?: boolean }): SecurityResult {
  const trickleDir = opts?.dir || process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');
  const findings: SecurityFinding[] = [];
  const scanned = { variables: 0, queries: 0, logs: 0, observations: 0 };

  // Scan variables
  const variables = readJsonl(path.join(trickleDir, 'variables.jsonl'));
  scanned.variables = variables.length;
  for (const v of variables) {
    const loc = `${v.file || v.module || '?'}:${v.line || '?'}`;
    findings.push(...scanValue(v.sample, 'variable', `${v.varName} at ${loc}`));
  }

  // Scan queries for SQL injection
  const queries = readJsonl(path.join(trickleDir, 'queries.jsonl'));
  scanned.queries = queries.length;
  for (const q of queries) {
    const queryStr = q.query || '';
    for (const sqli of SQLI_PATTERNS) {
      if (sqli.pattern.test(queryStr)) {
        findings.push({
          severity: 'warning',
          category: 'sql_injection',
          message: `${sqli.name} detected in query`,
          source: 'query',
          evidence: queryStr.substring(0, 80),
        });
        break;
      }
    }
  }

  // Scan logs
  const logs = readJsonl(path.join(trickleDir, 'logs.jsonl'));
  scanned.logs = logs.length;
  for (const l of logs) {
    findings.push(...scanValue(l.message || l.msg, 'log', l.logger || l.name || 'log'));
  }

  // Scan function observations (sample I/O)
  const observations = readJsonl(path.join(trickleDir, 'observations.jsonl'));
  scanned.observations = observations.length;
  for (const o of observations) {
    if (o.sampleInput) findings.push(...scanValue(o.sampleInput, 'function_input', `${o.module}.${o.functionName}`));
    if (o.sampleOutput) findings.push(...scanValue(o.sampleOutput, 'function_output', `${o.module}.${o.functionName}`));
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = findings.filter(f => {
    const key = `${f.category}:${f.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const summary = {
    critical: deduped.filter(f => f.severity === 'critical').length,
    warning: deduped.filter(f => f.severity === 'warning').length,
    info: deduped.filter(f => f.severity === 'info').length,
  };

  const result: SecurityResult = { findings: deduped, scanned, summary };

  if (opts?.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // Pretty print
  console.log('');
  console.log(chalk.bold('  trickle security'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(chalk.gray(`  Scanned: ${scanned.variables} vars, ${scanned.queries} queries, ${scanned.logs} logs, ${scanned.observations} functions`));

  if (deduped.length === 0) {
    console.log(chalk.green('  No security issues found. ✓'));
  } else {
    console.log(`  ${chalk.red(String(summary.critical))} critical, ${chalk.yellow(String(summary.warning))} warnings`);
    console.log('');
    for (const f of deduped.slice(0, 10)) {
      const icon = f.severity === 'critical' ? chalk.red('✗') : chalk.yellow('⚠');
      console.log(`  ${icon} ${chalk.bold(f.category)}: ${f.message}`);
      if (f.location) console.log(chalk.gray(`    at ${f.location}`));
      console.log(chalk.gray(`    evidence: ${f.evidence}`));
    }
  }
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log('');

  return result;
}
