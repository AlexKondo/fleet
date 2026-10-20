# Verificação anterior à atualização

O repositório contém uma limpeza histórica autorizada em setembro, `0028_wipe_all_data.sql`. Essa autorização antiga não permite executá-la novamente contra os dados atuais. Nenhum banco foi alterado nesta verificação.

No SQL Editor do ambiente correto, executar somente a consulta de leitura abaixo e salvar o array JSON retornado em `applied-versions.json`. O resultado contém versões, sem dados pessoais ou credenciais:

```sql
select coalesce(json_agg(version order by version), '[]'::json)
from supabase_migrations.schema_migrations;
```

```sh
pnpm migration:preflight --history /caminho/applied-versions.json
pnpm test:deployment
```

O programa não conecta ao banco nem executa SQL. Código de saída 0 significa apenas que o plano não encontrou os bloqueios estáticos verificados; 2 exige revisão de histórico desconhecido, lacunas ou SQL potencialmente destrutivo/procedural; 1 indica entrada inválida. Ausência de histórico não equivale a banco vazio. Um array vazio deve representar um histórico efetivamente consultado e dispara revisão das migrações antigas.

O scanner é conservador, não é um analisador completo de PostgreSQL nem prova de segurança de funções dinâmicas, permissões, Storage ou serviços externos. Blocos DO exigem revisão manual. Confirmar backup recuperável, integridade e ambiente antes de qualquer atualização. Não executar reset, limpeza histórica, reparo de ledger ou seed destrutivo para contornar divergências.

Sem acesso ao histórico do ambiente real, o planejamento de sua atualização permanece não verificado. Essa pendência não impede continuar o desenvolvimento isolado.
