import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { listProductsTool } from "./tools/listProducts.js";
import { getProductTool } from "./tools/getProduct.js";
import { listLocationsTool } from "./tools/listLocations.js";
import { createUpdateInventoryTool } from "./tools/updateInventory.js";
import { listOrdersTool } from "./tools/listOrders.js";
import { getOrderTool } from "./tools/getOrder.js";
import { createUpdateOrderStatusTool } from "./tools/updateOrderStatus.js";
import { createFulfillOrderTool } from "./tools/fulfillOrder.js";
import { createUpdateFulfillmentStatusTool } from "./tools/updateFulfillmentStatus.js";
import { createUpdateProductTool } from "./tools/updateProduct.js";
import { listCustomersTool } from "./tools/listCustomers.js";

export const ADMIN_MCP_SERVER_NAME = "shopify-admin";

const TOOL_NAMES = [
  "list_products",
  "get_product",
  "list_locations",
  "update_inventory",
  "list_orders",
  "get_order",
  "update_order_status",
  "fulfill_order",
  "update_fulfillment_status",
  "update_product",
  "list_customers",
];

export const ALLOWED_TOOLS = TOOL_NAMES.map((name) => `mcp__${ADMIN_MCP_SERVER_NAME}__${name}`);

// Builds a fresh MCP server whose write tools close over one operator
// session's sessionState (specifically sessionState.role, set once from the
// frontend's role picker) so approval checks always use the role the
// operator actually selected, never one the model could supply itself.
export function createAdminMcpServer(sessionState) {
  return createSdkMcpServer({
    name: ADMIN_MCP_SERVER_NAME,
    version: "1.0.0",
    tools: [
      listProductsTool,
      getProductTool,
      listLocationsTool,
      createUpdateInventoryTool(sessionState),
      listOrdersTool,
      getOrderTool,
      createUpdateOrderStatusTool(sessionState),
      createFulfillOrderTool(sessionState),
      createUpdateFulfillmentStatusTool(sessionState),
      createUpdateProductTool(sessionState),
      listCustomersTool,
    ],
  });
}
