/**
 * E2E test: Local/offline mode (no backend required)
 *
 * Verifies that:
 * 1. `trickle run app.js` works when backend is NOT running
 * 2. Observations are written to .trickle/observations.jsonl
 * 3. Type stubs (.d.ts) are generated in .trickle/types/ from the local JSONL
 * 4. The generated types are correct
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const CLI = path.resolve("packages/cli/dist/index.js");
const APP_FILE = path.resolve("test-local-mode-app.js");
const TRICKLE_DIR = path.resolve(".trickle");
// CLI's trickle run generates sidecar .d.ts next to the source file
const DTS_FILE = path.resolve("test-local-mode-app.d.ts");
const JSONL_FILE = path.join(TRICKLE_DIR, "observations.jsonl");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Use a port that's guaranteed not running to force local mode
const UNUSED_PORT = 14899;
const BACKEND_URL = `http://localhost:${UNUSED_PORT}`;

/**
 * Make sure no backend is running on our test port.
 */
async function ensureNoBackend() {
  try {
    await fetch(`${BACKEND_URL}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    console.error(`  ERROR: Something is running on port ${UNUSED_PORT}.`);
    process.exit(1);
  } catch {
    // Good — nothing running on this port
  }
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
      else
        reject(
          new Error(
            `Exit ${code}\nstdout: ${stdout}\nstderr: ${stderr}`
          )
        );
    });
    setTimeout(() => reject(new Error("Timed out")), 60000);
  });
}

async function run() {
  try {
    // === Setup ===
    console.log("=== Step 1: Ensure no backend running ===");
    await ensureNoBackend();
    console.log("  No backend running OK");

    // Clean up any previous local data
    try { fs.unlinkSync(DTS_FILE); } catch {}
    try { fs.unlinkSync(JSONL_FILE); } catch {}
    try { fs.rmSync(TRICKLE_DIR, { recursive: true }); } catch {}

    // === Test: Run in local mode ===
    console.log("\n=== Step 2: Run `trickle test-local-mode-app.js` (no backend) ===");

    const { stdout: runOut } = await runCmd("node", [CLI, "test-local-mode-app.js"], {
      TRICKLE_BACKEND_URL: BACKEND_URL,
    });

    // Should mention local mode
    if (runOut.includes("local") || runOut.includes("offline") || runOut.includes("Local")) {
      console.log("  Local mode detected OK");
    } else {
      console.log("  Warning: output doesn't mention local mode");
      console.log("  Output preview:", runOut.slice(0, 300));
    }

    // App should have run successfully
    if (runOut.includes("Done!")) {
      console.log("  App ran successfully OK");
    } else {
      throw new Error("App did not complete. Output: " + runOut.slice(0, 500));
    }

    // === Verify JSONL file ===
    console.log("\n=== Step 3: Verify observations.jsonl ===");

    if (fs.existsSync(JSONL_FILE)) {
      const content = fs.readFileSync(JSONL_FILE, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      console.log(`  ${JSONL_FILE} exists with ${lines.length} observations OK`);

      // Parse and check
      const observations = lines.map((l) => JSON.parse(l));
      const funcNames = observations.map((o) => o.functionName);

      if (funcNames.includes("parseConfig")) {
        console.log("  parseConfig captured OK");
      } else {
        throw new Error("parseConfig NOT captured in JSONL!");
      }

      if (funcNames.includes("buildResponse")) {
        console.log("  buildResponse captured OK");
      } else {
        throw new Error("buildResponse NOT captured in JSONL!");
      }

      if (funcNames.includes("validateEmail")) {
        console.log("  validateEmail captured OK");
      } else {
        throw new Error("validateEmail NOT captured in JSONL!");
      }

      // Verify structure of a payload
      const parseObs = observations.find((o) => o.functionName === "parseConfig");
      if (parseObs.argsType && parseObs.returnType && parseObs.typeHash) {
        console.log("  Payload structure (argsType, returnType, typeHash) OK");
      } else {
        throw new Error("Payload missing required fields!");
      }

      // Verify return type shape
      if (parseObs.returnType.kind === "object") {
        const props = Object.keys(parseObs.returnType.properties || {});
        if (props.includes("host") && props.includes("port") && props.includes("debug")) {
          console.log("  parseConfig return type: { host, port, debug, features } OK");
        } else {
          console.log(`  parseConfig return props: ${props.join(", ")}`);
        }
      }
    } else {
      throw new Error("observations.jsonl NOT created! Local mode may have failed.");
    }

    // === Verify .d.ts file ===
    console.log("\n=== Step 4: Verify .trickle/types/ .d.ts file ===");

    if (fs.existsSync(DTS_FILE)) {
      const dtsContent = fs.readFileSync(DTS_FILE, "utf-8");
      console.log(`  ${path.basename(DTS_FILE)} exists (${dtsContent.length} bytes) OK`);

      if (dtsContent.includes("parseConfig") || dtsContent.includes("ParseConfig")) {
        console.log("  Contains parseConfig type OK");
      } else {
        throw new Error("parseConfig not found in .d.ts!");
      }

      if (dtsContent.includes("buildResponse") || dtsContent.includes("BuildResponse")) {
        console.log("  Contains buildResponse type OK");
      } else {
        throw new Error("buildResponse not found in .d.ts!");
      }

      if (dtsContent.includes("validateEmail") || dtsContent.includes("ValidateEmail")) {
        console.log("  Contains validateEmail type OK");
      } else {
        throw new Error("validateEmail not found in .d.ts!");
      }

      if (dtsContent.includes("export")) {
        console.log("  Contains export declarations OK");
      }

      // Verify it contains the right property types
      if (dtsContent.includes("host") && dtsContent.includes("port")) {
        console.log("  Contains host/port properties OK");
      }

      if (dtsContent.includes("local mode")) {
        console.log("  Header mentions local mode OK");
      }
    } else {
      throw new Error(".trickle/types/ .d.ts file NOT generated!");
    }

    // === Verify output mentions summary ===
    console.log("\n=== Step 5: Verify CLI output ===");

    if (runOut.includes("Summary")) {
      console.log("  Shows summary OK");
    }

    if (runOut.includes("Functions observed") || runOut.includes("functions")) {
      console.log("  Shows function count OK");
    }

    if (runOut.includes("Types written") || runOut.includes(".d.ts")) {
      console.log("  Shows types generation message OK");
    }

    console.log("\n=== ALL TESTS PASSED ===");
    console.log("Local/offline mode works end-to-end without a backend!\n");
  } catch (err) {
    console.error("\nTEST FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    // Clean up
    try { fs.unlinkSync(DTS_FILE); } catch {}
    try { fs.unlinkSync(JSONL_FILE); } catch {}
    try { fs.rmSync(TRICKLE_DIR, { recursive: true }); } catch {}
    process.exit(process.exitCode || 0);
  }
}

run();
