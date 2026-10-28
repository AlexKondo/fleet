/**
 * Choosing another vehicle in the assistant (web panel and WhatsApp). The card already shows the vehicle being offered, so the choices are
 * ONLY the others: the offered one is never listed again. Numbers ("2", "opção 2", "reserve a opção 6") count the alternatives, in the order shown.
 */
export function vehicleAlternatives<T extends { vehicleId: string }>(options: readonly T[] | undefined, chosenVehicleId: string | undefined): T[] {
  if (!options || options.length === 0) return [];
  const chosen = chosenVehicleId || options[0]!.vehicleId;
  return options.filter((o) => o.vehicleId !== chosen);
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, primeiro: 1, primeira: 1, dois: 2, duas: 2, segundo: 2, segunda: 2, tres: 3, terceiro: 3, terceira: 3, quatro: 4, quarto: 4,
  cinco: 5, quinto: 5, seis: 6, sexto: 6, sete: 7, setimo: 7, oito: 8, oitavo: 8, nove: 9, nono: 9, dez: 10, decimo: 10,
};
const NUM = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})`;
// "um/uma" only counts after "opção/número" ("quero um carro" is not a choice)
const NUM_VERB = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).filter((w) => w !== "um" && w !== "uma").join("|")})`;
const CHOICE_NOUN = new RegExp(`\\b(?:opcao|numero|alternativa|item|veiculo|carro)\\s*(?:n[o.]?\\s*)?${NUM}\\b`);
const CHOICE_VERB = new RegExp(`\\b(?:escolho|escolher|escolha|quero|prefiro|pode ser|vai de|fico com|ficar com|reserva|reserve|seleciono|selecionar)\\s+(?:o|a|esse|essa)?\\s*(?:numero\\s*)?${NUM_VERB}\\b`);

/**
 * "reserve a opção 6 pra mim", "quero o número dois", "o terceiro": which numbered option the person means, spoken or written in a
 * sentence. Only phrases that point at an option count (a time such as "às 9h" or a date never does). Null when nothing clear, or out of range.
 */
export function parseChoice(input: string, count: number): number | null {
  const t = input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.!?,;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (t.length > 80 || /\d\s*(?:h|horas?|:|\/)/.test(t)) return null;
  const m = CHOICE_NOUN.exec(t) ?? CHOICE_VERB.exec(t);
  if (!m) return null;
  const raw = m[1]!;
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return n && n >= 1 && n <= count ? n : null;
}
