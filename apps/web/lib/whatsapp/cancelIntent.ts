/**
 * Cancelling a reservation by WhatsApp: what the robot tells the person ("write Cancelar") and the short sentences it recognises as that request
 * ("Cancelar", "quero cancelar", "cancele pra mim", "não quero mais o carro"...). Anything longer than that (for example one that already says why) goes to the
 * assistant as it was written, so the reason is not lost.
 */
export const CANCEL_HINT = "Para cancelar esta reserva, escreva *Cancelar* (ou algo como: _quero cancelar_, _cancele pra mim_, _não quero mais o carro_).";

/** The sentence the assistant reads in place of a short cancel request: a textbook "cancel my reservation, no reason given", so it asks for the reason. */
export const CANCEL_REQUEST = "Quero cancelar a minha reserva";

const LEAD = "(?:(?:eu|entao|ai|olha)\\s+)?(?:(?:quero|queria|preciso|gostaria de|vou|pode|poderia|favor|por favor|pf|pfv)\\s+)*";
const OBJECT = "(?:a|essa|esta|aquela|minha|a minha|nossa)?\\s*(?:reserva|viagem|carro|veiculo|pedido|solicitacao)?";
const TAIL = "(?:\\s+(?:pra|para)\\s+(?:mim|min|eu))?(?:\\s+(?:por favor|pf|pfv|agora|ai|ja))*";
const OF = "(?:\\s+(?:d?o|d?a|de))?(?:\\s+(?:carro|veiculo|reserva|viagem))?";

const CANCEL = new RegExp(`^${LEAD}cancel(?:ar|a|e|o|ei)(?:\\s+${OBJECT})?${TAIL}$`);
const NO_MORE = new RegExp(
  `^(?:eu\\s+)?(?:nao|n)\\s+(?:(?:quero|preciso|vou precisar|vou querer)\\s+mais|vou\\s+mais\\s+(?:precisar|viajar|usar))${OF}${TAIL}$`,
);
const GAVE_UP = new RegExp(`^(?:eu\\s+)?desist(?:i|o|ir)${OF}${TAIL}$`);

/** lower case, no accents, no punctuation or emoji, single spaces */
function plain(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** true when the whole message is just a request to cancel (nothing else in it, such as a reason) */
export function isBareCancelRequest(raw: string): boolean {
  const t = plain(raw);
  if (!t || t.length > 60) return false;
  return CANCEL.test(t) || NO_MORE.test(t) || GAVE_UP.test(t);
}
