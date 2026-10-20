# Arquivamento e preservação de registros — 0085

Veículos, modelos e locais passam a ser arquivados/desativados e reativados por comando auditado, com justificativa, versão e idempotência. Não há exclusão física pela interface. `/fleet/archive` lista os registros no escopo do gestor e permite reativação com justificativa; links preservam histórico de reservas, documentos e exportação.

Arquivar veículo exige ausência de reserva pendente/confirmada, chaves em aberto e manutenção em execução/programada. O registro passa a bloqueado e sai das listas operacionais ativas; não pode receber nova reserva, novo lançamento de energia ou nova execução de OS. Documentos e consultas históricas continuam acessíveis no escopo autorizado.

Metadados de arquivamento não são alteráveis diretamente pela sessão autenticada. Reativação exige unidade/modelo/locais ativos e preserva bloqueios por avaria, documentação e equipamentos ausentes; não equivale à liberação de um bloqueio existente. Modelos/locais vinculados a veículo ativo não podem ser desativados. Referências históricas permanecem no banco.

Saída de participação legada em carona muda estado e registra passageiro/instante; não apaga a linha. As rotinas herdadas de limpeza definitiva de chat/coordenadas ficam pausadas até existir política específica de retenção aprovada. Conversas ativas antigas podem ser marcadas como abandonadas, preservando mensagens e conteúdo. A pausa não estabelece prazo de retenção nem substitui uma definição de privacidade; o produto não presume autorização para apagar dados a partir de limiar herdado.

Métricas organizacionais de chat e busca/provedor de caronas não são consultadas via service-role para gestores limitados por unidade. Os logs antigos não possuem atribuição confiável por unidade: apresentam indisponibilidade dessa consulta global, sem divulgar outras unidades nem produzir falsos zeros. Configurações globais ficam sob gestão central.

Testes cobrem preservação de históricos, proibição de exclusão e bypass de status, reservas ativas, reativação com bloqueio, referência ativa, autorização, versões, idempotência, cancelamento legado sem exclusão e ausência de chamadas de purga automática. Nenhum banco real foi alterado.
