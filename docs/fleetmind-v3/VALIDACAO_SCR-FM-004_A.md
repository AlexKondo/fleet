# SCR-FM-004 — implementação da opção A

Referência definitiva: imagem 15, confirmada em 19/10/2026. Rota de gestão: `/fleet/carpools`; rota de busca do colaborador preservada em `/carpool`.

## Verificação local

- 923 testes aprovados: 665 frontend, 252 domínio, 6 preflight. Os 12 novos testes cobrem filtro de data no fuso de São Paulo, abas, falha de fonte, acesso de colaborador, formulário próprio e fronteira de decisões.
- Tipos e lint aprovados. O build de produção é registrado no log correspondente.
- Composição renderizada com fixture sintética em 1536 e 390 px: sem rolagem horizontal, decisões legíveis. Essa inspeção cobre o conteúdo da página; o shell compartilhado tem suas próprias verificações, e a experiência autenticada ainda depende de homologação real.
- Leitura com cliente de sessão e views `fm_managed_*`, paginação de banco para não truncar em 1000 registros e organização explícita. Nenhuma leitura service-role para esta tela.
- Ações reutilizam os RPCs de aceitação/recusa existentes; não há mudança nas permissões ou no consentimento do motorista.

## Limites

A referência orienta a composição; a entrega não é pixel-perfect nem conclui o contrato completo. Filtros independentes por unidade/destino/horário, mapa, itinerário, recorrência e compatibilidade detalhada continuam pendentes. Economia e CO₂ não têm método validado e aparecem indisponíveis. Os indicadores disponíveis exibem totais no escopo, não variações ou estatísticas mensais fictícias. Nomes aparecem apenas quando autorizados pela view gerencial; contatos particulares e endereços de passageiros não são consultados.

Sem migração nova. Nenhum dado, usuário, configuração ou banco real foi alterado. A cadeia SQL existente segue coberta pela suíte embarcada, sem substituir Supabase/PostgREST/Auth/Storage reais.
