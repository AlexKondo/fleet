# T1: banco e permissões do delta consolidado (Postgres/PostgREST reais, LOCAL)

Agente T1, 22/10/2026. Worktree `C:\projects\fleet\_local\fleet-integ`, branch `integracao-consolidado-2026-10-22`, commit **d9d5fc2**.

**Ambiente.** Banco LOCAL `supabase_db_fleet-homolog`, migrations aplicadas de 0001 a 0227. As migrations 0217–0227 desse banco são idênticas às do worktree (`cmp`). A API usada é http://127.0.0.1:55321 e o app é http://localhost:3100, ambos locais.

**O que não foi feito.** Não houve acesso a produção nem a hosts remotos. Nenhum código-fonte ou migration foi editado. Não houve `git write`. Nenhuma chave, senha ou token foi impresso: as credenciais T1 foram geradas ao acaso e ficaram só no scratchpad da sessão.

**Legenda.** **EXEC** é um teste executado nesta sessão, com evidência nesta pasta. **EST** é uma inspeção estática do código ou do SQL. **HIST** é um resultado histórico de outro agente ou pacote, citado só como contexto. **NT** é algo não testado.

## Resumo

| Bloco | Resultado (EXEC) | Defeitos |
|---|---|---|
| 1. Liberação de vencidas ATIVA (0217+0213+0215) | **PASS** em todos os pontos abaixo. Política, script Node e cron conferem. | — (O1, O2) |
| 2. Tarefas (0218/0225/0226) | **PASS**: matriz de 19 papéis × 9 operações, mais anon, atribuição auditada, conclusão e aprovação vencida | — (O3) |
| 3. Medições (0220/0223) | **PASS**: 22 casos de comando, matriz de 19 × 7 de UPDATE direto e privilégios de coluna | — (O7) |
| 4. Exceção (0222/0211) | Rótulo, isolamento, ausência de linhas fictícias e custódia: **PASS**. Motivo interno: **FAIL** | **T1-D01 (P2)** |
| 5. Fotos (0219/0221/0224/0227/0216) | **PASS** em 45 verificações. A concorrência restart × atestação tem 30 iterações sem inconsistência | **T1-D02 (P3/decisão)** |
| 6. CNH e acesso | **PASS** (detalhe abaixo) | — (O4, O5, O6) |
| 7. Regressão 0210, isolamento e fluxos | **PASS** (detalhe abaixo) | — |

- **Bloco 1.** Passaram:
  - default ativo sem linha de settings e com settings default;
  - opt-out;
  - atividade;
  - checagem segura;
  - idempotência;
  - tolerâncias 0, 60 e 1440;
  - 180 iterações concorrentes, sem 40P01 e sem inconsistência;
  - execução só por service_role;
  - o SQL de política e o script Node;
  - a rota do cron: 401 sem segredo e 200 ativa com o segredo.
- **Bloco 6.** Ficam barrados retirada, chave e saída quando a CNH está vencida ou NULL, inclusive quando ela vence entre o checklist e a saída. Ficam liberados os atos administrativos, as consultas e o pedido de carona como passageiro sem CNH. O antifraude está intacto e a conta desativada fica sem acesso.
- **Bloco 7.** Passaram:
  - 495 PATCHs operacionais negados;
  - o cadastro só no escopo;
  - 16 RPCs fora do escopo, sem efeito;
  - anon sem acesso;
  - os fluxos de São Paulo (dois checklists e a portaria só pela Segurança), Campinas e Rio (chaves reais);
  - a avaria, só pelo comando auditado e por um ator independente;
  - a OS sem orçamento para passageiro ou condutor.

Não houve P0 nem P1. Há 1 P2 (T1-D01) e 1 P3/decisão (T1-D02), além de 7 observações. As 9 falhas brutas do `ev_c6c7_http.json` foram analisadas e só 2 são defeitos reais (C4-H1 e C4-H2, ambas T1-D01). As outras 7 se dividem assim:

- **Entrada de teste errada (3).** A devolução exige `p_current_location_id`, que o app envia; G12/K7/R7 foram refeitos com o local e passaram (`ev_c6c7_followup.json`).
- **Expectativa errada (1).** C6-19: `t1emp` não tinha solicitações próprias, então 0 linhas era o resultado correto.
- **Caminho legado (3).** C6-18 usa `create_carpool_participation`, que falha para qualquer empregado, inclusive com CNH válida. Isso não tem relação com CNH (O4). O caminho canônico do app para pedir carona passou para os passageiros sem CNH (`ev_c6_ride_request.json`).

## Ambiente e dados criados (somente linhas próprias)

- **Org T1A** `7a000000-…-00a`, sem linha em `organization_settings`, de propósito, para testar o default implícito. Tem 3 unidades:
  - São Paulo (`gate_visual`);
  - Campinas (`key_custody`, custodiante `t1custcp`);
  - Rio (`key_custody`, custodiante `t1custrj`).
- **Org T1B** `7b000000-…-00b`: tem linha default de settings e 1 unidade `gate_visual`.
- **19 usuários no GoTrue local** (`t1_mkusers.mjs`), com login real em `/auth/v1/token` nos testes HTTP:
  - **Administradores:** `t1admin` e `t1adminnocnh`.
  - **Gestores:** `t1fmall` (todas as unidades), `t1fmsp` (só SP), `t1fmcp` (só Campinas) e `t1fmnocnh` (todas as unidades, sem CNH).
  - **Operação:** `t1sec` (Segurança), `t1maint` (manutenção), `t1custcp` e `t1custrj` (custodiantes).
  - **Empregados:** `t1drvok` (CNH válida), `t1drvexp` (vencida), `t1drvnull` (nula), `t1emp` (sem CNH, não autorizado), `t1deact` (conta desativada) e `t1req2`.
  - **Org B:** `t1adminb`, `t1drvb` e `t1secb`.
- **Fixtures:** `t1_fixture.sql`, `t1_c1_release_fixture.sql` e `t1_c6c7_fixture.sql`. Os helpers ficam no schema `t1`. Os testes SQL usam `SET LOCAL ROLE authenticated` com `request.jwt.claims` de `sub` real (`t1.as_user`). Os testes HTTP usam PostgREST `/rest/v1` com JWT real.
- **Estado final:**
  - A Org T1B voltou a `auto_release_enabled=true`, com tolerância de 60.
  - O opt-out e as tolerâncias 0 e 1440 foram testados em transações desfeitas.
  - `t1req2` ficou com CNH vencida, mudança feita pelo teste C6-08.
  - `t1custrj` ficou com a origem da CNH marcada como `ai`.
  - Nenhuma linha de outras organizações foi alterada.
- **Antes do cron.** Antes de chamar a rota do cron, que roda com `p_organization_id` nulo, conferi os candidatos em todo o banco. O único era a reserva T1 `rl_g59` (`ev_c1_cron.json`). Aurora e "Org B (ficticia, local)" tinham 0 candidatos.

---

## 1. Liberação de vencidas ATIVA (0217 + 0213 + 0215): EXEC

As evidências estão em `ev_c1_release_fixture.txt`, `ev_c1_release_run.txt`, `ev_c1_concurrency.json`, `ev_c1_concurrency_final.txt`, `ev_c1_policy_check.txt`, `ev_c1_policy_check_final.txt` e `ev_c1_cron.json`. A atividade das reservas foi gerada pelos comandos reais (`record_pickup`, `gate.record denied` pela Segurança e `fm_key_command delivered` pelo custodiante). Depois, o horário foi deslocado para o passado.

| ID | Cenário | Esperado × obtido | Status |
|---|---|---|---|
| C1-00 | Default da coluna e estados das orgs | `column_default=true`. T1A sem settings e T1B com `true`/60 | PASS |
| C1-01 | Quem executa `fm_release_expired_reservations` | authenticated (admin, gestor) recebe `42501`; anon recebe `42501`; o privilégio é só de service_role. Via HTTP: admin/gestor 403 e anon 401 (C7-03/C7-05) | PASS |
| C1-02a | Org **sem linha de settings**, confirmada vencida há 3h e veículo seguro | cancelada `no_show_auto`, veículo `available`, 1 auditoria e 1 notificação | PASS |
| C1-02b | Pendente vencida | `expired_unapproved` e veículo continua `available` | PASS |
| C1-02c | Com **inspeção**, **portaria (denied)** ou **chave (delivered)** | NÃO canceladas. `skipped_with_activity=3` | PASS |
| C1-02d | Documentação irregular, avaria bloqueante, falta de equipamento, OS em andamento | canceladas, com veículo `blocked`, `maintenance`, `maintenance` e `maintenance`, nunca `available` | PASS |
| C1-02e | Outra reserva confirmada futura no mesmo veículo | vencida cancelada e veículo continua `reserved` | PASS |
| C1-02f | Tolerância 60 (default): fim há 59 min e há 61 min | 59 min fica confirmada; 61 min é cancelada | PASS |
| C1-02g | Reserva futura | intocada | PASS |
| C1-03 | Idempotência (2ª e 3ª execução) | `released=0` e 8 auditorias no total, sem duplicar notificação | PASS |
| C1-04 | Isolamento por `p_organization_id` | a execução da T1A não tocou a T1B | PASS |
| C1-05 | Org **com linha default** (T1B) | liberada, veículo `available` | PASS |
| C1-06 | **Opt-out explícito** `auto_release_enabled=false` | `released=0`, reserva continua confirmada (transação desfeita) | PASS |
| C1-07 | Tolerância **0** (fim há 1 min) e **1440** (fim há 23h e há 25h) | 0 cancela; 1440: 23h fica e 25h cancela | PASS |
| C1-08 | **Concorrência real** com psql paralelos e início sincronizado, 6 cenários × 30 = **180 iterações** | **0 × 40P01**, 0 inconsistências, 0 auditorias duplicadas, 0 liberações com atividade, 0 canceladas sem veículo disponível | PASS |
| C1-09 | `check-auto-release-policy.sql` (somente leitura), no início e no fim | `all_explicit_settings_enabled=t` e `new_settings_default_enabled=t` | PASS |
| C1-10 | `node scripts/check-auto-release-policy.mjs` com o ambiente efetivo local | Variável ausente em `apps/web/.env.local` e no ambiente Process/User/Machine: "active", exit 0. `=true`: exit 0. Controle `=false`: "NO-GO", exit 1. `node --test`: 4/4 | PASS |
| C1-11 | Rota `/api/cron/reservation-expiry` (CRON_SECRET lido de `.env.local` sem imprimir) | sem header 401; segredo errado 401; Bearer vazio 401; com segredo **200** `{"released":1,…}`; 2ª chamada `released:0` | PASS |

Os 6 cenários de C1-08 são:

- `pending_expired` e `confirmed_expired`: aprovação × cancelamento × retirada × liberação;
- `pending_boundary` e `confirmed_boundary`: tolerância 0, com fim no instante sincronizado ±30 ms;
- as duas variantes de fronteira sem cancelamento do usuário.

Os desfechos de C1-08 estão em `ev_c1_concurrency.json`. Em resumo:

- A aprovação de pedido vencido foi sempre recusada (`RESERVATION_EXPIRED`).
- Na fronteira, as reservas com retirada nunca foram liberadas.
- A varredura final não deixou pendências.

## 2. Tarefas (0218, 0225, 0226): EXEC

A evidência está em `ev_c2_tasks.txt` (SQL) e nos itens C2-H* de `ev_c6c7_http.json` (HTTP).

| ID | Cenário | Esperado × obtido | Status |
|---|---|---|---|
| C2-01 | Privilégios de tabela pós-CONTRACT | authenticated tem só SELECT, sem INSERT/UPDATE/DELETE e sem grant de coluna para escrita. anon não tem nada | PASS |
| C2-02a | Leitura de `notes` por papel | Empregados (condutor, passageiro, custodiante, desativado), Segurança e Org B não leem tarefa SP nem CP (0 linhas). fmsp lê só SP, fmcp lê só CP, fmall/admin leem ambas, adminB lê só a Org B. Manutenção lê a org toda (O3) | PASS |
| C2-02b | INSERT, UPDATE (status, assigned_to, notes) e DELETE diretos, 19 atores | todos `42501 permission denied`; estado das tarefas inalterado | PASS |
| C2-02c | anon SELECT/UPDATE/INSERT | `42501` | PASS |
| C2-H1..H4 | O mesmo via HTTP | notas: 0 linhas para condutor, empregado, Segurança, custodiante e gestor de outra unidade; POST e PATCH: 403 | PASS |
| C2-03 | `fm_claim_workflow_task` | empregado, Segurança e desativado: `NOT_AUTHORIZED`. fmcp em SP e adminB: `MANAGEMENT_SCOPE_DENIED`. fmsp em SP: OK, com auditoria `workflow_task.claimed actor=t1fmsp`. Já atribuída: `CONCURRENT_UPDATE`. maint e admin: OK, com auditoria | PASS |
| C2-04 | `complete_workflow_task` preservado | empregado e fmcp fora do escopo negados; fmsp conclui (`done`, `resolved_at`) | PASS |
| C2-05 | Aprovação de pedido vencido (0218) | fmsp e admin: `RESERVATION_EXPIRED`. Pedido no prazo: fmcp fora do escopo negado, fmsp OK (`confirmed`/`reserved`) | PASS |
| D1–D11 | Avaria independente (0205/0215), em C7 | ver seção 7 | PASS |

## 3. Medições (0220, 0223): EXEC

A evidência está em `ev_c3_measurements.txt`.

| ID | Cenário | Esperado × obtido | Status |
|---|---|---|---|
| C3-01 | Privilégios de coluna | `odometer_km`, `fuel_level_percent`, `battery_level_percent` e `estimated_range_km` sem UPDATE para authenticated. O cadastro (`plate`, `category_id`, `name`, `color`, `vin`, `next_service_*`, `home_location_id`) continua permitido | PASS |
| C3-02a | Alteração válida (fmsp em SP) | OK, com auditoria `vehicle.measurements_updated` de antes/depois | PASS |
| C3-02b | **Redução sem justificativa**: nula, vazia (como o app envia) e com 2 caracteres | `ODOMETER_CORRECTION_REASON_REQUIRED` nas 3 | PASS |
| C3-02c | Redução **com justificativa** | OK, com auditoria `correction_reason='Correcao de digitacao T1'` | PASS |
| C3-02d | Unidade errada (fmcp em SP), outra org (adminB em SP e admin A na Org B), empregado, Segurança, manutenção, gestor desativado | `MANAGEMENT_SCOPE_DENIED` | PASS |
| C3-02e | Chaves proibidas (`status`, `documentation_valid`, `photo_storage_path`), combustível 120, odômetro negativo, categoria ou local de outra org, payload que não é objeto | `INVALID_INPUT` | PASS |
| C3-02f | Admin e gestor **sem CNH** editam cadastro e medição no escopo | OK | PASS |
| C3-03 | UPDATE direto das 4 colunas de medição × 19 atores | todos `42501` | PASS |
| C3-03b | UPDATE direto de `name`/`color` (0210) | 1 linha só no escopo: admin A, fmall e fmnocnh em SP/CP, fmsp em SP, fmcp em CP, adminB na Org B; os demais têm 0 linhas | PASS |
| P1/P3/P12 | Foto da Frota (0210/0212) | ver seção 5: caminho completo funciona e foto de 8,6 MB vinculada | PASS |

## 4. Exceção (0222, reconferindo 0211): EXEC

As evidências estão em `ev_c4_exception.txt`, em `ev_c4b_departed_unrecorded.txt` e nos itens C4-H* de `ev_c6c7_http.json`.

| ID | Cenário | Esperado × obtido | Status |
|---|---|---|---|
| C4-01 | Em SP, Segurança registra "não saiu". Solicitante e gestor fora do escopo tentam | solicitante e fmcp: `NOT_AUTHORIZED`. Segurança: OK, reserva `cancelled` e veículo `available` | PASS |
| C4-01b | **Nenhuma linha fictícia** | 0 eventos de portaria, 0 inspeções, 0 eventos de chave | PASS |
| C4-02a | Rótulo `fm_not_departed_reservations` | solicitante, fmsp, fmall e Segurança veem. Outro empregado, fmcp, adminB, desativado e `t1emp` recebem `{}` | PASS |
| C4-02b | Solicitante lê `fm_operation_exceptions` | 0 linhas | PASS |
| **C4-02c / C4-H1** | Solicitante lê `reservations.cancellation_reason` | **retorna `"T1 MOTIVO INTERNO SIGILOSO"`** (SQL e HTTP) | **FAIL → T1-D01** |
| **C4-02d / C4-H2** | Notificação do solicitante | **corpo "Sua reserva foi encerrada por exceção operacional: T1 MOTIVO INTERNO SIGILOSO"** | **FAIL → T1-D01** |
| C4-03 | Campinas: chave entregue e depois "não saiu" | `KEYS_OUTSTANDING`. Custodiante do Rio recebe a chave: `KEY_CUSTODY_NOT_AUTHORIZED`. Custodiante de Campinas registra `received` e então a exceção passa. As chaves ficam só `delivered,received`, sem linhas fictícias | PASS |
| C4-04 | Campinas: após a retirada digital, "não saiu" | `VEHICLE_ON_TRIP` para custodiante e gestor. Segue o fluxo de devolução e recebimento (K7b passou) | PASS |
| C4-05 | `departed_unrecorded` | em custódia: `OFFICE_HAS_NO_GATE`. Pelo gestor: `NOT_AUTHORIZED`. Pela Segurança sem checklists: `CHECKLIST_REQUIRED`, sem criar saída | PASS |

## 5. Fotos no banco (0212/0214/0216/0219/0221/0224/0227): EXEC

A evidência está em `ev_c5_photos.json` (45 PASS, 0 FAIL, 1 INFO) e em `ev_c5b_history_immutable.txt`.

A etapa do servidor reproduz `lib/domain/storedPhoto.ts`: download com a sessão do usuário, hash no servidor, `fm_photo_attest` de 6 argumentos com service_role e `fm_photo_finalize` do usuário. O upload vai direto ao Storage local com o JWT do usuário.

| ID | Cenário | Obtido | Status |
|---|---|---|---|
| P1 | Caminho feliz da foto da Frota (gestor SP) | begin 200, upload 200, finalização vinculada, auditoria `photo.linked` | PASS |
| P2 | **Assinatura antiga fechada (0224)** | 5 argumentos via service_role: `403 42501`. Usuário com 6 argumentos: 403. anon: 401. `fm_photo_link` direto: 403. `has_function_privilege`: false para os três papéis | PASS |
| P3 | **A → B → A** com o mesmo gestor | B vinculada. O begin com o hash de A devolve o mesmo id em estado `linked`, sem novo upload, e a finalização reaponta para A. O jornal fica com 2 linhas, sem duplicar | PASS |
| P3e | A → B → A por **outro** gestor no escopo | `PHOTO_CONFLICT` | INFO → **T1-D02** |
| P4 | Inspeção | 3 fotos (frente, traseira, lateral esquerda) no mesmo checklist, 3 vinculadas. **INSERT direto em `inspection_photos`** por condutor, gestor, admin e Segurança: 403 `42501` (0216). Outro empregado na inspeção alheia: `NOT_AUTHORIZED` | PASS |
| P5 | Caminho errado | o download falha e não vincula. Atestação com outro `p_path`: `PHOTO_ATTEMPT_CHANGED` | PASS |
| P6 | Proprietário errado (outro gestor sobe no caminho do jornal) | `PHOTO_INTEGRITY_MISMATCH` | PASS |
| P7 | Metadados errados | mimetype png × jpeg: `PHOTO_INTEGRITY_MISMATCH`. Tamanho divergente: recusado no servidor e no banco | PASS |
| P8 | **Adulterado de mesmo tamanho** | o hash do servidor diverge, e atestar o hash real dá `PHOTO_INTEGRITY_MISMATCH`. Finalize sem atestação: `PHOTO_SERVER_VERIFICATION_REQUIRED`. Sobrescrever com PUT/upsert: 400 | PASS |
| P9 | **Conta errada** | info, finalize e restart do jornal alheio: `NOT_AUTHORIZED` para fmall, condutor e adminB. `p_actor` diferente do autor: `NOT_AUTHORIZED`. Gestor SP em veículo de Campinas: negado. Conta desativada: negada. anon e adminB na pasta da Org A: upload negado | PASS |
| P10 | **Pendência recuperável (0221)** | a tentativa com arquivo errado fica pendente e aparece em `fm_photo_pending` só para o autor. O restart gera novo caminho e grava 1 linha de histórico, e **o objeto original continua no Storage**. A nova tentativa conclui. Restart de foto vinculada: `PHOTO_ALREADY_LINKED` | PASS |
| P10b | Histórico e jornal imutáveis ou fechados | UPDATE ou DELETE como postgres: `PRESERVE_INSPECTION_HISTORY`. Usuário em `fm_photo_attempt_history`/`fm_photo_uploads`: `42501` | PASS |
| P11 | **Restart concorrente à atestação**, 2 sessões psql reais, 30 iterações | 29 com a atestação primeiro e 1 com o restart primeiro (atestação recusada com `PHOTO_ATTEMPT_CHANGED`). **0 duplicadas, 0 perdas, 0 verificadas com caminho trocado, 0 vinculadas sem verificação** | PASS |
| P12 | Arquivo de 8,6 MB e begin de 10 MB + 1 byte | 8,6 MB: upload direto e finalização vinculada. 10 MB + 1: `INVALID_PHOTO` | PASS |

## 6. CNH e acesso: EXEC

A evidência está em `ev_c6c7_http.json` (C6-*), `ev_c6c7_followup.json` e `ev_c6_ride_request.json`, todos com PostgREST e JWT real.

| ID | Cenário | Obtido | Status |
|---|---|---|---|
| C6-01..07 | Bloqueios de condução | retirada com CNH vencida ou NULL: `LICENSE_EXPIRED`. Gestor ou Segurança registrando checklist para condutor com CNH vencida: `LICENSE_EXPIRED`. Custodiante entregando chave: `LICENSE_EXPIRED`. Saída física: `DEPARTURE_BLOCKED`. Admin sem CNH retirando a própria reserva: `DRIVER_NOT_AUTHORIZED`. Contagens de inspeção, chave e portaria inalteradas | PASS |
| C6-08 | **CNH vence entre os checklists e a saída** | a Segurança tenta a saída: `LICENSE_EXPIRED`, sem criar evento de portaria | PASS |
| C6-09 | Controle com CNH válida | retirada OK | PASS |
| C6-10..17 | Sem CNH: atividades administrativas e consultas | aprovar (admin e gestor sem CNH), `list_member_licenses`, `list_member_license_sources`, `fm_key_management_workspace`, `fm_update_vehicle` e `fm_availability_windows` (empregado sem CNH e CNH vencida): todos OK | PASS |
| C6-18b' | **Pedir carona como passageiro** pelo caminho canônico do app (`create_carpool_ride_request_as_rider`) | `t1emp` (sem CNH), `t1drvexp`, `t1drvnull` e `t1adminnocnh` criam o pedido (200). O condutor da Org B: `CARPOOL_OFFER_NOT_FOUND` (isolamento). Admin e gestor sem CNH também conseguem pelo `create_carpool_participation` | PASS |
| C6-19 | Consultas | admin e gestor sem CNH leem `audit_log`, `reservations` e `vehicles`. Empregado sem CNH lê `vehicles` (46). CNH vencida lê as próprias reservas | PASS |
| C6-20..22 | **Conta desativada** | `vehicles`, `reservations`, `profiles` e `notifications`: 0 linhas. Pedir carona: negado. Disponibilidade: 0 linhas | PASS |
| C6-23..29 | **Antifraude** | Motorista renova pelo PATCH em `profiles`: 403. Admin altera CNH lida por IA: 403. `apply_ai_license_read` e `reset_ai_license` diretos (condutor, admin, anon): `42501`. `list_member_license_sources` mostra a origem `ai` ao admin, recusa o empregado e não mostra a Org A ao adminB. O valor da CNH de `t1custrj` ficou inalterado | PASS |
| C6-30 | Criar reserva de veículo com CNH vencida | permitido; a condução é barrada depois (O5) | INFO |

## 7. Regressão 0210, isolamento e fluxos: EXEC

| ID | Cenário | Obtido | Status |
|---|---|---|---|
| C7-01 | PATCH de 11 colunas operacionais × 15 atores, com anon, × 3 veículos (SP, CP, Org B) | **495/495** negados ou com 0 linhas, estado idêntico antes e depois | PASS |
| C7-02 | PATCH de cadastro (`name`) | 1 linha só para quem pode no escopo; os demais têm 0 linhas; anon 401 | PASS |
| C7-03 | 16 RPCs fora do escopo | aprovar, bloquear, concluir tarefa, assumir tarefa, editar medição e liberar vencidas: todos negados. Estado final: tudo pendente ou aberto, sem atribuição, odômetro inalterado | PASS |
| C7-04/05 | anon | 9 tabelas: 401. 7 RPCs: 401/404 | PASS |
| G1–G14 | **São Paulo**: dois checklists e a saída e chegada físicas só pela Segurança | saída sem checklist da Segurança: `CHECKLIST_REQUIRED`. Gestor ou admin registrando como Segurança: `INSPECTION_NOT_AUTHORIZED`. Saída por gestor, admin ou condutor: `NOT_AUTHORIZED`. Segurança da Org B: `NOT_FOUND`. Segurança: saída OK (`in_use`) e chegada OK. Devolução do condutor (G12b) OK | PASS |
| B1–B6 | Checklist em nome do condutor | gestor de Campinas em veículo SP: negado. Gestor SP: OK. Saída pelo gestor: negada. Saída pela Segurança: OK | PASS |
| K1–K9, R1–R9 | **Campinas e Rio (chaves reais)** | portaria em unidade de chaves: `DEPARTURE_BLOCKED`. Gestor e custodiante de outra unidade: `KEY_CUSTODY_NOT_AUTHORIZED`. Custodiante correto entrega, condutor retira (`in_use`), condutor não registra o recebimento da própria chave, custodiante recebe. Devolução (K7b/R7b) termina `completed/available` | PASS |
| D1–D11 | **Avaria** | o checklist com avaria cria a retenção. Saída com avaria: `DEPARTURE_BLOCKED`. PATCH direto em tarefa ou `has_blocking_damage`: 403. Gestor de outra unidade e Segurança: negados. Quem registrou a avaria: `DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED`. Gestor independente assume pela RPC 0225 e conclui: `dmg=false`, com auditoria `workflow_task.claimed` e `vehicle.damage_hold_released` | PASS |
| O1–O5 | **OS** | condutor, empregado, Segurança e custodiante: `fm_work_orders` e `fm_work_order_lines` com 0 linhas. `fm_availability_windows` só com `end_at,kind,start_at,vehicle_id`, sem descrição nem valor. Gestor SP vê a OS e gestor de Campinas não vê | PASS |

---

## Defeitos

### T1-D01 (P2): o motivo interno da exceção "veículo não saiu" é exposto ao solicitante

- **Reprodução (local):**
  1. Criar uma reserva `confirmed` de `t1drvok` em uma unidade `gate_visual`.
  2. Como `t1sec`, chamar `fm_operation_exception(<res>,'not_departed','T1 MOTIVO INTERNO SIGILOSO',gen_random_uuid())`.
  3. Como `t1drvok`, fazer `GET /rest/v1/reservations?select=cancellation_reason&id=eq.<res>`. Retorna `"T1 MOTIVO INTERNO SIGILOSO"`.
  4. Como `t1drvok`, fazer `GET /rest/v1/notifications?select=body&entity_id=eq.<res>`. Retorna "Sua reserva foi encerrada por exceção operacional: T1 MOTIVO INTERNO SIGILOSO".
- **Evidência:** `ev_c4_exception.txt` (C4-02) e `ev_c6c7_http.json` (C4-H1 e C4-H2).
- **Causa provável:** `fm_operation_exception` (0211), no ramo `not_departed`, grava `cancellation_reason=left(trim(p_reason),1000)` em `reservations`, que o solicitante lê pela RLS. O mesmo ramo também concatena o motivo no corpo da notificação. A 0222 só acrescentou o RPC de rótulo (`fm_not_departed_reservations`) e não mexeu nesses dois pontos. A UI de `/trips` seleciona `cancellation_reason` mas não o exibe, conforme EST. A notificação, porém, é exibida.
- **Correção proposta (migration adiante, sem editar SQL aplicado):**
  - No ramo `not_departed`, gravar em `cancellation_reason` um código fixo, por exemplo `operation_exception_not_departed`. O motivo continua em `fm_operation_exceptions.reason` e no `audit_log`.
  - Usar na notificação um texto fixo, sem o motivo: "Sua reserva foi encerrada por exceção operacional: o veículo não saiu".
  - Fazer o backfill de `cancellation_reason` das exceções existentes.
  - O que fazer com as notificações já enviadas é uma **decisão** do dono.

### T1-D02 (P3/decisão): A → B → A só funciona para quem enviou a foto original

- **Reprodução:**
  1. `t1fmsp` envia a foto A de um veículo SP, depois a foto B.
  2. `t1fmall`, gestor com escopo no mesmo veículo, seleciona o mesmo arquivo A.
  3. `fm_photo_begin` retorna `PHOTO_CONFLICT`. No app, a rota `/api/photos` responde 403 `photo_not_authorized_or_conflict`.
- **Evidência:** `ev_c5_photos.json` (P3e). Com o mesmo gestor, A → B → A funciona (P3a–d).
- **Causa provável:** a unicidade `(org, target, sha256)` do jornal e a regra `v_row.uploaded_by is distinct from auth.uid() → PHOTO_CONFLICT`. Além disso, `fm_photo_info` e `fm_photo_link` exigem `uploaded_by=auth.uid()`.
- **Correção proposta, a decidir:**
  - **Opção 1:** para `target_kind='vehicle'` com linha já `linked` e `fm_photo_allowed` verdadeiro, permitir que qualquer gestor com escopo reselecione a referência. Isso seria um comando de relink auditado com o ator real, sem alterar `uploaded_by` nem a prova.
  - **Opção 2:** aceitar a limitação e mostrar uma mensagem clara ("esta foto já foi enviada por outro gestor").

## Observações (não são defeitos do delta)

| ID | Tipo | Descrição |
|---|---|---|
| O1 | EST/decisão | A 0217 executa `update organization_settings set auto_release_enabled=true where not auto_release_enabled`. Uma suspensão de emergência existente no momento da implantação é desfeita sem aviso. O `check-auto-release-policy.sql` trata qualquer `false` como NO-GO. Assim, o opt-out explícito funciona na função (C1-06) mas é operacionalmente NO-GO. Isso é coerente com o estado aprovado; registrar na janela de implantação. |
| O2 | EXEC/por desenho | Reservas vencidas com atividade (inspeção, portaria `denied` ou chave entregue) ficam abertas indefinidamente: são contadas em `skipped_with_activity` e exigem tratamento manual ou exceção. Ex.: `rl_insp` ficou `confirmed/awaiting_pickup`. |
| O3 | EXEC/por desenho | `maintenance_operator` lê e assume tarefas de todas as unidades da org, porque não há modelo de escopo por unidade para manutenção (0218/0225). A Segurança não lê tarefas. |
| O4 | EXEC, pré-existente | O caminho legado `create_carpool_participation` (usado em `trips/new` quando o motor oferece `carpoolOptions`) falha com RLS em `trip_participants` para **qualquer** empregado, inclusive com CNH válida (controle `t1custcp`). Admin e gestor conseguem. Não tem relação com CNH nem com o delta. O caminho canônico, `requestCarpoolRide` → `create_carpool_ride_request_as_rider`, funciona. Sugestão: confirmar na UI (T2) se esse ramo ainda é alcançável por empregado. |
| O5 | EXEC/INFO | `create_vehicle_reservation` aceita um condutor com CNH vencida. O bloqueio ocorre na retirada, na entrega de chave e na saída, o que é coerente com "CNH só para condução". Se for desejado bloquear já na solicitação, é uma decisão. |
| O6 | EST | A conta desativada ainda obtém token no GoTrue, mas o banco nega tudo e o middleware e o login checam `fm_account_enabled`. `create_carpool_ride_request_as_rider` (service_role) não checa `fm_account_enabled`, dependendo só da sessão do app. Endurecimento opcional, P3. |
| O7 | EXEC | `fm_update_vehicle` registra `vehicle.measurements_updated` também em edições só de cadastro. É cosmético. |

## O que NÃO foi testado (NT) e por quê

- **Ambiente remoto:** Supabase remoto/produção, pooler (pgbouncer/supavisor), Realtime e Edge Functions. Fora do escopo por regra.
- **Ordem de rollout EXPAND → app → CONTRACT:** o banco local foi construído em ordem numérica, então só o **estado final** foi validado.
- **UI:**
  - formulário de edição da Frota;
  - `/account/photos`;
  - botão de assumir no dashboard;
  - rótulo "Encerrada: veículo não saiu" em `/trips`.

  Esses itens cabem aos agentes de UI.
- **Rota `/api/photos` por HTTP:** não foi chamada porque exige sessão por cookie do app. A etapa do servidor foi reproduzida fielmente em `t1_c5_photos.mjs`, mas sem as verificações de bytes mágicos e de origem da rota.
- **Agendamento real do cron:** não existe agendador local; a rota foi chamada manualmente.
- **Busca e geocodificação de carona:** dependem do Google, que não existe localmente. Os valores de desvio foram passados como 0. A leitura de CNH por IA (Claude) também não foi testada.
- **Quedas de rede no navegador** em cada fase do upload: só as quedas no banco e no Storage foram simuladas (begin sem upload, arquivo errado, restart).

## Resultados históricos (HIST, só referência)

O S1 da integração anterior (0213 sem 0214–0227) e o F1/F2 (0215/0216) estão em `docs/integracao_2026-10-22/`. Não foram usados como prova deste delta. Os harnesses foram adaptados de `homolog/conclusao/S1`.

## Arquivos

- **Scripts:** `t1_mkusers.mjs`, `t1_lib.mjs`, `t1_fixture.sql`, `t1_c1_*.sql|mjs`, `t1_c2_tasks.sql`, `t1_c3_measurements.sql`, `t1_c4*.sql`, `t1_c5_photos.mjs`, `t1_c5b_history_immutable.sql`, `t1_c6*.mjs|sql`, `t1_c6c7_*.mjs|sql`.
- **Evidências:** `ev_*.txt|json`.

Não declaro homologação.
