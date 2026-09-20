// Maps a Storefront cart's token (the same token Shopify includes as
// `cart_token` on the orders/create webhook payload) back to the chat
// sessionId that created it, so an incoming webhook for a completed order
// can be routed to the right browser session.
const cartTokenToSessionId = new Map();

export function extractCartToken(cartId) {
  const match = /Cart\/([^?]+)/.exec(cartId ?? "");
  return match ? match[1] : null;
}

export function registerCart(cartId, sessionId) {
  const token = extractCartToken(cartId);
  if (token) cartTokenToSessionId.set(token, sessionId);
}

export function getSessionIdForCartToken(token) {
  return cartTokenToSessionId.get(token);
}
