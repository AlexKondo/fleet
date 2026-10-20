# Cadastro público — decisão aprovada em 16/10/2026

Novos usuários que se cadastram publicamente entram como Colaborador (`employee`). Outros papéis dependem da autorização de um administrador pelos controles existentes de equipe. A entrada pública não recebe papel ou organização do formulário.

Esta decisão substitui somente a concessão automática de administrador do ADR-009. Mantém a organização existente, seu isolamento, os usuários atuais e todos os seus papéis/históricos. Não há migração, reclassificação em massa nem exclusão de contas.

A criação de membros por um administrador continua aceitando o papel explicitamente autorizado nesse fluxo. Um cadastro público não promove uma conta já existente, mesmo ao repetir o e-mail ou acrescentar campos ao pedido.

Para uma instalação nova sem administrador, o responsável pela implantação deve provisionar explicitamente o administrador inicial no ambiente correto; não habilitar promoção automática pelo primeiro cadastro nem usar 0028/reset para recriar a base. A recuperação de provisionamento incompleto permanece administrativa, preservando a identidade.

Testes de regressão exercitam papel/organização forjados, e-mail já cadastrado sem alteração de papéis e falha de provisionamento sem exclusão da identidade.
