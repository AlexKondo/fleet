# G1: origem por local cadastrado, idioma e tema em todas as telas, lápis na Frota (2026-10-23)

Pedido do responsável após o deploy `ee56fa5`. Estado: **implementado e testado localmente; NÃO publicado** (aguarda autorização).

## 1. Origem: só aparecem veículos que estão no local de saída
- **Defeito:** a busca de veículos não comparava a origem com a localização do veículo (`vehicles.current_location_id`). Reservar de "São Paulo" sem veículo em SP mostrava veículos de outros locais como se estivessem na origem.
- **Correção:** novo campo **"Local de saída do veículo"** em Reservar Veículo, com a lista dos locais cadastrados e a quantidade de veículos de cada um (ex.: "Fábrica da GWM - ao lado do restaurante · 3 veículos", "SP Office - 3º subsolo · sem veículos"). O servidor só entrega ao motor os veículos desse local. Vale também para o Assistente (o texto da origem é reconhecido pelo nome do local; se não bater com nenhum local, nada é oferecido e a resposta diz isso).
- **Sem veículo no local:** a tela diz "Não há veículos disponíveis em <local>", lista onde há veículos livres e oferece o botão "Ver veículos de outros locais". Ao usar o botão, aparece o aviso "estes veículos não estão em <local>; você precisará retirá-los no local indicado em cada cartão" e um botão para voltar a mostrar só o local de saída.
- **Confirmação:** `confirmTrip` aplica a mesma regra no servidor (um veículo de outro local não pode ser reservado sem o pedido explícito). Um id de local de outra organização nunca é aceito.
- **Arquivos:** `apps/web/lib/trips/originLocation.ts` (+ teste), `apps/web/app/trips/new/actions.ts`, `page.tsx`, `TripRequestForm.tsx`, 14 chaves em `trips.reservar` e 2 motivos em `trips.reasons` nos 5 dicionários.
- **Prova no navegador (banco local):** local de teste sem veículos → bloqueio com lista dos outros locais; "Ver veículos de outros locais" → aviso + veículo; escolher a Garagem Matriz → sem aviso. Capturas em `C:\projects\fleet\_local\tmp\origin_check\`.
- **Atenção de cadastro:** veículo sem "Localização inicial" não entra em nenhuma busca por origem. O gestor precisa preencher o campo em Frota → Editar.

## 2. Idioma e tema em todas as telas
- **Achado:** o idioma já existia (globo sem texto, fácil de não ver); o tema estava escondido em 13 telas marcadas como `legacy` (Frota, Painel, Configurações, Conta, Portaria, Análises) e, onde aparecia, não fazia nada porque o visual FleetMind era só claro.
- **Correção:** o globo agora mostra o idioma ao lado (PT/EN/ES/ZH); o botão de tema aparece em todas as telas; o **tema escuro do FleetMind foi implementado** (tokens `--fm-*` escuros + paleta derivada `--lt-*` para as ~140 cores claras fixas dos CSS; no tema claro os valores são exatamente os originais).
- **Varredura (45 telas, 7 papéis):** antes 1 sem idioma e 14 sem tema; depois, todas as telas reais com os dois botões (a única falha é `/operations`, rota que não existe). Celular 390 px: dois botões dentro da tela, sem rolagem horizontal.
- **Arquivos:** `FmShell.tsx`, `ui/LanguageToggle.tsx`, `carpool/fm-theme.css` (+ 11 CSS), `carpool/shellToggles.test.ts`.
- **Risco residual:** telas pouco usadas podem ter detalhes de contraste no escuro; as principais foram vistas em captura (painel, frota, reservar, viagens, portaria, manutenção, configurações, reserva).

## 3. Frota: lápis no veículo e edição em popup
- Ícone de lápis em cada veículo da lista e ao lado do nome no detalhe; abre um **popup na frente** (janela modal: foco preso, Esc/X/clique no fundo fecham) com o formulário de edição; "Arquivar" e "Ver agenda" ficam no fim do popup. Salvar ou cancelar fecha o popup. O bloco "Cadastro e ações administrativas" foi removido.
- **Arquivos:** `fleet/VehicleEditDialog.tsx` (novo), `VehicleFilterGrid.tsx`, `VehicleRow.tsx`, `vehicle-workspace.css`.
- **Atenção:** os roteiros de teste antigos em `docs/.../T2`, `T3`, `F1`, `F3` clicam em `details.vw-admin`; passam a precisar do lápis (`.vw-row .vw-edit`).

## 4. Verificação
tsc 0 · vitest **1106/1106** (112 arquivos; +20) · lint 0 · `next build` ok. Nenhuma migration; nenhuma mudança em produção.

## 5. Ajuste do contorno e textos que não acompanhavam o idioma (2026-10-23, segunda parte)
- **Frota, linha selecionada:** removida a linha azul interna; ficou só o contorno externo da linha (`vehicle-workspace.css`).
- **Idioma:** uma varredura em inglês de 45 telas achou ~450 textos fixos em português (Frota, caronas, energia, motoristas, ocorrências, portaria, administração, chaves, privacidade, calendário, painel). Foram movidos para arquivos por área em `apps/web/lib/i18n/areas/` (pt-BR, en-US, es, zh-CN, mesmas chaves e mesmos `{parâmetros}`), com o mecanismo `lib/i18n/areaText.ts` e o teste `lib/domain/i18nAreas.test.ts` (chaves completas, sem texto vazio, mesmos parâmetros).
- **Quantidade por área:** Frota ~340 · caronas/chaves/privacidade ~177 · ocorrências/portaria/manutenção ~193 · administração/painel/viagens ~240.
- **Português preservado:** o texto de todas as telas em pt-BR foi comparado com a referência de antes (`i18n_base_ptBR.json` x `i18n_after_ptBR.json`): só mudam textos que passaram a sair juntos no mesmo trecho e o aviso de notificações. Nenhum texto em português mudou.
- **Em outros idiomas:** en-US de 699 para 281 trechos suspeitos e zh-CN 214; o que sobra é dado do banco (nomes, locais, descrições digitadas, motivos) e frases já em inglês/espanhol.
- **Pendências conhecidas:** mensagens de erro de chaves (`lib/operations/keyCustody.ts`) e e-mail de convite de usuário seguem só em português; datas e valores em reais do painel de energia/motoristas/manutenção seguem no formato brasileiro; nomes do catálogo de equipamentos e textos digitados vêm do banco.
- **Verificação:** tsc 0 · vitest 1124/1124 (113 arquivos) · lint 0 · `next build` ok; popup da Frota e fluxo de origem repetidos no navegador local.

## 6. Tela branca "Carregando informações da operação…" e lentidão nas transições (2026-10-23)
- **Medição em produção (organização fictícia):** transição por clique mediana ~2,9 s; resposta do servidor por página mediana ~1,9 s; 13 de 14 cliques mostraram a tela branca com mensagem.
- **Tela branca:** 5 arquivos `loading.tsx` (Frota, Administração, Painel/Central de Comando, Portaria, Manutenção) trocavam a página inteira por um aviso sem menu. Removidos; a página anterior fica na tela com a barra de progresso e o realce do clique que já existiam até a nova chegar.
- **Lentidão (causa medida pelos logs do Supabase):** o middleware rodava no ponto da Vercel mais próximo do usuário (São Paulo, `gru1`) e fazia 3 chamadas ao banco em sequência (usuário, conta ativa, perfil+CNH). O banco está em Oregon (`us-west-2`), então cada chamada cruzava o continente: ~1 s antes de a página começar. Correção: middleware no runtime Node (estável no Next 15.5), que roda na região das funções (`pdx1`), ao lado do banco.
- **Cache de navegação:** `experimental.staleTimes = { dynamic: 30, static: 180 }`: página visitada nos últimos 30 s reabre instantaneamente; qualquer gravação (ações, redirect) limpa o cache.
- **Limite físico:** com função e banco em Oregon, uma ida e volta São Paulo–Oregon já custa ~0,2 s; meta de 300 ms em toda navegação exige mover funcionalmente o banco/funções para perto dos usuários (decisão e custo à parte).
- **Frota, Documentos duplicado:** a aba "Documentos" e a ação rápida "Documentos" levavam ao mesmo lugar. A aba foi removida; as Ações rápidas passam a ter "Documentos" e "Configurar equipamentos" (antes escondido na aba).
- **Verificação local:** tsc 0 · vitest 1124/1124 · build ok (middleware Node) · login e Frota no navegador local.
