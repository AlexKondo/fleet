export const ORDER_STATES = [
  "draft",
  "budgeted",
  "approved",
  "scheduled",
  "in_progress",
  "partial",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATES)[number];
export const ORDER_LABELS: Record<OrderStatus, string> = {
  draft: "Rascunho",
  budgeted: "Orçamento",
  approved: "Aprovada",
  scheduled: "Programada",
  in_progress: "Em execução",
  partial: "Parcial",
  completed: "Concluída",
  cancelled: "Cancelada",
};
export interface WorkOrder {
  id: string;
  vehicle_id: string;
  number: number;
  kind: "preventive" | "corrective" | "inspection";
  status: OrderStatus;
  description: string;
  supplier: string;
  quote_total: number;
  approved_total: number | null;
  budget_pending?: boolean;
  scheduled_start: string | null;
  scheduled_end: string | null;
  version: number;
  created_at: string;
  completed_at: string | null;
  workflow_task_id: string | null;
}
export interface FinancialAdjustment {id:string;work_order_id:string;delta:number;reason:string;status:"pending"|"approved"|"rejected";proposed_by:string;reviewed_by:string|null;review_notes:string|null;version:number;created_at:string;can_review:boolean;}
export interface WorkOrderLine {
  is_adjustment?:boolean;
  stage: "planned" | "actual";
  id: string;
  work_order_id: string;
  description: string;
  category: string;
  quantity: number;
  unit_price: number;
  warranty: boolean;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}
export interface EnergyEvent {
  id: string;
  vehicle_id: string;
  kind: "fuel" | "charge";
  quantity: number;
  fuel_type: string | null;
  total_cost: number;
  odometer_km: number;
  event_at: string;
  supplier: string;
  voided_at: string | null;
  void_reason: string | null;
}
export interface GateEvent {
  id: string;
  reservation_id: string;
  vehicle_id: string;
  kind: "departure" | "arrival" | "denied";
  reason: string;
  legacy_arrival: boolean;
  created_at: string;
}
export interface Acknowledgement {
  id: string;
  inspection_id: string;
  actor_id: string;
  notes: string;
  created_at: string;
}
export interface BudgetApproval {id:string;work_order_id:string;actor_id:string;actor_name:string;amount:number;created_at:string;policy_snapshot:{unit_id:string|null;policy_version:number;superior_required:boolean};}
export interface OpsSnapshot {
  adjustments?:FinancialAdjustment[]|null;
  approvals?: BudgetApproval[]|null;
  acknowledgements: Acknowledgement[] | null;
  orders: WorkOrder[] | null;
  lines: WorkOrderLine[] | null;
  energy: EnergyEvent[] | null;
  gate: GateEvent[] | null;
}
export function lineTotal(
  line: Pick<WorkOrderLine, "quantity" | "unit_price">,
) {
  const quantity = BigInt(line.quantity.toFixed(3).replace(".", ""));
  const price = BigInt(line.unit_price.toFixed(2).replace(".", ""));
  const product=quantity*price;
  return Number(product<0n?-((-product+500n)/1000n):(product+500n)/1000n)/100;
}
export function orderCosts(lines: WorkOrderLine[]) {
  return lines
    .filter((l) => !l.voided_at && l.stage === "actual")
    .reduce(
      (s, l) => {
        const value = lineTotal(l);
        return {
          gross: Math.round((s.gross + value) * 100) / 100,
          warranty:
            Math.round((s.warranty + (l.warranty ? value : 0)) * 100) / 100,
          effective:
            Math.round((s.effective + (l.warranty ? 0 : value)) * 100) / 100,
        };
      },
      { gross: 0, warranty: 0, effective: 0 },
    );
}
export function orderActions(
  status: OrderStatus,
  manager: boolean,
): OrderStatus[] {
  const actions: Record<OrderStatus, OrderStatus[]> = {
    draft: ["budgeted", ...(manager ? ["cancelled" as const] : [])],
    budgeted: manager ? ["approved", "cancelled"] : [],
    approved: manager ? ["scheduled", "cancelled"] : [],
    scheduled: manager
      ? ["scheduled", "in_progress", "cancelled"]
      : ["in_progress"],
    in_progress: ["partial", "completed"],
    partial: ["in_progress", "completed"],
    completed: [],
    cancelled: [],
  };
  return actions[status];
}
export function parseSnapshot(value: unknown): OpsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_SNAPSHOT");
  const data = value as Record<string, unknown>;
  const rows = <T>(
    key: string,
    check: (r: Record<string, unknown>) => boolean,
  ): T[] | null => {
    if (!(key in data)) return null;
    const a = data[key];
    if (
      !Array.isArray(a) ||
      !a.every(
        (r) =>
          r && typeof r === "object" && typeof r.id === "string" && check(r),
      )
    )
      throw new Error("INVALID_SNAPSHOT");
    return a as T[];
  };
  return {
    adjustments:rows<FinancialAdjustment>("adjustments",r=>typeof r.work_order_id==="string"&&typeof r.delta==="number"&&Number.isFinite(r.delta)&&["pending","approved","rejected"].includes(String(r.status))&&Number.isInteger(r.version)),
    approvals:rows<BudgetApproval>("approvals",r=>typeof r.work_order_id==="string"&&typeof r.actor_id==="string"&&typeof r.actor_name==="string"&&typeof r.amount==="number"&&Number.isFinite(r.amount)&&typeof r.created_at==="string"&&!!r.policy_snapshot&&typeof r.policy_snapshot==="object"),
    acknowledgements: rows<Acknowledgement>(
      "acknowledgements",
      (r) =>
        typeof r.inspection_id === "string" && typeof r.actor_id === "string",
    ),
    orders: rows<WorkOrder>(
      "orders",
      (r) =>
        ORDER_STATES.includes(r.status as OrderStatus) &&
        typeof r.vehicle_id === "string" &&
        Number.isInteger(r.version),
    ),
    lines: rows<WorkOrderLine>(
      "lines",
      (r) =>
        typeof r.work_order_id === "string" &&
        typeof r.quantity === "number" &&
        Number.isFinite(r.quantity) &&
        typeof r.unit_price === "number" &&
        Number.isFinite(r.unit_price),
    ),
    energy: rows<EnergyEvent>(
      "energy",
      (r) =>
        (r.kind === "fuel" || r.kind === "charge") &&
        typeof r.total_cost === "number" &&
        Number.isFinite(r.total_cost),
    ),
    gate: rows<GateEvent>(
      "gate",
      (r) =>
        ["departure", "arrival", "denied"].includes(String(r.kind)) &&
        typeof r.reservation_id === "string",
    ),
  };
}
