# Relatório de Conclusão C8 — Carona Inteligente e Inteligência Geoespacial

Data: 2026-10-01 · Commit de referência: 44978bc · Produção: Vercel (deploy automático por `git push`)

## 1. Recomendação: **GO, com condições**

A carona está pronta para uso real. Não há defeito Crítico ou Alto em aberto. As condições (seção 14) são testes que só um humano pode fazer (microfone real, queda real do Google) e duas decisões de produto.

## 2. O que existia e o que mudou (matriz de reconciliação)

| Exigência do pack | Antes | Agora |
|---|---|---|
| Rota real (não texto) | Comparava texto do destino | Geocoding + Rotas do Google; mede desvio em km e minutos |
| Anfitrião oferece vagas | Só uma caixinha de consentimento | Tabela `carpool_offers` + passo "Deseja disponibilizar vagas?" |
| Pedido de carona com status | Rejeitar apagava a linha | `carpool_ride_requests` com PENDING/ACCEPTED/REJECTED/EXPIRED/CANCELLED/INVALIDATED; nunca apaga |
| Limites configuráveis | Só tolerância de horário | `carpool_policy_settings` versionada (cada decisão grava a versão) |
| Filtro barato antes da rota cara | Não existia | Dois estágios + Cost Guard (cota diária, circuit breaker) |
| Voz | Nenhum comando | 7 comandos de carona (oferecer, desligar, buscar, pedir, aceitar, rejeitar, cancelar) |
| Auditoria | Só aceitar/rejeitar | Eventos em todas as transições + telemetria |
| Queda do provedor | Não existia | Aviso na tela; carona não funciona; reserva normal segue |
| Pontos de Mobilidade Corporativa | Não existia | Tabela + tela de administração |
| Bug do chat (id de reserva no lugar de id de viagem) | Latente | Corrigido |

Causa raiz de "carona não ofertada": `allow_carpool` era um consentimento único na reserva, nunca um ato de "estou oferecendo N vagas".

## 3. Migrações (0047–0070)

0047 consentimento/tolerância · 0048 zoom do Gantt · 0049 remove overload antigo · 0050/0051 links de notificação · 0052 ofertas e pedidos · 0053 política · 0054–0056 geo, pontos, cota · 0057/0058 eventos e notificador · 0059 RPCs do ciclo de vida · 0060 trava de escrita direta · 0061/0062 ajustes e privacidade · 0063/0064 privacidade de menor privilégio · 0065 telemetria e rótulo grosso · 0066–0069 correções de segurança (M1, M2, S1, L5) · 0070 privilégios padrão futuros.
Todas aplicadas em produção. Arquivos de rollback em `supabase/migrations/rollback/`.

## 4. Google Maps Platform — o que usamos

| Serviço | Uso | Documentação |
|---|---|---|
| Geocoding API | Endereço → coordenadas | https://developers.google.com/maps/documentation/geocoding/requests-geocoding |
| Places API (New) — Text Search | Busca de locais | https://developers.google.com/maps/documentation/places/web-service/text-search |
| Routes API — computeRoutes | Rota com parada intermediária (desvio) | https://developers.google.com/maps/documentation/routes/compute_route_directions |

Nenhum tipo do Google vaza para o domínio; tudo fica atrás de interfaces.

## 5. Configuração e segredos

- `GOOGLE_MAPS_API_KEY`: variável **sensitive** na Vercel (produção), só lida em arquivos `server-only`. Teste de varredura (`secret-leak-scan.mjs`) confirma que não vaza no bundle nem em mensagens de erro.
- `CRON_SECRET`: todas as rotas de cron falham fechadas sem ele.
- Vercel Hobby aceita 2 crons → um único `/api/cron/daily` despacha os 3 jobs.
- Ambiente de *preview* da Vercel não tem esses segredos (carona não funciona em preview).

## 6. Política (valores)

Padrão do pack: janela ±15 min, desvio máximo 5 km / 10 min, anfitrião opt-in e aprovação obrigatórios.
**Organização real hoje (lido do banco, versão 1):** carona ligada, carona-primeiro ligada, opt-in e aprovação obrigatórios, janela de ida 30 min e volta 60 min (tolerâncias migradas), desvio 5 km / 10 min, até 5 candidatos para rota precisa, pedido expira em 30 min. Dados reais de carona ainda: 0 ofertas, 0 pedidos.

## 7. Resultados dos testes (última rodada completa)

| Suíte | Resultado |
|---|---|
| Domínio (vitest) | 252 passaram |
| App web (vitest) | 380 passaram |
| Ciclo de vida das RPCs (idempotência, corridas) | 118/118 |
| Ataques de escrita direta | 65/65 |
| Follow-ups da etapa 0 | 33/33 |
| Privacidade de lugares (grosso até aceitar) | 33/33 |
| Rótulo grosso (37 formatos de endereço) | 37/37 |
| Matriz de privacidade | 195/195 (após corrigir 1 expectativa antiga) |
| Matriz RBAC (RPCs + tabelas) | 391/391 (após corrigir 1 sonda poluída) |
| RBAC das server actions | 14/14 |
| Anti-forja do chat | 8/8 |
| Texto hostil pelo LLM | 8/8 |
| KPI (cenário e volume 1500 linhas) | 1/1 e 3/3 |
| Teste de mutação (regressão allow_carpool detecta lógica antiga) | OK |
| Animações (lupa, confete) com e sem "reduzir movimento" | 11/11 |
| Regressão de privacidade c7a | 71/71 |
| Pré-voo da 0070 (simulação de papéis, diff de ACL) | 94/94, diff 0 |

Nota de honestidade: na rodada completa de 14/16 os dois que falharam eram **expectativas de teste desatualizadas** (não defeito do produto); foram corrigidas e as duas matrizes foram reexecutadas verdes (195/195 e 391/391).

## 8. Concorrência e queda do provedor

- Dois riders disputando a última vaga: exatamente um ganha (travamento de linha no banco). Toque duplo com o mesmo `client_request_id`: uma linha só.
- Queda do Google: zero matches, aviso "O serviço de mapas do Google está indisponível…", reserva normal continua (walkthrough Playwright `carpool-c5-walkthrough-outage`). Entrada malformada ou NaN/Infinity: falha fechada (nunca declara compatível).

## 9. Telemetria e Cost Guard

Tela `/analytics/carpool` com os KPIs do pack §06 (avaliações, ofertas, candidatos, chamadas de rota, matches, pedidos, aceitos/rejeitados/expirados, vagas compartilhadas, km evitados, chamadas/erros/latência do provedor, invalidações). Cost Guard no banco: cota diária, circuit breaker, contadores de erro/latência. Paginação além do limite de 1000 linhas do PostgREST verificada.

## 10. Segurança e privacidade — achados e correções

| Gravidade | Achado | Estado |
|---|---|---|
| Crítica | `update_member_role` executável por qualquer um (escalada de privilégio) | Corrigido (0068), verificado |
| Alta | Funcionário lia viagens de colegas e CNH | Corrigido (0063/0064/0066) |
| Alta | Crons falhavam abertos sem segredo | Corrigido |
| Alta | Tabelas de carona graváveis direto | Corrigido (0060) |
| Média | Chave vazava em mensagem de erro | Corrigido |
| Média | Anon com privilégios legados em tabelas | Corrigido (0069) |
| Média | Objetos futuros exporiam privilégios por padrão | Corrigido (0070) |
| Incidente | Bloqueio de CNH em produção por ordem errada (migração antes do app) | Resolvido; regra expand/contract documentada em `README-migrations.md` |

Nenhum endpoint de "diretório de jornadas de colegas" existe. Endereço exato só depois de ACCEPTED.

## 11. Regressão do sistema existente

Reserva, aprovação, manutenção, energia, check-in/out, notificações, auditoria, multi-idioma: cobertos pelas suítes acima e pelo smoke de produção (login 200, dashboard redireciona para login quando anônimo, papéis reais intactos: 2 administradores, 1 segurança, 2 funcionários; CNH dos 5 usuários reais íntegras).

## 12. Evidências

`resultado_de_testes/carpool-c5`, `carpool-c6`, `carpool-c7`, `carpool-c7b`, e esta pasta.

## 13. Critérios do pack §07

GO: carona em Nova Viagem e Minha Viagem ✔ · carona-primeiro ✔ · rota precisa ✔ · limites configuráveis ✔ · opt-in e vagas ✔ · pedir/aceitar/rejeitar/cancelar ✔ · queda do provedor degrada com segurança ✔ · sem defeito Crítico/Alto ✔ · regressão verde ✔ · Cost Guard e telemetria ativos ✔.
NO-GO (todos verificados limpos): sem matching só por cidade · sem overbooking · Google nunca decide elegibilidade sozinho · sem exposição de jornada alheia · consentimento do anfitrião exigido · fallback funciona · sem vazamento de credencial · reserva existente intacta.

## 14. Itens em aberto

| # | Item | Gravidade | Ação |
|---|---|---|---|
| 1 | Teste real de microfone (voz) e queda real do Google, em tela | Média | Fazer durante os testes de aceite |
| 2 | Retenção de coordenadas exatas em pedidos antigos (hoje: indefinida) | Média (LGPD) | Decisão do dono; recomendado anular coordenadas exatas após 90/180 dias |
| 3 | Justificativa da viagem ainda visível ao passageiro aceito | Baixa | Ocultar (revogar coluna + função definer, expand/contract) — decidido: ocultar |
| 4 | Notificação funcionário→gestor: resíduo restrito a modelos exatos de texto | Baixa | Aceito |
| 5 | 0070: futuro `create extension` pelo papel postgres exige grants explícitos | Baixa | Documentado |
| 6 | RPC legada `create_carpool_participation` inativa para orgs com carona desligada | Baixa | Aceito |
| 7 | Preview da Vercel sem segredos | Baixa | Aceito |
| 8 | Scripts locais sensíveis não versionados (create-admin*.mjs etc.) | Baixa | Manter fora do git |

## 15. Custo de agentes

Soma dos contadores finais dos subagentes ≈ 4,8 milhões de tokens (corrigindo estimativa anterior errada de 8–10M). Nenhum agente foi usado após isso.
