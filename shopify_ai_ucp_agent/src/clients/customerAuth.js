import { storefrontRequest } from "./storefrontClient.js";

const CUSTOMER_CREATE_MUTATION = `
  mutation CustomerCreate($input: CustomerCreateInput!) {
    customerCreate(input: $input) {
      customer { id email firstName }
      customerUserErrors { field message code }
    }
  }
`;

const ACCESS_TOKEN_CREATE_MUTATION = `
  mutation CustomerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
    customerAccessTokenCreate(input: $input) {
      customerAccessToken { accessToken expiresAt }
      customerUserErrors { field message code }
    }
  }
`;

const CUSTOMER_QUERY = `
  query CustomerByToken($customerAccessToken: String!) {
    customer(customerAccessToken: $customerAccessToken) {
      id
      email
      firstName
    }
  }
`;

function firstErrorMessage(errors) {
  return errors[0]?.message || "Something went wrong.";
}

async function loginWithPassword(email, password) {
  const data = await storefrontRequest(ACCESS_TOKEN_CREATE_MUTATION, {
    input: { email, password },
  });
  const { customerAccessToken, customerUserErrors } = data.customerAccessTokenCreate;
  if (customerUserErrors.length || !customerAccessToken) {
    throw new Error(firstErrorMessage(customerUserErrors));
  }

  const customerData = await storefrontRequest(CUSTOMER_QUERY, {
    customerAccessToken: customerAccessToken.accessToken,
  });

  return {
    accessToken: customerAccessToken.accessToken,
    expiresAt: customerAccessToken.expiresAt,
    email: customerData.customer?.email ?? email,
    firstName: customerData.customer?.firstName ?? null,
  };
}

export async function signUp({ email, password, firstName, lastName }) {
  const data = await storefrontRequest(CUSTOMER_CREATE_MUTATION, {
    input: { email, password, firstName, lastName },
  });
  const { customer, customerUserErrors } = data.customerCreate;
  if (customerUserErrors.length || !customer) {
    throw new Error(firstErrorMessage(customerUserErrors));
  }

  // Signing up doesn't return a session — log in immediately after so the
  // shopper doesn't have to enter their password twice.
  return loginWithPassword(email, password);
}

export async function logIn({ email, password }) {
  return loginWithPassword(email, password);
}
