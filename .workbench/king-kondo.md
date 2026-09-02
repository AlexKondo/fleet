# KING-KONDO WORKBENCH

## Mission
Construir a GWM Intelligent Fleet & Corporate Mobility Platform (fleet-car-saas.txt) como
SaaS multi-tenant sobre Supabase, priorizando o Mobility Decision Engine e Trip-Specific
Readiness sobre um simples "Vehicle Booking System".

## Product Contract
Fonte: `fleet-car-saas.txt` (raiz do repo) + `.claude/skills/gauntlet/SKILL.md` seção 2.
Princípio central: **Right Vehicle. Right Trip. Right Time. Ready to Go.**

## Decisions (confirmadas com o usuário em 2026-09-02)
- MVP = Core operacional completo: Domain + Availability/Reservation + Trip-Specific
  Readiness + Mobility Decision Engine + Web Fleet Manager básico. Carona, checklist/fotos
  completos, manutenção preditiva e app mobile nativo vêm em milestones seguintes.
- Mobile: PWA responsiva primeiro. App nativo (Expo/React Native) fica para depois,
  reaproveitando `packages/domain`.
- Tenancy: multi-tenant desde o dia 1 (`organization_id` + Postgres RLS no Supabase).
- Design: direção visual neutra e própria — "console de despacho de frota" (dark,
  status color-coding = conteúdo de domínio, tipografia mono para dados). Ver §Design.
- Supabase: ambiente local via Supabase CLI + Docker (`supabase start`). Projeto real no
  supabase.com ainda não existe — usuário conecta credenciais reais depois via `.env`.
- Git: repo remoto `AlexKondo/fleet` estava vazio. Autorizado a inicializar, commitar e
  dar push do scaffold inicial.

## Design (frontend-design skill aplicada)
Tese: console de despacho de frota (aeroporto/torre de controle), não SaaS dashboard
genérico. Paleta: ink-950 #0b1220, panel-900 #121b2e, line-800 #263352, paper-50 #edf1f7,
fog-400 #9fafc7, + cores de sinal (teal/blue/amber/violet/red) mapeadas 1:1 ao enum
`vehicle_status` (conteúdo, não decoração). Tipografia: Big Shoulders (display, wordmark),
IBM Plex Sans (body), IBM Plex Mono (placas/odômetro/energia — leitura tabular). Elemento
assinatura: o Vehicle Board com gauges de energia em segmentos (não donut chart) e badges
de "atenção" que citam a razão real (não genéricas). Layout orientado a exceção: "PRECISA
DE ATENÇÃO" acima do board, por §18. Validado visualmente via Playwright screenshot
(login + dashboard autenticado) em 2026-09-02 — ver Evidence.

## Architecture Contract
Monorepo pnpm + Turborepo:
```
apps/web                 → Next.js 15 (App Router, TS, Tailwind v4) — Frontend Web Builder
packages/domain           → TS puro, sem framework: entidades, availability, readiness,
                             mobility-engine — Domain Builder
packages/supabase-client  → cliente Supabase tipado (browser+server) + tipos gerados
supabase/migrations       → schema SQL + RLS (mesmo owner do domain — espelha os tipos 1:1)
supabase/seed.sql         → fixtures realistas (10 veículos, múltiplos status/energia)
.workbench/king-kondo.md  → este ledger
```
Regra de ownership: `packages/domain` e `supabase/migrations` são o contrato central —
não editar de dois agentes ao mesmo tempo. UI consome o domain, nunca reimplementa regra.

## Workstreams (fase atual)
- [x] W1 Product Contract & Domain Model — entidades TS + schema SQL + RLS aplicados
- [x] W2 Availability/Reservation Core — `hasSchedulingConflict`/`reserveVehicle` (7 testes)
      + EXCLUDE USING gist no Postgres (defesa em profundidade, testado manualmente)
- [x] W3 Trip-Specific Readiness — `assessTripReadiness` (8 testes) +
      `assessVehicleReadiness` genérico p/ dashboard (9 testes)
- [x] W4 Mobility Decision Engine v1 (sem carpooling ainda) — `recommendVehicle` (5 testes)
- [~] W7 Web Fleet Manager — shell + auth real (Supabase Auth + RLS) + Vehicle Board com
      "Precisa de Atenção" ENTREGUE. Criar reserva / aprovar / trocar veículo: PENDENTE.

## Dependency Graph
W1 → (W2, W3) → W4 → W7. Migrations seguem W1 (mesmo owner).

## Active Builders
Nenhum builder paralelo disparado ainda nesta fase — Orchestrator construiu W1-W4 e a
fatia inicial de W7 diretamente (fundação não paralelizável com segurança na 1ª rodada).

## Active Critics
Nenhum critic formal disparado ainda. Auto-verificação feita via testes + typecheck +
constraint real no Postgres + Playwright (não substitui um Blind Critic independente).

## Passed Gates
- `pnpm test` em packages/domain: 29/29 testes GREEN (availability, readiness x2,
  mobility-engine).
- `pnpm typecheck` em packages/domain e apps/web: limpo.
- Migration 0001 aplica sem erro em Postgres real (Supabase local via Docker).
- EXCLUDE constraint rejeita reserva sobreposta no mesmo veículo (testado com INSERT real
  que falhou com "conflicting key value violates exclusion constraint").
- RLS ativo em todas as tabelas de tenant; login real via Supabase Auth + leitura de
  `vehicles`/`profiles`/`organizations` como usuário autenticado funcionando (screenshot).
- Fluxo E2E real via Playwright: login (gestor@gwm-demo.local) → dashboard → 10 veículos
  renderizados com status/energia/localização/atenção corretos, 0 erros de console.

## Failed Gates
(nenhum aberto no momento — bugs encontrados nesta sessão foram corrigidos, ver Evidence)

## Evidence
- `pnpm --filter @fleet/domain test` → 3 arquivos, 29 testes, GREEN.
- `pnpm --filter @fleet/domain typecheck` e `pnpm --filter @fleet/web typecheck` → sem erros.
- Bug real encontrado e corrigido: migration usava `tsrange` em coluna `timestamptz`
  (deveria ser `tstzrange`) — só apareceu ao rodar `supabase start` de verdade.
- Bug real encontrado e corrigido: seed de `auth.users` sem os campos de token
  (`confirmation_token` etc.) como `''` quebrava o login (GoTrue: "converting NULL to
  string is unsupported") — só apareceu ao logar de verdade via Playwright.
- Screenshots: `02-dashboard.png` (dashboard autenticado, dados reais) — guardado apenas
  localmente no scratchpad da sessão, não commitado ao repo.

## Decisions
Ver seção "Decisions" acima.

## Assumptions
```
ASSUMPTION
Stack: pnpm + Turborepo + Next.js 15 (App Router) + TypeScript + Tailwind v4 + Vitest.
Why: padrão de mercado, bom encaixe com Supabase (SSR/edge), reaproveita packages/domain
em app mobile Expo futuramente.
Risk if wrong: baixo — infraestrutura trocável sem afetar regras de domínio.
```
```
ASSUMPTION
Range Safety Buffer default = 20% de autonomia reservada; janelas mínimas de preparação:
6h para carregar um BEV, 1h para reabastecer ICE/PHEV, 1h para limpeza — tudo configurável
por organização via tabela organization_settings (ReadinessConfig).
Why: não havia valor definido no Product Contract; são pontos de partida conservadores.
Risk if wrong: médio — afeta Trip-Specific Readiness diretamente. Já é campo configurável
por tenant no schema, não hardcoded — fácil de recalibrar.
```
```
ASSUMPTION
TripRequest.distanceKm representa a distância TOTAL da viagem (ida + volta), não só ida.
Why: o Product Contract fala em "distância prevista" sem detalhar; tratar como total é a
leitura mais segura para o cálculo de autonomia (evita ficar sem energia no retorno).
Risk if wrong: médio-alto — se o usuário/produto quiser ida e volta calculadas separado
(com recarga no destino), o cálculo de readiness precisa mudar. Documentar bem no formulário
de solicitação de viagem quando ele for construído.
```

## Risks
- Nenhum projeto Supabase real ainda: schema validado só localmente (Docker).
- W4 (Mobility Decision Engine) ainda não inclui Carpooling Matching (§4) nem Restrição de
  Circulação SP (§15) — vem em próxima rodada.
- W7 web ainda não tem fluxo de criar solicitação de viagem / aprovar reserva — só leitura.
- Nenhum Blind Critic independente rodou ainda sobre este código (só self-verification).
- Multi-tenancy: RLS testado com 1 tenant só; falta teste cross-tenant explícito (P1 antes
  de qualquer release gate, por §26).

## Integration Status
Vertical slice parcial real: auth → RLS → domain (readiness) → UI, verificado ponta a ponta
em ambiente local. Ainda não é o ciclo operacional completo (falta solicitação → aprovação →
retirada → checklist → retorno).

## Human Gates
- Criar o projeto real no supabase.com e fornecer credenciais → aguardando usuário.
- Push para o remoto `AlexKondo/fleet` → autorizado para o scaffold inicial; pushes
  subsequentes materiais serão avisados antes de enviar.

## Remaining Work
1. Teste cross-tenant de RLS (2º tenant fake) antes de qualquer release gate.
2. Carpooling Matching (§4) no Mobility Decision Engine.
3. Fluxo de solicitação de viagem (form) → recomendação → reserva → aprovação (UI + API).
4. Digital Check-out/Check-in + Standardized Photo Inspection (§9-10).
5. Maintenance/Fuel/Charging/Cleaning workflows automáticos (§11-13).
6. Fleet Manager actions (bloquear, trocar veículo, cancelar) na UI.
7. App mobile / PWA otimizada para operação de campo (Segurança/Portaria).
8. Primeiro Blind Critic independente (Domain/Mobility Engine Critic + Security Critic)
   sobre o que já existe.
