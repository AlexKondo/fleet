# Fleet — GWM Intelligent Fleet & Corporate Mobility Platform

SaaS multi-tenant de gestão inteligente de frota corporativa. Especificação completa em
[`fleet-car-saas.txt`](./fleet-car-saas.txt); contrato de arquitetura, decisões e progresso
em [`.workbench/king-kondo.md`](./.workbench/king-kondo.md).

## Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Web**: Next.js 15 (App Router) + TypeScript + Tailwind v4 — [`apps/web`](./apps/web)
- **Domínio**: TypeScript puro, sem framework — [`packages/domain`](./packages/domain)
  (availability/reservation, Trip-Specific Readiness, Carpooling, máquina de estados do
  veículo, checklist → workflow automático, Mobility Decision Engine)
- **Banco**: Supabase (Postgres + Auth + RLS) — [`supabase/`](./supabase)

`apps/web/.env.local` está configurado para o **projeto Supabase real** por padrão. Para
desenvolver contra um banco local descartável (mais rápido para iterar sem risco),
troque as três variáveis pelas impressas por `supabase start` (ver abaixo).

## Setup local

Pré-requisitos: Node 20+, pnpm, Docker Desktop.

```bash
pnpm install
pnpm exec supabase start   # sobe Postgres/Auth/Studio local via Docker
pnpm exec supabase db reset # aplica migrations + supabase/seed.sql
# preencha apps/web/.env.local (mesmas chaves de .env.example) com a URL/anon key
# impressas pelo `supabase start`
pnpm --filter @fleet/web dev
```

Usuários de demonstração (senha `password123`): `gestor@gwm-demo.local` (fleet_manager),
`colaborador@gwm-demo.local` (employee), `portaria@gwm-demo.local` (security). Para uma
organização nova, use **Criar organização** na tela de login (`/signup`) — cria a
organização, as configurações padrão, uma localização inicial e o primeiro usuário como
`administrator`. A organização nasce sem veículos: use **Frota** (`/fleet`, visível para
`fleet_manager`/`administrator`) para cadastrar localizações, categorias e o primeiro
veículo antes de solicitar viagens.

É uma PWA (Progressive Web App): instalável a partir do próprio navegador do celular
("Adicionar à tela de início"), sem app nativo — a captura de foto nos checklists usa a
câmera do aparelho via `<input type="file" capture>` do navegador.

Fluxo operacional para testar manualmente: login como colaborador → **+ Solicitar
Viagem** → confirmar recomendação → login como gestor → aprovar em **Reservas
Aguardando Aprovação** → login como colaborador → **Minhas Viagens** → Iniciar Retirada
→ Registrar Retorno → login como gestor → concluir as tarefas em **Tarefas
Operacionais**.

## Comandos

```bash
pnpm test        # testes do domínio (vitest)
pnpm typecheck    # typecheck de todos os pacotes
pnpm dev          # apps/web em modo desenvolvimento
```

## Teste de isolamento multi-tenant (RLS)

[`supabase/tests/cross-tenant-rls.mjs`](./supabase/tests/cross-tenant-rls.mjs) é um teste
end-to-end real (não uma leitura das políticas) que prova, via chamadas HTTP reais à API do
Supabase com tokens de usuário reais, que as políticas RLS de
[`0001_init_schema.sql`](./supabase/migrations/0001_init_schema.sql),
[`0002_operational_cycle.sql`](./supabase/migrations/0002_operational_cycle.sql) e
[`0003_trip_request_flow.sql`](./supabase/migrations/0003_trip_request_flow.sql) realmente
isolam os tenants. Ele cria uma segunda organização descartável ("Test Tenant B") com seu
próprio usuário `employee`, faz login real como esse usuário e como
`colaborador@gwm-demo.local`/`gestor@gwm-demo.local` da organização seedada, e então tenta
ativamente:

- ler veículos/reservas/perfis de outra organização (deve vir vazio, não erro);
- inserir/atualizar dados marcados com o `organization_id` de outra organização (deve ser
  rejeitado ou não ter efeito algum — verificado lendo o estado real do banco, não só o
  status HTTP);
- executar uma ação exclusiva de `fleet_manager` (aprovar reserva, alterar status de
  veículo) logado como `employee` (deve ser rejeitado), com um controle positivo confirmando
  que o mesmo fluxo funciona para quem tem permissão.

O script limpa tudo o que cria (organização, usuário, veículos e reservas de teste) ao final,
inclusive em caso de falha, então é seguro rodar repetidamente contra um banco compartilhado.

Pré-requisito: instância local do Supabase já rodando (`pnpm exec supabase start`), sem
resetar o banco. Para rodar:

```bash
node supabase/tests/cross-tenant-rls.mjs
```

O script usa por padrão a URL/anon key/service role key do ambiente local padrão do
Supabase CLI e o container Docker `supabase_db_fleet` (para o bootstrap/limpeza do usuário de
teste em `auth.users`, que não é exposto via REST). Todos são configuráveis por variável de
ambiente (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DB_CONTAINER`)
caso seu projeto local use nomes/portas diferentes.
