import type { LoaderFunctionArgs } from "react-router";
import { login } from "../../shopify.server";
import { LoginCard } from "../../components/LoginCard";

/**
 * Where the library sends a request that has no Shopify session. With ?shop=
 * it starts OAuth for that store (login throws the redirect). Without one it
 * shows the landing card: merchants never type a shop domain here, they open
 * PrintFlex from their Shopify admin or install it from the App Store.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await login(request);
  return null;
};

export default function Auth() {
  return <LoginCard />;
}
