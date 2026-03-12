/**
 * Vite plugin for trickle observation.
 *
 * Integrates into Vite's (and Vitest's) transform pipeline to wrap
 * user functions with trickle observation — the same thing observe-register.ts
 * does for Node's Module._compile, but for Vite/Vitest.
 *
 * Usage in vitest.config.ts:
 *
 *   import { tricklePlugin } from 'trickle-observe/vite-plugin';
 *   export default defineConfig({
 *     plugins: [tricklePlugin()],
 *   });
 *
 * Or via CLI:
 *
 *   trickle run vitest run tests/
 */

import path from 'path';

export interface TricklePluginOptions {
  /** Substrings — only observe files whose paths contain one of these */
  include?: string[];
  /** Substrings — skip files whose paths contain one of these */
  exclude?: string[];
  /** Backend URL (default: http://localhost:4888) */
  backendUrl?: string;
  /** Enable debug logging */
  debug?: boolean;
}

export function tricklePlugin(options: TricklePluginOptions = {}) {
  const include = options.include
    ?? (process.env.TRICKLE_OBSERVE_INCLUDE
      ? process.env.TRICKLE_OBSERVE_INCLUDE.split(',').map(s => s.trim())
      : []);
  const exclude = options.exclude
    ?? (process.env.TRICKLE_OBSERVE_EXCLUDE
      ? process.env.TRICKLE_OBSERVE_EXCLUDE.split(',').map(s => s.trim())
      : []);
  const backendUrl = options.backendUrl
    ?? process.env.TRICKLE_BACKEND_URL
    ?? 'http://localhost:4888';
  const debug = options.debug
    ?? (process.env.TRICKLE_DEBUG === '1' || process.env.TRICKLE_DEBUG === 'true');

  function shouldTransform(id: string): boolean {
    // Only JS/TS files
    const ext = path.extname(id).toLowerCase();
    if (!['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts'].includes(ext)) return false;

    // Skip node_modules
    if (id.includes('node_modules')) return false;

    // Skip trickle internals
    if (id.includes('trickle-observe') || id.includes('client-js/')) return false;

    // Include filter
    if (include.length > 0) {
      if (!include.some(p => id.includes(p))) return false;
    }

    // Exclude filter
    if (exclude.length > 0) {
      if (exclude.some(p => id.includes(p))) return false;
    }

    return true;
  }

  return {
    name: 'trickle-observe',
    enforce: 'post' as const,

    transform(code: string, id: string) {
      if (!shouldTransform(id)) return null;

      const moduleName = path.basename(id).replace(/\.[jt]sx?$/, '');
      const transformed = transformEsmSource(code, id, moduleName, backendUrl, debug);
      if (transformed === code) return null;

      if (debug) {
        console.log(`[trickle/vite] Transformed ${moduleName} (${id})`);
      }

      return { code: transformed, map: null };
    },
  };
}

/**
 * Find the closing brace position for a function body starting at `openBrace`.
 */
function findClosingBrace(source: string, openBrace: number): number {
  let depth = 1;
  let pos = openBrace + 1;
  while (pos < source.length && depth > 0) {
    const ch = source[pos];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return pos;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      pos++;
      while (pos < source.length) {
        if (source[pos] === '\\') { pos++; }
        else if (source[pos] === quote) break;
        else if (quote === '`' && source[pos] === '$' && pos + 1 < source.length && source[pos + 1] === '{') {
          pos += 2;
          let tDepth = 1;
          while (pos < source.length && tDepth > 0) {
            if (source[pos] === '{') tDepth++;
            else if (source[pos] === '}') tDepth--;
            pos++;
          }
          continue;
        }
        pos++;
      }
    } else if (ch === '/' && pos + 1 < source.length && source[pos + 1] === '/') {
      while (pos < source.length && source[pos] !== '\n') pos++;
    } else if (ch === '/' && pos + 1 < source.length && source[pos + 1] === '*') {
      pos += 2;
      while (pos < source.length - 1 && !(source[pos] === '*' && source[pos + 1] === '/')) pos++;
      pos++;
    }
    pos++;
  }
  return -1;
}

/**
 * Transform ESM source code to wrap function declarations with trickle observation.
 *
 * Prepends an import of the wrap helper, then inserts wrapper calls after
 * each function declaration body — same approach as observe-register's
 * transformCjsSource but using ESM imports.
 */
function transformEsmSource(
  source: string,
  filename: string,
  moduleName: string,
  backendUrl: string,
  debug: boolean,
): string {
  // Match top-level and nested function declarations (including async, export)
  const funcRegex = /^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/gm;
  const insertions: Array<{ position: number; name: string; paramNames: string[] }> = [];
  let match;

  while ((match = funcRegex.exec(source)) !== null) {
    const name = match[1];
    if (name === 'require' || name === 'exports' || name === 'module') continue;

    const afterMatch = match.index + match[0].length;
    const openBrace = source.indexOf('{', afterMatch);
    if (openBrace === -1) continue;

    // Extract parameter names
    const paramStr = source.slice(afterMatch, openBrace).replace(/[()]/g, '').trim();
    const paramNames = paramStr
      ? paramStr.split(',').map(p => {
          const trimmed = p.trim().split('=')[0].trim().split(':')[0].trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('...')) return '';
          return trimmed;
        }).filter(Boolean)
      : [];

    const closeBrace = findClosingBrace(source, openBrace);
    if (closeBrace === -1) continue;

    insertions.push({ position: closeBrace + 1, name, paramNames });
  }

  // Also match arrow functions assigned to const/let/var
  const arrowRegex = /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::\s*[^=]+?)?\s*=>\s*\{/gm;

  while ((match = arrowRegex.exec(source)) !== null) {
    const name = match[1];
    const openBrace = source.indexOf('{', match.index + match[0].length - 1);
    if (openBrace === -1) continue;

    // Extract param names from the arrow function
    const arrowStr = match[0];
    const arrowParamMatch = arrowStr.match(/=\s*(?:async\s+)?(?:\(([^)]*)\)|([a-zA-Z_$][a-zA-Z0-9_$]*))\s*(?::\s*[^=]+?)?\s*=>/);
    let paramNames: string[] = [];
    if (arrowParamMatch) {
      const paramStr = (arrowParamMatch[1] || arrowParamMatch[2] || '').trim();
      if (paramStr) {
        paramNames = paramStr.split(',').map(p => {
          const trimmed = p.trim().split('=')[0].trim().split(':')[0].trim();
          if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('...')) return '';
          return trimmed;
        }).filter(Boolean);
      }
    }

    const closeBrace = findClosingBrace(source, openBrace);
    if (closeBrace === -1) continue;

    insertions.push({ position: closeBrace + 1, name, paramNames });
  }

  if (insertions.length === 0) return source;

  // Prepend ESM import of the wrap helper + configure transport
  const prefix = [
    `import { wrapFunction as __trickle_wrapFn } from 'trickle-observe';`,
    `import { configure as __trickle_configure } from 'trickle-observe';`,
    `__trickle_configure({ backendUrl: ${JSON.stringify(backendUrl)}, batchIntervalMs: 2000, debug: ${debug}, enabled: true, environment: 'node' });`,
    `function __trickle_wrap(fn, name, paramNames) {`,
    `  const opts = {`,
    `    functionName: name,`,
    `    module: ${JSON.stringify(moduleName)},`,
    `    trackArgs: true,`,
    `    trackReturn: true,`,
    `    sampleRate: 1,`,
    `    maxDepth: 5,`,
    `    environment: 'node',`,
    `    enabled: true,`,
    `  };`,
    `  if (paramNames && paramNames.length) opts.paramNames = paramNames;`,
    `  return __trickle_wrapFn(fn, opts);`,
    `}`,
    '',
  ].join('\n');

  // Insert wrapper calls after each function body (reverse order)
  let result = source;
  for (let i = insertions.length - 1; i >= 0; i--) {
    const { position, name, paramNames } = insertions[i];
    const paramNamesArg = paramNames.length > 0 ? JSON.stringify(paramNames) : 'null';
    const wrapperCall = `\ntry{${name}=__trickle_wrap(${name},'${name}',${paramNamesArg})}catch(__e){}\n`;
    result = result.slice(0, position) + wrapperCall + result.slice(position);
  }

  return prefix + result;
}

export default tricklePlugin;
