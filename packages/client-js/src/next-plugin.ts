/**
 * trickle/next-plugin — Next.js observability via withTrickle().
 *
 * Wraps your Next.js config to add trickle's webpack loader, which instruments
 * all React components (.tsx/.jsx) with render tracking, useState change tracking,
 * and hook observability — the same hints you see when using the Vite plugin,
 * but for Next.js (App Router and Pages Router, Client and Server Components).
 *
 * Setup in next.config.js:
 *
 *   const { withTrickle } = require('trickle-observe/next-plugin');
 *
 *   module.exports = withTrickle({
 *     // ...your existing Next.js config
 *   });
 *
 * Or with options:
 *
 *   module.exports = withTrickle({
 *     reactStrictMode: true,
 *   }, {
 *     backendUrl: process.env.TRICKLE_BACKEND_URL,
 *     debug: process.env.TRICKLE_DEBUG === '1',
 *   });
 *
 * Environment variables:
 *   TRICKLE_BACKEND_URL   — Backend URL (default: http://localhost:4888)
 *   TRICKLE_DEBUG         — Set to "1" for debug logging
 */

import path from 'path';
import http from 'http';
import fs from 'fs';

export interface TrickleNextOptions {
  /** Backend URL (default: http://localhost:4888 or TRICKLE_BACKEND_URL env var) */
  backendUrl?: string;
  /** Only instrument files whose paths contain one of these substrings */
  include?: string[];
  /** Skip files whose paths contain one of these substrings */
  exclude?: string[];
  /** Enable debug logging */
  debug?: boolean;
  /** Enable variable tracing (default: true) */
  traceVars?: boolean;
  /** Port for the client-side ingest server (default: 4889) */
  ingestPort?: number;
}

type NextConfig = Record<string, unknown> & {
  webpack?: (config: WebpackConfig, context: WebpackContext) => WebpackConfig;
};

interface WebpackConfig {
  module: { rules: unknown[] };
  [key: string]: unknown;
}

interface WebpackContext {
  isServer: boolean;
  nextRuntime?: string;
  [key: string]: unknown;
}

/** Track whether the ingest server is already running (avoid starting twice) */
let ingestServerStarted = false;

/**
 * Start a tiny HTTP server that receives variable data from browser clients
 * and writes it to .trickle/variables.jsonl.
 */
function startIngestServer(port: number, debug: boolean): void {
  if (ingestServerStarted) return;
  ingestServerStarted = true;

  const dir = process.env.TRICKLE_LOCAL_DIR || path.join(process.cwd(), '.trickle');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const varsFile = path.join(dir, 'variables.jsonl');

  const server = http.createServer((req, res) => {
    // CORS headers for browser fetch
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/__trickle_vars') {
      let body = '';
      req.on('data', (chunk: string) => { body += chunk; });
      req.on('end', () => {
        try {
          if (body) {
            fs.appendFileSync(varsFile, body);
          }
        } catch {}
        res.writeHead(200);
        res.end('ok');
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    if (debug) {
      console.log(`[trickle/next] Ingest server listening on http://localhost:${port} → ${varsFile}`);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Another trickle instance already has the port — that's fine
      if (debug) console.log(`[trickle/next] Ingest port ${port} already in use (OK)`);
    }
  });

  // Don't keep the process alive just for this server
  server.unref();
}

/**
 * Wrap your Next.js config with trickle observability.
 *
 * Adds a webpack loader that instruments all .tsx/.jsx component files at build
 * time with render tracking, useState change tracking, and hook observability.
 * Also starts a tiny HTTP ingest server for client-side variable data.
 */
export function withTrickle(nextConfig: NextConfig = {}, options: TrickleNextOptions = {}): NextConfig {
  const loaderPath = path.resolve(__dirname, './next-loader.js');
  const ingestPort = options.ingestPort ?? 4889;
  const debug = options.debug ?? (process.env.TRICKLE_DEBUG === '1');

  return {
    ...nextConfig,
    webpack(config: WebpackConfig, context: WebpackContext) {
      // Preserve existing webpack config
      if (typeof nextConfig.webpack === 'function') {
        config = nextConfig.webpack(config, context);
      }

      // Start the ingest server for client-side data (once)
      startIngestServer(ingestPort, debug);

      config.module.rules.push({
        test: /\.(tsx?|jsx?)$/,
        exclude: /node_modules|trickle-observe|client-js/,
        use: [
          {
            loader: loaderPath,
            options: {
              ...options,
              isServer: context.isServer,
              ingestPort,
            },
          },
        ],
      });

      return config;
    },
  };
}
