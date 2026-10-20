# Equipamentos por veículo/modelo e contrato da viagem — 0084

Estado: implementado e testado localmente; não homologado em ambiente real.

`/fleet/equipment?vehicle=UUID` publica composição própria do veículo ou herança do modelo. Gestor autorizado pode configurar veículo de sua carteira; somente administrador publica o padrão compartilhado do modelo. Cada item é não vinculado, obrigatório no conjunto ou disponível opcional. Publicações têm justificativa, versão, idempotência e auditoria. Nenhuma composição de estepe, kit de reparo, carregador ou extintor é inferida automaticamente.

O primeiro preparo do checklist pelo condutor grava contrato imutável da viagem com nomes, origem e versão. Mudanças posteriores na composição não reescrevem o checklist já preparado. A inspeção referencia esse contrato e o banco rejeita ausências de itens fora do conjunto. Segurança continua com conferência visual rápida e não declara equipamentos que não conferiu. Itens opcionais aparecem como informativos e não são convertidos em requisitos obrigatórios.

Novas retiradas sem configuração publicada são recusadas explicitamente. Na implantação, cadastrar e conferir a composição real dos veículos/modelos antes de liberar novas retiradas; não preencher o sistema com kits presumidos só para eliminar o bloqueio. Conjunto vazio pode ser publicado apenas como decisão administrativa explícita e justificada. Configurações e exemplos dos testes são fixtures e não correspondem à frota real.

Devoluções com retirada já registrada antes da migração têm caminho de observação legado, identificado como requisitos ainda não verificados, para não impedir o retorno de um veículo em uso. O catálogo nesse caminho é um roteiro de observações legado, não uma afirmação de equipamentos obrigatórios daquele veículo. Registro físico de chegada e custódia mantêm suas próprias regras.

Catálogo desativado permanece como referência dos conjuntos e contratos existentes; desativação não remove silenciosamente um requisito. Para alterar a exigência, publicar nova revisão explícita. Exclusão/renomeação de identidade histórica é impedida; criar item substituto quando necessário.

Testes cobrem herança, conjunto próprio, congelamento da versão, opcionais, declaração inválida, exigência de configuração, desativação do catálogo, identidade do condutor, concorrência por versão e caminho legado. Concorrência entre conexões e homologação de todos os modelos reais permanecem pendentes.
