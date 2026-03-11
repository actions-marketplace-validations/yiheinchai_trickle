import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { fetchMockConfig, MockRoute } from "../api-client";

export interface TestGenOptions {
  out?: string;
  framework?: string;
  baseUrl?: string;
}

/**
 * `trickle test --generate` — Generate API test files from runtime observations.
 *
 * Uses real sample request/response data captured at runtime to generate
 * ready-to-run test files with correct endpoints, request bodies, and
 * response shape assertions.
 */
export async function testGenCommand(opts: TestGenOptions): Promise<void> {
  const framework = opts.framework || "vitest";
  const baseUrl = opts.baseUrl || "http://localhost:3000";

  if (framework !== "vitest" && framework !== "jest") {
    console.error(chalk.red(`\n  Unsupported framework: ${framework}`));
    console.error(chalk.gray("  Supported: vitest, jest\n"));
    process.exit(1);
  }

  try {
    const { routes } = await fetchMockConfig();

    if (routes.length === 0) {
      console.error(chalk.yellow("\n  No API routes observed yet."));
      console.error(chalk.gray("  Instrument your app and make some requests first.\n"));
      process.exit(1);
    }

    const testCode = generateTestFile(routes, framework, baseUrl);

    if (opts.out) {
      const resolvedPath = path.resolve(opts.out);
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(resolvedPath, testCode, "utf-8");
      console.log("");
      console.log(chalk.green(`  Tests written to ${chalk.bold(opts.out)}`));
      console.log(chalk.gray(`  ${routes.length} route tests generated (${framework})`));
      console.log(chalk.gray(`  Run with: npx ${framework === "vitest" ? "vitest run" : "jest"} ${opts.out}`));
      console.log("");
    } else {
      console.log("");
      console.log(testCode);
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.error(chalk.red(`\n  Error: ${err.message}\n`));
    }
    process.exit(1);
  }
}

function generateTestFile(routes: MockRoute[], framework: string, baseUrl: string): string {
  const lines: string[] = [];

  lines.push("// Auto-generated API tests by trickle");
  lines.push(`// Generated at ${new Date().toISOString()}`);
  lines.push("// Do not edit manually — re-run `trickle test --generate` to update");
  lines.push("");

  // Import block
  if (framework === "vitest") {
    lines.push('import { describe, it, expect } from "vitest";');
  }
  // jest needs no import — globals are available
  lines.push("");

  lines.push(`const BASE_URL = process.env.TEST_API_URL || "${baseUrl}";`);
  lines.push("");

  // Group routes by resource path prefix
  const groups = groupByResource(routes);

  for (const [resource, resourceRoutes] of Object.entries(groups)) {
    lines.push(`describe("${resource}", () => {`);

    for (const route of resourceRoutes) {
      const testName = `${route.method} ${route.path}`;
      const hasBody = ["POST", "PUT", "PATCH"].includes(route.method);

      lines.push(`  it("${testName} — returns expected shape", async () => {`);

      // Build fetch call
      const fetchPath = route.path.replace(/:(\w+)/g, (_, param) => {
        // Use sample data to get a real param value if available
        const sampleValue = extractParamFromSample(route.sampleInput, param);
        return sampleValue || `test-${param}`;
      });

      lines.push(`    const res = await fetch(\`\${BASE_URL}${fetchPath}\`, {`);
      lines.push(`      method: "${route.method}",`);
      if (hasBody && route.sampleInput) {
        const bodyData = extractBodyFromSample(route.sampleInput);
        if (bodyData && Object.keys(bodyData).length > 0) {
          lines.push(`      headers: { "Content-Type": "application/json" },`);
          lines.push(`      body: JSON.stringify(${JSON.stringify(bodyData, null, 6).replace(/\n/g, "\n      ")}),`);
        }
      }
      lines.push("    });");
      lines.push("");

      // Status assertion
      lines.push("    expect(res.ok).toBe(true);");
      lines.push(`    expect(res.status).toBe(200);`);
      lines.push("");

      // Response body assertions
      lines.push("    const body = await res.json();");

      if (route.sampleOutput && typeof route.sampleOutput === "object") {
        const assertions = generateAssertions(route.sampleOutput as Record<string, unknown>, "body");
        for (const assertion of assertions) {
          lines.push(`    ${assertion}`);
        }
      }

      lines.push("  });");
      lines.push("");
    }

    lines.push("});");
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Group routes by their first meaningful path segment.
 */
function groupByResource(routes: MockRoute[]): Record<string, MockRoute[]> {
  const groups: Record<string, MockRoute[]> = {};

  for (const route of routes) {
    const parts = route.path.split("/").filter(Boolean);
    // /api/users → "api/users", /users → "users"
    let resource: string;
    if (parts[0] === "api" && parts.length >= 2) {
      resource = `/api/${parts[1]}`;
    } else {
      resource = `/${parts[0] || "root"}`;
    }

    if (!groups[resource]) groups[resource] = [];
    groups[resource].push(route);
  }

  return groups;
}

/**
 * Try to extract a path param value from sample input.
 */
function extractParamFromSample(sampleInput: unknown, param: string): string | null {
  if (!sampleInput || typeof sampleInput !== "object") return null;
  const input = sampleInput as Record<string, unknown>;

  // Check params object
  if (input.params && typeof input.params === "object") {
    const params = input.params as Record<string, unknown>;
    if (params[param] !== undefined) return String(params[param]);
  }

  return null;
}

/**
 * Extract request body from sample input.
 */
function extractBodyFromSample(sampleInput: unknown): Record<string, unknown> | null {
  if (!sampleInput || typeof sampleInput !== "object") return null;
  const input = sampleInput as Record<string, unknown>;

  if (input.body && typeof input.body === "object") {
    return input.body as Record<string, unknown>;
  }

  return null;
}

/**
 * Generate expect() assertions for a sample response object.
 * Checks structure (property existence and types), not exact values.
 */
function generateAssertions(obj: Record<string, unknown>, path: string, depth = 0): string[] {
  if (depth > 3) return []; // Prevent deeply nested assertions

  const assertions: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const propPath = `${path}.${key}`;

    if (value === null) {
      assertions.push(`expect(${propPath}).toBeNull();`);
    } else if (Array.isArray(value)) {
      assertions.push(`expect(Array.isArray(${propPath})).toBe(true);`);
      // If array has items, assert shape of first element
      if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
        assertions.push(`expect(${propPath}.length).toBeGreaterThan(0);`);
        const itemAssertions = generateAssertions(
          value[0] as Record<string, unknown>,
          `${propPath}[0]`,
          depth + 1,
        );
        assertions.push(...itemAssertions);
      }
    } else if (typeof value === "object") {
      assertions.push(`expect(typeof ${propPath}).toBe("object");`);
      const nestedAssertions = generateAssertions(
        value as Record<string, unknown>,
        propPath,
        depth + 1,
      );
      assertions.push(...nestedAssertions);
    } else if (typeof value === "string") {
      assertions.push(`expect(typeof ${propPath}).toBe("string");`);
    } else if (typeof value === "number") {
      assertions.push(`expect(typeof ${propPath}).toBe("number");`);
    } else if (typeof value === "boolean") {
      assertions.push(`expect(typeof ${propPath}).toBe("boolean");`);
    }
  }

  return assertions;
}
