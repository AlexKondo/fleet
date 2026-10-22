# Integração do Pacote Único 2026-10-22 — relatório final (Kondo)

**Veredito: NO-GO para produção.** Integração concluída e testada localmente; há 1 defeito P1, vários P2 de autorização/fotos/segurança de veículo e itens de decisão em aberto. Nada foi publicado, nenhuma migration foi aplicada em produção, nenhuma reserva real foi cancelada por este trabalho e nenhum deploy foi feito.

> **Atualização 22/10 (após as correções):** o P1 S3-03 e os P2 S2-D01, S2-D02, S1-02, S1-04, S1-05, S1-06, S3-01 e S3-02 foram **corrigidos na branch e verificados localmente** (seção 10). O veredito continua **NO-GO**: restam decisões, P3, homologação remota, rollback e autorização expressa.

## 1. Base, branch e commits
- Pacote: `FleetMind_v3_Pacote_Unico_Kondo_2026-10-22.zip` (1.139 entradas; extraído em pasta separada, nunca sobre o checkout). Base declarada: `0aa2403`.
- Branch: `integracao-conclusao-2026-10-22` (worktree `C:\projects\fleet-integ`).
- Commits: `0aa2403` (base publicada em produção) → **`5b5a9d0`** integra o delta do pacote → commit final desta entrega (relatórios).
- Integridade: os 1.087 hashes do `BASELINE_0aa2403.json` coincidem com o ZIP `FleetMind_codigo_fonte_0aa2403.zip` que entregamos ao GPT. (O manifesto `.txt` do pacote é herdado do Pacote 01; o válido é o `.json`.) A extração precisou de prefixo de caminho longo do Windows para 1 arquivo em `docs/` (pacote de UX de voz) — nenhum arquivo foi alterado.

## 2. Comparação e conflitos resolvidos
- `scripts/compare_conclusao_source.py` (somente leitura): 17 `candidate_change`, 19 `needs_merge`, 305 `keep_kondo`. Os 19 `needs_merge` eram **falso positivo de fim de linha** (o ZIP que entregamos foi gerado por `git archive` com CRLF; o repositório guarda LF). Normalizando fim de linha, o nosso HEAD `0aa2403` é idêntico à base do pacote ⇒ **o pacote é um delta limpo: 0 conflitos reais**, 23 arquivos alterados, 50 novos (inclui docs/evidências), 942 idênticos, 123 ignorados (`.agents/.claude/.king-fleet/.workbench`, patch e manifestos).
- Não houve "melhoria local posterior" ao `0aa2403`: o checkout de integração estava limpo e igual ao publicado. Preservado integralmente (nada foi sobrescrito).
- Migrations: `0210`–`0214` novas, **sem colisão** com a nossa última (`0209`); nenhuma migration já aplicada foi alterada (verificado por hash na comparação).
- Atenção: `changes.patch` não foi aplicado; o delta foi integrado por três vias, arquivo a arquivo.

## 3. O que foi executado × inspecionado × histórico × não testado
**EXECUTADO por mim nesta rodada (evidências no ZIP):**
| Verificação | Resultado |
|---|---|
| TypeScript (web) | exit 0 |
| Vitest `apps/web` (suíte completa; repetição justificada: 30 s, única validação do delta contra os 964 testes locais anteriores que o pacote não rodou) | **976/976** (96 arquivos) |
| Vitest `packages/domain` | **271/271** (20 arquivos; inclui 14 de resolução de localidades) |
| Preflight de migrations / comparador (Node/Python) | 6/6 · 5/5 |
| Lint / `next build` | 0 erros, 0 avisos · compila, 48 páginas |
| Cadeia de migrations em Postgres real (Supabase local) | 0001→0213 do zero sem erro; 0214 aplicada só no banco local depois |
| **S1** (SQL/HTTP real, usuários reais locais) | 621 casos SQL + 292 HTTP (permissões `vehicles` 0210) · CNH · liberação de vencidas (2 camadas, fronteiras 0/60/1440, 4×30 execuções concorrentes sem deadlock) · saída impedida 24/24 · SP/Campinas/avaria/OS — `RELATORIO_S1.md` |
| **S2** (Storage/Auth reais locais) | fotos: 18/20 + UI 3/4 antes da 0214; após aplicar a 0214 localmente: 17/19, sendo as 2 falhas os testes que afirmam "cliente antigo funciona" (falham por desenho depois da 0214) — `RELATORIO_S2.md` |
| **S3** (navegador) | 468 navegações papel×rota, 86 capturas, 0 erros 5xx/console, 0 overflow horizontal; fluxos T1–T5; 754 testes focados — `RELATORIO_S3.md` |
**INSPEÇÃO ESTÁTICA:** leitura das migrations 0210–0214, actions de foto, middleware e telas afetadas pelos agentes.
**RESULTADO HISTÓRICO (só referência, não somado):** 415 testes do pacote (docs/conclusao/evidence); nosso E2E anterior em produção (~185 verificações) e 964 testes do 0aa2403.
**NÃO TESTADO:** Supabase remoto/pooler/Realtime; limites da Vercel (memória, tempo, corpo de 4,5 MB); queda de rede real; chamadas reais à IA, voz, OCR e Google (chaves inexistentes localmente); aceite de carona pelo anfitrião e mapas; checklist de retirada completo pela UI (o seed não tem equipamentos configurados); homologação visual autenticada fiel das 28 telas; concorrência em duas conexões remotas.

## 4. O que cada correção do pacote mostrou
| Frente | Resultado |
|---|---|
| Reservas vencidas (FM-01) | Dois interruptores (servidor `FM_ENABLE_AUTO_RESERVATION_RELEASE` + `organization_settings.auto_release_enabled`, padrão false) funcionam; desligado ⇒ 0 liberações; atividade/chaves/saída bloqueiam; veículo inseguro não volta a available (**com a exceção S1-02**). **Divergência de decisão:** o dono quer a regra SEMPRE ATIVA em produção; o pacote a entrega desligada. Ao publicar, ligar flag e organização de propósito. |
| Carona por pontos corporativos (FM-02) | 14/14 domínio e testes de ação; busca do anfitrião fecha em falha; **S3-02**: a busca do passageiro NÃO fecha quando os pontos não podem ser lidos. Google real não testado. |
| Saída impedida (FM-03) | RPC 24/24 e tela: erro→retry mesmo `request_id`→sucesso, auditoria, sem saída/chegada/devolução fictícia. Defeitos de tela S3-04…07; **S3-06** decisão (custódia). |
| Permissões de `vehicles`/avarias (FM-04) | 621+292 casos 0 falhas; **foto da Frota continua funcionando** (passa por begin→upload→atestação→finalize→link, não pelo UPDATE bloqueado). Pendência de decisão S1-01. |
| Fotos (FM-05) | Adulteração de mesmo tamanho rejeitada antes da atestação; original imutável; recuperação via `fm_photo_pending`. Defeitos S2-D01/D02. 0214 testada: depois dela o código antigo (0aa2403, hoje em produção) falha ao finalizar fotos. |
| Hidratação / interface (FM-06/07) | sem erros de hidratação nas capturas; troca de idioma e `lang` ok (não testado interativamente em todos os idiomas). |
| Assistente | sem chave de IA: resposta amigável em linguagem simples nos 4 idiomas; camada de despacho/apresentação por testes; **IA, voz e OCR NÃO testados**. |

## 5. Falhas encontradas (ID · severidade · reprodução · causa provável · correção)
Detalhe completo, com SQL/passos, nos `RELATORIO_S1/S2/S3.md`. Resumo:
| ID | Sev. | Resumo | Causa provável | Correção proposta |
|---|---|---|---|---|
| **S3-03** | **P1** | Administrador sem CNH e gestor com CNH vencida são redirecionados a `/account/license` ao abrir `/admin/*`, `/analytics`, `/dashboard`, `/gate` | `administrativePath` em `lib/supabase/middleware.ts` cobre só `/fleet`, `/settings`, `/maintenance` | incluir as rotas administrativas na isenção do portão de CNH (regra já aprovada: acesso administrativo independe de dirigir) |
| S2-D01 | P2 | Usuário logado insere direto em `inspection_photos` sem jornal/atestação (mesmo com 0214) | permissão de INSERT herdada da 0177 | `REVOKE INSERT` para authenticated (prova em transação revertida: fecha e o código novo continua OK) |
| S2-D02 | P2 | Foto válida de 8,6 MB ⇒ 500/página quebra | limite da server action 8 MB × limite do bucket/app 10 MB (Vercel: 4,5 MB do corpo, não testado) | alinhar limites e validar no cliente antes do envio |
| S1-02 | P2 | liberação automática deixa veículo inseguro `reserved` sem reserva ativa | regra de "seguro" duplicada por rotina | checagem única compartilhada de segurança do veículo |
| S1-04 | P2 | cancelamento normal devolve `available` veículo com doc irregular/avaria | idem | idem |
| S1-05 | P2 | em custódia (Campinas/Rio) entrega a chave e inicia viagem de veículo com doc irregular | idem | idem |
| S1-06 | P2 | concluir tarefa de manutenção libera veículo com doc irregular e limpa avaria sem a regra de independência da 0205 | idem | idem |
| S3-01 | P2 | anfitrião não vê passageiros confirmados | embed `passenger:profiles` ambíguo (2 FKs após a 0185; erro engolido) — anterior ao pacote | desambiguar o embed (`profiles!passenger_id`) e tratar o erro |
| S3-02 | P2 | busca do passageiro não fecha com segurança se os pontos não puderem ser lidos | `searchActions.ts` cai no geocoder | fechar em erro, como o anfitrião |
| S3-06 | P2 (decisão) | em unidade de custódia o formulário de saída impedida só aparece onde a RPC sempre nega | condição de exibição × `VEHICLE_ON_TRIP` | decisão do produto sobre o encerramento em custódia |
| S1-03, S1-07, S1-08, S2-D03…D06, S3-04/05/07/10/11 | P3 | gestor aprova pedido vencido; passageiro/motorista leem notas internas e inserem tarefas direto; uploads simultâneos mostram falha falsa; foto antiga não volta; pendentes sem tela; atestação sem metadados; exibição do formulário para Segurança; sem aviso de sucesso; checkbox desmarca; rótulos de auditoria crus; arquivados em /analytics | ver relatórios | ver relatórios |
| S1-01, S3-08, S3-09, S3-12 | Decisão | gestor altera hodômetro/combustível/bateria direto sem auditoria (necessário ao formulário da Frota); "Cancelada" sem rótulo distinto para exceção; colaborador com CNH inválida bloqueado em todas as telas (o texto diz "só na condução"); aba "como motorista" em /carpool/mine | ver relatórios | decisão do dono/GPT |

## 6. 0214 — sequência EXPAND / código / CONTRACT
Ordem obrigatória: **0210, 0211, 0212, 0213 (expand)** → publicar o **código novo** (upload/atestação) → confirmar **um upload real** atestado → só então **0214**. **Não aplicar a 0214 enquanto houver instância escritora com o código antigo**: o cadastro de veículo com foto (edição da Frota) e os checklists falhariam por inteiro. Nesta rodada a 0214 foi aplicada **só no banco local descartável**, depois do código novo.
Regra/risco adicional: o código novo exige `SUPABASE_SERVICE_ROLE_KEY` no servidor (atestação); nunca ir ao navegador.

## 7. Critérios objetivos de GO / NO-GO
**NO-GO atual (impede a publicação):**
1. P1 aberto: S3-03 (bloqueio administrativo por CNH).
2. P2 de autorização/fotos aberto: S2-D01 (INSERT direto em `inspection_photos`), S2-D02 (500 em foto 8,6 MB) e os P2 de segurança de veículo S1-02/04/05/06; P2 funcionais S3-01/02 (isolamento/busca) — o próprio pacote lista falha de autorização/fotos como NO-GO.
3. Ausência de homologação em ambiente remoto (Auth/Storage/pooler/Vercel) e de teste logado das 28 telas em produção-like.
4. Rollback não ensaiado; ledger de migrations ainda por reconciliar (produção tem 0174–0209 aplicadas por SQL direto, sem registro; 0208 verificar).
5. Decisões em aberto: ativar a liberação automática (dono = sempre ativa) e a tolerância 60 min; S1-01 (hodômetro); S3-09 (CNH × telas do colaborador); S3-06; política do pacote × decisões do dono.
6. Serviços externos não validados (IA, voz, OCR, Google, e-mail) e plano Vercel Hobby × uso corporativo (migrar para Pro antes de operar).
7. Falta autorização expressa do responsável para deploy.
**GO FUTURO (todos):** casos críticos aprovados no commit integrado com zero falha alta/crítica; os P1/P2 acima corrigidos e reexecutados; migrations revisadas e ledger reconciliado; rollback ensaiado; decisões registradas; serviços externos validados em ambiente isolado; sequência EXPAND→código→prova→CONTRACT cumprida; autorização expressa.
**GO atual:** apenas para revisão e integração local deste código.

## 8. Telas e funcionalidades aprovadas (28)
- Nenhuma tela, cor, fluxo ou regra foi alterada por iniciativa própria; as correções vieram integralmente do pacote.
- Referências visuais: definitivas apenas **SCR-FM-001, SCR-FM-002 (Rev04), SCR-FM-004 (Rev02)** — layout confere, faltam painéis/dados (mapa, gráficos, valores) que dependem de fontes inexistentes; **não se declara fidelidade**. As outras 25 só têm imagens PROPOSTAS ⇒ pendência de aprovação visual (aprovação **funcional** ≠ visual). Detalhe por tela em `RELATORIO_S3.md`.

## 9. Pendências restantes (resumo)
Corrigir S3-03 e os P2; decidir S1-01, S3-06/08/09/12, política de liberação (sempre ativa) e tolerância; homologar remotamente; ensaiar rollback; reconciliar ledger; validar IA/voz/OCR/Google/e-mail; migrar Vercel para Pro; backup automático do Supabase; autorização expressa para deploy.

## 10. Correções aplicadas depois dos testes (22/10) — local, não publicadas
Relatórios detalhados: `docs/integracao_2026-10-22/correcoes/F1_RELATORIO.md` (SQL) e `F2_RELATORIO.md` (aplicação).
| ID | Estado | Correção |
|---|---|---|
| **S3-03 (P1)** | corrigido (local) | portão de CNH do middleware libera as telas administrativas para administrador, gestor e operador de manutenção; condução (`/trips*`, `/carpool*`, retirada) continua barrada; colaborador, conta desativada e troca de senha inicial inalterados; rotas administrativas barradas por CNH: 12 → 0 (navegador, antes/depois) |
| S2-D01 (P2) | corrigido (local) | migration **0216** (CONTRACT): sem INSERT direto em `inspection_photos`; nenhum código do app (novo ou 0aa2403) insere direto |
| S1-02/04/05/06 (P2) | corrigidos (local) | migration **0215** (EXPAND): checagem única de "veículo seguro para voltar ao uso" usada por liberação automática, cancelamento, entrega de chave, retirada de escritório e conclusão de tarefa; avaria só sai pelo comando auditado da 0205; 7 funções recriadas com diff mínimo; rollbacks ensaiados |
| S3-01 (P2) | corrigido (local) | embed desambiguado; erro de leitura mostra "não conseguimos carregar" |
| S3-02 (P2) | corrigido (local) | busca do passageiro fecha com segurança quando os pontos não podem ser lidos |
| S2-D02 (P2) | corrigido (local) | limite de foto do veículo 4 MB validado no navegador e no servidor, mensagem clara (3 MB salva; 8,6 MB não é mais enviado) |
| S3-04/05/07/10/11 (P3) | corrigidos (local) | formulário de saída impedida só onde a RPC aceita; aviso de sucesso; checkbox mantém marcado; rótulos de auditoria; arquivados fora de /analytics |
**Verificação final desta etapa (executada):** `tsc` 0 · web **1015/1015** (101 arquivos) · lint 0 · build ok · cadeia 0001→0216 do zero em Postgres local · concorrência (180 + 120 execuções) sem deadlock · S1 (permissões 0210, saída impedida, SP/Campinas) sem regressão · S2 17/19 (2 por desenho pós-0214) · cadastro de foto pela Frota funciona para 3 papéis.
**Ordem de aplicação em produção (quando autorizado):** 0210–0213 → publicar o código novo → confirmar upload real atestado → **0214** e **0216** (CONTRACT) só depois que nenhuma instância antiga escreve; **0215** (EXPAND) pode ir junto com as anteriores.
**Riscos que ficam (novos):** (a) limite de 4,5 MB do corpo na Vercel não testável localmente; (b) checklists de retirada/devolução enviam várias fotos numa só action e podem passar dos limites — exige decisão de desenho (envio por foto, compressão ou upload direto ao Storage); (c) upload da CNH (5 MB) também passa de 4,5 MB; (d) veículo pode ficar em `maintenance` sem tarefa aberta (reparo/OS cancelados ou avaria antiga sem tarefa) e só sai com nova OS/tarefa; (e) a retirada mostra `DEPARTURE_BLOCKED` cru e a conclusão de tarefa não traduz `DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED` (texto a tratar).
**Ainda abertos:** S1-01, S3-06, S3-08, S3-09, S3-12 (decisões); S1-03, S1-07, S1-08, S2-D03…D06 (P3); homologação remota; rollback ensaiado; ledger; serviços externos; Vercel Pro; autorização expressa.
