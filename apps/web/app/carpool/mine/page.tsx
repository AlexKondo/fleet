import { TripsWorkspace } from "@/app/trips/TripsWorkspace";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    tripActionError?: string;
    carpoolActionError?: string;
  }>;
}) {
  return TripsWorkspace({ searchParams, carpoolOnly: true });
}
