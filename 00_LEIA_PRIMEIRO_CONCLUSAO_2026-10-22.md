# FleetMind v3.0 — PACOTE ÚNICO CONSOLIDADO após c6b26da

**Código corretivo executável. NO-GO para produção. Não homologado. Nenhuma alteração remota realizada.**

Esta é a orientação vigente e substitui as instruções operacionais da primeira entrega. Base efetiva: ZIP FleetMind_ENTREGA_FINAL_GPT_c6b26da.zip recebido do Kondo, com F1/F2 e migrations 0215/0216 preservados. Não aplicar a antiga 0215 interna de ativação: nesta entrega a ativação é 0217.

Liberação automática ativa por padrão; CNH restrita à condução; notas e criação de tarefas protegidas; medições editáveis com auditoria e justificativa de correção; fotos com transporte direto ao Storage, verificação de bytes/caminho no servidor, recuperação de pendências e referências antigas selecionáveis; rótulo de exceção próprio e visão das ofertas do motorista. As 28 aprovações históricas são preservadas; referências ausentes continuam como pendência de conferência.

Começar por docs/consolidado_final/RELATORIO_CONSOLIDADO.md, INTEGRACAO_KONDO.md e TESTES.md. Há **11 migrations novas, 0217–0227**, além das recebidas intactas. A ordem de EXPAND/código/CONTRACT é obrigatória e está no plano; não aplicar tudo em sequência numérica em produção. Os contratos removem permissões usadas por escritores antigos.

1049 testes da aplicação, 10 de preflight/configuração e 5 do comparador passaram. Tipagem, lint, build e navegador offline passaram. O novo fluxo ainda precisa de Auth/Storage reais e homologação remota. CNH agora recebe preparação local em memória antes do envio, com entrada de até 5 MiB e transporte máximo de 3 MiB; 29 verificações pontuais e smoke sintético no Chromium descritos em TESTES.md. Legibilidade/OCR e hospedagem reais continuam pendentes; o relatório não considera o projeto integralmente concluído.

Para integrar, usar scripts/compare_consolidado_final.py sobre o checkout atual e revisar changes.patch. Nunca copiar a árvore inteira por cima das melhorias locais. O comparador trata CRLF/LF na classificação, mas os manifestos preservam SHA-256 dos bytes reais. MANIFEST_SHA256.json cobre os arquivos entregues, exceto o próprio manifesto.

Nenhum deploy, migration de produção ou limpeza de reservas está autorizado. O status atual permite apenas revisão e integração local. Ao retomar, usar o CHECKPOINT.md para continuar sem repetir verificações históricas.


## Encaminhamento após fechamento do código

O mesmo ZIP contém agora as correções incrementais de CNH e robustez de upload. Fechamento local: 46 testes focais, tipagem, lint e build; sem nova rodada completa de 1049 casos. Ver `docs/consolidado_final/CHECKPOINT.md` para estado exato e `INTEGRACAO_KONDO.md` para execução isolada. O pacote está preparado para integração/validação pelo Kondo; continua NO-GO para produção. Não enviar pacotes antigos em paralelo.
