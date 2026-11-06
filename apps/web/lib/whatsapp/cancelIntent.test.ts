import { describe, expect, it } from "vitest";
import { CANCEL_HINT, CANCEL_REQUEST, isBareCancelRequest } from "./cancelIntent";

describe("short requests to cancel a reservation", () => {
  it.each([
    "Cancelar",
    "cancelar",
    "CANCELAR!",
    "Cancela",
    "cancele",
    "Quero cancelar",
    "quero cancelar a reserva",
    "Quero cancelar a minha reserva.",
    "Cancele pra mim",
    "cancela pra mim por favor",
    "pode cancelar",
    "pode cancelar a minha reserva por favor",
    "por favor cancele",
    "preciso cancelar",
    "cancelar reserva",
    "cancelar viagem",
    "Não quero mais o carro",
    "nao quero mais o carro",
    "Não quero mais",
    "não preciso mais do carro",
    "não vou mais precisar do carro",
    "não vou mais viajar",
    "eu não quero mais a reserva",
    "desisti",
    "desisti da viagem",
    "Desisto do carro",
    "cancelar 🙏",
  ])("%s is a cancel request", (text) => {
    expect(isBareCancelRequest(text)).toBe(true);
  });

  it.each([
    "",
    "oi",
    "sim",
    "não",
    "quero um carro amanhã às 8h",
    "quero reservar um carro",
    "cancelar a reserva porque mudou a reunião",
    "não quero mais o carro porque a viagem foi adiada",
    "mudou a reunião",
    "não quero mais o carro azul, quero o branco",
    "tem carona para Campinas?",
    "cancelamento",
    "a".repeat(80),
  ])("%j is NOT a bare cancel request (it goes to the assistant as written)", (text) => {
    expect(isBareCancelRequest(text)).toBe(false);
  });

  it("the sentence the assistant reads is itself a cancel request, and the hint names the three ways to ask", () => {
    expect(isBareCancelRequest(CANCEL_REQUEST)).toBe(true);
    expect(CANCEL_HINT).toContain("*Cancelar*");
    expect(CANCEL_HINT).toContain("quero cancelar");
    expect(CANCEL_HINT).toContain("cancele pra mim");
    expect(CANCEL_HINT).toContain("não quero mais o carro");
  });
});
