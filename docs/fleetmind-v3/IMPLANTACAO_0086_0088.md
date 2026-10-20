# Publicação coordenada — 0086–0088 e 0090

Aplicação real não executada. Conferir a HEAD, o ledger e o backup do ambiente antes de qualquer alteração. O banco embarcado dos testes não é o ambiente de homologação e não fornece o ledger real.

| Arquivo ativo | Dependência e efeito |
|---|---|
| 0086_incident_cases.sql | Depende das estruturas e guards anteriores até 0085. Cria ocorrências, eventos preservados e RPCs com escopo por veículo/unidade. Não migra relatos antigos automaticamente para casos nem modifica evidências/bloqueios. |
| 0087_closed_order_adjustments.sql | Depende da política 0082 e das fontes de 0085. Cria ajustes financeiros e envolve snapshot/prontuário existentes; funções anteriores ficam privadas. Aprovação independente segue a política vigente da unidade. Linhas virtuais de ajuste aprovadas entram no snapshot; créditos exigem a versão corrigida de `lineTotal` do frontend. |
| 0088_scoped_dimensions_and_personal_export.sql | Cria dimensão gerencial de unidade e exportação estruturada do titular. O loader de caronas depende desta dimensão e falha explicitamente se a RPC não estiver disponível. Não inclui binários no JSON. |

**0090_security_definer_resolution.sql** corrige o sombreamento das tabelas de autorização por relações temporárias. Remove CREATE no schema público de PUBLIC/anon/authenticated e configura as funções SECURITY DEFINER da aplicação (exceto funções pertencentes a extensões) com `pg_catalog, public, extensions, auth, storage, pg_temp`. Não modifica registros operacionais nem regras de negócio. A migração usa catálogo/ALTER FUNCTION e precisa de execução pela identidade proprietária/privilegiada adequada; revisar os schemas confiáveis no ambiente real. Não pular esta correção ao publicar.

Ordem: 0086, 0087, 0088, 0090 após confirmar que as anteriores estão efetivamente aplicadas. Não reaplicar arquivos já registrados nem alterar manualmente o ledger para contornar conflito. Publicar essas funções e o código correspondente de modo coordenado; não usar ajustes financeiros com frontend antigo que arredonda créditos incorretamente.

`supabase/pending/0089_recurring_carpool_plans.sql` **não integra a implantação**. Não mover para migrations sem concluir interface, integração, testes e revisão da numeração contra o ledger real.

## Conferência de leitura após publicação no ambiente de homologação

```sql
select to_regprocedure('public.fm_incident_workspace()') as incidents,
       to_regprocedure('public.fm_order_adjustment_workspace()') as adjustments,
       to_regprocedure('public.fm_management_unit_dimension()') as units,
       to_regprocedure('public.fm_export_my_data()') as personal_export;
```

Existência de função não prova permissão nem funcionamento. Usar contas de homologação para conferir: gestor de uma unidade não acessa outra; autor não aprova ajuste próprio; superior designado aprova apenas o que lhe cabe; exportação não aceita sujeito de terceiro; funções `*_before_adjustments` não são executáveis por `authenticated`.

Seguir o roteiro integrado existente e as pendências do relatório de validação. Não repetir todos os testes unitários se o merge não alterou aqueles arquivos. Alterações no merge, falhas ou diferenças de configuração justificam regressão focal.

Reversão exige planejamento preservando dados: não apagar novas tabelas ou eventos para voltar ao frontend anterior. Suspender uso das novas funções e revisar a compatibilidade dos snapshots/ajustes antes de reverter uma versão. Não há rollback destrutivo automático incluído.

Funções privilegiadas criadas futuramente devem declarar o mesmo caminho seguro ou usar referências totalmente qualificadas. A 0090 protege as funções existentes no momento da execução; não é um mecanismo automático para novas funções. Não restaurar CREATE no schema público nem usar `public` sozinho para contornar erro de instalação.
