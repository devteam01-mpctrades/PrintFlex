import type { GraphqlClient } from "../graphql.server";
import { runGraphql } from "../graphql.server";

/** Metafield writes to orders. Namespace "printflex", one key per fact. */

export const METAFIELDS_SET_MUTATION = `#graphql
  mutation PrintFlexMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key }
      userErrors { field message }
    }
  }
`;

export interface MetafieldInput {
  key: string;
  type: "json" | "number_integer" | "single_line_text_field" | "date_time";
  value: string;
}

interface MetafieldsSetData {
  metafieldsSet: { metafields: Array<{ key: string }> | null; userErrors: Array<{ field: string[] | null; message: string }> };
}

export async function setOrderMetafields(client: GraphqlClient, orderGid: string, fields: MetafieldInput[]): Promise<void> {
  if (fields.length === 0) return;
  const { data } = await runGraphql<MetafieldsSetData>(client, METAFIELDS_SET_MUTATION, {
    metafields: fields.map((f) => ({ ownerId: orderGid, namespace: "printflex", key: f.key, type: f.type, value: f.value })),
  });
  if (data.metafieldsSet.userErrors.length > 0) {
    throw new Error(`Shopify refused metafields on ${orderGid}: ${data.metafieldsSet.userErrors.map((e) => e.message).join("; ")}`);
  }
}
