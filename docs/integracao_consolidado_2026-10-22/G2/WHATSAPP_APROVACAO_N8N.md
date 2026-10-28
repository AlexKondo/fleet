# Aprovação de reservas pelo WhatsApp (via n8n) — guia de ativação

Estado: **sistema pronto e testado localmente; desligado até receber o endereço do n8n e o segredo.** Nada foi aplicado em produção.

## Como funciona (resumo)
1. O administrador abre **Administração → Aprovação por WhatsApp** (`/settings/approvals`) e, para cada pessoa, escolhe o **gestor direto** e, para o gestor, cadastra o **WhatsApp** (com a confirmação de que ele concordou em receber).
2. Um colaborador reserva um veículo. A reserva fica "aguardando aprovação", como hoje.
3. Logo depois da resposta ao colaborador, o sistema envia ao **n8n** um pedido assinado com o texto e os dois botões. O n8n entrega no WhatsApp do gestor direto.
4. O gestor toca **Aprovar** ou **Recusar**. O n8n repassa o toque ao sistema (endereço abaixo). **Aprovar** libera o veículo (reserva confirmada, veículo reservado, colaborador avisado, auditoria). **Recusar** cancela a reserva e avisa o colaborador.
5. A aprovação dentro do sistema pelo gestor de frota continua funcionando; se ela acontecer primeiro, o pedido do WhatsApp vira "já tratado".

## Mensagem que o gestor recebe
```
*Pedido de uso de veículo*

Solicitante: Lucas Andrade
Veículo: Haval H6 (ABC1D23)
Saída: sex, 30/10/2026 às 09:00
Retorno: sex, 30/10/2026 às 17:00
Origem: Garagem Matriz - São Paulo
Destino: Centro Técnico Campinas
Objetivo: Reunião
Passageiros: 1

Toque em *Aprovar* para liberar o veículo ou em *Recusar* para negar o pedido.
Este pedido vale até qui, 29/10/2026 às 13:42.
```
Botões: **Aprovar** · **Recusar**. Horários em Brasília. Textos digitados pelo colaborador são limpos (sem formatação, quebras de linha ou excesso de tamanho).

## Contrato com o n8n
### 1) Sistema → n8n (você cria um Webhook no n8n e me passa a URL)
`POST <N8N_APPROVAL_WEBHOOK_URL>`, cabeçalhos `x-fleet-timestamp` (segundos) e `x-fleet-signature` = `sha256=` + HMAC-SHA256(`<timestamp>.<corpo bruto>`, segredo). Corpo:
```json
{
  "type": "approval_request",
  "request_id": "uuid",
  "reservation_id": "uuid",
  "to": "+5511987654321",
  "expires_at": "2026-10-29T13:42:00Z",
  "message": {
    "body": "texto acima",
    "buttons": [ { "id": "approve:<token>", "title": "Aprovar" }, { "id": "reject:<token>", "title": "Recusar" } ]
  },
  "data": { "requester_name": "...", "vehicle_name": "...", "plate": "...", "departure_at": "...", "return_at": "...", "origin": "...", "destination": "...", "purpose": "...", "passengers": 1 }
}
```
O n8n responde **2xx** quando aceitou (qualquer outro código marca a entrega como falha, sem perder a reserva). No n8n: Webhook → (opcional: verificar a assinatura) → nó **WhatsApp** "Send message" do tipo *interactive / reply buttons* com `message.body` e os dois botões (`id` e `title` exatamente como vêm) para `to`.

### 2) n8n → sistema (toque do gestor)
Gatilho **WhatsApp Trigger** (mensagens do tipo botão/`interactive.button_reply`) → nó HTTP Request:
`POST https://fleet-web-three.vercel.app/api/whatsapp/approval`, cabeçalhos `x-fleet-timestamp` e `x-fleet-signature` calculados da mesma forma, corpo:
```json
{ "button_id": "approve:<token>", "from": "5511987654321", "message_id": "wamid...." }
```
(`button_id` = o `id` do botão tocado; `from` = número de quem tocou; `message_id` = id da mensagem recebida.)
Resposta `200`: `{ "status": "approved|rejected|already_decided|superseded|expired|vehicle_unavailable|phone_mismatch|not_authorized|invalid", "reply_text": "texto pronto para o gestor", "reservation_id": "..." }`. O n8n envia `reply_text` de volta ao gestor no WhatsApp. Respostas `401` (assinatura/horário inválido), `503` (segredo não configurado), `502` (indisponível: repetir depois).

Cálculo da assinatura no n8n (nó Code): `crypto.createHmac('sha256', SEGREDO).update(timestamp + '.' + corpoBruto).digest('hex')`.

## Segurança (o que protege a aprovação)
- O token tem 64 caracteres aleatórios, vale uma vez, só o *hash* fica no banco e expira em até 24 h (ou no fim da reserva).
- A decisão só é aceita se: assinatura HMAC válida e recente (5 min); número do remetente **igual ao cadastrado** do gestor (aceita o mesmo número sem o 9º dígito); o aprovador **ainda é o gestor direto** do solicitante e a conta está ativa; a reserva ainda está pendente e o veículo não está em manutenção/bloqueado.
- Toque repetido não repete o efeito; recusar depois de aprovar não faz nada.
- Tentativa com número diferente fica na auditoria (`approval.phone_mismatch`). O número do WhatsApp aparece na auditoria só pelos 4 últimos dígitos.
- Só administradores alteram gestor direto e WhatsApp. Sem o segredo configurado o endereço do sistema responde 503.

## Para ativar
1. Você passa: a **URL do webhook do n8n** e define um **segredo** (texto longo e aleatório) que será o mesmo nos dois lados.
2. Eu: backup do banco, aplico a migration `0229_whatsapp_manager_approval.sql` em produção, publico o código e cadastro `N8N_APPROVAL_WEBHOOK_URL` e `N8N_APPROVAL_SECRET` na Vercel (somente com a sua autorização).
3. Você cadastra gestor direto e WhatsApp em `/settings/approvals` e testa na organização fictícia primeiro.

Rollback: `supabase/migrations/rollback/0229_rollback.sql` (remove só o que a 0229 criou). Para desligar sem rollback basta apagar as duas variáveis na Vercel.

## Limites conhecidos
- Reenvio automático de pedidos que falharam na entrega não está ligado (a Vercel Hobby só permite rotina diária); o pedido continua pendente e o gestor pode aprovar no sistema. A função de reenvio existe (`fm_approval_prepare` com rotação de token).
- O WhatsApp só permite iniciar conversa com mensagem livre dentro de 24 h do último contato do gestor; fora dessa janela é necessário um **modelo de mensagem aprovado** pela Meta. Isso é configuração do n8n/WhatsApp Business, não do sistema.
