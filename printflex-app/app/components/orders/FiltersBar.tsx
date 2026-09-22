import { useCallback, useRef } from "react";
import { Form, useNavigate, useSubmit } from "react-router";
import type { OrderFacets, OrderFilters } from "../../lib/orders/list.server";
import { useNativeEvent } from "./useNativeEvent";

interface Props {
  filters: OrderFilters;
  facets: OrderFacets;
  hasFilters: boolean;
}

const DOC_STATUS_OPTIONS: Array<[string, string]> = [
  ["NEW", "New"],
  ["PRINTED", "Printed"],
  ["PACKED", "Packed"],
  ["NEEDS_REVIEW", "Needs review"],
];

function humanize(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

/**
 * Every control is a form-associated Polaris field inside a GET form, so
 * the URL is the single source of truth. Any change submits the form.
 */
export function FiltersBar({ filters, facets, hasFilters }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useSubmit();
  const navigate = useNavigate();

  const submitForm = useCallback(() => {
    if (formRef.current) void submit(formRef.current, { method: "get", replace: true });
  }, [submit]);

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

  return (
    <Form method="get" ref={formRef} onSubmit={(e) => e.preventDefault()}>
      <s-stack gap="base">
        <s-search-field
          name="q"
          label="Search"
          labelAccessibilityVisibility="exclusive"
          placeholder="Order number, customer, email or SKU. Scan a barcode to jump to its order."
          value={filters.q}
        ></s-search-field>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="small">
          <s-select name="fulfillment" label="Fulfilment" value={filters.fulfillment}>
            <s-option value="">Any</s-option>
            {facets.fulfillmentStatuses.map((status) => (
              <s-option key={status} value={status}>{humanize(status)}</s-option>
            ))}
          </s-select>
          <s-select name="docStatus" label="Document status" value={filters.docStatus}>
            <s-option value="">Any</s-option>
            {DOC_STATUS_OPTIONS.map(([value, label]) => (
              <s-option key={value} value={value}>{label}</s-option>
            ))}
          </s-select>
          <s-select name="country" label="Country" value={filters.country}>
            <s-option value="">Any</s-option>
            {facets.countries.map((country) => (
              <s-option key={country} value={country}>{country}</s-option>
            ))}
          </s-select>
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
        </s-grid>
        {hasFilters ? (
          <s-stack direction="inline" gap="small">
            <s-button variant="tertiary" onClick={() => void navigate("/app/orders")}>
              Clear filters
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>
    </Form>
  );
}
