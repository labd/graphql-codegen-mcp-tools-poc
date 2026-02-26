import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CodegenConfig } from "@graphql-codegen/cli";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const config: CodegenConfig = {
	schema: [
		"./example/schema.graphql",
		"./src/directives.graphql",
	],
	generates: {
		"./example/generated/mcp-tools.generated.ts": {
			plugins: [resolve(root, "src/codegen/tools-plugin.ts")],
			config: {
				persistedDocumentsPath:
					"./example/generated/persisted-documents.json",
			},
		},
	},
};

export default config;
