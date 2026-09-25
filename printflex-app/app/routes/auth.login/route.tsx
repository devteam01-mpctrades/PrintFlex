import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { LoginCard } from "../../components/LoginCard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { errors } = actionData || loaderData;

  return (
    <AppProvider embedded={false}>
      <LoginCard error={errors.shop} />
    </AppProvider>
  );
}
