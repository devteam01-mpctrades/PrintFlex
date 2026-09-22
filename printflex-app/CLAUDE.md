@AGENTS.md

# PrintFlex

## What the app is

PrintFlex prints bulk invoices, packing slips and pick lists as one combined PDF, puts a QR code and a Code 128 barcode on every document, and lets warehouse staff scan that printed paper to open the order, check items off, and mark it packed, which writes a tag back to Shopify. One app instead of the two merchants run today. Made by MPC Trades. Not yet on the App Store.

## Stack (fixed)

- React Router 7. Not Remix — that template is retired.
- Polaris web components for all UI: `<s-page>`, `<s-section>`, `<s-button>`, `<s-table>`, `<s-badge>`, `<s-banner>`, `<s-modal>`, `<s-text-field>`, `<s-select>`, `<s-switch>`, `<s-stack>`, `<s-box>`, `<s-grid>`, `<s-thumbnail>`, `<s-spinner>`, `<s-link>`, `<s-divider>`. Never the old `@shopify/polaris` React library.
- Prisma for the database.
- Admin GraphQL only. Never REST.
- App Bridge for the embedded shell.
- When unsure of a component's attributes, read https://shopify.dev/docs/api/app-home/polaris-web-components rather than guessing or falling back to raw HTML with custom CSS.

## The mockup

`docs/mockup.html` is the reference for information architecture, content, wording and behaviour: which screens exist, what is on them, what each control does, what warnings and empty states say. It is not a CSS reference. Never copy its stylesheet, colour variables or markup. A hand-styled card in the mockup becomes `<s-section>`; a status pill becomes `<s-badge>`; the amber reprint warning becomes `<s-banner tone="warning">`. Brand colour appears only on generated PDF documents, where the merchant picks it anyway.

## The meter

One unit is one distinct Shopify order for which at least one document was successfully generated during the calendar month, in the shop's timezone. Reprinting the same order that month is free. A pick list covering 40 orders consumes 40 units, once. A failed render consumes nothing. Orders never printed are never counted.

Enforced by a unique constraint on `MeterEntry(shopId, period, orderId)`, not by application logic that can drift.

This is the app's main competitive advantage. Competitors are losing customers over billing that counts orders the merchant never printed. Never weaken it.

## Billing rules

- Never auto-upgrade a plan.
- Never charge for an overage the merchant did not approve on Shopify's own charge screen.
- Default limit behaviour is a hard cap.

## Printing is never blocked

If the render queue is down or a job passes its deadline, offer a browser-rendered print view of the same template. Losing fidelity is acceptable; losing the shipment is not.

## Tags

Tags are renameable. Defaults are `printflex-printed`, `printflex-packed`, `printflex-needs-review`, all overridable in settings. Read from settings, never hardcode at the call site.

## Scan mode

Scan mode is a plain responsive page outside the embedded admin. Staff authenticate with a signed order token plus a store PIN and a device name. They never need a Shopify account.

## Scopes

`read_orders`, `read_products`, `write_orders` (tags and metafields only). Do not add a scope without asking first and explaining why.

## Conventions

- TypeScript everywhere. No bare `any`.
- Business logic lives in `app/lib/`, not in route files. Routes load, validate, delegate.
- Server-only code goes in `.server.ts` files.
- Real libraries for codes: `bwip-js` for Code 128, `qrcode` for QR. Both render to SVG server-side and are inlined into the document HTML. The mockup's barcode is drawn with a random number generator and is decorative; never copy that approach.
- Anything touching money, the meter, or Shopify writes gets a unit test.
- Error states say what happened and what to do next.

## Working agreement

- Before writing code for a phase, list the files you will create or change and wait for a "go".
- Stop and ask before adding a dependency, adding a scope, writing a destructive migration, or changing `shopify.app.toml`.
- End each phase with: what works, how to see it working, what you stubbed.
