# KING-KONDO WORKBENCH

## Mission
Construir a GWM Intelligent Fleet & Corporate Mobility Platform (fleet-car-saas.txt) como
SaaS multi-tenant sobre Supabase, priorizando o Mobility Decision Engine e Trip-Specific
Readiness sobre um simples "Vehicle Booking System".

## Product Contract
Fonte: `fleet-car-saas.txt` (raiz do repo) + `.claude/skills/gauntlet/SKILL.md` seção 2.
Princípio central: **Right Vehicle. Right Trip. Right Time. Ready to Go.**

## Decisions — rodada mais recente
- Usuário testou o app e não conseguiu se cadastrar (só existiam contas seed) — gap real
  encontrado pelo próprio uso, não por mim. Construí um fluxo de signup self-service
  (nova organização + primeiro usuário administrator).
- "App mobile" confirmado pelo usuário = navegador do celular (responsivo/PWA), **não**
  app nativo Android/iOS. Captura de foto já usa `<input capture>` do navegador — sem
  necessidade de API nativa.
- Notificações: só dentro do app (sininho), sem provedor de e-mail externo — decisão do
  usuário para evitar custo/aprovação de serviço pago.
- King-Kondo usado de novo para paralelizar: 3 agentes simultâneos (localização no
  check-in, configurabilidade por organização, notificações in-app), com ownership de
  arquivo explícito — zero colisões reais entre os 3.

## Architecture Contract
Migrations agora em 9 arquivos (0001-0009), todas aplicadas e verificadas em **local e
remoto**:
```
0006_vehicle_location_tracking.sql      → §14, current_location_id atualizado no retorno
0007_organization_settings_extensions.sql → maintenance_due_soon_days, traffic_restriction_enabled
0008_notifications.sql                   → tabela notifications + 4 RPCs estendidas
0009_fixes.sql                           → remove overload fantasma de record_return
```
Novos arquivos relevantes:
```
apps/web/app/signup/**              → cadastro self-service (organização + admin)
apps/web/lib/supabase/admin.ts      → cliente service-role, só para bootstrap de tenant
apps/web/lib/domain/signUpOrganization.ts
apps/web/app/settings/**            → configurações da organização (antes só via SQL)
apps/web/app/dashboard/NotificationBell.tsx + notificationActions.ts
apps/web/lib/supabase/client.ts     → cliente browser-side (novo)
apps/web/public/manifest.json + icon-*.png + apple-touch-icon.png → PWA
```

## Workstreams — status final desta rodada
- [x] **Cadastro self-service (gap crítico encontrado pelo usuário)** — organização +
      usuário administrator + localização padrão, tudo atômico com rollback em caso de
      falha parcial. Testado de ponta a ponta (nova org isolada, zero veículos, exatamente
      como deveria).
- [x] **Localização atual do veículo (§14)** — `record_return` agora recebe e valida
      `current_location_id`, testado contra o banco.
- [x] **Configurabilidade por organização** — página `/settings` real (antes só existia
      no schema, sem UI nenhuma), com todos os parâmetros de readiness/carpool/
      manutenção preditiva/rodízio. Testado: salvar funciona, valor fora do intervalo é
      rejeitado no servidor mesmo bypassando a validação do navegador.
- [x] **Notificações in-app (§ implícito)** — sino no header, badge de não lidas, 4 RPCs
      existentes estendidas para notificar (nova reserva, aprovação, tarefas criadas,
      veículo bloqueado). Testado com notificação real aparecendo no dropdown.
- [x] **PWA / "app mobile"** — manifest.json + ícones + theme-color, instalável via
      navegador. Testado em viewport de iPhone real (Playwright + device profile):
      dashboard, solicitação de viagem e checklist de fotos renderizam corretamente,
      zero erros de console.
- [x] **Teste de concorrência no "trocar veículo"** — duas chamadas simultâneas à mesma
      reserva: uma teve sucesso limpo, a outra falhou com erro de negócio (não corrupção).
      Estado final do banco consistente. Risco da rodada anterior resolvido com evidência.

## Passed Gates
- `pnpm test` (domain): **81/81 GREEN**.
- `pnpm typecheck`: limpo nos 3 pacotes.
- Migrations 0006-0009 aplicadas sem erro em local e remoto.
- Cross-tenant RLS test (18/18) re-executado com o schema completo (notificações,
  localizações, configurações) — ainda zero vazamentos.
- Code review (`/code-review high`) rodado **duas vezes** nesta sessão sobre o código
  novo, com verificação independente de cada achado antes de confiar — ver Evidence.
- E2E real via Playwright: cadastro de organização nova, sino de notificação com
  conteúdo real, configurações salvando e validando no servidor, checklist de retorno
  atualizando a localização do veículo no banco, tudo verificado contra local e
  novamente contra o Supabase remoto real.

## Evidence — achados do 2º Blind Critic desta sessão (todos verificados; 4 corrigidos, 1 aceito como risco documentado, 1 limpo)
1. **Bug real (P0)**: `create or replace function record_return(...)` com um parâmetro a
   mais criou uma SEGUNDA função no Postgres (overload por assinatura) em vez de
   substituir a original — a versão antiga (sem validação de localização, sem
   notificação) continuava ativa e concedida a `authenticated`. Corrigido com
   `drop function` explícito na 0009. Verificado no banco: só resta 1 `record_return`
   com 13 argumentos.
2. **Bug real (P1)**: organização nova (via signup) não tinha nenhuma `vehicle_location`,
   e o checklist de retorno exige uma — uma empresa nova jamais conseguiria completar um
   retorno de veículo. Corrigido: signup cria uma localização "Sede" por padrão.
   Verificado: nova org criada com `vehicle_locations = [{"name":"Sede"}]`.
3. **Bug real (P2)**: `/manifest.json` era bloqueado pelo middleware de autenticação
   para visitantes não logados (não estava na lista de rotas públicas nem excluído do
   matcher), quebrando a instalabilidade do PWA antes do login. Corrigido: adicionado à
   exclusão do matcher. Verificado: HTTP 200 sem sessão.
4. **Bug real (P2)**: `range_safety_buffer_percent` só validava não-negativo, não o
   limite superior — um valor acima de 100% zera/inverte a autonomia utilizável em
   `assessTripReadiness`, travando recomendação de veículo para a organização inteira.
   Corrigido: validação de intervalo em todos os campos numéricos de `/settings`.
   Verificado: bypass do `max` do HTML5 via JS, servidor rejeitou mesmo assim, valor no
   banco continuou em 20.
5. **Risco aceito, documentado, não corrigido (P2, segurança)**: a policy de INSERT em
   `notifications` só verifica `organization_id`, não `user_id` — qualquer membro
   autenticado pode inserir uma notificação com título/corpo arbitrário endereçada a
   qualquer colega da mesma organização (mesmo padrão já aceito para `workflow_tasks`
   desde a rodada anterior). Não corrigido agora porque a correção "certa" exigiria
   tornar `create_vehicle_reservation`/`approve_reservation`/`block_vehicle` SECURITY
   DEFINER, removendo a proteção implícita via RLS que hoje bloqueia `employee` de
   aprovar a própria reserva (verificada e testada nesta mesma sessão) — troca
   arriscada demais para fazer sob pressão de tempo sem uma rodada de testes dedicada.
6. Dependência `sharp` adicionada só para gerar os ícones do PWA, nunca importada no
   código do app — removida depois de gerar os PNGs.

## Assumptions
Mantidas das rodadas anteriores, mais:
```
ASSUMPTION
Primeiro usuário de uma organização nova (via /signup) sempre recebe o papel
'administrator', com acesso equivalente a fleet_manager em toda a RLS existente.
Why: alguém precisa ter controle total para convidar/gerenciar o resto do time; não há
fluxo de convite ainda, então o fundador não pode começar com um papel limitado.
Risk if wrong: baixo — é o comportamento esperado para "criar minha empresa no Fleet".
```
```
ASSUMPTION
E-mail de confirmação é ignorado no signup (auth.admin.createUser com email_confirm:
true) — usuário entra direto, sem clicar em link de confirmação.
Why: não há provedor de e-mail configurado neste ambiente (nem local nem remoto), e
exigir confirmação sem conseguir entregar o e-mail deixaria todo cadastro travado.
Risk if wrong: médio — qualquer pessoa pode se cadastrar com um e-mail que não é dela.
Aceitável para uma ferramenta corporativa interna por agora; revisar se o produto for
exposto publicamente sem controle de quem pode criar organizações.
```

## Risks
- Notificações: qualquer membro pode spoofar notificação para colega da mesma
  organização (ver Evidence #5) — aceito, documentado, não corrigido.
- Signup não valida se o e-mail realmente pertence a quem está criando a conta (ver
  Assumption acima).
- Regras de rodízio de SP ainda não validadas contra fonte oficial (herdado da rodada
  anterior).
- Sem UI para gerenciar `vehicle_locations` além da criada automaticamente no signup —
  uma organização não consegue adicionar novos locais pela interface ainda.
- Sem UI para uma organização existente adicionar veículos/categorias — só existe via
  SQL direto (seed) hoje. Uma organização criada via `/signup` fica sem frota até
  alguém popular isso manualmente no banco.

## Human Gates
Nenhum pendente além dos já conhecidos.

## Remaining Work
1. UI de gestão de frota (adicionar veículo, categoria, localização) — hoje só existe
   via seed/SQL direto; uma organização nova via signup não tem como popular sua própria
   frota pela interface.
2. Fluxo de convite de novos usuários para uma organização existente (hoje só o
   `/signup` cria usuários, sempre como fundador de uma organização nova).
3. Fechar o risco de spoofing de notificação (Evidence #5) — provavelmente exige revisar
   o modelo de segurança das 4 RPCs afetadas com mais cuidado do que uma correção rápida
   permite.
4. Validar a tabela de rodízio de SP contra a fonte oficial (CET-SP).
5. Confirmação de e-mail real no signup, se o produto vier a ser exposto publicamente.
