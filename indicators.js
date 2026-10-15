function sma(a,n){ if(a.length<n)return null; return a.slice(-n).reduce((x,y)=>x+y,0)/n; }
function ema(a,n){ if(a.length<n)return null; let e=sma(a.slice(0,n),n), k=2/(n+1); for(let i=n;i<a.length;i++)e=a[i]*k+e*(1-k); return e; }
function rsi(closes,n=14){ if(closes.length<n+1)return null; let g=0,l=0; for(let i=closes.length-n;i<closes.length;i++){let d=closes[i]-closes[i-1];if(d>0)g+=d;else l-=d;} if(l===0)return 100; return 100-100/(1+g/l); }
function atr(cs,n=14){ if(cs.length<n+1)return null; const tr=[]; for(let i=1;i<cs.length;i++) tr.push(Math.max(cs[i].h-cs[i].l,Math.abs(cs[i].h-cs[i-1].c),Math.abs(cs[i].l-cs[i-1].c))); return sma(tr,n); }
function macd(closes){ if(closes.length<35)return {macd:null,signal:null,hist:null}; const vals=[]; for(let i=0;i<closes.length;i++){const e12=ema(closes.slice(0,i+1),12),e26=ema(closes.slice(0,i+1),26); if(e12!=null&&e26!=null)vals.push(e12-e26);} const m=vals.at(-1), s=ema(vals,9); return {macd:m,signal:s,hist:m!=null&&s!=null?m-s:null}; }
function bollinger(cs,n=20){ if(cs.length<n)return {width:null,position:null}; const a=cs.slice(-n).map(x=>x.c), mid=sma(a,n), sd=Math.sqrt(a.reduce((z,x)=>z+(x-mid)**2,0)/n); return {width:mid?4*sd/mid:null,position:sd?((a.at(-1)-mid)/(2*sd)):0}; }
function calcIndicators(cs,m){ const closes=cs.map(x=>x.c), vols=cs.map(x=>x.v); const avgVol=sma(vols.slice(0,-1),20); const last=closes.at(-1); const recent=cs.slice(-20); const hi=Math.max(...recent.map(x=>x.h)), lo=Math.min(...recent.map(x=>x.l)); return {
 last, rsi:rsi(closes), ema20:ema(closes,20), ema50:ema(closes,50), atr:atr(cs), ...macd(closes), ...bollinger(cs),
 volumeRatio:avgVol&&vols.at(-1)?vols.at(-1)/avgVol:null,
 breakoutUp:hi?last/hi:null, breakdownDown:lo?last/lo:null,
 range20High:hi, range20Low:lo
};}
module.exports={calcIndicators};
