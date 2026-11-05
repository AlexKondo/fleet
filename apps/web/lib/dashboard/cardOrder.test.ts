import { describe, expect, it } from "vitest";
import { mergeCardOrder, moveCard, orderToSave } from "./cardOrder";

describe("mergeCardOrder", () => {
  it("nothing saved: the order of the page", () => {
    expect(mergeCardOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("what was arranged comes first; a new vehicle goes last", () => {
    expect(mergeCardOrder(["c", "a"], ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
  });
  it("a saved vehicle that is not on screen is skipped, and bad data is ignored", () => {
    expect(mergeCardOrder(["x", "b", 7, null, "b"], ["a", "b"])).toEqual(["b", "a"]);
  });
});

describe("moveCard", () => {
  it("dragged forward, it takes the place of the target", () => {
    expect(moveCard(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
  });
  it("dragged backward, it takes the place of the target", () => {
    expect(moveCard(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"]);
  });
  it("dropped on itself, or on something unknown, nothing moves", () => {
    expect(moveCard(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(moveCard(["a", "b"], "a", "z")).toEqual(["a", "b"]);
  });
});

describe("orderToSave", () => {
  it("rearranging with the location filter on keeps the vehicles it hides", () => {
    expect(orderToSave(["b", "a"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });
});
