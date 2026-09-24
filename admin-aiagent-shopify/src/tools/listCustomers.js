import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { adminRequest } from "../clients/adminClient.js";

const CUSTOMERS_QUERY = `
  query Customers($query: String!, $limit: Int!) {
    customers(first: $limit, query: $query) {
      edges {
        node {
          id
          displayName
          email
          numberOfOrders
          amountSpent { amount currencyCode }
        }
      }
    }
  }
`;

function formatCustomer(customer) {
  const spent = customer.amountSpent;
  return `- ${customer.displayName} <${customer.email}> — ${customer.numberOfOrders} orders, ${spent.amount} ${spent.currencyCode} spent`;
}

export const listCustomersTool = tool(
  "list_customers",
  'Search customers by name, email, or a Shopify customer search query (e.g. "email:jane@example.com"). Leave empty to list recent customers.',
  {
    searchQuery: z.string().optional().default("").describe("Name, email, or search query; empty for recent customers"),
    limit: z.number().int().min(1).max(50).optional().default(20),
  },
  async ({ searchQuery, limit }) => {
    try {
      const data = await adminRequest(CUSTOMERS_QUERY, { query: searchQuery, limit });
      const customers = data.customers.edges.map((e) => e.node);
      if (customers.length === 0) {
        return { content: [{ type: "text", text: "No customers matched." }] };
      }
      return { content: [{ type: "text", text: customers.map(formatCustomer).join("\n") }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Failed to list customers: ${error.message}` }],
        isError: true,
      };
    }
  },
  { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } }
);
