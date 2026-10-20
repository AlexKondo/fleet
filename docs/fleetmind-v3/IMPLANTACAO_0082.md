# Aprovação de manutenção configurável — 19/10/2026

Estado: código implementado e testado localmente. Não homologado em Supabase real.

## Política administrativa
Em `/admin/units`, cada unidade pode usar gestores com acesso à unidade ou uma lista de aprovadores regulares. Esses aprovadores precisam de autorização de gestão válida. Os superiores são designados explicitamente por unidade e podem receber somente aprovação de orçamento, sem mudança de seu papel principal. Configuração exige administrador, justificativa, versão e idempotência; alterações ficam na auditoria.

Sem política explícita, permanece como padrão a aprovação por gestor autorizado ao veículo. Orçamento lançado por gestor exige superior designado; se não houver, permanece pendente até configuração administrativa. Sem unidade-base, não é possível designar um superior para essa OS: cadastrar e vincular a unidade real, respeitando os bloqueios de movimentação existentes.

## Segregação e valores
O banco registra criadores e autores das revisões e linhas orçadas. A mesma identidade não pode aprovar seu lançamento, independentemente do papel usado depois. O papel evidenciado no lançamento é preservado. Autores históricos de revisões são recuperados a partir da auditoria existente; nenhuma aprovação histórica é fabricada.

Revisar o orçamento altera o solicitado e marca pendência; não eleva o limite aprovado. A aprovação independente aplica o novo limite, grava a identidade e o snapshot da política. Encerramento da OS com revisão pendente é bloqueado. Execução e garantia mantêm as regras anteriores de custo realizado e limite aprovado.

## Superfícies
- `/admin/units`: configuração administrativa por unidade.
- `/account/maintenance-approvals`: fila restrita de orçamentos elegíveis, com valor e confirmação humana. A aprovação não exige CNH, pois não é ato de condução.
- `/maintenance/work-orders`: revisão pendente, ação de aprovação e histórico de aprovações da OS.
- Auditoria administrativa: política e aprovações registradas.

A designação de superior não concede acesso direto às tabelas de manutenção, não permite alterar veículo, usuários, portaria ou chaves. Usuário desativado, designação revogada e organização diferente não herdam aprovação.

## Verificação
879 testes passaram: 621 frontend, 252 domínio e 6 preflight. A suite inclui SQL efetivo para gestor aprovando orçamento da manutenção, autoaprovação recusada (inclusive administrador), superior configurado, limite anterior preservado, idempotência, versão, autores de linhas, encerramento com pendência, seleção de aprovadores, revogação e capacidade restrita do superior.

TypeScript e build de produção, incluindo lint, passaram. As telas de configuração e aprovação foram inspecionadas em 1536×1024 e 390×844, com fixtures identificadas no teste, sem rolagem horizontal da página. Não é homologação visual das 28 artes nem teste integrado de Supabase, Auth, Storage ou PostgREST reais. Concorrência entre conexões reais continua pendente.

## Implantação
Migração aditiva, coordenada com frontend e 0080–0081. Conferir ledger real, backup e preflight antes de aplicar somente as migrações pendentes. Não executar reset, 0028 ou limpeza de usuários/dados. Nenhum ambiente real foi alterado. Reversão operacional deve preservar políticas, autoria e evidências de aprovação; não remover tabelas para voltar à regra de autoaprovação.

## Continuidade
Esta entrega conclui a política solicitada, não a plataforma inteira. Múltiplos papéis gerais, demais funcionalidades e homologação integral seguem na matriz. Não há decisão pendente sobre a política acima.
