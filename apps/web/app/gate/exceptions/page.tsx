import { IncidentsWorkspace } from "@/app/operations/IncidentsWorkspace";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    inspection?: string;
    type?: string;
    error?: string;
    success?: string;
  }>;
}) {
  return <IncidentsWorkspace gate={true} params={await searchParams} />;
}
