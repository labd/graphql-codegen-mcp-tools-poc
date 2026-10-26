import type {
	ExecutableMCPTool,
	GeneratedMCPTool,
	GraphQLExecutor,
} from "./types.js";

/**
 * Creates an executable MCP tool from a generated tool definition.
 *
 * The handler calls the provided executor with the query string, variables,
 * and document ID. How those are sent to the GraphQL server (raw query,
 * persisted document lookup, etc.) is up to your executor implementation.
 */
export function createToolFromGenerated(
	generated: GeneratedMCPTool,
	executor: GraphQLExecutor,
): ExecutableMCPTool {
	return {
		name: generated.name,
		description: generated.description,
		inputSchema: generated.inputSchema,
		handler: async (args: Record<string, unknown>): Promise<unknown> => {
			const data = await executor(
				generated.queryString,
				args,
				generated.documentId,
			);
			return { success: true, data };
		},
	};
}
