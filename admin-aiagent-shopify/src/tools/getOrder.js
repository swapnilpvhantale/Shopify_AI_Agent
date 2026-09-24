import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { searchOrderCandidates, getOrderDetail } from "../lookups.js";
import { resolveByName } from "../matching.js";

const stripHash = (name) => name.replace(/^#/, "");

export const getOrderTool = tool(
  "get_order",
  'Get full detail for one order by its order name (e.g. "#1001" or "1001"): financial/fulfillment status, customer, shipping address, line items, and any fulfillments with tracking info.',
  {
    orderName: z.string().min(1).describe('The order name, e.g. "#1001" or "1001"'),
  },
  async ({ orderName }) => {
    try {
      const candidates = await searchOrderCandidates(`name:${stripHash(orderName)}`);
      const match = resolveByName(candidates, stripHash(orderName), (o) => stripHash(o.name));
      const order = await getOrderDetail(match.id);

      const lines = order.lineItems.edges.map(({ node }) => {
        const price = node.originalUnitPriceSet.shopMoney;
        const variant = node.variant?.title && node.variant.title !== "Default Title" ? ` (${node.variant.title})` : "";
        return `  - ${node.title}${variant} × ${node.quantity} @ ${price.amount} ${price.currencyCode}`;
      });

      const fulfillments = order.fulfillments
        .map((f) => {
          const tracking = f.trackingInfo.map((t) => `${t.company || "carrier"} ${t.number}`).join(", ");
          return `  - ${f.status}${tracking ? ` (${tracking})` : ""}`;
        })
        .join("\n");

      const address = order.shippingAddress
        ? `${order.shippingAddress.address1 || ""} ${order.shippingAddress.city || ""} ${order.shippingAddress.province || ""} ${order.shippingAddress.country || ""} ${order.shippingAddress.zip || ""}`.trim()
        : "no shipping address";

      const total = order.totalPriceSet.shopMoney;
      const text = [
        `${order.name} — ${order.displayFinancialStatus} / ${order.displayFulfillmentStatus}`,
        `Customer: ${order.customer ? `${order.customer.displayName} <${order.customer.email}>` : "guest"}`,
        `Shipping to: ${address}`,
        `Total: ${total.amount} ${total.currencyCode}`,
        order.cancelledAt ? `Cancelled at: ${order.cancelledAt}` : null,
        order.closedAt ? `Closed at: ${order.closedAt}` : null,
        "Line items:",
        ...lines,
        fulfillments ? "Fulfillments:" : null,
        fulfillments || null,
      ]
        .filter(Boolean)
        .join("\n");

      return { content: [{ type: "text", text }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to get order: ${error.message}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }
);
