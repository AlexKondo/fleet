import { describe, expect, it } from "vitest";
import { CANCEL_HINT, CANCEL_REQUEST, CARPOOL_CANCEL_HINT, CARPOOL_CANCEL_REQUEST, cancelRequestOf, isBareCancelRequest } from "./cancelIntent";

describe("a cancel message with or without a reason, and what it is about", () => {
  it.each([
    ["Cancelar", "either", ""],
    ["cancelar", "either", ""],
    ["Cancelar!", "either", ""],
    ["cancelar, não irei mais", "either", "não irei mais"],
    ["Cancelar - não irei mais", "either", "não irei mais"],
    ["cancelar porque mudou o plano", "either", "mudou o plano"],
    ["Quero cancelar", "either", ""],
    ["não irei mais", "either", ""],
    ["Não vou mais", "either", ""],
    ["cancela pra mim, surgiu um imprevisto", "either", "surgiu um imprevisto"],
    ["Cancelar carona", "carpool", ""],
    ["cancela minha carona", "carpool", ""],
    ["Quero cancelar a carona, não irei mais", "carpool", "não irei mais"],
    ["Desisti da carona", "carpool", ""],
    ["não quero mais a carona", "carpool", ""],
    ["não vou mais de carona", "carpool", ""],
    ["Cancelar reserva", "reservation", ""],
    ["cancelar a minha reserva, mudou a reunião", "reservation", "mudou a reunião"],
    ["Não quero mais o carro", "reservation", ""],
    ["cancelar viagem", "either", ""],
  ] as const)("%j -> %s, reason %j", (text, target, reason) => {
    expect(cancelRequestOf(text)).toEqual({ target, reason });
  });

  it.each([
    "",
    "oi",
    "sim",
    "quero um carro amanhã às 8h",
    "tem carona para Campinas?",
    "quero ir de carona amanhã",
    "mudou a reunião, cancelar",
    "não sei se vou",
    "cancelamento",
    "a".repeat(400),
  ])("%j is not a cancel request", (text) => {
    expect(cancelRequestOf(text)).toBeNull();
  });
});

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

  it("the hint the carpool rider gets names two ways to ask, and the sentence the assistant reads is a carpool cancel", () => {
    expect(CARPOOL_CANCEL_HINT).toContain("*Cancelar*");
    expect(CARPOOL_CANCEL_HINT).toContain("cancelar, não irei mais");
    expect(CARPOOL_CANCEL_HINT).toContain("carona");
    expect(cancelRequestOf(CARPOOL_CANCEL_REQUEST)).toEqual({ target: "carpool", reason: "" });
  });

  it("the sentence the assistant reads is itself a cancel request, and the hint names the three ways to ask", () => {
    expect(isBareCancelRequest(CANCEL_REQUEST)).toBe(true);
    expect(CANCEL_HINT).toContain("*Cancelar*");
    expect(CANCEL_HINT).toContain("quero cancelar");
    expect(CANCEL_HINT).toContain("cancele pra mim");
    expect(CANCEL_HINT).toContain("não quero mais o carro");
  });
});
