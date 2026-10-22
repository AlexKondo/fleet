/** Server-only operational activation: absent/malformed settings never authorize cancellation. */
export function automaticReleaseEnabled(): boolean {
 return process.env.FM_ENABLE_AUTO_RESERVATION_RELEASE === "true";
}
