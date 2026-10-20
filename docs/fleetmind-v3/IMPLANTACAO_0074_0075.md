# Integração das novas jornadas

Não reaplicar indiscriminadamente o diretório de migrações sobre um ambiente existente. Primeiro conferir o histórico `supabase_migrations.schema_migrations`, comparar com os arquivos e revisar exclusivamente as pendências. O arquivo histórico 0028 executa `TRUNCATE organizations CASCADE` e remove usuários de autenticação; não representa autorização para apagar os dados atuais. Não alterar o arquivo histórico já aplicado nem marcá-lo como aplicado sem reconciliar o estado real do banco.

Executar primeiro o planejamento somente de leitura descrito em `PREFLIGHT_IMPLANTACAO.md`. Com o baseline até 0073 efetivamente confirmado, as novas migrações são 0074 e 0075, nessa ordem, inicialmente em homologação com backup. Não copiar apenas as novas tabelas: RPCs, grants, RLS, gatilhos, tipos e extensão de disponibilidade fazem parte da implementação.

0074 acrescenta VIN/data de revisão, OS e linhas de custo, lançamentos de energia, eventos físicos de portaria, ciências de relatos e recibos idempotentes. Uma janela de manutenção programada participa da disponibilidade e é validada por gatilho na gravação de reservas. Orçamento e itens previstos não são contabilizados como custo executado. Serviços em garantia não compõem custo efetivo GWM.

0075 acrescenta política do assistente e versões, solicitações de privacidade e tratamento administrativo. A política é consultada no chat antes de mensagens e confirmações. Desativar o assistente não altera o acesso às jornadas manuais. Em instalações anteriores à migração, somente erro de RPC inexistente mantém compatibilidade; falhas de rede/permissão não contornam uma política desativada.

Permissões são verificadas no backend; alterações financeiras e eventos físicos não aceitam UPDATE/DELETE direto de sessões autenticadas. Perfil do ator, organização e horário são obtidos da sessão/banco. Alterações concorrentes de OS/política exigem versão atual. Confirmações repetidas usam identificador de solicitação.

Rollback deve ocorrer com o código correspondente e na ordem 0075 → 0074. Scripts em migrations/rollback recusam remover dados registrados. Se já existem registros, é necessário plano de preservação/migração; não remover esses bloqueios apenas para executar rollback.

Testar em homologação: gestor aprova orçamento; técnico não aprova; programar contra reserva deve falhar e reservar contra manutenção deve falhar; início/conclusão reconcilia tarefa existente; custo acima do aprovado exige revisão; garantia e anulações preservam histórico; saída física exige reserva e ambos checklists; chegada real de veículo bloqueado permanece registrável; ciência não encerra relato; política desativada impede chat e confirmação pendente; titular só consulta suas solicitações, administrador responde com versão e justificativa.

Os testes PostgreSQL embarcados exercitam as duas novas migrações sobre um scaffold das dependências. Não substituem aplicação das 75 migrações e testes de RLS/Storage/PostgREST no Supabase real. Não foram utilizadas credenciais reais neste ambiente.
