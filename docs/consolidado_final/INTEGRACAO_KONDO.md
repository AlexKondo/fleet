# Integração única sobre a entrega c6b26da

Não copiar o pacote por cima do checkout. Guardar a branch atual e executar `python3 scripts/compare_consolidado_final.py /caminho/checkout-kondo`. O comparador é somente leitura, confere integridade e trata CRLF/LF como equivalentes na classificação. Preserva modificações locais: candidate_change é candidato a revisão; needs_merge exige merge; keep_kondo não deve ser substituído. A base é o ZIP c6b26da efetivamente recebido, não uma suposição sobre o computador do Kondo.

Revisar changes.patch e MATRIZ_ALTERACOES.md. Não reaplicar o pacote sobre 0aa2403 ignorando os commits F1/F2. Não usar a antiga 0215 interna de ativação; a 0215 deste checkout é a checagem segura do Kondo e foi preservada. Se houver numeração 0217–0227 já ocupada, interromper a aplicação e reconciliar nomes/definições sem editar SQL aplicado.

## Ordem EXPAND → código → prova → CONTRACT

`node scripts/print-consolidated-migration-plan.mjs` só imprime o plano; não conecta nem aplica nada.

- Pré-requisito: esquema real correspondente à cadeia anterior, conferido por leitura. Em produção o ledger foi relatado como antigo; reconciliar 0208 e demais aplicações manuais antes de autorizar qualquer implantação. Não executar migrations antigas de reset em banco com dados.
- EXPAND/pré-app: 0210, 0211, 0212, 0213, 0215, **0217, 0218, 0219, 0220, 0221, 0222, 0225**. Aplicar apenas as que faltarem no ambiente ISOLADO. Não terminar a janela depois da 0213 sem a 0217: o estado aprovado é ativo. Nenhuma dessas novas migrations executa a liberação de reservas.
- Código: integrar o app, a API /api/photos, atestação com p_path e os comandos auditados de edição/atribuição. Manter chave privilegiada só no servidor; navegador usa sessão e chave pública, sob RLS. Configurar FM_ENABLE_AUTO_RESERVATION_RELEASE=true; ausência também é ativa, mas false remanescente precisa ser corrigido na configuração efetiva.
- Prova isolada: validar upload real com conteúdo conferido/atestação, criação e edição de veículo, checklist de avaria, portaria, atribuição de tarefa e edição de medições. Confirmar que nenhuma instância escritora antiga permanece.
- CONTRACT: **0214, 0216, 0223, 0224, 0226, 0227**. A 0214 exige prova; 0223 remove escrita direta de medições; 0224 fecha a assinatura antiga de atestação; 0226 fecha UPDATE direto de tarefas. Antecipar esses passos quebra escritores antigos. A reconstrução local em ordem numérica valida sintaxe/estado final, não valida a ordem de um rollout em produção.

Em implantação futura autorizada, preparar janela controlada de escrita para os fluxos afetados e plano de recuperação antes de mudar o esquema. Não realizar deploy nem aplicar SQL remoto com esta instrução: a restrição do usuário permanece.

## Verificações

Instalar `pnpm install --frozen-lockfile --ignore-scripts`; lockfile e dependências preservados. Native canvas/OCR não é homologado por esta instalação. Em apps/web executar tipagem, testes focais e build conforme TESTES.md. Priorizar os cenários integrados atingidos; a suíte completa é opcional quando tecnicamente justificada pelo merge final, sem atribuir testes históricos ao novo código. Não carregar segredos de produção nos testes.

Executar `node scripts/check-auto-release-policy.mjs` com o AMBIENTE EFETIVO de implantação e as consultas somente leitura de check-auto-release-policy.sql; ambas devem passar. O script Node não verifica sozinho o banco nem o agendamento do cron. Uma flag false ou configuração desabilitada é NO-GO para a operação normal aprovada.

## Aceite integrado que falta para o novo delta

- Administrador/gestor sem CNH e colaborador sem CNH: consultar, trabalhar e pedir carona como passageiro; as ações de condução permanecem negadas. Usuário desativado continua sem acesso.
- Tarefas: notas fora do papel/unidade negadas, INSERT e UPDATE diretos negados após CONTRACT, atribuição pelo dashboard auditada, conclusão e avaria independente preservadas.
- Medições: alteração auditada, redução sem justificativa recusada, correção justificada permitida, unidade/organização erradas recusadas. Cadastro e foto continuam funcionando.
- Fotos: 8,6/10 MB sem bytes na requisição da action; múltiplas fotos por checklist; quedas em cada fase; conflito/retry; A → B → A; arquivo adulterado; metadata/owner errados; restart concorrente à atestação; conta errada; pendência retomável e original preservado.
- Vencidas: servidor sem variável/true ativo, default de organização ativo, organização sem settings usa default, atividades impedem cancelamento, documentação/avaria/OS impedem disponibilidade indevida, idempotência e concorrência.
- Exceção: rótulo próprio visível ao solicitante sem revelar motivo interno; nenhuma saída fictícia. Custódia usa fluxo existente de devolução/recebimento.
- Caronas: confirmar passageiros F2, falha de leitura dos pontos fecha busca, visão própria de motorista e passageiro e comandos de oferta na reserva.
- Completar checklist pela UI com equipamentos fictícios configurados no ambiente isolado, depois confronto das 28 telas com as referências aprovadas.

## Recuperação e GO/NO-GO

Não executar os rollbacks históricos que reabrem escrita ampla ou voltam a liberar veículo inseguro. Preferir correção adiante. Antes de reverter app, verificar compatibilidade com contratos já ativados; não remover prova, apagar jornal ou reabrir INSERT como atalho. Ensaiar restauração de backup em ambiente separado e registrar commit, esquema e resultado.

GO futuro somente com zero falha alta/crítica e zero falha média aberta que comprometa segurança de condução, permissões, isolamento, evidências ou os fluxos de aceite, cenários integrados acima aprovados no commit exato, pendência de CNH resolvida, serviços externos/infra/backup/rollback verificados, telas conferidas e autorização expressa de deploy/migrations. Este pacote NÃO concede essa autorização e NÃO considera o FleetMind homologado.

Claude/Kondo deve integrar, executar os cenários afetados e reportar evidências. Não redesenhar telas, flexibilizar permissões ou mudar regras para fazer testes passarem. Qualquer divergência funcional/visual deve voltar ao usuário/GPT para decisão. Não reenviar pacotes antigos isolados: esta é a entrega consolidada sobre c6b26da.


### CNH — casos incrementais para homologação

Publicar os assets locais de `public/pdfjs` e `public/pdf-standard-fonts` junto do código; worker copiado da dependência já travada pdfjs-dist 4.10.38, preservando licença. Quando atualizar a dependência, sincronizar o worker da mesma versão. Nenhuma dependência ou migration nova neste incremento. Conferir PDF/imagem de 3–5 MiB, PDF de várias páginas sem perda, documento protegido/complexo, navegadores móveis sem suporte, falha de IA e reenvio mantendo o original. Comparar campos lidos com documento sintético e manter a confirmação humana. Data contraditória deve retornar leitura ilegível, sem presumir uma nova validade. Verificar na rede que a action recebe arquivo até 3 MiB. Nenhum teste aqui usa CNH real de terceiros.

Os assets binários das fontes em `public/pdf-standard-fonts` são cópias idênticas dos já recebidos em `lib/domain/pdf-standard-fonts`. Integre os arquivos do ZIP completo, conferindo o manifesto; o `changes.patch` textual não recria arquivos binários.
