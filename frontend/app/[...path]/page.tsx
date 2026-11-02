import { notFound } from "next/navigation";
import { RouteView } from "@/components/routes";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const ordinary = [
    "addresses",
    "verification",
    "forgot-password",
    "reset-password",
    "verify-email",
    "mailbox",
    "search",
    "categories",
    "households",
    "cart",
    "checkout",
    "login",
    "register",
    "join",
    "account",
    "favorites",
    "seller",
    "driver",
    "admin",
    "ops",
  ];
  const resource = [
    "product",
    "household",
    "orders",
    "track",
    "receipt",
    "invoices",
    "contracts",
  ];
  const policy = ["terms", "privacy", "delivery", "refund", "about"];
  const valid =
    (ordinary.includes(path[0]) && path.length === 1) ||
    (resource.includes(path[0]) &&
      path.length === 2 &&
      /^[a-f0-9]{32}$/.test(path[1])) ||
    (["orders", "track"].includes(path[0]) && path.length === 1) ||
    (path[0] === "policies" && path.length === 2 && policy.includes(path[1]));
  if (!valid) notFound();
  return <RouteView path={path} />;
}
