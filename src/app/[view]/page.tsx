import { notFound } from "next/navigation";
import { getDashboardView } from "@/lib/dashboard-navigation";
import DashboardPage from "../page";

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (!getDashboardView(`/${view}`)) notFound();
  return <DashboardPage />;
}
