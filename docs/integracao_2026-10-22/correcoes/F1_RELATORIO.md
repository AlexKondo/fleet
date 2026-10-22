# F1: correções SQL dos defeitos P2 (S1-02, S1-04, S1-05, S1-06, S2-D01)

Agente F1 · 22/10/2026 · worktree `C:\projects\fleet-integ` (branch `integracao-conclusao-2026-10-22`, HEAD `fcc598d`) · banco LOCAL descartável `supabase_db_fleet-homolog`.

- **Escopo da execução:**
  - Não houve acesso a produção nem a host remoto, e nenhuma chave ou senha foi impressa.
  - Não fiz `git write`.
  - Não editei nenhuma migration existente (0001–0214).
  - Não alterei código da aplicação fora de testes.
- **Estado real do banco local:** o ledger estava em `0213`, mas o corpo de `fm_photo_link` já era o da 0214 (contém `PHOTO_SERVER_VERIFICATION_REQUIRED`). Na prática, o banco equivale a 0001–0214, com a 0214 aplicada sem registro no ledger.
- **Novas migrations:**
  - Aplicadas com `psql -1`.
  - Registradas no ledger como `0215` e `0216`.
  - Copiadas para `C:\projects\_homolog\supabase\migrations\`, com os rollbacks em `...\rollback\`.
  - Não fiz `db reset`.

## Resumo

| Defeito | Migration | Antes | Depois | Classe |
|---|---|---|---|---|
| S1-02 liberação automática deixa veículo inseguro `reserved` sem reserva | 0215 | 4 FAIL / 6 | 6/6 PASS | EXPAND (helper) + estreitamento só para veículo inseguro |
| S1-04 `cancel_reservation` devolve veículo inseguro a `available` | 0215 | 4 FAIL / 6 | 6/6 PASS | idem |
| S1-05 custódia entrega a chave e inicia a viagem com veículo inseguro | 0215 | 4 FAIL / 12 | 12/12 PASS | idem |
| S1-06 conclusão/cancelamento de tarefa libera veículo com doc irregular e limpa avaria sem a regra de independência | 0215 | 6 FAIL / 15 | 15/15 PASS | idem |
| S2-D01 INSERT direto em `inspection_photos` | 0216 | 3 FAIL / 7 (SQL); S2-13 FAIL | 7/7 PASS; HTTP 403 `42501`; S2-13 PASS | **CONTRACT** (revoke) |

- **Concorrência:** 6 cenários × 30 iterações em sessões `psql` paralelas, ou seja, **180 iterações, 0 × 40P01 e 0 inconsistências**.
- **Testes do app:** `tsc --noEmit` terminou com exit 0. Vitest: **1003/1003**. O baseline era 976; F2 adicionou testes no mesmo período e eu adicionei 8.

## Causa comum e desenho da correção (0215)

Cada rotina usava a sua própria regra de "seguro". A 0211, a 0213 e o `DEPARTURE_BLOCKED` da portaria já verificavam avaria, documentação, equipamento e OS; as rotinas dos defeitos acima não.

**`supabase/migrations/0215_vehicle_safe_return_check.sql`** cria uma checagem única:

- **`fm_vehicle_unsafe_reason(veículo, tarefa_em_fechamento default null)`**
  - Retorna `null` quando o veículo é seguro. Caso contrário retorna o motivo: `archived`, `documentation`, `work_order`, `damage` ou `safety_equipment`.
  - As condições são exatamente as da 0211/0213/`DEPARTURE_BLOCKED`:
    - veículo arquivado;
    - `documentation_valid=false`;
    - OS `in_progress`/`partial`, ou OS `scheduled` com a janela aberta agora (regra da 0213);
    - `has_blocking_damage`;
    - equipamento de segurança faltando.
  - O segundo argumento ignora a OS cuja própria tarefa está sendo concluída. Sem isso, `work_order.completed` deixaria o veículo em manutenção, porque ele chama `complete_workflow_task` antes de mudar a OS para `completed`.
- **`fm_vehicle_unsafe_status(...)`**
  - Usa o mapeamento da 0211: documentação irregular ou veículo arquivado → `blocked`; OS, avaria ou equipamento → `maintenance`.
- **Segurança das duas funções:** `SECURITY DEFINER`, `STABLE`, `search_path = public, pg_temp`. Sem EXECUTE para PUBLIC, anon ou authenticated; somente `service_role`. Provado no vitest e no ACL do banco.

As 7 rotinas foram recriadas com `create or replace` a partir do `pg_get_functiondef` do banco local:

- `pglite_body_check.mjs` prova que esses corpos são **byte a byte idênticos** aos que a cadeia 0001→0214 produz (`evidencias/pglite_body_check.txt`).
- O diff lógico é mínimo (`F1_scripts/before_defs` × `F1_scripts/work`).
- Assinaturas, ACL e `search_path` foram mantidos. A ACL foi conferida antes e depois: é idêntica, e também foi reafirmada explicitamente na migration.
- Nenhum lock novo: todo chamador já tem a linha do veículo travada (ordem 0194: veículo → reserva/tarefa), e os helpers apenas leem.

## Por defeito

### S1-02 — `fm_release_expired_reservations` (0213)

- **Causa:** quando o veículo é inseguro, o ramo de restauração não fazia nada, e o veículo continuava `reserved`/`awaiting_pickup` sem nenhuma reserva ativa.
- **Correção:**
  - No ramo "sem outra confirmada", o status passa a ser `coalesce(fm_vehicle_unsafe_status(v),'available')`. Isso dá `blocked` para documentação irregular e `maintenance` para OS, avaria ou equipamento.
  - A auditoria `after.vehicle_status` registra o status real.
  - O retorno JSON não muda: `vehicles_released` continua contando só os veículos que voltaram a available.
- **Justificativa do destino:** é o mesmo `CASE` já aprovado na 0211 (`fm_operation_exception`) para o mesmo evento, "reserva encerrada sem saída".
- **Mantido:** veículo com outra reserva confirmada continua `reserved` (regra B-outra da 0213, inalterada).
- **Antes × depois:** `ANTES_r_s1_02_release.txt` mostra DOC/DMG/EQP/WO `reserved` com `confirmed_left=0`. Em `DEPOIS_r_s1_02_release.txt` ficam `blocked`/`maintenance`/`maintenance`/`maintenance`, e os controles (seguro → available; com outra reserva → reserved) não mudam.

### S1-04 — `cancel_reservation`

- **Correção:** mesmo `coalesce`, aplicado no ramo sem outra confirmada.
- **Antes:** S1CX_DOC, S1CX_DMG, S1CX_EQP e S1CX_WO iam para `available`.
- **Depois:** `blocked`/`maintenance`/`maintenance`/`maintenance`. O caso seguro vai para `available` e o caso com outra reserva fica `reserved`.
- O script original `t3f_cancel_unsafe.sql` de S1 também foi reexecutado: `DEPOIS_S1orig_t3f_cancel_unsafe.txt`.

### S1-05 — custódia de chaves

- **`fm_key_command('delivered')`:** passa a retornar `VEHICLE_NOT_READY` (o código que já era usado ali) também quando a checagem única falha.
- **`record_pickup` (ramo `key_custody`):** uma retirada digital **nova** (que é a saída do escritório) de veículo inseguro retorna `DEPARTURE_BLOCKED`, o mesmo código da portaria. O retry idêntico de uma retirada já registrada continua idempotente (testado).
- **Antes (`ANTES_r_s1_05_keycustody.txt`):** a chave era entregue com documentação irregular e com OS em andamento. Com documentação vencida depois da entrega, a retirada deixava o veículo **in_use**.
- **Depois:** `VEHICLE_NOT_READY` ×2 e `DEPARTURE_BLOCKED`, com o veículo continuando `reserved`. O controle seguro faz entrega + retirada + retry → `in_use`.

### S1-06 — `complete_workflow_task` / `cancel_workflow_task` + `fm_release_damage_hold` (0205)

- **Causa:**
  - O ramo final fazia `status='available', has_blocking_damage=false` sem nenhuma checagem.
  - Com o veículo em `maintenance`, o `fm_release_damage_hold` retornava cedo, então a regra de pessoa independente nunca era aplicada.
- **Correção:**
  - O ramo final passa a gravar `coalesce(fm_vehicle_unsafe_status(v, tarefa),'available')` e **não mexe mais** em `has_blocking_damage`.
  - Em `fm_release_damage_hold`, o retorno antecipado para `maintenance/cleaning/charging` deixa de valer **só para a origem `workflow_task`**, que é o gatilho de tarefa `repair` → `done`.
  - Assim, a avaria só é liberada pelo caminho auditado da 0205: checagem de reparo/incidente pendente, `DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED` e auditoria `vehicle.damage_hold_released`. A liberação mantém o status, e `complete_workflow_task` decide o status logo em seguida.
  - A origem incidente não mudou.
- **Antes:**
  - doc irregular → `available` (complete e cancel);
  - quem registrou a avaria concluía o reparo e a avaria era zerada sem auditoria;
  - cancelar o reparo zerava a avaria.
- **Depois:**
  - doc irregular → `blocked`;
  - quem registrou a avaria recebe `DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED` e nada muda;
  - um gestor independente libera a avaria com 1 auditoria → `available`;
  - cancelar o reparo deixa `maintenance` com a avaria mantida;
  - concluir a tarefa da própria OS → `available`.
- `t1c_complete_task_unsafe.sql` original → `blocked`.

### S2-D01 — `inspection_photos` (0216, CONTRACT)

- **Correção:**
  - `revoke insert` de `authenticated`, `anon` e `public`.
  - SELECT continua, e o RLS de leitura não mudou.
  - UPDATE/DELETE já eram barrados pelo trigger append-only.
  - As políticas de INSERT ficaram inertes (sem o privilégio) para que o rollback seja um único GRANT.
- **Grep:** nenhum código, nem da branch nem do 0aa2403 implantado, insere na tabela pelo cliente de sessão. O único escritor é `fm_photo_link` (definer, chamado por `fm_photo_finalize`).
- **Antes (`ANTES_r_s2_d01.txt`):** o lucas inseria o vínculo direto.
- **Depois (`DEPOIS_r_s2_d01.txt`):**
  - o INSERT direto dá `permission denied`;
  - o caminho oficial (begin → objeto → attest → finalize) vincula, e o jornal fica `linked`;
  - via HTTP real (`DEPOIS_r_s2_d01_http.json`): lucas recebe 403 `42501`, anon recebe 401 e a contagem não muda (52→52).

## Verificação

- **Concorrência real, defeitos novos (`f1_concurrency.mjs`, `DEPOIS_f1_concurrency.json`):** 30 iterações por cenário, 0 × 40P01, 0 inconsistências em todos.

  | Cenário | Sessões em paralelo |
  |---|---|
  | `release_unsafe` | liberação, cancelamento, exceção, aprovação |
  | `task_damage` | complete, cancel_reservation, block, liberação |
  | `key_unsafe` | entrega, retirada, cancelamento, exceção |
  | `key_safe_race` | retirada, bloqueio, recebimento, exceção |

  - Invariantes verificados: cancelamento exatamente 1; veículo inseguro nunca `available`/`reserved`/`in_use` após o encerramento; tarefa `done` ⇔ avaria liberada com exatamente 1 auditoria; nunca entrega ou retirada de veículo inseguro.
- **Concorrência real, scripts originais de S1:** `t3c` e `t3d` reexecutados, 4 × 30 iterações, 0 × 40P01, 0 inconsistências, 0 duplo cancelamento (`DEPOIS_S1orig_t3c/t3d_*.json`).
- **Regressão S1:**
  - **Matriz de permissões 0210** (`t1_vehicles_matrix.sql`): **idêntica** à de S1, com DENIED 297 / NO_EFFECT 240 / UPDATED 84.
  - **`r_regress_flows.sql`, 34/34 PASS:**
    - SP gate_visual completo: checklists → saída pela Segurança → chegada → devoluções → completed/available;
    - avaria SP: `DEPARTURE_BLOCKED` → gestor independente conclui o reparo (auditado) → saída;
    - Campinas: portaria barrada, gestor não custodiante barrado, entrega → retirada → recebimento → devolução → completed/available;
    - liberação nas duas camadas: flag desligada = 0; −59 min permanece; −61 min liberada; reserva com atividade intocada; idempotente; 1 auditoria.
  - **Saída impedida 0211:** inalterada (a rotina não foi tocada). Coberta pelo `package01Fixes.test.ts` e pelos cenários de exceção da concorrência.
- **Fotos S2 (`run.sh`, `DEPOIS_S2_bateria_fotos.log`): 17/19.**
  - **S2-07b e S2-14 falham por desenho depois da 0214.** Os ramos "pré-0214" agora recebem `PHOTO_SERVER_VERIFICATION_REQUIRED`, e o md5 de `fm_photo_link` esperado é o pré-0214.
  - **S2-13 passou a PASS** (o INSERT direto agora é barrado).
- **Foto do veículo pela Frota (Playwright, app :3100):**
  - `ui_vehicle_photo_f1.mjs` usa imagens novas.
  - fmall, admin e fmcampinas: o formulário fecha, `photo_storage_path` passa a ser a nova foto, o jornal fica `linked`/atestado, há 1 auditoria e a miniatura carrega (`evidencias/ui_f1/`).
  - O script S2 original com cores fixas é idempotente, porque a foto já estava vinculada, e o caso de 8,6 MB continua sendo o S2-D02 (escopo do F2): `DEPOIS_ui_vehicle_photo.json`.
- **Testes vitest:**
  - **Novo arquivo** `apps/web/lib/operations/safeReturnCheck.test.ts`, com 8 testes em PGlite cobrindo:
    - ACL/definer dos helpers;
    - S1-02, S1-04 e S1-05;
    - S1-06 (status, independência, cancelamento do reparo e OS completa via `work_order.transition` → available);
    - S2-D01.
  - **Teste ajustado:** `inspectionFlow.test.ts` (2 testes). Eles **codificavam o defeito**: esperavam erro de RLS e depois aceitavam o INSERT direto do inspetor com objeto no Storage. Agora esperam `permission denied`, e o vínculo é feito como dono, simulando `fm_photo_link`.
  - Nenhum outro teste quebrou.
- **Rollback ensaiado (`evidencias/rollback_ensaio.txt`):** dentro de uma transação, os rollbacks 0215 e 0216 restauram as 7 funções **com md5 idêntico** ao dump "antes", restauram a ACL de `inspection_photos` e removem os helpers. Reaplicar a 0215 e a 0216 é idempotente.

## Riscos residuais

1. **Veículo preso em `maintenance` sem tarefa aberta:**
   - Acontece com OS `scheduled` com janela aberta e depois cancelada, ou com avaria cujo reparo foi **cancelado**.
   - É uma consequência intencional ("não volta ao uso").
   - Para sair desse estado, crie e conclua uma nova OS ou tarefa de reparo.
2. **Dados legados com `has_blocking_damage=true` sem tarefa `repair`:** concluir outra tarefa não limpa mais a avaria; o veículo fica em `maintenance`.
3. **`fm_operation_exception` (0211) e `fm_fleet_lifecycle` (desarquivar) ainda têm o próprio `CASE`.** A 0211 não considera OS agendada em janela nem veículo arquivado. Não foram alteradas, por estarem fora do brief. A convergência para o helper fica como próximo passo.
4. **Veículo inseguro com outra reserva confirmada continua `reserved`** (regra existente de 0213 e de `cancel_reservation`). Na 0211, o mesmo caso iria para `blocked`. Hoje a saída continua barrada.
5. **Mensagens no app (para o F2, dono do código e dos dicionários):**
   - `reservations/[id]/pickup/actions.ts` mostra `DEPARTURE_BLOCKED` cru;
   - `dashboard/actions.ts` (complete task) não traduz `DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED`;
   - `VEHICLE_NOT_READY` da entrega de chave já é mapeado em `keyCustody.ts`.
6. **S1-05 continua dependente de dados:** nenhuma rotina do app grava `documentation_valid`. Falta um comando auditado de documentação (decisão citada em S1).
7. **Não testado:** Supabase remoto, pooler e Realtime. Os testes do vitest novo não foram executados contra a cadeia sem 0215/0216; o "antes" está provado pelos scripts SQL.

## Ordem de aplicação em produção

1. **0215 (EXPAND, sem dependência de código):** aplicar depois de 0205, 0210, 0211 e 0213, porque redefine os corpos mais recentes delas. É compatível com o app implantado (0aa2403) e com o código novo: mesmos RPCs e argumentos, e só códigos de erro já existentes. Pode entrar no lote expand, antes do deploy.
2. **0216 (CONTRACT):**
   - É independente da 0214 e não depende de código, porque nenhum cliente insere direto.
   - Pela regra de contract, aplicar **depois do deploy** e rodar a bateria de fotos em seguida.
   - Pode ir antes ou depois da 0214, mas **deve estar aplicada antes de considerar a 0214 suficiente** (pré-condição (d) do S2).
3. **Rollback:** `supabase/migrations/rollback/0215_rollback.sql` e `0216_rollback.sql`.

## Efeitos no banco local compartilhado (aditivos)

- **Org B fictícia:**
  - ~240 veículos e reservas `S1F1C*` de concorrência;
  - unidade de custódia `F1 B Escritorio` (`b5…f1`) com `s1adminb` como custodiante;
  - a flag `auto_release_enabled` voltou a `false/60`.
- **Org A:**
  - fotos novas vinculadas em GWM5O35, GWM9J29 e GWM6T36 (pela UI);
  - linhas de foto da bateria S2, append-only e iguais às de S2.
  - Todos os scripts `r_*.sql` rodam em BEGIN…ROLLBACK.
- **Ledger:** linhas `0215` e `0216` inseridas.
- **Evidências de S2 sobrescritas:** a bateria S2 e o `ui-vehicle-photo.mjs` regravaram arquivos em `C:\projects\_homolog\conclusao\S2\evidencias` (`resultados.json`, `ui_*`). As cópias estão em `evidencias/DEPOIS_*`.

## Arquivos

- **Migrations:**
  - `C:\projects\fleet-integ\supabase\migrations\0215_vehicle_safe_return_check.sql`
  - `C:\projects\fleet-integ\supabase\migrations\0216_inspection_photos_no_direct_insert.sql`
  - `...\rollback\0215_rollback.sql`
  - `...\rollback\0216_rollback.sql`
- **Testes:**
  - `C:\projects\fleet-integ\apps\web\lib\operations\safeReturnCheck.test.ts` (novo)
  - `C:\projects\fleet-integ\apps\web\lib\operations\inspectionFlow.test.ts` (ajustado)
- **Scripts (`C:\projects\fleet-integ\docs\integracao_2026-10-22\correcoes\F1_scripts\`):**
  - `r_s1_02_release.sql`, `r_s1_04_cancel.sql`, `r_s1_05_keycustody.sql`, `r_s1_06_tasks.sql`, `r_s2_d01.sql`, `r_s2_d01_http.mjs`, `r_regress_flows.sql`
  - `f1_concurrency.mjs`, `ui_vehicle_photo_f1.mjs`, `pglite_body_check.mjs`
  - `build_0215.py`, `before_defs/`, `work/`
  - Execução: `cat f1_lib.sql r_x.sql | docker exec -i supabase_db_fleet-homolog psql -U postgres -d postgres`
- **Evidências:** `...\correcoes\evidencias\` (`ANTES_*`, `DEPOIS_*`, `rollback_ensaio.txt`, `vitest_final.txt`, `ui_f1/`).
