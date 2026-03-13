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

/**
 * Wrap your Next.js config with trickle observability.
 *
 * Adds a webpack loader that instruments all .tsx/.jsx component files at build
 * time with render tracking, useState change tracking, and hook observability.
 */
export function withTrickle(nextConfig: NextConfig = {}, options: TrickleNextOptions = {}): NextConfig {
  const loaderPath = path.resolve(__dirname, './next-loader.js');

  return {
    ...nextConfig,
    webpack(config: WebpackConfig, context: WebpackContext) {
      // Preserve existing webpack config
      if (typeof nextConfig.webpack === 'function') {
        config = nextConfig.webpack(config, context);
      }

      config.module.rules.push({
        test: /\.(tsx?|jsx?)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: loaderPath,
            options,
          },
        ],
      });

      return config;
    },
  };
}
