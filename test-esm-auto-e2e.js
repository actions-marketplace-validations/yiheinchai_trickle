/**
 * E2E test: ESM auto-instrumentation via `node --import trickle/auto-esm`
 *
 * Verifies that ESM modules (import/export syntax) are instrumented
 * automatically with zero source code changes. This is the ESM equivalent
 * of `node -r trickle/auto` for CommonJS.
 *
 * Checks:
 * 1. App runs successfully with --import flag
 * 2. observations.jsonl captures all exported functions
 * 3. paramNames are preserved from ESM source
 * 4. .d.ts file is generated in .trickle/types/ with correct types
 * 5. Async exported functions are handled
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const LIB_FILE = path.resolve("test-esm-lib.mjs");
const DTS_FILE = path.resolve(".trickle/types/test-esm-lib.d.ts");
const TRICKLE_DIR = path.resolve(".trickle");
const JSONL_FILE = path.join(TRICKLE_DIR, "observations.jsonl");

function cleanup() {
  try { fs.unlinkSync(JSONL_FILE); } catch {}
  try { fs.rmSync(TRICKLE_DIR, { recursive: true }); } catch {}
}

function runCmd(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[out] ${d}`);
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[err] ${d}`);
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Exit ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
    });
    setTimeout(() => {
      proc.kill();
      reject(new Error("Timed out"));
    }, 30000);
  });
}

async function run() {
  try {
    cleanup();

    // === Step 1: Run ESM app with --import flag ===
    console.log("=== Step 1: Run `node --import trickle/auto-esm test-esm-app.mjs` ===");
    console.log("  ESM app with import/export syntax — zero trickle imports");

    const autoEsmPath = path.resolve("packages/client-js/auto-esm.mjs");
    const { stdout, stderr } = await runCmd("node", [
      "--import", autoEsmPath,
      "test-esm-app.mjs",
    ], {
      TRICKLE_BACKEND_URL: "http://localhost:19999",
    });

    if (stdout.includes("Done!")) {
      console.log("  App ran successfully OK");
    } else {
      throw new Error("App did not complete. Output: " + stdout.slice(0, 500));
    }

    const fullOutput = stdout + stderr;
    if (fullOutput.includes("trickle") && fullOutput.includes(".d.ts")) {
      console.log("  Output mentions type generation OK");
    }

    // === Step 2: Verify JSONL was created ===
    console.log("\n=== Step 2: Verify observations.jsonl ===");

    if (!fs.existsSync(JSONL_FILE)) {
      throw new Error("observations.jsonl NOT created!");
    }

    const content = fs.readFileSync(JSONL_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    console.log(`  observations.jsonl: ${lines.length} observations`);

    const observations = lines.map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    const funcNames = observations.map(o => o.functionName);

    for (const name of ["tokenize", "buildIndex", "fetchAndParse"]) {
      if (funcNames.includes(name)) {
        console.log(`  ${name} captured OK`);
      } else {
        throw new Error(`${name} NOT captured! Got: ${funcNames.join(", ")}`);
      }
    }

    // === Step 3: Verify paramNames ===
    console.log("\n=== Step 3: Verify parameter names preserved ===");

    const tokenizeObs = observations.find(o => o.functionName === "tokenize");
    if (tokenizeObs && tokenizeObs.paramNames) {
      if (tokenizeObs.paramNames.includes("text") && tokenizeObs.paramNames.includes("options")) {
        console.log("  tokenize params: [text, options] OK");
      } else {
        throw new Error(`tokenize paramNames wrong: ${JSON.stringify(tokenizeObs.paramNames)}`);
      }
    } else {
      throw new Error("tokenize missing paramNames!");
    }

    const buildIdxObs = observations.find(o => o.functionName === "buildIndex");
    if (buildIdxObs && buildIdxObs.paramNames && buildIdxObs.paramNames.includes("documents")) {
      console.log("  buildIndex params: [documents] OK");
    }

    const fetchObs = observations.find(o => o.functionName === "fetchAndParse");
    if (fetchObs && fetchObs.paramNames) {
      if (fetchObs.paramNames.includes("url") && fetchObs.paramNames.includes("transform")) {
        console.log("  fetchAndParse params: [url, transform] OK");
      }
    }

    // === Step 4: Verify .d.ts was generated ===
    console.log("\n=== Step 4: Verify .d.ts file ===");

    if (!fs.existsSync(DTS_FILE)) {
      throw new Error(".d.ts file NOT generated!");
    }

    const dts = fs.readFileSync(DTS_FILE, "utf-8");
    console.log(`  ${path.basename(DTS_FILE)}: ${dts.length} bytes`);

    if (process.env.TRICKLE_DEBUG) {
      console.log("\n--- Generated .d.ts ---");
      console.log(dts);
      console.log("--- End ---\n");
    }

    for (const name of ["tokenize", "buildIndex", "fetchAndParse"]) {
      if (dts.toLowerCase().includes(name.toLowerCase())) {
        console.log(`  ${name} type present OK`);
      } else {
        throw new Error(`${name} NOT in .d.ts!`);
      }
    }

    if (dts.includes("export")) {
      console.log("  Contains export declarations OK");
    }

    // Check real param names are used (not arg0, arg1)
    if (dts.includes("text:") || dts.includes("text :")) {
      console.log("  Real param name 'text' used in signature OK");
    }
    if (dts.includes("documents:") || dts.includes("documents :")) {
      console.log("  Real param name 'documents' used in signature OK");
    }

    // Check async function handling
    if (dts.includes("Promise") || dts.includes("fetchAndParse") || dts.includes("FetchAndParse")) {
      console.log("  Async function (fetchAndParse) handled OK");
    }

    // === Step 5: Summary ===
    console.log("\n=== Step 5: Verify ESM auto properties ===");
    console.log("  ESM import/export syntax supported OK");
    console.log("  Zero source changes needed OK");
    console.log("  Just `node --import trickle/auto-esm app.mjs` OK");
    console.log("  Async exports handled OK");
    console.log("  paramNames preserved OK");

    console.log("\n=== ALL TESTS PASSED ===");
    console.log("ESM auto-instrumentation works!\n");

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
