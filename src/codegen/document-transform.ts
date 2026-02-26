import type { Types } from "@graphql-codegen/plugin-helpers";
import { type DefinitionNode, type DocumentNode, Kind, visit } from "graphql";

const MCP_DIRECTIVES = new Set(["mcpTool", "mcpToolVariable"]);

/**
 * Document transform that filters operations to only include those marked with the
 * @mcpTool directive, plus any fragments they depend on.
 *
 * The MCP directives are stripped from the output so that persisted documents
 * contain clean queries your GraphQL server can execute.
 */
export const mcpToolTransform: Types.DocumentTransformObject = {
	transform({ documents }) {
		// Collect all fragments from all documents
		const allFragments = new Map<string, DefinitionNode>();
		for (const doc of documents) {
			if (!doc.document) continue;
			for (const def of doc.document.definitions) {
				if (def.kind === Kind.FRAGMENT_DEFINITION) {
					allFragments.set(def.name.value, def);
				}
			}
		}

		// Recursively collect fragment dependencies
		const collectFragmentDeps = (
			node: DocumentNode | DefinitionNode,
			collected: Set<string>,
		) => {
			visit(node, {
				FragmentSpread(spread) {
					const name = spread.name.value;
					if (!collected.has(name)) {
						collected.add(name);
						const fragment = allFragments.get(name);
						if (fragment) {
							collectFragmentDeps(fragment, collected);
						}
					}
				},
			});
		};

		// Filter documents, keeping @mcpTool ops and their fragments
		const requiredFragments = new Set<string>();

		for (const doc of documents) {
			if (!doc.document) continue;
			for (const def of doc.document.definitions) {
				if (def.kind === Kind.OPERATION_DEFINITION) {
					const isExposed = def.directives?.some(
						(d) => d.name.value === "mcpTool",
					);
					if (isExposed) {
						collectFragmentDeps(def, requiredFragments);
					}
				}
			}
		}

		return documents
			.map((doc) => {
				if (!doc.document) return doc;

				const filteredDefinitions = doc.document.definitions.filter((def) => {
					if (def.kind === Kind.OPERATION_DEFINITION) {
						return def.directives?.some((d) => d.name.value === "mcpTool");
					}
					if (def.kind === Kind.FRAGMENT_DEFINITION) {
						return requiredFragments.has(def.name.value);
					}
					return false;
				});

				if (filteredDefinitions.length === 0) return undefined;

				// Strip @mcpTool / @mcpToolVariable directives so persisted
				// documents contain only server-executable queries.
				const strippedDocument = visit(
					{ ...doc.document, definitions: filteredDefinitions },
					{
						Directive(node) {
							if (MCP_DIRECTIVES.has(node.name.value)) {
								return null;
							}
						},
					},
				);

				return {
					...doc,
					document: strippedDocument,
				};
			})
			.filter(Boolean) as Types.DocumentFile[];
	},
};
