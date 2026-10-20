import { AdminWorkspace } from "@/app/admin/AdminWorkspace";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    action?: string;
    error?: string;
    success?: string;
  }>;
}) {
  return <AdminWorkspace view="integrations" params={await searchParams} />;
}
