# KING-KONDO WORKBENCH

## Mission
Construir a GWM Intelligent Fleet & Corporate Mobility Platform (fleet-car-saas.txt) como
SaaS multi-tenant sobre Supabase, priorizando o Mobility Decision Engine e Trip-Specific
Readiness sobre um simples "Vehicle Booking System".

## Product Contract
Fonte: `fleet-car-saas.txt` (raiz do repo) + `.claude/skills/gauntlet/SKILL.md` seção 2.
Princípio central: **Right Vehicle. Right Trip. Right Time. Ready to Go.**

## Decisions
- MVP = Core operacional completo (ver Decisions da rodada anterior). Confirmado em
  2026-09-02: aplicar migrations no Supabase real e continuar o ciclo operacional
  completo (request → aprovação → retirada → viagem → retorno → workflow).
- Ambiente: **projeto Supabase remoto real** (`rhbiwkxilelitugbwind.supabase.co`) é o
  ambiente de referência — `apps/web/.env.local` aponta para lá. Supabase local
  (`supabase start`) continua disponível para desenvolvimento rápido/seguro; ver README.
- Multi-tenant, RLS, design "console de despacho" — inalterados da rodada anterior.

## Architecture Contract
Inalterado (ver seção anterior). Migrations agora em 4 arquivos:
```
0001_init_schema.sql        → schema base + RLS (W1/W2)
0002_operational_cycle.sql  → trip_participants, inspections, inspection_photos,
                               workflow_tasks, storage bucket vehicle-photos (W5/W6)
0003_trip_request_flow.sql  → policy de insert em reservations p/ o próprio requester +
                               RPCs create_vehicle_reservation / create_carpool_participation
0004_operational_actions.sql → RPCs approve_reservation, record_pickup, record_return,
                               complete_workflow_task, block_vehicle, unblock_vehicle
```
Todas as 4 aplicadas e verificadas em **local e remoto**.

## Workstreams
- [x] W1 Product Contract & Domain Model
- [x] W2 Availability/Reservation Core (+ policy de insert do próprio requester, §5)
- [x] W3 Trip-Specific Readiness + Vehicle Readiness geral
- [x] W4 Mobility Decision Engine — **agora com Carpooling Matching (§4)** via
      `findCarpoolMatches` + `planMobility` (carpool é sempre avaliado antes de alocar
      veículo, por §17)
- [x] W5 Check-in/Check-out — checklist de retirada e retorno reais (RPCs
      `record_pickup`/`record_return`), com autorização própria (traveler ou
      security/fleet_manager). **Falta**: upload real de fotos (bucket+RLS existem,
      UI de captura não foi construída — ver Remaining Work).
- [x] W6 Checklist → Workflow automático (§11) — `deriveReturnOutcome` no domínio +
      `workflow_tasks` no banco + painel do Fleet Manager para concluir tarefas.
      Reavaliação de status ao concluir tarefa corrigida para considerar TODAS as
      tarefas abertas do veículo, não só as do mesmo tipo (bug real, ver Evidence).
- [~] W7 Web Fleet Manager — dashboard + solicitação de viagem + aprovação + bloqueio/
      desbloqueio de veículo + conclusão de tarefas, tudo real e testado via UI.
      **Falta**: trocar veículo de uma reserva, transferir reserva, agendar
      limpeza/recarga proativamente (só reage a tarefas já criadas).
- [ ] W9 Analytics/Fleet Intelligence (§19) — não iniciado.
- [ ] Predictive Maintenance (§12, estimativa de km/dia) — não iniciado (só threshold
      simples de "revisão próxima").
- [ ] São Paulo Traffic Restriction (§15) — não iniciado.
- [ ] App mobile/PWA otimizada para campo — não iniciado (web responsivo básico, não
      testado em viewport mobile nem com câmera).

## Active Builders / Critics
Toda esta rodada foi construída diretamente pelo Orchestrator (eu), sem fan-out para
subagentes — o volume de contratos inter-dependentes (schema ↔ domínio ↔ RPCs ↔ UI)
tornava a paralelização arriscada sem quebrar em fatias menores primeiro. Nenhum Blind
Critic independente rodou ainda sobre este código — é o próximo passo recomendado antes
de qualquer release gate real.

## Passed Gates
- `pnpm test` (domain): **66/66 GREEN** (8 arquivos, incluindo carpooling, state
  machine, workflow routing).
- `pnpm typecheck`: limpo nos 3 pacotes.
- Migrations 0001-0004 aplicadas sem erro em **local (Docker) e remoto**.
- Fluxo E2E completo via Playwright, através da UI real, contra o Supabase local, 0 erros
  de console em cada etapa:
  1. Colaborador solicita viagem → engine recomenda veículo (ou carona) com explicação.
  2. Fleet Manager aprova a reserva pendente no dashboard.
  3. Colaborador faz checklist de retirada → veículo vai para `in_use`.
  4. Colaborador faz checklist de retorno com avaria simulada → veículo vai
     corretamente para `maintenance`, tarefas `repair`+`cleaning` criadas.
  5. Fleet Manager conclui a tarefa de reparo → veículo **permanece** `cleaning`
     (não libera com pendência de limpeza) → conclui limpeza → veículo volta a
     `available`.
- Repetido também contra o **Supabase remoto real** (login + dashboard, 0 erros).
- RLS/autorização testada com chamadas reais (não só teoria): colaborador tentando
  aprovar a própria reserva é rejeitado pelo próprio mecanismo de `FOR UPDATE` do
  Postgres (a policy de UPDATE em `vehicles` não cobre `employee`); fleet manager
  aprova normalmente.

## Evidence — bugs reais encontrados e corrigidos nesta rodada
1. **Ranking do Mobility Decision Engine (P1, viola exemplo explícito do §3)**: o
   critério de "menor veículo" usava só `passengerCapacity`, o que fazia o motor
   recomendar a picape de carga (Poer P30, capacidade 3) em vez do EV compacto
   (capacidade 4) para uma viagem solo sem carga — exatamente o contra-exemplo que a
   spec cita. Encontrado rodando o fluxo real via Playwright, não só nos testes
   unitários (que usavam categorias com capacidades diferentes das do seed real).
   Corrigido: o ranking agora penaliza veículos cargo-capable quando a viagem não
   precisa de carga e prefere elétrico sobre combustão, com teste de regressão.
2. **`record_return` gravava `is_dirty_exterior`/`is_dirty_interior`** em colunas que na
   verdade se chamam `is_clean_exterior`/`is_clean_interior` (polaridade invertida) —
   erro de SQL só detectado ao rodar a RPC de verdade (`column does not exist`).
3. **`complete_workflow_task` liberava o veículo prematuramente**: ao concluir uma
   tarefa (ex.: reparo), só olhava tarefas do MESMO tipo, ignorando que ainda podia
   haver limpeza pendente — o veículo voltaria para `available` sujo. Corrigido para
   recalcular o status a partir de TODAS as tarefas abertas do veículo. Encontrado e
   verificado com um teste manual específico (completar reparo primeiro, confirmar que
   o veículo fica em `cleaning`, só then completar limpeza).
4. **Ambiente de teste apontando para o projeto remoto sem eu perceber**: depois de
   trocar `apps/web/.env.local` para validar a conexão remota, não voltei para local —
   isso causou uma cascata confusa de "dados fantasma" nos meus próprios testes E2E
   (uma reserva de um teste virando candidata de carona do teste seguinte). Não é um
   bug do produto, mas poluiu o banco remoto real do usuário; limpo (ver abaixo).
5. `tsrange` vs `tstzrange` e tokens de `auth.users` NULL — já registrados na rodada
   anterior.

## Cleanup realizado
- Banco remoto: dados de teste (reservas fantasma "Campinas"/GWM5E12, participante de
  carona) removidos — `truncate` de todas as tabelas de domínio + usuários demo
  recriados + seed original reaplicado. Estado do remoto agora idêntico ao seed limpo.
- Banco local: resetado para o seed limpo após os testes.
- Scripts de teste temporários (Playwright, scripts com senha do Postgres em texto
  plano) apagados do scratchpad da sessão — nunca commitados ao repo.

## Assumptions
Mantidas da rodada anterior, mais:
```
ASSUMPTION
Destino de carpooling usa comparação exata de string (§4), sem geocoding/proximidade.
Why: geocoding real está fora do MVP (nenhuma dependência de API externa paga ainda).
Risk if wrong: médio — "São Paulo" vs "São Paulo - Zona Sul" não casam hoje. Documentar
para o usuário; resolver quando houver integração de geocoding.
```
```
ASSUMPTION
Fotos de inspeção (§10): bucket `vehicle-photos` e RLS existem no schema, mas não há UI
de captura/upload ainda. O checklist funciona sem foto (texto/checkbox apenas).
Why: priorizei fechar o ciclo operacional completo (status/workflow) antes da evidência
fotográfica, que é aditiva e não bloqueia o restante do fluxo.
Risk if wrong: baixo tecnicamente (schema já suporta), mas é uma lacuna real de produto
frente ao §9/§10 — não devo alegar "checklist completo" sem essa ressalva.
```

## Risks
- Nenhum Blind Critic independente revisou este código ainda (só self-verification +
  E2E real). Recomendo isso como próximo passo antes de qualquer release gate.
- RLS cross-tenant ainda não tem teste automatizado com um 2º tenant fake (P1 pendente
  desde a rodada anterior).
- Fleet Manager não tem "trocar veículo"/"transferir reserva" — se uma reserva
  aprovada precisar mudar de veículo, hoje só dá para bloquear e recriar manualmente.

## Human Gates
- Nenhum pendente no momento além dos já conhecidos (projeto Supabase real: feito;
  push do scaffold: feito). Próximos pushes materiais serão informados antes de enviar,
  como já combinado.

## Remaining Work (ordem sugerida)
1. Blind Critic (Domain/Mobility + Security) sobre o código desta rodada.
2. Teste cross-tenant de RLS automatizado.
3. UI de captura/upload de fotos no checklist (§10), usando o bucket já criado.
4. Ações adicionais do Fleet Manager: trocar veículo, transferir reserva, agendar
   limpeza/recarga proativamente (§5/§13).
5. Predictive Maintenance real (§12) e São Paulo Traffic Restriction (§15).
6. Fleet Intelligence / analytics (§19).
7. PWA/mobile: testar e otimizar os fluxos de checklist para uso em campo (uma mão,
   câmera, recuperação de rede).
