# Código pendente — não implantar

`0089_recurring_carpool_plans.sql` é um rascunho preservado da implementação em andamento. Não integra a sequência ativa de migrations. A interface, integração com reserva, publicação/consentimento e critérios de aceite ainda não foram concluídos. A numeração deve ser reconciliada com o histórico real antes de uma futura promoção.

A existência do SQL não comprova que a recorrência está disponível ao usuário. Não executar este diretório, não concatená-lo às migrations e não considerar testes das migrations ativas como testes desse rascunho.

Antes de promover qualquer função privilegiada futura, declarar caminho seguro com `pg_temp` explícito por último e conferir os grants; a proteção da 0090 não é aplicada automaticamente a funções criadas depois dela.

A validação técnica de 19/10 registra essa separação e as pendências em `docs/fleetmind-v3/RELATORIO_VALIDACAO_2026-10-19.md`.
