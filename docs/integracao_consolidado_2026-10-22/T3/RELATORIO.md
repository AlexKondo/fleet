# T3 — CNH, acesso por CNH (papéis), 28 telas, caronas/exceção na UI — RELATÓRIO

Branch `integracao-consolidado-2026-10-22`, commit d9d5fc2, worktree `C:\projects\fleet\_local\fleet-integ`. Só ambiente LOCAL (app http://localhost:3100, banco Docker `supabase_db_fleet-homolog`). Nenhum código-fonte, migration ou git foi alterado. Nenhuma API externa, produção ou `.env` foi usada.

Legenda do tipo de evidência: **EXEC** = teste executado por mim agora · **INSP** = inspeção estática do código · **HIST** = resultado histórico (pacote/Kondo), não repetido · **NT** = não testado.

## 0. Ocorrências de ambiente (importante para o orquestrador)

- **Por volta das 16:04, alguém rodou `next build` em `apps/web` com o servidor de desenvolvimento ligado.** O `.next` foi sobrescrito (BUILD_ID 16:05) e todas as rotas passaram a responder 500. Seguindo CONSOLIDADO-COMUM, parei o `next dev` da porta 3100, apaguei `apps/web/.next` e reiniciei `next dev -p 3100`. Os outros agentes que usam a 3100 podem ter visto 500 entre ~16:04 e ~16:10. As capturas de tela foram refeitas depois do reinício. Os testes de CNH, a matriz de papéis e o teste de administrador rodaram antes dessa janela, e nenhum deles registrou 500.
- **Vi na lista de processos, sem tocar nele**, um processo de outra sessão: `node --env-file=.env _local/backups_e_analises/analise/prod_apply_list.mjs 2026-10-22_expand 0210_...`. Pelo nome, ele lê o `.env` de produção. Registro apenas para conferência pelo orquestrador.
- Linhas próprias deixadas no banco local (prefixo T3):
  - 13 usuários `t3*@t3.frota-aurora.test`, com senha fictícia em `C:\projects\fleet\_local\homolog\conclusao\T3\t3users.json`, fora do git;
  - o veículo `T3M0001` e uma tarefa de limpeza ligada a ele, já atribuída ao fmall;
  - 1 reserva cancelada do t3valid com exceção `not_departed`. A tabela é append-only, então a linha permanece;
  - a CNH do `t3ai` foi reiniciada e a CNH do `t3up` foi cadastrada manualmente.
- O GRANT SELECT de `corporate_mobility_points` foi revogado por cerca de 10 s e restaurado em seguida. Conferido depois: `INSERT,SELECT,UPDATE,DELETE`.

## 1. CNH — preparação local, transporte, falha da IA, confirmação

Documentos sintéticos gerados com PIL, reportlab e pypdf (`gen_docs.py`) em `C:\projects\fleet\_local\homolog\conclusao\T3\docs`. Todos trazem a marca "DOCUMENTO SINTÉTICO – NÃO É CNH" e campos fictícios (validade 09/03/2034, emissão 10/03/2024).

O teste (`cnh_browser.mjs`) envia cada arquivo pela tela `/account/license` como colaborador sem CNH, em três modos:

- desktop 1440;
- **mobile**: Chromium 390×844, DPR 3, touch, user agent Android;
- **nosupport**: sem `createImageBitmap` e sem `Worker`.

O arquivo realmente enviado é capturado no navegador (FormData da server action) e salvo em `...\conclusao\T3\sent`. O tamanho de rede é o `Content-Length` do POST da action. Os resultados ficam em `cnh_desktop|mobile|nosupport.json/.log`.

| ID | Arquivo (entrada) | Desktop / mobile: enviado à action | Content-Length do POST | Mensagem | nosupport | Resultado |
|---|---|---|---|---|---|---|
| C01 | JPEG 0,94 MiB | original 985.995 B | 986.297 | falha IA (abaixo) | igual | PASS EXEC |
| C02 | JPEG 2,84 MiB | original 2.981.581 B | 2.981.885 | falha IA | igual | PASS EXEC |
| C03 | JPEG 3,46 MiB (3000×2000) | JPEG 2.864.967 B, mesma resolução | 2.865.268 | falha IA | recusa amigável, nada enviado | PASS EXEC |
| C04 | JPEG 4,50 MiB (3400×2300) | JPEG 3.101.410 B (≤3 MiB = 3.145.728) | 3.101.711 | falha IA | recusa amigável | PASS EXEC |
| C05 | PNG 4,27 MiB (1950×1300) | JPEG 1.660.422 B | 1.660.723 | falha IA | recusa amigável | PASS EXEC |
| C06 | JPEG 12 MP 4,38 MiB, ruído forte | **recusado na preparação** ("Não foi possível preparar…") | — | ver D-T3-02 | recusa | FAIL parcial EXEC (pior caso sintético) |
| C07 | JPEG 50 MP (8160×6120) 4,55 MiB | **recusado** (limite de 24 MP) | — | ver D-T3-02 | recusa | FAIL EXEC |
| C08 | JPEG 7,44 MiB / PDF 6,78 MiB | botão "Ler" desabilitado; "Arquivo maior que 5MB — escolha uma foto menor." | — | recusa clara | igual | PASS EXEC (P3: diz "foto" para PDF) |
| C09 | `invalido.txt` | recusado com "Não foi possível preparar este documento…" em vez de "O arquivo precisa ser uma imagem ou um PDF." | — | ver D-T3-04 | igual | PASS com ressalva EXEC |
| C10 | PDF 1 pág. pequeno / PDF 3 pág. pequeno | PDF original (≤3 MiB passa sem preparo) | 2.113 / 3.617 | falha IA | igual | PASS EXEC |
| C11 | PDF 1 pág. 4,36 MiB | JPEG 1697×2400, 1.061.264 B | 1.061.565 | falha IA | recusa amigável | PASS EXEC |
| C12 | **PDF 3 pág. 4,74 MiB** | JPEG 1697×7200 com **as 3 páginas** (marcadores PÁGINA 1/2/3 conferidos visualmente) | 2.429.243 | falha IA | recusa amigável | PASS EXEC |
| C13 | PDF 5 pág. 4,43 MiB | JPEG 1697×12000 com 5 páginas, legível a 100% | 2.741.573 | falha IA | recusa | PASS EXEC (ver D-T3-03) |
| C14 | PDF 6 e 8 pág. (A4, ~4,5 MiB) | **recusados** (limite de 24 MP / 16000 px), apesar do limite declarado de 8 páginas | — | recusa amigável | recusa | FAIL menor EXEC (D-T3-05) |
| C15 | PDF 9 pág. | recusado (>8 páginas), sem descartar páginas | — | recusa amigável | recusa | PASS EXEC |
| C16 | PDF protegido (RC4, senha) 4,36 MiB | recusado na preparação, mensagem amigável | — | — | recusa | PASS EXEC |
| C17 | PDF protegido pequeno (1,7 KB) | enviado sem preparo (≤3 MiB). Leitura pela IA real: NT | 2.094 | falha IA | igual | PASS EXEC / IA NT |
| C18 | PDF corrompido 4,36 MiB | recusado na preparação | — | recusa amigável | recusa | PASS EXEC |
| C19 | Reenvio após falha da IA (C01, C03, C12) | 2º clique reenvia o **mesmo original** preparado de novo (tamanhos idênticos); nome do arquivo continua exibido; botão habilitado | 2 POSTs | — | — | PASS EXEC |
| C20 | Nenhum POST da action > 3 MiB em 63 envios (3 modos) | maior: 3.101.711 B | — | — | — | PASS EXEC |
| C21 | Mobile = desktop | resultados idênticos em 390×844, sem erro de console/página | — | — | — | PASS EXEC (D-T3-06 visual) |
| C22 | Falha da IA (sem chave local) | "Não foi possível analisar a foto agora. Tente novamente em instantes." Linguagem simples, mas sem caminho alternativo (D-T3-07) | — | — | — | PASS com ressalva EXEC |
| C23 | Legibilidade da imagem preparada | recortes a 100% em `shots/prepared/` (`crop100_pdf5p_pagina5.jpg`, `crop100_img_4_9mib.jpg`): texto nítido, sem perda de resolução | — | — | — | PASS EXEC (inspeção humana) |
| C24 | Testes focais vitest: prepareLicenseDocument (6), analyzeDriversLicense (9), actions de licença (14), middleware (10), managementLicenseBoundary (6), drivingValidity (2) | 47/47 em `vitest_cnh.log` | — | — | — | PASS EXEC |
| C25 | Data contraditória (emissão ≥ validade, data inexistente) → ilegível, sem presumir validade | `parseModelJson` rejeita. Casos cobertos por C24 | — | — | — | PASS EXEC (unitário) + INSP |
| C26 | Confirmação humana antes de salvar | fase `analyze` não grava nada; `confirm` exige a caixa marcada e usa só o token HMAC (ignora campos do cliente). Coberto por actions.test (14) | — | — | — | PASS INSP + EXEC unitário · **E2E NT** (sem IA local não se chega ao estado "analyzed") |
| C27 | Campos extraídos × documento sintético | **NT**: depende de IA/OCR real | | | | NT |

### Administrador: rótulo IA/manual, reinício e cadastro manual

Scripts `admin_license.mjs` e `admin_manual.mjs` (EXEC):

| ID | Cenário | Esperado × obtido | Resultado |
|---|---|---|---|
| A01 | Rótulos em /settings/users | t3ai "✦ Lido por IA (foto da CNH)" com campos bloqueados; t3valid "✎ Preenchido manualmente"; t3null "? Origem não registrada" | PASS |
| A02 | Reiniciar CNH travada por IA (`resetMemberLicense`), com motivo | Confirmação clara; número, categoria, validade e origem viram NULL; `driver_authorized` = false; auditoria `driver_license_reset {reason, reset:true}`; depois disso o t3ai é levado de /trips/new para /account/license e continua usando o /dashboard | PASS |
| A03 | Cadastro manual pelo administrador (t3up) | Cada campo é salvo automaticamente; origem "manual"; t3up passa a abrir /trips/new | PASS |

## 2. Acesso por CNH (papéis)

Matriz executada com `roles_matrix.mjs` (`roles_matrix.log/json`) e conferência do conteúdo com `roles_probe*.log` (EXEC). As rotas de condução são /trips/new e /reservations/[id]/pickup.

| Usuário (CNH) | Admin/gestão (/dashboard, /admin, /analytics, /gate, /fleet, /fleet/keys, /settings, /maintenance) | /trips, /carpool, /carpool/mine (passageiro) | Condução (/trips/new, pickup) | Resultado |
|---|---|---|---|---|
| Administrador sem CNH | todas 200, sem bloqueio | 200 | → /account/license | PASS |
| Gestor total sem CNH | 200; /admin → /dashboard e /settings/users → /settings (limite do papel, não da CNH) | 200 | → /account/license | PASS |
| Gestor limitado (Campinas) sem CNH | 200; reserva de SP fora do escopo → /trips | 200 | → /account/license | PASS |
| Manutenção sem CNH | /maintenance e /dashboard 200; demais rotas → /dashboard (papel) | 200 | → /account/license | PASS |
| Segurança sem CNH | /gate 200 (isento por desenho) | 200 | **/trips/new abre o formulário completo de reserva** | ver DEC-T3-02 |
| Custodiante (colaborador) sem CNH | /account/keys 200 com a custódia funcionando; admin → /dashboard | 200 | → /account/license | PASS |
| Colaborador CNH válida | admin → /dashboard | 200 | /trips/new 200 | PASS |
| Colaborador CNH vencida / NULL | admin → /dashboard | 200 | → /account/license | PASS |
| Conta desativada | login recusado ("Situação do acesso indisponível"); todas as rotas → /login | — | — | PASS |
| Troca de senha inicial (sem CNH) | todas as rotas → /account?forcePasswordChange=1, exceto /account/* | — | — | PASS (P3: /account/keys fica acessível antes da troca; mostra só "sem designação") |

### Ações de condução no banco

Executadas como o usuário (role `authenticated` + claims), dentro de uma transação com ROLLBACK (`driving_rpc.sql/.log`, EXEC):

| Condutor | Reservar (RPC `create_vehicle_reservation`) | Chaves entregues por custodiante **sem CNH** | Retirada `record_pickup` | Saída pela portaria |
|---|---|---|---|---|
| válida | OK | **OK** (CNH do custodiante não interfere) | bloqueada por EQUIPMENT_CONFIGURATION_REQUIRED (não é CNH) | DEPARTURE_BLOCKED (sem retirada) |
| vencida | **OK** | LICENSE_EXPIRED | LICENSE_EXPIRED | DEPARTURE_BLOCKED |
| NULL / admin / gestor total / Segurança sem CNH | **OK** | DRIVER_NOT_AUTHORIZED | DRIVER_NOT_AUTHORIZED | DEPARTURE_BLOCKED / GATE_SELF_RELEASE |

- A checagem de CNH **na saída pela portaria** existe (`fm_verified_departure_checks` → `fm_assert_can_drive`): INSP + HIST (`inspectionFlow.test.ts`). Aqui ela ficou inconclusiva, porque a saída já é barrada antes por falta de retirada.
- Passageiro sem CNH pedindo carona: a busca abre e funciona para t3null (seção 4). O pedido de vaga por usuários sem CNH aparece no banco, feito pelo agente T1 (`PENDING:T1 t1drvexp/t1drvnull/t1adminnocnh`). `create_carpool_ride_request_as_rider` não consulta CNH (INSP).
- **Divergência a decidir (DEC-T3-01):** o RPC de reserva aceita qualquer usuário sem CNH. Só a rota /trips/new é barrada, e o chat e outros chamadores do RPC não passam por esse portão. A regra aprovada lista retirada, chaves e saída (todas bloqueadas e confirmadas), então isso não é defeito pela regra literal.

## 3. As 28 telas

Execução: `screens.mjs`, cópia adaptada do `capture.mjs`. Foram 86 capturas em 1440×900 e 390×844, com o papel indicado no `capture.mjs`, mais es/en-US/zh-CN em 3 telas. Índice em `screens_index.json`, log em `screens.log`. Os PNGs ficam fora do git em `...\conclusao\T3\shots\screens` (prévias em `screens_small`).

- Todas as capturas responderam HTTP 200.
- Nenhum overflow horizontal, nenhuma chave i18n crua (inclusive nos 3 idiomas), nenhum 5xx de página, nenhum erro de console, com uma exceção: `/fleet` 1440 trouxe 1 miniatura `/_next/image` com 504 (foto sintética PNG do GWM2H62 enviada por outro agente — fora do meu escopo e não concluída).
- Os "textOverflow suspects" são os chips de ícone do Gantt em /dashboard e /trips, compactos por desenho.

Referências: **definitivas apenas FM-001 (FM001.png), FM-002 Rev04 e FM-004 Rev02**. As demais 25 telas têm só imagem **PROPOSTA**, ainda não aprovada (PROPOSED_IMAGE_MAPPING.md). A ausência de referência definitiva **não revoga a aprovação histórica** e fica registrada como **pendência visual**.

| Tela | Rotas capturadas | Referência | Funcional (EXEC agora) | Visual |
|---|---|---|---|---|
| SCR-FM-001 | /dashboard/command-center | **definitiva** | 200, sem erros, sem overflow | Estrutura confere: 5 KPIs, Intelligence, mapa, economia, gráficos, categorias/status/manutenções/viagens, alertas, ações rápidas. Divergências: mapa "indisponível" e métricas de economia e ocupação "—" (lacunas de dados já declaradas); rótulo "SUV Compa/cto" quebrado no gráfico (P3) |
| SCR-FM-002 | /fleet, /fleet/vehicles/[id] | **definitiva** | 200; 1 miniatura 504 (acima) | Estrutura confere: lista com filtros, ficha, abas, cartões. Divergências: sem busca global no cabeçalho (FM-001 tem); "Exportar/Cadastrar veículo" do topo viraram "+ Adicionar Veículo" no rodapé; sem mapa. Registro como divergência, sem redesenho |
| SCR-FM-004 | /fleet/carpools, /analytics/carpool, /carpool | **definitiva** | 200 | Estrutura confere: KPIs, abas, filtros, lista + detalhe, passageiros, Intelligence, impacto. Divergências: menu lateral em trilho estreito (shell diferente das outras telas); "Mais ações" virou "Buscar carona"; sem foto do veículo e sem avaliação do anfitrião |
| SCR-FM-003, 005–009 | conforme a matriz | proposta | 200, sem erros. FM-007 `/settings/users` com fmall → /settings: gestor não administra usuários (matriz × papel, ver DEC-T3-03) | pendente (sem referência definitiva) |
| SCR-USR-001…006 | conforme a matriz (USR-005 pickup/return com thiago/mariana) | proposta | 200, sem erros | pendente |
| SCR-SEC-001…003, MNT-001…004, ADM-001…006 | conforme a matriz | proposta | 200, sem erros | pendente |

Não declaro fidelidade visual de nenhuma tela. As três definitivas têm as divergências acima.

## 4. Caronas e exceção na UI

Scripts `carpool_exception_ui.mjs` e `tasks_measure_ui.mjs`, todos EXEC.

| ID | Cenário | Esperado × obtido | Resultado |
|---|---|---|---|
| K01 | Busca de carona por colaborador SEM CNH (t3null) | Tela abre e busca. Localmente termina em "serviço de mapas indisponível" (sem Google, por desenho) | PASS (casamento real NT) |
| K02 | Falha de leitura dos pontos (SELECT revogado) | Mensagem própria: "Não conseguimos consultar os locais da empresa agora, então a busca de carona foi interrompida por segurança…". Nenhum resultado; depois de restaurar, volta ao comportamento normal | PASS |
| K03 | Anfitrião (lucas) vê passageiros aceitos e comandos da oferta na reserva | "Passageiros confirmados: Mariana Teixeira"; "Atualizar vagas / Desativar carona"; pedidos pendentes com Aceitar/Recusar e só a região aproximada | PASS |
| K04 | Visão própria de motorista e de passageiro | /carpool/mine com abas "Como motorista / Como passageiro". Mariana vê a solicitação "Aceita" e "Cancelar solicitação" | PASS. Obs.: em /trips a aba "Caronas" do anfitrião mostra 0, porque lista só pedidos como passageiro (DEC-T3-04) |
| K05 | Rótulo de exceção para o solicitante, sem motivo interno, nos 4 idiomas | Lista e detalhe mostram "Encerrada: veículo não saiu" / "Closed: vehicle did not leave" / "Cerrada: el vehículo no salió" / "已结束：车辆未出发". `MOTIVO-INTERNO-T3-SIGILOSO` não aparece | PASS. A exceção foi criada por INSERT direto (atalho de teste); o fluxo real pela Segurança/custódia não foi exercitado. Obs. P3: textos fixos no código, fora dos dicionários |
| K06 | Atribuição de tarefa pelo dashboard | "Assumir" + confirmação → `assigned_to` = fmall, auditoria `workflow_task.claimed` = 1 | PASS |
| K07 | Redução de odômetro pela Frota | Campo de justificativa aparece ao reduzir. Sem justificativa (validação do navegador burlada), o **servidor recusa**. Com justificativa: 15000→14000 e auditoria `vehicle.measurements_updated {correction_reason}` | PASS (com D-T3-01 e D-T3-08) |

## 5. Defeitos

| ID | Sev. | Descrição / reprodução | Causa provável | Correção proposta |
|---|---|---|---|---|
| **D-T3-01** | **P2** | Edição de veículo: depois de **qualquer erro do servidor**, o formulário é reiniciado e, ao salvar de novo, **a categoria muda silenciosamente** para a 1ª da lista. Reprodução (`vehicle_reset_repro.log`): fmall, /fleet, T3M0001 (SUV Compacto/ICE) → Editar → placa = GWM1H61 → Salvar ("Já existe um veículo com essa placa"). O campo de placa volta ao valor original e o select passa a mostrar "Hatch Elétrico", enquanto o campo de combustível continua visível. Corrigir a placa e salvar grava `Hatch Elétrico/BEV` com fuel=70. Em outra sequência, fuel virou NULL e bateria 100. Existe também na base c6b26da, mas o delta acrescenta caminhos novos de erro (`photoLinkPending` no envio de foto e recusa de redução do odômetro) | React 19 reinicia o `<form action>` ao fim da action. O `<select value={categoryId}>` controlado volta à 1ª opção no DOM, mas o estado não muda | Não reiniciar o form em erro (submit via `startTransition`/`onSubmit`), ou usar `defaultValue` + `key` para remontar, ou sincronizar `categoryId` no evento `reset`. Teste de regressão: erro → salvar → categoria preservada |
| D-T3-02 | P2 | Fotos legítimas de celular entre 3 e 5 MiB podem ser recusadas sem caminho de saída: 50 MP (8160×6120) por passar de 24 MP, e 12 MP com muito ruído (pouca luz) por não caber em 3 MiB nem em qualidade 0,72. Mensagem genérica "Tente uma foto nítida…" | `prepareLicenseDocument` não reduz a resolução por princípio (MAX_PIXELS e piso de qualidade) | Reduzir em degraus até um mínimo legível (ex.: lado maior ≥ 2400–3000 px) antes de recusar; mensagem específica ("reduza a resolução da câmera") |
| D-T3-03 | P2 (risco, INSP) | PDF de várias páginas vira **uma única imagem muito alta** (1697×7200 para 3 páginas, 1697×12000 para 5). A API de visão costuma reduzir imagens grandes e tem limite de dimensão; a imagem pode ser reduzida até ficar ilegível ou ser rejeitada. Não verificável sem IA real | empilhamento vertical | Enviar uma imagem por página (vários blocos) ou limitar a altura; validar com a IA real |
| D-T3-04 | P3 | Formato inválido (`.txt`) mostra "Não foi possível preparar este documento…" em vez de `notAnImage` | `handlePicked` não confere o tipo; o erro DOCUMENT_TYPE vira a mensagem genérica | Conferir o tipo em `handlePicked` e mapear DOCUMENT_TYPE → `notAnImage` |
| D-T3-05 | P3 | Limite declarado de "8 páginas", mas PDFs A4 de 6 a 8 páginas são recusados (24 MP / 16000 px) | limites combinados com escala 2400 px | Ajustar a escala ao número de páginas ou documentar o limite real (5 páginas A4) |
| D-T3-06 | P3 | Mobile 390: o nome do arquivo escolhido sobrepõe os botões "Capturar / Enviar arquivo" (`shots/cnh_mobile_*.png`) | flex-wrap com `min-w-0` e botões largos | Truncar o nome (`truncate`) ou colocar os botões abaixo |
| D-T3-07 | P3 | Falha da IA (status `error`) mostra só "Tente novamente em instantes". A orientação de pedir cadastro manual ao gestor (`unreadableGiveUp`) aparece só no estado ilegível. Com a IA fora do ar, o usuário fica sem saída | UI | Mostrar também `unreadableGiveUp` em `error`; textos dizem "foto" mesmo para PDF |
| D-T3-08 | P3 | Edição de odômetro: depois da recusa do servidor, o valor digitado se perde (volta a 15000) e o campo de justificativa continua visível; o textarea não tem o estilo dos demais campos | mesmo reinício do form (D-T3-01); textarea sem classes | Junto com D-T3-01; aplicar o estilo padrão |
| D-T3-09 | P3 (INSP) | PDF ≤3 MiB vai ao servidor original. No fallback do servidor (`renderPdfFirstPageToPng`) **só a 1ª página** é usada | fallback antigo | Renderizar todas as páginas também no fallback |

### Decisões (não são defeitos pela regra literal)

- **DEC-T3-01:** reserva para conduzir sem CNH. O RPC aceita e só a rota /trips/new barra.
- **DEC-T3-02:** Segurança sem CNH acessa /trips/new (o middleware isenta `security`).
- **DEC-T3-03:** a matriz e o `capture.mjs` usam `/settings/users` com gestor em SCR-FM-007, mas o gestor é redirecionado.
- **DEC-T3-04:** a aba "Caronas" de /trips não inclui ofertas do próprio motorista.

## 6. O que NÃO foi testado

- **IA/OCR real.** Leitura de campos, estado "analyzed", confirmação humana ponta a ponta, rótulo IA gravado pela confirmação e leitura de PDF protegido pequeno pela IA: não existe chave local.
- **Voz e Google Maps/Places.** Casamento real de carona.
- **Celulares reais e câmera real.** O `CameraCaptureModal` não foi exercitado.
- **Hospedagem real.** Limite de corpo de 4,5 MB do Vercel: localmente `bodySizeLimit` é 8 MB, e só foi medido que o POST fica ≤3 MiB.
- **Saída pela portaria isolando a CNH** (bloqueio anterior por falta de checklist). Coberto por INSP + HIST.
- **Confronto visual das 25 telas** sem referência definitiva.
- **Fluxo real de registro de exceção pela Segurança.**

## 7. Arquivos

Na pasta `C:\projects\fleet\_local\fleet-integ\docs\integracao_consolidado_2026-10-22\T3\`:

- scripts: `gen_docs.py`, `mk_t3_users.mjs`, `cnh_browser.mjs`, `roles_matrix.mjs`, `roles_probe.mjs`, `driving_rpc.sql`, `run_sql.mjs`, `admin_license.mjs`, `admin_manual.mjs`, `screens.mjs`, `carpool_exception_ui.mjs`, `exception_setup.sql`, `tasks_measure_setup.sql`, `tasks_measure_ui.mjs`, `vehicle_reset_repro.mjs`, `fleet_probe.mjs`;
- logs e JSON correspondentes;
- capturas em `shots\`, com a imagem preparada em `shots\prepared\`.

Material grande fica fora do git em `C:\projects\fleet\_local\homolog\conclusao\T3\`: documentos sintéticos, arquivos enviados, PNGs das 28 telas, referências reduzidas.
