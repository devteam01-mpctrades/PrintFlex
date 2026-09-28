import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { login } from "../../shopify.server";
import { LoginCard } from "../../components/LoginCard";

export const meta: MetaFunction = () => [
  { title: "PrintFlex – Print, scan and pack orders" },
  {
    name: "description",
    content:
      "Bulk invoices, packing slips and pick lists as one PDF for Shopify, with a QR code and barcode on every page so your warehouse can scan, check and pack each order.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  return showForm ? <LoginCard /> : null;
}
