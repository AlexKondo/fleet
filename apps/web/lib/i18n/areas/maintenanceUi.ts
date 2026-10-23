import type { AreaTexts } from "../areaText";

/** Loading state shared by the operations screens (`app/gate/loading.tsx`, `app/maintenance/loading.tsx`). */
export const operationsLoadingTexts: AreaTexts<"loading"> = {
  "pt-BR": { loading: "Carregando informações da operação…" },
  "en-US": { loading: "Loading operations information…" },
  es: { loading: "Cargando información de la operación…" },
  "zh-CN": { loading: "正在加载运营信息…" },
};
