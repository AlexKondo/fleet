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

/** What the robot tells a carpool rider once the host accepted: how to give the seat up. */
export const CARPOOL_CANCEL_HINT = "Para cancelar a sua carona, escreva *Cancelar* (ou algo como: _cancelar, não irei mais_).";

/** The sentence the assistant reads in place of a short cancel request from someone who only has a carpool: it names the intent CANCEL_CARPOOL_REQUEST. */
export const CARPOOL_CANCEL_REQUEST = "Cancela minha carona";

// "não vou mais", "não irei mais", "não vou mais de carona": the person gives the trip up
const NO_LONGER_GOING = new RegExp(`^(?:eu\\s+)?(?:nao|n)\\s+(?:vou|irei)\\s+mais(?:\\s+(?:viajar|precisar|usar|ir|de\\s+carona|na\\s+carona))?${OF}${TAIL}$`);

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

/** What a cancel message is about: the person's reservation, the carpool seat they were given, or it does not say ("Cancelar"). */
export type CancelTarget = "reservation" | "carpool" | "either";

const REASON_SPLIT = /[,;:.!?\n]|\s[-–—]\s|\s(?:porque|pois|pq|por que)\s/i;
const MAX_CANCEL_TEXT = 300;

/**
 * A message that starts by asking to cancel, optionally followed by why ("Cancelar", "cancelar, não irei mais", "cancela minha carona porque mudou o plano").
 * The first clause must be a plain cancel request on its own; what follows it is the person's own words (the reason), returned as written. null for anything else.
 */
export function cancelRequestOf(raw: string): { target: CancelTarget; reason: string } | null {
  const text = raw.trim();
  if (!text || text.length > MAX_CANCEL_TEXT) return null;
  const split = REASON_SPLIT.exec(text);
  const head = plain(split ? text.slice(0, split.index) : text);
  const reason = split ? text.slice(split.index + split[0].length).trim() : "";
  if (!head || head.length > 60) return null;
  const carpool = /\bcarona\b/.test(head);
  // "carona" is read as the object "reserva" so that the same sentences are recognised for both
  const asked = carpool ? head.replace(/\bcarona\b/g, "reserva") : head;
  if (!(CANCEL.test(asked) || NO_MORE.test(asked) || GAVE_UP.test(asked) || NO_LONGER_GOING.test(asked))) return null;
  const target: CancelTarget = carpool ? "carpool" : /\b(?:reserva|carro|veiculo)\b/.test(head) ? "reservation" : "either";
  return { target, reason };
}
