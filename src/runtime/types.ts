/**
 * Generated MCP tool definition (data-only, serializable).
 *
 * Extracted from GraphQL operations marked with @mcpTool directive.
 * Contains all information needed to register and execute the tool.
 */
export type GeneratedMCPTool = {
	name: string;
	description: string;
	operationType: "query" | "mutation";
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
	};
	documentId: string;
	queryString: string;
};

/**
 * Function that executes a GraphQL query/mutation.
 * Implement this to connect the tools to your GraphQL client.
 */
export type GraphQLExecutor = (
	query: string,
	variables: Record<string, unknown>,
	documentId: string,
) => Promise<unknown>;

/**
 * Executable MCP tool with a handler function.
 */
export type ExecutableMCPTool = {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
	handler: (args: Record<string, unknown>) => Promise<unknown>;
};
