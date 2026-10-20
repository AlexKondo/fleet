# Aceite integrado — execução no ambiente do Kondo

Executar depois do merge e da conferência do histórico de migrations. Usar contas e dados de homologação; não inserir dados demonstrativos em produção. Este roteiro cobre o que a validação local não prova e não solicita refazer cada teste unitário.

| Fluxo | Execução e resultado esperado |
|---|---|
| Acesso/isolamento | Colaborador não abre gestão nem chama comandos gerenciais; gestor com uma ou várias unidades só lê e altera seu escopo; outra organização não acessa os registros. Testar também chamada direta, não somente menu. |
| Veículos Rev04 | Em `/fleet`, selecionar veículo A e depois B: ficha, exportação, documentos, equipamentos e histórico apontam para B. Paginar, filtrar e esvaziar resultados sem manter a ficha anterior. Conferir cadastro/edição/arquivamento existentes e fotos privadas. |
| Caronas Rev02 A | Em `/fleet/carpools`, combinar data, destino, horário e status. Data no fuso de São Paulo; selecionar oferta e conferir reserva/assentos. Confirmar que colaborador continua em `/carpool`. |
| Decisão de carona | Anfitrião/gestor autorizado aceita ou recusa conforme as regras existentes. Própria solicitação não pode ser aprovada. Executar duas aceitações simultâneas para a última vaga: apenas a permitida pode consumir o assento. Conferir a atualização para motorista e passageiro e os efeitos das notificações já existentes. |
| Mapa | Antes do clique não há chamada ao mapa. Após “Visualizar mapa”, rota de oferta autorizada usa o provider real; confirmar quotas e fallback com chave ausente/provedor indisponível. Não enviar pontos particulares dos passageiros nem interpretar o mapa como GPS ao vivo. |
| IRA | Checklist completo do condutor separado da conferência visual rápida de Segurança. Foto apenas de avaria observada. Saída física exige as etapas previstas; chegada física não inventa checklist aprovado nem bloqueia o registro de uma chegada problemática. |
| SP | Colaborador realiza checklist no estacionamento; responsável designado confirma chaves no escritório. Retorno encerra após checklist e recebimento de chaves. Responsável restrito não ganha gestão nem precisa ter CNH para a custódia. |
| Manutenção | Gestor de frota aprova orçamento conforme a política da unidade. Quem criou/lançou não aprova o próprio orçamento; superior designado tem a fila restrita. Revisão pendente não substitui limite aprovado. Orçado, executado e garantia permanecem distintos. |
| Documentos | Upload, retomada, assinatura dos bytes, limite de tamanho, download autenticado, hash e anulação sem apagar evidência. URL sem sessão/outra organização não permite leitura; superior acessa somente o documento autorizado da fila. |
| Equipamentos | Próprio veículo prevalece sobre modelo; checklist captura a versão. Alteração posterior não muda viagem preparada. Sem configuração, nova retirada aguarda configuração real. Retorno legado preserva chegada/observações. |
| Preservação | Desativar acesso bloqueia sessão e preserva identidade. Arquivar veículo exige ausência de impedimentos; reativação não remove avarias, documentos ou equipamento pendente. Nenhuma rotina apaga históricos. |
| Integrações | Conferir autenticação, cookies, RLS/PostgREST, Storage, SMTP e provider Maps/IA no ambiente real. Não inferir funcionamento porque um mock retornou sucesso. Segredos não entram nas evidências. |

## Evidência visual por tela

Capturar as 28 telas da matriz com a conta apropriada. Viewports de comparação: desktop 1536×1024 e celular 390×844 CSS px, zoom 100%, device scale factor 1, fontes da aplicação carregadas. Registrar navegador, data, papel, unidade, estado e revisão do código. Usar a mesma fixture de homologação na repetição, sem dados pessoais reais. Não incluir gravação de áudio/credenciais.

Para FM-001/FM-002/FM-004, comparar com os três PNGs definitivos. Registrar diferenças de ordem dos painéis, proporções, tipografia, cores, espaçamentos, hierarquia e ações. Os dados demonstrativos das artes não fazem parte do aceite dos valores. Para referências ainda propostas, registrar a associação utilizada sem inventar nova aprovação. A versão celular deve preservar os fluxos sem exigir a mesma geometria do desktop.

Para cada tela preencher:

```text
Tela e revisão:
URL e commit executado:
Perfil / escopo de unidades:
Referência visual:
Viewport / zoom / fontes:
Screenshot da execução:
Ações exercitadas e resultado:
Diferenças visuais observadas:
Falhas funcionais / erro sanitizado / como reproduzir:
Implementação ausente (se houver):
Configuração ou dependência ausente (se houver):
Resultado: aprovado / com divergência / bloqueado
```

Devolver as diferenças com passos reproduzíveis. Não corrigir o design ou alterar regras silenciosamente para aproximar o resultado do que o Claude supõe que seria melhor.
