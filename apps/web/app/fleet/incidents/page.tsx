import { IncidentsWorkspace } from "@/app/operations/IncidentsWorkspace";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    case?: string;
    caseStatus?: string;
    caseError?: string;
    q?: string;
    inspection?: string;
    type?: string;
    error?: string;
    success?: string;
  }>;
}) {
  return <IncidentsWorkspace gate={false} params={await searchParams} />;
}
