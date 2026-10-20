# FleetMind v3.0 — validação técnica consolidada

Sessão de 19/10/2026. **Resultado: verificações locais focais aprovadas; liberação integral da v3.0 não aprovada.** O código desenvolvido está consolidado no ZIP; funcionalidades ausentes, aceite das 28 telas e integração real continuam explicitamente pendentes. Este relatório substitui os checkpoints anteriores para o estado desta rodada.

## 1. Origem, evidências e aprovação

- Base de comparação: o último ZIP entregue, SHA-256 `8c827fbb5901783c7215bfff40cee9aba910d6fae6b4095c285f91f55afd383b`. Seus hashes estão em `BASELINE_ULTIMA_ENTREGA_SHA256.json`. Não é a HEAD atual do Kondo, que não foi disponibilizada nesta sessão.
- Os 923 testes da revisão histórica e os 66 testes/5 verificações do pacote anterior têm logs próprios. Não foram somados aos resultados desta rodada e não são apresentados como novas execuções.
- Não há relatório de execução do Claude/Kondo disponível como evidência nesta sessão. A busca por títulos de relatórios de execução/defeitos não recuperou um relatório preenchido; isso não prova que esses testes nunca foram feitos. Instrução de teste e planilha de status não equivalem a execução. Nenhum resultado deste relatório é atribuído ao Claude.
- Decisões preservadas: CNH para condução; checklists independentes; saída/chegada física separadas; custódia local por designação; escopo de gestão por unidade-base; aprovação de orçamento independente e configurável; preservação de identidades/evidências/históricos. A correção de middleware abaixo apenas efetiva as duas páginas que já declaravam `nonDrivingWorkspace`.
- Referências definitivas FM-001 (Central B), FM-002 (41/Rev04) e FM-004 (15/opção A/Rev02): hashes inalterados em relação à entrega anterior. As demais ligações de arquivo permanecem sujeitas à conferência, sem revogar as aprovações das telas.

## 2. O que foi efetivamente executado

**152 cenários automatizados distintos em 22 arquivos, todos com resultado final aprovado.** Contagem por par arquivo/caso, com expansão dos testes parametrizados. Não é a soma das rodadas repetidas. As falhas de CNH e resolução de permissões por tabela temporária foram reproduzidas e corrigidas; cada caso é contado apenas no resultado final. O índice com nomes e hashes dos testes está em `validacao-2026-10-19/indice-testes.json`.

| Grupo | Casos distintos | Resultado e limite |
|---|---:|---|
| Ciclo de ocorrências e exportação pessoal no banco descartável | 9 | Estados, histórico, idempotência, versão, isolamento, vínculo com OS pendente e bloqueio de exportação após desativação. Não libera veículo ao encerrar ocorrência. |
| Ajustes financeiros no banco descartável | 4 | Pendente não afeta custo; aprovado aplica crédito corretamente; originais preservados; autoaprovação/custo negativo negados; superior designado aprova sem receber gestão geral. |
| Escopos de gestão | 12 | Testes da fronteira existente e caso novo de ocorrências/dimensões por unidade; funções financeiras internas não executáveis pelo usuário. |
| Formulários/custos, filtros, ações e renderização de Caronas/Veículos | 23 | Inclui crédito negativo, data no fuso de SP, decisões próprias negadas, falhas de fonte e seleção sem ficha antiga. |
| Páginas operacionais e shell compartilhado | 23 | Regressão focal necessária pela alteração da fonte de custos, da fila de aprovação e das novas seções. Fixtures; não é navegação autenticada real. |
| Exportação CSV e rota pessoal | 8 | Cabeçalhos privados, sessão, resposta de falha, somente titular, distinção entre ajuste aprovado/pendente e defesa contra fórmulas CSV. |
| Middleware de acesso | 7 | Reproduz e verifica a correção de CNH; mantém autenticação, desativação e troca de senha; reserva continua bloqueada sem CNH. |
| Regressão SQL adicional no schema atual | 48 | Inspeções, custódia, política de orçamento, preservação, documentos e equipamentos; necessária após correção transversal de resolução de nomes (0090). |
| Fixture de base legada | 16 | Regressão isolada 0074–0076, sem afirmar que estes 16 casos usam a 0090. |
| Novos painéis de ocorrência/ajuste | 2 | Controles conforme estado, falha explícita e exibição de aprovação conforme capacidade recebida. A autorização definitiva continua no banco. |

A soma da tabela é 152; os testes de renderização não substituem autorização no servidor. Os testes de banco executam a cadeia real de **83 arquivos de migration ativos, até a versão 0090**, em PGlite descartável com schemas Auth/Storage simulados e sem a instalação de pgcrypto. Isso não comprova PostgREST, Auth/Storage HTTP ou concorrência entre conexões reais.

Verificações adicionais, fora da contagem: TypeScript, lint e build de produção aprovados, com códigos de saída 0. O build final inclui a correção de middleware. Não se repetiu a suíte integral de domínio porque o código desse pacote não foi modificado.

Inspeção de conteúdo novo em navegador: painel de ocorrências renderizado em 1536×844 e 390×844, sem rolagem horizontal da página. Medições em `paineis-inspecao.json`. Fixture sintética e conteúdo renderizado; não é aceite visual integral nem sessão Supabase autenticada. Screenshots ficaram apenas na inspeção interna.

## 3. Falhas, evidências, causas e correções

| ID / severidade | Evidência e causa provável | Correção / estado |
|---|---|---|
| VAL-001 — Alta | `supabase/migrations/0089_recurring_carpool_plans.sql` existia sem consumidor na interface, declaração RPC ou fluxo completo de reserva. Causa: desenvolvimento interrompido antes da integração. A presença do SQL podia ser confundida com funcionalidade pronta. | **Implantação do rascunho bloqueada:** arquivo preservado em `supabase/pending/`, fora da sequência ativa. Recorrência continua pendente; não foi eliminada uma funcionalidade já disponível. O rascunho não é homologado por testes das migrations ativas. |
| VAL-002 — Média | Fórmula anterior de `lineTotal`: `(+500)/1000` truncava o produto negativo em direção a zero; crédito de R$ 20,01 podia resultar em R$ 20,00. Contraprova e resultado corrigido em `forms.test.ts`. | **Correção incluída e validada:** arredondamento simétrico com inteiros. Ajuste aprovado de −20,01 sobre custo 100 resulta em 79,99 no snapshot; originais permanecem intactos. CSV mostra valor efetivo apenas para ajustes aprovados. |
| VAL-003 — Alta | Teste inicial esperava acesso gerencial e recebeu redirecionamento 307 para CNH: `reproducao-cnh-antes.log` (1 falha/3 aprovações). Causa: middleware ignorava o contrato `nonDrivingWorkspace` já declarado nas páginas `/fleet` e `/fleet/carpools`. | **Corrigida e validada:** exceção limitada a essas duas rotas e aos papéis gestor/administrador verificados. Reserva própria ainda exige CNH; empregado não ganha acesso; conta desativada e troca obrigatória de senha permanecem bloqueadas. Evidência final em `cnh-depois-e-regressao.log` e `vinculo-os-e-gestao-final.log`. |
| VAL-004 — Alta | Guia anterior afirmava “sem nova migration”, mas as mudanças locais passaram a depender de 0086–0088. Sem publicação coordenada, RPCs faltantes tornariam os novos painéis/filtros indisponíveis. | **Documentação corrigida:** preflight e publicação coordenada de 0086–0088 e 0090 são obrigatórios. 0089 não deve ser aplicada. O ledger real ainda não foi consultado; implantação permanece não verificada. |
| VAL-009 — Alta (segurança) | Em conexão SQL autenticada com permissão TEMP, uma tabela temporária `fm_manager_scopes` fez `fm_can_manage_vehicle` retornar `true` para veículo fora da unidade autorizada. Resultado esperado `false`; reprodução em `reproducao-search-path-corrigida.log`. Causa: `search_path=public` sem `pg_temp` explícito. Não foi demonstrada exploração por HTTP/PostgREST. | **Corrigida em 0090:** funções privilegiadas da aplicação resolvem catálogos/schemas confiáveis antes de tabelas temporárias; CREATE no schema público é negado a papéis de aplicação. Regressão SQL de 89 casos aprovada (73 no schema atual + 16 na fixture legada), sem repetir toda a aplicação. Caso final verifica escopo e negação de CREATE; `search-path-final.log`. A primeira tentativa (`reproducao-search-path-antes.log`) falhou no setup por usar LIKE numa tabela sem SELECT e não é prova do defeito. |
| VAL-005 — Alta | Ausência de comparação executada e completa das 28 telas com as referências. Existe fonte/rota, mas isso não prova comportamento, navegação ou fidelidade. | **Aberta:** executar comparação autenticada por tela e corrigir desvios no código, sem redesenhar. Não declarar as 28 telas concluídas. |
| VAL-006 — Alta | Lacunas conhecidas na matriz: múltiplos papéis gerais, governança granular de IA por unidade, recorrência integrada e compatibilidade gerencial detalhada. | **Aberta:** requer implementação pelo GPT. Atribuições restritas de chaves/aprovação não equivalem a múltiplos papéis completos. Não transferir ao Claude como “teste pendente”. |
| VAL-007 — Alta | Painéis sem fontes/métodos completos: indicadores históricos, utilização, impacto/emissões, mapa consolidado e rastreamento. Dados não foram inventados, mas o contrato funcional/visual não está fechado. | **Aberta:** implementar fontes e metodologia explicitamente versionadas e aprovadas, mantendo indisponibilidade enquanto ausentes. Configurar Maps não implementa GPS ao vivo. |
| VAL-008 — Média | OCR/voz específicos de portaria, extração automática de comprovantes, planejamento avançado e exportação pessoal com binários continuam incompletos. | **Aberta:** completar os respectivos fluxos e validações. A exportação JSON 0088 é estruturada e declara `binary_files_included=false`. |

Itens VAL-005–008 são lacunas verificadas por inspeção de implementação/matriz, não testes de ponta a ponta que falharam. Para cada correção futura, acrescentar evidência de execução; não remover a pendência apenas ao escrever código.

## 4. O que não foi testado e por quê

| Item | Situação / condição necessária |
|---|---|
| HEAD atual e relatório do Kondo | Não recebidos. Comparação com último ZIP não substitui merge com a versão oficial mais recente. Reaproveitar evidências do Kondo se forem da mesma versão/configuração. |
| Supabase real e histórico de migrations | Sem credenciais/ledger do ambiente. Não houve alteração real em banco, usuários, configurações ou e-mails. |
| PostgREST, RLS com JWTs reais, Storage HTTP | Scaffolds locais não substituem esses serviços. Conferir com contas/escopos reais de homologação. |
| Concorrência simultânea real | Versões/idempotência foram verificadas sequencialmente. Último assento, atualização concorrente e aprovação simultânea entre conexões reais permanecem não testadas nesta rodada. |
| SMTP, IA/Maps/voz/OCR reais | Não houve prova de entrega, inferência, captura de áudio ou resposta do provider real. Não inventar sucesso por mock. |
| Instalação limpa | Reaproveitado o ambiente de dependências existente; não se fez nova instalação do zero nesta rodada. Build bem-sucedido não comprova instalação limpa em outra máquina. |
| E2E e acessibilidade das 28 telas | Não executados integralmente. A inspeção de fixture de um painel não homologa o conjunto. |

## 5. Estado das 28 telas

`MATRIZ_28_TELAS.md` registra funcionalidades e lacunas por tela. `rotas-e-referencias.json` confere a existência dos arquivos das rotas das 28 telas e a integridade das três referências definitivas. **Nenhuma das 28 recebeu novo aceite visual integral nesta rodada.**

Não foram trocadas as referências aprovadas nem definidos novos layouts. Os textos históricos de checkpoints continuam disponíveis, mas não devem reabrir as decisões FM-001/FM-002/FM-004 nem transformar testes anteriores em homologação atual.

## 6. Entrega ao Kondo e retomada

1. Ler `00_LEIA_PRIMEIRO_KONDO.md` e este relatório. Criar branch de integração sobre a HEAD atual e usar o comparador somente leitura para evitar sobrescrita.
2. Conferir o ledger real com `PREFLIGHT_IMPLANTACAO.md`. Não usar o banco descartável como ledger real; não executar reset/0028/seeds destrutivos. Aplicar somente migrations ausentes e revisadas, em conjunto com o frontend correspondente. Manter `supabase/pending` fora da implantação.
3. Usar os logs e `indice-testes.json` para não recriar/repetir os 152 casos sem mudança ou falha que justifique. Testar os conflitos gerados pelo merge e os serviços reais ainda não cobertos.
4. Executar `ACEITE_INTEGRADO_KONDO.md`, incluindo último assento/versões com conexões reais e screenshots das 28 telas. Informar commit, ambiente, papel e unidade em cada evidência.
5. Devolver divergências reproduzíveis. Lacunas de implementação VAL-005–008 voltam ao GPT para correção; Claude/Kondo não devem redesenhar ou inventar regras.

Checkpoint completo em `RETOMADA_VALIDACAO_2026-10-19.md`. O ZIP contém toda a fonte desenvolvida, correções, migrations ativas, rascunho isolado, testes e evidências textuais. **O pacote é completo como entrega técnica do estado atual, não como declaração de produto completo ou homologado.**
