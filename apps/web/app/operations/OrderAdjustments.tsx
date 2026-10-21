import { randomUUID } from "node:crypto";
import type { FinancialAdjustment, WorkOrder } from "@/lib/operations/models";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import ptBR from "@/lib/i18n/dictionaries/pt-BR";
import { financialAdjustment } from "./adjustmentActions";
import { Field, Submit, money, date, Empty } from "./Workspace";
export function OrderAdjustments({
  adjustments,
  order,
  queue = false,
  dict = ptBR,
}: {
  adjustments: FinancialAdjustment[] | null | undefined;
  order?: WorkOrder;
  queue?: boolean;
  dict?: Dictionary;
}) {
  const t = dict.maintenance.adj;
  const statusLabel = {
    pending: t.pending,
    approved: t.approved,
    rejected: t.rejected,
  };
  const rows = adjustments?.filter((a) => !order || a.work_order_id === order.id);
  return (
    <section aria-label={t.aria}>
      <h3>{t.heading}</h3>
      <p className="ow-note">{t.note}</p>
      {adjustments == null ? (
        <Empty>{t.unavailable}</Empty>
      ) : (
        <>
          {!rows?.length ? (
            <Empty>{t.none}</Empty>
          ) : (
            rows.map((a) => (
              <article key={a.id} className="ow-banner">
                <strong>
                  {money(a.delta)} · {statusLabel[a.status]}
                </strong>
                <p>
                  {a.reason} · {date(a.created_at, true)}
                </p>
                {a.review_notes && (
                  <p>{t.decision.replace("{notes}", a.review_notes)}</p>
                )}
                {a.can_review && (
                  <form action={financialAdjustment} className="ow-form">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="order_id" value={a.work_order_id} />
                    <input type="hidden" name="version" value={a.version} />
                    <input type="hidden" name="request_id" value={randomUUID()} />
                    {queue && <input type="hidden" name="queue" value="1" />}
                    <Field
                      name="reason"
                      label={t.decisionReason}
                      required
                      maxLength={3000}
                    />
                    <div className="ow-actions">
                      <button className="ow-button" name="command" value="approve">
                        {t.approve}
                      </button>
                      <button
                        className="ow-button ow-button-secondary"
                        name="command"
                        value="reject"
                      >
                        {t.reject}
                      </button>
                    </div>
                  </form>
                )}
              </article>
            ))
          )}
          {order?.status === "completed" && (
            <details>
              <summary>{t.propose}</summary>
              <form action={financialAdjustment} className="ow-form">
                <input type="hidden" name="command" value="propose" />
                <input type="hidden" name="order_id" value={order.id} />
                <input type="hidden" name="version" value={order.version} />
                <input type="hidden" name="request_id" value={randomUUID()} />
                <Field name="delta" type="number" step="0.01" label={t.delta} required />
                <Field name="reason" label={t.reason} required maxLength={3000} />
                <Submit>{t.submit}</Submit>
              </form>
            </details>
          )}
        </>
      )}
    </section>
  );
}
