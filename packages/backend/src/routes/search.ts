import { Router, Request, Response } from "express";
import { db } from "../db/connection";
import { listFunctions, getLatestSnapshot } from "../db/queries";
import { TypeNode } from "../types";

const router = Router();

interface FieldMatch {
  path: string;
  kind: string;
  typeName?: string;
}

interface SearchResult {
  functionName: string;
  module: string;
  environment: string;
  lastSeen: string;
  matches: FieldMatch[];
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Recursively search a TypeNode tree for fields matching the query.
 * Returns an array of matching field paths.
 */
function searchTypeNode(
  node: TypeNode,
  query: string,
  currentPath: string,
  results: FieldMatch[],
): void {
  const lowerQuery = query.toLowerCase();

  switch (node.kind) {
    case "object": {
      for (const [key, val] of Object.entries(node.properties)) {
        const fieldPath = currentPath ? `${currentPath}.${key}` : key;

        // Check if the field name matches
        if (key.toLowerCase().includes(lowerQuery)) {
          results.push({
            path: fieldPath,
            kind: val.kind,
            typeName: val.kind === "primitive" ? (val as { name: string }).name : val.kind,
          });
        }

        // Recurse into the value
        searchTypeNode(val, query, fieldPath, results);
      }
      break;
    }
    case "array":
      searchTypeNode(node.element, query, `${currentPath}[]`, results);
      break;
    case "union":
      for (const member of node.members) {
        searchTypeNode(member, query, currentPath, results);
      }
      break;
    case "tuple":
      for (let i = 0; i < node.elements.length; i++) {
        searchTypeNode(node.elements[i], query, `${currentPath}[${i}]`, results);
      }
      break;
    case "promise":
      searchTypeNode(node.resolved, query, currentPath, results);
      break;
    case "map":
      searchTypeNode(node.key, query, `${currentPath}.key`, results);
      searchTypeNode(node.value, query, `${currentPath}.value`, results);
      break;
    case "set":
      searchTypeNode(node.element, query, `${currentPath}[]`, results);
      break;
    case "primitive": {
      // Match on primitive type name (e.g., searching "number" finds all number fields)
      if (node.name.toLowerCase().includes(lowerQuery) && currentPath) {
        // Only add if not already matched by field name
        const alreadyMatched = results.some((r) => r.path === currentPath);
        if (!alreadyMatched) {
          results.push({
            path: currentPath,
            kind: "primitive",
            typeName: node.name,
          });
        }
      }
      break;
    }
  }
}

// GET / — search across all observed types
router.get("/", (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query || query.trim().length === 0) {
      res.status(400).json({ error: "Missing query parameter 'q'" });
      return;
    }

    const env = req.query.env as string | undefined;
    const lowerQuery = query.toLowerCase();

    // Get all functions
    const { rows: functionRows } = listFunctions(db, { env, limit: 500 });
    const results: SearchResult[] = [];

    for (const fn of functionRows) {
      const functionId = fn.id as number;
      const functionName = fn.function_name as string;
      const moduleName = fn.module as string;
      const environment = (fn.environment as string) || "development";
      const lastSeen = fn.last_seen_at as string;

      // Check function name match
      const nameMatches = functionName.toLowerCase().includes(lowerQuery);

      // Get latest snapshot and search types
      const snapshot = getLatestSnapshot(db, functionId, env);
      const fieldMatches: FieldMatch[] = [];

      if (snapshot) {
        const argsType = tryParseJson(snapshot.args_type as string) as TypeNode;
        const returnType = tryParseJson(snapshot.return_type as string) as TypeNode;

        if (argsType) {
          searchTypeNode(argsType, query, "args", fieldMatches);
        }
        if (returnType) {
          searchTypeNode(returnType, query, "response", fieldMatches);
        }
      }

      // Include if function name matches or any fields match
      if (nameMatches || fieldMatches.length > 0) {
        results.push({
          functionName,
          module: moduleName,
          environment,
          lastSeen,
          matches: nameMatches && fieldMatches.length === 0
            ? [{ path: "(function name)", kind: "name", typeName: undefined }]
            : fieldMatches,
        });
      }
    }

    res.json({
      query,
      total: results.length,
      results,
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
