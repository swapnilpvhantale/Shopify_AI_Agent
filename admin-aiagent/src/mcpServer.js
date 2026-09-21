import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { checkInventoryLevelTool } from "./tools/inventory.js";
import { updateOrderStatusTool } from "./tools/orders.js";

export const OPS_MCP_SERVER_NAME = "shopify-ops";

export const TOOL_NAMES = ["check_inventory_level", "update_order_status"];

export const ALLOWED_TOOLS = TOOL_NAMES.map((name) => `mcp__${OPS_MCP_SERVER_NAME}__${name}`);

export const opsMcpServer = createSdkMcpServer({
  name: OPS_MCP_SERVER_NAME,
  version: "1.0.0",
  tools: [checkInventoryLevelTool, updateOrderStatusTool],
});
