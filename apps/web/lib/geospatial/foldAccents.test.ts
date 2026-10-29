import { describe, expect, it } from "vitest";
import { foldAccents } from "./foldAccents";

describe("foldAccents", () => {
  it("removes every kind of accent and keeps the rest", () => {
    expect(foldAccents("Fábrica da GWM")).toBe("Fabrica da GWM");
    expect(foldAccents("Av. São João, 1.649 – Iracemápolis")).toBe("Av. Sao Joao, 1.649 – Iracemapolis");
    expect(foldAccents("coração à ñandú ü")).toBe("coracao a nandu u");
  });
  it("leaves text without accents untouched", () => {
    expect(foldAccents("EZ Tower")).toBe("EZ Tower");
  });
});
