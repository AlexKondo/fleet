# KING-KONDO WORKBENCH

## Mission
Construir a GWM Intelligent Fleet & Corporate Mobility Platform (fleet-car-saas.txt) como
SaaS multi-tenant sobre Supabase, priorizando o Mobility Decision Engine e Trip-Specific
Readiness sobre um simples "Vehicle Booking System".

## Product Contract
Fonte: `fleet-car-saas.txt` (raiz do repo) + `.claude/skills/gauntlet/SKILL.md` seção 2.
Princípio central: **Right Vehicle. Right Trip. Right Time. Ready to Go.**

## Decisions
Ver rodadas anteriores. Nesta rodada: usuário pediu para "terminar tudo" usando
`using-superpowers` + `frontend-design` + `king-kondo` para **paralelizar** o trabalho
restante. Isolamento por git worktree não estava disponível neste ambiente (harness
detectou "not a git repository" — cache de estado anterior ao `git init` desta sessão);
os 5 builders rodaram na mesma árvore de trabalho, com contratos de ownership de arquivo
explícitos por agente para evitar colisão — funcionou sem nenhum conflito real.

## Architecture Contract
Inalterado. Migrations agora em 5 arquivos (0001-0005), todas aplicadas e verificadas em
**local e remoto**. Nova migration:
```
0005_fleet_manager_advanced_actions.sql → RPCs swap_reservation_vehicle,
                                           transfer_reservation (§5)
```

## Workstreams — status final desta fase
- [x] W1-W7 (rodadas anteriores) — core operacional completo
- [x] Carona (§4), aprovação, check-in/out, workflow automático — rodada anterior
- [x] **Manutenção Preditiva (§12)** — `predictNextService` no domínio (8 testes) +
      seção "Manutenção Preditiva" na página `/analytics` (conectada nesta rodada — o
      builder original entregou a função mas não a conectou a nenhuma UI; achado pelo
      Blind Critic e corrigido)
- [x] **Restrição de Rodízio SP (§15)** — `checkTrafficRestriction` no domínio (5 testes)
      + integrado ao `planMobility` como aviso (não bloqueio) + banner na UI de
      solicitação de viagem
- [x] **Teste automatizado de isolamento cross-tenant** — `supabase/tests/cross-tenant-rls.mjs`,
      18/18 verificações passando (2 rodadas, antes e depois da migration 0005), zero
      vazamentos encontrados
- [x] **Upload de fotos no checklist (§10)** — 7 ângulos padronizados, upload real
      verificado (arquivo no Storage + linha em `inspection_photos`), opcional (não
      bloqueia o checklist)
- [x] **Ações avançadas do Fleet Manager (§5)** — trocar veículo e transferir reserva,
      testados de verdade pela UI (não só typecheck)
- [x] **Analytics / Fleet Intelligence (§19)** — km por veículo/viagem, destinos
      frequentes, taxa de carpooling, veículos subutilizados, manutenção preditiva

## Passed Gates
- `pnpm test` (domain): **81/81 GREEN** (10 arquivos).
- `pnpm typecheck`: limpo nos 3 pacotes.
- Migration 0005 aplicada sem erro em local e remoto, de primeira (SQL bem escrito
  mesmo sem o autor poder testá-la ao vivo).
- Teste de isolamento cross-tenant: **18/18**, rodado duas vezes (idempotente), zero
  vazamentos, tanto para dados quanto para a fronteira de papéis (employee vs
  fleet_manager).
- Code review (`/code-review high`) sobre todo o diff da rodada, com verificação
  independente de cada achado antes de eu confiar nele — ver Evidence.
- E2E real via Playwright contra Supabase local, cobrindo TUDO desta rodada: Analytics
  carrega sem erro, trocar veículo funciona (verificado no banco), transferir reserva
  funciona (verificado no banco), upload de foto sobe pro Storage de verdade (HTTP 200
  confirmado no objeto), fluxo de solicitação→aprovação→retirada→retorno continua
  funcionando (regressão), zero erros de console em qualquer etapa.

## Evidence — achados do Blind Critic (todos corrigidos)
1. **Bug real (P1)**: `planMobility` adicionava a razão `"traffic_restriction_active"`
   só no array `reasons` de nível superior, mas a UI renderiza `plan.vehicle.reasons`
   (array aninhado, nunca tocado) — o aviso de rodízio nunca aparecia na lista de
   motivos (só o banner separado funcionava). Corrigido: `vehicle` agora carrega uma
   cópia com o `reasons` estendido. Teste de regressão adicionado.
2. **Gap de robustez (P2)**: upload de foto não validava tipo MIME nem tamanho do
   arquivo (bucket também sem limite configurado) — `accept="image/*"` no `<input>` é só
   dica de UI, não validação real. Corrigido no helper compartilhado (10MB máx,
   `image/*` obrigatório, revalidado no server).
3. **Performance (P2)**: upload das 7 fotos rodava sequencialmente (`for...await`) em
   vez de paralelo — até 7x mais lento numa conexão ruim em campo. Corrigido com
   `Promise.allSettled`.
4. **Feature incompleta (P2)**: `predictNextService` (Manutenção Preditiva) foi
   implementada e testada no domínio, mas nunca conectada a nenhuma tela — o Fleet
   Manager não tinha como ver a previsão. Corrigido: nova seção em `/analytics`.
5. **Duplicação (P3)**: `PHOTO_ANGLE_LABELS` duplicava à mão os mesmos 7 rótulos já
   definidos em `STANDARD_PHOTO_ANGLES`/`DAMAGE_PHOTO_ANGLE`. Corrigido: agora derivado
   das mesmas fontes.
6. **Duplicação (P3)**: a função `uploadInspectionPhotos` estava copiada
   integralmente entre `pickup/actions.ts` e `return/actions.ts`. Extraída para
   `apps/web/lib/domain/uploadInspectionPhotos.ts` (resolve #2 e #3 ao mesmo tempo).

Todos os achados foram verificados por um agente independente antes de eu aplicar a
correção (nenhum foi corrigido só por confiança no relatório do critic).

## Assumptions
Mantidas das rodadas anteriores, mais:
```
ASSUMPTION
Restrição de rodízio SP tratada como aviso (soft warning), não bloqueio duro — o
veículo restrito ainda pode ser recomendado, mas nunca silenciosamente. Ver comentário
em planMobility.ts para o raciocínio completo.
Why: a spec diz "poderá participar da recomendação", não "deve excluir"; pode haver
permissão de exceção ou decisão de negócio para circular mesmo assim.
Risk if wrong: baixo — fácil de virar exclusão dura depois se o usuário preferir.
```
```
ASSUMPTION
Regras de rodízio SP são um "melhor esforço" do modelo público conhecido (dígito final
da placa, seg-sex, 7h-10h e 17h-20h, BEV isento), marcado explicitamente no código como
"deve ser verificado contra a regra oficial vigente antes de confiar em produção" —
por instrução direta da spec ("não invente regras regulatórias atuais").
Risk if wrong: médio — é só um aviso (ver acima), mas um aviso errado é pior que
nenhum aviso se o usuário passar a confiar cegamente nele.
```

## Risks
- Nenhum teste de concorrência real (dois swaps simultâneos) rodou contra
  `swap_reservation_vehicle` — a proteção contra deadlock (lock em ordem por id) foi
  escrita com cuidado mas não exercida sob concorrência de verdade.
- Regras de rodízio SP não são validadas contra fonte oficial (ver Assumption acima).
- Tabela de rodízio e config de manutenção preditiva não são configuráveis por
  organização ainda (usam sempre o default do pacote de domínio).

## Human Gates
Nenhum pendente além dos já conhecidos.

## Remaining Work
1. Teste de concorrência real em `swap_reservation_vehicle`.
2. Configurabilidade por organização das regras de rodízio e da janela de manutenção
   preditiva (hoje hardcoded como default do domínio).
3. App mobile/PWA otimizado para campo (câmera, uma mão, rede instável) — a captura de
   foto já existe na web, mas não foi testada em viewport mobile real.
4. Validar a tabela de rodízio de SP contra a fonte oficial (CET-SP) antes de qualquer
   uso em produção real.
