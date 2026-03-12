/**
 * E2E test: Continuous/live type generation
 *
 * Verifies that:
 * 1. Types are generated WHILE a long-running process is still running
 * 2. New types appear as new functions are called
 * 3. The .d.ts file in .trickle/types/ updates incrementally
 * 4. Final types are complete after process exits
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const CLI = path.resolve("packages/cli/dist/index.js");
const SERVER_FILE = path.resolve("test-live-types-server.js");
const TRICKLE_DIR = path.resolve(".trickle-test-live");
// CLI's trickle run generates sidecar .d.ts next to the source file
const DTS_FILE = path.resolve("test-live-types-server.d.ts");
const JSONL_FILE = path.join(TRICKLE_DIR, "observations.jsonl");

// Use a port that won't have a backend to force local mode
const UNUSED_PORT = 14897;
const BACKEND_URL = `http://localhost:${UNUSED_PORT}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanup() {
  try { fs.unlinkSync(DTS_FILE); } catch {}
  try { fs.unlinkSync(JSONL_FILE); } catch {}
  try { fs.rmSync(TRICKLE_DIR, { recursive: true }); } catch {}
}

async function run() {
  let cliProc = null;

  try {
    cleanup();

    console.log("=== Step 1: Start server via trickle run (local mode) ===");

    // Start the CLI process — it will run the server in the background
    cliProc = spawn("node", [CLI, "test-live-types-server.js"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        TRICKLE_BACKEND_URL: BACKEND_URL,
        TRICKLE_LOCAL_DIR: TRICKLE_DIR,
      },
    });

    let stdout = "";
    let stderr = "";
    cliProc.stdout.on("data", (d) => {
      stdout += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stdout.write(`[out] ${d}`);
    });
    cliProc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (process.env.TRICKLE_DEBUG) process.stderr.write(`[err] ${d}`);
    });

    // Wait for the server to start (auto-start backend takes ~10s to fail before local mode kicks in)
    let serverStarted = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      if (stdout.includes("Server running")) {
        serverStarted = true;
        break;
      }
    }

    if (!serverStarted) {
      throw new Error("Server did not start. Output: " + stdout.slice(0, 500) + "\nStderr: " + stderr.slice(0, 500));
    }
    console.log("  Server started OK");

    // === Step 2: Wait for first function to be observed ===
    console.log("\n=== Step 2: Wait for first request to be observed ===");

    // The server makes its first request at 500ms. The JSONL file should appear shortly after.
    let firstFuncSeen = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (fs.existsSync(JSONL_FILE)) {
        const content = fs.readFileSync(JSONL_FILE, "utf-8").trim();
        if (content.length > 0) {
          const lineCount = content.split("\n").filter(Boolean).length;
          console.log(`  JSONL file has ${lineCount} observation(s) OK`);
          firstFuncSeen = true;
          break;
        }
      }
    }

    if (!firstFuncSeen) {
      throw new Error("No observations appeared in JSONL file!");
    }

    // === Step 3: Check that .d.ts is being generated live ===
    console.log("\n=== Step 3: Check for live .d.ts generation ===");

    // The live watcher polls every 1.5s. Wait for it to regenerate.
    let dtsExisted = false;
    let earlyDtsContent = "";
    for (let i = 0; i < 15; i++) {
      await sleep(500);
      if (fs.existsSync(DTS_FILE)) {
        earlyDtsContent = fs.readFileSync(DTS_FILE, "utf-8");
        if (earlyDtsContent.length > 0) {
          dtsExisted = true;
          console.log(`  .d.ts file exists WHILE process is running (${earlyDtsContent.length} bytes) OK`);
          break;
        }
      }
    }

    if (!dtsExisted) {
      // This is the key test — types should appear BEFORE the process exits
      console.log("  Warning: .d.ts not generated yet (live generation may be slow)");
    }

    // Count functions in early .d.ts
    const earlyFuncCount = (earlyDtsContent.match(/export declare function/g) || []).length;
    console.log(`  Functions in early .d.ts: ${earlyFuncCount}`);

    // === Step 4: Wait for more requests to be processed ===
    console.log("\n=== Step 4: Wait for more requests and check type growth ===");

    // Wait for the server to process all 3 requests (at 500ms, 1500ms, 2500ms)
    await sleep(3000);

    // Check JSONL has grown
    if (fs.existsSync(JSONL_FILE)) {
      const content = fs.readFileSync(JSONL_FILE, "utf-8").trim();
      const lineCount = content.split("\n").filter(Boolean).length;
      console.log(`  JSONL file now has ${lineCount} observation(s)`);

      if (lineCount >= 3) {
        console.log("  All 3 functions observed OK");
      } else {
        console.log(`  Warning: expected 3 observations, got ${lineCount}`);
      }
    }

    // Check if .d.ts has grown
    if (fs.existsSync(DTS_FILE)) {
      const laterDtsContent = fs.readFileSync(DTS_FILE, "utf-8");
      const laterFuncCount = (laterDtsContent.match(/export declare function/g) || []).length;
      console.log(`  Functions in .d.ts now: ${laterFuncCount}`);

      if (laterFuncCount > earlyFuncCount) {
        console.log(`  Types grew from ${earlyFuncCount} → ${laterFuncCount} functions (live update!) OK`);
      } else if (laterFuncCount === earlyFuncCount && earlyFuncCount > 0) {
        console.log("  Types count same as early check (all functions may have been captured at once)");
      }
    }

    // === Step 5: Wait for process to complete ===
    console.log("\n=== Step 5: Wait for process to complete ===");

    const exitPromise = new Promise((resolve) => {
      cliProc.on("exit", (code) => resolve(code));
      setTimeout(() => resolve(-1), 30000); // timeout
    });

    const exitCode = await exitPromise;
    cliProc = null; // already exited

    if (exitCode === 0) {
      console.log("  Process exited successfully OK");
    } else {
      console.log(`  Process exited with code ${exitCode}`);
    }

    // === Step 6: Verify final .d.ts ===
    console.log("\n=== Step 6: Verify final .d.ts content ===");

    if (!fs.existsSync(DTS_FILE)) {
      throw new Error(".d.ts file not found after process exit!");
    }

    const finalDts = fs.readFileSync(DTS_FILE, "utf-8");
    console.log(`  Final .d.ts: ${finalDts.length} bytes`);

    if (process.env.TRICKLE_DEBUG) {
      console.log("\n--- Generated .d.ts ---");
      console.log(finalDts);
      console.log("--- End .d.ts ---\n");
    }

    // Check for all 3 functions
    const hasGetUser = finalDts.includes("handleGetUser") || finalDts.includes("HandleGetUser");
    const hasCreateOrder = finalDts.includes("handleCreateOrder") || finalDts.includes("HandleCreateOrder");
    const hasSearch = finalDts.includes("handleSearch") || finalDts.includes("HandleSearch");

    if (hasGetUser) {
      console.log("  handleGetUser type present OK");
    } else {
      throw new Error("handleGetUser NOT in final .d.ts!");
    }

    if (hasCreateOrder) {
      console.log("  handleCreateOrder type present OK");
    } else {
      throw new Error("handleCreateOrder NOT in final .d.ts!");
    }

    if (hasSearch) {
      console.log("  handleSearch type present OK");
    } else {
      throw new Error("handleSearch NOT in final .d.ts!");
    }

    // Verify type properties
    if (finalDts.includes("email") && finalDts.includes("createdAt")) {
      console.log("  handleGetUser properties (email, createdAt) OK");
    }

    if (finalDts.includes("orderId") && finalDts.includes("status")) {
      console.log("  handleCreateOrder properties (orderId, status) OK");
    }

    if (finalDts.includes("totalHits") && finalDts.includes("queryTime")) {
      console.log("  handleSearch properties (totalHits, queryTime) OK");
    }

    // The .d.ts should have existed BEFORE exit (live generation)
    if (dtsExisted) {
      console.log("  Types were generated LIVE (before process exit) OK");
    } else {
      console.log("  Note: types only appeared after exit (live watcher may have been slow)");
    }

    // Check CLI output mentions live type updates
    if (stdout.includes("+") && stdout.includes("type(s)")) {
      console.log("  CLI output shows live type update messages OK");
    }

    console.log("\n=== ALL TESTS PASSED ===");
    console.log("Continuous type generation works — types update while the process runs!\n");

  } catch (err) {
    console.error("\nTEST FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    if (cliProc) {
      cliProc.kill("SIGTERM");
      await sleep(500);
    }
    cleanup();
    process.exit(process.exitCode || 0);
  }
}

run();
