import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { adminRequest } from "../clients/adminClient.js";
import { ask } from "../readline.js";

const DRAFT_ORDER_CREATE_MUTATION = `
  mutation CreateDraftOrder($variantId: ID!, $quantity: Int!) {
    draftOrderCreate(input: { lineItems: [{ variantId: $variantId, quantity: $quantity }] }) {
      draftOrder {
        id
        invoiceUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const inputSchema = {
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
};

const successSchema = z.object({
  invoiceUrl: z.string().url(),
});

const declinedSchema = z.object({
  error: z.string(),
});

export const createDraftOrderTool = tool(
  "create_draft_order",
  "Create a draft order in Shopify Admin for one line item and return its invoice URL. Requires an interactive y/n confirmation before it runs.",
  inputSchema,
  async ({ variantId, quantity }) => {
    const answer = await ask(
      `Confirm: create a draft order for ${quantity} x ${variantId}? (y/n): `
    );

    if (answer !== "y") {
      const declined = declinedSchema.parse({
        error: "Draft order creation was declined: confirmation answer was not 'y'.",
      });
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(declined, null, 2) }],
      };
    }

    const data = await adminRequest(DRAFT_ORDER_CREATE_MUTATION, { variantId, quantity });
    if (data.draftOrderCreate.userErrors.length) {
      throw new Error(
        `draftOrderCreate failed: ${JSON.stringify(data.draftOrderCreate.userErrors)}`
      );
    }

    const result = successSchema.parse({
      invoiceUrl: data.draftOrderCreate.draftOrder.invoiceUrl,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);
