/**
 * Minimal shape of an Admin GraphQL client. Satisfied by the
 * `admin.graphql` context from @shopify/shopify-app-react-router and by the
 * plain fetch wrapper in scripts/seed-orders.ts.
 */
export interface GraphqlClient {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
}

export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface GraphqlResult<T> {
  data: T;
  throttle: ThrottleStatus | null;
  requestedCost: number | null;
}

interface RawGraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      throttleStatus?: ThrottleStatus;
    };
  };
}

export class GraphqlError extends Error {
  constructor(
    message: string,
    readonly errors: Array<{ message: string }>,
  ) {
    super(message);
    this.name = "GraphqlError";
  }
}

/** Run a query and unwrap data, errors and cost information. */
export async function runGraphql<T>(
  client: GraphqlClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphqlResult<T>> {
  const response = await client.graphql(query, variables ? { variables } : undefined);
  const body = (await response.json()) as RawGraphqlResponse<T>;

  if (body.errors && body.errors.length > 0) {
    throw new GraphqlError(
      `GraphQL request failed: ${body.errors.map((e) => e.message).join("; ")}`,
      body.errors,
    );
  }
  if (body.data === undefined) {
    throw new GraphqlError("GraphQL request returned no data", []);
  }

  return {
    data: body.data,
    throttle: body.extensions?.cost?.throttleStatus ?? null,
    requestedCost: body.extensions?.cost?.requestedQueryCost ?? null,
  };
}

/**
 * Sleep long enough for the bucket to hold `nextCost` points, based on the
 * throttle status from the previous response. Keeps a backfill from
 * hitting THROTTLED errors instead of reacting to them.
 */
export async function waitForBudget(
  throttle: ThrottleStatus | null,
  nextCost: number,
): Promise<void> {
  if (!throttle) return;
  const shortfall = nextCost - throttle.currentlyAvailable;
  if (shortfall <= 0) return;
  const seconds = shortfall / Math.max(1, throttle.restoreRate);
  await new Promise((resolve) => setTimeout(resolve, Math.ceil(seconds * 1000)));
}
