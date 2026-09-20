import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { createSearchProductsTool } from "./tools/searchProducts.js";
import { createAddToCartTool } from "./tools/addToCart.js";
import { createUpdateCartItemTool } from "./tools/updateCartItem.js";
import { createGetCartTool } from "./tools/getCart.js";
import { createBeginCheckoutTool } from "./tools/beginCheckout.js";
import { createGetOrdersTool } from "./tools/getOrders.js";

export const SHOPIFY_MCP_SERVER_NAME = "shopify";

const TOOL_NAMES = [
  "search_products",
  "add_to_cart",
  "update_cart_item",
  "get_cart",
  "begin_checkout",
  "get_orders",
];

export const ALLOWED_TOOLS = TOOL_NAMES.map(
  (name) => `mcp__${SHOPIFY_MCP_SERVER_NAME}__${name}`
);

// Builds a fresh MCP server whose tools close over one conversation's
// sessionState (cart + last search results), so each chat session gets its
// own isolated cart instead of sharing one across every visitor.
export function createShopifyMcpServer(sessionState) {
  return createSdkMcpServer({
    name: SHOPIFY_MCP_SERVER_NAME,
    version: "1.0.0",
    tools: [
      createSearchProductsTool(sessionState),
      createAddToCartTool(sessionState),
      createUpdateCartItemTool(sessionState),
      createGetCartTool(sessionState),
      createBeginCheckoutTool(sessionState),
      createGetOrdersTool(sessionState),
    ],
  });
}
