# S1 — Cenários SQL / permissões / reservas / saída impedida (Postgres REAL local)

Agente S1 · 22/10/2026 · worktree `C:\projects\fleet-integ` (branch `integracao-conclusao-2026-10-22`, 5b5a9d0) · banco LOCAL `supabase_db_fleet-homolog` (migrations até 0213; **0214 não aplicada**).
Nenhum acesso a produção, nenhum host remoto, nenhuma edição de código-fonte/migration, nenhum `git write`. Nenhuma chave ou senha foi impressa (credenciais S1 geradas aleatoriamente e guardadas só no scratchpad da sessão).

## Resumo

| Bloco | Resultado executado | Defeitos novos |
|---|---|---|
| 1. Permissões de `vehicles` (FM-04, 0210) | **PASS**: 621 casos SQL + 292 casos HTTP, 0 falhas contra a 0210. A foto da Frota continua funcionando para quem pode. | S1-01 (decisão/P2), S1-06 (P2) |
| 2. CNH × acesso administrativo | **PASS**: 7 bloqueios de condução, 10 acessos administrativos sem CNH, 8 casos antifraude | — |
| 3. Liberação de vencidas (FM-01, 0213) | **PASS** nas duas camadas, nas fronteiras de tolerância, na atividade, na idempotência e em 120 iterações concorrentes sem 40P01 | S1-02 (P2), S1-03 (P3), S1-04 (P2) |
| 4. Saída impedida (FM-03, 0211) | **PASS**: 24/24 | — |
| 5. Fluxos SP / Campinas / avaria / OS | **PASS** nos fluxos aprovados | S1-05 (P2), S1-07 (P3), S1-08 (P3) |

Nenhum P0 ou P1 encontrado. Há 6 defeitos P2/P3 e 1 decisão. Os P2 S1-02, S1-04, S1-05 e S1-06 têm a **mesma causa**: cada rotina usa a sua própria regra para devolver o veículo a `available`/`in_use`. A regra completa da 0211 (documentação, OS em andamento, avaria, equipamento) não é usada por todas elas.

Legenda: **EXEC** = teste executado com evidência neste ambiente · **EST** = inspeção estática · **HIST** = resultado histórico do pacote, só como referência · **NT** = não testado.

## Ambiente e dados criados (linhas próprias)

- **Org B fictícia** `b5000000-…-00b` ("S1 Org B Ficticia"): 1 unidade gate_visual, 1 local, 1 categoria, veículos `S1B*`/`S1RL_*`/`S1CC_*` e usuários `s1adminb` (administrator) e `s1drvb` (employee).
- **Org A** (somente linhas próprias): veículos `S1SP1-6` (unidade 1, São Paulo, gate_visual), `S1CP1-3` (unidade 2, Campinas, key_custody) e `S1RL_ORGA`. Usuários: `s1fmsp` (gestor limitado à unidade 1), `s1adminnocnh` e `s1fmnocnh` (sem CNH), `s1drvok` (CNH válida), `s1drvexp` (CNH vencida) e `s1drvnull` (CNH nula). O gestor limitado à unidade 2 é o `fmcampinas`, que já existia.
- Os usuários foram criados no GoTrue local (`s1_mkusers.mjs`). Fixtures: `s1_fixture*.sql`. Todas as chamadas HTTP usam login real (`/auth/v1/token`) e PostgREST `/rest/v1`.
- **Limpeza** (`s1_cleanup_orgA.sql`, `ev_cleanup_orgA.txt`): as reservas S1 ativas na Org A foram canceladas, os veículos S1 da Org A arquivados e os 6 usuários S1 da Org A desativados (`fm_member_access`). Inspeções, eventos e auditoria **não** foram apagados. A Org B ficou intacta, com `auto_release_enabled=false`.
- O dataset das orgs existentes não foi alterado por S1. `audit_log` registra 52 `reservation.no_show_released`, todos da Org B e 0 da Org A. Os status `GWM2H62` e `GWM6T36` mudaram de available para reserved durante a sessão por ação de outro agente: os scripts S1 só tocam ids de `s1.v`/`s1.r`.
- `GET /api/cron/daily` (dispatcher) foi chamado uma vez localmente. Ele executou também o job license-reminders, que retornou `sent:0` porque não há remetente/Brevo local. Nenhum serviço externo foi chamado.

---

## 1. Permissões de `vehicles` (FM-04 / 0210)

### 1.1 Matriz SQL — `t1_vehicles_matrix.sql` → `ev_t1_vehicles_matrix.txt` (EXEC)

`SET LOCAL ROLE authenticated` + `request.jwt.claims.sub` real. São 9 atores × 3 veículos (unidade 1, unidade 2, Org B) × 23 colunas. Cada caso roda numa subtransação desfeita, e a prova de não persistência está no fim da evidência.

| Resultado | Casos |
|---|---|
| `DENIED 42501 permission denied` | 297: todas as colunas operacionais, para todos os papéis |
| `NO_EFFECT rows=0 (RLS)` | 240: fora do escopo, outra org, segurança, manutenção, empregado |
| `UPDATED` | 84: **somente** admin(A) em sp1/cp1, fmall em sp1/cp1, s1fmsp em sp1, fmcampinas em cp1 e s1adminb em b1 |

- Colunas negadas a **todos**: `status, has_blocking_damage, missing_safety_equipment, documentation_valid, current_location_id, archived_at, pre_block_status, photo_storage_path, is_clean_exterior, lifecycle_version, organization_id`.
- Colunas atualizáveis por quem está no escopo: `plate, category_id, home_location_id, name, color, vin, next_service_date, next_service_odometer_km` **e também `odometer_km, fuel_level_percent, battery_level_percent, estimated_range_km`**. Estas quatro são concedidas pela 0210 (ver S1-01).

### 1.2 HTTP PostgREST — `t1_http.mjs` → `ev_t1_http.json` (EXEC): 292/292 PASS

| ID | Cenário | Papéis | Esperado × obtido | Status |
|---|---|---|---|---|
| H1-op | PATCH `/rest/v1/vehicles` de status, has_blocking_damage, documentation_valid, missing_safety_equipment, photo_storage_path, current_location_id e archived_at em sp1/cp1/b1 | 10 atores, incluindo anon | falha sem efeito × 401/403 `42501` ou 0 linhas; estado final inalterado (`after_h1`) | PASS |
| H1-cad | PATCH `name` | idem | sucesso só no escopo × 200 com 1 linha só para admin(A: sp1,cp1), fmall(sp1,cp1), s1fmsp(sp1), fmcampinas(cp1) e s1adminb(b1) | PASS |
| H2 | RPC fora do escopo: gestor limitado à unidade 1 chamando approve, block, unblock, swap (nos dois sentidos), complete e cancel task em objetos da unidade 2; gestor limitado à unidade 2 em objetos da unidade 1; admin Org B na Org A; admin Org A na Org B; segurança, empregado e manutenção em approve/block | vários | negado sem efeito × `MANAGEMENT_SCOPE_DENIED`; `before_h2 == after_h2` nos objetos alvo | PASS |
| H2-anon | anon chamando as 6 rotinas, `fm_release_expired_reservations` e `fm_operation_exception` | anon | 401 `42501 permission denied for function` | PASS |
| H2-release | `fm_release_expired_reservations` por authenticated (empregado e admin) | lucas, admin | 403 `42501` | PASS |
| H2-pos | Controles positivos no escopo (approve, block/unblock, complete task da manutenção) | s1fmsp, fmcampinas, s1adminb, maint | 204 | PASS |
| H3 | **Foto do veículo exatamente como o app faz** (`fleet/actions.ts` → `lib/domain/immutablePhoto.ts`): `fm_photo_begin` (sessão) → upload no Storage (sessão) → download e verificação do hash → `fm_photo_attest` (**service role**, admin client) → `fm_photo_finalize(id, sha)` (sessão) | admin, fmall, s1fmsp, fmcampinas (na própria unidade), s1adminb (na Org B) | vinculada × `photo_storage_path` gravado (`linked:true`) | PASS |
| H3-neg | Mesmo fluxo fora do escopo, por outro papel ou entre orgs | fmcampinas→SP, s1fmsp→Campinas, lucas, security, maint, s1adminb→A, admin→B | negado × `NOT_AUTHORIZED` já no `fm_photo_begin` | PASS |
| H3b | Upload direto no Storage em `orgA/vehicles/<id de outro escopo>` sem passar pelo begin | lucas, fmcampinas, s1adminb | negado × Storage 403 `new row violates row-level security policy` | PASS |

**Foto da Frota (EST + EXEC):** a edição da Frota (`updateVehicle`) usa o **cliente de sessão** para o UPDATE cadastral. A foto vai por `uploadImmutablePhoto`: RPC com cliente de sessão + `fm_photo_attest` com **service role**. O vínculo `photo_storage_path` é gravado por `fm_photo_link` (SECURITY DEFINER), não por UPDATE direto. Por isso o `revoke update(photo_storage_path)` da 0210 **não regride** a foto: H3 passou para todos os papéis autorizados. Observação: a 0214 (`require_verified_photo_links`) não foi aplicada, como previsto.

### 1.3 As seis rotinas privilegiadas da 0210 (EST + EXEC)

`approve_reservation(uuid)`, `swap_reservation_vehicle(uuid,uuid)`, `complete_workflow_task(uuid)`, `cancel_workflow_task(uuid)`, `block_vehicle(uuid,text)`, `unblock_vehicle(uuid)`.

- Todas são `SECURITY DEFINER` com `search_path=public, pg_temp` (verificado em `pg_proc.proconfig`).
- ACL: `postgres`, `authenticated` e `service_role`. **anon nenhum**, executado em H2-anon. `authenticated` é necessário porque `app/dashboard/actions.ts` chama as seis com `createSupabaseServerClient` (sessão). Para `service_role` a chamada é inócua: `auth.uid()` nulo resulta em `NOT_AUTHORIZED`.
- Autorização explícita:
  - approve, swap, block e unblock: `current_user_role() in (fleet_manager, administrator)` **e** `fm_can_manage_reservation`/`fm_can_manage_vehicle`. O swap verifica também o veículo de destino.
  - complete e cancel task: `maintenance_operator` em qualquer unidade da org, ou gestor/admin no escopo do veículo. A manutenção não tem recorte por unidade, o que é o comportamento anterior, mantido.
- **Defeito encontrado nessas rotinas:** S1-06.

---

## 2. CNH e acesso administrativo — `t2_cnh_http.mjs` → `ev_t2_cnh_http.json` (EXEC)

| ID | Cenário | Papel | Esperado × obtido (inspeções/chaves/portaria antes→depois) | Status |
|---|---|---|---|---|
| C1 | Retirada (`record_pickup` traveler) com CNH vencida | s1drvexp | negado × `LICENSE_EXPIRED` (0/0/0 → 0/0/0) | PASS |
| C2 | Retirada com CNH nula | s1drvnull | `LICENSE_EXPIRED` | PASS |
| C3 | Checklist em nome do condutor de CNH vencida | fmall | `LICENSE_EXPIRED` | PASS |
| C4 | Checklist da Segurança para condutor de CNH vencida | security | `LICENSE_EXPIRED` | PASS |
| C5 | Entrega de chave para condutor de CNH vencida | custodian | `LICENSE_EXPIRED` | PASS |
| C6 | Saída física sem checklists (CNH vencida) | security | `DEPARTURE_BLOCKED` | PASS |
| C7 | Admin sem CNH retira veículo da própria reserva | s1adminnocnh | `DRIVER_NOT_AUTHORIZED` | PASS |
| C8/G2 | Controle positivo: retirada com CNH válida | s1drvok | sucesso. A 1ª tentativa falhou com `EQUIPMENT_CONFIGURATION_REQUIRED`: era fixture sem perfil de equipamentos e sem o `fm_prepare_equipment_checklist` que o app chama antes. Repetido como G2 em §5, com PASS | PASS |
| C9 | Controle positivo: entrega de chave com CNH válida | custodian | 200 | PASS |
| A1–A2 | Aprovação de reserva por admin/gestor **sem CNH** | s1adminnocnh, s1fmnocnh | 204 | PASS |
| A3 | Bloqueio de veículo por admin sem CNH | s1adminnocnh | 204 | PASS |
| A4–A5 | `list_member_licenses` e `fm_key_management_workspace` | sem CNH | 200 | PASS |
| A6–A9 | Leitura de audit_log, reservations, vehicles e fm_work_orders | sem CNH | 200 com linhas | PASS |
| A10 | Edição cadastral do veículo | s1adminnocnh | 200 com 1 linha | PASS |
| F1–F2 | Motorista altera a própria validade de CNH (PATCH profiles) | s1drvok, s1drvexp | 403 `42501`; validade inalterada | PASS |
| F3–F4 | `apply_ai_license_read` e `reset_ai_license` direto | empregado, admin, anon | `42501 permission denied` (ACL só postgres/service_role) | PASS |

- **EST:** o trigger `profiles_license_lock_trg` está presente (BEFORE UPDATE OF license fields) e exige `app.license_ai_write=1`, que só é definido em `apply_ai_license_read`/`reset_ai_license` (somente service_role).
- **EST:** no app, `shellData.ts` só ativa o `licenseGateActive` quando o papel **não** é fleet_manager, administrator, maintenance_operator ou security. Admin/gestor sem CNH acessa as telas.
- **NT:** navegação nas telas como admin sem CNH (o UI fica com S2/visual).

---

## 3. Liberação de vencidas (FM-01 / 0213)

### 3.1 Camadas e fronteiras — `t3_release.sql` → `ev_t3_release.txt` (EXEC, como `service_role`)

| ID | Cenário | Esperado × obtido | Status |
|---|---|---|---|
| A1/A2/A3 | `auto_release_enabled=false` nas duas orgs (Org B com 14 vencidas, Org A com `rl_orga` vencida). Chamadas `release(orgB)` e `release()` global | 0 cancelamentos × `released:0`; 0 linhas alteradas | PASS |
| PERM | `SET ROLE anon`/`authenticated` | negado × `permission denied`; ACL `{postgres, service_role}`, `lock_timeout=2s`, `search_path=public, pg_temp` | PASS |
| B1 | Ligado **só** na Org B, tolerância 60 | `released:11`, `vehicles_released:2`, `skipped_with_activity:3` | PASS |
| B-front | Fim −59 min × −61 min | −59 permanece confirmada; −61 vira cancelled `no_show_auto` e o veículo fica available | PASS |
| B-ativ | Reserva com inspeção, com evento de portaria (`denied`) ou com evento de chave (`exception`) | não liberadas; contadas em `skipped_with_activity=3` | PASS |
| B-pend | Pendente vencida | cancelled `expired_unapproved`; veículo não alterado | PASS |
| B-intocado | Veículo em in_use, returning, blocked ou maintenance | reserva cancelada; **status do veículo intocado** | PASS |
| B-outra | Veículo com outra confirmada futura | reserva liberada; veículo permanece reserved | PASS |
| B-inseguro | Avaria bloqueante, doc irregular, OS em andamento | **não** volta a available. Porém fica `reserved` **sem nenhuma reserva ativa** → S1-02 | PASS / defeito S1-02 |
| B2 | Idempotência (2ª chamada) | `released:0`; 1 auditoria e 1 notificação por reserva | PASS |
| B3 | Chamada global com Org A desligada | `rl_orga` intacta; 0 `no_show_released` na Org A | PASS |
| C1 | Tolerância 0: fim −1 min × +5 min | −1 liberada, +5 não | PASS |
| D1 | Tolerância 1440: fim −1439 × −1441 min | −1439 não, −1441 liberada | PASS |
| T3b | Mesma chamada da rota com flag ligada: PostgREST `/rpc/fm_release_expired_reservations` com chave service role (`ev_t3b_http_service.json`) | 200, `released:1`; 2ª chamada `released:0` | PASS |

### 3.2 Rota cron e flag de servidor (EXEC)

- `curl` em `http://localhost:3100/api/cron/reservation-expiry`:
  - sem header: **401**;
  - Bearer errado: **401**;
  - `CRON_SECRET` local correto: **200 `{"released":0,"skipped":"disabled_by_policy"}`**. `FM_ENABLE_AUTO_RESERVATION_RELEASE` está ausente em `.env.local`, que não foi editado.
- O dispatcher `/api/cron/daily` também retornou `reservation-expiry: disabled_by_policy`.
- O estado "flag de servidor **ligada**" não foi exercitado pela rota real, porque exigiria editar `.env.local`. Foi coberto por vitest + T3b. Vitest (EXEC): `reservation-expiry.test.ts`, `cron-auth.test.ts`, `daily-dispatcher.test.ts`, `noShowRelease.test.ts` e `trips/new/actions.test.ts`, com **57/57 PASS**. Esses testes cobrem flag `true` (RPC chamada), `false`/ausente (RPC não chamada) e segredo ausente ou errado.

### 3.3 Concorrência real — `t3c_concurrency.mjs` → `ev_t3c_concurrency.json`, `t3d_concurrency_release.mjs` → `ev_t3d_concurrency_release.json` (EXEC)

Sessões `psql` paralelas sincronizadas por `pg_sleep` até um instante comum. Cada iteração usa uma reserva e um veículo novos.

| Variante | Sessões paralelas | Iterações | 40P01 | Inconsistências | Dupla liberação/cancelamento | Desfechos |
|---|---|---|---|---|---|---|
| pendente vencida | release, approve, cancel, pickup | 30 | 0 | 0 | 0 | 25 cancel do usuário, 5 `expired_unapproved` |
| confirmada vencida | release, exception, cancel, pickup, approve | 30 | 0 | 0 | 0 | 27 exceção, 3 cancel do usuário |
| pendente vencida (sem cancel) | release, approve, pickup | 30 | 0 | 0 | 0 | 22 confirmed+reserved, 5 `expired_unapproved`, 3 `no_show_auto`; release com `skipped_locked=22` |
| confirmada vencida (sem exception) | release, cancel, pickup, approve | 30 | 0 | 0 | 0 | 29 cancel do usuário, 1 `no_show_auto` |

- Invariantes verificados a cada iteração:
  - cancelada ⇒ exatamente 1 registro de cancelamento (`no_show_released` + `operation.exception` + `reservation_cancelled` = 1) e veículo available;
  - confirmada ⇒ veículo reserved;
  - pendente ⇒ veículo available.
- A variante "pendente sem cancel" mostrou que `approve_reservation` aprova uma solicitação **já vencida** (S1-03).

### 3.4 Adjacente

`cancel_reservation` devolve a available um veículo inseguro: S1-04 (`t3f_cancel_unsafe.sql`).

---

## 4. Saída impedida após início (FM-03 / 0211) — `t4_exception_http.mjs` → `ev_t4_exception_http.json` (EXEC, 24/24 PASS)

O snapshot antes e depois cobre: status da reserva, status do veículo, `fm_gate_events`, `inspections` e `fm_key_events` (da reserva **e** do veículo), além de `fm_operation_exceptions` e da auditoria.

| ID | Cenário | Papel | Obtido | Status |
|---|---|---|---|---|
| E1 | Gestor de outra unidade | fmcampinas | `NOT_AUTHORIZED`, sem efeito | PASS |
| E2 | Empregado sem autoridade | lucas | `NOT_AUTHORIZED` | PASS |
| E3 | Org B | s1adminb | `NOT_FOUND` | PASS |
| E4 | Solicitante que é admin | s1adminnocnh | `INDEPENDENT_ACTOR_REQUIRED` | PASS |
| E5 | Solicitante empregado | s1drvok | `NOT_AUTHORIZED` | PASS |
| E6/E7 | `departed_unrecorded` por gestor / pela Segurança antes do fim | s1fmsp / security | `NOT_AUTHORIZED` / `EXCEPTION_NOT_REQUIRED`. Não se confunde com `not_departed` | PASS |
| E8 | Motivo curto | s1fmsp | `INVALID_INPUT` | PASS |
| E9 | Veículo **com saída física** registrada | s1fmsp | `PHYSICAL_DEPARTURE_ALREADY_RECORDED`, sem efeito | PASS |
| E10 | Gestor autorizado da unidade (limitado a SP) encerra como `not_departed` | s1fmsp | 200. `confirmed;reserved;gate=0;insp=0;keys=0` → `cancelled;available;gate=0;insp=0;keys=0;exc=1;audit=1`. Contadores do veículo inalterados: **nenhuma saída, chegada, devolução ou chave fictícia criada**. `gate_event_id=null`, 1 receipt, 1 notificação | PASS |
| E11 | Retry com o **mesmo** request_id | s1fmsp | mesmo corpo de resposta; nada duplicado | PASS |
| E12 | Mesmo request_id com payload diferente | s1fmsp | `IDEMPOTENCY_CONFLICT` | PASS |
| E13 | Novo request_id após encerramento | s1fmsp | `RESERVATION_NOT_CONFIRMED` | PASS |
| E14 | Documentação irregular | s1adminb | veículo → **blocked** | PASS |
| E15 | OS em andamento | s1adminb | → **maintenance** | PASS |
| E16 | Avaria bloqueante | s1adminb | → **maintenance** | PASS |
| E17 | Veículo seguro (controle) | s1adminb | → available | PASS |
| E18 | Campinas com chave entregue e não devolvida | fmcampinas | `KEYS_OUTSTANDING` | PASS |
| E19 | `departed_unrecorded` em unidade de chaves | security | `OFFICE_HAS_NO_GATE` | PASS |
| E20 | Gestor SP na reserva de Campinas | s1fmsp | `NOT_AUTHORIZED` | PASS |
| E21 | Gestor Campinas após devolução da chave | fmcampinas | 200; veículo segue reserved (há outra confirmada futura); keys=2, insp=0, gate=0 | PASS |

Histórico: a primeira execução (`ev_t4_exception_http_run1_snapshot_truncado.json`) teve snapshot truncado por bug do script (separador `|`). Foi refeita com reservas novas (`s1_fixture5b_exception_rerun.sql`). Os resultados válidos são os da tabela.

---

## 5. Fluxos operacionais — `t5_flows_http.mjs`, `t5b_followup.mjs`, `t5c_secreturn.mjs` (EXEC)

| ID | Cenário | Papel | Obtido | Status |
|---|---|---|---|---|
| G1–G2 | SP: checklist do solicitante | s1drvok | 200 | PASS |
| G3 | Saída sem o checklist da Segurança | security | `CHECKLIST_REQUIRED` | PASS |
| G4–G5 | Gestor/admin registram checklist **como Segurança** | fmall, admin | `INSPECTION_NOT_AUTHORIZED` | PASS |
| G6 | Checklist independente da Segurança | security | 200 | PASS |
| G7–G10 | Saída física por gestor, admin, condutor ou manutenção | — | `NOT_AUTHORIZED` | PASS |
| G11 | Saída física pela Segurança | security | 200 → in_use | PASS |
| G12b | Devolução do condutor | s1drvok | 200. A 1ª tentativa sem local deu `INVALID_CURRENT_LOCATION`, que é validação correta do script | PASS |
| G13–G14 | Chegada física por gestor/admin | — | `NOT_AUTHORIZED` | PASS |
| G15 | Chegada física pela Segurança | security | 200 → returning | PASS |
| G16 | Checklist de devolução como Segurança por gestor/admin; depois pela Segurança | fmall, admin, security | `INSPECTION_NOT_AUTHORIZED` ×2; Segurança 200 → reserva completed, veículo available | PASS |
| B1 | Checklist em nome do condutor (0198) por gestor de **outra** unidade | fmcampinas | `NOT_AUTHORIZED` | PASS |
| B2–B4 | Gestor da unidade registra o checklist do condutor em nome dele; depois a Segurança | s1fmsp, security | 200 | PASS |
| B5–B6 | Saída física pelo gestor × pela Segurança | — | gestor `NOT_AUTHORIZED`; Segurança 200 | PASS |
| K1 | Campinas: portaria em unidade de chaves | security | `DEPARTURE_BLOCKED` (OFFICE_HAS_NO_GATE na exceção) | PASS |
| K2–K3 | Gestor/admin não custodiantes entregam ou recebem chave | — | `KEY_CUSTODY_NOT_AUTHORIZED` | PASS |
| K4 | Checklist "security" em unidade de chaves | s1drvok | `OFFICE_DRIVER_CHECKLIST_ONLY` | PASS |
| C9, K5–K6 | Entrega **real** pelo custodiante, depois retirada digital | custodian, s1drvok | 200 → in_use | PASS |
| K8 | Condutor registra recebimento da própria chave | s1drvok | `KEY_CUSTODY_NOT_AUTHORIZED` | PASS |
| K9, K7b | Recebimento real pelo custodiante + devolução | — | 200 → reserva completed, veículo available | PASS |
| D2 | Avaria: checklist com avaria (feito pelo gestor em nome do condutor) | s1fmsp | retenção ativa; tarefa repair criada | PASS |
| D4 | Saída com avaria | security | `DEPARTURE_BLOCKED` | PASS |
| D5–D6 | PATCH direto da tarefa repair para done | condutor, gestor de outra unidade | 0 linhas | PASS |
| D7 | Concluir a tarefa por RPC sem escopo | fmcampinas | `MANAGEMENT_SCOPE_DENIED` | PASS |
| D8 | **Quem registrou a avaria** tenta liberá-la | s1fmsp | `DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED` | PASS |
| D9 | Segurança tenta liberar | security | `MANAGEMENT_SCOPE_DENIED` | PASS |
| D10 | Gestor independente conclui o reparo | fmall | 204; `has_blocking_damage=false`; auditoria `vehicle.damage_hold_released` com ator fmall | PASS |
| P1–P2 | Leitura de `fm_work_orders` e `fm_work_order_lines` | lucas, s1drvok, security | 200 com **0 linhas** | PASS |
| P3 | `fm_availability_windows` | idem | 200; colunas **somente** `vehicle_id, start_at, end_at, kind`; janelas de manutenção sem orçamento nem descrição | PASS |
| P4 | Leitura de `workflow_tasks.notes` | idem | 200; **notas internas visíveis** (ex.: "Revisão dos 40.000 km em andamento na autorizada", "Avaria no para-choque…") → S1-07 | INFO / S1-07 |
| T5d | Campinas: veículo com **documentação irregular** — a chave é entregue e a viagem iniciada (`t5d_keycustody_invalid_doc.sql`, rollback) | custodian, s1drvok | **sucesso, veículo in_use** → S1-05 | FAIL → S1-05 |
| T5e | Empregado insere tarefa direto em `workflow_tasks` (`t5e_employee_task_insert.sql`, rollback) | s1drvb | **inserido** (repair open e cleaning done) → S1-08 | FAIL → S1-08 |

---

## 6. Defeitos e decisões

### S1-01 — DECISÃO / P2 — gestor no escopo pode reduzir hodômetro e alterar nível de energia por UPDATE direto, sem auditoria

- **Reprodução:** `t1b_odometer.sql` (rollback). Como `s1fmsp`, `update public.vehicles set odometer_km=0, fuel_level_percent=100, battery_level_percent=100, estimated_range_km=9999 where id='5a000000-…-0001'` resulta em `UPDATE 1` e 0 linhas de audit_log. O mesmo vale via PostgREST `PATCH /rest/v1/vehicles` (matriz 1.1).
- **Causa:** a 0210 concede `UPDATE(odometer_km, fuel_level_percent, battery_level_percent, estimated_range_km)` a authenticated, de propósito, para manter o `updateVehicle` da Frota. O form valida só `odometer>=0`. Isso contraria o brief, que pede que essas colunas operacionais falhem, e anula a garantia `ODOMETER_CANNOT_GO_BACKWARDS` das retiradas.
- **Correção proposta:** mover essas colunas para um RPC cadastral (`fm_management_update_vehicle`) com hodômetro monotônico, ou correção para baixo só com motivo + auditoria, e auditoria de nível de energia. Depois, revogar essas 4 colunas. **Exige decisão do dono:** o form da Frota edita esses campos hoje.

### S1-02 — P2 — liberação automática deixa veículo inseguro como `reserved` sem reserva ativa

- **Reprodução:** `t3_release.sql`, fase B, consulta "CHECAGEM DE CONSISTENCIA": `S1RL_DMG`, `S1RL_DOC` e `S1RL_WO` ficam `reserved` com `confirmed_left=0` depois de `fm_release_expired_reservations`.
- **Causa:** em 0213, o ramo de restauração só faz `update … set status='available' … and <seguro>`. Quando o veículo não é seguro, nada muda e o status antigo (`reserved`/`awaiting_pickup`) é preservado. A 0211 (`fm_operation_exception`) faz isso corretamente com `blocked`/`maintenance`.
- **Impacto:** veículo "fantasma" reservado. A Frota mostra reservado e a regularização exige bloqueio manual. Correto quanto à regra "não volta a available", inconsistente quanto ao estado.
- **Correção:** reutilizar o mesmo `CASE` da 0211: doc irregular → `blocked`; OS `in_progress`/`partial`, avaria ou equipamento faltante → `maintenance`; outra confirmada → `reserved`; senão `available`. Idealmente num helper único `fm_vehicle_release_status(vehicle_id)` (ver S1-04/05/06).

### S1-03 — P3 — `approve_reservation` aprova solicitação cuja janela já terminou

- **Reprodução:** `t3e_approve_expired.sql` (rollback). Pendente com `end_at = now()-2 dias`, aprovada por `s1adminb`, termina `confirmed` com veículo `reserved` e `auto_release=false`. Confirmado também na concorrência T3d (22/30 iterações).
- **Causa:** a 0210 recriou o corpo e só acrescentou os guardas de papel e escopo. Não há verificação de `end_at > now()`.
- **Impacto:** com a liberação desligada (padrão), o veículo fica reservado para uma janela passada até intervenção manual.
- **Correção:** depois do `FOR UPDATE`, `if v_end_at <= now() then raise exception 'RESERVATION_EXPIRED'`.

### S1-04 — P2 — `cancel_reservation` devolve a `available` veículo com documentação irregular ou avaria bloqueante

- **Reprodução:** `t3f_cancel_unsafe.sql` (rollback). O solicitante cancela reservas confirmadas de `S1CX_DOC` (doc=false) e `S1CX_DMG` (avaria=true) e ambos ficam **available**.
- **Causa:** `cancel_reservation` restaura `available` só por contagem de outras confirmadas, sem a regra de segurança da 0211/0213. Rotina anterior ao pacote, não alterada por ele.
- **Correção:** usar o helper único de status seguro (S1-02).

### S1-05 — P2 — unidade de chaves não verifica `documentation_valid` na entrega de chave nem na retirada

- **Reprodução:** `t5d_keycustody_invalid_doc.sql` (rollback). Veículo de Campinas com `documentation_valid=false`: `fm_key_command('delivered')` retorna OK e `record_pickup` deixa o veículo **in_use**. Em São Paulo a saída é barrada com `DEPARTURE_BLOCKED`.
- **Causa:** `fm_key_command` testa só status, avaria e equipamento; `fm_gate_record_pickup` testa só status.
- **Correção:** incluir `or not v_vehicle.documentation_valid` em `VEHICLE_NOT_READY` nas duas rotinas.
- **Severidade:** P2 porque, após a 0210, nenhuma rotina do app grava `documentation_valid`. O caso só ocorre com dados legados ou de carga.
- **Decisão associada:** sem rotina para regularizar documentação, um veículo como `GWM3B52` (blocked, doc=false) **não pode ser desbloqueado pelo app**, porque o `unblock_vehicle` exige doc válida (0204). Falta um comando auditado de documentação.

### S1-06 — P2 — `complete_workflow_task`/`cancel_workflow_task` (0210) devolvem a `available` veículo com documentação irregular e zeram `has_blocking_damage` sem a checagem de independência

- **Reprodução:** `t1c_complete_task_unsafe.sql` (rollback). Veículo em `maintenance` com doc=false e uma tarefa repair; `complete_workflow_task` como `s1adminb` deixa o veículo **available** com doc=false.
- **Causa:** o ramo final faz `set status='available', has_blocking_damage=false` sem testar documentação, equipamento ou OS aberta. Com o veículo em `maintenance`, o `fm_release_damage_hold` (0205) retorna cedo ("complete/cancel decidem"), então a regra de **ator independente** da 0205 não se aplica nesse caminho (EST).
- **Correção:** usar o helper de status seguro e liberar a avaria só via `fm_release_damage_hold` com a checagem de independência.

### S1-07 — P3 — passageiro/condutor lê `workflow_tasks.notes` (descrição interna de manutenção/avaria)

- **Reprodução:** `t5_flows_http.mjs` P4. `GET /rest/v1/workflow_tasks?select=notes` como lucas/s1drvok retorna 200 com notas internas.
- **Causa:** a policy `members read own organization workflow tasks` libera SELECT para qualquer membro da org.
- **Correção:** restringir `notes` a gestor/admin/manutenção, via view ou policy por papel, e expor ao condutor só tipo e status. Rotina anterior ao pacote.

### S1-08 — P3 — empregado insere `workflow_tasks` arbitrárias

- **Reprodução:** `t5e_employee_task_insert.sql` (rollback). Como `s1drvb`, `insert into workflow_tasks(…,'repair','open',…)` e `(…'cleaning','done',…)` são aceitos.
- **Causa:** a policy permissiva `system creates workflow tasks from inspections` (INSERT com check só de org) + `GRANT INSERT`.
- **Impacto:** uma tarefa `repair` aberta impede a liberação de avaria e mantém o veículo em manutenção; também permite histórico falso.
- **Correção:** revogar o INSERT direto de authenticated; as tarefas devem nascer só das rotinas (record_pickup/return, block_vehicle, RPC de gestão). Rotina anterior ao pacote.

---

## 7. O que NÃO foi testado (NT) e por quê

- **Supabase remoto, pooler (PgBouncer/Supavisor transaction mode) e Realtime:** não testados por regra (somente local). A concorrência foi executada em conexões diretas ao Postgres local. O comportamento de `SET LOCAL`/`request.jwt.claims` sob pooler e a propagação Realtime de status de veículo **dependem do remoto**.
- **Cron em produção (Vercel) e a rota real com `FM_ENABLE_AUTO_RESERVATION_RELEASE=true`:** cobertos só por vitest e pela chamada service_role equivalente (T3b), porque `.env.local` não pode ser editado.
- **Telas (UI) como admin sem CNH, Frota e upload de foto pelo navegador:** cobertos por HTTP e RPC equivalentes ao server action, não pelo browser (escopo de outros agentes).
- **0214:** não aplicada, conforme o roteiro.
- **Cenários de foto adversos** (409/retry, adulteração, sessão expirada): fora do brief S1.

## 8. Resultados históricos usados só como referência (HIST)

- Pacote `docs/conclusao/TESTES.md`: os testes SQL do pacote rodaram em **PGlite 0.3.14**. O próprio pacote declara não ter testado "concorrência multiconexão" nem "Supabase remoto". Este relatório cobre a concorrência em Postgres real local.
- `lib/operations/*.test.ts` (PGlite) serviu como referência de fixtures. Neste ambiente foi reexecutado apenas `noShowRelease.test.ts`, com 11/11 PASS dentro dos 57/57 da §3.2.

## 9. Arquivos (todos em `C:\projects\_homolog\conclusao\S1`)

- **Fixtures:** `s1_mkusers.mjs`, `s1_fixture.sql`, `s1_fixture2_rpc.sql`, `s1_fixture3_cnh.sql`, `s1_fixture4_equipment.sql`, `s1_fixture5_exception.sql`, `s1_fixture5b_exception_rerun.sql`, `s1_fixture6_release.sql`, `s1_cleanup_orgA.sql`.
- **Harness:** `s1_lib.mjs`.
- **Testes:** `t1_vehicles_matrix.sql`, `t1_http.mjs`, `t1b_odometer.sql`, `t1c_complete_task_unsafe.sql`, `t2_cnh_http.mjs`, `t3_release.sql`, `t3b_http_service.mjs`, `t3c_concurrency.mjs`, `t3d_concurrency_release.mjs`, `t3e_approve_expired.sql`, `t3f_cancel_unsafe.sql`, `t4_exception_http.mjs`, `t5_flows_http.mjs`, `t5b_followup.mjs`, `t5c_secreturn.mjs`, `t5d_keycustody_invalid_doc.sql`, `t5e_employee_task_insert.sql`.
- **Evidências:** `ev_*.txt` / `ev_*.json`, uma por teste.
- **Para reexecutar os .mjs:** `node <script> <env.txt> <creds.json>`. O `env.txt` sai de `supabase status -o env --workdir C:\projects\_homolog`; o `creds.json` sai de `s1_mkusers.mjs`. Antes, reativar os usuários S1 com o SQL comentado no fim de `s1_cleanup_orgA.sql`.
