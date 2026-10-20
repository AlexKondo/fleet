# Integração segura do Pacote 01

## Ordem e limites
1. Trabalhar em branch/cópia isolada do checkout **atual** do Kondo. Preservar commit, diff e arquivos não rastreados. Este ZIP é a fonte candidata, não uma imagem autoritativa do checkout.
2. Validar `MANIFEST_SHA256.txt`/`docs/fleetmind-v3/SOURCE_MANIFEST.json`. Rodar somente o comparador, que não escreve: `python3 scripts/package01_review.py /caminho/do/checkout`. Revisar especialmente `manual_merge_preserve_kondo`. Nunca substituir arquivos de CNH, FmShell/robô, CarpoolSearch, i18n, ações locais, UserRow e tipos por versões antigas.
3. Manter intactas `0074_license_expiration_source.sql` e `0075_ai_license_lock.sql` do Kondo. Elas estão ausentes deste snapshot, não revogadas. Não reaplicar as antigas migrations destrutivas só porque o ledger está incompleto. Não executar repair automático.
4. Faixa candidata: 0174–0188 em ordem; 0189 reservada/rascunho excluído; 0191 evidências/disponibilidade; 0192 hardening explícito das 44 funções presentes; 0193 notificações; 0194 ordem de locks. 0089 continua fora da cadeia. **0090 antiga está substituída e bloqueada em migrations-pending.** P01D original é referência de snapshot: exige ajuste de precondições após a cadeia e revisão das funções Kondo, não executar cegamente o candidato/rollback.
5. Em clone isolado, conferir schema/owners/ACLs, origem IA/manual e trigger de antifraude; executar `scripts/package01_preflight.sql` quando autorizado. Não há criação simulada das três funções Kondo nem hashes presumidos delas.
6. Antes de ativar o frontend, testar configuração das unidades, escopos explícitos dos gestores e perfis reais de equipamentos. Promover gestor não concede all_units silenciosamente; atribuir escopo pela configuração administrativa existente. Banco e frontend dependem um do outro.
7. Integrar apenas correções compatíveis, resolver divergências sem apagar melhorias locais e rodar os testes abaixo. Executar testes de Auth/Storage/concorrência em Supabase isolado. Produção e deploy exigem processo separado; não são autorizados nesta entrega.

## Execução local reproduzível
Requisitos: Node >=20, pnpm compatível com packageManager, dependências do lockfile. `pnpm install --frozen-lockfile` na cópia isolada. A execução realizada aqui reutilizou dependências existentes.

Na raiz: `node --test scripts/migration-preflight.test.mjs` e `python3 -m unittest discover -s scripts -p test_compare_kondo_source.py`.

Em apps/web:
```
node node_modules/vitest/vitest.mjs run lib/operations/package01.test.ts lib/domain/immutablePhoto.test.ts lib/auth/drivingValidity.test.ts lib/operations/managerScope.test.ts lib/operations/inspectionFlow.test.ts lib/operations/keyCustody.test.ts lib/operations/maintenanceApproval.test.ts lib/supabase/middleware.test.ts lib/supabase/managementLicenseBoundary.test.ts app/trips/new/actions.test.ts lib/equipment lib/operations/fleetLifecycle.test.ts lib/operations/financialAdjustments.test.ts lib/operations/incidentCases.test.ts lib/operations/migrationChain.test.ts lib/operations/database.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next lint
node node_modules/next/dist/bin/next build
```
O helper de testes cria banco PGlite em memória e aplica SQL local; não recebe URL nem credencial de produção.

## Readiness no clone após schema existir — somente SELECT
```
select v.id from vehicles v where v.archived_at is null
 and not coalesce((fm_equipment_effective(v.id)->>'configured')::boolean,false);
select p.id from profiles p where p.role='fleet_manager'
 and not exists(select 1 from fm_manager_scopes s where s.user_id=p.id);
select v.id from vehicles v where v.archived_at is null
 and not exists(select 1 from fm_vehicle_units b where b.vehicle_id=v.id);
```
São consultas de diagnóstico; não cadastrar unidades/perfis genéricos automaticamente. Resolver configuração real antes da ativação.

## Recuperação e rollback
- Foto com falha: o titular consulta `fm_photo_pending()` e reenvia o mesmo arquivo. begin devolve o mesmo caminho; bytes existentes são verificados; finalize liga uma única vez. Se os bytes originais não estiverem disponíveis, manter o registro em revisão e fazer recuperação assistida no clone; nunca apagar originais para liberar retry.
- Veículo criado com foto incompleta: a ação informa sucesso parcial do cadastro e orienta editar esse veículo, evitando repetir criação.
- Migrações de preservação/contrato não têm rollback destrutivo automático. Em teste isolado, descartar/restaurar o clone é a reversão segura. Em integração futura, capturar definitions/proconfig/ACLs reais antes de alterar funções e preferir correção forward. Não restaurar genericamente search_path inseguro nem excluir histórico/evidências.
- Se código/schema divergirem: interromper a ativação e manter a versão anterior em uso; não executar migrations corretivas em produção a partir deste relatório.

Documento de referência de voz realocado para `docs/references/VOICE_INCREMENTAL_v1.md`, com conteúdo/hash preservados, para evitar a falha de caminho longo no Windows. Mapa em DOCUMENT_PATH_MAP.json.
