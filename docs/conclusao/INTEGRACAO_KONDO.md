# Integração executável e homologação

1. Criar branch a partir do checkout atualizado do Kondo e guardar commit/backup verificável. Não apontar testes para produção. Extrair este pacote em diretório separado.
2. No pacote executar `python3 scripts/compare_conclusao_source.py /caminho/checkout-kondo > comparacao.json`. O comando é somente leitura e valida hashes. `candidate_change` permite revisar o diff; `keep_kondo` conserva melhoria local; `needs_merge` exige merge manual; `already_equal` é omitido. Não copiar o pacote por cima do checkout. O manifesto compara com o ZIP 0aa2403, não com uma versão presumida do computador do Kondo.
3. Revisar `changes.patch`, matriz de alterações e cinco SQL novos. Não aplicar patch cegamente. Se houver migration 0210–0214 no checkout/banco atual, reservar números novos e atualizar dependências/testes após inspeção; não substituir migration aplicada. Conferir histórico e definições reais por leitura antes de qualquer execução autorizada.
4. Em banco LOCAL ou homologação isolada com Auth/Storage próprios: aplicar 0210, 0211, 0212 e 0213 após conferir 0209 e a cadeia anterior. O ambiente precisa do esquema FleetMind anterior; NÃO reconstruir produção com as antigas migrations de reset. `migration:preflight` é verificação, não autorização para aplicar SQL.
5. Configurar FM_ENABLE_AUTO_RESERVATION_RELEASE=false, manter auto_release_enabled=false em todas as organizações. Configurar apenas segredos de homologação do servidor. Instalar `pnpm install --frozen-lockfile --ignore-scripts` (native canvas/OCR não homologado por esta instalação). Validar os passos específicos dos módulos nativos se utilizados.
6. Integrar o novo código de upload/atestação e demais correções; compilar e executar no ambiente isolado. 0212 é EXPAND compatível; 0214 é CONTRACT e só deve ser aplicada DEPOIS que todas as instâncias escritoras usam o novo código e um upload real confirmou atestação. Caso contrário clientes antigos falharão ao finalizar novas fotos. Nenhuma migração foi aplicada remotamente por esta entrega.
7. Após integração executar os comandos de TESTES.md, depois roteiro abaixo. Registrar evidência com commit/hash, papel, unidade, resultado esperado/obtido. Não registrar segredos ou dados pessoais reais.

## Aceite integrado obrigatório

- Org A/unidade 1, org A/unidade 2 e org B: cada papel autorizado e negado; tentativas diretas de UPDATE operacional e RPC fora do escopo devem falhar sem efeitos. Cadastro permitido continua funcionando. CNH vencida impede condução; tarefas administrativas continuam acessíveis.
- Cron e busca com ambas as flags desligadas: nenhuma reserva cancelada; flag servidor ligada e organização desligada: nenhuma liberação; ativação somente em organização fictícia após aprovação explícita da tolerância e sem atividade. Inspeção/chaves/saída física e veículo inseguro bloqueiam liberação indevida. Concorrência entre aprovação/cancelamento/retirada deve produzir um estado consistente.
- Busca com nome exato, rótulo canônico e endereço comum, destino/origem/horários: candidatos equivalentes, sem expandir política e sem vazar outras unidades. Simular falha Google e falha de leitura dos pontos.
- Saída impedida após início: gestor autorizado encerra como veículo não saiu, com razão, confirmação e auditoria; retry mesmo request_id não duplica efeito. Gestor de outra unidade, solicitante sem autoridade e veículo com saída física não podem usar essa opção. Não confundir com departed_unrecorded.
- São Paulo: dois checklists independentes + saída/chegada física; Campinas: checklist + entrega/recebimento real das chaves. Ninguém recebe confirmação fictícia. Avaria só é liberada pelo comando auditado autorizado. Ver OS/manutenção sem divulgar orçamento/descrição interna para passageiro/condutor.
- Fotos: upload normal, falha, 409/retry, conteúdo adulterado de mesmo tamanho, interrupção após upload e após atestação, sessão expirada; original imutável e jornal recuperável. Links somente aos papéis já aprovados, sem presumir nova permissão de visualização.
- Assistente: chave de IA de homologação, ausência de chave, timeout, intenção ambígua, cancelamento, confirmação humana, troca de idioma, voz/OCR se contratados; nenhum comando operacional sem política e confirmação exigidas.
- Conferir todas as 28 telas nos layouts aprovados em desktop/mobile, incluindo as melhorias locais. Registrar referências ausentes e divergências, não redesenhar por suposição.

## GO / NO-GO

GO somente para revisão/integração local deste código com testes focais aprovados. NO-GO para produção enquanto existir P0/P1 aberto, conflito com checkout atual, diferença não explicada no esquema real, falha de autorização/isolamento/fotos, ausência de backup/recuperação verificados ou falha nos cenários integrados acima. Aceite visual e funcional das 28 telas exige evidência própria; build não o substitui.

Critério de GO futuro: todos os casos críticos acima aprovados no commit integrado, zero falha alta/crítica, migrations revisadas e ledger reconciliado, rollback ensaiado, decisões de política registradas, serviços externos validados e autorização expressa do responsável para deploy. Não é uma autorização dada neste pacote.

Rollback: não reabrir UPDATE direto nem apagar evidências/jornal. Manter 0213 desligada. Priorizar correção adiante. Se for necessário voltar app antigo após 0214, bloquear uploads ou preparar recuperação revisada; não relaxar a exigência de prova silenciosamente. Não usar down migration destrutiva.
