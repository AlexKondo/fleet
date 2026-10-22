# FleetMind v3.0 — implementação corretiva, 22/10/2026

Base: ZIP 0aa2403 fornecido. Esta entrega contém código corrigido e cinco migrations novas. NÃO representa homologação do produto nem autorização para produção. Nenhuma chamada ao banco de produção, migration remota, limpeza, deploy ou envio de mensagens foi realizada.

## Achados e implementação

| ID / severidade | Evidência e causa | Correção concreta | Limite |
|---|---|---|---|
| FM-01 Alta | Cron e busca chamavam liberação de vencidas sem decisão formal; 0209 não tinha opt-in por organização | flag servidor FM_ENABLE_AUTO_RESERVATION_RELEASE e 0213 com auto_release_enabled=false por organização, inclusive para clientes antigos | Política de tolerância/cancelamento depende de aceite; seis reservas reais não foram consultadas nem alteradas |
| FM-02 Alta | Busca de passageiro geocodificava textos que o motorista resolve como pontos corporativos | mesmo resolvedor de pontos sob RLS, incluindo rótulo canônico nome/endereço; erro de leitura fecha a busca com segurança | Google real não chamado; política de raio/janela preservada |
| FM-03 Alta | Cancelamento comum impede encerrar reserva iniciada; RPC de exceção já existia sem caminho visível | formulário contextual usa fm_operation_exception, resultado fixo not_departed, confirmação explícita, razão e chave idempotente; 0211 preserva documentação/manutenção | Não regulariza saída física nem inventa retorno; testar dois operadores simultâneos em Postgres real |
| FM-04 Alta | UPDATE direto de vehicles permitia alterar avaria/estado; funções invoker precisavam da escrita ampla | 0210 restringe colunas a cadastro, RLS de gestão/unidade, seis rotinas privilegiadas com autorização explícita | SQL local confirma negativas por papéis/colunas; inventariar grants adicionais do banco real |
| FM-05 Alta | Jornal de foto confiava em hash declarado/metadados; bytes após upload bem-sucedido não eram verificados | download + SHA-256 real no servidor; atestação service_role 0212; contrato 0214 exige prova antes de vincular | Evidências antigas preservadas, sem atestação retroativa fictícia; Storage real/limites de memória pendentes |
| FM-06 Média | Navegador local reproduziu mismatch de hidratação com categoria em rascunho sessionStorage | VehicleForm inicia estável e restaura rascunho após montagem; confete determinístico em LicenseCaptureForm | Os 17 avisos históricos de produção não foram reproduzidos integralmente; esta causa não explica necessariamente todos |
| FM-07 Baixa | HTML lang não refletia troca; warning de dependência no ChatWidget; erro CNH genérico nas chaves | lang atualizado após troca, dependência de efeito corrigida, mensagem de CNH expirada explícita | Troca de idioma não testada interativamente; parte do legado de chaves permanece em PT |

## Segurança, banco, APIs e integrações

Verificação estática do código e execução SQL em PGlite são níveis distintos. Os testes locais cobrem organização/unidade, acesso negado, gestão de OS, aprovação financeira, inspeção independente, chaves, CNH, arquivamento, foto imutável e liberação de reservas. Não equivalem a pentest nem a teste de concorrência com conexões independentes no Supabase.

0210 mantém atualização cadastral autorizada e remove UPDATE operacional de authenticated, incluindo grants por coluna. As funções alteradas fixam search_path e validam sessão, organização, papel e escopo antes da mutação. A liberação de avaria continua nos fluxos auditados, não no cadastro. Segurança e manutenção mantêm comandos operacionais permitidos, sem escrita cadastral geral. Inventariar privilégios herdados de outros roles no ambiente real é obrigatório antes da implantação.

0211/0213 não devolvem veículo com documentação irregular, avaria bloqueante ou manutenção em andamento à disponibilidade. A busca não recebe informações internas da OS; a disponibilidade é reavaliada pelo banco. Fluxos de retirada, devolução, portaria e custódia permanecem separados. CNH regular é exigida nos comandos de condução existentes; expiração não remove o acesso administrativo. A política de aprovação de orçamento configurável por unidade e superior autorizado foi preservada, não redefinida.

As rotas cron mantêm autenticação por segredo; reservation-expiry agora verifica desligamento antes de criar cliente privilegiado e não devolve erro SQL bruto. Testes de autenticação dos crons e das rotas geo foram executados localmente com doubles de provedor. APIs de exportação e demais rotas constam no inventário; não houve execução contra serviços externos. Tokens privilegiados permanecem exclusivamente no servidor; nenhum segredo real foi acrescentado.

Fotos: o atestador service_role não é acessível por anon/authenticated. A ação verifica os bytes armazenados e identidade autenticada antes de atestar. Finalização falha mantém o jornal pendente e não remove/substitui evidência anterior; retry usa a mesma identidade. Pendente validar queda de rede entre upload/atestação/finalização, MIME/metadados reais, retomada após sessão expirada e concorrência em Storage isolado. A chave service_role é necessária ao novo caminho do servidor; não enviá-la ao navegador.

Dependências e lockfile preservados; instalação congelada concluída. Não foi obtido inventário atualizado de vulnerabilidades de registry: não há afirmação de ausência de CVEs. Build local usa URL Supabase em loopback e chaves fictícias. Configuração regional, backups, limites e entregabilidade continuam pendências operacionais, sem mudanças remotas.

## Assistente FleetMind

Preservada a reescrita 0aa2403 e a arquitetura de adapters/orquestração. Os 104 casos de noVehicleFlow cobrem respostas claras, alternativas, confirmações, política e falhas com provedor simulado. Liberação automática não ocorre quando desligada; existe opt-in explícito de teste. O widget mantém os acessos existentes e recebe correção de dependência de efeito. Não houve chamada Claude/IA, reconhecimento de voz, OCR, custos reais ou teste completo de chat autenticado. Resposta de erro amigável não prova sucesso do modelo. Esses pontos são NO-GO para declarar o Assistente integralmente homologado.

## Estado das decisões e limitações

As aprovações históricas das 28 telas e a opção A permanecem. A fidelidade visual completa depende das referências ausentes e de revisão autenticada, não foi presumida. Ver MATRIZ_28_TELAS.md. Não foi possível confirmar modificações no computador do Kondo posteriores ao ZIP; integração deve usar comparação de três vias. Não sobrepor checkout atual inteiro.

Migrations 0174–0209 aplicadas são informação do material recebido, não consulta atual. A situação da 0208 no histórico remoto e o ledger precisam ser reconciliados por leitura; não mover/apagar/reaplicar migrations existentes. Os resultados E2E históricos de aproximadamente 185 verificações e 964 testes são relatados pelo Kondo, não repetidos nem incorporados à contagem desta rodada.

A consolidação 01A–01J parte do estado já integrado no ZIP 0aa2403, preservando os arquivos presentes. Não foram fornecidas dez árvores independentes atualizadas desses pacotes para comparar commit a commit; portanto não se afirma reconciliação documental completa de cada pacote original. O delta executável desta entrega está no patch e no manifesto. As melhorias locais posteriores do Kondo exigem o merge de três vias antes de qualquer aceite.
