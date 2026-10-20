# Referência visual de Caronas — decisão resolvida

Em 19/10/2026, o usuário confirmou: “Vamos adotar opção A”.

A referência definitiva da SCR-FM-004 Gestão Inteligente de Caronas Rev02 é a imagem 15 (`SCR-FM-004_REV02_APPROVED.png`). A imagem 45 permanece apenas como alternativa histórica. Não pedir nova decisão sobre esta composição.

A implementação em `/fleet/carpools` adota os seis indicadores, abas, filtros, lista à esquerda, detalhe à direita, interessados e painéis inferiores de Intelligence/impacto. O acesso do colaborador em `/carpool` permanece separado. Os indicadores são identificados conforme os dados reais disponíveis, sem reproduzir números demonstrativos da arte.

Aceitar/recusar reutiliza os comandos existentes com verificação de organização, escopo de gestão, identidade, estado e assentos no banco. A escolha visual não altera o consentimento do motorista nem autoriza aprovação automática. Nomes são obtidos somente pela view gerencial de pessoas; na ausência de acesso aparece identificação neutra. Não são consultados telefones, endereços particulares ou coordenadas.

Ainda não há fidelidade integral à referência: filtro independente por unidade, itinerário detalhado de passageiros, recorrência, compatibilidade e impacto calculado continuam pendentes. Na entrega para o Kondo foram implementados filtros independentes de destino/horário/status e mapa da rota da oferta solicitado pelo usuário, pelo adapter existente. A busca textual cobre origem, destino e placa; a data respeita America/Sao_Paulo. A implementação e a inspeção com fixtures não equivalem à homologação do ambiente real.

FM-001 e FM-002 mantêm suas referências definitivas já vinculadas.
