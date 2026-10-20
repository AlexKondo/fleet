import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getDictionary } from "@/lib/i18n/getLocale";
import { loadCommandCenter } from "@/lib/dashboard/loadCommandCenter";
import { FmShell } from "../../carpool/FmShell";
import {
  FmCarIcon,
  FmCalendarIcon,
  FmUsersIcon,
  FmWrenchIcon,
  FmAlertIcon,
} from "../../fmIcons";
import { getStatusMeta, VEHICLE_STATUSES } from "../statusMeta";
import "./command-center.css";
import { CommandSearch } from "./CommandSearch";

const labels = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  month: "Mês",
} as const;
const number = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("pt-BR");
function Card({
  title,
  children,
  className = "",
  href,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  href?: string;
}) {
  return (
    <section className={`fc-card ${className}`}>
      <header>
        <h2>{title}</h2>
        {href && <Link href={href}>Ver detalhes →</Link>}
      </header>
      {children}
    </section>
  );
}
function Empty({ children }: { children: ReactNode }) {
  return <p className="fc-empty">{children}</p>;
}

export default async function FleetCommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; location?: string }>;
}) {
  const params = await searchParams;
  const db = await createSupabaseServerClient();
  const user = await getCurrentUser(db);
  if (!user) redirect("/login");
  const { data: profile, error } = await db
    .from("profiles")
    .select(
      "full_name, role, organization_id, organization:organizations(name)",
    )
    .eq("id", user.id)
    .single();
  if (
    error ||
    !profile ||
    !["fleet_manager", "administrator"].includes(profile.role)
  )
    redirect("/dashboard");
  const [data, dict] = await Promise.all([
    loadCommandCenter(
      db,
      profile.organization_id,
      params.period,
      params.location,
    ),
    getDictionary(),
  ]);
  const { vehicles, reservations, rides, tasks, range } = data;
  const statuses = getStatusMeta(dict);
  const counts = VEHICLE_STATUSES.map((status) => ({
    status,
    count: vehicles?.filter((v) => v.status === status).length ?? 0,
  }));
  const total = vehicles?.length ?? null;
  const active =
    vehicles?.filter((v) => ["in_use", "returning"].includes(v.status))
      .length ?? null;
  const available =
    vehicles?.filter((v) => v.status === "available").length ?? null;
  const maintenance =
    vehicles?.filter((v) => v.status === "maintenance").length ?? null;
  const blocked =
    vehicles?.filter((v) => v.status === "blocked").length ?? null;
  const noLocation =
    vehicles?.filter((v) => !v.current_location_id).length ?? null;
  const categories = [
    ...new Set(vehicles?.map((v) => v.category?.name ?? "Sem categoria")),
  ].map((name) => ({
    name,
    count:
      vehicles?.filter((v) => (v.category?.name ?? "Sem categoria") === name)
        .length ?? 0,
  }));
  const services = vehicles
    ?.filter((v) => v.next_service_odometer_km !== null)
    .sort(
      (a, b) =>
        a.next_service_odometer_km! -
        a.odometer_km -
        (b.next_service_odometer_km! - b.odometer_km),
    )
    .slice(0, 5);
  const recent = reservations
    ?.slice()
    .sort((a, b) => b.start_at.localeCompare(a.start_at))
    .slice(0, 5);
  const insights = [
    ...(blocked
      ? [
          {
            title: "Veículos bloqueados",
            text: `${number(blocked)} veículo(s) precisam de resolução antes da próxima utilização.`,
            href: "/dashboard#attention",
            tone: "red",
          },
        ]
      : []),
    ...(tasks?.length
      ? [
          {
            title: "Ações operacionais pendentes",
            text: `${number(tasks.length)} tarefa(s) abertas aguardam tratamento.`,
            href: "/dashboard#open-tasks",
            tone: "orange",
          },
        ]
      : []),
    ...(noLocation
      ? [
          {
            title: "Complete a localização da frota",
            text: `${number(noLocation)} veículo(s) sem local atual registrado.`,
            href: "/fleet",
            tone: "blue",
          },
        ]
      : []),
    ...(maintenance
      ? [
          {
            title: "Disponibilidade para manutenção",
            text: `${number(maintenance)} veículo(s) estão em manutenção. Consulte os bloqueios antes de reservar.`,
            href: "/dashboard#open-tasks",
            tone: "green",
          },
        ]
      : []),
  ];
  const href = (period: string) =>
    `/dashboard/command-center?period=${period}&location=${encodeURIComponent(data.selectedLocation)}`;
  return (
    <FmShell
      active="dashboard"
      role={profile.role}
      isFleetManager
      isAdministrator={profile.role === "administrator"}
      orgName={profile.organization?.name ?? "—"}
      userName={profile.full_name ?? user.email ?? "—"}
      wide
      commandCenter
      searchContent={
        <CommandSearch
          items={[
            ...(vehicles ?? []).map((v) => ({
              label: `${v.plate} · ${v.category?.name ?? "Veículo"}`,
              detail: statuses[v.status].label,
              href: `/fleet/vehicles/${v.id}`,
            })),
            ...(reservations ?? []).map((r) => ({
              label: r.trip_request?.requester?.full_name ?? "Viagem",
              detail: `${r.trip_request?.origin ?? ""} → ${r.trip_request?.destination ?? ""}`,
              href: `/reservations/${r.id}`,
            })),
          ]}
        />
      }
    >
      <div className="fc" data-testid="fleet-command-center">
        <div className="fc-heading">
          <div>
            <h1>Fleet Command Center 360°</h1>
            <p>
              Visão completa da operação, utilização, viagens, caronas, economia
              e sustentabilidade da frota.
            </p>
          </div>
          <div className="fc-filters">
            <nav aria-label="Período dos indicadores">
              {Object.entries(labels).map(([key, label]) => (
                <Link
                  key={key}
                  href={href(key)}
                  aria-current={range.period === key ? "page" : undefined}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <form method="get">
              <input type="hidden" name="period" value={range.period} />
              <label className="sr-only" htmlFor="fc-location">
                Local operacional atual
              </label>
              <select
                id="fc-location"
                name="location"
                defaultValue={data.selectedLocation}
                disabled={data.locations === null}
              >
                <option value="all">Todos os locais</option>
                {data.locations?.map((l) => (
                  <option value={l.id} key={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button type="submit">Aplicar</button>
            </form>
          </div>
        </div>
        {data.degraded && (
          <p role="alert" className="fc-error">
            Algumas fontes não responderam. “—” indica dados indisponíveis.{" "}
            <Link href={href(range.period)}>Tentar novamente</Link>
          </p>
        )}
        <div className="fc-layout">
          <div className="fc-main">
            <section className="fc-kpis" aria-label="Indicadores operacionais">
              <div className="fc-card fc-kpi">
                <div className="fc-kpi-top">
                  <FmCarIcon />
                  <div>
                    <strong>{number(total)}</strong>
                    <span>Veículos total</span>
                  </div>
                </div>
                <div className="fc-segments" aria-hidden="true">
                  {counts
                    .filter((c) => c.count)
                    .map((c) => (
                      <span
                        key={c.status}
                        data-status={c.status}
                        style={{ flex: c.count }}
                      />
                    ))}
                </div>
                <dl>
                  {[
                    ["Em operação", active],
                    ["Disponíveis", available],
                    ["Em manutenção", maintenance],
                    ["Bloqueados", blocked],
                  ].map(([label, n]) => (
                    <div key={String(label)}>
                      <dt>{label}</dt>
                      <dd>{number(n as number | null)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <Link className="fc-card fc-kpi" href="/trips">
                <div className="fc-kpi-top">
                  <FmCalendarIcon />
                  <div>
                    <strong>
                      {number(
                        reservations?.filter(
                          (r) =>
                            r.status === "confirmed" ||
                            r.status === "completed",
                        ).length ?? null,
                      )}
                    </strong>
                    <span>Viagens · {labels[range.period]}</span>
                  </div>
                </div>
                <dl>
                  {["confirmed", "completed", "cancelled"].map((s) => (
                    <div key={s}>
                      <dt>
                        {s === "confirmed"
                          ? "Confirmadas"
                          : s === "completed"
                            ? "Concluídas"
                            : "Canceladas"}
                      </dt>
                      <dd>
                        {number(
                          reservations?.filter((r) => r.status === s).length ??
                            null,
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <small>Por data de partida programada</small>
              </Link>
              <Link className="fc-card fc-kpi" href="/analytics/carpool">
                <div className="fc-kpi-top">
                  <FmUsersIcon />
                  <div>
                    <strong>{number(rides?.length ?? null)}</strong>
                    <span>Caronas aceitas</span>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Assentos compartilhados</dt>
                    <dd>
                      {number(
                        rides?.reduce((sum, r) => sum + r.requested_seats, 0) ??
                          null,
                      )}
                    </dd>
                  </div>
                </dl>
                <small>Nas viagens do período selecionado</small>
              </Link>
              <div className="fc-card fc-kpi">
                <div className="fc-kpi-top">
                  <span className="fc-gauge" aria-hidden="true">
                    ◔
                  </span>
                  <div>
                    <strong>—</strong>
                    <span>Taxa de utilização</span>
                  </div>
                </div>
                <small>Veículo-horas em uso / disponíveis</small>
                <p>Histórico de disponibilidade ainda não integrado.</p>
              </div>
              <div className="fc-card fc-kpi">
                <div className="fc-kpi-top">
                  <FmUsersIcon />
                  <div>
                    <strong>—</strong>
                    <span>Taxa de ocupação</span>
                  </div>
                </div>
                <small>Passageiro-km / assento-km disponíveis</small>
                <p>Distâncias e ocupação efetivas ainda não consolidadas.</p>
              </div>
            </section>
            <div className="fc-middle">
              <Card
                title="Localização da Frota"
                className="fc-location"
                href="/fleet"
              >
                <div className="fc-map-state">
                  <svg
                    className="fc-pin-svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    aria-hidden="true"
                  >
                    <path d="M12 21s-7-6-7-12a7 7 0 0 1 14 0c0 6-7 12-7 12Z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  <strong>Mapa indisponível</strong>
                  <p>
                    Sem fonte geográfica validada para posicionar os veículos.
                  </p>
                  <span className="fc-pill">
                    Localização operacional cadastrada
                  </span>
                </div>
                <div className="fc-location-list">
                  {vehicles === null || data.locations === null ? (
                    <Empty>Não foi possível consultar as localizações.</Empty>
                  ) : (
                    <>
                      {data.locations
                        .filter((l) =>
                          vehicles.some((v) => v.current_location_id === l.id),
                        )
                        .slice(0, 5)
                        .map((l) => (
                          <Link
                            key={l.id}
                            href={`/dashboard/command-center?period=${range.period}&location=${l.id}`}
                          >
                            <span>{l.name}</span>
                            <strong>
                              {
                                vehicles.filter(
                                  (v) => v.current_location_id === l.id,
                                ).length
                              }
                            </strong>
                          </Link>
                        ))}
                      <p>
                        Sem local: <strong>{number(noLocation)}</strong>
                      </p>
                    </>
                  )}
                </div>
              </Card>
              <Card
                title="Economia e Sustentabilidade"
                className="fc-sustain"
                href="/analytics"
              >
                <div className="fc-sustain-grid">
                  {[
                    ["♧", "Economia com caronas"],
                    ["◉", "Economia BEV (vs. gasolina)"],
                    ["ϟ", "Percorridos em modo elétrico (BEV)"],
                    ["❧", "CO₂ evitado (BEV)"],
                  ].map(([icon, label]) => (
                    <div key={label}>
                      <span aria-hidden="true">{icon}</span>
                      <div>
                        <strong>—</strong>
                        <p>{label}</p>
                        <small>Fonte de cálculo pendente</small>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <div className="fc-charts">
              <Card title="Utilização da frota">
                <p className="fc-caption">
                  Partidas programadas no período · não representa taxa de
                  utilização
                </p>
                {reservations === null ? (
                  <Empty>Série indisponível.</Empty>
                ) : !data.daily.some((d) => d.count) ? (
                  <Empty>Sem partidas programadas neste período.</Empty>
                ) : (
                  <div
                    className="fc-bars"
                    role="img"
                    aria-label={data.daily
                      .map((d) => `${d.day}: ${d.count} partidas`)
                      .join("; ")}
                  >
                    {data.daily.map((d) => (
                      <div key={d.day} title={`${d.day}: ${d.count} partidas`}>
                        <span
                          style={{
                            height: `${(d.count / Math.max(...data.daily.map((x) => x.count), 1)) * 100}%`,
                          }}
                        />
                        <small>{d.day.slice(8)}</small>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card title="Ocupação dos assentos">
                <Empty>
                  O gráfico será exibido quando passageiro-km e assento-km
                  efetivos estiverem disponíveis.
                </Empty>
                <p className="fc-caption">
                  Sem estimativas a partir de reservas confirmadas.
                </p>
              </Card>
              <Card title="Viagens por tipo de uso">
                <Empty>
                  Classificação por finalidade ainda não disponível nos
                  registros.
                </Empty>
              </Card>
            </div>
            <div className="fc-bottom">
              <Card title="Veículos por categoria" href="/fleet">
                {vehicles === null ? (
                  <Empty>Dados indisponíveis.</Empty>
                ) : !total ? (
                  <Empty>Nenhum veículo cadastrado.</Empty>
                ) : (
                  <div className="fc-category-bars">
                    {categories.map((c) => (
                      <div key={c.name}>
                        <strong>{c.count}</strong>
                        <span
                          style={{
                            height: `${(c.count / Math.max(...categories.map((x) => x.count), 1)) * 90}px`,
                          }}
                        />
                        <small>{c.name}</small>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
              <Card title="Status da frota">
                {vehicles === null ? (
                  <Empty>Dados indisponíveis.</Empty>
                ) : (
                  <dl className="fc-status-list">
                    {counts
                      .filter((c) => c.count)
                      .map((c) => (
                        <div key={c.status}>
                          <dt>
                            <i data-status={c.status} />
                            {statuses[c.status].label}
                          </dt>
                          <dd>
                            {c.count}{" "}
                            <small>
                              {total ? Math.round((c.count / total) * 100) : 0}%
                            </small>
                          </dd>
                        </div>
                      ))}
                    {!total && <Empty>Nenhum veículo neste filtro.</Empty>}
                  </dl>
                )}
              </Card>
              <Card title="Próximas manutenções" href="/dashboard#open-tasks">
                {vehicles === null ? (
                  <Empty>Dados indisponíveis.</Empty>
                ) : !services?.length ? (
                  <Empty>Sem revisão por quilometragem cadastrada.</Empty>
                ) : (
                  <ul className="fc-records">
                    {services.map((v) => (
                      <li key={v.id}>
                        <FmCarIcon />
                        <Link href={`/fleet/vehicles/${v.id}`}>
                          <strong>{v.category?.name ?? v.plate}</strong>
                          <small>{v.plate}</small>
                        </Link>
                        <span
                          className={
                            v.next_service_odometer_km! <= v.odometer_km
                              ? "fc-danger"
                              : ""
                          }
                        >
                          {number(
                            Math.max(
                              0,
                              v.next_service_odometer_km! - v.odometer_km,
                            ),
                          )}{" "}
                          km
                          <small>
                            {v.next_service_odometer_km! <= v.odometer_km
                              ? "Revisão atingida"
                              : "Até a revisão"}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Viagens recentes" href="/trips">
                {reservations === null ? (
                  <Empty>Dados indisponíveis.</Empty>
                ) : !recent?.length ? (
                  <Empty>Sem viagens neste período.</Empty>
                ) : (
                  <ul className="fc-records">
                    {recent.map((r) => (
                      <li key={r.id}>
                        <Link href={`/reservations/${r.id}`}>
                          <strong>
                            {r.trip_request?.requester?.full_name ?? "Condutor"}
                          </strong>
                          <small>
                            {r.trip_request?.destination ??
                              "Destino não informado"}
                          </small>
                        </Link>
                        <span>
                          {new Date(r.start_at).toLocaleDateString("pt-BR", {
                            timeZone: "America/Sao_Paulo",
                            day: "2-digit",
                            month: "2-digit",
                          })}
                          <small>
                            {dict.fleet.detail.reservationStatus[r.status]}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
          <aside className="fc-side">
            <Card title="✦ FleetMind Intelligence" className="fc-intelligence">
              <span className="fc-count">{insights.length} insights</span>
              {vehicles === null || tasks === null ? (
                <Empty>
                  Não foi possível confirmar todas as recomendações.
                </Empty>
              ) : null}
              {insights.length
                ? insights.map((i) => (
                    <Link className="fc-insight" href={i.href} key={i.title}>
                      <span data-tone={i.tone}>✦</span>
                      <div>
                        <strong>{i.title}</strong>
                        <p>{i.text}</p>
                      </div>
                      <b aria-hidden="true">›</b>
                    </Link>
                  ))
                : !data.degraded && (
                    <Empty>
                      Nenhuma ação proativa identificada nos registros atuais.
                    </Empty>
                  )}
              <p className="fc-caption">
                Regras explicáveis baseadas no estado atual da operação.
              </p>
            </Card>
            <Card title="Alertas e Notificações" href="/dashboard#open-tasks">
              {tasks === null ? (
                <Empty>Alertas indisponíveis.</Empty>
              ) : !tasks.length ? (
                <Empty>Não há tarefas operacionais abertas neste filtro.</Empty>
              ) : (
                <ul className="fc-alerts">
                  {tasks
                    .slice()
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .slice(0, 5)
                    .map((task) => (
                      <li key={task.id}>
                        <FmAlertIcon />
                        <Link href="/dashboard#open-tasks">
                          <strong>
                            {dict.dashboard.tasks.types[task.type] ?? task.type}
                          </strong>
                          <p>{task.vehicle?.plate ?? "Veículo"}</p>
                          <small>
                            {new Date(task.created_at).toLocaleDateString(
                              "pt-BR",
                              { timeZone: "America/Sao_Paulo" },
                            )}{" "}
                            · {task.priority}
                          </small>
                        </Link>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
            <Card title="Ações rápidas">
              <nav className="fc-actions" aria-label="Ações rápidas">
                {[
                  {
                    label: "Nova reserva",
                    href: "/trips/new",
                    icon: <FmCalendarIcon />,
                  },
                  {
                    label: "Procurar carona",
                    href: "/carpool",
                    icon: <FmUsersIcon />,
                  },
                  {
                    label: "Gerenciar veículos",
                    href: "/fleet",
                    icon: <FmCarIcon />,
                  },
                  {
                    label: "Ocorrências e tarefas",
                    href: "/dashboard#attention",
                    icon: <FmAlertIcon />,
                  },
                  {
                    label: "Manutenção",
                    href: "/dashboard#open-tasks",
                    icon: <FmWrenchIcon />,
                  },
                  {
                    label: "Relatórios",
                    href: "/analytics",
                    icon: <FmCalendarIcon />,
                  },
                ].map((a) => (
                  <Link href={a.href} key={a.label}>
                    <span>{a.icon}</span>
                    {a.label}
                  </Link>
                ))}
              </nav>
            </Card>
          </aside>
        </div>
        <p className="fc-footnote">
          Frota, alertas e insights refletem o estado atual. O período filtra
          partidas programadas e caronas vinculadas. O local filtra a posição
          operacional atual, sem representar uma unidade histórica.{" "}
          <Link href="/dashboard">
            Abrir controles operacionais e aprovações →
          </Link>
        </p>
      </div>
    </FmShell>
  );
}
