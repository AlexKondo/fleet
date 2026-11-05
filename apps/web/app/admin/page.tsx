import { redirect } from "next/navigation";

/** The overview only repeated the Auditoria, Integrações and Governança de IA tabs: this address keeps old links working. */
export default function Page() {
  redirect("/settings");
}
