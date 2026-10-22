# Testes executados nesta entrega

22/10/2026. Ambiente local Node 24.19, pnpm 11.25, dependências congeladas; PGlite 0.3.14. Nenhum teste usou produção.

| Execução final | Resultado | Evidência |
|---|---|---|
| Regressão focal da aplicação, 31 arquivos | 339/339 | evidence/regression-final.json e .log |
| Geo/APIs e renderização adicional, 4 arquivos distintos | 51/51 | evidence/additional-final.json e .log |
| Domínio: resolução de localidades | 14/14 | evidence/domain-final.log |
| Migration preflight | 6/6 | evidence/preflight-final.log |
| Comparador de integração | 5/5 | evidence/comparator-final.log |
| TypeScript web | passou | evidence/typecheck-final.log (vazio = sem erro) |
| Lint web | passou, sem warnings/errors | evidence/lint-final.log |
| Build Next | passou, 48 páginas geradas | evidence/build-final.log |
| Browser offline 1536 e 390 px | sem erros de hidratação; rascunho restaurado; exceção com erro/retry/sucesso | evidence/browser-candidate-final.log |

Total: **415 testes automatizados distintos** (390 web +14 domínio +6 preflight +5 comparador). Os 47 testes de segurança, 104 do Assistente e 4 da nova ação de exceção estão incluídos nos 390, não somar novamente. Os testes de renderização anteriores também se sobrepõem. Não se repetiu a suíte histórica de 964 casos.

Falhas intermediárias foram corrigidas ou eram fixtures antigas incompatíveis com o bloqueio intencional de escrita direta. Logs first/second/recheck são histórico diagnóstico, não resultado final. O comparador falhou inicialmente por PYTHONPATH e passou com o comando correto. A versão final de UUID foi validada em exception-final.log após a regressão. O primeiro browser com retry não reconfirmava checkbox, parando na validação HTML; o roteiro final reconfirma e preserva a razão. Não foi tratado como falha de banco.

O navegador reproduziu erro de hidratação no VehicleForm original com sessionStorage preenchido (browser-before.log). A versão corrigida passou. Isso comprova o componente isolado, sem CSS global/aplicação autenticada, sem substituir a conferência das 28 telas. A ação do formulário é simulada; a ação real tem testes separados com RPC simulado e o comando SQL é exercitado em PGlite.

## Reproduzir

Na raiz: `pnpm install --frozen-lockfile --ignore-scripts`.

Na pasta apps/web:

```sh
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1 app/carpool/actions.test.ts app/chat/noVehicleFlow.test.ts app/trips/new/actions.test.ts lib/domain/immutablePhoto.test.ts lib/operations app/reservations/\[id\]/exceptionAction.test.ts app/api/cron app/api/geo/geoRoutes.test.ts app/dashboard/command-center/render.test.ts lib/carpool/managementRender.test.ts app/operations/workspaces.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next lint
```

Esse comando cobre os diretórios relevantes e pode conter mais casos que a seleção registrada; a lista exata executada está nos dois JSONs finais. Para reproduzir exatamente, extrair os caminhos de testResults[].name e remover o prefixo até apps/web/; não presumir que caminhos absolutos da máquina de origem existem no checkout.

Na raiz:

```sh
node packages/domain/node_modules/vitest/vitest.mjs run packages/domain/src/carpool/locationResolution.test.ts --maxWorkers=1 --minWorkers=1
node --test scripts/migration-preflight.test.mjs
PYTHONPATH=scripts python3 -m unittest scripts/test_compare_kondo_source.py
```

Build local: em apps/web, definir NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 e chaves fictícias de teste nas variáveis públicas/servidor, então `node node_modules/next/dist/bin/next build`. A geração local não valida conectividade real.

Browser: `testing/conclusao/local-browser.cjs` requer Playwright e Chromium disponíveis na máquina; não foram adicionados ao lockfile. Configurar FLEET_CHROMIUM_EXECUTABLE e FLEET_QA_OUTPUT fora da árvore de entrega; executar com node a partir da raiz. O roteiro bloqueia chamadas externas e simula as server actions. Não usar os scripts antigos testing/live-demo contra produção.

## Não executado / pendente

E2E autenticado das 28 telas, Google/IA/Brevo reais, áudio/OCR, Storage/Supabase remoto, stress/carga, concorrência multiconexão, recuperação de backup, audit online de dependências, teste em Safari/iOS/Android real e confronto pixel a pixel com todas as artes. Ver os critérios de INTEGRACAO_KONDO.md.
