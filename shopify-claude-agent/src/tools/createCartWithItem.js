import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { storefrontRequest } from "../clients/storefrontClient.js";

const CART_CREATE_MUTATION = `
  mutation CartCreate {
    cartCreate {
      cart {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const CART_LINES_ADD_MUTATION = `
  mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        id
        checkoutUrl
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

const outputSchema = z.object({
  checkoutUrl: z.string().url(),
});

export const createCartWithItemTool = tool(
  "create_cart_with_item",
  "Create a new storefront cart, add one line item to it, and return the cart's checkout URL.",
  inputSchema,
  async ({ variantId, quantity }) => {
    const createData = await storefrontRequest(CART_CREATE_MUTATION);
    if (createData.cartCreate.userErrors.length) {
      throw new Error(`cartCreate failed: ${JSON.stringify(createData.cartCreate.userErrors)}`);
    }
    const cartId = createData.cartCreate.cart.id;

    const addData = await storefrontRequest(CART_LINES_ADD_MUTATION, {
      cartId,
      lines: [{ merchandiseId: variantId, quantity }],
    });
    if (addData.cartLinesAdd.userErrors.length) {
      throw new Error(`cartLinesAdd failed: ${JSON.stringify(addData.cartLinesAdd.userErrors)}`);
    }

    const result = outputSchema.parse({
      checkoutUrl: addData.cartLinesAdd.cart.checkoutUrl,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);
