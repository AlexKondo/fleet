# FleetMind v3.0 — pacote único para o Kondo

**Código executável corrigido, sobre a base ZIP 0aa2403. Não homologado; não publicar automaticamente.**

Esta orientação de 22/10/2026 substitui a leitura operacional dos relatórios históricos incluídos na base. Nenhum arquivo antigo foi usado para sobrescrever silenciosamente a implementação atual. O checkout do Kondo pode conter alterações posteriores: não substituir a pasta inteira.

- Correções concretas: vencidas desligadas por política, busca de caronas por pontos corporativos, regularização de saída impedida, bloqueio de alteração direta de avarias, verificação real de fotos e correção de hidratação.
- Cinco migrations novas 0210–0214; as existentes foram preservadas. Ordem EXPAND/código/CONTRACT obrigatória para fotos.
- 415 testes automatizados distintos passaram; TypeScript, lint e build passaram. Dois componentes foram exercitados em navegador offline, desktop/mobile. Não houve teste autenticado das 28 telas nem chamadas reais à IA.
- Nenhuma alteração remota, limpeza, deploy ou migration em produção.

Começar por `docs/conclusao/INTEGRACAO_KONDO.md`, `RELATORIO_TECNICO.md`, `TESTES.md` e `MATRIZ_28_TELAS.md`. `changes.patch` é para revisão do delta, não para aplicação cega. `scripts/compare_conclusao_source.py` produz comparação de três vias somente leitura. `MANIFEST_SHA256.json` permite conferir todos os bytes do pacote (exceto o próprio manifesto).

**GO:** revisão e integração local. **NO-GO:** produção até homologação integrada, conferência de permissões/esquema/Storage, aceite das telas, decisões de política e autorização expressa.

Se for interrompido: retomar a partir dos resultados finais em docs/conclusao/evidence, sem repetir a suíte histórica. Nenhuma pendência requer acessar produção para integrar localmente. O próximo trabalho é merge contra o checkout atualizado e os casos isolados de INTEGRACAO_KONDO.md.
