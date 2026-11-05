import { describe, expect, it } from "vitest";
import { reviewAlert } from "./reviewAlert";

describe("reviewAlert", () => {
  it("the print: 200 km and 500 km from the review blink; 3.757 km does not", () => {
    expect(reviewAlert(11800, 12000, 1000)).toEqual({ km: 200, overdue: false });
    expect(reviewAlert(11500, 12000, 1000)).toEqual({ km: 500, overdue: false });
    expect(reviewAlert(8243, 12000, 1000)).toBeNull();
  });
  it("exactly at the configured distance it already blinks", () => {
    expect(reviewAlert(11000, 12000, 1000)).toEqual({ km: 1000, overdue: false });
  });
  it("at or past the review km it is overdue", () => {
    expect(reviewAlert(12000, 12000, 1000)).toEqual({ km: 0, overdue: true });
    expect(reviewAlert(12300, 12000, 1000)).toEqual({ km: 300, overdue: true });
  });
  it("no review km registered, no alert", () => {
    expect(reviewAlert(5000, null, 1000)).toBeNull();
    expect(reviewAlert(5000, undefined, 1000)).toBeNull();
  });
});
