# Gestão de frota por unidade — 19/10/2026

Estado: implementado e testado localmente; não homologado em Supabase real.

## Aplicação
0080 adiciona escopos administrativos, unidades selecionadas, histórico imutável, views de gestão, políticas restritivas e cadastro atômico de veículo/unidade. 0081 reconcilia as funções com a cadeia anterior e aplica escopo a comandos, consultas, documentos e evidências.

O administrador configura `/admin/units`: uma, várias ou todas as unidades, com justificativa e controle de versão. A autorização usa a unidade-base de responsabilidade do veículo, nunca sua localização física atual. A custódia de chaves é independente e não concede gestão; reservas pessoais mantêm seu acesso próprio.

Gestores existentes recebem baseline explícito `all_units` com histórico `legacy_baseline`; novos gestores ficam sem acesso de gestão até designação administrativa. Contas existentes e históricos são preservados. Sem unidade atribuída, veículos são administrados somente por administradores e gestores com abrangência organizacional. O cadastro de novo veículo por gestor limitado exige unidade ativa autorizada, gravada na mesma transação.

## Testes
- Cadeia efetiva em PostgreSQL embarcado com Auth/Storage simulados.
- Escopo único/múltiplo, revogação, isolamento de organização, versões e idempotência.
- RLS de edição direta, comandos de custos, leitura gerencial e evidências.
- Custódia local fora da carteira de gestão e catálogo pessoal de reservas independentes.
- Configuração administrativa renderizada com escopos válidos e indisponíveis.

Suite completa: 611 testes frontend + 252 domínio + 6 preflight = 869, sem falhas. TypeScript, ESLint frontend e build passaram. A inspeção de layout usa fixtures e não equivale a aceite das 28 telas.

## Implantação real
Não aplicar automaticamente. Conferir histórico real, backup e preflight antes de selecionar migrações pendentes. Nunca executar reset ou reaplicar a migração histórica 0028. Nenhum banco real foi acessado ou alterado nesta etapa. 0080 e 0081 formam uma alteração coordenada; testar PostgREST (relações das views), RLS, Auth e Storage reais antes de produção.

## Limites
Múltiplos papéis gerais, políticas avançadas por unidade, anexos/exportações e fidelidade das 28 telas continuam pendentes. Custódia é uma atribuição independente já implementada, não uma alegação de múltiplos papéis completos.

Layout administrativo inspecionado em 1536×1024 e 390×844 com dados de teste: sem rolagem horizontal da página. Não equivale a homologação visual das 28 artes.
