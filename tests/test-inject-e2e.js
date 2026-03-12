/**
 * E2E test: Auto type injection into source files (TRICKLE_INJECT=1)
 *
 * Verifies that when TRICKLE_INJECT=1 is set, trickle auto-injects:
 * - JSDoc comments into JavaScript source files
 * - Type hints into Python source files
 *
 * The injected types come from runtime observations — no manual typing.
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const JS_LIB = path.resolve("test-inject-lib.js");
const PY_LIB = path.resolve("test_inject_lib.py");
const TRICKLE_DIR = path.resolve(".trickle");

// Save original files for restoration
let origJS, origPY;

function saveOriginals() {
  origJS = fs.readFileSync(JS_LIB, "utf-8");
  origPY = fs.readFileSync(PY_LIB, "utf-8");
}

function restoreOriginals() {
  try { fs.writeFileSync(JS_LIB, origJS, "utf-8"); } catch {}
  try { fs.writeFileSync(PY_LIB, origPY, "utf-8"); } catch {}
  try { fs.unlinkSync(path.resolve("test-inject-lib.d.ts")); } catch {}
  try { fs.unlinkSync(path.resolve("test_inject_lib.pyi")); } catch {}
  try { fs.rmSync(TRICKLE_DIR, { recursive: true }); } catch {}
}

function runCmd(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });
    proc.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Exit ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
    setTimeout(() => { proc.kill(); reject(new Error("Timeout")); }, 30000);
  });
}

async function run() {
  saveOriginals();

  try {
    // ========================================
    // Part 1: JavaScript JSDoc injection
    // ========================================
    console.log("=== Part 1: JavaScript JSDoc injection ===\n");

    restoreOriginals();

    console.log("Step 1: Run JS app with TRICKLE_INJECT=1");
    const jsResult = await runCmd("node", ["test-inject-app.js"], {
      TRICKLE_INJECT: "1",
      TRICKLE_BACKEND_URL: "http://localhost:19999",
    });

    if (jsResult.stdout.includes("Done!")) {
      console.log("  App ran successfully OK");
    } else {
      throw new Error("JS app failed: " + jsResult.stdout.slice(0, 300));
    }

    const jsOutput = jsResult.stdout + jsResult.stderr;
    if (jsOutput.includes("annotated with JSDoc")) {
      console.log("  Output mentions JSDoc injection OK");
    }

    console.log("\nStep 2: Verify JSDoc was injected into source");
    const jsModified = fs.readFileSync(JS_LIB, "utf-8");

    // Check JSDoc comments were added
    if (jsModified.includes("@trickle")) {
      console.log("  @trickle marker present OK");
    } else {
      throw new Error("@trickle marker NOT found in modified source!");
    }

    if (jsModified.includes("@param {number} amount")) {
      console.log("  calculateTax: @param {number} amount OK");
    } else {
      throw new Error("calculateTax @param not found!");
    }

    if (jsModified.includes("@param {number} rate")) {
      console.log("  calculateTax: @param {number} rate OK");
    }

    if (jsModified.includes("@returns")) {
      console.log("  @returns tag present OK");
    }

    // Check formatUser has object type for user param
    if (jsModified.includes("firstName") && jsModified.includes("@param {")) {
      console.log("  formatUser: object param type present OK");
    }

    // Verify the code still works (JSDoc doesn't break it)
    console.log("\nStep 3: Verify modified code still runs");
    const jsRerun = await runCmd("node", ["-e", `
      const { calculateTax, formatUser, filterItems } = require('./test-inject-lib');
      const t = calculateTax(50, 10);
      console.log(t.total === 55 ? 'calcOK' : 'FAIL');
      const u = formatUser({ firstName: 'B', lastName: 'C', email: 'X@Y.COM' });
      console.log(u.display === 'B C' ? 'formatOK' : 'FAIL');
      const f = filterItems([1,2,3,4,5], 2);
      console.log(f.count === 3 ? 'filterOK' : 'FAIL');
    `]);
    if (jsRerun.stdout.includes("calcOK") && jsRerun.stdout.includes("formatOK") && jsRerun.stdout.includes("filterOK")) {
      console.log("  Modified code still runs correctly OK");
    } else {
      throw new Error("Modified code broke! Output: " + jsRerun.stdout);
    }

    // Verify idempotence: running again doesn't duplicate JSDoc
    console.log("\nStep 4: Verify idempotence");
    restoreOriginals(); // start fresh
    await runCmd("node", ["test-inject-app.js"], { TRICKLE_INJECT: "1", TRICKLE_BACKEND_URL: "http://localhost:19999" });
    const firstRun = fs.readFileSync(JS_LIB, "utf-8");
    // Run again on already-injected code
    await runCmd("node", ["test-inject-app.js"], { TRICKLE_INJECT: "1", TRICKLE_BACKEND_URL: "http://localhost:19999" });
    const secondRun = fs.readFileSync(JS_LIB, "utf-8");
    if (firstRun === secondRun) {
      console.log("  Idempotent — no duplicate JSDoc OK");
    } else {
      throw new Error("NOT idempotent — JSDoc was duplicated!");
    }

    // ========================================
    // Part 2: Python type hint injection
    // ========================================
    console.log("\n=== Part 2: Python type hint injection ===\n");

    restoreOriginals();

    console.log("Step 1: Run Python app with TRICKLE_INJECT=1");
    const pyResult = await runCmd("python", ["test_inject_app.py"], {
      TRICKLE_INJECT: "1",
      PYTHONPATH: "../packages/client-python/src:.",
      TRICKLE_BACKEND_URL: "http://localhost:19999",
    });

    if (pyResult.stdout.includes("Done!")) {
      console.log("  App ran successfully OK");
    } else {
      throw new Error("Python app failed: " + pyResult.stdout.slice(0, 300));
    }

    const pyOutput = pyResult.stdout + pyResult.stderr;
    if (pyOutput.includes("annotated with type hints")) {
      console.log("  Output mentions type hint injection OK");
    }

    console.log("\nStep 2: Verify type hints were injected into source");
    const pyModified = fs.readFileSync(PY_LIB, "utf-8");

    if (pyModified.includes("def calculate_tax(amount: float, rate: float)")) {
      console.log("  calculate_tax: param types injected OK");
    } else {
      // Check for any type annotation
      if (pyModified.includes("amount:") && pyModified.includes("rate:")) {
        console.log("  calculate_tax: param types injected OK");
      } else {
        throw new Error("calculate_tax types NOT found!");
      }
    }

    if (pyModified.includes("-> dict") || pyModified.includes("-> Dict")) {
      console.log("  Return type annotation present OK");
    }

    // Verify modified Python still runs
    console.log("\nStep 3: Verify modified code still runs");
    const pyRerun = await runCmd("python", ["-c", `
import sys
sys.path.insert(0, '.')
from test_inject_lib import calculate_tax, format_user, filter_items
t = calculate_tax(50, 10)
print('calcOK' if t['total'] == 55 else 'FAIL')
u = format_user({'first_name': 'B', 'last_name': 'C', 'email': 'X@Y.COM'})
print('formatOK' if u['display'] == 'B C' else 'FAIL')
f = filter_items([1,2,3,4,5], 2)
print('filterOK' if f['count'] == 3 else 'FAIL')
`]);
    if (pyRerun.stdout.includes("calcOK") && pyRerun.stdout.includes("formatOK") && pyRerun.stdout.includes("filterOK")) {
      console.log("  Modified Python code still runs correctly OK");
    } else {
      throw new Error("Modified Python code broke! Output: " + pyRerun.stdout);
    }

    // ========================================
    // Summary
    // ========================================
    console.log("\n=== Summary ===");
    console.log("  TRICKLE_INJECT=1 activates type injection OK");
    console.log("  JavaScript: JSDoc comments added above functions OK");
    console.log("  Python: Type hints added to function signatures OK");
    console.log("  Injected code still runs correctly OK");
    console.log("  JSDoc injection is idempotent OK");

    console.log("\n=== ALL TESTS PASSED ===");
    console.log("Auto type injection works!\n");

  } catch (err) {
    console.error("\nTEST FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    restoreOriginals();
    process.exit(process.exitCode || 0);
  }
}

run();
