# KING-KONDO WORKBENCH

## Mission
Construir a GWM Intelligent Fleet & Corporate Mobility Platform (fleet-car-saas.txt) como
SaaS multi-tenant sobre Supabase, priorizando o Mobility Decision Engine e Trip-Specific
Readiness sobre um simples "Vehicle Booking System".

## Product Contract
Fonte: `fleet-car-saas.txt` (raiz do repo) + `.claude/skills/gauntlet/SKILL.md` seção 2.
Princípio central: **Right Vehicle. Right Trip. Right Time. Ready to Go.**

## Decisions — rodada mais recente (4ª rodada: debugging sistemático do crash persistente)
- Usuário testou o signup de novo no Vercel e viu a mensagem de fallback amigável (não
  mais o crash genérico) — prova de que a correção de código da rodada anterior
  funcionou, mas revelou que a causa raiz real (env var ausente no Vercel) ainda não foi
  resolvida. Usado `/systematic-debugging`: reproduzi o fluxo completo de
  `signUpOrganization` (org → settings → localização → `auth.admin.createUser` → perfil)
  diretamente contra o banco remoto real com a service-role key do `.env` — todos os
  passos funcionaram perfeitamente, o que descarta schema desatualizado ou chave
  inválida e isola a causa no único throw de `createSupabaseAdminClient()`: a env var
  continua ausente/não reaplicada no Vercel.
- Sem acesso ao painel/CLI do Vercel, não dá para confirmar 100% — em vez de adivinhar,
  tornei o erro autodiagnosticável: `MissingEnvVarError` (classe dedicada) distingue
  "servidor mal configurado" de falha transitória, tanto no signup quanto (achado pelo
  review) no login e no middleware, que antes travava *toda* rota com
  `MIDDLEWARE_INVOCATION_FAILED` sem chance de mostrar nada. Adicionado `app/error.tsx`
  como rede de segurança geral para qualquer outra falha não tratada especificamente.
- 3 rodadas de `/code-review high` sobre os commits desta sessão de debugging (uma por
  commit) — a 2ª pegou uma regressão real que eu mesmo introduzi (ver Evidence #8), a 3ª
  veio limpa ("no blocking correctness bugs found"), confirmando que era hora de parar.
- Mesmo teste do usuário expôs que uma organização nova não tinha nenhuma forma de
  adicionar veículo pela interface (só via SQL direto) — maior gap funcional restante.
  Construída a página `/fleet` (fleet manager) para cadastrar localizações, categorias e
  veículos. Testado de ponta a ponta: signup → `/fleet` → adicionar tudo → veículo
  aparece no painel → é recomendado numa solicitação de viagem real.
- Usuário pediu confirmação de senha (só existia 1 campo) + ícone de olho para
  mostrar/ocultar senha, em login e signup — risco real de lockout por erro de
  digitação sem forma de conferir. Componente `PasswordInput` compartilhado entre os
  dois formulários.
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
apps/web/app/fleet/**               → UI de gestão de frota (localização/categoria/
                                       veículo), único caminho antes era SQL direto
apps/web/app/PasswordInput.tsx      → input de senha com toggle mostrar/ocultar,
                                       compartilhado entre /login e /signup
```

## Workstreams — status final desta rodada
- [x] **Correção do crash de signup em produção (gap crítico encontrado pelo usuário)** —
      `SUPABASE_SERVICE_ROLE_KEY` ausente/mal configurada fazia `signUpOrganization`
      lançar um throw não capturado, virando a página de erro genérica do Next.js.
      Corrigido com try/catch (mensagem amigável); erros de criação de conta e de
      login pós-criação agora são reportados separadamente (uma falha depois da conta
      já criada nunca mais diz "não foi possível criar sua conta").
- [x] **UI de gestão de frota (fecha o maior gap restante da rodada anterior)** —
      página `/fleet` (fleet manager/administrator) para cadastrar localizações,
      categorias e veículos sem precisar de SQL direto. `organization_id` sempre
      derivado no servidor a partir do perfil autenticado, nunca do formulário;
      `category_id`/`location_id` validados contra a organização antes do insert
      (FK simples não é suficiente — bypassa RLS). Testado de ponta a ponta e com
      tentativas deliberadas de bypass (ver Evidence).
- [x] **Confirmação de senha + mostrar/ocultar** — `PasswordInput` compartilhado entre
      `/login` e `/signup`; signup exige dois campos coincidentes (client e server-side),
      botão de submit desabilitado enquanto não coincidem.
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
- Migrations 0006-0009 aplicadas sem erro em local e remoto. Esta rodada não criou
  migration nova — `/fleet` usa só as policies RLS já existentes desde a 0001.
- Cross-tenant RLS test (18/18) re-executado com o schema completo (notificações,
  localizações, configurações, frota) — ainda zero vazamentos.
- Code review (`/code-review high`) rodado **três vezes** ao longo da sessão sobre o
  código novo, com verificação independente de cada achado antes de confiar — ver
  Evidence.
- E2E real via Playwright: cadastro de organização nova, sino de notificação com
  conteúdo real, configurações salvando e validando no servidor, checklist de retorno
  atualizando a localização do veículo no banco, e nesta rodada o fluxo completo
  signup → `/fleet` (localização + categoria + veículo) → painel → solicitação de
  viagem real recomendando o veículo recém-criado — tudo verificado contra local e
  novamente contra o Supabase remoto real. Também testadas deliberadamente duas
  tentativas de bypass (nível de combustível 150% contornando o `max` do HTML5;
  `category_id` de UUID forjado injetado via JS) — ambas rejeitadas pelo servidor com
  mensagem amigável, nenhum veículo criado.

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

## Evidence — achados do 3º Blind Critic desta sessão (4 agentes em paralelo — 2 confirmaram achados que eu já tinha levantado sozinho, 1 achado novo confirmado, 1 refutado com evidência)
1. **Bug real (P1, self-encontrado antes do review)**: `signUpOrganization` usa o
   cliente service-role, que lança throw (não retorna erro tipado) quando sua própria
   env var está mal configurada — exatamente o crash que o usuário viu em produção.
   Corrigido com try/catch dedicado; verificado reproduzindo o erro localmente sem a
   env var e confirmando o texto idêntico ao relatado.
2. **Bug real (P2, self-encontrado, confirmado pelo review)**: `runFleetAction` no
   dashboard engolia qualquer erro de RPC sem feedback nenhum — um clique rejeitado
   (aprovação em corrida, veículo já reclamado) parecia funcionar mas não fazia nada.
   Corrigido: redireciona para `/dashboard?fleetActionError=1`, que renderiza um banner
   visível; mensagem genérica de propósito (o erro bruto do Postgres não é adequado
   para exibição).
3. **Bug real (P2, encontrado pelo review, confirmado independentemente)**: nível de
   combustível/bateria em `createVehicle` não tinha validação de servidor — só o
   `min`/`max` do HTML5 no navegador. Um formulário adulterado (ou POST direto) com
   valor fora de 0-100 chegava até a constraint CHECK do Postgres e vazava a mensagem
   de erro bruta do banco para o gestor de frota. Corrigido: validação espelhando a
   constraint, com mensagem amigável. Verificado via Playwright removendo o atributo
   `max` por JS antes de submeter (simulando bypass real) — servidor rejeitou.
4. **Bug real (P2, encontrado pelo review)**: `signUp`'s catch original envolvia tanto
   a criação da conta quanto o login pós-criação no mesmo bloco — uma falha
   inesperada *depois* que organização/usuário/perfil já existiam (ex.: erro
   transitório no `signInWithPassword`) reportava "não foi possível criar sua conta",
   quando na verdade a conta existia e o usuário só precisava logar manualmente.
   Corrigido: dois try/catch separados, cada um com sua mensagem correta.
5. **Bug real (P3, encontrado pelo review)**: `VehicleForm` resetava o formulário
   nativo (`form.reset()`) após sucesso, mas `energyType` é estado React controlado —
   ficava "preso" no último valor selecionado (ex.: BEV), mantendo o campo de bateria
   visível mesmo com o resto do formulário limpo. Corrigido: `setEnergyType("ICE")`
   junto do reset.
6. **Hipótese refutada com evidência (não é bug)**: cogitou-se que o try/catch do
   signup pudesse rotular incorretamente uma falha de rede transitória no
   `signInWithPassword` como "erro de conta". Investigação do código-fonte real do
   `@supabase/auth-js` instalado mostrou que falhas de rede já são convertidas em
   `AuthError` tipado internamente pelo SDK (nunca chegam como throw), e o único outro
   caminho de throw (listener de `onAuthStateChange`) já é protegido por um try/catch
   no `setAll` de cookies deste projeto. Nenhuma correção necessária para este caso —
   mas o fix #4 acima (separar os dois try/catch) permanece correto por si só, como
   defesa em profundidade.
7. **Bug real (P1, self-encontrado antes do review, o mais sério desta rodada)**:
   `category_id`/`location_id` em `createVehicle` são FKs simples (0001) sem checagem
   de organização — FK no Postgres ignora RLS, então um formulário adulterado podia
   gravar num veículo da própria organização uma referência a categoria/localização
   de *outra* organização. Corrigido: validação explícita contra `organization_id`
   antes do insert, mesmo padrão já usado em 0006/0008 para `current_location_id`.
   Verificado via Playwright injetando um `category_id` forjado por JS — servidor
   rejeitou, nenhum veículo criado. Padrão fácil de esquecer se um novo insert direto
   for adicionado no futuro sem repetir esta checagem.

## Evidence — 4ª rodada (debugging do crash persistente + 3 rounds de review em cadeia)
1. **Diagnóstico (não é bug de código, é config)**: reprodução direta contra o Supabase
   remoto real (service-role key do `.env`, replicando `signUpOrganization` passo a
   passo) confirmou que banco/schema/chave estão corretos — a causa mais provável do
   crash que o usuário ainda vê é `SUPABASE_SERVICE_ROLE_KEY` continuar ausente (ou não
   reaplicada após redeploy) no projeto Vercel. Não corrigível pelo código; ver Risks.
2. **Bug real (P2, self-encontrado)**: `login/actions.ts` não tinha nenhum try/catch —
   a mesma classe de erro que travava o signup também travaria qualquer tentativa de
   login com a mesma configuração ausente. Corrigido com o mesmo padrão do signup.
3. **Bug real (P2, self-encontrado)**: o 2º try/catch do signup (login automático
   pós-criação) não distinguia `MissingEnvVarError` — dizia "faça login normalmente"
   para um erro que faria qualquer tentativa de login falhar do mesmo jeito para sempre.
   Corrigido com mensagem específica ("sua conta foi criada, mas...").
4. **Bug real (P2, self-encontrado)**: middleware travava com `MIDDLEWARE_INVOCATION_FAILED`
   opaco em *toda* rota quando as env vars públicas estavam ausentes — nem sequer
   chegava a uma página capaz de mostrar mensagem nenhuma. Corrigido: middleware deixa a
   requisição passar (sem refresh de sessão) nesse caso específico, delegando para o novo
   `app/error.tsx`.
5. **Achado do review, confirmado por 2 agentes independentes**: os mesmos 7-8 outros
   arquivos de `actions.ts` (dashboard, fleet, settings, notifications, trips, pickup,
   return) continuam sem tratamento específico de `MissingEnvVarError` — hoje caem no
   `app/error.tsx` genérico em vez de uma mensagem específica. Decisão consciente de não
   estender agora: login/signup são os dois pontos de entrada pré-autenticação onde a
   mensagem específica importa mais; os demais já ganharam uma rede de segurança (antes
   não tinham nenhuma). Ver Remaining Work.
6. **Achado do review, refutado com evidência já existente desta sessão**: um agente
   apontou que separar o try/catch de `createSupabaseServerClient()` do de
   `signInWithPassword()` em `login/actions.ts` deixaria uma exceção inesperada do 2º
   escapar sem tratamento. A investigação anterior desta mesma sessão (Evidence #6 da
   3ª rodada) já tinha lido o código-fonte real do `@supabase/auth-js` e mostrado que
   isso não acontece nesta stack — mas juntei os dois em um único try mesmo assim, por
   ser mais simples (não mais seguro) e encerrar a discussão.
7. **Bug real de segurança (P1, encontrado pelo review na 2ª rodada, o mais sério desta
   sessão de debugging)**: a mudança do middleware para "deixar passar" quando faltam
   env vars introduziu um bypass de autenticação real — `trips/new/page.tsx` era a
   ÚNICA página protegida do app que não fazia sua própria checagem de auth (todas as
   outras 7+ fazem `createSupabaseServerClient()` + `redirect("/login")` se `!user`,
   independente do middleware). Antes desta rodada, a mesma configuração ausente
   travava *tudo* (ruim, mas não expunha nada); depois do fail-open, um visitante
   anônimo conseguiria ver o formulário de solicitação de viagem. Corrigido: adicionada
   a mesma checagem de auth que todas as outras páginas já têm. Verificado via
   Playwright: visitante anônimo é redirecionado para `/login`; usuário autenticado
   continua funcionando normalmente.
8. **Padrão confirmado, decisão consciente de não abstrair**: o review (2 rodadas
   separadas) apontou que o par "try/catch + `isMissingEnvVarError`" está duplicado em
   4 lugares (login, 2× signup, middleware) sem um helper compartilhado. Avaliado e
   descartado por ora: cada site tem uma estratégia de recuperação genuinamente
   diferente (retornar erro tipado vs. deixar passar a requisição) e mensagem própria
   ao contexto — um wrapper genérico ficaria mais complexo do que as poucas linhas
   repetidas que existem hoje. Revisar se um 5º call site repetir o padrão.

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
  organização (ver Evidence da rodada anterior) — aceito, documentado, não corrigido.
- Signup não valida se o e-mail realmente pertence a quem está criando a conta (ver
  Assumption acima).
- Regras de rodízio de SP ainda não validadas contra fonte oficial (herdado de rodadas
  anteriores).
- **Passo manual pendente do usuário, ainda não resolvido após 2 rodadas**:
  `SUPABASE_SERVICE_ROLE_KEY` precisa estar nas variáveis de ambiente do projeto Vercel
  (tipo "Config", igual às outras duas) **e o projeto precisa ser redeployado depois**
  — sem isso, o cadastro continua impossível em produção, agora com uma mensagem que diz
  exatamente isso ("avise o administrador do sistema — variável de ambiente ausente")
  em vez do crash genérico anterior. Não corrigível pelo código; só o usuário tem acesso
  ao painel do Vercel para confirmar/corrigir.
- Ações de fleet manager no painel (`runFleetAction`) agora mostram um banner genérico
  em caso de falha, mas ainda sem `useActionState`/mensagem específica por ação —
  suficiente para não parecer que o clique não fez nada, mas não diz *por que* falhou.
- 7-8 arquivos de `actions.ts` (dashboard, fleet, settings, notifications, trips,
  pickup, return) ainda não têm tratamento específico de `MissingEnvVarError` — caem no
  `app/error.tsx` genérico em vez de uma mensagem "avise o administrador" específica.
  Rede de segurança já existe (antes não existia nenhuma); mensagem específica é
  melhoria, não correção de bug. Ver Evidence #5 da 4ª rodada.

## Human Gates
Nenhum pendente além dos já conhecidos.

## Remaining Work
1. Fluxo de convite de novos usuários para uma organização existente (hoje só o
   `/signup` cria usuários, sempre como fundador de uma organização nova).
2. Fechar o risco de spoofing de notificação — provavelmente exige revisar o modelo de
   segurança das 4 RPCs afetadas com mais cuidado do que uma correção rápida permite.
3. Validar a tabela de rodízio de SP contra a fonte oficial (CET-SP).
4. Confirmação de e-mail real no signup, se o produto vier a ser exposto publicamente.
5. Extrair o helper `requireFleetManager`/checagem de papel — hoje duplicado em
   `dashboard/page.tsx`, `analytics/page.tsx`, `settings/page.tsx`, `settings/actions.ts`
   e agora `fleet/page.tsx`/`fleet/actions.ts`. Puramente manutenibilidade, não é bug.
6. Ações de fleet manager no painel (aprovar, bloquear, trocar veículo) ainda não têm
   mensagem de erro específica por ação — só o banner genérico (ver Risks).
7. Estender o tratamento específico de `MissingEnvVarError` (mensagem "avise o
   administrador" em vez do `app/error.tsx` genérico) aos 7-8 `actions.ts` restantes,
   se/quando isso importar na prática — ver Evidence #5 e #8 da 4ª rodada sobre por que
   não foi feito agora.
