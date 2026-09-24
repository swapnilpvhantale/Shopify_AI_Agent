import { adminRequest } from "./clients/adminClient.js";

// Shared read queries used by several tools - keeps the GraphQL shapes and
// the "search candidates, then resolve one" flow in one place instead of
// duplicated per tool.

export async function searchProductCandidates(searchTerm, limit = 25) {
  // Shopify's product search is a tokenized full-text index, not a literal
  // substring match: wrapping the term in a `title:*term*` wildcard mostly
  // matches on token *prefixes* (so "a" matches "Aloha"/"Air" but "e" alone
  // matches nothing), which silently drops real matches. Passing the bare
  // term (no field prefix, no wildcards) lets Shopify's own relevance search
  // match across title/vendor/tags/type, including partial words like
  // "shoe" -> "Shoes" - and an empty term lists recent products.
  const data = await adminRequest(
    `query ProductSearch($query: String!, $limit: Int!) {
      products(first: $limit, query: $query) {
        edges {
          node {
            id
            title
            status
            vendor
            totalInventory
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
              maxVariantPrice { amount currencyCode }
            }
          }
        }
      }
    }`,
    { query: searchTerm, limit }
  );
  return data.products.edges.map((e) => e.node);
}

export async function getProductDetail(productId) {
  const data = await adminRequest(
    `query ProductDetail($id: ID!) {
      product(id: $id) {
        id
        title
        status
        vendor
        productType
        variants(first: 100) {
          edges {
            node {
              id
              title
              price
              inventoryItem {
                id
                inventoryLevels(first: 10) {
                  edges {
                    node {
                      location { id name }
                      quantities(names: ["available"]) { name quantity }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { id: productId }
  );
  return data.product;
}

export async function searchLocations(limit = 20) {
  const data = await adminRequest(
    `query Locations($limit: Int!) {
      locations(first: $limit) {
        edges { node { id name isActive } }
      }
    }`,
    { limit }
  );
  return data.locations.edges.map((e) => e.node);
}

export async function searchOrderCandidates(searchTerm, limit = 10) {
  const data = await adminRequest(
    `query OrderSearch($query: String!, $limit: Int!) {
      orders(first: $limit, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            displayFinancialStatus
            displayFulfillmentStatus
            createdAt
            customer { displayName email }
            totalPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }`,
    { query: searchTerm, limit }
  );
  return data.orders.edges.map((e) => e.node);
}

export async function getOrderDetail(orderId) {
  const data = await adminRequest(
    `query OrderDetail($id: ID!) {
      order(id: $id) {
        id
        name
        displayFinancialStatus
        displayFulfillmentStatus
        createdAt
        cancelledAt
        closedAt
        customer { displayName email }
        shippingAddress { address1 address2 city province country zip }
        totalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 50) {
          edges {
            node {
              title
              quantity
              variant { title }
              originalUnitPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
        fulfillments(first: 10) {
          id
          status
          trackingInfo { number company url }
        }
      }
    }`,
    { id: orderId }
  );
  return data.order;
}
