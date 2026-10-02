export function globalIndexFromWindow(windowStart:number,localIndex:number):number{
  if(!Number.isInteger(windowStart)||windowStart<0||!Number.isInteger(localIndex)||localIndex<0)return -1;
  return windowStart+localIndex;
}
