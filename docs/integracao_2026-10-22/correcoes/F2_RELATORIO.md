> **Nota (22/10):** esta etapa foi commitada em `0f1dc12` na branch `integracao-conclusao-2026-10-22`; os caminhos citados foram atualizados para `C:/projects/fleet/_local/...` depois da reorganização das pastas.

# F2: correções de aplicação (S3-03, S3-01, S3-02, S2-D02 e P3 mecânicos)

- **Data:** 22/10/2026, worktree `C:\projects\fleet-integ`, branch `integracao-conclusao-2026-10-22` (HEAD fcc598d, sem commit).
- **Ambiente:** somente local. App em `http://localhost:3100` (next dev) e banco Docker `supabase_db_fleet-homolog`.
  - Nada em produção. Nenhuma migration ou SQL de schema foi editada. Nenhum git write.
- **Alterações locais no banco de teste:**
  - 2 reservas de fixture `f2000000-…b1/b2` (GWM2H62, encerradas por exceção no teste).
  - Foto do GWM4J14 trocada por um PNG de 3 MB.
  - REVOKE/GRANT temporário em `corporate_mobility_points`. Os grants ficaram iguais antes e depois (`S3-02_*.json`, `grantsRestored: true`).
- **Dev server:** o processo antigo servia chunks com 404. Ele foi parado, `apps/web/.next` foi apagado e o servidor foi reiniciado com `node node_modules/next/dist/bin/next dev -p 3100`. **Ficou ligado.**
- **Método ANTES/DEPOIS no navegador:** troquei temporariamente os arquivos pela versão do HEAD (`git show`, só leitura), rodei o script e restaurei a correção.
- **Evidências:** `correcoes\F2_evidencias\`, com scripts `*.mjs`, resultados `*.json`/`*.log` e capturas em `shots\`.

## Verificação obrigatória (em apps/web, código final)

| Comando | Resultado |
|---|---|
| `node ../../node_modules/typescript/bin/tsc --noEmit` | exit 0 (`verify_tsc.log`) |
| `node node_modules/vitest/vitest.mjs run` | **101 arquivos, 1015 testes, todos passaram** (baseline 976). Somei +30 testes; o restante vem do F1 (`verify_vitest.log`). |
| `node node_modules/next/dist/bin/next lint` | "No ESLint warnings or errors" (`verify_lint.log`) |

## 1. S3-03 (P1): administrador/gestor sem CNH válida barrado em telas administrativas

**Causa:** em `lib/supabase/middleware.ts`, a isenção do portão de CNH cobria só `/fleet`, `/settings` e `/maintenance`. Por isso `/admin*`, `/analytics*`, `/dashboard*` (incluindo o command-center) e `/gate*` redirecionavam para `/account/license`.

**Correção:** a regra aprovada é que a CNH bloqueia CONDUZIR, não o acesso administrativo.
- Criei `isManagementRole()` (fleet_manager, administrator, maintenance_operator) e `isAdministrativePath()`.
- `isAdministrativePath()` cobre:
  - os prefixos `/fleet`, `/settings`, `/maintenance`, `/admin`, `/analytics`, `/dashboard` e `/gate`;
  - `/`, que é só o redirecionador de entrada por papel;
  - o detalhe exato `/reservations/[id]`, onde o gestor aprova e regulariza. A subrota `/pickup` continua barrada.
- As rotas de condução continuam barradas: `/trips*`, `/carpool*` e `/reservations/*/pickup`.
- Cada página continua aplicando a própria autorização. Exemplo: gestor em `/admin` → `/dashboard`.
- O aviso de CNH continua aparecendo: o header `x-fleet-license-missing=1` segue para o shell (o sino mostra o alerta).

**O que não mudou:**
- **employee** com CNH vencida ou NULL (decisão S3-09 pendente).
- **security**, que já era isento.
- Conta desativada e troca de senha inicial continuam avaliadas **antes** da isenção.

**Arquivos:**
- `apps/web/lib/supabase/middleware.ts`: linhas 9–27 (helpers) e 150–157 (uso).
- `apps/web/lib/supabase/middleware.test.ts`: +6 testes no bloco "CNH gate versus administrative access (S3-03)". Cobrem:
  - admin sem CNH e gestor com CNH vencida: 18 rotas administrativas abrem e o header de CNH é mantido; 5 rotas de condução continuam barradas;
  - maintenance_operator e security;
  - employee com CNH vencida e com CNH NULL, sem mudança;
  - conta desativada e troca de senha inicial, ambas ainda aplicadas antes.

**Evidência:**
- Teste com o código antigo: 3 testes falham (`S3-03_vitest_BEFORE.log`).
- Navegador com `s3admin` (CNH NULL) e `s3fmexp` (CNH vencida em 2026-01-10):

| | Rotas administrativas barradas (de 16) | Condução barrada |
|---|---|---|
| ANTES | 12 (`/admin*`, `/analytics*`, `/dashboard*`, `/gate*`), nos dois usuários | `/trips/new`, `/trips`, `/carpool` |
| DEPOIS/FINAL | 0 | as mesmas 3 |

- Sem 5xx e sem pageerror.
- `s3fmexp` em `/admin*` vai para `/dashboard`, o que é correto: o gestor não é administrador.
- Arquivos: `S3-03_BEFORE/AFTER/FINAL.json` e `shots/S3-03_*`. A captura do dashboard mostra o sino com o alerta de CNH.

**Risco residual:**
- A lista de rotas administrativas fica no middleware. Uma rota administrativa nova fora desses prefixos voltaria a cair no portão; isso fica coberto por teste.
- O detalhe da reserva abre para gestor sem CNH, inclusive para a própria reserva. A retirada continua barrada pela rota e pelas RPCs.

## 2. S3-01 (P2): anfitrião não via os passageiros confirmados

**Causa:** desde a 0185, `trip_participants` tem 2 FKs para `profiles`: `trip_participants_passenger_id_fkey` e `trip_participants_left_by_fkey` (conferido no banco local). Com isso o embed `passenger:profiles(...)` ficou ambíguo (PGRST201). O erro era ignorado e a tela mostrava "Nenhum passageiro confirmado".

**Correção:**
- Embed explícito `passenger:profiles!trip_participants_passenger_id_fkey(full_name)` em `loadHostCarpool.ts` e no `page.tsx` (lista legada de pendentes).
- Erros não são mais ignorados:
  - `loadHostCarpool` devolve `participantsUnavailable` e `requestsUnavailable`;
  - `CarpoolHostSection` mostra "Não conseguimos carregar os passageiros/pedidos agora…" (`role=alert`) em vez de "nenhum";
  - a seção continua visível quando a leitura falha;
  - `page.tsx` mostra o mesmo aviso se a leitura legada falhar.

**Arquivos:**
- `app/reservations/[id]/loadHostCarpool.ts`: 12–17, 59, 63–66, 84 e 137–141.
- `CarpoolHostSection.tsx`: props e renderização.
- `page.tsx`: 89–93 e 200–212.

**Teste:** `loadHostCarpool.test.ts` ganhou 3 testes com um cliente falso que responde PGRST201 ao embed ambíguo, como o PostgREST:
- lista os 2 passageiros;
- falha de passageiros → indisponível, não "vazio";
- falha de pedidos → indisponível.

**Evidência:** Lucas em `/reservations/7d810d39…` (f2). No banco há 2 aceitos: Mariana Teixeira e Thiago Ribeiro.
- **ANTES:** `participantsListed: []` e "Nenhum passageiro confirmado".
- **DEPOIS/FINAL:** os 2 nomes, com embarque e desembarque (`S3-01_*.json`, `shots/S3-01_*`).

**Risco residual:** outros embeds `profiles(...)` em tabelas com mais de uma FK para `profiles` teriam o mesmo problema. Não encontrei outro caso com `trip_participants`.

## 3. S3-02 (P2): busca do passageiro não fechava com segurança sem os pontos

**Causa:** em `app/carpool/searchActions.ts`, uma falha na leitura dos pontos virava `points = []`. A busca então seguia para o geocoder externo.

**Correção:**
- `if (pointsResult.status !== "ok") return { status: "unavailable", reason: "points_unavailable" }`, igual ao lado do anfitrião.
- `CarpoolSearch.tsx` mostra um texto próprio para esse motivo (chave `pointsUnavailableBanner`), sem culpar o Google.

**Arquivos:**
- `searchActions.ts`: linhas 53–58.
- `CarpoolSearch.tsx`: linha 215.

**Teste:** novo `app/carpool/searchActions.test.ts` com 3 testes:
- com a falha, o resultado é `points_unavailable` e o geocoder, o Places e o motor não são chamados;
- a mensagem técnica do banco não vaza;
- com a lista legível (mesmo vazia), a busca segue normalmente.

Com o código antigo, 2 desses testes falham.

**Evidência:** Thiago, com `REVOKE SELECT … FROM authenticated` temporário:
- **ANTES:** banner "O serviço de mapas do Google está indisponível…" (`blamesGoogle: true`).
- **DEPOIS:** "Não conseguimos consultar os locais da empresa agora, então a busca de carona foi interrompida por segurança…". 0 buscas chegaram ao motor.
- **Controle com os pontos legíveis:** a busca chega ao motor (1 registro em `carpool_search_log`) e degrada pelo Google como antes.
- O GRANT foi restaurado nas 3 execuções.

**Risco residual:** nenhum identificado. O comportamento agora é igual ao do anfitrião.

## 4. S2-D02 (P2): foto válida de 8,6 MB → 500 e página quebrada

**Caminho real investigado:**
- A foto do veículo **não** vai direto do navegador ao Storage.
- O fluxo é: navegador → server action `createVehicle`/`updateVehicle` (multipart com o File) → `uploadImmutablePhoto` no servidor (jornal, upload, download de verificação, atestação, finalize).
- Por isso, o limite que vale é o do corpo da server action: `bodySizeLimit: "8mb"` localmente e o limite de corpo da função na Vercel (4,5 MB) em produção.
- O app anunciava 10 MB, e o arquivo grande era recusado pelo Next antes da action, com 500 e página de erro global.

**Decisão:** limite anunciado e validado de **4 MB** para a foto do veículo, coerente de ponta a ponta:
- `lib/domain/vehiclePhotoLimit.ts` é a fonte única do limite, com a justificativa no código.
- **No navegador**, `VehiclePhotoInput` é usado em `VehicleForm` e em `EditVehicleForm` e valida no `onChange`:
  - aplica `setCustomValidity`, então o navegador não envia o formulário;
  - mostra a mensagem traduzida com o limite real ao lado do campo (`role=alert`).
- **No servidor**, `fleet/actions.ts` refaz a checagem com o mesmo limite.

**O que não mudou:**
- O `bodySizeLimit` (8 MB) continua, porque a CNH (5 MB) precisa dele.
- O bucket e o `uploadImmutablePhoto` continuam com 10 MB como teto externo. Nenhuma migration foi criada.

**Texto:** `errors.fleet.photoTooLarge` passou a usar `{max}` nos 4 idiomas, por exemplo "A foto deve ter no máximo {max} MB. Escolha uma foto menor ou reduza o tamanho dela antes de enviar.".

**Teste:** novo `lib/domain/vehiclePhotoLimit.test.ts` com 6 testes:
- 8,6 MB recusado e 3 MB aceito;
- o limite fica abaixo de `bodySizeLimit` (lido do `next.config.ts`) e dos 4,5 MB da Vercel, com folga de 256 KB, e abaixo do teto de 10 MB;
- as mensagens dos 4 idiomas trazem "4 MB" e não trazem "10MB".

**Evidência:** admin editando GWM4J14 com PNG válido gerado (ruído, incompressível):

| | 8,6 MB | 3 MB |
|---|---|---|
| ANTES | POST 500, `500 /fleet`, página de erro global, foto não salva | — |
| DEPOIS | nenhum POST enviado, mensagem "A foto deve ter no máximo 4 MB…" no campo e na validação nativa, sem 5xx, foto não alterada | POST 200, foto trocada, sem erros |

Arquivos: `S2-D02_*.json` e `shots/S2-D02_*`.

**Riscos residuais (registrados, não testáveis localmente):**
- O limite de 4,5 MB da Vercel não foi exercido aqui. O teste só garante a folga numérica.
- Quem burlar o JavaScript e enviar mais de 8 MB ainda recebe o erro do Next. Mais de 4,5 MB na Vercel recebe o 413 da plataforma.
- **O checklist de retirada/devolução envia várias fotos numa única action.** São até 5 MB por foto no cliente e 10 MB no servidor, e a soma pode passar de 8 MB localmente ou de 4,5 MB na Vercel, com o mesmo 500. Ficou fora deste brief porque exige decisão de desenho: envio por foto, compressão no navegador ou upload direto com URL assinada.
- A CNH (5 MB) também passa dos 4,5 MB da Vercel.
- **Recomendação estrutural:** upload direto do navegador ao Storage com URL assinada do caminho do jornal e atestação no servidor.

## 5. P3 mecânicos

Evidência: `S3-P3_BEFORE.json` (fixture b1, código do HEAD) e `S3-P3_AFTER.json` (fixture b2, código corrigido). Capturas em `shots/S3-04_*`, `S3-05_*`, `S3-07_*`, `S3-10_*` e `S3-11_*`.

| ID | Causa | Correção (arquivos) | ANTES → DEPOIS |
|---|---|---|---|
| **S3-04** | `isPrivileged` incluía security sem olhar o fluxo. A RPC 0211 só aceita security em `gate_visual`. | `lib/operations/operationExceptionUi.ts` (`canShowOperationExceptionForm`, espelho da RPC). Security só em `gate_visual`; gestor/admin dentro do escopo, já garantido pela leitura da reserva sob o RLS do gestor (fora do escopo → redirect), e a RPC checa de novo `fm_can_manage_reservation`. Uso em `reservations/[id]/page.tsx:325`. | Security em `e3…b2` (custódia): formulário **visível → oculto**. Security em gate_visual (f2…): visível → visível. |
| **S3-05** | O sucesso troca o status para `cancelled` e o formulário, com a mensagem, era desmontado. | `page.tsx`: `loadNotDepartedException()` lê `fm_operation_exceptions` (outcome `not_departed`) sob o RLS de quem vê. O aviso `role=status` usa o texto já existente `exceptionText(locale).done`, sem chave nova. Aparece só para os papéis operacionais (manager/admin/security que não são o solicitante). O rótulo para o solicitante e em `/trips` continua sendo a decisão S3-08, não alterada. | Após o envio: "" → "Exceção registrada. A reserva foi encerrada; os registros foram preservados.", e o aviso **continua após recarregar**. |
| **S3-07** | O reset automático do `<form>` do React 19 limpava o checkbox no DOM, embora o estado continuasse marcado. | `OperationExceptionForm.tsx`: um `ref` mais um efeito reaplicam o estado `confirmed` ao DOM após cada resultado. | Após o erro "Há registro de saída…": checkbox **desmarcado → marcado**. A justificativa foi mantida nos dois casos. |
| **S3-10** | `AdminWorkspace.tsx` tinha um mapa fixo em pt-BR com 22 códigos. | O mapa saiu do componente. Nova seção `auditActions` (69 códigos e um `fallback`) nos 5 arquivos do dicionário, com `lib/i18n/auditActionLabel.ts`. Código desconhecido vira "Outro evento (incident resolve)", nunca a chave crua sozinha. | Códigos crus: `/admin` 1 → 0; `/admin/audit` 15 → 0 (inclusive no filtro `select`). |
| **S3-11** | A consulta de `/analytics` não filtrava os arquivados. | `app/analytics/page.tsx`: `.is("archived_at", null)` em `fm_managed_vehicles`. | Placas arquivadas na tela: 11 → 0. |

**Testes:**
- `lib/operations/operationExceptionUi.test.ts` (6 testes):
  - matriz da regra: security × workflow, gestor/admin × escopo, demais papéis;
  - guardas de fonte para S3-05, S3-07 e S3-11.
- `lib/operations/auditActionLabel.test.ts` (6 testes):
  - os 25 códigos vistos no banco têm rótulo nos 4 idiomas;
  - o mesmo conjunto de chaves em todos os idiomas;
  - o fallback é legível.

**Riscos residuais:**
- **S3-04:** custodiantes nunca viram o formulário nesta tela, e isso não mudou. A regra de custódia continua sendo a decisão S3-06.
- **S3-05:** depende do SELECT de `fm_operation_exceptions`. Em caso de falha, o aviso não aparece, mas nenhum erro é mostrado.
- **S3-10:** o restante do `AdminWorkspace` continua com textos fixos em pt-BR, como antes. Só os rótulos de auditoria ficaram traduzidos.

**Não feitos, por decisão do dono ou fora do escopo:** S3-06, S3-08, S3-09, S3-12, S1-03, S1-07, S1-08 e S2-D03…D06.

## Arquivos alterados (F2)

**Modificados:**
- `apps/web/lib/supabase/middleware.ts`
- `apps/web/lib/supabase/middleware.test.ts`
- `apps/web/app/reservations/[id]/loadHostCarpool.ts`
- `apps/web/app/reservations/[id]/loadHostCarpool.test.ts`
- `apps/web/app/reservations/[id]/CarpoolHostSection.tsx`
- `apps/web/app/reservations/[id]/page.tsx`
- `apps/web/app/reservations/[id]/OperationExceptionForm.tsx`
- `apps/web/app/carpool/searchActions.ts`
- `apps/web/app/carpool/CarpoolSearch.tsx`
- `apps/web/app/fleet/actions.ts`
- `apps/web/app/fleet/VehicleForm.tsx`
- `apps/web/app/fleet/EditVehicleForm.tsx`
- `apps/web/app/admin/AdminWorkspace.tsx`
- `apps/web/app/analytics/page.tsx`
- `apps/web/lib/i18n/dictionaries/{types,pt-BR,en-US,es,zh-CN}.ts`

**Novos:**
- `apps/web/app/carpool/searchActions.test.ts`
- `apps/web/app/fleet/VehiclePhotoInput.tsx`
- `apps/web/lib/domain/vehiclePhotoLimit.ts`
- `apps/web/lib/domain/vehiclePhotoLimit.test.ts`
- `apps/web/lib/i18n/auditActionLabel.ts`
- `apps/web/lib/operations/auditActionLabel.test.ts`
- `apps/web/lib/operations/operationExceptionUi.ts`
- `apps/web/lib/operations/operationExceptionUi.test.ts`

**Não são do F2** (agente F1, não tocados): `lib/operations/inspectionFlow.test.ts`, `lib/operations/safeReturnCheck.test.ts`, `supabase/migrations/0215*`, `0216*` e `rollback/*`.

## Chaves i18n novas ou alteradas (types + pt-BR, en-US, es, zh-CN)

- `carpool.host.participantsUnavailable` e `carpool.host.requestsUnavailable` (S3-01).
- `carpool.newTrip.pointsUnavailableBanner` (S3-02). É irmã de `unavailableBanner`.
- `errors.fleet.photoTooLarge`, **alterada**: de "10MB" para `{max} MB`, preenchido com 4 (S2-D02).
- `auditActions.labels` (69 códigos) e `auditActions.fallback` (S3-10).
