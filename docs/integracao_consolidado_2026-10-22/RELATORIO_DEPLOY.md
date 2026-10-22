# Relatório do deploy — pacote consolidado do GPT (2026-10-22)

Autorização: pedido expresso do responsável ("resolva tudo e faça o deploy agora"). Sequência aplicada: backup → **EXPAND** → **código** → **prova de upload real** → **CONTRACT** → validação. O pacote e o GPT dizem NO-GO; o responsável decidiu publicar. Este relatório registra exatamente o que foi feito e o que ficou em aberto.

## 1. O que foi publicado
- **Código:** commit **`a05b8f1`** na `main` (GitHub) ← branch `integracao-consolidado-2026-10-22` (delta do pacote consolidado sobre `c6b26da`, **0 conflitos**, + migration 0228). Deploy Vercel READY às 16:08 (BRT). Anterior em produção: `0aa2403`.
- **Banco (Supabase, produção):** 19 migrations aplicadas via API (uma por chamada, atômicas, LF-normalizadas), nesta ordem:
  - EXPAND (2026-10-22 19:05Z): 0210, 0211, 0212, 0213, 0215, 0217, 0218, 0219, 0220, 0221, 0222, 0225, 0228.
  - CONTRACT (19:10Z): 0214, 0216, 0223, 0224, 0226, 0227.
  - Log: `C:\projects\fleet\_local\backups_e_analises\APLICACAO_PRODUCAO_2026-10-22_expand.log` e `..._contract.log`. O ledger `schema_migrations` NÃO foi alterado (continua sem registro; a reconciliação foi feita por leitura, §3).
- **Liberação automática de vencidas: ATIVA** (0217 restaurou o estado aprovado; `auto_release_enabled=true` na organização original; 0 organizações com a liberação desligada; a variável `FM_ENABLE_AUTO_RESERVATION_RELEASE` não existe na Vercel ⇒ ativo).

## 2. Antes do deploy (executado)
- **Backup novo (somente leitura):** dados das 58 tabelas públicas + usuários + metadados do Storage + esquema em `C:\projects\fleet\_local\backups_e_analises\backup_prod_2026-10-22_pre_deploy`, e os **88 arquivos do Storage** (9,28 MB, 88/88 verificados) em `storage_backup_2026-10-22_pre_deploy`. Há também o backup de 21/10.
- **Verificações locais do código integrado (executadas):** `tsc` 0 · web **1073/1073** (109 arquivos) · lint 0 · `next build` ok · preflight/configuração 10/10 · cadeia de migrations **0001→0227 do zero** em Postgres local (+0228 depois).
- **Testes integrados locais (agentes T1/T2):** T1 (SQL/permissões/vencidas/tarefas/medições/CNH): sem P0/P1; T2 (fotos): 47 de 54 cenários PASS (3 FAIL = defeitos abaixo, 4 observações) + 38 testes unitários de foto. Relatórios: `T1\RELATORIO.md`, `T2\RELATORIO.md` nesta pasta. **T3 (CNH em PDF/celular e 28 telas) ainda NÃO terminou** — seus resultados não foram considerados no deploy.

## 3. Reconciliação do esquema por leitura
Comparação do esquema de produção (impressão digital das 173 funções, 8 colunas, policies e tabelas, normalizando CR) com a build local da cadeia completa: **antes do rollout**, as únicas diferenças eram as das migrations 0210–0228 (15 funções com definição nova, 9 funções novas, 8 colunas, 2 policies, 1 tabela), sem nenhuma divergência não explicada; **depois do rollout: 0 diferenças** (única função só em produção: `rls_auto_enable`, da plataforma).

## 4. Provas e validação em produção (somente organização fictícia)
- **Upload real com atestação (pré-requisito do CONTRACT):** admin da org fictícia editou o veículo HML8A08 no site publicado: foto salva; `fm_photo_uploads` `linked`, **atestada** (`server_verified_at`), auditoria `photo.linked`=1; o navegador enviou os bytes direto ao Storage e o `/api/photos` só recebeu metadados.
- **Repetido DEPOIS do CONTRACT** (veículo HML6A06): mesmo resultado (linked + atestada + auditoria).
- **Varredura de telas por papel (7 papéis, 46 navegações):** todas HTTP 200, 0 erros 5xx/pageerror. CNH: colaborador com CNH vencida ou sem validade abre `/dashboard`, `/trips`, `/carpool`, `/carpool/mine` (passageiro) e é redirecionado a `/account/license` apenas em `/trips/new` (reservar veículo para conduzir) — conforme a regra "CNH irregular bloqueia condução, preservando atividades administrativas e acesso como passageiro". Administrador/gestor acessam `/admin`, `/analytics`, `/dashboard`, `/gate`, `/settings` normalmente.
- **Logs do Supabase desde 19:00Z (início do rollout):** 0 erros (Postgres/PostgREST/Storage/Edge), 0 respostas 5xx.
- **Dados reais:** nenhuma reserva, usuário ou foto da organização original foi alterada por este rollout (as escritas de teste ficaram na organização fictícia `HOMOLOG-TESTE`).

## 5. Falhas abertas e decisões (não bloqueiam o que foi publicado, mas precisam de tratamento)
| ID | Sev. | Descrição | Estado |
|---|---|---|---|
| T1-D01 | P2 | solicitante via o motivo interno da exceção "veículo não saiu" (reserva e notificação) | **corrigido e publicado** (0228 + teste que falha sem a migration) |
| **T2-D01** | **P2** | na portaria, se o upload da foto de avaria falha, o operador não é avisado: cai na página de evidência e a checagem de avaria fica salva sem foto (`submitVisualCheck` atualiza a página antes de o navegador enviar a foto) | **aberto** — corrigir no código |
| T2-D02 | P3 | foto HEIC no formulário do veículo mostra "foto pendente" sem pendência real | aberto |
| T2-D03 | P3 | outro gestor com escopo pode enviar para o caminho pendente de terceiros (a regra de upload do Storage não está amarrada ao registro) — nada é vinculado sem verificação | aberto |
| T2-D05/06/07 | P3 | códigos de erro sem distinguir causas; sessão ausente redireciona em vez de 401; mensagem de falha do checklist não diz que o checklist foi salvo | abertos |
| T1-D02 | P3/decisão | A→B→A só funciona para quem enviou a foto original | decisão |
| D-1, D-2 | Decisão | fotos de checklist/portaria limitadas a 5 MB (resto 10 MB); quem pode ver/receber link das fotos de evidência | decisão do dono/GPT |
| — | Risco | limite de 4,5 MB do corpo na Vercel (upload da CNH de até 5 MB), HEIC, OCR/IA reais, celulares reais e Supabase com pooler/Realtime: não testados | aberto |
| — | Operação | Vercel Hobby (uso não comercial) e Supabase sem backup automático/PITR | a resolver antes da operação |

## 6. Rollback / recuperação
Não executar os rollbacks históricos que reabrem escrita ampla. Preferir correção adiante. O backup de 22/10 (dados + Storage + esquema) permite restaurar tabelas isoladas; restauração completa não foi ensaiada. Voltar o app antigo agora quebraria escritas (contratos ativos); nesse caso, bloquear uploads e corrigir adiante.

## 7. Segunda publicação: correções F3 (commit `ee56fa5`, somente código, sem migrations)
Publicada em seguida (Vercel READY 16:46 BRT), a pedido do responsável ("arrume logo e faça o deploy").
| ID | Sev. | Correção | Estado |
|---|---|---|---|
| T2-D01 | P2 | Portaria: a tela só atualiza depois de a foto de avaria ser enviada; se falhar, mostra aviso claro e botão de tentar de novo, sem perder a checagem preenchida | **corrigido e publicado** |
| D-T3-01 | P2 | Edição de veículo: depois de erro do servidor, a categoria escolhida e os campos digitados são mantidos | **corrigido e publicado** |
| D-T3-02 | P2 | CNH: redução progressiva da imagem (qualidade, depois 4000→3200→2400 px, nunca abaixo de 2400); se ainda não couber, mensagem com o que fazer; o original não se perde | **corrigido e publicado** |
| T2-D02, T2-D07 | P3 | HEIC com mensagem correta; falha de foto no checklist diz que o checklist foi salvo e leva às fotos pendentes | **corrigidos e publicados** |

Verificação local antes do push: tsc 0 · vitest **1086/1086** (110 arquivos) · lint 0 · build ok. Detalhe: `F3\RELATORIO.md`.

**Validação em produção após `ee56fa5` (organização fictícia):** upload real de foto no veículo HML5A05: foto salva, jornal `linked` e **atestada**, auditoria `photo.linked`=1; varredura por papel: 42 navegações, 0 erros 5xx/pageerror, único redirecionamento esperado (CNH vencida em `/trips/new` → `/account/license`); logs do Supabase desde 19:00Z: 0 erros.

## 8. Abertos após a segunda publicação
- **D-T3-03 (P3):** PDF de várias páginas vira uma imagem alta; risco com IA real, só registrado.
- **P3:** T2-D03, T2-D05, T2-D06 (não tratados).
- **Decisões do dono:** reserva para conduzir sem CNH só é barrada na tela `/trips/new`; Segurança sem CNH em `/trips/new`; D-1 (limite de 5 MB nas fotos de checklist), D-2 (quem vê links de evidência), T1-D02 (A→B→A só para quem enviou a foto original).
- **Riscos não testados:** limite de 4,5 MB do corpo na Vercel × CNH de 5 MB, IA/OCR reais, celulares reais, pooler/Realtime do Supabase.
- **Operação:** migrar a Vercel Hobby para Pro antes da operação real; Supabase sem backup automático/PITR; ledger `schema_migrations` ainda sem registro.
