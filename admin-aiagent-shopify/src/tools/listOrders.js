import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { searchOrderCandidates } from "../lookups.js";

function formatOrder(order) {
  const total = order.totalPriceSet.shopMoney;
  const customer = order.customer ? order.customer.displayName : "guest";
  return `- ${order.name}: ${order.displayFinancialStatus} / ${order.displayFulfillmentStatus} — ${total.amount} ${total.currencyCode} — ${customer} (${new Date(order.createdAt).toLocaleDateString()})`;
}

export const listOrdersTool = tool(
  "list_orders",
  'List or search recent orders. Accepts a Shopify order search query (e.g. "financial_status:paid", "fulfillment_status:unfulfilled", "email:jane@example.com", or an order name like "#1001"). Leave empty to list the most recent orders.',
  {
    searchQuery: z.string().optional().default("").describe("A Shopify order search query, or empty for the most recent orders"),
    limit: z.number().int().min(1).max(50).optional().default(20),
  },
  async ({ searchQuery, limit }) => {
    try {
      const orders = await searchOrderCandidates(searchQuery, limit);
      if (orders.length === 0) {
        return { content: [{ type: "text", text: "No orders matched." }] };
      }
      return { content: [{ type: "text", text: orders.map(formatOrder).join("\n") }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to list orders: ${error.message}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }
);
