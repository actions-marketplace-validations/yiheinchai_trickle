/**
 * MCP tool call observer — auto-instruments MCP client and server SDKs
 * to capture tool invocations, arguments, responses, latency, and errors.
 *
 * Writes to .trickle/mcp.jsonl as:
 *   { "kind": "mcp_tool_call", "tool": "fetch", "direction": "outgoing",
 *     "durationMs": 234.5, "args": {...}, "result": "...", ... }
 *
 * Zero code changes needed — intercepted via Module._load hook.
 */

import * as fs from 'fs';
import * as path from 'path';

let mcpFile: string | null = null;
let eventCount = 0;
const MAX_MCP_EVENTS = 1000;
const TRUNCATE_LEN = 500;

function getMcpFile(): string {
  if (mcpFile) return mcpFile;
  const dir = process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  mcpFile = path.join(dir, 'mcp.jsonl');
  return mcpFile;
}

interface McpEvent {
  kind: 'mcp_tool_call';
  tool: string;
  direction: 'outgoing' | 'incoming';
  durationMs: number;
  args: unknown;
  resultPreview: string;
  isError: boolean;
  errorMessage?: string;
  timestamp: number;
}

function writeMcpEvent(event: McpEvent): void {
  if (eventCount >= MAX_MCP_EVENTS) return;
  eventCount++;
  try {
    fs.appendFileSync(getMcpFile(), JSON.stringify(event) + '\n');
  } catch {}
}

function truncate(s: string, len = TRUNCATE_LEN): string {
  if (!s) return '';
  return s.length > len ? s.substring(0, len) + '...' : s;
}

function sanitizeArgs(args: unknown): unknown {
  if (args === null || args === undefined) return null;
  try {
    const s = JSON.stringify(args);
    return s.length > 1000 ? JSON.parse(s.substring(0, 1000) + '"}') : args;
  } catch { return String(args).substring(0, 200); }
}

function extractResultPreview(result: any): string {
  if (!result) return '';
  // MCP CallToolResult has .content array
  if (result.content && Array.isArray(result.content)) {
    const texts = result.content
      .filter((c: any) => c.type === 'text' && c.text)
      .map((c: any) => c.text);
    return truncate(texts.join('\n'));
  }
  if (typeof result === 'string') return truncate(result);
  try { return truncate(JSON.stringify(result)); } catch { return ''; }
}

// ────────────────────────────────────────────────────
// Client-side: patch Client.callTool
// ────────────────────────────────────────────────────

export function patchMcpClient(mcpModule: any, debug: boolean): void {
  if (!mcpModule || mcpModule.__trickle_mcp_patched) return;
  mcpModule.__trickle_mcp_patched = true;

  // @modelcontextprotocol/sdk exports Client class
  const ClientClass = mcpModule.Client;
  if (!ClientClass) {
    if (debug) console.log('[trickle/mcp] Client class not found in module');
    return;
  }

  // Patch callTool on the prototype
  const proto = ClientClass.prototype;
  if (proto.callTool && !proto.callTool.__trickle_patched) {
    const origCallTool = proto.callTool;
    proto.callTool = async function patchedCallTool(this: any, ...args: any[]) {
      const params = args[0] || {};
      const toolName = typeof params === 'string' ? params : (params.name || 'unknown');
      const toolArgs = typeof params === 'string' ? args[1] : (params.arguments || params.args);
      const startTime = performance.now();

      try {
        const result = await origCallTool.apply(this, args);
        const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
        writeMcpEvent({
          kind: 'mcp_tool_call', tool: toolName, direction: 'outgoing',
          durationMs, args: sanitizeArgs(toolArgs),
          resultPreview: extractResultPreview(result),
          isError: result?.isError || false,
          errorMessage: result?.isError ? extractResultPreview(result) : undefined,
          timestamp: Date.now(),
        });
        if (debug) console.log(`[trickle/mcp] callTool: ${toolName} (${durationMs}ms)`);
        return result;
      } catch (err: any) {
        const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
        writeMcpEvent({
          kind: 'mcp_tool_call', tool: toolName, direction: 'outgoing',
          durationMs, args: sanitizeArgs(toolArgs),
          resultPreview: '', isError: true,
          errorMessage: truncate(err?.message || String(err), 200),
          timestamp: Date.now(),
        });
        throw err;
      }
    };
    proto.callTool.__trickle_patched = true;
    if (debug) console.log('[trickle/mcp] Patched Client.callTool');
  }

  // Also patch listTools for discovery
  if (proto.listTools && !proto.listTools.__trickle_patched) {
    const origListTools = proto.listTools;
    proto.listTools = async function patchedListTools(this: any, ...args: any[]) {
      const startTime = performance.now();
      const result = await origListTools.apply(this, args);
      const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
      const toolCount = result?.tools?.length || 0;
      writeMcpEvent({
        kind: 'mcp_tool_call', tool: '__list_tools', direction: 'outgoing',
        durationMs, args: null,
        resultPreview: `${toolCount} tools available`,
        isError: false, timestamp: Date.now(),
      });
      return result;
    };
    proto.listTools.__trickle_patched = true;
  }
}

// ────────────────────────────────────────────────────
// Server-side: patch Server to wrap tool handlers
// ────────────────────────────────────────────────────

export function patchMcpServer(mcpModule: any, debug: boolean): void {
  // Server is exported from @modelcontextprotocol/sdk
  const ServerClass = mcpModule.Server || mcpModule.McpServer;
  if (!ServerClass || ServerClass.__trickle_mcp_server_patched) return;
  ServerClass.__trickle_mcp_server_patched = true;

  const proto = ServerClass.prototype;

  // Patch the .tool() registration method to wrap handlers
  if (proto.tool && !proto.tool.__trickle_patched) {
    const origTool = proto.tool;
    proto.tool = function patchedTool(this: any, ...args: any[]) {
      // tool(name, schema, handler) or tool(name, handler)
      const toolName = typeof args[0] === 'string' ? args[0] : 'unknown';
      const lastArg = args[args.length - 1];

      if (typeof lastArg === 'function') {
        const originalHandler = lastArg;
        args[args.length - 1] = async function wrappedHandler(...handlerArgs: any[]) {
          const startTime = performance.now();
          try {
            const result = await originalHandler.apply(this, handlerArgs);
            const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
            writeMcpEvent({
              kind: 'mcp_tool_call', tool: toolName, direction: 'incoming',
              durationMs, args: sanitizeArgs(handlerArgs[0]),
              resultPreview: extractResultPreview(result),
              isError: result?.isError || false,
              timestamp: Date.now(),
            });
            if (debug) console.log(`[trickle/mcp] tool handler: ${toolName} (${durationMs}ms)`);
            return result;
          } catch (err: any) {
            const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
            writeMcpEvent({
              kind: 'mcp_tool_call', tool: toolName, direction: 'incoming',
              durationMs, args: sanitizeArgs(handlerArgs[0]),
              resultPreview: '', isError: true,
              errorMessage: truncate(err?.message || String(err), 200),
              timestamp: Date.now(),
            });
            throw err;
          }
        };
      }

      return origTool.apply(this, args);
    };
    proto.tool.__trickle_patched = true;
    if (debug) console.log('[trickle/mcp] Patched Server.tool');
  }

  // Patch setRequestHandler for lower-level interception
  if (proto.setRequestHandler && !proto.setRequestHandler.__trickle_patched) {
    const origSetHandler = proto.setRequestHandler;
    proto.setRequestHandler = function patchedSetHandler(this: any, schema: any, handler: any) {
      if (typeof handler === 'function') {
        const origHandler = handler;
        const capturedHandler = origHandler;
        handler = async function wrappedHandler(this: any, ...args: any[]) {
          const request = args[0];
          const method = request?.method || schema?.method || 'unknown';
          if (method === 'tools/call') {
            const startTime = performance.now();
            try {
              const result = await capturedHandler.apply(this, args);
              const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
              writeMcpEvent({
                kind: 'mcp_tool_call', tool: request?.params?.name || 'unknown',
                direction: 'incoming', durationMs,
                args: sanitizeArgs(request?.params?.arguments),
                resultPreview: extractResultPreview(result),
                isError: result?.isError || false,
                timestamp: Date.now(),
              });
              return result;
            } catch (err: any) {
              const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
              writeMcpEvent({
                kind: 'mcp_tool_call', tool: request?.params?.name || 'unknown',
                direction: 'incoming', durationMs,
                args: sanitizeArgs(request?.params?.arguments),
                resultPreview: '', isError: true,
                errorMessage: truncate(err?.message || String(err), 200),
                timestamp: Date.now(),
              });
              throw err;
            }
          }
          return capturedHandler.apply(this, args);
        };
      }
      return origSetHandler.call(this, schema, handler);
    };
    proto.setRequestHandler.__trickle_patched = true;
  }
}

// ────────────────────────────────────────────────────
// Initialization
// ────────────────────────────────────────────────────

export function initMcpObserver(): void {
  const dir = process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  mcpFile = path.join(dir, 'mcp.jsonl');
  try { fs.writeFileSync(mcpFile, ''); } catch {}
  eventCount = 0;
}
