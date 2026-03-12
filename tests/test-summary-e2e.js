/**
 * E2E test: Type summary with change detection (TRICKLE_SUMMARY=1)
 *
 * Verifies that trickle/auto prints discovered type signatures to terminal
 * and detects new/changed types between runs.
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const TRICKLE_DIR = path.resolve(".trickle");

function cleanup() {
  try { fs.unlinkSync(path.resolve("test-summary-lib.d.ts")); } catch {}
  try { fs.unlinkSync(path.resolve("test_summary_lib.pyi")); } catch {}
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
  cleanup();

  try {
    // ========================================
    // Part 1: JavaScript type summary
    // ========================================
    console.log("=== Part 1: JavaScript type summary ===\n");

    console.log("Step 1: First run — all types should be NEW");
    const jsRun1 = await runCmd("node", ["test-summary-app.js"], {
      TRICKLE_SUMMARY: "1",
      TRICKLE_BACKEND_URL: "http://localhost:19999",
    });
    const jsOut1 = jsRun1.stdout + jsRun1.stderr;
    console.log(jsOut1);

    if (jsOut1.includes("Discovered types")) {
      console.log("  Discovered types header found OK");
    } else {
      throw new Error("Discovered types header NOT found!");
    }

    // Check function signatures appear
    if (jsOut1.includes("greet(name: string, greeting: string)")) {
      console.log("  greet signature found OK");
    } else {
      throw new Error("greet signature NOT found!");
    }

    if (jsOut1.includes("add(a: number, b: number)")) {
      console.log("  add signature found OK");
    } else {
      throw new Error("add signature NOT found!");
    }

    if (jsOut1.includes("toUpper(text: string)")) {
      console.log("  toUpper signature found OK");
    } else {
      throw new Error("toUpper signature NOT found!");
    }

    // Check return types shown
    if (jsOut1.includes("→") || jsOut1.includes("->")) {
      console.log("  Return type arrow found OK");
    }

    // Check NEW markers
    if (jsOut1.includes("NEW")) {
      console.log("  NEW markers present on first run OK");
    } else {
      throw new Error("NEW markers NOT found on first run!");
    }

    // Check "3 new" in header
    if (jsOut1.includes("3 new")) {
      console.log("  '3 new' count in header OK");
    }

    console.log("\nStep 2: Second run — same types, no NEW markers");
    const jsRun2 = await runCmd("node", ["test-summary-app.js"], {
      TRICKLE_SUMMARY: "1",
      TRICKLE_BACKEND_URL: "http://localhost:19999",
    });
    const jsOut2 = jsRun2.stdout + jsRun2.stderr;

    if (!jsOut2.includes("NEW") && !jsOut2.includes("CHANGED")) {
      console.log("  No NEW/CHANGED markers on second run OK");
    } else {
      throw new Error("Unexpected NEW/CHANGED markers on identical second run!");
    }

    if (jsOut2.includes("Discovered types:") && !jsOut2.includes("new,")) {
      console.log("  Clean header without change count OK");
    }

    // ========================================
    // Part 2: Python type summary
    // ========================================
    console.log("\n=== Part 2: Python type summary ===\n");

    cleanup();

    console.log("Step 1: First run — all types should be NEW");
    const pyRun1 = await runCmd("python", ["test_summary_app.py"], {
      TRICKLE_SUMMARY: "1",
      PYTHONPATH: "../packages/client-python/src:.",
      TRICKLE_BACKEND_URL: "http://localhost:19999",
    });
    const pyOut1 = pyRun1.stdout + pyRun1.stderr;
    console.log(pyOut1);

    if (pyOut1.includes("Discovered types")) {
      console.log("  Discovered types header found OK");
    } else {
      throw new Error("Python Discovered types header NOT found!");
    }

    // Check Python function signatures
    if (pyOut1.includes("greet(name: str, greeting: str)")) {
      console.log("  greet signature found OK");
    } else {
      throw new Error("Python greet signature NOT found!");
    }

    if (pyOut1.includes("add(a: float, b: float)")) {
      console.log("  add signature found OK");
    } else {
      throw new Error("Python add signature NOT found!");
    }

    if (pyOut1.includes("to_upper(text: str)")) {
      console.log("  to_upper signature found OK");
    } else {
      throw new Error("Python to_upper signature NOT found!");
    }

    // Check NEW markers
    if (pyOut1.includes("NEW")) {
      console.log("  NEW markers present on first run OK");
    } else {
      throw new Error("Python NEW markers NOT found!");
    }

    console.log("\nStep 2: Second run — same types, no NEW markers");
    const pyRun2 = await runCmd("python", ["test_summary_app.py"], {
      TRICKLE_SUMMARY: "1",
      PYTHONPATH: "../packages/client-python/src:.",
      TRICKLE_BACKEND_URL: "http://localhost:19999",
    });
    const pyOut2 = pyRun2.stdout + pyRun2.stderr;

    if (!pyOut2.includes("NEW") && !pyOut2.includes("CHANGED")) {
      console.log("  No NEW/CHANGED markers on second run OK");
    } else {
      throw new Error("Python: unexpected NEW/CHANGED markers on identical second run!");
    }

    // ========================================
    // Part 3: No summary when TRICKLE_SUMMARY is not set
    // ========================================
    console.log("\n=== Part 3: No summary without TRICKLE_SUMMARY=1 ===\n");

    cleanup();

    const jsQuiet = await runCmd("node", ["test-summary-app.js"], {
      TRICKLE_BACKEND_URL: "http://localhost:19999",
    });
    const jsQuietOut = jsQuiet.stdout + jsQuiet.stderr;

    if (!jsQuietOut.includes("Discovered types")) {
      console.log("  No summary when flag is off OK");
    } else {
      throw new Error("Summary appeared WITHOUT TRICKLE_SUMMARY=1!");
    }

    // ========================================
    // Summary
    // ========================================
    console.log("\n=== Summary ===");
    console.log("  JavaScript: type signatures printed to terminal OK");
    console.log("  Python: type signatures printed to terminal OK");
    console.log("  NEW markers on first run OK");
    console.log("  No markers on identical second run (change detection works) OK");
    console.log("  No summary without TRICKLE_SUMMARY=1 OK");

    console.log("\n=== ALL TESTS PASSED ===");
    console.log("Type summary with change detection works!\n");

  } catch (err) {
    console.error("\nTEST FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    cleanup();
    process.exit(process.exitCode || 0);
  }
}

run();
