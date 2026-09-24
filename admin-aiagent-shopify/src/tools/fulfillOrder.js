import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { adminRequest, assertNoUserErrors } from "../clients/adminClient.js";
import { searchOrderCandidates } from "../lookups.js";
import { resolveByName } from "../matching.js";
import { requireApproval } from "../approval.js";

const stripHash = (name) => name.replace(/^#/, "");

const FULFILLMENT_ORDERS_QUERY = `
  query OpenFulfillmentOrders($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 10) {
        edges { node { id status } }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `
  mutation CreateFulfillment($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

// Wraps fulfill_order's session-scoped role check and the two-step
// fulfillment-order lookup + fulfillmentCreateV2 mutation.
export function createFulfillOrderTool(sessionState) {
  return tool(
    "fulfill_order",
    "Mark an order's open fulfillment(s) as fulfilled, optionally with tracking info. This is a real write against the store - it requires the operator to explicitly confirm the change first.",
    {
      orderName: z.string().min(1).describe('The order name, e.g. "#1001" or "1001"'),
      trackingNumber: z.string().optional().default("").describe("Tracking number, if any"),
      trackingCompany: z.string().optional().default("").describe("Carrier name, if any"),
      trackingUrl: z.string().optional().default("").describe("Tracking URL, if any"),
      notifyCustomer: z.boolean().optional().default(false).describe("Email the customer their shipping confirmation"),
      confirmed: z.boolean().describe("Whether the operator has explicitly confirmed this action"),
    },
    async ({ orderName, trackingNumber, trackingCompany, trackingUrl, notifyCustomer, confirmed }) => {
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

        const data = await adminRequest(FULFILLMENT_ORDERS_QUERY, { id: match.id });
        const openFulfillmentOrders = data.order.fulfillmentOrders.edges
          .map((e) => e.node)
          .filter((fo) => fo.status === "OPEN");

        if (openFulfillmentOrders.length === 0) {
          return {
            content: [{ type: "text", text: `Order ${orderName} has no open fulfillments left to fulfill.` }],
            isError: true,
          };
        }

        const hasTracking = trackingNumber || trackingCompany || trackingUrl;
        const results = [];
        for (const fo of openFulfillmentOrders) {
          const result = await adminRequest(FULFILLMENT_CREATE_MUTATION, {
            fulfillment: {
              lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fo.id }],
              notifyCustomer,
              ...(hasTracking
                ? {
                    trackingInfo: {
                      number: trackingNumber || undefined,
                      company: trackingCompany || undefined,
                      url: trackingUrl || undefined,
                    },
                  }
                : {}),
            },
          });
          assertNoUserErrors(result.fulfillmentCreateV2.userErrors, "Failed to fulfill order");
          results.push(result.fulfillmentCreateV2.fulfillment);
        }

        const summary = `Order ${orderName} fulfilled (${results.length} fulfillment${results.length > 1 ? "s" : ""} created)${hasTracking ? ` with tracking ${trackingNumber}` : ""}.`;
        sessionState.actionsThisTurn?.push({ tool: "fulfill_order", summary });
        return { content: [{ type: "text", text: summary }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to fulfill order ${orderName}: ${error.message}` }],
          isError: true,
        };
      }
    },
    { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } }
  );
}
