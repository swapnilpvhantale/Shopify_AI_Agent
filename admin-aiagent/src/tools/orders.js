import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { shopifyAdminRequest } from "../shopifyClient.js";
import { requireApproval } from "../approval.js";

export const UPDATE_ORDER_STATUS_SCOPES = ["write_orders"];

const ACTION_ENDPOINT = { close: "close", reopen: "open", cancel: "cancel" };
const ACTION_PAST_TENSE = { close: "closed", reopen: "reopened", cancel: "cancelled" };

export const updateOrderStatusTool = tool(
  "update_order_status",
  "Close, reopen, or cancel a Shopify order. This is a real write against the store - it requires the caller's role and explicit confirmation, and is rejected for shoppers or without confirmation.",
  {
    orderId: z.union([z.string(), z.number()]).describe("The Shopify order ID"),
    action: z.enum(["close", "reopen", "cancel"]).describe("The status change to apply"),
    role: z
      .enum(["admin", "staff", "shopper"])
      .describe("The role of the person requesting this action"),
    confirmed: z.boolean().describe("Whether the person has explicitly confirmed this action"),
  },
  async ({ orderId, action, role, confirmed }) => {
    const approval = requireApproval({ role, confirmed });
    if (!approval.approved) {
      return {
        content: [{ type: "text", text: `Approval denied: ${approval.reason}` }],
        isError: true,
      };
    }

    try {
      const endpoint = ACTION_ENDPOINT[action];
      const data = await shopifyAdminRequest(`orders/${orderId}/${endpoint}.json`, {
        method: "POST",
        body: {},
      });

      return {
        content: [
          {
            type: "text",
            text: `Order ${orderId} ${ACTION_PAST_TENSE[action]}. Status: ${JSON.stringify({
              closed_at: data.order?.closed_at ?? null,
              cancelled_at: data.order?.cancelled_at ?? null,
            })}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to ${action} order ${orderId}: ${error.message}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }
);
