# Relatório S3: E2E de navegador, 28 telas, carona por pontos, saída impedida, Assistente e conferência visual (LOCAL)

- **Executado em:** 22/10/2026, das 09:15 às 10:40 (horário de São Paulo), na branch `integracao-conclusao-2026-10-22` (HEAD 5b5a9d0).
- **Ambiente:** app em `http://localhost:3100` (next dev, worktree `C:\projects\fleet-integ`) e banco local `supabase_db_fleet-homolog`, com migrations até a 0213. A 0214 **não** foi aplicada.
- **Ferramenta:** Chromium headless (Playwright de `C:/projects/fleet/testing/live-demo`). O login foi sempre feito pelo formulário real `/login`.
- **O que não foi feito:** nada em produção, nenhuma chamada a Google, Claude ou Brevo. Nenhum código-fonte nem migration foi editado. Nenhum git write. Nenhum `db reset`.
- **Onde está a evidência:**
  - Scripts `*.mjs` e resultados `*.json`/`*.log` ficam em `C:\projects\_homolog\conclusao\S3\`.
  - As capturas ficam em `shots\`, e as 86 capturas das telas em `shots\screens\`.
  - As comparações lado a lado (referência à esquerda, app à direita) ficam em `compare\`.
  - As referências reduzidas para no máximo 1800 px ficam em `refs\`.
- **Legenda:**
  - **EXEC** = teste executado, com evidência.
  - **EST** = inspeção estática do código.
  - **HIST** = resultado histórico, usado só como referência.
  - **NT** = não testado.
- **Concorrência:** o agente S1 rodou ao mesmo tempo no mesmo banco. Ele criou a organização `b5000000-…`, os veículos `S1*` e os usuários `s1*`. Também altera as flags de vencidas. Os meus fixtures têm prefixo próprio, `e3…`/`e4…` e `S3`. Os números de KPI das capturas incluem dados do S1.

## 0. Preparação e alterações locais feitas pelo S3 (todas no banco descartável)

| Item | Detalhe | Por quê |
|---|---|---|
| 2 usuários locais | `s3admin@…` (administrador, sem CNH) e `s3fmexp@…` (gestor, todas as unidades, CNH vencida em 2026-01-10). Criados pela Auth admin API **local** (127.0.0.1:55321). Senhas aleatórias em `s3users.json` (não impressas). | Matriz pedida: admin sem CNH e gestor com CNH inválida. O seed não tinha esses perfis. |
| Perfil de equipamentos por veículo | GWM2H62 e GWM6T36 → obrigatórios: Triângulo e Extintor (`fm_equipment_profiles`, versão 1) | **Nenhum** veículo do seed tem equipamentos configurados. Por isso nenhum checklist de retirada pode ser gravado localmente (`EQUIPMENT_CONFIGURATION_REQUIRED`). Ver OBS-1. |
| Fixture T2 | Reservas `e3…b1` e `e3…b2` (ver T2) | Saída impedida com checklist feito |
| Fixture T4 | Reservas `e4…b1` (confirmada, vencida, sem atividade) e `e4…b2` (pendente, vencida) do Lucas | Selos de vencidas |
| Veículo `STT3A01` | Criado pela UI com foto (T1b) e depois **arquivado** via `fm_fleet_lifecycle` | Não aparecer nas buscas dos outros agentes |
| Grant temporário | `REVOKE SELECT ON corporate_mobility_points FROM authenticated` por cerca de 1 min, depois `GRANT` de volta. Grants iguais antes e depois (`t3_grants_before/after.txt`). | Simular falha de leitura dos pontos |
| Dados alterados pela UI | Fotos de GWM4J14 (320 px), GWM2H62 e GWM6T36 (1×1 px). Pedidos de carona: Thiago ACEITO em `da74567b`, Beatriz RECUSADA em `a23ca2e4`. Mensagens no chat do Lucas. | Testes T1, T3 e T5 |

## 1. Resultado por teste

### T1: Foto do veículo pela edição da Frota (EXEC)
Evidência: `t1_photo_results.json`, `t1b_newvehicle.json`, `t1c_photo320_results.json` e as capturas `shots/T1_*`, `T1b_*`, `T1c_*`.

| ID | Cenário | Papel/unidade | Esperado × obtido | Status |
|---|---|---|---|---|
| T1-1 | Editar GWM4J14 e anexar PNG | admin | Foto gravada e exibida. `photo_storage_path` preenchido, `fm_photo_uploads.state=linked`. Imagem exibida via `_next/image` sobre URL assinada; PNG 320×200 com naturalWidth 180 no painel. | PASS |
| T1-2 | Editar GWM2H62 e anexar PNG | fmall (todas as unidades) | Igual ao T1-1 | PASS |
| T1-3 | Editar GWM6T36 (Campinas) | fmcampinas (dentro do escopo) | Igual ao T1-1 | PASS |
| T1-4 | Editar GWM1H61 (SP) | fmcampinas (fora do escopo) | O veículo não aparece na lista da Frota. No banco, `update vehicles` afeta 0 linhas e `fm_photo_begin` retorna `NOT_AUTHORIZED`. | PASS |
| T1-5 | `fm_photo_begin` direto | lucas, security, maint | `NOT_AUTHORIZED` | PASS |
| T1-6 | Cadastrar veículo novo com foto e recarregar `/fleet` | admin | Veículo criado com foto `linked`. `/fleet` responde 200, sem error boundary, sem 5xx e sem erro de console (allow-list de imagens assinadas OK). | PASS |

**Conclusão:** a 0210/0212 **não** causou regressão no cadastro de foto pela edição da Frota.

Observação: com a imagem de teste 1×1 px, o `<img>` grande (`.vw-photo`) ficou com `naturalWidth=0` apesar do 200 do otimizador. Com 320×200 tudo carregou. Trato como artefato da imagem minúscula. Esse caso é o "img:1" que aparece em `/fleet` no T7.

### T2: Regularização de saída impedida (`/reservations/[id]`, OperationExceptionForm)
**Fixture:**
- `e3…b1`: GWM2H62, SP (gate_visual), solicitante Mariana, confirmada. Tem checklist do viajante e da portaria e um evento `denied` da portaria.
- `e3…b2`: GWM6T36, Campinas (key_custody), solicitante Thiago, com checklist do viajante.

As inspeções foram inseridas com o `auth.uid()` do ator real, e o trigger `fm_verify_inspection` foi respeitado. Evidência: `t2_exception.json`, `t2b_retry.json` e as capturas `shots/T2_*` e `T2b_*`.

| ID | Cenário | Papel | Esperado × obtido | Status |
|---|---|---|---|---|
| T2-1 | Visibilidade em b1 | mariana (solicitante) | Página abre sem o formulário | PASS |
| T2-2 | | lucas (outro colaborador) | Redireciona para `/trips` | PASS |
| T2-3 | | fmcampinas (outra unidade) | Redireciona para `/trips` | PASS |
| T2-4 | | maint | Redireciona para `/trips` | PASS |
| T2-5 | | security SP (portaria visual: a RPC permite) | Formulário visível | PASS |
| T2-6 | | admin, fmall | Formulário visível | PASS |
| T2-7 | Visibilidade em b2 (custódia) | security (fora da regra da RPC) | Esperado: oculto. **Obtido: visível.** Ao enviar, aparece "Seu acesso não permite regularizar esta operação." | **FAIL (S3-04)** |
| T2-8 | | thiago (solicitante), custodian | Sem formulário / `/trips` | PASS |
| T2-9 | Validação | fmall | `required` na justificativa (mínimo 3) e na confirmação. Envio vazio é bloqueado pelo navegador (0 recibos). Burlando o HTML, o servidor recusa com texto simples ("Informe uma justificativa de 3 a 1000 caracteres e confirme…"). | PASS |
| T2-10 | Erro transitório | fmall | Veículo marcado `in_use` → mensagem "Há registro de saída ou viagem em andamento…". 0 recibos, reserva continua confirmada. O `request_id` foi mantido. | PASS |
| T2-11 | Retry com o mesmo `request_id` | fmall | Após restaurar o veículo, a retentativa teve sucesso com **o mesmo** `request_id` (1 recibo). A caixa de confirmação veio **desmarcada** depois do erro, e o usuário teve de marcar de novo (S3-07). | PASS (com ressalva) |
| T2-12 | Efeito no banco | — | Reserva `cancelled`, `cancelled_by=fmall`, motivo = justificativa. `fm_operation_exceptions`: `not_departed`, `gate_visual`, `fleet_manager`, `gate_event_id=null`, veículo `reserved→reserved` (há a reserva f6). `audit_log`: `operation.exception` com outcome, motivo e exception_id. Notificação à Mariana: 1. **Nenhuma saída, chegada ou devolução fictícia:** os eventos da portaria continuam só `denied`, e as inspeções só pickup/traveler e pickup/security. | PASS |
| T2-13 | Idempotência | fmall (RPC) | Reenvio do mesmo `request_id` devolve o resultado gravado. Novo `request_id` após o sucesso → `RESERVATION_NOT_CONFIRMED`. Recarregando, o formulário não reaparece. | PASS |
| T2-14 | Feedback de sucesso | fmall | Esperado: "Exceção registrada…". **Obtido:** nenhuma mensagem. O formulário some porque a reserva deixa de estar `confirmed`, e a tela mostra apenas "Cancelada". | **FAIL (S3-05)** |
| T2-15 | Rótulo "veículo não saiu" | mariana, fmall | `/trips` e o detalhe mostram só "Cancelada", sem indicar "encerrada por exceção / veículo não saiu" | **Decisão (S3-08)** |
| T2-16 | Custódia (b2) | fmcampinas (escopo correto) | Formulário visível. Ao enviar: "Há registro de saída ou viagem em andamento…", porque a RPC devolve `VEHICLE_ON_TRIP` sempre que existe checklist de retirada em key_custody. | **FAIL (S3-06)** |
| T2-17 | Linguagem simples | todos | Nenhuma mensagem exibida contém código técnico (`techCodesInMessages: []`) | PASS |

Testes unitários (EXEC): `vitest app/reservations lib/operations lib/supabase/managementLicenseBoundary` = **26 arquivos e 200 testes, todos passaram** (`vitest_reservations_ops.log`).

### T3: Carona por pontos de mobilidade corporativos (`/carpool`, `/fleet/carpools`)
Evidência: `t3_carpool_normal.json`, `t3_carpool_points_revoked.json`, `t3b_host.json`, `t3c_reject.json` e as capturas `shots/T3_*`.

| ID | Cenário | Papel | Esperado × obtido | Status |
|---|---|---|---|---|
| T3-1 | Nome exato ("Matriz Faria Lima" → "Centro Técnico Campinas"), 24/10 08:00 | thiago | O ponto resolve sem provedor e a busca chega ao motor (`carpool_search_log`: 3 ofertas avaliadas, 1 no pré-filtro). A rota precisa usa Google Routes, que não existe localmente: aparece o aviso amigável "O serviço de mapas do Google está indisponível… continue com a reserva de veículo". | PASS (degradação) / matching final **NT** |
| T3-2 | Rótulo canônico ("Nome - endereço") | thiago | Igual ao T3-1 (3/1) | PASS (degradação) |
| T3-3 | Só o endereço do ponto | thiago | Igual ao T3-1 (3/1) | PASS (degradação) |
| T3-4 | Alias ("Sede SP" → "CT Campinas") e minúsculas/sem acento | thiago | Igual ao T3-1 (3/1) | PASS (degradação) |
| T3-5 | Ponto → GRU, 23/10 09:00 | thiago | Igual ao T3-1 (3/1) | PASS (degradação) |
| T3-6 | Endereço comum (Av. Paulista…) | thiago | Nenhuma busca registrada: o geocoder (Google) não está disponível. Mesmo aviso amigável. | PASS (degradação) |
| T3-7 | Falha do Google | — | Degrada com mensagem simples, sem 5xx e sem console error. Política de raio/janela intacta (EST: `runCarpoolSearch` não foi alterado; testes unitários passam). | PASS |
| T3-8 | Falha de leitura dos pontos (REVOKE SELECT) | thiago | Esperado: fechar com segurança e informar a causa. **Obtido:** o lado do passageiro trata o erro como "lista vazia" (`searchActions.ts`: `points = []`) e cai no geocoder. Localmente fecha só porque não há Google, e a mensagem culpa o Google. Em produção o texto seria geocodificado pelo Google. O lado do anfitrião (`actions.ts`) fecha corretamente com `geocoding_unavailable`. | **FAIL (S3-02)** |
| T3-9 | Vazamento entre unidades/organizações | — | A busca é por organização (admin client filtrado pela org do usuário autenticado), e carona não tem recorte por unidade (EST). A organização B do S1 não aparece em nenhuma tela da org A (ver T7). | PASS (EST + EXEC parcial) |
| T3-10 | Anfitrião aceita o pedido pendente (Thiago) em `/reservations/f2` | lucas | `ACCEPTED`, `responded_by=lucas`, vagas 2→1. Um clique, sem confirmação. | PASS |
| T3-11 | Anfitrião recusa com motivo (Beatriz) em `/reservations/f6` | lucas | `confirm()` nativo "Recusar este pedido de carona?" → `REJECTED` com o motivo gravado, e o histórico mostra o motivo | PASS |
| T3-12 | "Passageiros confirmados" do anfitrião | lucas | Esperado: Mariana e Thiago. **Obtido:** "Nenhum passageiro confirmado ainda". Por PostgREST: `PGRST201` (embed ambíguo `trip_participants`→`profiles`). | **FAIL (S3-01)** |
| T3-13 | Pedido via UI pelo passageiro | — | Não foi possível: a busca não retorna ofertas sem Google. Usei os pedidos PENDING do seed. | BLOCKED |

Testes unitários (EXEC): `vitest app/carpool lib/carpool lib/geospatial app/fleet/carpools` = **26 arquivos e 323 testes, todos passaram** (`vitest_carpool_res.log`).

### T4: Vencidas na UI (tela), com os dois interruptores desligados
- `.env.local` sem `FM_ENABLE_AUTO_RESERVATION_RELEASE`.
- `organization_settings.auto_release_enabled=false` na org A.

Evidência: `t4_expired.json` e as capturas `shots/T4_*`.

| ID | Cenário | Esperado × obtido | Status |
|---|---|---|---|
| T4-1 | Lucas busca veículo em `/trips/new` (RJ→SDU, 23/10) | Nada é cancelado. `e4…b1` continua `confirmed` e `e4…b2` continua `pending_approval`. A contagem de `no_show_auto`/`expired_unapproved` ficou igual antes e depois (52, contando dados do S1). | PASS |
| T4-2 | `/trips` do Lucas, aba Canceladas | `e4…b1` (confirmada, vencida, sem atividade) mostra "**Não retirada**". `e4…b2` mostra "Expirada sem aprovação". A reserva x1, cancelada normalmente, mostra só "Cancelada". | PASS |
| T4-3 | Reserva ativa u1 (GWM3H63, com saída) | Aparece em "Em andamento", sem o selo | PASS |
| T4-4 | `/trips` da Mariana | `e3…b1` (encerrada por exceção) mostra "Cancelada", sem "Não retirada" | PASS |
| T4-5 | Ativação por organização / flag ligada | Responsabilidade do S1 | NT (escopo S1) |

Observação: a busca de veículo para uma viagem no RJ recomendou o `STT3A01`, veículo de teste baseado em SP, porque era o único livre. Ele foi arquivado logo depois. A recomendação não considera a unidade/local da origem. É comportamento existente e não foi investigado.

### T5: Assistente FleetMind sem chave de IA
Evidência: `t5_assistant.json`, as capturas `shots/T5_*` e `vitest_chat_trips.log`.

| ID | Cenário | Esperado × obtido | Status |
|---|---|---|---|
| T5-1 | Mensagem "viagem hoje 15h→22h, fábrica GWM → EZ Tower, oferecendo caronas" em pt-BR | "Não consegui concluir o seu pedido. Algo falhou do nosso lado — não foi nada que você fez… O que você já me contou continua aqui." Sem códigos técnicos. | PASS |
| T5-2 | O mesmo em en-US, es e zh-CN (cookie `fleet-locale`) | Resposta equivalente no idioma, com `html lang` correto e sem códigos técnicos | PASS |
| T5-3 | Troca de idioma pelo LanguageToggle | pt-BR → en-US ("Hello, Lucas!") → pt-BR | PASS |
| T5-4 | Camada de apresentação/despacho | `vitest app/chat lib/trips` = **12 arquivos e 231 testes, todos passaram** (inclui `noVehicleFlow` com 104 casos, `carpoolChat`, `carpoolDispatch`, `persistedPending`) | PASS |
| T5-5 | Cancelar/confirmar nos cartões (confirmação humana) | Os cartões só aparecem com interpretação real da IA. Ao vivo: NT. Coberto apenas pelos testes unitários. | NT (ao vivo) |
| T5-6 | Chamadas reais à IA, voz, OCR, custos | — | **NT** |

Notas:
- A conversa persiste entre idiomas: no zh-CN aparecem as mensagens anteriores em espanhol. É esperado.
- No dev, o indicador "N" do Next sobrepõe o botão-robô do assistente na barra lateral (só em desenvolvimento).

### T6: Papéis × rotas (36 rotas × 13 perfis = 468 navegações, EXEC)
Evidência: `t6_roles.json` e `t6_roles.log`. Nenhuma das 468 navegações teve 5xx ou pageerror. Todas as rotas permitidas abriram no shell novo.

| Perfil | Resultado |
|---|---|
| administrator (com CNH) | As 36 rotas abrem |
| **administrator sem CNH (s3admin)** | `/fleet/*`, `/maintenance/*`, `/settings/*` e `/account/*` abrem. **`/admin`, `/admin/units`, `/admin/integrations`, `/admin/audit`, `/admin/ai`, `/analytics`, `/analytics/carpool`, `/dashboard`, `/dashboard/command-center` e `/gate/*` redirecionam para `/account/license`.** → **FAIL (S3-03, P1)** |
| fleet_manager, todas as unidades | Tudo, exceto `/admin/*` (→ `/dashboard`) e `/settings/users` (→ `/settings`) |
| fleet_manager limitado (fmcampinas) | Igual ao anterior. `/reservations/f2` (SP) → `/trips`; `/fleet/vehicles/GWM1H61` (SP) → `/fleet`. Escopo correto. |
| **fleet_manager com CNH vencida (s3fmexp)** | Mesmo padrão do admin sem CNH: perde `/dashboard`, `/analytics` e `/gate`, além das rotas de condução (`/trips*`, `/carpool*`). Ver S3-03/S3-09. |
| security | `/gate/*`, `/dashboard`, `/trips*`, `/carpool*`, `/reservations/[id]` e `/account*`. O restante → `/dashboard`. |
| maintenance_operator | `/maintenance/*`, `/dashboard`, `/trips*`, `/carpool*` e `/account*`. `/fleet` e `/admin` → `/dashboard`. |
| custodiante e colaboradores (lucas, mariana, thiago) | `/dashboard`, `/trips*`, `/carpool*` e `/account*`. Reserva de outra pessoa → `/trips`. Gestão/admin → `/dashboard`. Lucas: `/maintenance/planning` e `/maintenance/work-orders` vão para `/` em vez de `/dashboard` (inconsistência cosmética). |
| **colaborador com CNH vencida (felipe) ou NULL (beatriz)** | **Todas** as rotas fora de `/account` → `/account/license`, inclusive `/dashboard`, `/trips` (consulta) e `/carpool` (buscar carona como **passageiro**). → **Decisão/defeito S3-09.** O histórico (HIST, E2E de 20–21/10) registrava como PASS apenas o bloqueio em `/trips/new`. |
| Negação | Os redirecionamentos são silenciosos (sem 403 nem mensagem explicando o motivo). Não é defeito. Fica registrado. |

### T7: As 28 telas, conferência funcional e visual (EXEC)
- **Captura:** 86 capturas em 1440×900 e 390×844, no papel de cada tela (`t7_screens_index.json`, `shots/screens/`), mais 9 capturas de idioma (es, en-US e zh-CN).
- **Erros técnicos:** 0 erros de console, 0 respostas ≥400 inesperadas, 0 overflow horizontal em todas as telas e viewports, e nenhuma chave i18n crua **na interface**.
- **Exceção:** os códigos de ação de auditoria aparecem crus em `/admin` e `/admin/audit`. Ver S3-10.
- **Redirecionamentos:** só os esperados (`/settings/users` para gestor → `/settings`).

Comparação visual feita por inspeção humana das composições lado a lado em `compare\`.
- As referências marcadas "prop." são PROPOSTAS (`PROPOSED_IMAGE_MAPPING.md`, ainda não aprovadas).
- **Nenhuma tela é declarada fiel.**
- "Aprov. funcional" = renderiza e opera com dados reais, sem erro, no papel certo.

| Tela | Rota capturada (papel) | Referência | Aprov. funcional | Aprov. visual | Divergências principais observadas |
|---|---|---|---|---|---|
| SCR-FM-001 | /dashboard/command-center (fmall) | **Definitiva** FM001 | Sim | Não | A estrutura bate (KPIs, Intelligence, Localização, Economia, gráficos, Alertas, Ações rápidas). Mapa "indisponível" no lugar do mapa ao vivo, KPIs com "—" (sem fonte), barra de busca global do topo ausente, painel "Pergunte ao FleetMind" diferente, gráficos sem séries históricas. |
| SCR-FM-002 | /fleet, /fleet/vehicles/[id] (fmall) | **Definitiva** FM002 Rev04 | Sim (T1) | Não | Lista à esquerda e detalhe com abas conferem. Faltam: mapa GPS, motorista atual, gráficos de utilização/consumo, botões "Exportar/Cadastrar" no topo ("+ Adicionar Veículo" fica no rodapé) e miniaturas de foto padrão. |
| SCR-FM-003 | /dashboard, /trips, /reservations/[id] (fmall) | Prop. 11 | Sim (T2) | Nenhuma | A referência traz Gantt e detalhe com mapa. O app traz lista de aprovações, tarefas e "Precisa de atenção". |
| SCR-FM-004 | /fleet/carpools, /analytics/carpool, /carpool (fmall) | **Definitiva** FM004 Rev02 | Sim (T3) | Não | KPIs, abas, filtros e lista + detalhe conferem. Diferenças: barra lateral recolhida (ícones), sem foto do veículo/avatar/avaliação, sem mapa no detalhe, Intelligence/Impacto em texto ("cálculo indisponível"). |
| SCR-FM-005 | /fleet/maintenance, /maintenance/planning | Prop. 24 | Sim | Nenhuma | Tabela de OS + painel lateral. Sem calendário e sem rosca de disponibilidade. |
| SCR-FM-006 | /fleet/energy | Prop. 26 | Sim | Nenhuma | Lista + "Novo lançamento". Sem gráficos de custo/consumo. |
| SCR-FM-007 | /fleet/drivers, /settings/users | Prop. 22 | Sim | Nenhuma | Tabela de condutores + detalhe. Sem foto, gráficos ou avaliações. |
| SCR-FM-008 | /fleet/incidents | Prop. 19 | Sim | Nenhuma | Fila de ocorrências e análise. Sem galeria de fotos no detalhe. |
| SCR-FM-009 | /analytics | Prop. 02 | Sim | Nenhuma | KPIs + subutilizados/preditiva/tabela. Sem gráficos de custo/sustentabilidade. **Lista veículos arquivados** como "subutilizados" (S3-11). |
| SCR-USR-001 | /dashboard (lucas) | Prop. 07/39 (mobile) | Sim | Nenhuma | A referência é mobile, com carona sugerida e sustentabilidade. O app mostra o painel de veículos. |
| SCR-USR-002 | /trips/new (lucas) | Prop. 04/06 | Sim (T4) | Nenhuma | O stepper confere. Mapa substituído por placeholder (sem Google). |
| SCR-USR-003 | /carpool (lucas) | Prop. 05 | Sim (T3, com degradação) | Nenhuma | Formulário único. Sem abas "Encontrar/Oferecer" e sem lista com mapa (dependem de resultado). |
| SCR-USR-004 | /trips, /reservations/[id] (lucas) | Prop. 08 | Sim (T4) | Nenhuma | Abas e cartões conferem em essência. Sem painel lateral de detalhe. |
| SCR-USR-005 | /reservations/u3/pickup (thiago), /u2/return (mariana) | Prop. 09/13 | **Parcial:** a retirada mostra "Não foi possível preparar a configuração de equipamentos…" (OBS-1) | Nenhuma | Fluxo de 4 passos não exercitado: falta configuração de equipamentos no seed |
| SCR-USR-006 | /carpool/mine (lucas) | Prop. 32/33 | Sim | Nenhuma | "Caronas (0)" para o Lucas, que é anfitrião de 3 ofertas ativas: a tela lista só a visão de passageiro. A referência tem "Como motorista/Como passageiro" (S3-12, decisão). |
| SCR-SEC-001 | /gate (security) | Prop. 38 | Sim | Nenhuma | Lista de movimentos + busca por placa. Sem painel de detalhe com foto. |
| SCR-SEC-002 | /gate/exceptions | Prop. 30 | Sim | Nenhuma | Tabela de relatos + painel "Análise". Sem fotos. |
| SCR-SEC-003 | /gate/history | Prop. 23 | Sim | Nenhuma | Histórico + linha do tempo. A saída negada da fixture T2 aparece como "Impedida". |
| SCR-MNT-001 | /maintenance (maint) | Prop. 16 | Sim | Nenhuma | Sem gráficos (rosca/barras). Tabela de OS. |
| SCR-MNT-002 | /maintenance/planning | Prop. 37 | Sim | Nenhuma | Calendário em faixa simples, sem calendário mensal |
| SCR-MNT-003 | /maintenance/work-orders | Prop. 40 | Sim | Nenhuma | Lista + detalhe de OS. Sem documentos com prévia. |
| SCR-MNT-004 | /maintenance/vehicles | Prop. 12 | Sim | Nenhuma | Prontuário sem gráficos de custo nem "Condição geral" |
| SCR-ADM-001 | /admin (admin) | Prop. 43 | Sim | Nenhuma | Módulos + atividade recente. **Códigos crus** (`fleet.lifecycle`, `photo.linked`, `carpool_ride_*`). |
| SCR-ADM-002 | /settings/users (admin) | Prop. 44 | Sim | Nenhuma | Lista com edição inline de CNH. Sem matriz de permissões por módulo. |
| SCR-ADM-003 | /settings, /settings/mobility-points, /admin/units | Prop. 29 | Sim | Nenhuma | Políticas da organização em formulário. Sem cartões de unidades com foto/mapa. Os 6 pontos aparecem em /settings/mobility-points. |
| SCR-ADM-004 | /admin/integrations | Prop. 46 | Sim | Nenhuma | Tabela honesta ("Não configurado"), sem métricas fictícias |
| SCR-ADM-005 | /admin/audit, /account/privacy | Prop. 27 | Sim | Nenhuma | Lista de eventos com **códigos de ação crus** (S3-10) |
| SCR-ADM-006 | /admin/ai | Prop. 42 | Sim | Nenhuma | Três cartões + publicação de política. Sem painel de modelos/métricas. |

**Pendência de referência visual:** 25 das 28 telas não têm referência **definitiva**. Só existem as propostas, que ainda não foram aprovadas. A homologação visual dessas 25 fica **PENDENTE** até o dono confirmar as referências.

Nas três telas com referência definitiva (FM-001, FM-002, FM-004), a estrutura confere, mas há lacunas de conteúdo, mapa, histórico e fotos. Por isso **não declaro fidelidade**.

## 2. Defeitos

| ID | Sev. | Papel | Reprodução | Causa provável | Correção proposta |
|---|---|---|---|---|---|
| **S3-03** | **P1** | administrador/gestor sem CNH válida | Login como `s3admin` (admin, CNH NULL) → abrir `/admin`, `/admin/audit`, `/analytics`, `/dashboard` ou `/gate` → redireciona para `/account/license` | `lib/supabase/middleware.ts`: `administrativePath` cobre só `/fleet`, `/settings` e `/maintenance`. `/admin`, `/analytics`, `/dashboard*` e `/gate` caem no portão de CNH. Viola a regra preservada "acesso administrativo independente de poder dirigir". | Incluir `/admin`, `/analytics`, `/dashboard` (incluindo command-center) e `/gate` no conjunto administrativo para administrator/fleet_manager (e `/gate` para security, que já é isento). Manter o portão em `/trips/new`, `/reservations/*/pickup` e na condução. Acrescentar o caso ao `managementLicenseBoundary.test.ts`. |
| **S3-01** | P2 | anfitrião de carona | Lucas abre `/reservations/7d810d39…` (f2) → "Passageiros confirmados: Nenhum…", embora haja 2 aceitos. REST: `select=id,passenger:profiles(full_name)` → HTTP 300 `PGRST201`. | `trip_participants` tem 2 FKs para `profiles` (`passenger_id` e `left_by`, este da 0185). O embed `passenger:profiles(...)` ficou ambíguo e o erro é engolido (data=null). Afeta `app/reservations/[id]/loadHostCarpool.ts:64` e `app/reservations/[id]/page.tsx:91` (pendentes legados). Defeito anterior ao pacote. | Usar `passenger:profiles!trip_participants_passenger_id_fkey(full_name)` (ou `!passenger_id`) nos dois pontos. Tratar `error` dessas consultas (não exibir "nenhum" em caso de erro). |
| **S3-02** | P2 | colaborador (passageiro) | REVOKE SELECT dos pontos → buscar "Matriz Faria Lima" → nenhuma busca chega ao motor. O app cai no geocoder e exibe a mensagem do Google. | `app/carpool/searchActions.ts`: `const points = pointsResult.status === "ok" ? pointsResult.data : []` não fecha em erro. Em produção, o texto seria geocodificado pelo Google sem o ponto canônico. Assimetria com o anfitrião (`actions.ts`, que fecha). | `if (pointsResult.status !== "ok") return { status: "unavailable", reason: "points_unavailable" }`, com texto próprio ("Não conseguimos consultar os locais da empresa agora…"). Adicionar teste. |
| **S3-06** | P2 | gestor/custodiante, unidade key_custody | `e3…b2` (Campinas, checklist do viajante feito) → fmcampinas → "Encerrar por exceção" → "Há registro de saída ou viagem em andamento…" | A página mostra o formulário quando `pickup_traveler` é verdadeiro. A RPC `fm_operation_exception` (0211) devolve `VEHICLE_ON_TRIP` sempre que há inspeção de retirada em key_custody. Em custódia, o formulário só aparece em casos que a RPC sempre recusa (beco sem saída). | **Decisão do dono:** (a) não exibir o formulário em key_custody quando houver checklist de retirada e orientar para o fluxo de devolução; ou (b) definir a regra de "não saiu" em custódia (por exemplo, chaves devolvidas sem saída). Ajustar a mensagem para o caso de custódia. |
| **S3-04** | P3 | security em unidade key_custody | Sérgio (security) abre `e3…b2` → vê "Regularizar saída impedida" → ao enviar: "Seu acesso não permite…" | `page.tsx:311`: `isPrivileged` inclui security sem considerar o workflow. A RPC só aceita security em `gate_visual`. | Exibir para security somente se `checklistState.workflow==='gate_visual'`, e para gestor somente se o escopo permitir (espelhar a RPC). |
| **S3-05** | P3 | gestor/admin | Concluir T2 com sucesso → nenhuma confirmação aparece. A mensagem "Exceção registrada…" nunca é renderizada. | O sucesso chama `revalidatePath` e a reserva fica `cancelled`. A condição `reservation.status==='confirmed'` desmonta o componente que guardava o estado. | Renderizar um aviso persistente para reservas com `fm_operation_exceptions` (por exemplo "Encerrada por exceção: veículo não saiu"), ou manter o componente montado e exibir o `status` de sucesso |
| **S3-07** | P3 | gestor/admin | Enviar válido → erro do servidor → a caixa "Confirmo que o veículo não saiu…" volta desmarcada (a justificativa permanece) | Reset automático do formulário do React 19 após a action. O `onReset preventDefault` não impede a perda visual do checkbox controlado. | Seguro como está (exige reconfirmar). Se quiser manter, sincronizar `checked` após a action (por exemplo com `key` estável ou `form` sem reset via `startTransition`). Baixa prioridade. |
| **S3-10** | P3 | admin | `/admin` (Atividade recente) e `/admin/audit` exibem `fleet.lifecycle`, `photo.linked`, `operation.exception`, `keys.delivered`, `keys.received`, `vehicle.created`, `vehicle.damage_hold_released`, `carpool_ride_accepted/rejected` | Faltam rótulos i18n para essas ações (várias são novas do pacote: 0200/0210/0212) | Acrescentar os rótulos nos 4 dicionários. Usar fallback legível em vez da chave crua. |
| **S3-11** | P3 | gestor | `/analytics` → "Veículos Subutilizados" lista veículos arquivados (S1*, STT3A01) | A consulta não filtra `archived_at is null` | Filtrar arquivados nas métricas de utilização |
| **S3-09** | Decisão (P2 se confirmado) | colaborador com CNH vencida/NULL | Felipe/Beatriz → `/dashboard`, `/trips`, `/carpool` → `/account/license` | O portão de CNH do middleware cobre tudo, exceto `/account`, documentos e devolução | O brief/dono diz "barrado só na condução". Se confirmado, liberar `/dashboard`, `/trips` (consulta), `/carpool` e `/carpool/mine` (passageiro), mantendo o bloqueio em `/trips/new`, retirada e oferta de carona como motorista |
| **S3-08** | Decisão | solicitante/gestor | Reserva encerrada por exceção aparece só como "Cancelada" em `/trips` e no detalhe | Não há rótulo distinto. O `cancellation_reason` é texto livre. | Exibir "Encerrada: veículo não saiu" a partir de `fm_operation_exceptions` |
| **S3-12** | Decisão | colaborador anfitrião | `/carpool/mine` e `/trips?tab=carpools` mostram 0 para quem só oferece carona | A tela lista só a participação como passageiro | Avaliar a aba "Como motorista" prevista na referência proposta 32 |

**Observações de ambiente (não são defeitos do código):**
- **OBS-1:** o seed não configura equipamentos em nenhum veículo nem categoria. Por isso qualquer checklist de retirada (UI ou RPC) falha com `EQUIPMENT_CONFIGURATION_REQUIRED` e a tela SCR-USR-005 mostra o aviso. Para E2E completo de retirada, o seed precisa de `fm_equipment_profiles`. No E2E histórico (HIST) isso era feito pela UI `/fleet/equipment`.
- **OBS-2:** o S1 roda em paralelo no mesmo banco, então os KPIs e listas das capturas incluem os dados dele (usuários `S1*` na org A, veículos arquivados `S1*`). Não houve vazamento da org B em nenhuma tela inspecionada.
- **OBS-3:** o indicador do Next dev ("N") cobre o botão do assistente na barra lateral. Só em desenvolvimento.

## 3. O que não foi testado e por quê
- **Matching final de carona, mapas e rotas:** dependem do Google, ausente de propósito. O motor foi coberto só até o pré-filtro e por 323 testes unitários.
- **Criação de pedido de carona pela UI:** sem resultado de busca sem Google.
- **Cartões de confirmação/cancelamento do assistente ao vivo, IA real, voz, OCR e custos:** sem chave Claude. Coberto só pela camada de despacho, com 231 testes.
- **Checklist completo de retirada e devolução pela UI:** sem configuração de equipamentos no seed (OBS-1). Fiz o fixture T2 via SQL com o ator real.
- **Ativação da liberação de vencidas (flag ligada / por organização):** escopo do S1.
- **Migration 0214:** não aplicada, por instrução.
- **Isolamento entre organizações na busca de carona:** só por inspeção estática e pela ausência de dados da org B nas telas. Sem uma oferta da org B compatível em tempo e rota.

## 4. Repetição × histórico
- A matriz de telas repete a captura histórica (`_homolog/design/capture.mjs`) **com o código da branch integrada**, que é a condição do aceite visual. O E2E histórico (20–21/10) não cobria 0210–0213.
- Divergências em relação ao histórico:
  - O aceite do anfitrião, que antes estava BLOCKED, agora PASSA.
  - O bloqueio de CNH, antes registrado só em `/trips/new`, agora aparece em todas as rotas.
  - O defeito S3-01 não foi percebido no histórico.

## 5. Arquivos
- **Scripts:** `common.mjs`, `t1_photo.mjs`, `t1b_newvehicle.mjs`, `t1c_photo320.mjs`, `t2_fixture.mjs`, `t2_exception.mjs`, `t2b_retry.mjs`, `t3_carpool.mjs`, `t3b_host.mjs`, `t3c_reject.mjs`, `t4_expired.mjs`, `t5_assistant.mjs`, `t6_roles.mjs`, `t7_screens.mjs`, `mk_s3users.mjs`, `probe_*.mjs`.
- **Resultados:** `t1_photo_results.json`, `t1b_newvehicle.json`, `t1c_photo320_results.json`, `t2_exception.json`, `t2b_retry.json`, `t3_carpool_normal.json`, `t3_carpool_points_revoked.json`, `t3b_host.json`, `t3c_reject.json`, `t4_expired.json`, `t5_assistant.json`, `t6_roles.json`, `t7_screens_index.json`, `vitest_*.log`.
- **Imagens:** `shots\` (testes), `shots\screens\` (86 capturas + i18n), `compare\` (28 comparações), `refs\` (referências ≤1800 px).
