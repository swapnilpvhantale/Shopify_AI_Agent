import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { adminRequest, assertNoUserErrors } from "../clients/adminClient.js";
import { searchOrderCandidates } from "../lookups.js";
import { resolveByName } from "../matching.js";
import { requireApproval } from "../approval.js";

const stripHash = (name) => name.replace(/^#/, "");

async function resolveOrderId(orderName) {
  const candidates = await searchOrderCandidates(`name:${stripHash(orderName)}`);
  const match = resolveByName(candidates, stripHash(orderName), (o) => stripHash(o.name));
  return match.id;
}

const CLOSE_MUTATION = `
  mutation CloseOrder($id: ID!) {
    orderClose(input: { id: $id }) {
      order { id closedAt }
      userErrors { field message }
    }
  }
`;

const OPEN_MUTATION = `
  mutation ReopenOrder($id: ID!) {
    orderOpen(input: { id: $id }) {
      order { id closedAt }
      userErrors { field message }
    }
  }
`;

const CANCEL_MUTATION = `
  mutation CancelOrder($id: ID!, $restock: Boolean!, $refund: Boolean!, $notifyCustomer: Boolean!) {
    orderCancel(orderId: $id, reason: OTHER, restock: $restock, refund: $refund, notifyCustomer: $notifyCustomer) {
      job { id }
      orderCancelUserErrors { field message }
    }
  }
`;

// Wraps update_order_status's session-scoped role check and the mutation
// call so the tool body itself just dispatches on the requested action.
export function createUpdateOrderStatusTool(sessionState) {
  return tool(
    "update_order_status",
    "Close, reopen, or cancel a Shopify order. This is a real write against the store - it requires the operator to explicitly confirm the change first.",
    {
      orderName: z.string().min(1).describe('The order name, e.g. "#1001" or "1001"'),
      action: z.enum(["close", "reopen", "cancel"]).describe("The status change to apply"),
      restock: z.boolean().optional().default(false).describe("Cancel only: restock the cancelled items"),
      refund: z.boolean().optional().default(false).describe("Cancel only: refund any payments already captured"),
      notifyCustomer: z.boolean().optional().default(false).describe("Cancel only: email the customer about the cancellation"),
      confirmed: z.boolean().describe("Whether the operator has explicitly confirmed this action"),
    },
    async ({ orderName, action, restock, refund, notifyCustomer, confirmed }) => {
      const approval = requireApproval({ role: sessionState.role, confirmed });
      if (!approval.approved) {
        return {
          content: [{ type: "text", text: `Approval denied: ${approval.reason}` }],
          isError: true,
        };
      }

      try {
        const orderId = await resolveOrderId(orderName);

        if (action === "close") {
          const data = await adminRequest(CLOSE_MUTATION, { id: orderId });
          assertNoUserErrors(data.orderClose.userErrors, "Failed to close order");
          const summary = `Order ${orderName} closed.`;
          sessionState.actionsThisTurn?.push({ tool: "update_order_status", summary });
          return { content: [{ type: "text", text: summary }] };
        }

        if (action === "reopen") {
          const data = await adminRequest(OPEN_MUTATION, { id: orderId });
          assertNoUserErrors(data.orderOpen.userErrors, "Failed to reopen order");
          const summary = `Order ${orderName} reopened.`;
          sessionState.actionsThisTurn?.push({ tool: "update_order_status", summary });
          return { content: [{ type: "text", text: summary }] };
        }

        const data = await adminRequest(CANCEL_MUTATION, {
          id: orderId,
          restock,
          refund,
          notifyCustomer,
        });
        assertNoUserErrors(data.orderCancel.orderCancelUserErrors, "Failed to cancel order");
        const summary = `Order ${orderName} cancellation submitted (restock: ${restock}, refund: ${refund}, notify: ${notifyCustomer}).`;
        sessionState.actionsThisTurn?.push({ tool: "update_order_status", summary });
        return { content: [{ type: "text", text: summary }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to ${action} order ${orderName}: ${error.message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }
  );
}
