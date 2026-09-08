import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { searchProductsTool } from "./tools/searchProducts.js";
import { createCartWithItemTool } from "./tools/createCartWithItem.js";
import { createDraftOrderTool } from "./tools/createDraftOrder.js";

export const SHOPIFY_MCP_SERVER_NAME = "shopify";

export const TOOL_NAMES = ["search_products", "create_cart_with_item", "create_draft_order"];

export const ALLOWED_TOOLS = TOOL_NAMES.map(
  (name) => `mcp__${SHOPIFY_MCP_SERVER_NAME}__${name}`
);

export const shopifyMcpServer = createSdkMcpServer({
  name: SHOPIFY_MCP_SERVER_NAME,
  version: "1.0.0",
  tools: [searchProductsTool, createCartWithItemTool, createDraftOrderTool],
});
