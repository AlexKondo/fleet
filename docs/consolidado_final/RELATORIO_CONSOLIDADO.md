# FleetMind v3.0 — consolidação corretiva após c6b26da

Data: 22/10/2026. Base efetivamente utilizada: FleetMind_ENTREGA_FINAL_GPT_c6b26da.zip, recebido do Kondo. Os commits 0f1dc12/c6b26da são os declarados na entrega recebida; o ZIP não contém .git. Não houve consulta à produção, alteração de banco remoto, deploy, cancelamento real, mensagem externa ou chamada real a IA/Google/e-mail.

Esta entrega contém código executável, migrations incrementais, testes, delta e manifesto. Preserva as correções F1/F2, inclusive as migrations 0215/0216 do Kondo. A antiga correção interna que utilizava 0215 para ativação NÃO deve ser aplicada. Aqui a ativação utiliza 0217.

## Falhas, evidência e tratamento

| ID / severidade | Evidência / causa | Código e tratamento | Verificação e limite |
|---|---|---|---|
| Política de vencidas / alta | Pacote anterior desligava uma regra que deve permanecer ativa | Servidor ativo com variável ausente/true; 0217 habilita configurações existentes e default das novas, inclusive org sem linha de settings. Preserva tolerância e a checagem segura 0215 | Testes de política, planejamento e SQL local; nenhuma reserva real foi consultada |
| S3-03 e S3-09 / alta | Middleware e shell bloqueavam navegação não relacionada à condução | Bloqueio de navegação restrito à solicitação de veículo e retirada; passageiro, consulta e trabalho administrativo acessíveis. Comandos de condução continuam com guardas no banco | Matriz de middleware e testes SQL existentes; novo E2E autenticado remoto pendente |
| S1-03 / média | Aprovação aceitava end_at passado | 0218 verifica janela sob lock, preservando ordem veículo → reserva | SQL local rejeita sem alterar estado |
| S1-07/08 / privacidade e integridade | Leitura de notas internas e criação arbitrária de tarefas | 0218 restringe leitura a gestão no escopo/manutenção e revoga criação/exclusão direta. 0225 mantém atribuição pelo dashboard via comando auditado; 0226 contrai UPDATE direto depois do app | SQL local confirma negativas, leitura autorizada e atribuição legítima. Disponibilidade continua por vehicles, não por notas internas |
| S1-01 / auditabilidade | Gestão alterava medições sem registro e podia reduzir odômetro silenciosamente | 0220 disponibiliza fm_update_vehicle com whitelist de campos, validação de organização/unidade, auditoria antes/depois e motivo obrigatório para redução. Formulário preservado com justificativa contextual. 0223 remove UPDATE direto das medições | SQL local cobre escrita direta negada, redução sem motivo negada, correção auditada, papel negado e payload operacional negado |
| S2-D02 / média | Foto 8,6 MB atravessava action menor que a interface prometia | Arquivos de fotos da Frota, checklists, portaria e evidências enviados diretamente ao Storage privado, com RLS. Rotas do app recebem só JSON pequeno; servidor baixa bytes e verifica hash/assinatura/tamanho antes da atestação. Frota volta ao teto de 10 MB por foto | Teste de transporte com 8,6 MB e mocks; ainda NÃO validado contra Storage/Vercel remotos |
| S2-D03 / baixa | Uploads simultâneos geravam conflito e download prematuro | Envio sequencial no checklist; conflito não sobrescreve objeto; conclusão tenta leitura novamente com espera limitada e permanece retentável em falha | Testes de conflito e leitura transitória; concorrência com Storage real precisa ser repetida no novo fluxo |
| S2-D04 / baixa | A → B → A retornava sucesso sem restaurar referência | 0227 permite selecionar novamente foto de veículo já vinculada, com autorização, integridade e auditoria. Evidência de inspeção vinculada continua imutável | SQL local confirma seleção anterior e preservação do jornal |
| S2-D05 / baixa | Tentativa corrompida ocupava caminho imutável e não tinha tela de recuperação | 0221 conserva caminho anterior em histórico protegido, cria novo caminho apenas para pendência e mantém hash/conteúdo esperado. /account/photos lista somente pendências próprias e permite retomada | SQL local confirma novo caminho, preservação e isolamento. A tela nova não recebeu homologação autenticada |
| S2-D06 / baixa | Atestação não conferia metadata/owner e sobrescrevia primeiro instante | 0219 confere metadados/owner e preserva primeiro instante. Nova assinatura de 6 argumentos vincula prova ao caminho baixado; 0224 torna a assinatura antiga interna | Testes SQL/servidor; tentativa concorrente com caminho diferente é recusada |
| S3-06 / média | Formulário oferecia exceção em custódia que a RPC sempre recusava após retirada | Oculta comando incompatível em key_custody; segue a retirada/devolução/recebimento das chaves existentes. Não inventa “não saiu” após retirada digital | Teste da regra da UI; ampliação da regra de custódia não foi criada por suposição |
| S3-08 / clareza | Reserva encerrada por exceção só dizia Cancelada | 0222 expõe ao solicitante apenas o resultado, sem razão interna. Detalhe e lista mostram “Encerrada: veículo não saiu” | SQL local verifica visibilidade própria e negativa a terceiro |
| S3-12 / funcionalidade | Minhas caronas só tinha participação como passageiro | /carpool/mine acrescenta visão das ofertas próprias como motorista e acesso à reserva; mantém a visão de passageiro, os comandos e a correção de passageiros F2 | Verificação estática, tipos/build. Navegação por seções; confronto com a arte aprovada ainda pendente |

Os P1/P2 que F1/F2 já corrigiram não foram descartados: checagem única de veículo seguro 0215, bloqueio de INSERT direto de inspection_photos 0216, passageiros confirmados do anfitrião, busca fechada em falha dos pontos, hidratação, aviso persistente, checkbox e filtro de arquivados permanecem no código. As migrations recebidas até 0216 foram preservadas byte a byte. A regra de orçamento configurável por unidade/superior autorizado não foi alterada.

## Fotos: invariantes e sequência

A conta cria o jornal sob a própria sessão; o navegador envia bytes ao bucket privado com upsert:false. A conclusão lê o jornal autorizado, baixa o objeto, verifica bytes e chama a atestação exclusivamente no servidor. O caminho baixado é passado à função e comparado sob lock: um restart concorrente não permite atestar um objeto diferente. A finalização usa a sessão do usuário e volta a conferir autorização.

A nova assinatura de atestação é uma dependência real do código. Seu EXPAND deve preceder o app. Revogar a assinatura antiga antes de todos os escritores usarem a nova quebra uploads; por isso há CONTRACT separado. A recuperação nunca apaga a tentativa antiga. Seleção de foto cadastral não modifica bytes de evidências. Criação de veículo retém o ID quando a foto falha, evitando duplicação no reenvio; as mensagens explicitam a conclusão parcial.

## Decisões preservadas

Liberação automática ativa é decisão confirmada; false é suspensão excepcional, rejeitada pelo preflight de operação normal. Tolerância de 60 minutos consta no relato do Kondo e é preservada, não redefinida nem considerada uma nova aprovação formal. CNH regular é exigida para dirigir, não para navegar como passageiro ou exercer atividade administrativa. Redução de odômetro exige correção justificada e auditada. Não foram adicionadas permissões para visualizar fotos de outras pessoas.

As 28 telas permanecem aprovadas no histórico do usuário. O fato de o checkout conter apenas três referências definitivas localizáveis NÃO transforma as outras 25 em telas sem aprovação. Corrigimos essa interpretação nesta orientação, preservando os relatórios históricos como recebidos. Faltam referências e confronto visual completo, portanto não há declaração de fidelidade ou homologação.

## Pendências efetivas / NO-GO

1. Novo fluxo de fotos: testar com Auth/Storage reais isolados, cookies, CORS, owner/metadados, 8,6/10 MB, concorrência, queda de rede, memória e tempo de execução. Testes unitários não equivalem a essa integração.
2. CNH: código de preparação local implementado, com entrada de até 5 MB e envio máximo de 3 MiB. PDF maior é renderizado por inteiro no navegador; arquivos pequenos são preservados. Falha segura para documento complexo ou não convertível. Falta validar legibilidade/OCR reais, dispositivos e limites na hospedagem isolada; nenhum documento passa a ser armazenado.
3. Homologação remota, pooler/Realtime, rollback real ensaiado, reconciliação do ledger, backups/recuperação, IA/voz/OCR/Google/e-mail reais permanecem não verificados nesta execução.
4. Confrontar as 28 telas autenticadas com todas as artes e avaliar a apresentação de motorista/passageiro. As correções novas não receberam o E2E de 468 navegações do Kondo: aquele resultado pertence à base recebida.
5. Regularização de documentação e de veículos legados retidos em manutenção sem tarefa aberta continua uma pendência operacional relatada por F1. Não há comando novo que libere veículo inseguro nem escrita ad hoc recomendada.

GO atual: revisão e integração LOCAL do pacote. NO-GO para produção. Um pacote único de correções não é uma declaração de que todos os riscos ou funcionalidades da plataforma estão homologados.


## Correção incremental — validade da CNH

A confirmação da leitura da CNH agora reutiliza `canDrive` para comparar a data civil de Brasília. A comparação anterior com meia-noite UTC podia negar a autorização durante o próprio dia de validade. Não altera permissões administrativas nem permite condução após o vencimento. Verificação pontual: 14 testes do módulo de confirmação, incluindo os instantes imediatamente antes e depois da meia-noite de Brasília, passaram. São 2 cenários novos; os outros 12 se sobrepõem à suíte anterior. A pendência de transporte foi tratada no incremento seguinte descrito abaixo; não houve retenção nova de documentos nem chamada à IA real.


## Incremento — transporte da CNH e leitura conservadora

Implementado `prepareLicenseDocument`: aceita a entrada existente de até 5 MiB, preserva originais de até 3 MiB e prepara imagens/PDFs maiores somente na memória do navegador. PDF usa worker e fontes locais; todas as páginas são renderizadas. Não há recorte, descarte silencioso de páginas, CDN nem armazenamento de documento. Limites de complexidade (8 páginas, 24 milhões de pixels, dimensão máxima de 16.000 pixels) retornam orientação amigável, mantendo o original selecionado. A codificação JPEG mantém a resolução, reduz qualidade até um limite fixo e recusa resultado ainda maior que 3 MiB. Legibilidade documental não é inferida desses limites: conferir o resultado lido na revisão existente e homologar OCR real. A preparação também falha com mensagem amigável em navegador incompatível ou PDF protegido.

A análise não troca mais automaticamente emissão e validade quando a IA produz datas contraditórias: rejeita a leitura para nova tentativa. Datas inexistentes e tipos incorretos também são rejeitados. Não modifica uma data válida nem remove a confirmação humana.

Verificações pontuais: 29 testes em três módulos (14 confirmação, 6 preparação com mocks, 9 validação da leitura), tipagem e compilação. Os testes de mocks não provam funcionamento de IA, câmera, Storage, Supabase ou hospedagem remota. Ver logs específicos `license-transport-tests.log`, `types-license-transport.log`, `build-license-transport.log`. Não repetir a suíte completa apenas por esta mudança localizada; Kondo deve validar os cenários atingidos na homologação isolada.


Smoke em Chromium local com fixtures sintéticas: PDF de 3.147.592 bytes / duas páginas convertido para JPEG de 91.499 bytes com 1.697 × 4.800 pixels; PNG de 3.251.348 bytes convertido para 44.177 bytes. Sem erro de página. Worker e fontes servidos localmente. Isso confirma conversão e dimensões, não equivale à homologação visual ou OCR real. Evidência: `license-browser.log`.


## Fechamento de segurança do transporte

FOTO-BOUND-01 / média: leitura integral do JSON antes do limite permitia alocação acima do pequeno contrato da API. Corrigido com limite incremental de 4096 bytes e cancelamento do stream, sem confiar no Content-Length; erros de leitura retornam 400 sem detalhes internos. Evidência: teste de UTF-8 em chunks sem Content-Length e interrupção de leitura.

FOTO-BOUND-02 / baixa: a verificação alocava bytes do objeto antes de comparar tamanho. Corrigido com recusa pelo tamanho do Blob antes de arrayBuffer/hash/atestação. Evidência: teste confirma que arrayBuffer e atestação não são chamados para objeto incompatível.

FOTO-RECOVERY-01 / baixa: cálculo de hash no reenvio ocorria fora de try/catch; erro de leitura do arquivo podia escapar da mensagem da tela. Corrigido com validação de formato/tamanho antes da leitura e captura do fluxo completo. Verificação: revisão de código, tipagem/lint/build; erro real de dispositivo não foi simulado no navegador.

O fechamento incremental executou 46 testes focais nos seis módulos atingidos, sem repetir toda a suíte do checkpoint anterior. Ver TESTES.md para sobreposições. Correções executáveis dos achados disponíveis estão consolidadas; testes integrados, referências visuais ausentes e infraestrutura continuam pendentes, sem declaração de homologação.


RESERVATION-MSG-01 / baixa: a negativa por reserva já vencida usava aviso genérico no dashboard. Agora somente os códigos públicos permitidos atravessam o redirect; RESERVATION_EXPIRED tem texto específico nos quatro idiomas, com orientação de nova reserva. Erros desconhecidos mantêm aviso genérico e detalhes apenas no servidor. Quatro testes focais verificam a lista permitida e o descarte de mensagens internas. Sem mudança de layout ou regra de aprovação.
