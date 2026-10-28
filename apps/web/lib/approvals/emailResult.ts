/** What the e-mail confirmation page may show right after a decision (anything else is shown as a generic error). */
export const RESULT_STATUSES = ["approved", "rejected", "already_decided", "expired", "superseded", "vehicle_unavailable", "not_authorized", "invalid"] as const;

export const isResultStatus = (value: string | undefined): value is (typeof RESULT_STATUSES)[number] =>
  Boolean(value) && (RESULT_STATUSES as readonly string[]).includes(value as string);

/** Stored request state (fm_approval_peek) -> the status whose text explains it when the link is opened again later. */
export function storedStateToStatus(state: string): string {
  switch (state) {
    case "approved":
    case "rejected": return "already_decided";
    case "cancelled": return "superseded";
    case "expired":
    case "superseded":
    case "invalid": return state;
    default: return "generic_error";
  }
}
