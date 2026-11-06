import { redirect } from "next/navigation";

/** The list of movements was removed: the trail stays in Auditoria. This address only keeps old links working. */
export default function Page() {
  redirect("/gate");
}
