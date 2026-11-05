import { redirect } from "next/navigation";

/** The Painel is /dashboard: this address only keeps old links working. */
export default function Page() {
  redirect("/dashboard");
}
