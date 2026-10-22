# S2 — Fotos, upload, atestação e Storage (LOCAL, antes da 0214)

Data: 2026-10-22 · Branch `integracao-conclusao-2026-10-22` @ `5b5a9d0` (worktree `C:\projects\fleet-integ`, sem alteração de código e sem escrita no git) · Banco local `supabase_db_fleet-homolog` com migrations até a **0213** (a **0214 NÃO foi aplicada**: `max(version)=0213` e `md5(fm_photo_link)=bf1fef25…` igual antes e depois de todos os testes, ver `evidencias/estado_final_banco.txt`) · App dev em http://localhost:3100 · Storage local HTTP real (http://127.0.0.1:55321).

Hashes conferidos: `immutablePhoto.ts` (novo) `e2391b54…`, cópia do cliente antigo 0aa2403 `4df57d71…`, `0212` `3ad83571…`, `0214` `702c0c2d…`.

## Como foi testado

| Nível | O que foi feito |
|---|---|
| **TESTE EXECUTADO** | `scripts/photos.s2.test.ts`: vitest executando o **código real** `lib/domain/immutablePhoto.ts` e `uploadInspectionPhotos.ts` com JWT reais (login por senha), PostgREST, Storage HTTP e `fm_photo_attest` via service_role local. Dois stubs apenas: `server-only` (o mesmo do vitest.config do repo) e `getCurrentUser`, reimplementado com o ramo de fallback do original (`auth.getUser()` + `accountEnabled`), porque o cabeçalho do middleware não existe fora do Next. Cliente antigo: cópia literal de `0aa2403:apps/web/lib/domain/immutablePhoto.ts` (`scripts/legacy/`). |
| **TESTE EXECUTADO (UI)** | `scripts/ui-vehicle-photo.mjs` (Playwright, headless): login → Frota → busca da placa → “Cadastro e ações administrativas” → Editar → foto → Salvar, no app real em :3100. |
| **TESTE EXECUTADO (SQL, não destrutivo)** | A 0214 foi testada só dentro de `BEGIN … ROLLBACK` (o corpo do arquivo 0214 aplicado na transação; chamadas feitas como `authenticated` com claims JWT, ou seja, as mesmas grants e RLS do PostgREST). O md5 da função foi conferido depois. |
| INSPEÇÃO ESTÁTICA | Leitura de 0191/0199/0203/0210/0212/0214, `fleet/actions.ts`, pickup/return/gate/evidence actions e `next.config.ts`. |
| RESULTADO HISTÓRICO | Pacote: `immutablePhoto.test.ts` 8/8 (re-executado aqui: 8/8, `evidencias/unit_immutablePhoto.log`), relatório técnico FM-05. |

Para executar de novo: `bash scripts/run.sh <arquivo env do "supabase status -o env">`, `node scripts/ui-vehicle-photo.mjs [--only-big]` e `node scripts/fix-proof-revoke.mjs <env>`.

## Resultados por teste

Evidência principal: `evidencias/resultados_consolidados.json` (esperado, obtido e linhas de jornal/objeto de cada teste) e os logs `run*.log`.

| ID | Cenário | Papel / unidade | Esperado × obtido | Status |
|---|---|---|---|---|
| S2-01 | Retirada: fotos `front` e **AVARIA** (`damage`) via `uploadInspectionPhotos` | employee lucas, SP, inspeção própria | `failed=[]`; jornal `linked`; `server_verified_at` preenchido; objeto com size, mimetype e owner iguais ao jornal; 1 linha em `inspection_photos` por foto; 2 auditorias `photo.linked`. Obtido exatamente isso (201 ms). | PASS |
| S2-01b | Devolução (driver_checklist) e avaria registrada pela portaria (gate_visual) | custodian (Campinas) / security (SP) | As duas `linked` e atestadas | PASS |
| S2-02 | Original imutável | lucas (dono), fmall | Storage API: upsert e update dão “row-level security”; `remove` devolve `[]` (nada apagado); `move` falha; os bytes continuam iguais. SQL direto como authenticated: UPDATE em `storage.objects` atinge 0 linhas, DELETE é barrado por `storage.protect_delete`, e o jornal dá permission denied (`S2-02b_sql_update_delete.txt`). | PASS |
| S2-03 | Upload **cortado no meio** (socket destruído com 50% do corpo enviado) e depois retry | lucas | Nenhum objeto parcial; jornal `pending` aparece em `fm_photo_pending`; o retry conclui com o **mesmo id**: 1 objeto e 1 vínculo | PASS |
| S2-04 | Queda **após o upload e antes da atestação**, depois retry (**409 com conteúdo igual**) | lucas | `pending` sem atestação; 2º upload = 409; o retry vincula, sem duplicar o objeto (mesmo `id`/`created_at`) | PASS |
| S2-05 | Queda **após a atestação e antes do vínculo**, depois retry | lucas + service_role | Pendência atestada listada; o retry vincula 1 vez. Observação: a reatestação sobrescreve `server_verified_at` (ver D06). | PASS |
| S2-06 | Reenvio depois de concluído (2×) | lucas | Sem duplicata de jornal, objeto ou vínculo | PASS |
| S2-07 | **409 com conteúdo DIFERENTE / adulterado de mesmo tamanho** (DEF-02) | lucas | Código novo: `PHOTO_UPLOAD_FAILED` **antes** de atestar; jornal fica `pending`, sem atestação e sem vínculo; objeto preservado. `fm_photo_attest` chamado por authenticated: “permission denied”. | PASS |
| S2-07b | DEF-02 residual com o cliente antigo | lucas (tx) | Pré-0214: o cliente antigo **vincula** o objeto adulterado (lacuna conhecida). Com 0214 (tx): `PHOTO_SERVER_VERIFICATION_REQUIRED`. Banco inalterado. | PASS |
| S2-08 | MIME divergente | lucas | Bytes JPEG declarados como PNG, HEIC e SVG: `INVALID_PHOTO` sem criar jornal. `text/html` direto no bucket: “mime type not supported”. Objeto gravado como `image/jpeg` com jornal `image/png`: não vincula (`PHOTO_LINK_PENDING`), mas fica **atestado** (D06) e preso (D05). | PASS |
| S2-09 | **Sessão perdida** no meio (signOut local): (a) antes da atestação, (b) depois da atestação e antes do vínculo | lucas | As duas dão `PHOTO_LINK_PENDING`, com (a) não atestado e (b) atestado; ambas aparecem em `fm_photo_pending`; uma nova sessão conclui sem duplicar | PASS |
| S2-10 | Isolamento | mariana, fmcampinas, maint, security, lucas, **admin da org B**, anon, service_role com ator errado | Todas as 18 tentativas negadas: `NOT_AUTHORIZED` em begin/finalize; RLS barra upload em pasta alheia, de outra unidade ou de outra org; org B não baixa nem assina objeto de A e tem `pending=[]`; anon dá permission denied; `attest` com ator errado ou da org B dá `PHOTO_INTEGRITY_MISMATCH`; UPDATE direto de `vehicles.photo_storage_path` (fmall e lucas) dá permission denied (0210); SELECT no jornal dá permission denied | PASS |
| S2-11 | Limite de 10 MB e custo de download + SHA-256 | fmall, GWM3B52 | Arquivos de 9,5 MB e de exatamente 10 MB passam (≈450 ms; RSS do processo +60 a +76 MB por foto). 10 MB+1: `INVALID_PHOTO` no código e **413** no bucket (0203). | PASS |
| S2-12 | URL assinada local e leitura por papel | vários | O executor gera a URL, recebe HTTP 200 e o SHA confere. fmall e security (SP) geram. **mariana e thiago** (outros colaboradores), **fmcampinas** (outra unidade) e **org B**: negado (“Object not found”), e 0 linhas em `inspection_photos`. URL expirada: HTTP 400. | PASS |
| **S2-13** | Upload de objeto sem jornal na pasta da própria inspeção + **INSERT direto em `inspection_photos`** | lucas (tx) | Esperado: vínculo só por `fm_photo_finalize`. Obtido: upload sem jornal **OK**; INSERT **OK** pré-0214 e **OK com 0214** | **FAIL → D01** |
| S2-14 | **Previsão da 0214**: cliente antigo × código novo, inspeção e veículo | lucas, fmall | Cliente antigo real via HTTP, pré-0214: conclui (jornal `linked`, `server_verified=false`). Com 0214 (tx): finalize com 1 e com 2 argumentos (inspeção) e com 2 argumentos (veículo) dão `PHOTO_SERVER_VERIFICATION_REQUIRED`. Código novo (attest + finalize) com 0214: OK (inspeção e veículo). Pendência criada pelo cliente antigo é recuperável pelo código novo. md5 da função inalterado. | PASS |
| S2-15 | Recuperação: `fm_photo_pending` e nada apagado | lucas | Contagens só crescem (no momento do S2-15: objetos 10→29, jornal 10→28, vínculos 0→12; estado final em `estado_final_banco.txt`). As 2 pendências irrecuperáveis (S2-07 e S2-08e) continuam listadas. | PASS |
| **S2-16** | 3 envios **simultâneos** do mesmo arquivo | lucas | Dados consistentes (1 jornal, 1 objeto, 1 vínculo), mas **1 das 3 chamadas devolve `PHOTO_UPLOAD_FAILED`** (reproduzido 3/3, `run4_S2-16_repeticoes.log`) | **FAIL → D03** |
| **S2-17** | Veículo: foto A → B → A | fmall | O 3º envio informa sucesso, mas o veículo **continua com B** | **FAIL → D04** |
| S2-UI-1 | **Editar veículo + foto + Salvar (UI real)** | fleet_manager fmall, todas as unidades (GWM5O35, SP) | Formulário fecha; `photo_storage_path` aponta para o novo caminho; jornal `linked` e atestado (`by`=fmall); auditoria 1; miniatura carrega pela URL assinada (`naturalWidth>0`). 853 ms. | PASS |
| S2-UI-2 | Idem | administrator (GWM9J29, Rio) | Idem | PASS |
| S2-UI-3 | Idem | fleet_manager **Campinas** no próprio veículo (GWM6T36) | Idem | PASS |
| **S2-UI-4** | Foto válida de **8,6 MB** (< 10 MB anunciado) pela edição | fmall (GWM2H62) | Server Action: **500 “Body exceeded 8mb limit”**; a página inteira cai no “Algo deu errado por aqui” e nada é salvo (nem os outros campos) | **FAIL → D02** |

Telas: `evidencias/ui_*_antes_salvar.png`, `ui_*_depois.png`, `ui_fmall_GWM2H62_apos_salvar.png`. Dados: `ui_vehicle_photo.json`, `ui_vehicle_photo_big.json`.

## Item 4: foto do veículo pela edição da Frota (não pode regredir)

**Executado:** com 0210 + 0212 e o código novo no banco local, o fluxo exato do app funciona para gestor de todas as unidades, gestor de Campinas (no próprio veículo) e administrador (S2-UI-1 a 3). Fotos ≤ 8 MB funcionam; acima disso o formulário falha (D02, problema anterior a esta integração).

**Caminho (prova de código):** é o caminho **novo** `fm_photo_begin → upload → download/SHA → fm_photo_attest → fm_photo_finalize → fm_photo_link`. **Não** é o caminho antigo (upload + UPDATE em `vehicles.photo_storage_path`).
- `apps/web/app/fleet/actions.ts:346-348` (`updateVehicle`) e `:263-264` (`createVehicle`) chamam `uploadVehiclePhoto`, que em `:33` chama `uploadImmutablePhoto(supabase,"vehicle",id,null,file)`.
- `apps/web/lib/domain/immutablePhoto.ts:21` `fm_photo_begin`; `:27` upload com `upsert:false`; `:29-30` download e SHA-256 dos bytes armazenados; `:31-34` `fm_photo_attest` (service_role); `:35-36` `fm_photo_finalize(p_id,p_sha256)`.
- `supabase/migrations/0199_photo_finalize_integrity.sql:43-48`: `fm_photo_finalize` → `fm_photo_link`; em `:31` está o `update vehicles set photo_storage_path=…`, executado dentro da função SECURITY DEFINER.
- O `.update({...})` de `actions.ts:352-366` **não contém** `photo_storage_path`.
- **0210** (`0210_vehicle_operational_permissions.sql:370-377`) remove o UPDATE amplo e concede UPDATE apenas nas colunas cadastrais. `photo_storage_path` fica de fora, como diz o comentário em `:381`. Por isso a escrita direta é negada a todos (S2-10: “permission denied for table vehicles” para fmall e lucas). Isso não afeta o app, porque o app só escreve essa coluna pela função definer.
- **A 0214 afeta este fluxo?** Ela só altera `fm_photo_link`, que **é** usada pelo fluxo de veículo (via `fm_photo_finalize`). Com o código novo, o fluxo continua funcionando (S2-14 `tx_novo_veiculo_0214 = OK`). Com o código antigo (produção 0aa2403), o fluxo **falha** depois da 0214 (S2-14 `tx_antigo_veiculo_0214 = PHOTO_SERVER_VERIFICATION_REQUIRED`). Atenção: em `updateVehicle`, a foto é enviada **antes** do UPDATE cadastral (`:346-349` retorna erro). Então, com o código antigo e a 0214 aplicada, **a edição inteira do veículo com foto falha**, não só a foto.

## Item 6: previsão da 0214 (clientes antigos)

**Executado em tx:** com 0214, o cliente antigo (sem atestação) recebe `PHOTO_SERVER_VERIFICATION_REQUIRED` nos dois overloads de `fm_photo_finalize`; o código novo passa.

**Estático:** depois da 0214, toda instância escritora com o código **0aa2403** falha ao finalizar **novas** fotos nestes fluxos:
1. Frota › Novo veículo com foto (`fleet/actions.ts:264`): o veículo é criado e a mensagem diz “A foto não foi concluída…”.
2. Frota › Editar veículo com foto (`:347-348`): **nada é salvo** e aparece `photoUploadFailed`.
3. Checklist de retirada (`reservations/[id]/pickup/actions.ts:96`): `failedPhotoAngles`; com avaria, `damageEvidenceMissing=true`.
4. Checklist de devolução (`return/actions.ts:99`): idem.
5. Portaria: conferência visual com avaria (`gate/visualActions.ts:22`): “Conferência salva; a foto ainda não foi enviada”.
6. Complementar evidência (`reservations/[id]/evidence/[inspectionId]/actions.ts:20`).
7. Qualquer cliente externo ou script que chame `fm_photo_finalize` diretamente.

Em todos os casos o objeto fica no Storage e o jornal fica `pending`. Nada se perde, e a pendência é recuperável depois do deploy do código novo se o usuário reenviar o **mesmo arquivo** (S2-14). Fotos já `linked` sem atestação (legado) continuam válidas, porque o retorno antecipado `state='linked'` vem antes da checagem.

Pré-condições da 0214, pela inspeção estática:
- (a) Todas as instâncias com o código novo.
- (b) `SUPABASE_SERVICE_ROLE_KEY` presente em todas elas. Sem a chave, `createSupabaseAdminClient` lança erro e todas as fotos ficam `PHOTO_LINK_PENDING`.
- (c) Um upload real atestado em homologação.
- (d) Correção de D01; caso contrário, a 0214 não garante que toda evidência vinculada foi atestada.

## Defeitos

| ID | Sev. | Reprodução | Causa provável | Correção proposta |
|---|---|---|---|---|
| **S2-D01** | **P2** (integridade; vem da 0177, não é regressão) | Como executor da inspeção: upload de qualquer imagem em `<org>/<inspecao>/<qualquer_nome>.png` sem `fm_photo_begin`, depois `insert into inspection_photos(...)` via PostgREST. O insert é aceito pré e **pós-0214** (S2-13). | `authenticated` mantém `INSERT` em `inspection_photos` (política `fm_photo_own_insert`, 0177). O jornal, o hash, a atestação e a auditoria `photo.linked` ficam de fora; a 0214 só endurece `fm_photo_link`. | `revoke insert on public.inspection_photos from authenticated;` (e remover/neutralizar as políticas de INSERT). O único escritor é `fm_photo_link` (SECURITY DEFINER; único `insert into inspection_photos` em `pg_proc`). **Provado em tx:** com o revoke, o INSERT direto dá “permission denied” e o finalize do código novo com 0214 continua OK (`evidencias/S2-D01_prova_correcao.txt`). Avaliar também restringir o INSERT no bucket aos caminhos com jornal `pending`. |
| **S2-D02** | **P2** (UX/perda de edição; anterior à integração) | Editar veículo → foto válida de 8,6 MB → Salvar: 500 “Body exceeded 8mb limit”, página de erro global, nada salvo (S2-UI-4). | O limite do código e do bucket é 10 MB, mas o `serverActions.bodySizeLimit` é `8mb` (`next.config.ts`). Na Vercel, o limite de corpo da função é 4,5 MB (**NÃO TESTADO**, inferência estática): em produção, fotos acima de ~4,5 MB devem falhar do mesmo jeito. | Validar o tamanho no cliente antes do submit e mostrar mensagem amigável; comprimir/redimensionar no navegador. Opção estrutural: upload direto do navegador ao Storage (URL de upload assinada para o caminho do jornal), com atestação no servidor. Alinhar os limites anunciados (UI/código/bucket/plataforma). |
| **S2-D03** | P3 | 3 chamadas simultâneas com o mesmo arquivo e o mesmo ângulo (por exemplo, a mesma foto anexada 2× no checklist; `uploadInspectionPhotos` usa `Promise.allSettled`): 1 delas dá `PHOTO_UPLOAD_FAILED` em 3 de 3 execuções, embora a foto fique vinculada. | Corrida: a chamada que recebe 409 baixa o objeto enquanto o upload concorrente ainda não terminou, e o download falha ou vem incompleto (`immutablePhoto.ts:30`). | Depois de um 409 ou download falho: repetir o download com backoff curto, ou rechamar `fm_photo_begin` e tratar `state='linked'` como sucesso. Devolver `PHOTO_LINK_PENDING` (retentável) em vez de falha definitiva. Deduplicar arquivos idênticos no mesmo ângulo antes do envio. |
| **S2-D04** | P3 (anterior: 0aa2403 tem o mesmo retorno antecipado) | Veículo: foto A → B → A. O 3º envio informa sucesso, mas o veículo continua com B (S2-17). | `fm_photo_begin` devolve o jornal existente `linked` para (veículo, sha), e `immutablePhoto.ts:25` retorna sem religar. `fm_photo_link` também retorna cedo para `linked`. | Para `kind='vehicle'`: quando o jornal já está `linked` e `vehicles.photo_storage_path` aponta para outro caminho, chamar uma RPC definer que repõe o caminho (verificando `fm_can_manage_vehicle`, a atestação e a auditoria). Ou fazer a action informar “essa já é uma foto anterior”. |
| **S2-D05** | P3 | Objeto no caminho do jornal com bytes ou content-type errados (S2-07, S2-08e): a pendência fica **presa para sempre**. O arquivo correto tem o mesmo SHA, portanto o mesmo caminho, que já está ocupado e é imutável. | Caminho endereçado só por conteúdo e unicidade `(org,kind,target,sha,angle)`. Além disso, `fm_photo_pending` não tem consumidor no app (grep sem chamadas): o usuário não vê as pendências. | Estado `rejected` + nova tentativa com sufixo de tentativa no caminho, preservando o objeto inválido como evidência. Expor as pendências na tela de evidências ou em uma visão operacional. |
| **S2-D06** | P3 (observação de semântica) | (a) S2-08e: `server_verified_at` é preenchido mesmo com o objeto gravado como `image/jpeg` e o jornal `image/png`; o vínculo é barrado depois. (b) S2-05: a reatestação sobrescreve o instante. | `fm_photo_attest` compara só os valores passados pelo servidor com o jornal; não consulta `storage.objects` (metadata/owner) e faz `set server_verified_at=now()` incondicional. | Em `fm_photo_attest`: conferir também `metadata.size/mimetype` e `owner` do objeto e usar `coalesce(server_verified_at, now())`. |

## Observações (sem defeito)

- **Memória e tempo (local, Node 24, processo vitest):** o fluxo mantém na memória o arquivo, o `arrayBuffer` e o blob baixado com o seu `arrayBuffer`, ≈4× o tamanho. Medido: +60 a +76 MB de RSS e ≈0,45 s por foto de 10 MB. Na prática o limite de 8 MB do Server Action (4,5 MB na Vercel) restringe isso por requisição. O download de verificação dobra o tráfego Storage→função por foto.
- O Storage de fato não cria objeto parcial quando a conexão cai no meio do upload (S2-03).
- A leitura de evidência está restrita como aprovado: o colaborador lê só a própria inspeção; gestor fora da unidade e outra org são negados. **security** (portaria SP) e **fmall** (todas as unidades) leem a inspeção de retirada de SP. Isso já era o comportamento das políticas existentes e não foi considerado permissão nova.
- O objeto sem jornal (S2-13) também é aceito pelo bucket. Sem o INSERT direto (D01), ele fica órfão, sem efeito.

## NÃO TESTADO

- Storage **real remoto** (Supabase hospedado), CDN e URLs assinadas de produção.
- **Queda de rede real** (simulei o corte com socket destruído e a perda de sessão com signOut local; não houve rede móvel ou proxy real).
- **Limites do runtime serverless** (memória e tempo de função na Vercel, limite de 4,5 MB de corpo).
- JWT expirado “naturalmente”: a sessão perdida foi simulada por signOut local.
- Criação de veículo **com foto** pela UI (o caminho é o mesmo de `uploadVehiclePhoto`, verificado estaticamente).
- Checklist de retirada/devolução **pela UI**. A biblioteca chamada pelas actions foi executada com JWT real; o RPC do checklist não foi refeito para não alterar reservas ativas usadas por outros agentes.
- Aplicação persistente da 0214 (fora do escopo; feita só em tx).

## Efeitos no banco local compartilhado (aditivos; nada foi apagado)

- Criados: org fictícia **“Org B S2 (ficticia, local)”** (`…0000b2`) e o usuário `s2admin@orgb-s2.test` (administrator). A senha fica só em `scripts/.orgb.json`.
- ≈30 objetos, jornais e vínculos de foto nas inspeções **históricas** `b16613dd` (lucas, c1), `3cb3bb09` (security, c1) e `e8618b22` (custodian, c8). São append-only por design.
- Ficam 2 jornais `pending` de propósito (casos presos D05) e 2 jornais `linked` sem atestação, criados pela simulação do cliente antigo.
- Fotos de veículo alteradas: GWM3B52, GWM5O35, GWM9J29 e GWM6T36. Ficaram 2 objetos órfãos sem jornal (S2-13 e a prova do D01).
- Nenhum `db reset` foi feito.
