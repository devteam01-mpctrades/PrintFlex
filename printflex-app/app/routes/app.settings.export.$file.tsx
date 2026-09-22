import fs from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { storageRoot } from "../lib/render/storage.server";
import { requireShop } from "../lib/request.server";

/** Download a customer data-request export. Only files of this shop, only by exact name. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const name = params.file ?? "";
  if (!/^data-request-[A-Za-z0-9_-]+\.json$/.test(name)) throw new Response("That export does not exist.", { status: 404 });
  const file = path.join(storageRoot(), "compliance", shop.id, name);
  try {
    const body = await fs.readFile(file);
    return new Response(new Uint8Array(body), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
    });
  } catch {
    throw new Response("That export does not exist any more.", { status: 404 });
  }
};
