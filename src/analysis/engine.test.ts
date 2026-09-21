import { describe, expect, it } from "vitest";
import { analyzeElliott, analyzeMTF, analyzeSMC, Candle } from "./engine";

function makeCandle(index:number,open:number,close:number,high?:number,low?:number,closed=true):Candle{
 const h=Math.max(open,close,high??Math.max(open,close));
 const l=Math.min(open,close,low??Math.min(open,close));
 return{time:index*60_000,open,close,high:h,low:l,volume:100,closed};
}

function flatSeries(count:number,start=100):Candle[]{
 return Array.from({length:count},(_,i)=>makeCandle(i,start,start,start+0.5,start-0.5));
}

describe("SMC engine regression rules",()=>{
 it("ignores a forming last candle for signal analysis",()=>{
  const data=flatSeries(30);
  data.push(makeCandle(30,100,120,121,99,false));
  const result=analyzeSMC(data);
  expect(result.asOf).toBe(29);
 });

 it("detects a classic three-candle FVG without requiring a fourth candle",()=>{
  const data=flatSeries(27);
  data.push(makeCandle(27,100,100.2,100.5,99.8));
  data.push(makeCandle(28,100.2,103,104,100));
  data.push(makeCandle(29,103,103.5,104,102));
  const result=analyzeSMC(data);
  expect(result.fvgs.some(x=>x.from===27&&x.to===29&&x.type==="bullish"&&!x.filled)).toBe(true);
 });

 it("does not create breakers from an order-block touch alone",()=>{
  const result=analyzeSMC(flatSeries(60));
  expect(result.breakers).toEqual([]);
 });

 it("never emits a structure break before the broken pivot could be confirmed",()=>{
  const data=flatSeries(35);
  const result=analyzeSMC(data);
  for(const event of result.events){
   const matches=result.pivots.filter(p=>p.price===event.price&&(event.direction==="bullish"?p.type==="H":p.type==="L"));
   expect(matches.some(p=>(p.confirmedAt??p.index)<=event.index)).toBe(true);
  }
 });
});

describe("Elliott / EliteWave candidate rules",()=>{
 it("keeps any primary impulse candidate inside strict five-wave price geometry",()=>{
  const result=analyzeElliott(flatSeries(80));
  const wave=result.primary;
  if(!wave)return;
  expect(wave.points).toHaveLength(6);
  const p=wave.points.map(x=>x.price);
  if(wave.direction==="bullish"){
   expect(p[1]).toBeGreaterThan(p[0]);
   expect(p[2]).toBeGreaterThan(p[0]);
   expect(p[2]).toBeLessThan(p[1]);
   expect(p[3]).toBeGreaterThan(p[1]);
   expect(p[4]).toBeGreaterThan(p[1]);
   expect(p[4]).toBeLessThan(p[3]);
   expect(p[5]).toBeGreaterThan(p[3]);
  }else{
   expect(p[1]).toBeLessThan(p[0]);
   expect(p[2]).toBeLessThan(p[0]);
   expect(p[2]).toBeGreaterThan(p[1]);
   expect(p[3]).toBeLessThan(p[1]);
   expect(p[4]).toBeLessThan(p[1]);
   expect(p[4]).toBeGreaterThan(p[3]);
   expect(p[5]).toBeLessThan(p[3]);
  }
 });

 it("represents an ABC correction with Start, A, B and C turning points",()=>{
  const result=analyzeElliott(flatSeries(80));
  if(result.correction)expect(result.correction.points.map(p=>p.label)).toEqual(["Start","A","B","C"]);
 });
});

describe("MTF context",()=>{
 it("does not collapse a directional frame to zero just because no entry setup exists",()=>{
  const data=flatSeries(50,100);
  const result=analyzeMTF([{interval:"15m",candles:data}]);
  const frame=result.frames[0];
  expect(frame.available).toBe(true);
  expect(frame.score).toBeGreaterThanOrEqual(25);
 });
});
