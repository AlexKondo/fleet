import { MaintenanceWorkspace } from "@/app/operations/MaintenanceWorkspace";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    order?: string;
    vehicle?: string;
    status?: string;
    q?: string;
    error?: string;
    success?: string;
  }>;
}) {
  return (
    <MaintenanceWorkspace
      view="vehicle"
      params={await searchParams}
      managerView={false}
    />
  );
}
