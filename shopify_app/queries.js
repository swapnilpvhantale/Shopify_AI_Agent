const { adminRequest } = require("./admin_client");

const ALL_CUSTOMERS_QUERY = `
query AllCustomers($cursor: String) {
  customers(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        firstName
        lastName
        email
        phone
        defaultAddress {
          address1
          address2
          city
          province
          zip
          country
        }
      }
    }
  }
}`;

const CUSTOMER_ORDER_HISTORY_QUERY = `
query CustomerOrderHistory($query: String!, $cursor: String) {
  customers(first: 1, query: $query) {
    edges {
      node {
        id
        firstName
        lastName
        email
        phone
        defaultAddress {
          address1
          address2
          city
          province
          zip
          country
        }
        orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              name
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet { shopMoney { amount currencyCode } }
              lineItems(first: 20) {
                edges { node { title quantity } }
              }
            }
          }
        }
      }
    }
  }
}`;

const INVENTORY_LEVELS_QUERY = `
query InventoryLevels($cursor: String) {
  products(first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        title
        variants(first: 50) {
          edges {
            node {
              id
              title
              sku
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
    }
  }
}`;

const ALL_ORDERS_QUERY = `
query AllOrders($cursor: String) {
  orders(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        name
        createdAt
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { id email firstName lastName }
        lineItems(first: 20) {
          edges { node { title quantity } }
        }
      }
    }
  }
}`;

const DRAFT_ORDERS_QUERY = `
query DraftOrders($cursor: String) {
  draftOrders(first: 25, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        name
        status
        createdAt
        totalPriceSet { shopMoney { amount currencyCode } }
        customer { id email firstName lastName }
        lineItems(first: 20) {
          edges { node { title quantity } }
        }
      }
    }
  }
}`;

async function getAllCustomers() {
  let cursor = null;
  const customers = [];

  do {
    const data = await adminRequest(ALL_CUSTOMERS_QUERY, { cursor });
    customers.push(...data.customers.edges.map((e) => e.node));
    cursor = data.customers.pageInfo.hasNextPage ? data.customers.pageInfo.endCursor : null;
  } while (cursor);

  return customers;
}

async function getCustomerOrderHistory(emailOrId) {
  const query = emailOrId.includes("@") ? `email:${emailOrId}` : `id:${emailOrId}`;
  let cursor = null;
  let customer = null;
  const orders = [];

  do {
    const data = await adminRequest(CUSTOMER_ORDER_HISTORY_QUERY, { query, cursor });
    const edge = data.customers.edges[0];
    if (!edge) return null;

    if (!customer) {
      const { orders: _orders, ...contactDetails } = edge.node;
      customer = contactDetails;
    }
    orders.push(...edge.node.orders.edges.map((e) => e.node));
    cursor = edge.node.orders.pageInfo.hasNextPage ? edge.node.orders.pageInfo.endCursor : null;
  } while (cursor);

  return { customer, orders };
}

async function getAllOrders() {
  let cursor = null;
  const orders = [];

  do {
    const data = await adminRequest(ALL_ORDERS_QUERY, { cursor });
    orders.push(...data.orders.edges.map((e) => e.node));
    cursor = data.orders.pageInfo.hasNextPage ? data.orders.pageInfo.endCursor : null;
  } while (cursor);

  return orders;
}

async function getAllInventoryLevels() {
  let cursor = null;
  const products = [];

  do {
    const data = await adminRequest(INVENTORY_LEVELS_QUERY, { cursor });
    products.push(...data.products.edges.map((e) => e.node));
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);

  return products;
}

async function getAllDraftOrders() {
  let cursor = null;
  const draftOrders = [];

  do {
    const data = await adminRequest(DRAFT_ORDERS_QUERY, { cursor });
    draftOrders.push(...data.draftOrders.edges.map((e) => e.node));
    cursor = data.draftOrders.pageInfo.hasNextPage ? data.draftOrders.pageInfo.endCursor : null;
  } while (cursor);

  return draftOrders;
}

module.exports = {
  getAllCustomers,
  getCustomerOrderHistory,
  getAllOrders,
  getAllInventoryLevels,
  getAllDraftOrders,
};
