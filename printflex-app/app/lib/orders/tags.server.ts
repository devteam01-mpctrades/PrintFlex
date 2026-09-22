import type { GraphqlClient } from "../graphql.server";
import { runGraphql } from "../graphql.server";

/**
 * Tag writes back to Shopify. Callers pass the tag they read from the shop's
 * settings; nothing here knows a default tag name.
 */

export const TAGS_ADD_MUTATION = `#graphql
  mutation PrintFlexTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface TagsAddData {
  tagsAdd: {
    node: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

export class TagWriteError extends Error {
  constructor(
    readonly orderGid: string,
    readonly tags: string[],
    message: string,
  ) {
    super(message);
    this.name = "TagWriteError";
  }
}

/** Add tags to an order. tagsAdd is idempotent: existing tags are not duplicated. */
export async function addOrderTags(
  client: GraphqlClient,
  orderGid: string,
  tags: string[],
): Promise<void> {
  const clean = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (clean.length === 0) return;
  const { data } = await runGraphql<TagsAddData>(client, TAGS_ADD_MUTATION, { id: orderGid, tags: clean });
  if (data.tagsAdd.userErrors.length > 0) {
    throw new TagWriteError(
      orderGid,
      clean,
      `Shopify refused to tag ${orderGid}: ${data.tagsAdd.userErrors.map((e) => e.message).join("; ")}`,
    );
  }
}
