# Build prompt — printflex-web

> Save this file into `printflex-web/` and tell Claude Code:
> **"Read BUILD-PROMPT.md and build the whole site. Don't ask me questions until it's done."**

---

## Context

PrintFlex is a Shopify app (in development, not yet on the App Store) that generates bulk PDF
invoices, packing slips and pick lists from Shopify orders, and puts a QR code + Code 128 barcode
on every document so warehouse staff can scan the printed paper to open that order, tick the items
off, and mark it packed — which syncs a tag back to Shopify. It is made by MPC Trades, Phnom Penh.
Pricing: Free (50 orders/mo) · Premium $4.99 (500 orders/mo) · Unlimited $9.99.

You are building the **marketing website** for it, in this folder. The Shopify app itself lives in
`../printflex-app` — do not touch it.

The sister site `https://shuffly.mpctrades.com` is the house style to match structurally: a sticky
dark pill nav, numbered section eyebrows (`01 — The problem`), large bold headlines with one
accent-coloured span, card grids, a dark callout box, a comparison table, pricing cards, an
accordion FAQ, and a contact section. PrintFlex uses **orange** where Shuffly uses red-orange.

---

## Hard constraints

- **Plain HTML + CSS + vanilla JS. No build step, no npm, no framework, no bundler.**
- No external JS libraries at all. Google Fonts via `<link>` is the only external resource.
- Must work opened directly as a file (`file://`) and served statically from Nginx.
- Every page must work at 360px wide with no horizontal scroll.
- Must support light and dark mode via `prefers-color-scheme`, driven entirely by CSS custom
  properties declared once on `:root`.
- No JavaScript required to read any content — JS only enhances (pricing toggle, FAQ filters, the
  generated barcode/QR graphics, contact form).
- Accessible: real landmarks, visible `:focus-visible` outlines, `prefers-reduced-motion` honoured,
  every form control with a `<label for>`, meaningful `alt` / `aria-label` on decorative SVG.

## File structure

```
printflex-web/
  index.html
  privacy.html
  terms.html
  support.html
  assets/
    styles.css        ← all styles, shared by all four pages
    site.js           ← all scripts, shared by all four pages
    favicon.svg
  README.md           ← how to preview and how to deploy to Nginx
```

Put `<head>` metadata on every page: title, meta description, `theme-color`, Open Graph tags
(`og:title`, `og:description`, `og:type=website`), and canonical link. Header nav and footer markup
are duplicated across the four pages (no templating available) — keep them byte-identical so they
are easy to update.

---

## Design tokens

Declare these on `:root` in `styles.css` and redefine **only** the colour tokens inside
`@media (prefers-color-scheme: dark)`. Never hardcode a colour outside the token block.

**Light**

```
--ground      #FBF7F3   page background (warm off-white, not pure white)
--ground-2    #F3EBE3   alternating band background
--surface     #FFFFFF   cards, panels
--surface-2   #FDF9F5   inset panels, table headers
--ink         #1B1411   headings, primary text
--ink-2       #4B3C33   body text
--muted       #7C6759   labels, captions
--line        #E9DED4   hairlines, card borders
--line-2      #D9C9BA   stronger borders, ghost buttons
--accent      #E25B07   PRIMARY ORANGE — buttons, accents, active states
--accent-2    #B8480A   hover
--accent-ink  #A84206   orange text on light backgrounds (contrast-safe)
--accent-soft #FDEBDC   orange tint background
--accent-soft-2 #FAD9BF orange tint border
--dark        #191109   nav pill, callout box, footer
--dark-2      #241A11
--dark-line   #3A2A1C
--good        #2E7D55   the "Packed" status pill only
```

**Dark** (same token names, redefined)

```
--ground #130F0B · --ground-2 #1A140E · --surface #1E1710 · --surface-2 #231A13
--ink #F7F1EA · --ink-2 #D6C7B9 · --muted #9C8877 · --line #2F251C · --line-2 #403124
--accent #FF7A2E · --accent-2 #FF9354 · --accent-ink #FFA96A
--accent-soft #2C1B0E · --accent-soft-2 #3B2412
--dark #0C0805 · --dark-2 #171009 · --dark-line #33261A
```

The neutrals are deliberately warm (a brown/orange bias). Do not substitute pure greys.

**Typography** — three Google Fonts, three distinct jobs:

- `Archivo` 600/700/800 — all headings, big numbers, prices. Tight tracking (`-0.02em`,
  `-0.035em` on the hero and prices).
- `Public Sans` 400/500/600/700 — body copy, buttons, form controls.
- `IBM Plex Mono` 400/500/600 — **every order number, SKU, quantity, price inside a mock document,
  section eyebrow, uppercase label, plan meter and barcode caption.** This is the point: the product
  is about printed order numbers, so the mono face carries real meaning. Use
  `font-variant-numeric: tabular-nums` wherever digits sit in a column.

Always declare a real fallback stack after each family.

**Layout** — `max-width: 1120px` container, `padding-inline: 20px`, sections at
`padding-block: 92px` alternating `--ground` / `--ground-2`. Lay out sibling groups with
flex/grid `gap`, not per-element margins. Cards: `border-radius: 14px`, 1px `--line` border,
`background: --surface`. Don't put a border, shadow AND heavy radius on every block — spend them
by role.

---

## Page 1 — `index.html`

Nine blocks, in this order. Section IDs: `#problem #how #features #compare #scan #pricing #faq #contact`.

### Nav (sticky)

Dark pill, `position: sticky; top: env(safe-area-inset-top, 0px)`, full-width padding outside the
pill. Left: orange rounded-square logo mark (three white horizontal bars, like paper lines) +
wordmark `PRINTFLEX` in Archivo 800, letter-spaced. Centre-right links: How it works · Features ·
Scan mode · Pricing · FAQ. Right: orange pill button **"Get early access →"** to `#contact`.
Below 860px, hide the links and keep the logo + button.

### Hero

- Small orange pill badge: `● IN DEVELOPMENT · EARLY ACCESS` (mono, uppercase).
- H1, two lines: **"Print the whole batch."** / **"Then scan to pack."** — the second line in
  `--accent`. `clamp(38px, 6vw, 64px)`, Archivo 800.
- Lede: *"PrintFlex turns any set of Shopify orders into one combined PDF — invoices, packing slips
  and a single merged pick list. Every document carries a QR code and a barcode, so your packer
  scans the paper in their hand, ticks the items off, and marks the order packed."*
- Bold line: *"One app instead of two. From free, then $4.99 a month."*
- Buttons: "Get early access" (orange) + "See how it works" (ghost).
- Three bullet chips with small orange dots: `Up to 250 orders per batch` ·
  `No app to install on the phone` · `Billed through Shopify`.

**Right column — the signature element.** A mock printed invoice on white paper with a second sheet
peeking behind it, rotated ~1.6deg. Contents:

- Header: `Invoice #KS-10236` / `Kool Seoul · Seoul, South Korea` / `Bill to: Yuki Tanaka, Tokyo,
  Japan`, plus a small orange `INVOICE` tag top-right.
- Five line items with dashed separators, quantities and prices in mono:
  Ginseng Cream 50ml $28.00 · Snail Essence $24.00 · Sheet Mask Pack ×10 $32.00 ·
  Hydrating Serum $22.00 · Gift Wrap $6.00.
- A 2px rule, then `TOTAL · USD` / `112.00` in mono.
- **Bottom: a real-looking QR code and barcode, generated in JS** (see "Generated graphics" below),
  with the caption `*KS-10236*` under the bars, and a note: *"The QR opens a signed link to this
  order's pack screen. The barcode is Code 128 of the order number, for USB laser scanners."*

Stack to one column below 900px.

### `01 — The problem`

H2: **"Packing day costs you more than it should"**. Lede: *"Every store above a few orders a day
ends up paying twice, editing code, or checking parcels by eye."*

Four cards, each: outline icon in a soft-orange tile, mono number `01`–`04`, orange H3, mono
subtitle, body paragraph.

1. **The $29 wall** — *Bulk dashboards start high.* The filter-tag-batch-print workflow is gated
   behind $29 a month, with no free plan at all. A store doing 200 orders a month pays enterprise
   pricing for a warehouse chore.
2. **Two subscriptions** — *One prints, one scans.* Invoice apps do not verify parcels. Scan-and-pack
   apps do not produce a branded customer invoice. Merchants install both, learn both, and pay for
   both every month.
3. **Templates that need code** — *Liquid and HTML editing.* Changing a logo, hiding a tax line or
   adding bank details means editing template code — or paying support to do it. Most merchants only
   ever needed a handful of toggles.
4. **The wrong parcel** — *Checked by eye, at speed.* A missed item is a refund, a reship and a
   one-star review. Nothing in a printed packing slip stops a tired packer at 6pm from putting the
   wrong box on the pallet.

Then a mono label `THE FIX` and a dark callout box (`--dark` bg, `--dark-ink` text), text:

> Print the barcode **on the document you already print**. One piece of paper leaves the printer as
> the customer's invoice, the warehouse's picking sheet, and the scannable key to that order's pack
> screen — so verifying a parcel costs one scan instead of a second subscription.

(the bold fragment in `--accent-2`)

### `02 — How it works`

H2: **"Five steps, from order list to sealed box"**. Two columns: numbered vertical timeline on the
left, a mock app window sticky on the right (`top: 96px`, static below 940px).

Timeline: a 2px vertical rail, each step with a 36px circular numbered badge sitting on it. Step 1's
badge is filled orange with white text; steps 2–5 are outlined and muted.

1. **Filter down to today's batch** — Sort by fulfillment status, tag, date, country or shipping
   method, then select what you want. Save the views you use every morning so tomorrow is one click.
   *(three orange tag pills: Saved views · Multi-select · Print status)*
2. **Print the batch as one PDF** — Up to 250 orders in a single combined file — invoices, packing
   slips, or both. The job runs in the background with a progress bar, then downloads and opens your
   printer dialog.
3. **Walk the warehouse once** — The pick list merges every line across the selected orders into one
   SKU-sorted sheet. Your picker collects all 34 orders' worth of stock in a single pass instead of
   thirty-four.
4. **Scan the document to pack** — Point a phone camera at the QR code, or fire a USB scanner at the
   barcode. The order opens instantly with its item checklist, quantities and shipping method.
5. **Packed syncs back to Shopify** — Tick the items, hit Mark as packed, and PrintFlex writes a tag
   and a timestamp onto the order. Anyone looking at Shopify admin sees the same truth as the person
   at the bench.

**Mock app window:** browser chrome with three dots and the mono URL
`admin.shopify.com/store/demo/apps/printflex`; a filter row (`Unfulfilled` active orange,
`Tag: express`, `Today`, `+ Filter`); a soft-orange selection bar reading `34 selected` with buttons
`Print invoices` (solid orange) `Packing slips` `Pick list`; then a five-row table
(Order / Customer / Docs / Status), order numbers in mono:

| #KS-10234 | Marie Dupont · FR | INV+SLIP | **Packed** (green pill) |
| #KS-10235 | John Smith · US | INV | **Printed** (orange pill) |
| #KS-10236 | Yuki Tanaka · JP | INV+SLIP | **Packed** |
| #KS-10237 | Léa Martin · FR | — | **New** (grey pill) |
| #KS-10238 | Emma Brown · AU | INV+SLIP+PICK | **Printed** |

Footer strip inside the window, muted: *"Illustration of the planned interface — not live data."*
**This caption is required — do not remove it.**

### `03 — What's different`

H2: **"Built for the twenty percent that does the daily work"**. Lede: *"We run warehouses of our
own. PrintFlex ships the features a packing bench actually touches, and skips the rest."*
Six cards, each with a mono uppercase kicker, H3, paragraph:

- **Documents** / Three that matter — Invoice, packing slip, and a pick list that aggregates
  quantities by SKU across the whole batch. Refund notes and draft-order quotes follow in V2.
- **Templates** / No code, live preview — Upload a logo, pick an accent colour and a font, choose A4
  or Letter, and toggle what shows — prices, taxes, discounts, phone number, notes, HS codes.
  Free-text footer for legal mentions and bank details.
- **Verification** / QR and barcode on everything — The QR holds a signed link that cannot be
  guessed. The barcode is Code 128 of the order number, so any hardware scanner on the bench already
  understands it. Both optional per template.
- **Safety** / Print status per order — Every order shows never printed, printed, or packed. Reprints
  are deliberate, and nothing gets shipped twice because two people printed the same batch.
- **Reach** / Six languages, real currency — Documents render in the language of the store or of the
  customer's country — English, French, German, Spanish, Japanese, Korean at launch — with
  presentment currency and whatever tax lines Shopify provides.
- **Automation** / Invoice email on autopilot — Optionally send the branded PDF invoice to the
  customer when the order is created or fulfilled. Templated, brandable, and switchable off per
  template.

### `04 — Market comparison`

H2: **"Where PrintFlex sits"**. Lede: *"The printing apps are good at printing. The scanning apps are
good at scanning. Nobody sells the two as one workflow at a small-store price."*

A table in an `overflow-x: auto` wrapper, `min-width: 720px`. Columns: (blank) · **PrintFlex** ·
Order Printer Pro · OrderlyPrint · Scan & pack apps. The PrintFlex column header is orange and bold;
its cells have an `--accent-soft` background. `✓` is orange and bold, `–` is `--line-2`, `~` is muted.

| Row | PrintFlex | OPP | OrderlyPrint | Scan apps |
|---|---|---|---|---|
| Bulk print hundreds in one PDF | ✓ | ✓ | ✓ | – |
| Branded customer invoice | ✓ | ✓ | ✓ | – |
| Aggregated pick list | ✓ | – | ✓ | ✓ |
| Filter, tag & bulk-action dashboard | ✓ | ~ | ✓ | ~ |
| QR + barcode on every document | ✓ | – | – | ~ |
| Scan to verify items at packing | ✓ | – | – | ✓ |
| Packed status written back to Shopify | ✓ | – | ~ | ✓ |
| Visual template editor, no code | ✓ | ~ | ~ | – |
| Free plan that stays free | ✓ | ✓ | – | ✓ |
| Entry paid price (mono) | $4.99 | $10 | $29 | $19.99 |

Footnote below, muted, required verbatim in substance: *"Competitor plans and prices as listed on the
Shopify App Store, September 2026. '~' means partly covered or available only on higher tiers. Scan &
pack column reflects iPacky, the leading scan-verification app; it prints picking and packing sheets
but not branded customer invoices."*

### `05 — Scan mode`

H2: **"The part nobody else bundles"**. Lede: *"Scan mode is an ordinary responsive web page. There is
nothing to install on the phone, no Shopify login for warehouse staff, and no separate subscription."*

Left: a phone mock (dark 30px-radius body, ~250px wide). Top panel is dark with a square camera
viewfinder — four orange L-shaped corner brackets around a small white QR — and the mono caption
`POINT AT THE QR OR BARCODE`. Below, on white: `#KS-10236` in mono, then
`Yuki Tanaka · 5 items · Japan · K-Packet`, then five checklist rows (first three checked with orange
filled boxes, last two unchecked), quantities `1/1` / `0/1` in mono on the right, then a disabled
orange button reading **"2 items left to check"**.

Right: a four-card strip — `01 Print the batch` · `02 Scan the document` · `03 Check the items off` ·
`04 Tag syncs to Shopify`. Then two cards:

- **Works with whatever is on the bench** — A phone camera reads the QR through the browser's own
  barcode support. A $30 USB laser scanner types the order number straight into the page like a
  keyboard. If the camera struggles on an old handset, the scanner still works — the camera is the
  bonus, not the requirement.
- **Staff get access, not accounts** — The scan page opens from a signed link and a store PIN.
  Warehouse staff never need a Shopify account, and every scan is logged against the device name so
  you can see who packed what.

Then three stat tiles with a 3px orange left border: `BATCH SIZE / 250 / orders in one combined PDF`,
`RENDER TARGET / <60s / for a 100-order batch`, `PERMISSIONS / 2 / read orders, write order tags`.
Under them, italic muted: *"Batch size and render target are V1 engineering targets, not measured
results — we will publish the real numbers at launch."* **Required — do not remove.**

### `06 — Pricing`

H2: **"Priced for the store, not the enterprise"**. Lede: *"You are metered on orders that had at
least one document generated in the calendar month — the same simple counter this category already
uses, at a fraction of the price."*

A Monthly / "Annual — 2 months free" segmented toggle, then three plan cards. Premium is the featured
one: 2px orange border, stronger shadow, and a `MOST POPULAR` badge overlapping the top edge.

| | Free | Premium | Unlimited |
|---|---|---|---|
| Monthly | $0 forever | $4.99 /month | $9.99 /month |
| Annual | $0 | $49.90 /year | $99.90 /year |
| Meter pill | 50 orders / month | 500 orders / month | Unlimited orders |

- **Free** — *"The whole workflow, including scan mode. Enough for a store shipping a couple of
  parcels a day."* · All three document types · Bulk print and combined PDF · QR, barcode and scan
  mode · One template · Community support. Fine print: *No payment collected here. Free stays $0.*
- **Premium** — *"The everyday plan. Roughly what one wrong parcel costs you, for a whole month of
  not sending one."* · Everything in Free · Unlimited templates · Automatic invoice email · Saved
  dashboard views · Email support.
- **Unlimited** — *"For high-volume benches and seasonal peaks, where an order cap is the last thing
  you want to think about."* · Everything in Premium · Priority support · Refund and credit documents
  · Per-market template variants · All future pro features.

Paid cards' fine print: *Subscribing happens inside Shopify, via Shopify Billing.* Every CTA links to
`#contact` and reads "Get early access" — **never "Buy" or "Subscribe", and never collect payment.**

Below the cards, a note panel: **"Billed through Shopify."** *Every paid plan is charged exclusively
through Shopify's own Billing API and approved on Shopify's native charge screen when you install the
app. This site never collects payment details or arranges pricing directly.* Plus three chips:
Cancel any time · Change plan instantly · Annual saves two months.

### `07 — FAQ`

H2: **"Questions merchants actually ask"**. A row of filter chips — All · How it works · Hardware ·
Data & safety · Billing — then `<details>`/`<summary>` items with a rotating orange chevron. Filtering
toggles the `hidden` property on non-matching items (never `style.display`).

| Category | Question |
|---|---|
| Billing | What counts toward my monthly order limit? |
| Hardware | Do I need to buy a barcode scanner? |
| How it works | What exactly is a pick list? |
| How it works | Can my invoices look like my brand? |
| How it works | What languages and currencies are supported? |
| Data & safety | How does PrintFlex stop double shipping? |
| Data & safety | What data can PrintFlex see? |
| Data & safety | What happens to the PDFs you generate? |
| How it works | Do warehouse staff need a Shopify account? |
| Billing | Is PrintFlex on the Shopify App Store yet? |

Answers, each 2–3 sentences, written from the merchant's side. The key facts to get right:

- Limit = an order counted once per calendar month on first document generation; reprints that month
  are free; unprinted orders never count.
- No scanner needed — any phone camera + modern browser; USB laser scanners work because we print
  Code 128 of the order number too.
- Pick list = every line item across the selected orders merged and sorted by SKU, one walk.
- Branding = logo, accent colour, font, A4/Letter, field toggles, live preview against a real order.
- Languages = EN/FR/DE/ES/JA/KO at launch, presentment currency, Shopify's own tax lines,
  community-extendable translation files.
- Double shipping = visible per-order status (never printed / printed / packed) written the moment a
  document is generated.
- Data = order data needed to print (name, address, line items, totals); read orders + write a tag;
  **no payment or card data**.
- PDFs = cached for instant reprints, auto-deleted after 30 days, regenerated on demand; Shopify
  redaction requests delete cached documents, not just the database row.
- Staff = signed link in the QR + a store PIN; no Shopify accounts; scans logged per device name.
- App Store = **not yet listed; in active development, onboarding early-access stores directly**;
  billing runs through Shopify's Billing API once installed.

### Contact

Eyebrow `GET IN TOUCH`, H2 **"Want it on your bench first?"**, lede: *"Tell us roughly how many orders
you ship a week and how you pack them today. We reply to everything, and we will say so plainly if
PrintFlex is not the right fit for your store."*

Left: three chips — Early access is free while we build · No card, no commitment, no sales call · We
usually reply within one business day — and a panel with `EMAIL US DIRECTLY` and
`team@mpctrades.com` as a mono mailto link.

Right: a form with Name, Email, Store URL (`yourstore.myshopify.com` placeholder), Orders per week
(select: Under 50 / 50–200 / 200–1,000 / Over 1,000), and a textarea "How do you pack today?"
(placeholder *"Which apps you use now, what breaks, what you'd want first."*).

**There is no backend.** The submit button reads **"Copy my message →"**. On submit: `preventDefault`,
build a plain-text summary of the fields, write it to the clipboard, then set
`window.location.href` to a `mailto:team@mpctrades.com` with a pre-filled subject and body, and show
a status line confirming it. If the clipboard API is unavailable or rejects, show a fallback line
telling the user to email `team@mpctrades.com` with their store URL and weekly volume. Under the
button, a note in muted text: *"This page has no server behind it yet. The button copies your answers
to the clipboard and opens a pre-filled email to team@mpctrades.com."* Do **not** ship a form that
silently does nothing.

### Footer

Dark. Logo + wordmark, a paragraph — *"Bulk invoices, packing slips and pick lists for Shopify — with
QR and barcode scan-to-pack built in. Made by MPC Trades in Phnom Penh."* — and a link row: How it
works · Features · Scan mode · Pricing · FAQ · Privacy · Terms · Support · Contact. Bottom rule:
`© 2026 MPC Trades · PrintFlex is a working title` on the left, `team@mpctrades.com` on the right.

---

## Generated graphics (vanilla JS, in `site.js`)

Do not use an image file or a barcode library for these.

1. **Seeded PRNG.** A small FNV-1a hash of a string seeding an xorshift generator, so the same order
   number always produces the same graphic across reloads.
2. **Barcode.** For each `.bars[data-code]`, render ~62 `<i>` elements of width 1–3px, alternating
   ink and transparent, widths drawn from the seeded PRNG. Caption `*KS-10236*` in mono with wide
   letter-spacing. This is decorative — it is not a scannable Code 128. Mark it
   `aria-hidden="true"` and say so in a code comment.
3. **QR.** Build an inline SVG on a 21×21 grid: fill from the PRNG at ~48% density, skip the three
   8×8 finder zones, then draw the three finder patterns (7×7 dark, 5×5 light, 3×3 dark) at
   top-left, top-right and bottom-left. Give it `role="img"` and an `aria-label`. Read the ink and
   paper colours from `getComputedStyle(document.documentElement).getPropertyValue('--ink' / '--surface')`
   so it repaints correctly, and re-render on
   `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)`.
   The phone mock's QR is white on transparent.

Everything else in `site.js`: the pricing Monthly/Annual toggle (swap `data-m` / `data-a` attribute
values into the price and period spans, keep `aria-pressed` in sync), the FAQ chip filtering, and the
contact form handler. Wrap it in an IIFE with `"use strict"`. No global leaks.

---

## Pages 2–4 — legal pages

Same nav, footer, tokens and type. A narrow reading column (`max-width: 72ch`), a page title, a
`Last updated: 21 September 2026` line in mono, and `<h2>` sections. These exist because the Shopify
App Store review requires a working privacy policy URL before submission.

- **`privacy.html`** — what data the app processes and why (order data: customer name, shipping and
  billing address, line items, quantities, totals — solely to render the documents the merchant asks
  for); that PrintFlex is a data processor and the merchant is the controller; the Shopify scopes
  requested (`read_orders`, plus writing an order tag); PDF retention (cached for reprints, deleted
  after 30 days, regenerated on demand); how Shopify's GDPR webhooks
  (`customers/data_request`, `customers/redact`, `shop/redact`) are handled, including deletion of
  cached PDFs; sub-processors (VPS hosting, transactional email for the auto-invoice feature); that
  no payment card data is ever seen; data location; how to contact `team@mpctrades.com` about a
  request. **Add a visible banner at the top: "Draft — pending legal review before App Store
  submission." Leave `TODO:` comments where a real hosting region and legal entity name are needed.
  Do not invent a company registration number, a postal address or a DPO.**
- **`terms.html`** — plan definitions and what the order meter counts, that billing runs exclusively
  through Shopify's Billing API, cancellation and plan changes, acceptable use, service availability
  and the absence of an SLA on free plans, limitation of liability, changes to terms, governing law
  (`TODO:` — leave a placeholder). Same draft banner.
- **`support.html`** — how to get help (email `team@mpctrades.com`, one business day target), what to
  include in a report (store URL, order number, what you expected), a short troubleshooting list
  (camera won't scan → use a USB scanner or better light; document looks wrong → check the template's
  toggles; order missing from the dashboard → check the filter and fulfillment status), and a link
  back to the FAQ.

---

## Tone rules — these matter more than the code

- **Never claim the app is live, listed on the Shopify App Store, or in use by real merchants.** It
  is in development. Every "in development / early access" marker in this spec stays.
- **No invented testimonials, no customer logos, no star ratings, no "trusted by 500 stores".**
- **No fabricated metrics.** The stat tiles are labelled as targets, and that label stays.
- Competitor claims stay exactly as specified. They were checked against the live App Store; do not
  strengthen them into "nobody else does this".
- Active voice, merchant's vocabulary — "packing slip", "pick list", "order tag", not "document
  generation pipeline". Specific beats clever.
- Copy is British-leaning but consistent; pick one and stick to it.

## Acceptance checklist — verify before reporting done

- [ ] All four pages open standalone with no console errors, served and as `file://`.
- [ ] No horizontal scroll at 360px on any page; the comparison table scrolls inside its own wrapper.
- [ ] Dark mode: no unreadable text anywhere, orange still legible on the dark ground, the QR repaints.
- [ ] Every colour in `styles.css` comes from a token; `grep` for stray hex values outside `:root`.
- [ ] Tab through the whole page: every link, button, summary and field shows a visible focus ring.
- [ ] Pricing toggle switches all three cards; FAQ chips filter correctly; "All" restores everything.
- [ ] Contact form submits without navigating away and shows a status message either way.
- [ ] The three required disclaimers are present: "not live data", "V1 engineering targets", "not yet
      on the Shopify App Store".
- [ ] `README.md` explains `python3 -m http.server` for preview and the Nginx static-root deploy, and
      notes that the site is intended for a subdomain alongside `shuffly.mpctrades.com`.

When everything passes, give me a one-paragraph summary and a list of the `TODO:` markers you left in
the legal pages.
