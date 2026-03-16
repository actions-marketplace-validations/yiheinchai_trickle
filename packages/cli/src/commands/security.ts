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
  scanned: Record<string, number>;
  summary: { critical: number; warning: number; info: number };
}

export function runSecurityScan(opts?: { dir?: string; json?: boolean }): SecurityResult {
  const trickleDir = opts?.dir || process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');
  const findings: SecurityFinding[] = [];
  const scanned: Record<string, number> = { variables: 0, queries: 0, logs: 0, observations: 0 };

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

  // ── Agent Security: The "Lethal Trifecta" ──

  // Scan LLM calls for prompt injection and data exfiltration
  const llmCalls = readJsonl(path.join(trickleDir, 'llm.jsonl'));
  for (const c of llmCalls) {
    // Prompt injection patterns in LLM inputs
    const input = String(c.inputPreview || '').toLowerCase();
    const INJECTION_PATTERNS = [
      { pattern: /ignore\s+(all\s+)?previous\s+instructions/i, name: 'Instruction override' },
      { pattern: /you\s+are\s+now\s+a\s+/i, name: 'Role hijacking' },
      { pattern: /system\s*:\s*you\s+are/i, name: 'System prompt injection' },
      { pattern: /\bdo\s+not\s+follow\s+(any|the)\s+(previous|above)/i, name: 'Instruction bypass' },
      { pattern: /forget\s+(all|everything|your)\s+(previous|prior|instructions)/i, name: 'Memory wipe attempt' },
      { pattern: /pretend\s+you\s+(are|have)\s+(no|unrestricted)/i, name: 'Jailbreak attempt' },
    ];
    for (const inj of INJECTION_PATTERNS) {
      if (inj.pattern.test(c.inputPreview || '') || inj.pattern.test(c.systemPrompt || '')) {
        findings.push({
          severity: 'critical', category: 'prompt_injection',
          message: `${inj.name} detected in LLM input`,
          source: 'llm_call', location: c.model || 'unknown',
          evidence: (c.inputPreview || '').substring(0, 100),
        });
        break;
      }
    }

    // Secrets in LLM outputs (data exfiltration)
    const output = String(c.outputPreview || '');
    if (output) {
      const outputFindings = scanValue(output, 'llm_output', `${c.provider}/${c.model}`);
      for (const f of outputFindings) {
        f.category = 'data_exfiltration';
        f.message = `LLM output contains ${f.message.toLowerCase()}`;
        findings.push(f);
      }
    }

    // Secrets in LLM inputs
    const inputStr = String(c.inputPreview || '');
    if (inputStr) {
      const inputFindings = scanValue(inputStr, 'llm_input', `${c.provider}/${c.model}`);
      for (const f of inputFindings) {
        f.message = `Secret passed to LLM: ${f.message}`;
        findings.push(f);
      }
    }
  }

  // Scan agent events for unauthorized tool calls
  const agentEvents = readJsonl(path.join(trickleDir, 'agents.jsonl'));
  const toolErrors = agentEvents.filter(e => e.event === 'tool_error');
  const toolStarts = agentEvents.filter(e => e.event === 'tool_start');

  // Detect privilege escalation: agent calling dangerous tools
  const DANGEROUS_TOOLS = ['Bash', 'bash', 'shell', 'exec', 'eval', 'rm', 'sudo', 'chmod', 'kill'];
  for (const t of toolStarts) {
    const toolName = String(t.tool || '');
    if (DANGEROUS_TOOLS.some(d => toolName.toLowerCase().includes(d.toLowerCase()))) {
      // Check if tool input contains dangerous commands
      const toolInput = String(t.toolInput || '').toLowerCase();
      if (toolInput.includes('rm -rf') || toolInput.includes('sudo') || toolInput.includes('chmod 777') ||
          toolInput.includes('curl') && toolInput.includes('|') || toolInput.includes('wget') && toolInput.includes('|')) {
        findings.push({
          severity: 'critical', category: 'privilege_escalation',
          message: `Agent executed dangerous command via ${toolName}`,
          source: 'agent_tool', location: t.framework || 'agent',
          evidence: (t.toolInput || '').substring(0, 100),
        });
      }
    }
  }

  // Scan MCP tool calls for secrets in args/responses
  const mcpCalls = readJsonl(path.join(trickleDir, 'mcp.jsonl'));
  for (const m of mcpCalls) {
    if (m.args) {
      const argsStr = typeof m.args === 'string' ? m.args : JSON.stringify(m.args);
      const argsFindings = scanValue(argsStr, 'mcp_tool_args', `MCP: ${m.tool}`);
      findings.push(...argsFindings);
    }
    if (m.resultPreview) {
      const resultFindings = scanValue(m.resultPreview, 'mcp_tool_result', `MCP: ${m.tool}`);
      for (const f of resultFindings) {
        f.category = 'data_exfiltration';
        f.message = `MCP tool response contains ${f.message.toLowerCase()}`;
        findings.push(f);
      }
    }
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

  scanned.llmCalls = llmCalls.length;
  scanned.agentEvents = agentEvents.length;
  scanned.mcpCalls = mcpCalls.length;
  const result: SecurityResult = { findings: deduped, scanned, summary };

  if (opts?.json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  // Pretty print
  console.log('');
  console.log(chalk.bold('  trickle security'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  const scanParts = [`${scanned.variables} vars`, `${scanned.queries} queries`, `${scanned.logs} logs`, `${scanned.observations} functions`];
  if (scanned.llmCalls) scanParts.push(`${scanned.llmCalls} LLM calls`);
  if (scanned.agentEvents) scanParts.push(`${scanned.agentEvents} agent events`);
  if (scanned.mcpCalls) scanParts.push(`${scanned.mcpCalls} MCP calls`);
  console.log(chalk.gray(`  Scanned: ${scanParts.join(', ')}`));

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
