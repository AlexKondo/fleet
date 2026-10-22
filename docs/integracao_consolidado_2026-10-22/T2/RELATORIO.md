# T2 — Fotos: transporte direto ao Storage, atestação e recuperação (LOCAL)

Data: 2026-10-22 · Agente: T2 · Worktree `C:\projects\fleet\_local\fleet-integ`, branch `integracao-consolidado-2026-10-22`, commit **d9d5fc2**.
Ambiente: Supabase LOCAL (Docker `supabase_db_fleet-homolog`, API `http://127.0.0.1:55321`, migrations 0001→**0227** aplicadas, `max(version)=0227`), GoTrue/Storage/PostgREST locais reais, app `next dev` em `http://localhost:3100`, Playwright (Chromium headless) via `C:/projects/fleet/testing/live-demo/`.
Regras respeitadas: nenhum acesso a produção/host remoto/API paga; nenhuma edição de código-fonte ou migration; nenhum `git` de escrita; banco **não** foi resetado. Nenhuma chave ou senha foi impressa (as credenciais dos usuários T2 ficam só no scratchpad da sessão).

> Este relatório **não** declara homologação nem fidelidade visual.

## Legenda das evidências

- **EXECUTADO**: teste rodado agora, contra o app e o Storage/banco locais (resultado em JSON + capturas).
- **INSPEÇÃO ESTÁTICA**: leitura do código/migrations, sem execução.
- **HISTÓRICO**: resultado de rodadas ou pacotes anteriores, citado e não repetido.
- **NÃO TESTADO**: fora do alcance local ou fora do escopo. O motivo vem indicado.

Resultados brutos estão em `ui-vehicle.json`, `ui-checklist.json`, `ui-faults.json` e `api-photos.json`, nesta pasta. As capturas estão em `shots\` e os scripts em `scripts\`.

## Resumo

| Bloco | Executados | PASS | FAIL | OBS |
|---|---|---|---|---|
| 1. Foto do veículo pela UI (V01–V12) | 12 | 11 | 1 (V09) | 0 |
| 2. Checklists e evidência pela UI (C01–C10) | 10 | 10 | 0 | 0 |
| 3. Quedas e recuperação pela UI (F01–F05) | 10 | 8 | 1 (F03) | 1 |
| 3/4/5. Rota `/api/photos` + Storage (A01–A17) | 22 | 18 | 1 (A06b) | 3 |
| Testes focais do pacote (vitest, 7 arquivos) | 38 | 38 | 0 | — |

O fluxo novo funciona de ponta a ponta. Em todas as execuções pela UI, nenhuma requisição de server action carregou os bytes da foto: o maior corpo de action foi de 1.300 B, mesmo com fotos de 8,6 MiB e 10 MiB. A rota `/api/photos` recebeu só JSON (62 a 212 B). Fotos de 8,6 MiB e de 10 MiB foram salvas sem erro 500. Com 10 MiB + 1 byte, aparece uma mensagem clara e nada é enviado. A foto do veículo não regrediu: admin, gestor total e gestor limitado conseguem criar e editar dentro do escopo, e fora do escopo o acesso é negado.

Defeitos encontrados: **1 P2** (falha silenciosa da foto de avaria na portaria) e **6 P3**. Há também 1 decisão pendente sobre o limite de 5 MB no checklist contra 10 MB nos demais caminhos.

## Fixtures próprias (prefixo T2), criadas só no banco local

Scripts: `scripts/setup-t2*.mjs|sql`. Foram reaproveitados a organização Aurora e as unidades do seed, sem alterar as linhas dos outros agentes.

- **Usuários** criados no GoTrue local: `t2sp`, `t2camp`, `t2rio` e `t2other` (colaboradores com CNH válida), além de `t2orgb` (administrador da Org B fictícia `…0b2`).
- **Veículos** `TDA*`:
  - SP (gate_visual): `TDA1A01`–`A09`, `TDA1B10`, `TDA1C01`–`C05`.
  - Campinas (key_custody): `TDA2A01`, `A02`, `A09`, `TDA2B11`.
  - Rio (key_custody): `TDA3A01`, `A02`.
- **Reservas** confirmadas com janela aberta: tabela `t2.r` (`sp1`, `sp2`, `camp`, `rio`, `f1`–`f4`, `g1`–`g5`).
- **Perfis de equipamento fictícios** (obrigatórios: Extintor e Kit Primeiros Socorros; opcional: Cabo Tipo 2), criados pela RPC real `fm_equipment_profile_save` como admin. O seed não os tinha, e sem eles a retirada é recusada ("configuração de equipamentos"), como mostra `F01` na primeira tentativa.
- **Chaves de Campinas e Rio** entregues pela custodiante Patrícia por meio de `fm_key_command` (real).
- Outros usuários do seed usados em papéis próprios: `admin`, `fmall`, `fmcampinas`, `security` e a custodiante.
- Alterações temporárias desfeitas no fim do teste:
  - `fm_member_access` do `t2other` foi desativado e depois reativado (A12).
  - O escopo de Campinas do `fmcampinas` foi desligado e religado (A14).

---

## 1. Foto do VEÍCULO pela UI: fluxo novo (EXECUTADO, `scripts/ui-vehicle.mjs`)

Rede capturada em cada caso:
- O "action máx" é o maior corpo POST com cabeçalho `next-action`.
- A rota `/api/photos` registra o corpo JSON.
- O Playwright não expõe o corpo binário do POST ao Storage. A prova de que os bytes chegaram é o objeto em `storage.objects` (tamanho) somado à verificação feita no servidor (jornal `server_verified_at`).

| ID | Cenário | Papel / unidade | Esperado | Obtido | Status | Evidência |
|---|---|---|---|---|---|---|
| V01 | Editar `TDA1A01` com foto de 0,29 MiB | admin / SP | Sucesso; bytes só no Storage; vínculo | Formulário fechou em 885 ms; action 1.293 B; `/api/photos` ≤ 201 B; objeto 300.000 B; vinculado | PASS | shots/V01.png |
| V02 | Editar `TDA1A04` com 3 MiB | fmall (gestor total) | idem | 1.401 ms; action 1.291 B; objeto 3.145.728 B; vinculado | PASS | V02.png |
| V03 | Editar `TDA2A01` com 4,5 MiB | fmcampinas (limitado, dentro do escopo) | idem | 2.427 ms; action 1.295 B; objeto 4.718.592 B; vinculado | PASS | V03.png |
| V04 | Editar `TDA1A01` com **8,6 MiB** | fmall | Sucesso, sem 500 | 1.904 ms; action 1.293 B; objeto 9.017.754 B; 0 respostas 5xx | PASS | V04.png |
| V05 | Editar `TDA2A01` com **10 MiB** (exato) | admin | Sucesso, sem 500 | 1.995 ms; action 1.295 B; objeto 10.485.760 B; 0 respostas 5xx | PASS | V05.png |
| V06 | Editar com **10 MiB + 1 B** | fmall | Mensagem clara; nada enviado | "A foto deve ter no máximo 10 MB. Escolha uma foto menor…"; 0 requisições; foto anterior mantida | PASS | V06.png |
| V07 / V08 | JPEG / WEBP | admin | Aceitos | Vinculados | PASS | V07/V08.png |
| V09 | **HEIC** | admin | Recusa com mensagem de tipo | O formulário aceita o arquivo, salva os dados e diz que a foto "ficou pendente… consulte Minhas fotos pendentes", mas não existe pendência | **FAIL → T2-D02** | V09.png |
| V10 | **Criar** veículo `TDA1B10` com 8,6 MiB | admin / SP | 1 veículo; foto vinculada | 1 veículo; foto vinculada; action 1.300 B | PASS | V10.png |
| V11 | Criar `TDA2B11` com foto | fmcampinas / Campinas | Veículo na unidade do escopo; foto vinculada | unit = Campinas; vinculada | PASS | V11.png |
| V12 | Foto exibida na Frota (link assinado) | admin / fmall / fmcampinas | Imagem carregada | 2 imagens carregadas para cada papel | PASS | V12_*.png |
| A11* | Gestor limitado **fora do escopo** (Rio), via rota e Storage | fmcampinas | Negado | begin 403; upload direto 400 (RLS) | PASS | api-photos.json |

\* O caso fora do escopo foi executado pela rota real (A11), porque a UI não oferece edição de veículo fora do escopo.

## 2. Checklists com MÚLTIPLAS fotos (EXECUTADO, `scripts/ui-checklist.mjs`)

Todos os casos foram completados pela UI, com os equipamentos fictícios marcados. A UI só pede fotos quando "Avaria identificada" está marcado (decisão de produto já registrada no código), e por isso todos os casos com fotos têm avaria.

| ID | Cenário | Papel / unidade | Esperado | Obtido | Status |
|---|---|---|---|---|---|
| C01 | Retirada com 6 fotos: 2× frente, traseira de 4,5 MiB, rodas, 2× avaria | t2sp / SP | Salvo; 6 fotos vinculadas | Redirecionado para /trips; fotos `back,damage×2,front×2,wheels`; jornal 6/6 linked e verificado; action 1.053 B; 0 respostas 5xx | PASS |
| C02 | Portaria: conferência visual de retirada com avaria e foto | security / SP | Salvo; foto vinculada | Redirecionado para /gate; `damage` vinculada; action 728 B | PASS |
| C03 | `sp2`: retirada sem avaria (motorista e portaria), saída e chegada físicas em /gate/history | t2sp + security | Pré-requisito da devolução | 1 saída, 1 chegada | PASS |
| C04 | Devolução com 5 fotos (lateral esquerda, lateral direita, interior de 1,2 MiB, 2× avaria incluindo uma de 4,9 MiB) | t2sp / SP | 5 vinculadas | 5/5 linked; 2.740 ms | PASS |
| C05 | Portaria: devolução com avaria e foto de 4,8 MiB | security / SP | Vinculada | PASS em 1.259 ms | PASS |
| C06 / C07 | Retirada (frente, traseira, avaria) e devolução (2× rodas, avaria de 2 MiB) | t2camp / **Campinas custódia** | Vinculadas | 3/3 + 3/3 | PASS |
| C08 / C09 | Retirada (interior, 2× avaria incluindo 3 MiB) e devolução (frente, lateral esquerda, avaria) | t2rio / **Rio custódia** | Vinculadas | 3/3 + 3/3 | PASS |
| C10 | Evidência adicional (`/reservations/[id]/evidence/[inspectionId]`): 2 fotos "interior" (8,6 MiB + 0,6 MiB) | t2sp | Anteriores preservadas, mais 2 | 6 → 8 fotos; "anteriores preservadas"; action 0 B | PASS |

Uma observação de regra, que não é defeito: avaria registrada na retirada SP bloqueia a saída física ("Saída impedida"). Por isso a devolução SP foi feita na reserva `sp2`. O C01 levou 18,9 s, mas foi a primeira compilação da rota em modo dev; o C04, com 5 fotos, levou 2,7 s.

## 3. Quedas e recuperação

### 3a. Pela UI, com falhas injetadas no navegador (EXECUTADO, `scripts/ui-faults.mjs`)

| ID | Cenário | Esperado | Obtido | Status |
|---|---|---|---|---|
| F01 | Retirada SP: upload da foto de **avaria interrompido no meio** (POST ao Storage abortado) | Checklist salvo; aviso; pendência sem objeto | Checklist salvo com `front`; aviso "A foto da avaria é obrigatória…"; jornal `pending`; 0 objeto | PASS (texto do aviso: T2-D07) |
| F01b | Motorista clica de novo em "Registrar" no mesmo formulário | Conclui só a foto, sem 2º checklist | 1 inspeção; `damage` vinculada (record_pickup idempotente + begin devolve `linked` para a frente) | PASS |
| F02 | **Queda após o upload e antes da atestação** (POST `finish` abortado) | Objeto existe; pendente não verificado; sem vínculo | Objeto de 1.500.000 B com owner correto; `pending`, não verificado; 0 vínculo | PASS |
| F02w | Recuperação em `/account/photos` com arquivo **diferente** de mesmo tamanho | "Selecione o arquivo original" | Mensagem exibida; nada enviado | PASS |
| F02r | Recuperação com o **original** (Storage responde 409 e o servidor verifica) | Concluída; sem sobrescrita | "Foto concluída."; vinculada; objeto inalterado | PASS |
| F03 | **Portaria**: foto de avaria cai (Storage abortado) | Aviso específico e caminho de recuperação | **Nenhum aviso.** O operador é levado sozinho para "Evidências do checklist" sem saber que a foto faltou; a conferência com avaria fica sem foto | **FAIL → T2-D01 (P2)** |
| F03r | Recuperação da foto da portaria por `/account/photos` | Concluída | "Foto concluída."; `damage` vinculada | PASS |
| F04 | Foto do veículo com `finish` abortado | Dados salvos; foto anterior mantida; pendência | "Os dados foram processados, mas a foto ficou pendente…"; nome alterado; foto anterior mantida; `pending` | PASS |
| F04r | "Preparar nova tentativa preservando o original", depois reenvio | Caminho rotacionado; histórico; objeto antigo preservado; vínculo novo | Novo caminho; `fm_photo_attempt_history`=1; objeto antigo=1; veículo aponta para o novo | PASS |
| F05 | Campo de foto do checklist com 8,6 MiB | — | "Arquivo maior que 5MB — escolha uma foto menor." | OBS → decisão D-1 |

### 3b. Pela rota real `/api/photos` + Storage (EXECUTADO, `scripts/api-photos.mjs`, `scripts/api-partial.mjs`)

O script reproduz o que `directPhotoUpload.ts` faz no navegador: begin (JSON) → upload direto, sem upsert, com a sessão e a chave pública → finish (JSON). A sessão é o cookie de um login real.

| ID | Cenário | Esperado | Obtido | Status |
|---|---|---|---|---|
| A01 | Origem diferente / corpo > 4096 B / anônimo / JSON inválido | 403 / 413 / 401 / 400 | 403 / 413 / **307 → /login** / 400 | PASS (anônimo: T2-D06) |
| A04 | **409 mesmo conteúdo** e retry com a mesma identidade | Mesmo id/caminho; 2º upload recusado; 1 vínculo | Mesmo id; uploads 200 / **409 Duplicate**; finish 200/200; 1 vínculo; begin depois devolve `linked` | PASS |
| A05 | **Arquivo ADULTERADO de mesmo tamanho** (1 byte alterado, assinatura PNG intacta) | Recusa; adulterado nunca vinculado | finish 409 sem atestação; reenvio do original bloqueado (400 Duplicate); restart 204 → upload em novo caminho → vinculado; objeto adulterado preservado | PASS (UX: T2-D05) |
| A06 | Metadados errados (mimetype jpeg em bytes PNG); **owner errado** (fmall ocupa o caminho do admin); **caminho errado** | Nenhum vínculo | Os 3 casos: finish 409, `pending` não verificado, veículo não aponta para nenhum deles; finish por fmall do id do admin negado | PASS |
| A06b | Outra conta com escopo cria o objeto no caminho do jornal alheio | Storage deveria impedir | Upload 200: a pendência do dono fica bloqueada até um restart | **FAIL → T2-D03** |
| A07 | **A → B → A** na foto do veículo | A, depois B, depois A de novo, sem novo upload | p1=A, p2=B, p3=A; 2º A: begin `linked`, upload pulado, finish 200; objetos A e B preservados; 2 auditorias de A | PASS |
| A08 | **Restart concorrente à atestação** (2 abas: finish de 10 MiB × `fm_photo_restart` com atraso de 0–600 ms, 6 rodadas) + caso determinístico | Nunca vincular caminho não verificado; estado consistente | 6/6: restart venceu, finish 409, `pending`, 0 vínculo, consistente; determinístico: atestação do caminho antigo após restart → `PHOTO_ATTEMPT_CHANGED` | PASS |
| A09 | **Queda após a atestação e antes da finalização** | Pendente + verificado, listado, retomável | Atestação 204; `pending` + verificado; listado em `fm_photo_pending`; finish 200 → 1 vínculo | PASS |
| A17 | **Upload interrompido no meio do corpo** (socket cortado a 30% de 3 MiB) | Nenhum objeto parcial | 0 objeto; finish 409; reenvio 200; finish 200; vinculado. Repetição: idem. (1ª execução: finish 409 levou 25,8 s; repetição: 2,4 s; ver Observações) | PASS |
| A10 | **Sessão expirada** (JWT vencido) e **sessão revogada** (logout) com cookie antigo | Storage recusa token vencido; rota recusa sessão revogada | Upload com JWT vencido 400; finish com sessão revogada 307 → /login; jornal `pending` | PASS |
| A10b | Token de sessão revogada, ainda dentro da validade, no Storage | — | Upload 200: comportamento padrão do Supabase (JWT sem estado); o vínculo exige sessão válida | OBS |
| A11 | **Conta errada**: colaborador na inspeção alheia; Org B; gestor limitado no Rio; colaborador na foto de veículo | Todos negados | begin 403; finish do id alheio 409; upload 400; pendências alheias invisíveis; restart alheio 400; Org B 403/400; fmcampinas no Rio 403/400; colaborador em veículo 403 | PASS |
| A11b | Código HTTP do finish de id alheio | 403 | 409 `photo_pending` | OBS → T2-D05 |
| A12 | Conta **desativada** | Negada | begin 403; Storage 400 | PASS |
| A13 | **Original preservado**: upsert, PUT, DELETE no Storage (dono e admin); DELETE/UPDATE/INSERT diretos | Tudo negado; bytes inalterados | upsert 400; PUT **500** (negado; ver Obs.); DELETE devolve 200 `[]` (nada apagado); sha e `updated_at` inalterados; delete em `inspection_photos` apagou 0 linha (RLS); UPDATE no jornal negado; INSERT direto negado; DELETE em `storage.objects` negado; histórico protegido por trigger até para o postgres | PASS |
| A14 | `fm_photo_pending`; restart de foto vinculada; perda e volta do escopo | Só o autor vê; restart em linked negado; sem escopo não lista nem finaliza | Autor vê, admin não; restart 400 `PHOTO_ALREADY_LINKED`; sem escopo: não lista, finish 409; escopo de volta: lista, finish 200 | PASS |
| A15 | **CONTRACT**: atestação de 5 argumentos (escritor c6b26da), finalize sem atestar (escritor 0aa2403), atestação pelo usuário, INSERT direto, retomada pelo escritor novo | Antigos negados; retomada OK | 5 args 403 "permission denied"; finalize 400 `PHOTO_SERVER_VERIFICATION_REQUIRED`; usuário 403; INSERT 403; jornal `pending`; finish novo 200 `linked` | PASS |

## 4. Limites (EXECUTADO)

| ID | Cenário | Obtido | Status |
|---|---|---|---|
| A03 | 3 / 4,5 / 8,6 / 10 MiB pela rota | Todos begin/upload/finish 200, `linked` + verificado; finish 227 / 1.134 / 1.521 / 408 ms. 10 MiB + 1: begin 400; upload direto 400 (limite do bucket) | PASS |
| A02 | Tipos: begin com HEIC, HTML, PDF, GIF e SVG; HTML disfarçado de PNG; uploads diretos ao bucket | begin 400 para todos os tipos; HTML-como-PNG: o Storage aceita (o content-type é do cliente), o finish dá 409 e não há atestação nem vínculo. Bucket: PDF 400, HTML 400, **HEIC 200** (bucket ainda permite `image/heic`; ver T2-D02/D03) | PASS |
| A03m | Memória e tempo: 5 verificações concorrentes de 10 MiB (download + SHA-256 no servidor) | Todas 200; 4,2 s de parede; RSS do processo `next dev` de 7.481 → 7.628 MiB (Δ ≈ 147 MiB). O processo dev, compartilhado com outros agentes, já ocupava cerca de 9 GB, então a medida é aproximada. Pela inspeção estática, `storedPhoto.ts` mantém o objeto inteiro em memória (Blob + ArrayBuffer), cerca de 2× o tamanho por requisição | PASS (medido) |
| A16 | Links de visualização (signed URL) e listagem por papel | Evidência de inspeção: assinam o dono, security, fmall e admin; **não** assinam t2other, fmcampinas (fora do escopo SP) nem Org B. Foto de veículo: qualquer membro da organização assina; Org B não. Link assinado é portador (funciona sem sessão até expirar). O app só gera links em `/fleet` (1 h) | OBS (D-2) |
| V06 / F05 | 10 MiB + 1 no veículo; 8,6 MiB no checklist | Veículo: mensagem clara. Checklist: recusa acima de 5 MB | ver D-1 |

## Testes focais do pacote (EXECUTADO)

`vitest run` em `app/api/photos/route.test.ts`, `lib/domain/storedPhoto.test.ts`, `directPhotoUpload.test.ts`, `immutablePhoto.test.ts`, `app/fleet/photoSubmission.test.ts`, `vehiclePhotoLimit.test.ts` e `app/gate/visualChecks.test.ts`: **38/38 passaram**. O pacote declara 46/46 testes focais (HISTÓRICO). Rodei apenas os arquivos de fotos.

---

## Defeitos

### T2-D01 — P2 — Portaria: falha no envio da foto de avaria é silenciosa (conferência com avaria fica sem foto)

- **Reprodução:**
  1. `security` abre `/reservations/<g3>/pickup` (SP, gate_visual).
  2. Marca "Avaria observada", descreve e anexa a foto.
  3. A conexão ao Storage cai, simulada com abort da POST `…/storage/v1/object/vehicle-photos/…`.
  4. Clica em Confirmar.
  - **Resultado:** a conferência é gravada com `has_damage` e a página vai sozinha para `/reservations/<id>/evidence/<inspectionId>`, sem nenhum aviso (`F03`, `shots/F03.png`). A foto só aparece como pendente em "Minhas fotos pendentes" da conta, que o operador não tem motivo para abrir. A regra é que avaria exige foto (o formulário marca o campo como `required`), e a evidência fica faltando sem ninguém saber.
- **Causa provável:**
  - `submitVisualCheck` (app/gate/visualActions.ts) chama `revalidatePath('/reservations/${id}')` **antes** de o cliente enviar a foto.
  - O RSC atualizado reexecuta `pickup/page.tsx`, que encontra `own_pickup_id` e chama `redirect(evidence)`.
  - `GateVisualForm` é desmontado, e o `setError(dict.errors.common.generic)` que viria depois de `directInspectionPhotos` se perde. A mensagem prevista também seria genérica.
  - No fluxo do motorista (PickupForm) isso não acontece, porque `submitPickup` não revalida.
- **Correção proposta:**
  - Não revalidar `/reservations/${id}` em `submitVisualCheck` quando `photo_upload_pending=true`. Revalidar depois do envio, por exemplo com uma chamada de "fotos concluídas" ou com `router.refresh()` no cliente.
  - Em caso de falha, levar à página de evidências com um aviso explícito, por exemplo: "Conferência salva; a foto da avaria não foi enviada. Reenvie aqui ou em Minhas fotos pendentes."
  - A página de evidências pode listar a pendência daquela inspeção.

### T2-D02 — P3 — HEIC (e outros `image/*` fora do contrato) aceito no seletor do veículo com mensagem enganosa

- **Reprodução:** em Frota → Editar, escolher um arquivo `.heic`; os dados são salvos (`V09`).
- **Resultado:** a mensagem diz "a foto ficou pendente… consulte Minhas fotos pendentes", mas **não há pendência**. O arquivo é rejeitado no navegador por `INVALID_PHOTO` antes do begin.
- **Contexto:** o bucket ainda permite `image/heic` (`allowed_mime_types`), enquanto o contrato 0219+ aceita só JPEG, PNG e WEBP. O mesmo vale, por inspeção estática, para o `PhotoCapture` do checklist (`accept="image/*"`): o ângulo apareceria como "não enviado".
- **Correção proposta:**
  - Usar `accept="image/jpeg,image/png,image/webp"` em `VehiclePhotoInput`, `PhotoCapture`, `EvidenceForm` e `GateVisualForm`.
  - Validar o tipo no cliente com a mensagem já existente `photoMustBeImage` (ou outra que cite "JPEG, PNG ou WEBP").
  - Mapear `INVALID_PHOTO` para essa mensagem e não para "pendente".
  - Alinhar `allowed_mime_types` do bucket, removendo `image/heic`. Exige migration, então é decisão.

### T2-D03 — P3 — A política de INSERT no Storage não está presa ao jornal (caminho e dono)

- **Reprodução:**
  1. O admin faz begin da foto do veículo `TDA2A01`.
  2. `fmall`, que também tem escopo, envia o objeto **no caminho do jornal do admin** (`A06b`, upload 200).
  3. O upload do admin recebe 409, e o finish dele falha porque o owner é diferente.
  - **Resultado:** a pendência do admin fica bloqueada até um "Preparar nova tentativa". Contas com escopo também criam objetos com nomes livres em `org/vehicles/<id>_*` ou `org/<inspeção>/*`: o HEIC de A02 e o "outro nome" de A06c ficaram órfãos, e por desenho não podem ser apagados.
  - **O que não acontece:** a integridade foi preservada; nada foi vinculado sem verificação.
- **Correção proposta:** acrescentar à política restritiva de INSERT de `vehicle-photos` a condição `exists(select 1 from fm_photo_uploads j where j.storage_path=name and j.uploaded_by=auth.uid() and j.state='pending')`. Isso exige migration nova, então é decisão do dono.

### T2-D05 — P3 — `finish` não diferencia as causas de falha

- **Comportamento:** todos os erros de `finishStoredPhoto` viram `409 photo_pending`. Isso inclui `NOT_AUTHORIZED` (id alheio, A11b) e `PHOTO_INTEGRITY_MISMATCH` (objeto adulterado ou diferente, A05).
- **Consequência:** a tela de pendências não sabe orientar. No caso adulterado, reenviar o original nunca funciona, porque o Storage responde 409 Duplicate e o objeto errado continua no caminho. A única saída é "Preparar nova tentativa", e a UI mostra só uma mensagem genérica.
- **Correção proposta:**
  - Devolver 403 para não autorizado.
  - Devolver 422 com `code: PHOTO_INTEGRITY_MISMATCH` para conteúdo diferente.
  - Para esse 422, a UI recomenda diretamente "Preparar nova tentativa preservando o original".

### T2-D06 — P3 — `/api/photos` sem sessão válida responde 307 → /login em vez de 401 JSON

- **Comportamento:** o middleware intercepta a requisição (A01, A10).
- **Consequência:** o `fetch` do navegador segue o redirect e recebe HTML 200, e `r.json()` falha. O usuário vê "foto pendente" quando deveria ver "Entre novamente". O estado não é corrompido.
- **Correção proposta:** excluir `/api/` do redirect de login no middleware (a rota já devolve 401) ou responder 401 JSON.

### T2-D07 — P3 — Aviso após falha da foto de avaria no checklist do motorista

- **Comportamento:** o aviso "A foto da avaria é obrigatória — capture-a acima e envie novamente." (F01/F02) não diz que o checklist **já foi salvo** nem cita "Minhas fotos pendentes".
- **O que funciona:** reenviar o mesmo formulário conclui a foto sem duplicar a inspeção (F01b).
- **Correção proposta:** um texto específico de "checklist salvo, foto pendente", com link para `/account/photos`.

(T2-D04 virou decisão D-1 abaixo.)

## Decisões necessárias

- **D-1 — Limite das fotos de checklist.**
  - Hoje:
    - O transporte novo, o formulário de veículo e o de evidência aceitam **10 MB**.
    - O campo de foto do checklist (`PhotoCapture`, `MAX_PHOTO_BYTES = 5 MB`, texto "Arquivo maior que 5MB") e a portaria (`GateVisualForm`, `setCustomValidity` de 5 MB) aceitam **5 MB**.
    - O servidor `submitVisualCheck` também limita a 5 MB quando recebe arquivo.
  - Com o transporte direto, o motivo do limite menor (corpo da action) deixou de existir.
  - Decidir se o limite vira 10 MB em todos os caminhos. Não alterei nada, porque é regra aprovada.
- **D-2 — Visibilidade das evidências.**
  - Já pode ler e assinar evidência de inspeção: quem enxerga a inspeção por RLS (dono, security, gestor com escopo, admin).
  - Já pode assinar foto de veículo: qualquer membro da organização.
  - Links assinados são portadores.
  - Confirmar se é o desenho aprovado. Não é regressão deste delta: as políticas vêm de 0181.

## Observações (sem defeito atribuído)

- **Storage `PUT` (update) de objeto existente pelo dono** responde **500** em vez de 4xx. O objeto não muda (A13). A recusa funciona; o código HTTP vem do Storage local.
- **A17:**
  - A primeira execução do finish depois de um upload cortado levou 25,8 s; a repetição levou 2,4 s.
  - Provavelmente foi compilação dev ou contenção. Não é conclusivo.
  - Na Vercel, um finish que espere o Storage pode chegar ao limite de tempo da função. Isso NÃO foi testado.
- **Tempo de envio no checklist:** `directInspectionPhotos` envia as fotos **em sequência** (begin → upload → finish por foto). Com muitas fotos em rede móvel, o tempo total cresce linearmente. Não medi em rede real.
- **Árvore de trabalho:** `git status` mostra alterações que **não** são do T2 (outros agentes): `apps/web/lib/operations/package01Fixes.test.ts` modificado e `supabase/migrations/0228_*` não rastreados. O T2 criou somente `docs/integracao_consolidado_2026-10-22/T2/`.

---

## 5. Escritores ANTIGOS depois do CONTRACT (0224/0227)

Análise por fluxo. O nível de evidência de cada linha está indicado.

| Fluxo (código antigo 0aa2403 e c6b26da) | Como escreve | O que acontece com o banco em 0227 | Evidência |
|---|---|---|---|
| Criar/editar veículo com foto (`fleet/actions.ts` → `uploadImmutablePhoto` no servidor; bytes na server action, limite de 8 MB) | **c6b26da:** begin → upload → download → `fm_photo_attest` de **5 argumentos** → finalize. **0aa2403:** begin → upload → finalize **sem atestação** | c6b26da: atestação negada (`permission denied`, 0224) → `PHOTO_LINK_PENDING`. 0aa2403: finalize → `PHOTO_SERVER_VERIFICATION_REQUIRED`. Nos dois, o veículo é salvo, o objeto fica no Storage e o jornal fica `pending`, recuperável só pelo app novo (`/account/photos` + `/api/photos`, que verifica e vincula) | Chamadas RPC executadas em A15. Código completo antigo: INSPEÇÃO ESTÁTICA |
| A → B → A no veículo (escritor antigo) | Os dois antigos retornam cedo quando begin devolve `linked` (`if(row.state==='linked')return`) | Reportam **sucesso** sem trocar a referência: o veículo continua em B. Falso sucesso só em implantação mista | INSPEÇÃO ESTÁTICA (o novo foi validado em A07) |
| Retirada/devolução (`pickup|return/actions.ts` → `uploadInspectionPhotos` → `uploadImmutablePhoto`) | Igual ao veículo | Checklist salvo; ângulos aparecem como "não enviados"; jornal `pending` recuperável pelo app novo | A15 (RPC) + estática |
| Portaria (`gate/visualActions.ts` com arquivo no FormData) | Igual | Conferência salva; "foto ainda não foi enviada"; pendente | Estática |
| Evidência (`appendEvidence`, server action, limite de 5 MB no total) | Igual | Pendente | Estática |
| INSERT direto em `inspection_photos` (anterior a 0216) | INSERT | Negado (403) | A15 / A13 |
| App novo × cliente antigo em cache (JS antigo postando bytes para a action) | As actions novas **ainda aceitam** `photo`/`photo_*` e usam o `uploadImmutablePhoto` **atual** (6 argumentos), então funcionam até o `bodySizeLimit` de 8 MB. Acima disso volta o 500 histórico (S2-D02) | Compatibilidade preservada até 8 MB | Estática (`fleet/actions.ts:265/349`, `next.config` 8 MB) |

Conclusão: com o CONTRACT, todos os escritores antigos deixam fotos **pendentes**. Nada é vinculado sem verificação, o que é seguro. Isso exige publicar o app novo junto com as migrations, ou antes delas, e prever a retomada pelos usuários em `/account/photos`. O código antigo não foi executado inteiro, e o harness S2 (`legacy/immutablePhoto_0aa2403.ts`) não foi reexecutado: o contrato mudou, e as chamadas equivalentes foram exercidas em A15.

## NÃO TESTADO (e por quê)

- **Storage remoto e Supabase de produção:** proibido; todo o teste foi local.
- **Queda de rede real do operador** (4G/Wi-Fi instável, troca de rede no meio do envio): foi simulada com abort no Playwright e socket cortado (F01–F04, A17), não com rede real.
- **Limites da Vercel:** corpo de 4,5 MB nas funções, memória e tempo da função que baixa e calcula o hash de 10 MB, e cold start. Medi só no `next dev` local (A03m).
- **Navegadores móveis e câmera real** (`CameraCaptureModal`), HEIC real de iPhone e conversão: só HEIC sintético (V09/A02).
- **Execução completa do código antigo** 0aa2403/c6b26da contra o banco 0227: feita só no nível das RPCs (A15).
- **A → B → A pela UI:** foi executado pela rota real (A07), que é a mesma usada pela UI.
- **Fidelidade visual e as 28 telas:** fora do escopo do T2.
- **Restauração de backup e rollback:** fora do escopo.

## Como reproduzir

Pré-requisitos: app em `:3100`, Supabase local de pé e `env.txt` (saída de `supabase status -o env --workdir …\homolog`) no scratchpad indicado em `scripts/lib.mjs`.

1. Fixtures:
   - `node scripts/setup-t2.mjs <env.txt> <cred.json>`
   - Aplicar `setup-t2-res.sql`, `setup-t2-keys.sql`, `setup-t2-more.sql`, `setup-t2-more-equip.sql` e `setup-t2-round2.sql` com `docker exec -i supabase_db_fleet-homolog psql …`.
   - As chaves devem ser entregues dentro da janela da reserva.
2. Executar `node scripts/ui-vehicle.mjs` (definir `P10`/`P11` com placas novas), `ui-vehicle-view.mjs`, `ui-checklist.mjs`, `ui-faults.mjs`, `api-photos.mjs` e `api-partial.mjs`. Cada script aceita `ONLY=ID1,ID2`.
3. Reservas e veículos se esgotam ao serem usados. Para repetir, crie novas linhas `t2.mk(...)` com veículos novos.
