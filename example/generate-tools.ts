/**
 * Generates mcp-tools.generated.ts from persisted-documents.json.
 *
 * Run after graphql-codegen to produce the MCP tool definitions.
 * Usage: tsx example/generate-tools.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema } from "graphql";
import { plugin } from "../src/codegen/tools-plugin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Load schema
const schemaSDL = [
	readFileSync(resolve(root, "example/schema.graphql"), "utf-8"),
	readFileSync(resolve(root, "src/directives.graphql"), "utf-8"),
].join("\n");
const schema = buildSchema(schemaSDL);

// Generate tool definitions
const output = plugin(schema, [], {
	persistedDocumentsPath: "./example/generated/persisted-documents.json",
});

const result = typeof output === "string" ? output : output.content;
const outPath = resolve(root, "example/generated/mcp-tools.generated.ts");
writeFileSync(outPath, result);
console.log(`Generated ${outPath}`);
