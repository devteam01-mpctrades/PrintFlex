/**
 * GraphQL documents for order sync. Only the fields the orders list and the
 * documents need are requested; whole order payloads are never stored.
 */

export const ORDER_INDEX_FRAGMENT = `#graphql
  fragment OrderIndexFields on Order {
    id
    name
    createdAt
    updatedAt
    cancelledAt
    displayFulfillmentStatus
    displayFinancialStatus
    tags
    email
    currentSubtotalLineItemsQuantity
    currentTotalPriceSet {
      presentmentMoney {
        amount
        currencyCode
      }
    }
    customer {
      displayName
      email
    }
    shippingAddress {
      name
      city
      countryCodeV2
    }
    shippingLine {
      title
    }
    lineItems(first: 50) {
      nodes {
        id
        title
        variantTitle
        sku
        quantity
        variant {
          id
        }
        product {
          id
        }
        image {
          url(transform: { maxWidth: 200, maxHeight: 200 })
        }
      }
    }
  }
`;

export const ORDER_BY_ID_QUERY = `#graphql
  ${ORDER_INDEX_FRAGMENT}
  query PrintFlexOrderById($id: ID!) {
    order(id: $id) {
      ...OrderIndexFields
    }
  }
`;

export const ORDERS_PAGE_QUERY = `#graphql
  ${ORDER_INDEX_FRAGMENT}
  query PrintFlexOrdersPage($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...OrderIndexFields
      }
    }
  }
`;

export const ORDER_ID_BY_NAME_QUERY = `#graphql
  query PrintFlexOrderIdByName($query: String!) {
    orders(first: 1, query: $query) {
      nodes {
        id
      }
    }
  }
`;

export interface OrderNode {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string | null;
  tags: string[];
  email: string | null;
  currentSubtotalLineItemsQuantity: number;
  currentTotalPriceSet: {
    presentmentMoney: { amount: string; currencyCode: string };
  };
  customer: { displayName: string; email: string | null } | null;
  shippingAddress: { name: string | null; city: string | null; countryCodeV2: string | null } | null;
  shippingLine: { title: string } | null;
  lineItems: { nodes: LineItemNode[] };
}

export interface LineItemNode {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  variant: { id: string } | null;
  product: { id: string } | null;
  image: { url: string } | null;
}

export interface OrderByIdData {
  order: OrderNode | null;
}

export interface OrdersPageData {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: OrderNode[];
  };
}

export interface OrderIdByNameData {
  orders: { nodes: Array<{ id: string }> };
}
