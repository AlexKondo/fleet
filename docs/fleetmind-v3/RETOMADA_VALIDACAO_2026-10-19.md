# Retomada — estado salvo da validação técnica

Objetivo atual autorizado: concluir a validação com mínima duplicação, preservar decisões e código, registrar falhas e entregar um pacote executável ao Kondo. Não expandir funcionalidades enquanto houver correção crítica/integração sem conferir. Nenhuma operação real foi feita.

## Concluído e comprovado

- Inventário da evidência histórica separado da rodada atual. Sem relatório de execução do Claude/Kondo disponível nesta sessão; não atribuir testes a ele.
- 152 casos distintos em 22 arquivos com resultado final aprovado. Índice de nomes/hashes em `validacao-2026-10-19/indice-testes.json`. Não somar os 923 históricos nem reexecuções.
- 0086: ocorrência independente, histórico/versões e proteção por unidade, sem liberação automática do veículo; bloqueio de resolução com OS pendente verificado.
- 0087: créditos/débitos após encerramento, aprovação independente/configurável; superior restrito sem gestão geral; custo corrigido e originais preservados.
- 0088: dimensão real de unidade para gestão e exportação pessoal estruturada, isolada por titular e bloqueada após desativação. JSON sem binários.
- Rascunho 0089 preservado em `supabase/pending`, sem interface e fora da cadeia de implantação. Não promovê-lo automaticamente.
- Falha reproduzida e corrigida: middleware exigia CNH nas duas rotas explicitamente sem condução. Exceção precisa para gestores em `/fleet` e `/fleet/carpools`; condução, desativação e troca de senha continuam protegidas.
- Tipos, lint e build finais aprovados. Painel novo inspecionado em desktop/celular, sem rolagem horizontal. Todas as rotas mapeadas às 28 telas existem; referências definitivas inalteradas. Isso não é aceite das 28 telas.

## Pendências reais

1. Receber/conferir a HEAD e as evidências do Kondo para deduplicar a integração efetiva.
2. Ledger/Supabase/Auth/Storage/PostgREST/providers reais e concorrência entre conexões. Não foram testados nesta sessão.
3. Comparação visual/E2E das 28 telas; corrigir as divergências de código antes de aceite.
4. Implementação de recorrência integrada, múltiplos papéis gerais, IA granular, indicadores/metodologias, mapa consolidado/rastreamento, planejamento avançado e OCR/voz/extração específicos. Ver VAL-005–008 no relatório; não chamar essas lacunas de homologação.

## Próxima ação exata

Começar por `RELATORIO_VALIDACAO_2026-10-19.md`; conferir `ALTERACOES_PARA_INTEGRACAO.json` e `SOURCE_MANIFEST.json`. Se houver retorno do Kondo da mesma versão, reutilizar seus resultados antes de selecionar novos testes. Se não houver, trabalhar na próxima lacuna de implementação com escopo definido, mantendo as três referências definitivas. Não executar novamente toda a suíte só para retomar o contexto.

Alteração produtiva não é autorizada por um log local. Nunca executar reset, limpeza 0028, exclusão de usuários/evidências ou seeds destrutivos para ajustar ledger. Usar branch de integração, preservar as alterações atuais do Kondo e devolver conflitos de regra/design ao GPT/Ewerton.

## Achado crítico adicional fechado antes da entrega

VAL-009: tabela temporária com o nome da fonte de autorização permitia leitura fora de unidade numa conexão SQL autenticada. Reprodução corrigida da fixture retornou `true` quando deveria ser `false`. A migration **0090** fixa o caminho de resolução das funções privilegiadas da aplicação, explicita `pg_temp` por último e remove CREATE no schema público dos papéis de aplicação. 89 testes de banco na regressão justificada passaram; 16 usam fixture legada e 73 schema atual. Caso final e configuração de CREATE estão em `search-path-final.log`. Isso não prova exploração HTTP nem substitui Supabase real.

O total final é 152 casos distintos/22 arquivos. A sequência ativa contém 83 arquivos até 0090; **0089 continua isolada**, não aplicar. Antes de implantar, revisar a migration 0090 com a identidade proprietária das funções e validar Auth/Storage/providers no ambiente real.
