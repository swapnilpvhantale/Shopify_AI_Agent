import { storefrontRequest } from "./storefrontClient.js";

const CUSTOMER_ORDERS_QUERY = `
  query CustomerOrders($customerAccessToken: String!) {
    customer(customerAccessToken: $customerAccessToken) {
      orders(first: 15, sortKey: PROCESSED_AT, reverse: true) {
        edges {
          node {
            name
            processedAt
            financialStatus
            fulfillmentStatus
            currentTotalPrice {
              amount
              currencyCode
            }
            lineItems(first: 20) {
              edges {
                node {
                  title
                  quantity
                }
              }
            }
          }
        }
      }
    }
  }
`;

function toOrderSummary(node) {
  return {
    orderName: node.name,
    processedAt: node.processedAt,
    paymentStatus: node.financialStatus,
    fulfillmentStatus: node.fulfillmentStatus,
    total: node.currentTotalPrice,
    items: node.lineItems.edges.map(({ node: item }) => ({
      title: item.title,
      quantity: item.quantity,
    })),
  };
}

// Only ever returns orders belonging to whoever this customerAccessToken
// authenticates as — there's no path here to look up someone else's order.
export async function getCustomerOrders(customerAccessToken, orderNumber) {
  const data = await storefrontRequest(CUSTOMER_ORDERS_QUERY, { customerAccessToken });
  const orders = data.customer?.orders.edges.map(({ node }) => toOrderSummary(node)) ?? [];

  if (!orderNumber) return orders;

  const normalized = orderNumber.toString().replace(/^#/, "");
  return orders.filter((order) => order.orderName.replace(/^#/, "") === normalized);
}
