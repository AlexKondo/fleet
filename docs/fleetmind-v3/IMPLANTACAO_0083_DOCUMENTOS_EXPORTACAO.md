# Documentos operacionais e prontuário exportável — 0083

Implementado localmente em 19/10/2026. Sem implantação real.

## Conteúdo
`/documents?target=vehicle|work_order|energy_event&id=UUID` permite anexar documentos a veículo, OS e lançamento de abastecimento/recarga. Links integrados ao prontuário, OS, fila de aprovação e energia. Arquivos privados em bucket próprio, limite de 5 MiB e formatos PDF/JPEG/PNG/WebP. Aplicação verifica assinatura dos bytes, tamanho e SHA-256. Downloads autenticados verificam novamente o hash e servem como anexo, sem cache.

Upload é registrado antes da transferência, finalizado somente com objeto e metadados correspondentes e pode ser retomado com o mesmo arquivo e a mesma chave. Falhas de transferência não são apresentadas como documento concluído. Objetos e identidade documental não podem ser substituídos ou excluídos pela sessão autenticada. Anulação guarda justificativa, ator e versão; arquivo e histórico permanecem acessíveis no escopo autorizado.

Gestor obedece unidade-base e escopo; Manutenção mantém seu acesso operacional aos documentos de veículo/OS. Superior com atribuição restrita acessa somente documentos da categoria Orçamento das OS pendentes autorizadas para ele, sem upload de documentos nem acesso a notas fiscais ou prontuário geral. Mudanças de autorização são verificadas nas operações e no download.

`/api/exports/vehicle/UUID` exporta CSV UTF-8 com BOM e separador ponto-e-vírgula; `?format=json` exporta dados estruturados. Inclui identidade, OS, linhas planejadas/executadas, garantia, anulações, aprovações e metadados documentais. 0085 acrescenta arquivo e contratos de equipamentos. Energia fica ausente de forma explícita para perfis sem esse acesso. Textos com aparência de fórmula são neutralizados no CSV. Não há cálculos de emissões ou economia inventados.

## Implantação
Bucket privado com limite e MIME configurados pela migração. Publicar com frontend, conferir ledger/backup/preflight e executar apenas migrações pendentes. Não executar reset/0028. Preservar objetos pendentes até a análise administrativa; esta etapa não cria purga automática.

## Verificação e limites
Testes SQL de escopo, finalização, idempotência, arquivo imutável, anulação e superior restrito; testes de assinatura/hash, CSV e rotas autenticadas. O scaffold embarcado simula `storage.objects.metadata`; isso não comprova funcionamento do Storage HTTP real. É indispensável homologar upload/download de bytes no Supabase de homologação, com os perfis e formatos previstos.
