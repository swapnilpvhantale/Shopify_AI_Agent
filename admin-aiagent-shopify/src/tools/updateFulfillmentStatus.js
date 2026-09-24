import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { adminRequest, assertNoUserErrors } from "../clients/adminClient.js";
import { searchOrderCandidates, getOrderDetail } from "../lookups.js";
import { resolveByName } from "../matching.js";
import { requireApproval } from "../approval.js";

const stripHash = (name) => name.replace(/^#/, "");

// Matches Shopify's FulfillmentEventStatus enum exactly - these are shipment
// tracking milestones, distinct from order status (close/reopen/cancel) and
// from the order-level "fulfilled/unfulfilled" state fulfill_order sets.
const STATUSES = [
  "LABEL_PURCHASED",
  "LABEL_PRINTED",
  "READY_FOR_PICKUP",
  "CONFIRMED",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "ATTEMPTED_DELIVERY",
  "DELAYED",
  "DELIVERED",
  "FAILURE",
  "CARRIER_PICKED_UP",
];

const EVENT_CREATE_MUTATION = `
  mutation CreateFulfillmentEvent($fulfillmentEvent: FulfillmentEventInput!) {
    fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
      fulfillmentEvent { status happenedAt }
      userErrors { field message }
    }
  }
`;

// Wraps update_fulfillment_status's session-scoped role check and the
// fulfillmentEventCreate mutation - a shipment tracking event, not a change
// to the order or fulfillment record itself.
export function createUpdateFulfillmentStatusTool(sessionState) {
  return tool(
    "update_fulfillment_status",
    "Record a shipment tracking milestone (e.g. in transit, out for delivery, delivered) on an order's fulfillment. This is a real write against the store - it requires the operator to explicitly confirm the change first.",
    {
      orderName: z.string().min(1).describe('The order name, e.g. "#1001" or "1001"'),
      status: z.enum(STATUSES).describe("The tracking milestone to record"),
      message: z.string().optional().default("").describe("Optional note to attach to this event"),
      confirmed: z.boolean().describe("Whether the operator has explicitly confirmed this change"),
    },
    async ({ orderName, status, message, confirmed }) => {
      const approval = requireApproval({ role: sessionState.role, confirmed });
      if (!approval.approved) {
        return {
          content: [{ type: "text", text: `Approval denied: ${approval.reason}` }],
          isError: true,
        };
      }

      try {
        const candidates = await searchOrderCandidates(`name:${stripHash(orderName)}`);
        const match = resolveByName(candidates, stripHash(orderName), (o) => stripHash(o.name));
        const order = await getOrderDetail(match.id);

        if (order.fulfillments.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `Order ${orderName} has no fulfillment yet - use fulfill_order first.`,
              },
            ],
            isError: true,
          };
        }
        // Most orders here have exactly one fulfillment; when there's more
        // than one (split shipments), the most recent one is the one a
        // tracking update almost always refers to.
        const fulfillment = order.fulfillments[order.fulfillments.length - 1];

        const data = await adminRequest(EVENT_CREATE_MUTATION, {
          fulfillmentEvent: {
            fulfillmentId: fulfillment.id,
            status,
            ...(message ? { message } : {}),
          },
        });
        assertNoUserErrors(
          data.fulfillmentEventCreate.userErrors,
          "Failed to update fulfillment status"
        );

        const summary = `Order ${orderName} fulfillment marked ${status.replaceAll("_", " ").toLowerCase()}.`;
        sessionState.actionsThisTurn?.push({ tool: "update_fulfillment_status", summary });

        return { content: [{ type: "text", text: summary }] };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Failed to update fulfillment status for order ${orderName}: ${error.message}` },
          ],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }
  );
}
