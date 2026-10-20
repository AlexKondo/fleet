# Validação atual — 0078–0079, 16/10/2026

| Verificação | Evidência executada |
|---|---|
| Vitest domínio | 252 testes / 20 arquivos, com cache válido do Turbo |
| Vitest frontend | 599 testes / 60 arquivos passaram na suíte completa final |
| Preflight | 6 testes passaram no comando raiz |
| Total | 857 testes passaram |
| Inspeções IRA | 9 cenários na cadeia SQL real, dentro da suíte frontend |
| Custódia no escritório | 14 cenários na cadeia SQL real, dentro da suíte frontend |
| Modelos e instruções de custódia | 4 testes de leituras inválidas, ausência de ação de portaria e orientação do colaborador |
| Páginas de custódia/configuração/acompanhamento | 5 testes de renderização com o shell real e fontes simuladas |
| Cadeia SQL | 73 migrações numeradas até 0079 em plataforma descartável simulada; pgcrypto não instalado nesse runtime, UUID nativo |
| Tipos | 3 pacotes verificados após o build |
| ESLint / build | Frontend sem erros no build de produção; domínio mantém script legado sem análise de lint |
| Composição das três novas páginas | SSR com fixtures explicitamente de teste, CSS compilado das rotas, 1536×1024 e 390×844, escala 1; sem overflow horizontal do documento nos seis casos |
| Supabase real / Auth HTTP / arquivos reais de Storage / PostgREST / concorrência entre conexões | Não homologados neste ambiente |
| Homologação visual das 28 telas | Não concluída; Rev.04 da SCR-FM-002 vinculada à imagem 41 por confronto com aprovação recuperada |

A cadeia usa tabelas, funções e políticas reais do histórico, schemas Auth/Storage simulados e btree_gist. A instalação de pgcrypto é a omissão explícita. As migrações históricas, incluindo limpeza, foram executadas somente nesse banco descartável vazio; isso não autoriza reaplicá-las sobre o ambiente real.

O fluxo IRA continua testado para checklist/conferência visual independentes, papel forjado, reserva inválida, reenvio, ordem física, propriedade das fotos, escopo dos endpoints em lote, autorização do condutor na saída e preservação de bloqueio. Campos não observados pela Segurança permanecem nulos. HEV não aceita recarga externa. Os três testes da interface de Segurança mantêm ausência de odômetro/energia/fotos padrão, evidência apenas para avaria e recusa de ator indevido.

Os cenários de custódia verificam designação explícita inclusive para gestor, nenhuma promoção automática do Colaborador, tabelas sem acesso direto, ausência de autoconfirmação, organização e unidade autorizadas, revogação, conta desativada, recebimento de chaves de reserva cancelada, recibos idempotentes, versões, bloqueio de mudança de processo com reservas pendentes/confirmadas, unidade desativada, preservação do contrato histórico após mudar a unidade, retorno e recebimento em ambas as ordens, avaria sem liberação, tarefa de reparo derivada no servidor, notificação de retorno reivindicada uma vez, acompanhamento remoto sem permissão física e ausência de inspeções/eventos fictícios da Segurança em SP.

Os testes de páginas verificam formulário local sem leituras de inspeção, ausência de confirmação da própria reserva, falha de leitura sem formulário ativo, configuração administrativa e visão remota sem ação física. O responsável pela custódia não precisa apresentar CNH para trabalhar nessa área; a exigência para conduzir permanece. As capturas internas de composição usam HTML SSR, não uma sessão autenticada com hidratação/Server Actions reais, e não equivalem a E2E nem à comparação pixel-perfect das 28 artes aprovadas.

O roteiro `reproduce-legacy-pickup.mjs` preserva a reprodução da função antiga isoladamente, não testa a função atual. Falhas intermediárias de desenvolvimento não são a evidência final. Os logs atuais são `test-0079-full-final.log`, `test-0079-targeted-final.log`, `typecheck-0079-final.log` e `build-0079-final.log`. A checagem de tipos final ocorre depois do build para evitar a remoção concorrente dos tipos gerados pelo Next.

Instalação real exige ledger e publicação coordenada de 0078–0079 com o frontend. Não executar reset/0028. Nenhum banco, usuário ou e-mail real foi alterado/disparado. A permissão de custódia por unidade está implementada; a configuração dos escopos de gestão de frota para todos os endpoints, múltiplos papéis gerais, demais caminhos de arquivamento e a homologação integral das 28 telas continuam pendentes. Não há decisão pendente do usuário sobre designar responsável local de chaves.
