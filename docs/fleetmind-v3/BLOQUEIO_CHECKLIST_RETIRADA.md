# Problema reproduzido e correção implementada — 0077

Status: os três defeitos foram corrigidos na migração 0077 e cobertos por testes usando toda a cadeia SQL em plataforma simulada. A homologação real permanece pendente. Veja `IMPLANTACAO_0077.md`. A reprodução abaixo é preservada como evidência da versão legada, não como afirmação sobre a função atual.

O diagnóstico executa literalmente o corpo de `record_pickup` da migração 0024, que era a última definição antes de 0077. O restante do banco é um scaffold mínimo descartável. Não foram usadas credenciais, usuários ou dados reais.

```sh
node apps/web/scripts/reproduce-legacy-pickup.mjs
```

Resultados reproduzidos:

1. A inspeção do colaborador muda o veículo para `in_use`; a inspeção independente posterior de Segurança é recusada porque a função só aceita o estado anterior. A página de retirada e a fila da portaria também usam os estados anteriores para disponibilizar a ação. A exigência das duas inspeções na saída física de 0074 não resolve essa incompatibilidade.
2. O próprio solicitante da viagem consegue passar `p_role = security`, embora seu perfil seja `employee`. A função grava o papel declarado, sem validar a combinação entre ator e função de inspeção. A interface usual preencher o campo corretamente não protege chamadas diretas à API. Isso exige validação de papel e independência no banco, incluindo INSERT direto em inspeções.
3. Uma reserva com status `cancelled` é aceita quando o veículo e a janela satisfazem os outros predicados. O corpo da função não verifica o estado confirmado da reserva. A proteção da página não substitui a validação SQL.

O arquivo `pickup-reproduction.json` registra os resultados; os indicadores verdadeiros identificam defeitos, não conformidade. O diagnóstico não implementa o ciclo corrigido, não prova o comportamento do Supabase real nem substitui testes de RLS, Storage, anexos ou concorrência.

Para corrigir: validar ator real, organização, reserva confirmada e janela; preservar inspeções independentes por ator/função, sem sobrescrever evidências; permitir a segunda inspeção no ciclo correto; separar checklist de saída física; adaptar as páginas/fila e proteger chamadas diretas. O vínculo da política à unidade precisa distinguir o fluxo da IRA do fluxo de entrega de chaves pelo gestor em SP, conforme os contratos. Não rotular uma inspeção de gestor como realizada por Segurança nem supor que reserva confirmada comprova saída física.

Critérios de regressão: dois atores legítimos completam a sequência na ordem permitida; solicitante não forja Segurança; outro usuário não assume o solicitante; reserva cancelada/pendente/completada é recusada; reenvio não duplica nem apaga inspeções; eventos físicos continuam exigindo as pré-condições aplicáveis. Validar dano/evidência e chamadas diretas, além da UI. Não declarar concluídas SCR-USR-005 ou SCR-SEC-001 antes de reconciliar esses caminhos.
