import type { CodegenConfig } from "@graphql-codegen/cli";
import { mcpToolTransform } from "../src/codegen/index.js";

const schema = [
	// Your GraphQL schema (local file, URL, or introspection endpoint)
	"./example/schema.graphql",
	// The MCP directives — required for codegen to understand @mcpTool
	"./src/directives.graphql",
];

const config: CodegenConfig = {
	schema,
	generates: {
		// Step 1: Generate persisted documents (only @mcpTool operations)
		"./example/generated/": {
			documents: ["./example/operations.graphql"],
			preset: "client",
			documentTransforms: [mcpToolTransform],
			presetConfig: {
				fragmentMasking: false,
				persistedDocuments: {
					mode: "embedHashInDocument",
					hashPropertyName: "documentId",
				},
			},
		},
	},
};

export default config;
