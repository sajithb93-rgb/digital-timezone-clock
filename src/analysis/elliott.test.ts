import { describe, expect, it } from "vitest";
import {
  validateStandardImpulse,
  validateZigzag,
  validateFlat,
  validateTriangle,
  validateDoubleZigzag,
} from "./elliott";

describe("Elliott structural validators", () => {
  it("accepts a valid bullish standard impulse and allows a truncated wave 5", () => {
    const valid = validateStandardImpulse([100, 110, 104, 125, 116, 120], true);
    expect(valid.valid).toBe(true);
    expect(valid.w3BeyondW1).toBe(true);
    expect(valid.w4Valid).toBe(true);
    expect(valid.w5BeyondW3).toBe(false);
    expect(valid.truncated).toBe(true);
  });

  it("rejects wave 2 crossing the wave-1 origin", () => {
    const invalid = validateStandardImpulse([100, 110, 99, 125, 116, 130], true);
    expect(invalid.w2Valid).toBe(false);
    expect(invalid.valid).toBe(false);
  });

  it("rejects an impulse where wave 3 is the shortest actionary wave", () => {
    const invalid = validateStandardImpulse([100, 110, 107, 112, 109, 120], true);
    expect(invalid.w3NotShortest).toBe(false);
    expect(invalid.valid).toBe(false);
  });

  it("requires zigzag C to extend beyond A while B stays inside X-A", () => {
    expect(validateZigzag([100, 90, 95, 84], false).valid).toBe(true);
    expect(validateZigzag([100, 90, 95, 92], false).valid).toBe(false);
    expect(validateZigzag([100, 90, 100, 84], false).valid).toBe(false);
  });

  it("distinguishes regular, expanded and running flats", () => {
    expect(validateFlat([100, 90, 99, 91], false).subtype).toBe("Regular Flat");
    expect(validateFlat([100, 90, 102, 84], false).subtype).toBe("Expanded Flat");
    expect(validateFlat([100, 90, 101, 89], false).subtype).toBe("Running Flat");
  });

  it("requires all five triangle waves A-B-C-D-E", () => {
    expect(validateTriangle([100, 110, 104, 108, 106, 107], true).valid).toBe(true);
    expect(validateTriangle([100, 110, 104, 108, 106], true).valid).toBe(false);
  });

  it("validates both legs and the connector of a double zigzag", () => {
    expect(validateDoubleZigzag([100, 90, 96, 84, 91, 83, 88, 78], false).valid).toBe(true);
  });
});
