const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function localTimestamp(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("INVALID_INPUT");
  const d = new Date(value + ":00-03:00");
  if (
    !Number.isFinite(d.getTime()) ||
    new Date(d.getTime() - 10800000).toISOString().slice(0, 16) !== value
  )
    throw new Error("INVALID_INPUT");
  return d.toISOString();
}
export function operationForm(form: FormData) {
  const text = (key: string, max = 3000) => {
    const v = form.get(key);
    if (typeof v !== "string" || v.length > max)
      throw new Error("INVALID_INPUT");
    return v.trim();
  };
  const id = (key: string) => {
    const v = text(key, 36);
    if (!uuid.test(v)) throw new Error("INVALID_INPUT");
    return v;
  };
  const num = (key: string) => {
    const v = text(key, 20);
    if (!/^\d{1,10}(\.\d{1,3})?$/.test(v)) throw new Error("INVALID_INPUT");
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error("INVALID_INPUT");
    return n;
  };
  const command = text("command", 40);
  const requestId = id("request_id");
  let payload: Record<string, string | number | boolean>;
  switch (command) {
    case "work_order.create":
      payload = {
        vehicle_id: id("vehicle_id"),
        kind: text("kind", 20),
        description: text("description"),
        supplier: text("supplier", 200),
        quote_total: num("quote_total"),
      };
      break;
    case "work_order.approve_budget":
      payload = {id:id("id"),version:num("version")};
      break;
    case "work_order.transition":
      payload = {
        id: id("id"),
        version: num("version"),
        status: text("status", 20),
      };
      if (payload.status === "scheduled") {
        payload.scheduled_start = localTimestamp(text("scheduled_start", 16));
        payload.scheduled_end = localTimestamp(text("scheduled_end", 16));
      }
      break;
    case "work_order.budget":
      payload = {
        id: id("id"),
        version: num("version"),
        quote_total: num("quote_total"),
        reason: text("reason", 500),
      };
      break;
    case "work_order.line":
      payload = {
        id: id("id"),
        version: num("version"),
        description: text("description", 500),
        category: text("category", 20),
        stage: text("stage", 20),
        quantity: num("quantity"),
        unit_price: num("unit_price"),
        warranty: form.get("warranty") === "on",
      };
      break;
    case "work_order.void_line":
      payload = {
        id: id("id"),
        version: num("version"),
        line_id: id("line_id"),
        reason: text("reason", 500),
      };
      break;
    case "energy.record":
      payload = {
        vehicle_id: id("vehicle_id"),
        kind: text("kind", 20),
        quantity: num("quantity"),
        fuel_type: text("fuel_type", 20),
        total_cost: num("total_cost"),
        odometer_km: num("odometer_km"),
        event_at: localTimestamp(text("event_at", 16)),
        supplier: text("supplier", 200),
      };
      break;
    case "energy.void":
      payload = { id: id("id"), reason: text("reason", 500) };
      break;
    case "incident.ack":
      payload = {
        inspection_id: id("inspection_id"),
        notes: text("notes", 1000),
      };
      break;
    case "gate.record":
      payload = {
        reservation_id: id("reservation_id"),
        kind: text("kind", 20),
        reason: text("reason", 1000),
      };
      break;
    case "vehicle.identity":
      payload = {
        vehicle_id: id("vehicle_id"),
        vin: text("vin", 17),
        next_service_date: text("next_service_date", 10),
      };
      break;
    default:
      throw new Error("UNKNOWN_COMMAND");
  }
  return { command, requestId, payload };
}
const paths = new Set([
  "/maintenance",
  "/maintenance/planning",
  "/maintenance/work-orders",
  "/maintenance/vehicles",
  "/fleet/maintenance",
  "/fleet/energy",
  "/gate/history",
  "/gate/exceptions",
  "/fleet/incidents",
]);
export function operationReturn(value: unknown) {
  if (typeof value !== "string") return "/maintenance";
  let u: URL;
  try {
    u = new URL(value, "https://fleet.invalid");
  } catch {
    return "/maintenance";
  }
  return u.origin === "https://fleet.invalid" && paths.has(u.pathname)
    ? u.pathname + u.search
    : "/maintenance";
}
