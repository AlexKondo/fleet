# Evidências de execução — 22/10/2026

## Fechamento incremental da versão atual

- **46/46 testes focais** em seis módulos: CNH (29), fotos/API (13) e mensagens do dashboard (4). Evidência final: `closure-targeted-tests.log`; os logs focais anteriores são subconjuntos. São 24 casos adicionais à coleta anterior; os demais 22 já existiam e foram repetidos porque verificam os arquivos alterados. A suíte completa anterior não foi repetida nesta etapa, conforme orientação do usuário.
- TypeScript: passou (`types-final-review.log`). Lint dos arquivos de implementação atingidos: sem warnings/erros (`lint-final-review.log`). Build atual: `build-final-review.log`; substitui para o fechamento os builds anteriores.
- Falhas de rede na leitura de JSON retornam erro controlado; limite de 4096 bytes é conferido durante o stream, inclusive UTF-8 sem Content-Length. Objeto com tamanho incompatível não aloca seu ArrayBuffer nem é atestado. Erro de leitura/hash no reenvio de foto está dentro do tratamento amigável.
- Smoke real de conversão no Chromium, com fixtures sintéticas e assets locais: passou, sem erros de página (`license-browser.log`). Não equivale a teste de legibilidade humana, IA real ou E2E autenticado.
- Não houve nova execução de domínio nem serviços reais. As pendências integradas continuam explícitas no relatório.

Ambiente local Node 24.19 / pnpm 11.25, dependências congeladas e scripts de instalação desativados. SQL real da aplicação executado em PGlite com esquemas Auth/Storage de teste; bytes de Storage e serviços HTTP são simulados nos testes unitários. Não houve Supabase/Auth/Storage remotos nem Postgres Docker real nesta execução.

| Checkpoint anterior às correções incrementais | Resultado | Evidência |
|---|---|---|
| Aplicação completa, 106 arquivos | 1049/1049 | evidence/web-complete.json e .log |
| Preflight de migrations e política de ativação | 10/10 | evidence/preflight-final.log |
| Comparador original, classificação de três vias | 5/5 | evidence/comparator-final.log |
| TypeScript | passou, sem saída de erro | evidence/types-final.log |
| Build Next | passou, 49 páginas estáticas geradas | evidence/build-complete.log |
| Lint | sem erros/warnings | evidence/lint-check.log |
| Componentes em navegador offline | 1536 e 390 px, rascunho restaurado e formulário de exceção operante, sem erro de hidratação | evidence/browser-final.log |

Total de testes automatizados distintos executados **nesse checkpoint: 1064**. Os 1045 da rodada anterior, os 37 SQL focais e os 71 de UI são sobreposições; não somar novamente. O domínio (271 testes) é resultado relatado pelo Kondo para a base, não reexecutado nem somado nesta rodada porque seus arquivos de implementação não foram alterados.

A execução completa da aplicação foi necessária após mudanças compartilhadas em permissões, middleware, tipos e transporte de fotos. Rodadas posteriores corrigiram tipagem, configuração de coleta do teste de criação e o tratamento de criação parcial; o JSON web-complete é o resultado final. Logs anteriores são diagnósticos, não falhas abertas da versão final. O build-final intermediário falhou antes da anotação dos parâmetros; build-complete é a execução válida. O comando de lint na raiz com --dir não era válido; lint-check foi executado corretamente em apps/web.

Casos novos relevantes: notas internas negadas, injeção de tarefa negada, atribuição auditada preservada, aprovação vencida negada, redução de odômetro justificada/auditada, default ativo com/sem settings, resumo de exceção sem motivo interno, recuperação de pendência sem apagar original, A→B→A, metadata e caminho de atestação, adulteração do mesmo tamanho, upload 8,6 MB sem bytes na requisição da action, erro/retry sem duplicar cadastro de veículo, validação de origem/autenticação/JSON da API.

## Reproduzir

Os comandos completos abaixo reproduzem o checkpoint anterior; não impõem repetição indiscriminada. Para o incremento final, executar em apps/web `pnpm test lib/domain/prepareLicenseDocument.test.ts lib/domain/analyzeDriversLicense.test.ts app/account/license/actions.test.ts app/api/photos/route.test.ts lib/domain/storedPhoto.test.ts lib/dashboard/fleetActionError.test.ts`. Ampliar a regressão conforme o delta efetivamente integrado.

Na raiz: `pnpm install --frozen-lockfile --ignore-scripts`.

Em apps/web:

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --minWorkers=1
NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next lint --no-cache
```

Para build local, definir NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 e chaves fictícias de teste para NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY; executar `node node_modules/next/dist/bin/next build`. Não usar credenciais de produção.

Na raiz:

```sh
node --test scripts/migration-preflight.test.mjs scripts/check-auto-release-policy.test.mjs
PYTHONPATH=scripts python3 -m unittest scripts/test_compare_kondo_source.py
node scripts/print-consolidated-migration-plan.mjs
```

`testing/conclusao/local-browser.cjs` exige Playwright/Chromium disponíveis. Definir FLEET_QA_SOURCE e FLEET_QA_DEPENDENCIES como o checkout, FLEET_CHROMIUM_EXECUTABLE para o binário e FLEET_QA_OUTPUT para pasta externa. Ele bloqueia requisições externas e simula ações. Não é E2E autenticado nem teste visual pixel a pixel. Nenhuma captura nova de navegador foi incluída no pacote.

Os testes S1/S2/S3 do Kondo (banco/Storage/Auth reais locais, 468 navegações etc.) continuam como evidência histórica da base c6b26da, nos relatórios recebidos. Não foram atribuídos ao novo delta. Repetir somente seus cenários atingidos, especialmente upload/retomada, CNH/passagem, medições e atribuição, com ambiente isolado.


## Correção incremental — validade da CNH

A confirmação da leitura da CNH agora reutiliza `canDrive` para comparar a data civil de Brasília. A comparação anterior com meia-noite UTC podia negar a autorização durante o próprio dia de validade. Não altera permissões administrativas nem permite condução após o vencimento. Verificação pontual: 14 testes do módulo de confirmação, incluindo os instantes imediatamente antes e depois da meia-noite de Brasília, passaram. São 2 cenários novos; os outros 12 se sobrepõem à suíte anterior. A pendência de transporte foi tratada no incremento seguinte descrito abaixo; não houve retenção nova de documentos nem chamada à IA real.


## Incremento — transporte da CNH e leitura conservadora

Implementado `prepareLicenseDocument`: aceita a entrada existente de até 5 MiB, preserva originais de até 3 MiB e prepara imagens/PDFs maiores somente na memória do navegador. PDF usa worker e fontes locais; todas as páginas são renderizadas. Não há recorte, descarte silencioso de páginas, CDN nem armazenamento de documento. Limites de complexidade (8 páginas, 24 milhões de pixels, dimensão máxima de 16.000 pixels) retornam orientação amigável, mantendo o original selecionado. A codificação JPEG mantém a resolução, reduz qualidade até um limite fixo e recusa resultado ainda maior que 3 MiB. Legibilidade documental não é inferida desses limites: conferir o resultado lido na revisão existente e homologar OCR real. A preparação também falha com mensagem amigável em navegador incompatível ou PDF protegido.

A análise não troca mais automaticamente emissão e validade quando a IA produz datas contraditórias: rejeita a leitura para nova tentativa. Datas inexistentes e tipos incorretos também são rejeitados. Não modifica uma data válida nem remove a confirmação humana.

Verificações pontuais: 29 testes em três módulos (14 confirmação, 6 preparação com mocks, 9 validação da leitura), tipagem e compilação. Os testes de mocks não provam funcionamento de IA, câmera, Storage, Supabase ou hospedagem remota. Ver logs específicos `license-transport-tests.log`, `types-license-transport.log`, `build-license-transport.log`. Não repetir a suíte completa apenas por esta mudança localizada; Kondo deve validar os cenários atingidos na homologação isolada.


Smoke em Chromium local com fixtures sintéticas: PDF de 3.147.592 bytes / duas páginas convertido para JPEG de 91.499 bytes com 1.697 × 4.800 pixels; PNG de 3.251.348 bytes convertido para 44.177 bytes. Sem erro de página. Worker e fontes servidos localmente. Isso confirma conversão e dimensões, não equivale à homologação visual ou OCR real. Evidência: `license-browser.log`.


Comparação final somente leitura contra o ZIP base c6b26da: 99 caminhos candidatos, zero conflito contra essa base e zero substituição local proposta. Evidência: `closure-comparison.json`. Isso não verifica alterações posteriores existentes no computador do Kondo; o comparador deve ser executado contra a branch real antes da integração. Os 148 SQL recebidos continuam idênticos e foram conferidos pelo empacotador.
