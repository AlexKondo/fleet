import type { AreaTexts } from "../areaText";

/** "Share the address" on a confirmed reservation (app/reservations/[id]/ShareAddress.tsx). */
type K = "title" | "share" | "maps" | "waze" | "copy" | "copied" | "shareText";

export const shareAddressTexts: AreaTexts<K> = {
  "pt-BR": { title: "Endereço do destino", share: "Compartilhar endereço", maps: "Abrir no Google Maps", waze: "Abrir no Waze", copy: "Copiar endereço", copied: "Endereço copiado.", shareText: "Destino da viagem: {address}" },
  "en-US": { title: "Destination address", share: "Share address", maps: "Open in Google Maps", waze: "Open in Waze", copy: "Copy address", copied: "Address copied.", shareText: "Trip destination: {address}" },
  es: { title: "Dirección del destino", share: "Compartir dirección", maps: "Abrir en Google Maps", waze: "Abrir en Waze", copy: "Copiar dirección", copied: "Dirección copiada.", shareText: "Destino del viaje: {address}" },
  "zh-CN": { title: "目的地地址", share: "分享地址", maps: "在 Google 地图中打开", waze: "在 Waze 中打开", copy: "复制地址", copied: "地址已复制。", shareText: "行程目的地：{address}" },
};
