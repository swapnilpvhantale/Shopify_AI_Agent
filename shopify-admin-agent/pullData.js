const fs = require("fs");
const path = require("path");
const { adminRequest } = require("./adminClient");

const OUT_DIR = path.join(__dirname, "export");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

async function paginate(query, dataPath, pageSize = 100) {
  let results = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const variables = { first: pageSize, after: cursor };
    const data = await adminRequest(query, variables);

    let node = data;
    for (const key of dataPath) node = node[key];

    results = results.concat(node.edges.map((e) => e.node));
    hasNextPage = node.pageInfo.hasNextPage;
    cursor = node.pageInfo.endCursor;

    process.stdout.write(`\r  fetched ${results.length}...`);
  }
  process.stdout.write("\n");
  return results;
}

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String) {
    orders(first: $first, after: $after, sortKey: CREATED_AT) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          customer { id email displayName }
          lineItems(first: 50) {
            edges { node { title quantity sku originalUnitPriceSet { shopMoney { amount } } } }
          }
          shippingAddress { address1 city province country zip }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const CUSTOMERS_QUERY = `
  query Customers($first: Int!, $after: String) {
    customers(first: $first, after: $after) {
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          numberOfOrders
          amountSpent { amount currencyCode }
          defaultAddress { address1 city province country zip }
          createdAt
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCTS_INVENTORY_QUERY = `
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          status
          variants(first: 25) {
            edges {
              node {
                id
                title
                sku
                price
                inventoryQuantity
                inventoryItem {
                  id
                  tracked
                  inventoryLevels(first: 5) {
                    edges {
                      node {
                        quantities(names: ["available", "on_hand", "committed"]) {
                          name
                          quantity
                        }
                        location { id name }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

(async () => {
  console.log("Fetching orders...");
  const orders = await paginate(ORDERS_QUERY, ["orders"]);
  fs.writeFileSync(path.join(OUT_DIR, "orders.json"), JSON.stringify(orders, null, 2));
  console.log(`Saved ${orders.length} orders -> export/orders.json`);

  console.log("Fetching customers...");
  const customers = await paginate(CUSTOMERS_QUERY, ["customers"]);
  fs.writeFileSync(path.join(OUT_DIR, "customers.json"), JSON.stringify(customers, null, 2));
  console.log(`Saved ${customers.length} customers -> export/customers.json`);

  console.log("Fetching products/inventory...");
  const products = await paginate(PRODUCTS_INVENTORY_QUERY, ["products"], 15);
  fs.writeFileSync(path.join(OUT_DIR, "inventory.json"), JSON.stringify(products, null, 2));
  console.log(`Saved ${products.length} products -> export/inventory.json`);

  console.log("\nDone.");
})().catch((err) => {
  console.error("Failed:", err.message || err);
  process.exit(1);
});
