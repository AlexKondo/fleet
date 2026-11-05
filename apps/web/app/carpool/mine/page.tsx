import { redirect } from "next/navigation";

/** Carpools are on Viagens: this address only keeps old links working. */
export default function Page() {
  redirect("/trips");
}
