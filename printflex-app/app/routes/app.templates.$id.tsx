import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

/** Old deep links land in the three-pane editor with this template selected. */
export const loader = ({ params }: LoaderFunctionArgs) => redirect(`/app/templates?template=${params.id ?? ""}`);
