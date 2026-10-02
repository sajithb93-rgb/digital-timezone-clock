import { describe, expect, it } from "vitest";
import { globalIndexFromWindow } from "./backtestIndex";

describe("backtest window index mapping",()=>{
  it("maps local indexes to global indexes for a sliding window",()=>{
    expect(globalIndexFromWindow(0,500)).toBe(500);
    expect(globalIndexFromWindow(250,250)).toBe(500);
    expect(globalIndexFromWindow(500,0)).toBe(500);
  });

  it("rejects invalid window/index inputs",()=>{
    expect(globalIndexFromWindow(-1,1)).toBe(-1);
    expect(globalIndexFromWindow(1,-1)).toBe(-1);
    expect(globalIndexFromWindow(1.5,2)).toBe(-1);
    expect(globalIndexFromWindow(1,2.5)).toBe(-1);
  });
});
