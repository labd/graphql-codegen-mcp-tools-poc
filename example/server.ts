import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import type { GraphQLExecutor } from "../src/runtime/index.js";
import { createToolFromGenerated } from "../src/runtime/index.js";

// Import the generated tools (run `pnpm codegen` first)
// @ts-expect-error — generated file may not exist yet
import { generatedMcpTools } from "./generated/mcp-tools.generated.js";

// ------------------------------------------------------------------
// 1. Implement your GraphQL executor
// ------------------------------------------------------------------
// In production, replace this mock with a real fetch to your GraphQL
// server. The executor receives the query string, variables, and
// document ID.
//
// Example production executor:
//
//   const executor: GraphQLExecutor = async (query, variables, documentId) => {
//     const res = await fetch("http://localhost:4000/graphql", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ query, variables }),
//     });
//     const { data, errors } = await res.json();
//     if (errors?.length) throw new Error(JSON.stringify(errors));
//     return data;
//   };

const mockData: Record<string, (vars: Record<string, unknown>) => unknown> = {
  productSearch: (vars) => ({
    productSearch: {
      total: 2,
      results: [
        {
          slug: "classic-leather-jacket",
          name: "Classic Leather Jacket",
          variant: {
            sku: "CLJ-001",
            name: "Black / M",
            availability: "InStock",
            price: { gross: { centAmount: 24900, currency: "EUR" } },
          },
        },
        {
          slug: "wool-blend-overcoat",
          name: "Wool Blend Overcoat",
          variant: {
            sku: "WBO-042",
            name: "Navy / L",
            availability: "InStock",
            price: { gross: { centAmount: 18900, currency: "EUR" } },
          },
        },
      ],
      facets: [
        {
          key: "category",
          label: "Category",
          options: [
            { key: "jackets", label: "Jackets", count: 34 },
            { key: "coats", label: "Coats", count: 21 },
          ],
        },
      ],
    },
  }),

  product: (vars) => ({
    product: {
      name: "Classic Leather Jacket",
      description:
        "Timeless leather jacket crafted from full-grain cowhide with a satin lining.",
      variant: {
        sku: "CLJ-001",
        name: "Black / M",
        availability: "InStock",
        price: {
          gross: { centAmount: 24900, currency: "EUR" },
          net: { centAmount: 20579, currency: "EUR" },
        },
      },
    },
  }),

  cart: () => ({
    cart: {
      id: "cart-abc-123",
      lineItems: [
        {
          id: "li-1",
          quantity: 1,
          variant: { sku: "CLJ-001", name: "Black / M" },
        },
      ],
      totalPrice: { centAmount: 24900, currency: "EUR" },
    },
  }),

  cartAddLineItems: (vars) => ({
    cartAddLineItems: {
      cart: {
        id: vars.cartId ?? "cart-abc-123",
        lineItems: [
          {
            id: "li-1",
            quantity: 1,
            variant: { sku: "CLJ-001", name: "Black / M" },
          },
          {
            id: "li-2",
            quantity:
              (vars.lineItems as Array<{ quantity: number }>)?.[0]?.quantity ??
              1,
            variant: {
              sku:
                (vars.lineItems as Array<{ sku: string }>)?.[0]?.sku ??
                "ITEM-NEW",
              name: "New Item",
            },
          },
        ],
      },
      errors: null,
    },
  }),

  cartRemoveLineItems: (vars) => ({
    cartRemoveLineItems: {
      cart: {
        id: vars.cartId ?? "cart-abc-123",
        lineItems: [],
      },
      errors: null,
    },
  }),
};

// Detect the operation from the query string and return mock data
const executor: GraphQLExecutor = async (query, variables) => {
  const operationMatch = query.match(/(?:query|mutation)\s+(\w+)/);
  const operationName = operationMatch?.[1];

  // Map operation names to their root field
  const operationToField: Record<string, string> = {
    GetProducts: "productSearch",
    GetProductDetail: "product",
    GetCart: "cart",
    AddToCart: "cartAddLineItems",
    RemoveFromCart: "cartRemoveLineItems",
  };

  const field = operationName ? operationToField[operationName] : undefined;
  const handler = field ? mockData[field] : undefined;

  if (handler) {
    console.log(`  [mock] ${operationName} → ${field}`);
    return handler(variables ?? {});
  }

  throw new Error(
    `No mock data for operation "${operationName}". Replace this executor with a real GraphQL fetch in production.`,
  );
};

// ------------------------------------------------------------------
// 2. Register tools on a fresh MCP server instance
// ------------------------------------------------------------------
function createMcpServer(): McpServer {
  const server = new McpServer({ name: "my-graphql-mcp", version: "0.1.0" });

  const tools = generatedMcpTools.map((t: (typeof generatedMcpTools)[number]) =>
    createToolFromGenerated(t, executor),
  );

  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.inputSchema, async (args) => {
      const result = await tool.handler(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    });
  }

  return server;
}

// ------------------------------------------------------------------
// 3. Start HTTP server (stateless Streamable HTTP transport)
// ------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3001;
const toolCount = generatedMcpTools.length;

const httpServer = createServer(async (req, res) => {
  // In stateless mode, each request gets a fresh server + transport
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        }),
      );
    }
  }
});

httpServer.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`MCP server running with ${toolCount} tools`);
  console.log();
  console.log(`Local endpoint: ${url}`);
  console.log("Run this in another terminal to expose HTTPS:");
  console.log(`  ngrok http ${PORT}`);
  console.log();
  console.log(
    "Then set the ngrok HTTPS forwarding URL in Claude Desktop as a Remote MCP server.",
  );
  console.log(
    "Guide: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  );
  console.log();
  console.log(`Or test with: mcp-inspector --transport http ${url}`);
});
