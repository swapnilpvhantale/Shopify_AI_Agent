import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getCustomerOrders } from "../clients/orders.js";

const inputSchema = {
  orderNumber: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined)
    .describe("Optional order number (e.g. '1005' or '#1005') to look up one specific order. Omit to list recent orders."),
};

export function createGetOrdersTool(sessionState) {
  return tool(
    "get_orders",
    "Look up the signed-in shopper's own past orders (status, total, items) — optionally filtered to one order number. Requires the shopper to be logged in; if they aren't, tell them to log in first.",
    inputSchema,
    async ({ orderNumber }) => {
      if (!sessionState.customer?.accessToken) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "not_logged_in" }),
            },
          ],
        };
      }

      const orders = await getCustomerOrders(sessionState.customer.accessToken, orderNumber);

      return {
        content: [{ type: "text", text: JSON.stringify({ orders }) }],
      };
    }
  );
}
