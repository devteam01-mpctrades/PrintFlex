import { describe, expect, it } from "vitest";
import type { GraphqlClient } from "../graphql.server";
import { addOrderTags, TagWriteError } from "./tags.server";

function fakeClient(reply: unknown) {
  const calls: Array<{ query: string; variables: Record<string, unknown> | undefined }> = [];
  const client: GraphqlClient = {
    async graphql(query, options) {
      calls.push({ query, variables: options?.variables });
      return new Response(JSON.stringify(reply), { headers: { "Content-Type": "application/json" } });
    },
  };
  return { client, calls };
}

describe("addOrderTags", () => {
  it("sends the exact tags it was given, deduplicated and trimmed", async () => {
    const { client, calls } = fakeClient({ data: { tagsAdd: { node: { id: "gid://shopify/Order/1" }, userErrors: [] } } });
    await addOrderTags(client, "gid://shopify/Order/1", [" printflex-printed ", "printflex-printed", ""]);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain("tagsAdd");
    expect(calls[0].variables).toEqual({ id: "gid://shopify/Order/1", tags: ["printflex-printed"] });
  });

  it("makes no request when there is nothing to add", async () => {
    const { client, calls } = fakeClient({});
    await addOrderTags(client, "gid://shopify/Order/1", ["  "]);
    expect(calls).toHaveLength(0);
  });

  it("surfaces Shopify's refusal as an error naming the order", async () => {
    const { client } = fakeClient({
      data: { tagsAdd: { node: null, userErrors: [{ field: ["id"], message: "Order not found" }] } },
    });
    await expect(addOrderTags(client, "gid://shopify/Order/9", ["x"])).rejects.toBeInstanceOf(TagWriteError);
  });
});
