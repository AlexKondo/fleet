# Relatório de implementação e validação — 20/10/2026

## Resultado entregue
Fonte completa disponível, novas correções SQL/TypeScript e testes executáveis. O Pacote 01 não está homologado e sua integração final não está concluída: o checkout atual e as melhorias não commitadas do Kondo não foram disponibilizados. O pacote não presume igualdade com essa versão.

## Consolidação 01A–01J
| Pacote | Tratamento nesta fonte |
|---|---|
| 01A | Mapa bijetivo 0074–0088 → 0174–0188; originais de produção preservados por ausência de substituição. Ledger não reparado. |
| 01B/01C | Inventários e achados usados para escopo/RLS/ACL; não se repetiu o preflight de produção. |
| 01D | Allowlist explícita: 44 assinaturas presentes na fonte endurecidas em 0192; três funções exclusivas do Kondo ficam em EXTERNAL_FUNCTIONS_REQUIRED.json. Candidato original/rollback são referência pendente, não instrução de aplicação após a cadeia. |
| 01E/01F/01G | 95+16 transformações de search_path consolidadas nas 15 migrations candidatas. Hashes de origem e candidato conferidos antes das correções adicionais. |
| 01H | Dependências executadas na cadeia isolada. Referências runtime 0178→0179 resolvem após a cadeia. |
| 01I | Regressão de retirada/devolução, portaria, custódia, equipamentos, escopo e ciclo de vida. Sem inventar permissões gerenciais de liberação física. |
| 01J | Diagnóstico atualizado: upload já era sem overwrite; corrigidos journal, retry, falha de vínculo e aviso de cadastro parcialmente concluído. |

## Correções concretas
- Funções novas com `public, pg_temp`; allowlist de funções legadas, sem loop que altere plataforma/extensões. `rls_auto_enable` não é alvo. CREATE em public revogado de papéis de sessão como pré-condição idempotente.
- `fm_assert_can_drive`: conta/autorizações/número/validade em Brasília, usado na retirada, entrega de chaves e partida física. Devolução/recebimento de chaves não ganham esse bloqueio. Não escreve em CNH nem remove antifraude.
- Middleware/shell distinguem atividades administrativas e condução. Falha de leitura de CNH não libera condução. Conta desativada e troca inicial de senha continuam anteriores às exceções.
- `fm_photo_begin/finalize/pending`: intenção persistida antes do upload, hash e tamanho, acesso por titular/gestão autorizada, vínculo atômico e idempotente. Cliente valida assinatura/MIME/tamanho, nunca sobrescreve, confirma bytes quando o upload tem resultado ambíguo. Histórico antigo permanece intacto; não se inventaram hashes retroativos.
- `fm_availability_windows`: somente veículo, início, fim e tipo; detalhes internos da OS permanecem em superfícies autorizadas. `get_vehicle_busy_windows` volta a retornar apenas reservas. Planejamento usa a nova fonte e falha fechado se a consulta indisponível.
- Fan-out de notificações para gestor limitado só persiste mensagens com veículo/unidade autorizada ou reserva do próprio solicitante. Mensagens automáticas sem entidade identificável são suprimidas para esse perfil: os emissores devem informar entidade para entrega com escopo; isso está documentado como limitação de integração.
- Mutex organizacional das migrations candidatas usa NO KEY UPDATE, preservando serialização administrativa sem bloquear FK KEY SHARE. Cancelamento/troca/realoção e resolução de tarefa foram ajustados para veículo antes de reserva/tarefa, com releitura e detecção de troca concorrente. Isso é uma correção de ordem; não é prova de ausência de deadlock sob conexões reais.

## Efetivamente executado
| Verificação | Resultado e limite |
|---|---|
| Manifesto do ZIP recebido | 1024 entradas verificadas; zero divergências. |
| Regressão final Vitest | 114/114, 15 arquivos; JSON individual e log em evidence/. Inclui SQL real da fonte em PGlite. |
| Acesso à devolução | 1 caso novo aprovado no arquivo de limites de CNH (6 casos passaram na última execução; cinco já contados nos 114). Mantém devolução e complemento de evidência disponíveis sem liberar nova retirada. |
| Fixture legada isolada | 16/16 adicionais em database.test.ts; executados porque a renumeração também alterou a referência de rollback. Não são a cadeia completa. |
| Preflight Node | 6/6; contempla renumeração e bloqueio de SQL destrutivo/histórico incompleto. |
| Comparador Python existente | 5/5; regras de preservação/merge. O script novo package01_review.py também foi executado em cópia de referência, não no checkout atual do Kondo. |
| TypeScript | Exit 0; types de RPC incluídos no schema public. |
| Lint e build Next | Exit 0; sem erro de lint; build gerou rotas. Não é deploy nem smoke HTTP autenticado. |
| Preservação visual da fonte | 166 arquivos TSX/CSS/PNG byte a byte iguais à origem. Não é avaliação visual das 28 telas em runtime. |

Reexecuções justificadas: search_path e renumeração afetam a cadeia SQL; CNH afeta retirada/chaves/partida; ACL/journal afetam evidências; novas notificações e locks afetam escopo e operações. Não se executou a suíte histórica de 923 casos. Os 142 casos acima são distintos nas execuções finais, sem somar rodadas.

## Falhas observadas durante a execução
- Primeiro teste novo de manutenção usou coluna de fixture `title` inexistente; corrigido para `description`. Erro do teste, não defeito do produto.
- Teste de devolução legada e dois testes de preflight ainda referenciavam números antigos; atualizados. Cenários passaram após correção.
- Tipos novos inseridos inicialmente no namespace errado foram corrigidos; TypeScript final passou.
- Tentativas iniciais de execução foram bloqueadas por diretório/pnpm com symlink; comandos finais executaram diretamente os runners locais. Não foi necessária alteração de dependências ou lockfile.
- Logs intermediários preservados, sem tratá-los como resultados finais.

## Pendências que impedem homologação
1. Integrar os arquivos locais do Kondo: 13 conflitos relatados, CarpoolSearch, CNH/antifraude, robô, i18n e tipos. As funções exclusivas de CNH não existem nesta fonte; não foram substituídas por versões inventadas. Revisar o escopo de `list_member_license_sources` no código real.
2. Clone isolado do schema real e histórico reconstruído 0039–0075; confirmar hashes das migrations Kondo e nunca reaplicar limpezas 0033–0038. O ledger real de 19/10 é uma evidência histórica, não consulta atual.
3. SQL de produção não foi executado. PGlite usa uma só conexão, Auth e Storage de teste e não instala pgcrypto. Não prova JWT/PostgREST, Storage HTTP, extensões, ownership real, locks concorrentes ou compatibilidade de PostgreSQL 17/Supabase.
4. Executar concorrência real reserva×OS, cancelar×retirar/trocar/chaves, concluir tarefa×OS, últimos administradores, dupla retirada e idempotência em duas conexões. Medir RLS em volume.
5. Configurar e validar perfis de equipamentos por categoria/veículo e unidades/custodiantes antes da ativação. Não gerar perfis vazios automaticamente para contornar segurança. O fallback de retorno legado foi testado.
6. Testar upload/interrupção/retry/signed URL em Storage real, inclusive 409, hash divergente, autorização revogada e falha de vínculo. Recuperação começa por `fm_photo_pending`; não apagar órfãos/evidências.
7. Conferir 28 telas no ambiente integrado e serviços reais. Nenhum teste visual integral, GPS, OCR, IA ou provedor externo foi declarado aprovado nesta etapa.
8. Instalação limpa com o lockfile em ambiente de integração. Esta execução reutilizou dependências disponíveis; não certifica instalação do zero.

Status final: fonte candidata compilável e regressão local aprovada; integração e homologação pendentes. Produção intocada.
