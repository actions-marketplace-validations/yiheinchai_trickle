/**
 * Jest/Vitest setup file for trickle instrumentation.
 *
 * Usage in jest.config.js:
 *   setupFiles: ['trickle-observe/jest-setup']
 *
 * Or via CLI:
 *   npx jest --setupFiles=trickle-observe/jest-setup
 *
 * This patches database drivers and other modules in the Jest worker
 * process. Unlike observe.js (which uses Module._load hooks that Jest
 * bypasses), this directly patches modules after they're loaded.
 */

const path = require('path');
const debug = process.env.TRICKLE_DEBUG === '1';

// Load the standard observe-register first (sets up Module._load hooks
// for future requires within the test)
try {
  require('./dist/observe-register');
} catch {}

// Then eagerly patch any modules that are already in the require cache
// or that we can load now (Jest may have pre-loaded some)
function tryPatch(moduleName, patchFn) {
  try {
    const mod = require(moduleName);
    if (mod) {
      const { [patchFn]: patch } = require('./dist/db-observer');
      patch(mod, debug);
      if (debug) console.log(`[trickle/jest] Patched ${moduleName}`);
    }
  } catch {
    // Module not installed — skip
  }
}

// Patch database drivers
tryPatch('better-sqlite3', 'patchBetterSqlite3');
tryPatch('pg', 'patchPg');
tryPatch('mysql2', 'patchMysql2');

// Patch ORMs
try {
  const { patchPrisma, patchSequelize, patchKnex, patchTypeORM, patchDrizzle } = require('./dist/db-observer');
  try { patchPrisma(require('@prisma/client'), debug); } catch {}
  try { patchSequelize(require('sequelize'), debug); } catch {}
  try { patchKnex(require('knex'), debug); } catch {}
  try { patchTypeORM(require('typeorm'), debug); } catch {}
  try { patchDrizzle(require('drizzle-orm'), debug); } catch {}
} catch {}

// Patch logging frameworks
try {
  const logObs = require('./dist/log-observer');
  try { logObs.patchWinston(require('winston'), debug); } catch {}
  try { logObs.patchPino(require('pino'), debug); } catch {}
  try { logObs.patchBunyan(require('bunyan'), debug); } catch {}
} catch {}
