# Fleet — GWM Intelligent Fleet & Corporate Mobility Platform

SaaS multi-tenant de gestão inteligente de frota corporativa. Especificação completa em
[`fleet-car-saas.txt`](./fleet-car-saas.txt); contrato de arquitetura, decisões e progresso
em [`.workbench/king-kondo.md`](./.workbench/king-kondo.md).

## Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Web**: Next.js 15 (App Router) + TypeScript + Tailwind v4 — [`apps/web`](./apps/web)
- **Domínio**: TypeScript puro, sem framework — [`packages/domain`](./packages/domain)
  (availability/reservation, Trip-Specific Readiness, Mobility Decision Engine)
- **Banco**: Supabase (Postgres + Auth + RLS) — [`supabase/`](./supabase)

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
`colaborador@gwm-demo.local` (employee), `portaria@gwm-demo.local` (security).

## Comandos

```bash
pnpm test        # testes do domínio (vitest)
pnpm typecheck    # typecheck de todos os pacotes
pnpm dev          # apps/web em modo desenvolvimento
```
