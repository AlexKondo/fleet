import { getAreaText } from "@/lib/i18n/areaText";
import { adminWorkspaceTexts } from "@/lib/i18n/areas/adminWorkspace";
export default async function Loading(){const T=await getAreaText(adminWorkspaceTexts);return <div role="status" aria-live="polite" style={{padding:32,color:"#142644",background:"#f3f7fc",minHeight:"100vh"}}>{T.loading}</div>;}
