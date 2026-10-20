# Pendências de implementação — não confundir com homologação

Este pacote encerra a preparação da entrega de correção para integração. **Não encerra a implementação completa do FleetMind.** O código das funcionalidades abaixo ainda precisa de desenvolvimento ou fechamento pelo GPT; o Kondo não deve inventar a solução. O detalhamento por rota está em `MATRIZ_28_TELAS.md` e nos contratos das 28 telas.

| Frente | Situação e fechamento necessário |
|---|---|
| Fidelidade das 28 telas | FM-001 tem composição implementada e lacunas de fontes. FM-002 agora tem lista/detalhe e ações vinculadas à seleção; faltam os painéis históricos completos da arte. FM-004 tem composição A, filtros adicionais e mapa de rota conectado ao adapter; ainda faltam recorrência, compatibilidade gerencial detalhada. A dimensão e o filtro por unidade-base foram acrescentados em 0088. As demais telas precisam do confronto sistemático com referências e estados, não só prova de existência da rota. |
| Indicadores e sustentabilidade | Fechar fontes, períodos, metodologia, comparações históricas, ocupação/utilização, custo e emissões. Não converter indisponível em zero nem exibir os números da imagem. |
| Mapa e mobilidade | Consulta da rota da oferta foi conectada nesta revisão. Isso não implementa GPS ao vivo da frota, mapa consolidado do Command Center, itinerário com pontos privados de passageiros, recorrência nem sugestões avançadas. Permissões, consentimento e limites dos providers continuam obrigatórios. |
| Ocorrências | 0086 implementa ocorrência independente e seu ciclo auditado, com vínculo opcional à evidência original e OS. Foram validados estados, escopo, versão e proibição de resolver com OS pendente. Ainda falta conferir integralmente o contrato visual e a integração real. |
| Planejamento | Janelas e conflitos existem. Faltam previsão/capacidade avançada e recomendação de agenda. |
| Financeiro de manutenção | 0087 implementa correção após encerramento com segregação, política da unidade, revisão auditada e atualização do custo efetivo, sem reescrever itens originais. Testes locais aprovados; publicação/homologação real ainda pendentes. |
| Automação de documentos | Vínculos e arquivos privados existem. Extração automática de comprovantes e suas validações não estão implementadas integralmente. |
| Portaria | OCR/voz específicos do fluxo de portaria continuam pendentes; o assistente compartilhado não é substituto dessas funcionalidades. |
| Acesso e governança | Atribuições restritas de chaves/aprovação e escopos por unidade existem. 0088 implementa exportação pessoal estruturada em JSON. Múltiplos papéis gerais, exportação pessoal integral com binários e granularidade por unidade de toda a governança/custos de IA continuam pendentes. |

## Trabalho do ambiente do Kondo

O Kondo pode integrar o código disponível agora: comparar as versões, aplicar migrations realmente ausentes após preflight, configurar dados reais de unidades/equipamentos/políticas, conferir Auth/Storage/PostgREST/providers, executar os cenários integrados e produzir screenshots. Isso revela falhas e diferenças; não transforma as funcionalidades ausentes acima em implementadas.

As três referências definitivas e as regras já confirmadas não precisam de nova aprovação. Caso a execução revele uma divergência, devolver evidência para correção. Caso uma implementação futura exija uma decisão de produto que ainda não exista, apresentar a decisão concreta ao Ewerton.

A validação mais recente e o registro de falhas estão em `RELATORIO_VALIDACAO_2026-10-19.md`. O SQL de recorrência foi preservado em `supabase/pending`; não é funcionalidade entregue ao usuário nem migration autorizada para implantação.
