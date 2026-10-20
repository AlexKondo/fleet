# Preservação de contas — migração 0076

A ação de remover usuário passa a desativar seu acesso, com justificativa, versão e registro de auditoria. Reativação usa o mesmo controle e preserva identidade, papéis e todos os registros anteriores. A assinatura exportada `removeUser` permanece compatível, com nova semântica não destrutiva. O estado inicial dos membros existentes continua ativo; não há carga de demonstração ou exclusão de usuários.

Aplicar 0076 em homologação depois de conferir o histórico real, com 0074/0075 presentes. Essa migração deve estar disponível antes de publicar o novo código de autenticação: a indisponibilidade do controle de acesso bloqueia a sessão por segurança, inclusive quando a função ainda não existe. Não publicar esse código isoladamente contra banco anterior. Aplique o preflight somente de leitura; o bloco procedural de criação das políticas exige revisão explícita.

O bloqueio é aplicado no login, middleware, identificação alternativa da sessão, helpers comuns de organização/papel e políticas restritivas das tabelas públicas com RLS existente. A sessão/JWT anterior continua sendo uma identidade válida no provedor, mas não recupera o acesso da aplicação nem as leituras das tabelas protegidas. Triggers recusam DELETE e TRUNCATE de contas/perfis, inclusive via cliente de serviço. O próprio administrador não pode se desativar. Mudanças de papel e acesso usam um mutex da organização e contam apenas administradores ativos.

Os gatilhos são de preservação de identidades, não uma alegação de cobertura de todos os dados da plataforma. Outros fluxos de exclusão/retention ainda precisam ser reconciliados com a diretriz atual, incluindo veículos/catálogos, participação antiga em caronas e retenção do chat. Não considerar a plataforma inteira concluída com essa migração.

Falha ao provisionar um perfil não apaga a identidade recém-criada: ela é mantida bloqueada, com marcador de provisionamento pendente para recuperação administrativa. Não tentar cadastrar novamente nem apagar a conta como solução automática; conferir a falha e recuperar o vínculo correto no ambiente de homologação. Nenhum e-mail real foi disparado nesta implementação/teste.

O rollback recusa continuar se existe qualquer configuração/histórico de acesso, para não reativar contas desativadas nem perder auditoria. Sem esses registros, é necessário coordenar rollback de código e banco. O roteiro não autoriza reset, reaplicação de 0028 ou exclusão de identidade.

Testes embarcados verificam a migração SQL, idempotência, versões, organização, desativação/reativação, conta preservada, leitura própria bloqueada, proteção do último administrador ativo, DELETE/TRUNCATE recusados e rollback bloqueado com histórico. Não simulam o serviço GoTrue/Storage real nem concorrência entre conexões. Homologar sessões existentes e reativação no Supabase real antes de publicar.

Atualização aprovada pelo usuário: cadastro público passa a criar Colaborador, preservando os papéis dos usuários atuais. A decisão substitui a concessão automática de administrador do ADR-009; consulte `DECISAO_CADASTRO_COLABORADOR.md`.
