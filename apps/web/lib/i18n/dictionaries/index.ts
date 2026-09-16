import type { Locale } from "../locales";
import type { Dictionary } from "./types";
import ptBR from "./pt-BR";
import enUS from "./en-US";
import es from "./es";
import zhCN from "./zh-CN";

export type { Dictionary };

export const dictionaries: Record<Locale, Dictionary> = {
  "pt-BR": ptBR,
  "en-US": enUS,
  es,
  "zh-CN": zhCN,
};
