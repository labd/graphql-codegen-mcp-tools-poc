import type { PluginFunction } from "@graphql-codegen/plugin-helpers";
import { snakeCase } from "change-case";
import {
  type ArgumentNode,
  type DirectiveNode,
  type GraphQLEnumType,
  type GraphQLInputField,
  type GraphQLInputObjectType,
  type GraphQLInputType,
  type GraphQLSchema,
  type GraphQLType,
  Kind,
  type OperationDefinitionNode,
  type TypeNode,
  type VariableDefinitionNode,
  isEnumType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isScalarType,
  parse,
  print,
} from "graphql";
import * as fs from "node:fs";
import * as path from "node:path";
import { stripMcpDirectives } from "./strip-directives.js";

type MCPToolConfig = {
  /**
   * Path to the persisted-documents.json file (relative to codegen.ts).
   * @default "./generated/persisted-documents.json"
   */
  persistedDocumentsPath?: string;

  /**
   * Additional scalar type mappings (GraphQL scalar name → JSON Schema type).
   * Built-in mappings: String, ID, Int, Float, Boolean.
   */
  scalarSchemas?: Record<string, Record<string, string>>;
};

type GraphQLVariableDefinition = {
  name: string;
  type: string;
  required: boolean;
  description: string | null;
  jsonSchema: Record<string, unknown>;
};

type ExtractedToolDefinition = {
  operationName: string;
  toolName: string;
  description: string;
  operationType: "query" | "mutation";
  variables: GraphQLVariableDefinition[];
  documentId: string;
  queryString: string;
};

/** Built-in scalar type name to JSON Schema type mapping */
const SCALAR_TO_JSON_SCHEMA: Record<string, Record<string, string>> = {
  String: { type: "string" },
  ID: { type: "string" },
  Date: { type: "string" },
  DateTime: { type: "string" },
  Int: { type: "integer" },
  Float: { type: "number" },
  Boolean: { type: "boolean" },
};

const DEFAULT_JSON_SCHEMA = { type: "string" };

const GENERATED_TOOL_TYPE = `export type GeneratedMCPTool = {
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
};`;

function generateEmptyOutput(comment: string): string {
  return `// ${comment}
export const generatedMcpTools: GeneratedMCPTool[] = [];
${GENERATED_TOOL_TYPE}
`;
}

function withOptional<T extends Record<string, unknown>>(
  obj: T,
  key: string,
  value: unknown,
): T {
  return value ? { ...obj, [key]: value } : obj;
}

/**
 * Resolves GraphQL types to JSON Schema using the schema.
 * Recursively handles enums, input objects, lists, and scalars.
 */
class SchemaTypeResolver {
  private schema: GraphQLSchema;
  private scalarMappings: Record<string, Record<string, string>>;

  constructor(
    schema: GraphQLSchema,
    extraScalars?: Record<string, Record<string, string>>,
  ) {
    this.schema = schema;
    this.scalarMappings = { ...SCALAR_TO_JSON_SCHEMA, ...extraScalars };
  }

  resolveType(type: GraphQLType): Record<string, unknown> {
    if (isNonNullType(type)) {
      return this.resolveType(type.ofType);
    }
    if (isListType(type)) {
      return { type: "array", items: this.resolveType(type.ofType) };
    }
    if (isScalarType(type)) {
      return this.scalarToJsonSchema(type.name);
    }
    if (isEnumType(type)) {
      return this.enumToJsonSchema(type);
    }
    if (isInputObjectType(type)) {
      return this.inputObjectToJsonSchema(type);
    }
    return DEFAULT_JSON_SCHEMA;
  }

  resolveTypeByName(typeName: string): Record<string, unknown> {
    const type = this.schema.getType(typeName);
    return type
      ? this.resolveType(type as GraphQLInputType)
      : this.scalarToJsonSchema(typeName);
  }

  private scalarToJsonSchema(typeName: string): Record<string, unknown> {
    return this.scalarMappings[typeName] ?? DEFAULT_JSON_SCHEMA;
  }

  private enumToJsonSchema(enumType: GraphQLEnumType): Record<string, unknown> {
    const values = enumType.getValues();
    const enumValues = values.map((v) => v.name);
    const descriptions = values
      .filter((v) => v.description)
      .map((v) => `${v.name}: ${v.description}`)
      .join("; ");

    return withOptional(
      { type: "string", enum: enumValues },
      "description",
      descriptions,
    );
  }

  private inputObjectToJsonSchema(
    inputType: GraphQLInputObjectType,
  ): Record<string, unknown> {
    const fields = inputType.getFields();
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [fieldName, field] of Object.entries(fields)) {
      properties[fieldName] = this.resolveInputField(field);
      if (isNonNullType(field.type) && field.defaultValue === undefined) {
        required.push(fieldName);
      }
    }

    let schema: Record<string, unknown> = { type: "object", properties };
    schema = withOptional(
      schema,
      "required",
      required.length > 0 ? required : null,
    );
    schema = withOptional(schema, "description", inputType.description);
    return schema;
  }

  private resolveInputField(field: GraphQLInputField): Record<string, unknown> {
    return withOptional(
      this.resolveType(field.type),
      "description",
      field.description,
    );
  }

  getArgumentDescription(
    parentTypeName: string,
    fieldName: string,
    argName: string,
  ): string | null {
    const parentType = this.schema.getType(parentTypeName);
    if (!parentType || !("getFields" in parentType)) return null;

    const fields = (
      parentType as {
        getFields: () => Record<
          string,
          { args?: { name: string; description?: string | null }[] }
        >;
      }
    ).getFields();
    const field = fields[fieldName];
    if (!field?.args) return null;

    const arg = field.args.find((a) => a.name === argName);
    return arg?.description ?? null;
  }
}

function getDirectiveArgValue(
  directive: DirectiveNode,
  argName: string,
): string | null {
  const arg = directive.arguments?.find(
    (a: ArgumentNode) => a.name.value === argName,
  );
  return arg?.value.kind === Kind.STRING ? arg.value.value : null;
}

function getDirectiveBooleanArgValue(
  directive: DirectiveNode,
  argName: string,
): boolean {
  const arg = directive.arguments?.find(
    (a: ArgumentNode) => a.name.value === argName,
  );
  return arg?.value.kind === Kind.BOOLEAN && arg.value.value === true;
}

function graphqlTypeToJsonSchema(
  typeNode: TypeNode,
  resolver: SchemaTypeResolver,
  isRequired = false,
): { schema: Record<string, unknown>; required: boolean } {
  if (typeNode.kind === Kind.NON_NULL_TYPE) {
    return graphqlTypeToJsonSchema(typeNode.type, resolver, true);
  }
  if (typeNode.kind === Kind.LIST_TYPE) {
    const inner = graphqlTypeToJsonSchema(typeNode.type, resolver);
    return {
      schema: { type: "array", items: inner.schema },
      required: isRequired,
    };
  }
  return {
    schema: resolver.resolveTypeByName(typeNode.name.value),
    required: isRequired,
  };
}

function extractVariables(
  variableDefinitions: readonly VariableDefinitionNode[],
  resolver: SchemaTypeResolver,
  operationType: "query" | "mutation",
  rootFieldName: string,
): GraphQLVariableDefinition[] {
  const parentTypeName = operationType === "query" ? "Query" : "Mutation";

  return variableDefinitions.map((varDef) => {
    const varName = varDef.variable.name.value;

    const mcpVarDirective = varDef.directives?.find(
      (d) => d.name.value === "mcpToolVariable",
    );
    const directiveDescription = mcpVarDirective
      ? getDirectiveArgValue(mcpVarDirective, "description")
      : null;

    const schemaDescription = resolver.getArgumentDescription(
      parentTypeName,
      rootFieldName,
      varName,
    );

    const varDescription = directiveDescription ?? schemaDescription;
    const { schema, required } = graphqlTypeToJsonSchema(varDef.type, resolver);

    return {
      name: varName,
      type: print(varDef.type).replace(/!/g, "").trim(),
      required,
      description: varDescription,
      jsonSchema: withOptional(schema, "description", varDescription),
    };
  });
}

function extractToolFromPersistedDoc(
  documentId: string,
  queryString: string,
  resolver: SchemaTypeResolver,
): ExtractedToolDefinition | null {
  const document = parse(queryString);

  for (const definition of document.definitions) {
    if (definition.kind !== Kind.OPERATION_DEFINITION) continue;

    const operation = definition as OperationDefinitionNode;
    const mcpToolDirective = operation.directives?.find(
      (d) => d.name.value === "mcpTool",
    );

    if (
      mcpToolDirective &&
      getDirectiveBooleanArgValue(mcpToolDirective, "exclude")
    )
      continue;

    const operationName = operation.name?.value ?? "unnamed";

    const firstSelection = operation.selectionSet.selections[0];
    const rootFieldName =
      firstSelection?.kind === Kind.FIELD ? firstSelection.name.value : "";

    return {
      operationName,
      toolName: snakeCase(operationName),
      description: mcpToolDirective
        ? (getDirectiveArgValue(mcpToolDirective, "description") ?? "")
        : "",
      operationType: operation.operation as "query" | "mutation",
      variables: extractVariables(
        operation.variableDefinitions ?? [],
        resolver,
        operation.operation as "query" | "mutation",
        rootFieldName,
      ),
      documentId,
      queryString: stripMcpDirectives(queryString),
    };
  }

  return null;
}

function serializeToolToTypeScriptLiteral(
  tool: ExtractedToolDefinition,
): string {
  const properties = Object.fromEntries(
    tool.variables.map((v) => [v.name, v.jsonSchema]),
  );
  const required = tool.variables.filter((v) => v.required).map((v) => v.name);

  const indentMultilineString = (str: string, spaces: number): string =>
    str.split("\n").join(`\n${" ".repeat(spaces)}`);

  return `  {
    name: ${JSON.stringify(tool.toolName)},
    description: ${JSON.stringify(tool.description)},
    operationType: ${JSON.stringify(tool.operationType)},
    inputSchema: {
      type: "object",
      properties: ${indentMultilineString(JSON.stringify(properties, null, 6), 6)},
      required: ${JSON.stringify(required)},
    },
    documentId: ${JSON.stringify(tool.documentId)},
    queryString: ${JSON.stringify(tool.queryString)},
  }`;
}

/**
 * GraphQL Codegen plugin that generates MCP tool definitions from persisted documents.
 *
 * Reads the persisted-documents.json file generated by the client-preset and extracts
 * tool definitions from operations marked with @mcpTool directive. The persisted
 * documents contain complete query strings with all fragments inlined.
 */
export const plugin: PluginFunction<MCPToolConfig> = (
  schema,
  _documents,
  config,
) => {
  const persistedDocsPath =
    config?.persistedDocumentsPath ?? "./generated/persisted-documents.json";

  const resolver = new SchemaTypeResolver(schema, config?.scalarSchemas);
  const fullPath = path.resolve(process.cwd(), persistedDocsPath);

  let persistedDocs: Record<string, string>;
  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    persistedDocs = JSON.parse(content);
  } catch {
    return generateEmptyOutput(
      `Could not read persisted-documents.json at ${fullPath}\n// Make sure to run the client-preset codegen first to generate persisted documents.`,
    );
  }

  const tools = Object.entries(persistedDocs)
    .map(([documentId, queryString]) =>
      extractToolFromPersistedDoc(documentId, queryString, resolver),
    )
    .filter((tool): tool is ExtractedToolDefinition => tool !== null);

  const toolDefinitions = tools
    .map(serializeToolToTypeScriptLiteral)
    .join(",\n");

  return `/**
 * Auto-generated MCP tool definitions from GraphQL persisted documents.
 * DO NOT EDIT - This file is generated by codegen.
 */

${GENERATED_TOOL_TYPE}

export const generatedMcpTools: GeneratedMCPTool[] = [
${toolDefinitions}
];
`;
};
