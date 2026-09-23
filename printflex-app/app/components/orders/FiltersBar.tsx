import { useCallback, useRef } from "react";
import { Form, useNavigate } from "react-router";
import type { OrderFacets, OrderFilters } from "../../lib/orders/list.server";
import { useNativeEvent } from "./useNativeEvent";

interface Props {
  filters: OrderFilters;
  facets: OrderFacets;
  hasFilters: boolean;
  /** Query string of the filters, without paging. Chips remove one key from it. */
  queryString: string;
}

const DOC_STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  PRINTED: "Printed",
  PACKED: "Packed",
  NEEDS_REVIEW: "Needs review",
};

/** Text of the "no filter" option; a Polaris select submits it when the option value is empty. */
const ANY_LABEL = "Any";

function humanize(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

interface Chip {
  key: keyof OrderFilters | "dates";
  label: string;
  /** URL keys removed when the chip is dismissed. */
  clears: string[];
}

function appliedChips(filters: OrderFilters): Chip[] {
  const chips: Chip[] = [];
  if (filters.q) chips.push({ key: "q", label: `Search: ${filters.q}`, clears: ["q"] });
  if (filters.fulfillment) chips.push({ key: "fulfillment", label: humanize(filters.fulfillment), clears: ["fulfillment"] });
  if (filters.docStatus) chips.push({ key: "docStatus", label: DOC_STATUS_LABEL[filters.docStatus] ?? filters.docStatus, clears: ["docStatus"] });
  if (filters.country) chips.push({ key: "country", label: `Country: ${filters.country}`, clears: ["country"] });
  if (filters.shipping) chips.push({ key: "shipping", label: `Shipping: ${filters.shipping}`, clears: ["shipping"] });
  if (filters.tag) chips.push({ key: "tag", label: `Tag: ${filters.tag}`, clears: ["tag"] });
  if (filters.from || filters.to) {
    const label = filters.from && filters.to ? `Placed ${filters.from} to ${filters.to}` : filters.from ? `Placed from ${filters.from}` : `Placed to ${filters.to}`;
    chips.push({ key: "dates", label, clears: ["from", "to"] });
  }
  return chips;
}

/**
 * One compact bar: a search field plus filter buttons whose choices open in
 * popovers. Every control is a form-associated Polaris field inside one GET
 * form, so the URL is the single source of truth and any change submits.
 * Applied filters show as removable chips underneath.
 */
export function FiltersBar({ filters, facets, hasFilters, queryString }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const navigate = useNavigate();

  // Serialise the form by hand so the URL only carries filters that are set:
  // Polaris selects submit the option text ("Any") for an empty value, and
  // empty keys would otherwise make every view's query string differ.
  const submitForm = useCallback(() => {
    if (!formRef.current) return;
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(formRef.current)) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed && trimmed !== ANY_LABEL) params.set(key, trimmed);
    }
    void navigate(`/app/orders${params.size ? `?${params}` : ""}`, { replace: true });
  }, [navigate]);

  useNativeEvent(formRef, "change", submitForm);
  useNativeEvent<KeyboardEvent>(
    formRef,
    "keydown",
    useCallback(
      (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitForm();
        }
      },
      [submitForm],
    ),
  );

  const removeKeys = useCallback(
    (keys: string[]) => {
      const params = new URLSearchParams(queryString);
      for (const key of keys) params.delete(key);
      void navigate(`/app/orders${params.size ? `?${params}` : ""}`);
    },
    [navigate, queryString],
  );

  const chips = appliedChips(filters);
  const count = (active: boolean) => (active ? " · 1" : "");

  return (
    <Form method="get" ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <s-stack gap="small">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-box inlineSize="100%" maxInlineSize="520px">
            <s-search-field
              name="q"
              label="Search orders"
              labelAccessibilityVisibility="exclusive"
              placeholder="Order number, customer, email or SKU. Scan a barcode to jump to its order."
              value={filters.q}
            ></s-search-field>
          </s-box>

          <s-button commandFor="filter-fulfillment" command="--toggle" icon="chevron-down" variant={filters.fulfillment ? "secondary" : "tertiary"}>
            Fulfilment{count(Boolean(filters.fulfillment))}
          </s-button>
          <s-popover id="filter-fulfillment">
            <s-box padding="base" minInlineSize="220px">
              <s-choice-list name="fulfillment" label="Fulfilment" labelAccessibilityVisibility="exclusive" values={[filters.fulfillment]}>
                <s-choice value="">Any</s-choice>
                {facets.fulfillmentStatuses.map((status) => (
                  <s-choice key={status} value={status}>{humanize(status)}</s-choice>
                ))}
              </s-choice-list>
            </s-box>
          </s-popover>

          <s-button commandFor="filter-docstatus" command="--toggle" icon="chevron-down" variant={filters.docStatus ? "secondary" : "tertiary"}>
            Documents{count(Boolean(filters.docStatus))}
          </s-button>
          <s-popover id="filter-docstatus">
            <s-box padding="base" minInlineSize="220px">
              <s-choice-list name="docStatus" label="Document status" labelAccessibilityVisibility="exclusive" values={[filters.docStatus]}>
                <s-choice value="">Any</s-choice>
                {Object.entries(DOC_STATUS_LABEL).map(([value, label]) => (
                  <s-choice key={value} value={value}>{label}</s-choice>
                ))}
              </s-choice-list>
            </s-box>
          </s-popover>

          <s-button commandFor="filter-country" command="--toggle" icon="chevron-down" variant={filters.country ? "secondary" : "tertiary"}>
            Country{count(Boolean(filters.country))}
          </s-button>
          <s-popover id="filter-country">
            <s-box padding="base" minInlineSize="220px">
              <s-select name="country" label="Country" value={filters.country}>
                <s-option value="">Any</s-option>
                {facets.countries.map((country) => (
                  <s-option key={country} value={country}>{country}</s-option>
                ))}
              </s-select>
            </s-box>
          </s-popover>

          <s-button commandFor="filter-more" command="--toggle" icon="chevron-down" variant={filters.shipping || filters.tag || filters.from || filters.to ? "secondary" : "tertiary"}>
            More filters
          </s-button>
          <s-popover id="filter-more">
            <s-box padding="base" minInlineSize="280px">
              <s-stack gap="base">
                <s-select name="shipping" label="Shipping method" value={filters.shipping}>
                  <s-option value="">Any</s-option>
                  {facets.shippingMethods.map((method) => (
                    <s-option key={method} value={method}>{method}</s-option>
                  ))}
                </s-select>
                <s-select name="tag" label="Tag" value={filters.tag}>
                  <s-option value="">Any</s-option>
                  {facets.tags.map((tag) => (
                    <s-option key={tag} value={tag}>{tag}</s-option>
                  ))}
                </s-select>
                <s-date-field name="from" label="Placed from" value={filters.from}></s-date-field>
                <s-date-field name="to" label="Placed to" value={filters.to}></s-date-field>
              </s-stack>
            </s-box>
          </s-popover>
        </s-stack>

        {hasFilters ? (
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {chips.map((chip) => (
              <s-clickable-chip
                key={chip.key}
                removable
                accessibilityLabel={`Remove filter ${chip.label}`}
                onClick={() => removeKeys(chip.clears)}
              >
                {chip.label}
              </s-clickable-chip>
            ))}
            <s-button variant="tertiary" onClick={() => void navigate("/app/orders")}>
              Clear all
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>
    </Form>
  );
}
