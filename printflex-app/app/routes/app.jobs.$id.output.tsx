import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { batchLabel } from "../lib/render/render-batch.server";
import { readDocument } from "../lib/render/storage.server";
import { requireShop } from "../lib/request.server";

/** Streams a batch's combined PDF, or its pick list with ?part=picklist. */
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop } = await requireShop(request);
  const job = await prisma.documentJob.findFirst({ where: { id: params.id, shopId: shop.id } });
  if (!job) throw new Response("This batch does not exist.", { status: 404 });
  const part = new URL(request.url).searchParams.get("part") === "picklist" ? "picklist" : "batch";
  const filePath = part === "picklist" ? job.pickListPath : job.outputPath;
  if (!filePath) throw new Response("This batch has no PDF yet.", { status: 404 });
  const pdf = await readDocument(filePath);
  if (!pdf) throw new Response("The PDF for this batch is gone. Print the orders again to regenerate it.", { status: 410 });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.byteLength),
      "Content-Disposition": `attachment; filename="${batchLabel(job.id)}${part === "picklist" ? "-picklist" : ""}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
};
