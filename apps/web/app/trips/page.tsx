import { TripsWorkspace } from "./TripsWorkspace";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    tripActionError?: string;
    carpoolActionError?: string;
    tab?: string;
  }>;
}) {
  return TripsWorkspace({ searchParams });
}
