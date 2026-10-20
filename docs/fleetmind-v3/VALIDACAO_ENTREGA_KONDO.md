# Validação da entrega de correção para o Kondo — 19/10/2026

Nesta revisão foram usados testes focais. A suíte integral de 923 casos aprovada na revisão anterior **não foi repetida nem é apresentada como uma nova execução**.

| Verificação | Resultado e alcance |
|---|---|
| Testes focais da aplicação | 66 casos aprovados: filtro/seleção/renderização de Veículos, filtros/ações/renderização de Caronas, mapa existente, seção do anfitrião e regressão dos shells/páginas compartilhados. |
| Comparador de código | 5 casos Python aprovados: igualdade, preservação de alteração do Kondo, candidato sem conflito, mudanças nos dois lados, colisão de arquivo novo e remoção local. O comparador é somente leitura. |
| Tipos | `tsc --noEmit` aprovado. |
| Lint | `next lint` aprovado, sem warnings/errors de lint. O aviso de depreciação do comando no Next é independente do código alterado. |
| Build | `next build` aprovado, incluindo a rota `/fleet/carpools`. |
| Navegador com componentes reais | Fixture sintética em 1536×1024 e 390×1024: seleção muda os links; documentos e exportação usam o ID correto; paginação/filtros não mantêm detalhes antigos; resultado vazio remove a ficha; abas aceitam navegação por setas; mapa não é chamado antes do clique; falha simulada do provider deixa o restante utilizável. Sem rolagem horizontal da página. As abas podem rolar horizontalmente dentro do próprio controle. |

## Limites das evidências

A fixture de navegador usa os componentes React efetivos, dados sintéticos e adapters locais para navegação/imagem do Next. O evento do assistente é substituído por sua constante na fixture; isso não valida voz ou a IA real. A chamada do mapa recebe resposta de falha simulada: a verificação prova acionamento por clique e degradação, não disponibilidade do Google/provider. O shell completo, autenticação e banco não são exercitados por essa fixture; existem testes de renderização compartilhados, sem substituir execução autenticada.

Nenhuma nova migration foi adicionada nesta revisão; não se repetiu a cadeia de banco só por alterações de apresentação. A validação anterior de SQL continua registrada nos respectivos logs. Supabase, PostgREST, Auth, Storage, SMTP, concorrência entre conexões e providers reais precisam da execução integrada pelo Kondo.

Inspeção local não significa aceite visual integral, pixel-perfect ou conclusão das 28 telas. As lacunas de implementação permanecem na matriz e em `PENDENCIAS_IMPLEMENTACAO_GPT.md`.

## Evidências incluídas

- `test-KONDO-focal.log`
- `test-KONDO-comparador.log`
- `typecheck-KONDO.log`
- `lint-KONDO.log`
- `build-KONDO.log`
- `browser-KONDO-resultados.json` (somente medições e resultados, sem screenshots ou dados pessoais)

Screenshots de inspeção são internos. As três referências visuais aprovadas integram o pacote para a comparação do Kondo.
