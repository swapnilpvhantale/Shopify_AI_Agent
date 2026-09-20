import { storefrontRequest } from "./storefrontClient.js";

const CART_FIELDS = `
  id
  checkoutUrl
  cost {
    totalAmount {
      amount
      currencyCode
    }
  }
  lines(first: 50) {
    edges {
      node {
        id
        quantity
        merchandise {
          ... on ProductVariant {
            id
            title
            product {
              title
            }
            price {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
`;

const CART_CREATE_MUTATION = `
  mutation CartCreate {
    cartCreate {
      cart { ${CART_FIELDS} }
      userErrors { field message }
    }
  }
`;

const CART_QUERY = `
  query GetCart($cartId: ID!) {
    cart(id: $cartId) {
      ${CART_FIELDS}
    }
  }
`;

const CART_LINES_ADD_MUTATION = `
  mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart { ${CART_FIELDS} }
      userErrors { field message }
    }
  }
`;

const CART_LINES_UPDATE_MUTATION = `
  mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart { ${CART_FIELDS} }
      userErrors { field message }
    }
  }
`;

const CART_LINES_REMOVE_MUTATION = `
  mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { ${CART_FIELDS} }
      userErrors { field message }
    }
  }
`;

const CART_BUYER_IDENTITY_UPDATE_MUTATION = `
  mutation CartBuyerIdentityUpdate($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
    cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
      cart { ${CART_FIELDS} }
      userErrors { field message }
    }
  }
`;

// The model never needs the internal cart/line-item GIDs used to mutate the
// cart, but it does need each line's variantId — update_cart_item and
// add_to_cart both key off it, and the shopper may refer to something
// already in the cart that the model never personally searched for (e.g.
// added via the product card's own button) with no other way to identify it.
export function cartForModel(cart) {
  return {
    checkoutUrl: cart.checkoutUrl,
    totalAmount: cart.totalAmount,
    currencyCode: cart.currencyCode,
    lines: cart.lines.map(({ variantId, productTitle, variantTitle, quantity, price }) => ({
      variantId,
      productTitle,
      variantTitle,
      quantity,
      price,
    })),
  };
}

function toCartSummary(cart) {
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalAmount: cart.cost.totalAmount.amount,
    currencyCode: cart.cost.totalAmount.currencyCode,
    lines: cart.lines.edges.map(({ node }) => ({
      lineId: node.id,
      variantId: node.merchandise.id,
      productTitle: node.merchandise.product.title,
      variantTitle: node.merchandise.title,
      quantity: node.quantity,
      price: node.merchandise.price,
    })),
  };
}

export async function createCart() {
  const data = await storefrontRequest(CART_CREATE_MUTATION);
  if (data.cartCreate.userErrors.length) {
    throw new Error(`cartCreate failed: ${JSON.stringify(data.cartCreate.userErrors)}`);
  }
  return toCartSummary(data.cartCreate.cart);
}

export async function fetchCart(cartId) {
  const data = await storefrontRequest(CART_QUERY, { cartId });
  if (!data.cart) return null;
  return toCartSummary(data.cart);
}

// Adds `quantity` of `variantId` to the cart. If the cart already has a line
// for that variant, merges into it (cartLinesUpdate) instead of creating a
// second, duplicate line for the same variant (cartLinesAdd never merges).
export async function addItemToCart(cartId, variantId, quantity) {
  const existing = await fetchCart(cartId);
  const existingLine = existing?.lines.find((line) => line.variantId === variantId);

  if (existingLine) {
    const data = await storefrontRequest(CART_LINES_UPDATE_MUTATION, {
      cartId,
      lines: [{ id: existingLine.lineId, quantity: existingLine.quantity + quantity }],
    });
    if (data.cartLinesUpdate.userErrors.length) {
      throw new Error(`cartLinesUpdate failed: ${JSON.stringify(data.cartLinesUpdate.userErrors)}`);
    }
    return toCartSummary(data.cartLinesUpdate.cart);
  }

  const data = await storefrontRequest(CART_LINES_ADD_MUTATION, {
    cartId,
    lines: [{ merchandiseId: variantId, quantity }],
  });
  if (data.cartLinesAdd.userErrors.length) {
    throw new Error(`cartLinesAdd failed: ${JSON.stringify(data.cartLinesAdd.userErrors)}`);
  }
  return toCartSummary(data.cartLinesAdd.cart);
}

// Sets a line's quantity to an exact number (not additive, unlike
// addItemToCart) — pass 0 to remove the line entirely. Returns the cart
// unchanged if the variant isn't in it.
export async function setLineQuantity(cartId, variantId, quantity) {
  const existing = await fetchCart(cartId);
  const existingLine = existing?.lines.find((line) => line.variantId === variantId);
  if (!existingLine) return existing;

  if (quantity <= 0) {
    const data = await storefrontRequest(CART_LINES_REMOVE_MUTATION, {
      cartId,
      lineIds: [existingLine.lineId],
    });
    if (data.cartLinesRemove.userErrors.length) {
      throw new Error(`cartLinesRemove failed: ${JSON.stringify(data.cartLinesRemove.userErrors)}`);
    }
    return toCartSummary(data.cartLinesRemove.cart);
  }

  const data = await storefrontRequest(CART_LINES_UPDATE_MUTATION, {
    cartId,
    lines: [{ id: existingLine.lineId, quantity }],
  });
  if (data.cartLinesUpdate.userErrors.length) {
    throw new Error(`cartLinesUpdate failed: ${JSON.stringify(data.cartLinesUpdate.userErrors)}`);
  }
  return toCartSummary(data.cartLinesUpdate.cart);
}

// Attaches a logged-in customer to the cart so Shopify's checkout opens
// already signed in (pre-filled email/address, order tied to their account)
// instead of as a guest.
export async function setCartBuyerIdentity(cartId, { customerAccessToken, email }) {
  const data = await storefrontRequest(CART_BUYER_IDENTITY_UPDATE_MUTATION, {
    cartId,
    buyerIdentity: { customerAccessToken, email },
  });
  if (data.cartBuyerIdentityUpdate.userErrors.length) {
    throw new Error(
      `cartBuyerIdentityUpdate failed: ${JSON.stringify(data.cartBuyerIdentityUpdate.userErrors)}`
    );
  }
  return toCartSummary(data.cartBuyerIdentityUpdate.cart);
}
