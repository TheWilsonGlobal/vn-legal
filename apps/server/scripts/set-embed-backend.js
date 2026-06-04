// Cross-platform script to set embedding backend
// Usage: node scripts/set-embed-backend.js [api|transformers]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backend = process.argv[2] || "api";

if (!["api", "transformers"].includes(backend)) {
  console.error("Usage: node scripts/set-embed-backend.js [api|transformers]");
  process.exit(1);
}

const configPath = path.join(__dirname, "../src/shared/config.ts");
let config = fs.readFileSync(configPath, "utf8");

// Replace the default embedding backend
config = config.replace(
  /embeddingBackend: \(process\.env\.EMBEDDING_BACKEND \|\| ".*?"\) as/,
  `embeddingBackend: (process.env.EMBEDDING_BACKEND || "${backend}") as`,
);

fs.writeFileSync(configPath, config);
console.log(`✓ Embedding backend set to: ${backend}`);
console.log("  Run: npm run build-graph-lite");
