# Custódia local de chaves e processo do escritório — 0078–0079

Implementação da decisão aprovada em 16/10/2026. Não equivale à homologação das 28 telas nem à conclusão da gestão de frota com escopos selecionados por unidade.

## Configuração executável

`/admin/units` permite ao administrador cadastrar unidades reais, escolher o processo de conferência visual ou custódia no escritório, vincular veículos e designar/desativar responsáveis locais. Não há unidades, pessoas ou concessões criadas a partir da imagem ou por inferência do nome do estacionamento. Unidade operacional e estacionamento do checklist são conceitos distintos.

A designação não altera `profiles.role`. Um Colaborador recebe apenas custódia nas unidades explicitamente autorizadas; um gestor local pode acumular essa atribuição mediante a mesma designação. Nem gestor nem administrador confirmam automaticamente chaves sem designação. O gestor central acompanha pendências e exceções em `/fleet/keys`; essa página não contém ação de confirmação física. A pessoa local designada usa `/account/keys`, também acessível sem CNH porque custódia não é condução. Isso não dispensa CNH nas viagens do próprio usuário.

As novas tabelas têm RLS e não concedem acesso direto a authenticated/anon. RPCs verificam sessão ativa, organização e atribuição atual. Alterações administrativas e confirmações usam justificativa quando aplicável, controle de versão, recibos idempotentes e auditoria. Confirmações preservam ator, papel real, unidade, reserva, veículo, horário do servidor e versão da atribuição. Revogar uma designação não apaga suas evidências. Alteração/exclusão/truncate dos eventos de chaves são recusados. O solicitante não confirma as chaves da própria reserva.

## Sequência do escritório

1. Responsável local confirma a entrega física das chaves ao condutor no escritório. Reserva, janela, habilitação, autorização, conta ativa, estado do veículo e chaves pendentes são verificados no banco.
2. Colaborador faz seu checklist no veículo, no estacionamento. O checklist inicia a viagem digitalmente; não cria saída física de portaria. Avaria/equipamento ausente mantém o veículo bloqueado para tratamento.
3. No retorno, colaborador registra checklist e local de estacionamento. Responsável local confirma o recebimento físico das chaves no escritório. Essas duas confirmações podem chegar em qualquer ordem; a reserva só é encerrada com ambas.

Recebimento das chaves sem checklist não libera o veículo. Checklist sem recebimento mantém a pendência de devolução. Avaria/bloqueio anterior não é removido pelo responsável das chaves. Tarefas são calculadas no servidor; dicas de evento/tarefas enviadas pelo cliente não controlam liberação. Não são criadas inspeções fictícias de Segurança nem eventos de portaria para SP. A IRA preserva suas funções anteriores por trás das assinaturas públicas existentes.

Chaves de reserva cancelada podem e devem ser recebidas sem converter a reserva em concluída nem liberar automaticamente o veículo. Exceções de custódia geram registro imutável, auditoria e notificação interna aos gestores/administradores ativos. Histórico recente mostra explicitamente os últimos 100 eventos no escopo. O histórico completo permanece no banco/auditoria. E-mail de tarefas de retorno continua best-effort, com tentativa única; falha SMTP não torna falsa uma confirmação já gravada.

## Preservação do processo por reserva

0079 vincula cada nova reserva ao processo/unidade/versão vigentes no momento de sua criação. Reservas anteriores conservam o contrato operacional anterior, sem backfill de chaves ou inspeções. Uma mudança posterior na unidade não reinterpreta o histórico concluído. Troca de veículo após evidência operacional é recusada; antes de evidência, o vínculo acompanha a troca autorizada existente. Unidade/processo e vínculo do veículo não podem ser trocados com reservas pendentes de aprovação, confirmadas ou chaves ainda não recebidas. Unidade desativada não aceita nova reserva.

## Publicação coordenada

Reconciliar o ledger real antes de qualquer implantação. Aplicar 0078 e 0079 após 0074–0077 e antes deste frontend; 0078 isolada recusa a operação de chaves enquanto faltar o contrato de 0079. Não reaplicar a limpeza histórica 0028, executar reset, criar portaria fictícia em SP ou remover gatilhos para contornar erro. Rollback automático recusa apagar histórico/restaurar permissões antigas; correção deve ser prospectiva.

Homologar com usuários e arquivos de teste no Supabase real: administrador configura as unidades/veículos corretos, usuário restrito designado, gestor remoto sem custódia, gestor local designado, condutor e Segurança IRA. Verificar concorrência entre conexões, Auth/Storage/PostgREST, fotos e notificações. Essas integrações reais não estão disponíveis neste ambiente. Nenhum banco, usuário, e-mail ou frota real foi modificado.

O papel principal permanece único no modelo legado. Esta entrega acrescenta a permissão específica de custódia por unidade, não implementa a seleção de escopos de gestão para todos os RPCs/RLS/Storage/APIs existentes. Gestores continuam com seu escopo organizacional anterior; a configuração de gestão local versus centralizada ainda precisa dessa integração completa. Não apresentar um filtro de unidade como controle de autorização.
