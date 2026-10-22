# F3 — Correções de aplicação: T2-D01, D-T3-01, D-T3-02 e P3 mecânicos (T2-D02, T2-D07)

- Worktree: `C:\projects\fleet\_local\fleet-integ`, branch `integracao-consolidado-2026-10-22` (HEAD 179abc7). Nada foi commitado (sem git write).
- Ambiente: somente LOCAL. App dev em http://localhost:3100 (continua ligado) e banco Docker `supabase_db_fleet-homolog`. Não houve produção, deploy, migration ou arquivo SQL.
- Dados de teste: reservas T2 já existentes (`t2.r`: g4, g5, f4) e veículo do T3 `T3M0001`. O T3M0001 foi devolvido pela própria UI ao estado inicial: SUV Compacto, ICE, combustível 70, nome "T3 Jolion medicoes".
- Como o ANTES foi obtido: troquei temporariamente, só no disco, os arquivos corrigidos pela versão do HEAD (`git show HEAD:<arquivo>`), rodei o cenário e restaurei a versão corrigida. A restauração foi conferida com grep e com tsc, vitest e lint finais.

## Verificação final (EXECUTADO)

| Verificação | Resultado |
|---|---|
| `node ../../node_modules/typescript/bin/tsc --noEmit` | exit 0 |
| `node node_modules/vitest/vitest.mjs run` | **110 arquivos, 1086 testes, todos verdes** (base 1073 + 13 novos), em `vitest_final.log` |
| `node node_modules/next/dist/bin/next lint` | "No ESLint warnings or errors", em `lint_final.log` |

---

## 1. T2-D01 (P2) — Portaria: falha da foto de avaria era silenciosa

**Causa**
- `submitVisualCheck` chamava `revalidatePath(...)` logo depois de gravar a conferência e antes de o navegador enviar a foto.
- Com qualquer revalidação, o Next re-renderiza a página atual na própria resposta da action. `pickup/page.tsx` então encontra `own_pickup_id` e redireciona para `/evidence/<id>`.
- Isso desmonta o `GateVisualForm`, e o erro do envio da foto se perdia.

**Correção**
- `apps/web/app/gate/visualActions.ts` (linhas 23–28): quando há avaria e a foto ainda será enviada pelo navegador (`photo_upload_pending=true`), a action **não revalida**. Sem avaria, o comportamento é o de antes.
- `apps/web/app/gate/GateVisualForm.tsx`:
  - **Antes de registrar**, valida a foto no cliente (`gateDamagePhotoProblem`, linha 12): formato JPEG/PNG/WEBP e até 5 MB.
  - Depois registra a conferência e envia a foto pelo caminho novo: bytes direto ao Storage, depois `/api/photos` finish com atestação.
  - **Só após o sucesso** vai para `/gate`.
  - Se a foto falha, o formulário **fica na tela** com a checagem preenchida (campos travados) e mostra uma mensagem clara (`ops.gate.damagePhotoFailed`).
  - O formulário oferece o botão **"Enviar a foto novamente"**, que reenvia só a foto com o mesmo arquivo e a mesma inspeção, sem segunda conferência. Também traz o link para as evidências da conferência (linhas 22–30).
  - `accept="image/jpeg,image/png,image/webp"`.
- Estado recuperável: em `apps/web/app/reservations/[id]/evidence/[inspectionId]/page.tsx` (linhas 16–21 e 25–26), a página de evidências passa a avisar quando há uma inspeção **com avaria e sem foto de avaria**: "Avaria registrada sem foto: a evidência está incompleta…".
  - Nesse caso, o tipo "Dano observado" já vem pré-selecionado. É para essa página que a retirada/devolução redireciona quando a conferência já existe.
  - `EvidenceForm.tsx` passou a aceitar só JPEG/PNG/WEBP, mostra a mensagem de formato e atualiza a página ao concluir, para o aviso sumir.
- Regras de portaria preservadas: a autorização continua `inspection_role==="security"` e as RPCs `record_pickup`/`record_return` não mudaram. Segue sem odômetro, combustível e fotos padrão, e a independência dos checklists não foi alterada. CNH não é tocada aqui.

**Testes** (`apps/web/app/gate/visualChecks.test.ts`, +3)
- Com avaria e foto pendente, não revalida.
- Sem avaria, revalida `/gate`.
- A validação da foto recusa ausente, HEIC e mais de 5 MB, e aceita WEBP.

**Evidência**: script `gate_d01.mjs`. A queda é simulada abortando a POST ao Storage, mesma técnica do T2/F03.

| Momento | Resultado |
|---|---|
| **ANTES** (código HEAD, reserva g4), `d01_antes.json`, `shots/d01_antes_2_apos_queda.png` | A página foi **sozinha** para `/evidence/…`, sem mensagem sobre a foto e sem botão de reenvio. Conferência gravada (1), fotos = nenhuma, jornal `pending`. O reproduzido coincide com o T2-F03. (O aviso amarelo visível na tela já é o novo aviso da página de evidências, que estava no disco.) |
| **DEPOIS** (g5), `d01_depois.json`, `shots/d01_depois_2_apos_queda.png` e `_3_apos_reenvio.png` | Fica em `/pickup` com "A conferência foi salva, mas a foto da avaria não chegou…", botão "Enviar a foto novamente" e link para evidências. Após reenviar: vai para `/gate`, **1** conferência, foto `damage`, jornal `linked`. |
| **DEPOIS** (f4), `d01_depois2.json`, `shots/d01_depois2_*.png` | HEIC é recusado **antes** de registrar ("Formato de foto não aceito… Nada foi registrado."; 0 conferências). Em seguida, uma foto válida com queda leva à mensagem. Ao **recarregar** (o operador saiu), a página vai para as evidências com o aviso "Avaria registrada sem foto" e o ângulo `damage` pré-selecionado. O envio ali conclui com foto `damage` e **1** conferência. |

**Risco residual**
- Se o operador fechar o navegador depois da falha, a pendência só aparece quando ele volta à retirada/devolução, que leva às evidências, ou em "Minhas fotos pendentes".
- A lista `/gate` não sinaliza "avaria sem foto". Isso exigiria uma consulta nova e ficou fora do escopo.
- Os textos antigos fixos da página de evidências (título e botões) continuam em pt-BR, como já eram.

## 2. D-T3-01 (P2) — Edição de veículo: categoria mudava em silêncio depois de um erro do servidor

**Causa**
- O `<form action={formAction}>` do React 19 reinicia o formulário ao fim de toda action, inclusive quando ela devolve erro.
- Os campos não controlados voltam ao valor inicial. O `<select value={categoryId}>` controlado passa a mostrar a 1ª opção no DOM enquanto o estado continua com a categoria escolhida.
- Ao salvar de novo, vai a 1ª categoria.

**Correção** (mesma técnica do PickupForm/ReturnForm)
- `apps/web/app/fleet/EditVehicleForm.tsx` (linhas ~69–76) e `apps/web/app/fleet/VehicleForm.tsx` (linhas ~114–122): enviam com `onSubmit` + `preventDefault` + `startTransition(() => formAction(data))`. Sem `action`, o React não reinicia o formulário.
- O cadastro novo só é limpo no sucesso (efeito já existente). O rascunho em sessionStorage continua.
- Também resolve a perda do odômetro digitado do D-T3-08. O estilo do textarea do D-T3-08 **não** foi alterado (fora do escopo).

**Testes** (`apps/web/app/fleet/vehicleFormReset.test.ts`, novo, 6 testes)
- Controle: um `<form action={fn}>` aparece com `action=` no HTML.
- Os formulários de edição e de cadastro **não** têm `action=`.
- A categoria do veículo aparece selecionada.
- Mais os testes de formato do T2-D02 (abaixo).

**Evidência**: script `vehicle_d01.mjs`, papel fmall, T3M0001. Escolher "SUV Híbrido", mudar o nome para "F3 nome digitado", usar a placa duplicada GWM1H61, salvar, ver o erro, corrigir a placa e salvar de novo.

| Momento | Resultado |
|---|---|
| **ANTES**, `t3d01_antes.json`, `shots/t3d01_antes_apos_erro.png` | Depois do erro, o select mostra "Hatch Elétrico" e o nome volta a "T3 Jolion medicoes". O banco gravou **Hatch Elétrico/BEV com fuel=70**: a categoria e o nome escolhidos foram perdidos em silêncio. |
| **DEPOIS**, `t3d01_depois.json`, `shots/t3d01_depois_apos_erro.png` | Depois do erro, todos os campos ficam como digitados: categoria "SUV Híbrido", placa "GWM1H61" e nome "F3 nome digitado". O banco gravou **F3 nome digitado / SUV Híbrido / HEV**. Em seguida o veículo foi restaurado pela UI. |

**Risco residual**: o campo de foto também é preservado, o que é desejado (reenviar de novo só se o usuário salvar). Nenhum outro formulário foi alterado.

## 3. D-T3-02 (P2) — CNH: fotos de 50 MP ou com muito ruído (3–5 MiB) eram recusadas sem saída

**Causa**
- `prepareLicenseDocument` recusava acima de 24 MP (`MAX_PIXELS`).
- Abaixo disso, só baixava a qualidade até 0,72, mantendo a resolução, e então desistia com a mensagem genérica.

**Correção** (`apps/web/lib/domain/prepareLicenseDocument.ts`)
- `licenseReductionPlan` (linha 45) define as tentativas:
  - 1ª: resolução original, limitada a 24 MP. Um arquivo de 50 MP vira 5656×4242 e não é mais recusado de saída.
  - Depois, o lado maior cai para 4000, 3200 e 2400 px. Nunca abaixo de `LICENSE_MIN_LONG_SIDE = 2400` (linha 27), para manter a legibilidade, e nunca amplia.
- `reduceLicenseImage` (linha 64): em cada tamanho, baixa a qualidade (0,92 → 0,85 → 0,78 → 0,70) e só então passa ao próximo tamanho. A suavização é `high`.
- Se nem o menor tamanho couber em 3 MiB, lança `DOCUMENT_TOO_LARGE`.
- Tudo acontece em memória (canvas liberado em `finally`, bitmap fechado). O arquivo original não é alterado.
- O caminho do PDF ficou como estava (D-T3-03 não foi feito).
- `apps/web/app/account/license/LicenseCaptureForm.tsx` (linhas ~51–55): `DOCUMENT_TOO_LARGE` gera uma mensagem específica (`account.license.documentTooLargeAfterReduction`) que explica o que houve e o que fazer: tirar outra foto com resolução menor (12 MP em vez de 50 MP), com boa luz e enquadrando só a CNH, ou enviar o PDF da CNH Digital. A mensagem informa que **o original continua selecionado e não foi alterado**.

**Testes** (`apps/web/lib/domain/prepareLicenseDocument.test.ts`, +4 e 1 ajustado)
- O plano para 50 MP é `[5656, 4000, 3200, 2400]`, sem ampliar e mantendo a proporção.
- Uma foto de 50 MP ruidosa é reduzida até caber, com a qualidade baixando primeiro, e o original fica intacto.
- Uma foto de 12 MP ruidosa é reduzida em vez de recusada.
- Quando nada cabe, para em 2400 px com `DOCUMENT_TOO_LARGE`, depois de 16 tentativas (4 tamanhos × 4 qualidades).
- O teste antigo "never sends…" agora espera `DOCUMENT_TOO_LARGE`.

**Imagens sintéticas** (PIL, `gen_f3_docs.py` e `gen_f3_docs.log`, geradas no scratchpad e não versionadas)

| Arquivo | Resolução e tamanho |
|---|---|
| `f3_12mp_ruido.jpg` | 4032×3024 (12,2 MP), 4,64 MiB, ruído forte |
| `f3_50mp_ruido.jpg` | 8160×6120 (49,9 MP), 4,55 MiB |
| `f3_ruido_extremo.jpg` | 2400×2400, 4,58 MiB, ruído puro (pior caso, para provar a mensagem) |

**Evidência**: script `cnh_d02.mjs`, navegador real, `/account/license`, usuário t3up. O arquivo realmente enviado à action é capturado.

| Arquivo | ANTES (`cnh_d02_antes.json`) | DEPOIS (`cnh_d02_depois.json`) |
|---|---|---|
| 12 MP ruído | **recusado na preparação**, mensagem genérica, nada enviado | **enviado** JPEG 3200×2400, 2.775.492 B (≤ 3.145.728) |
| 50 MP | **recusado** (> 24 MP), mensagem genérica | **enviado** JPEG 5656×4242, 3.122.433 B |
| ruído extremo | recusado, mensagem genérica | recusado com a **mensagem nova específica**, nada enviado, original continua selecionado |

- Legibilidade: os recortes do arquivo enviado estão em `shots/cnh_depois_legibilidade_f3_12mp_ruido.png` e `…_50mp_ruido.png`. Nome e número de registro aparecem nítidos.
- Telas: `shots/cnh_antes_*.png` e `shots/cnh_depois_*.png`.
- A mensagem "Não foi possível analisar a foto agora" no DEPOIS vem da IA, que não está disponível no ambiente local (igual ao T3). O que importa aqui é que o documento foi preparado e chegou ao servidor.

**Risco residual**
- A leitura pela IA real não foi testada.
- Celulares com pouca memória decodificam a foto de 50 MP inteira (cerca de 200 MB) antes de reduzir. É o mesmo custo de antes, só que agora a preparação chega ao fim.
- O piso de 2400 px é uma escolha técnica e pode ser ajustado.

## 4. P3 mecânicos

### T2-D02 — HEIC e outros formatos fora do contrato

**Correção**
- `lib/domain/vehiclePhotoLimit.ts` ganhou `VEHICLE_PHOTO_TYPES`, `VEHICLE_PHOTO_ACCEPT` e `vehiclePhotoTypeUnsupported`.
- `VehiclePhotoInput.tsx`: `accept` restrito a JPEG/PNG/WEBP, com validação na escolha e a mensagem `errors.fleet.photoTypeNotSupported`.
- `EditVehicleForm.tsx` e `photoSubmission.ts` (cadastro) recusam o formato **antes de salvar**, sem fingir uma "foto pendente".
- `PhotoCapture.tsx` (checklist): `accept` restrito e mensagem `reservations.photos.fileTypeNotSupported`.
- `GateVisualForm` e `EvidenceForm`: idem.
- O ajuste do bucket (`allowed_mime_types`) exige migration e **não** foi feito (decisão).

**Testes**: em `vehicleFormReset.test.ts`, detecção de HEIC/GIF, cadastro com HEIC não salva e o `accept` correto.

**Evidência DEPOIS** (`p3_d02_d07.json`, `shots/d02_veiculo_heic.png`)
- Mensagem na tela: "Formato de foto não aceito. Envie JPEG, PNG ou WEBP … Nada foi salvo…".
- O nome digitado **não** foi salvo, e há 0 pendências HEIC.
- ANTES: T2/V09.

### T2-D07 — Checklist do motorista salvo, mas foto de avaria pendente

**Correção**
- `PickupForm.tsx` e `ReturnForm.tsx` têm um estado separado `damagePhotoPendingSaved`.
- Quando o checklist **já foi salvo** e a foto falhou, a mensagem é `reservations.checklist.damagePhotoPendingSaved` ("Checklist salvo, mas a foto da avaria não foi enviada… Envie o formulário de novo para reenviar só a foto (o checklist não será duplicado) ou conclua depois em Minhas fotos pendentes."), com o link "Abrir Minhas fotos pendentes" (`/account/photos`).
- O aviso antigo `damagePhotoRequired` fica só para quando nenhuma foto foi escolhida, caso em que nada foi salvo.

**Evidência DEPOIS** (`p3_d02_d07.json`, `shots/d07_checklist_salvo_foto_pendente.png`, t2sp, g4)
- Aparecem a mensagem nova e o link.
- Ao reenviar, vai para `/trips` com **1** retirada do motorista e foto `damage`.
- ANTES: T2/F01.

## Não feito, por instrução

- T2-D03, T2-D05, T2-D06.
- D-T3-03 (PDF multipágina): só registrado. O caminho do PDF não foi alterado.
- Decisões CNH × reserva, Segurança em /trips/new e D-1/D-2. O limite de 5 MB da portaria e do checklist foi mantido.
- Estilo do textarea do D-T3-08 e D-T3-04/05/06/07.

## Arquivos alterados (apps/web)

- `app/gate/GateVisualForm.tsx`, `app/gate/visualActions.ts`, `app/gate/visualChecks.test.ts`
- `app/reservations/[id]/evidence/[inspectionId]/page.tsx`, `…/EvidenceForm.tsx`
- `app/reservations/[id]/pickup/PickupForm.tsx`, `app/reservations/[id]/return/ReturnForm.tsx`, `app/reservations/[id]/PhotoCapture.tsx`
- `app/fleet/EditVehicleForm.tsx`, `app/fleet/VehicleForm.tsx`, `app/fleet/VehiclePhotoInput.tsx`, `app/fleet/photoSubmission.ts`, `app/fleet/vehicleFormReset.test.ts` (novo)
- `app/account/license/LicenseCaptureForm.tsx`, `lib/domain/prepareLicenseDocument.ts`, `lib/domain/prepareLicenseDocument.test.ts`, `lib/domain/vehiclePhotoLimit.ts`
- `lib/i18n/dictionaries/types.ts`, `pt-BR.ts`, `en-US.ts`, `es.ts`, `zh-CN.ts`

## Chaves i18n novas (nos 5 arquivos)

| Seção | Chaves |
|---|---|
| `ops.gate` | `damagePhotoFailed`, `damagePhotoType`, `damagePhotoTooLarge`, `retryDamagePhoto`, `openEvidence` |
| `reservations.checklist` | `damagePhotoPendingSaved`, `pendingPhotosLink`, `evidenceDamagePhotoMissing`, `photoTypeNotSupported` |
| `reservations.photos` | `fileTypeNotSupported` |
| `errors.fleet` | `photoTypeNotSupported` |
| `account.license` | `documentTooLargeAfterReduction` |

## Evidências nesta pasta

- Scripts: `gate_d01.mjs`, `vehicle_d01.mjs`, `p3_d02_d07.mjs`, `cnh_d02.mjs`, `gen_f3_docs.py`.
- Resultados: `d01_antes.json`, `d01_depois.json`, `d01_depois2.json`, `t3d01_antes.json`, `t3d01_depois.json`, `p3_d02_d07.json`, `cnh_d02_antes.json`, `cnh_d02_depois.json`, `gen_f3_docs.log`, `vitest_final.log`, `lint_final.log`.
- Capturas: `shots/`.
