import { wrapDocument } from "./batch-html.server";
import { renderInvoiceFragment, type InvoiceFragmentInput } from "./fragments.server";

export type InvoiceRenderInput = InvoiceFragmentInput;

/** One invoice as a complete HTML document. */
export function renderInvoiceHtml(input: InvoiceRenderInput): string {
  return wrapDocument([renderInvoiceFragment(input)], {
    title: `Invoice ${input.invoiceNumber} · ${input.order.name}`,
    paperSize: input.settings.paperSize,
  });
}
