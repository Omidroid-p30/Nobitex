function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x));}
function bookImbalance(book){ const b=(book.bids||[]).slice(0,10), a=(book.asks||[]).slice(0,10); const bv=b.reduce((s,x)=>s+Number(x[0])*Number(x[1]),0), av=a.reduce((s,x)=>s+Number(x[0])*Number(x[1]),0); return bv+av? (bv-av)/(bv+av):0; }
function tradePressure(rows){ let buy=0,sell=0; for(const x of rows||[]){const v=Math.abs(x.price*x.amount); const side=String(x.side||""); if(side.includes("buy")||side==="1")buy+=v; else if(side.includes("sell")||side==="2")sell+=v;} return buy+sell?(buy-sell)/(buy+sell):0; }
function scoreMarket({market,indicators:i,book,trades}) {
  let bull=50,bear=50;
  if(i.rsi!=null){ if(i.rsi<35)bull+=12; else if(i.rsi<50)bull+=4; if(i.rsi>70)bear+=12; else if(i.rsi>55)bear+=4; }
  if(i.ema20&&i.ema50&&i.last){ if(i.last>i.ema20)bull+=7; else bear+=7; if(i.ema20>i.ema50)bull+=7; else bear+=7; }
  if(i.hist!=null){ if(i.hist>0)bull+=6; else bear+=6; }
  if(i.volumeRatio!=null){ if(i.volumeRatio>1.5)bull+=5; if(i.volumeRatio>1.5)bear+=3; }
  const bi=bookImbalance(book), tp=tradePressure(trades);
  bull += bi*15 + tp*15; bear -= bi*15 + tp*15;
  if(i.breakoutUp!=null && i.breakoutUp>=0.985) bull+=8;
  if(i.breakdownDown!=null && i.breakdownDown<=1.015) bear+=8;
  const score=clamp(Math.round(bull));
  const drop=clamp(Math.round(bear));
  const signal = score>=68 ? "صعودی" : drop>=68 ? "نزولی" : (score>=60||drop>=60) ? "زودهنگام" : "خنثی";
  return {score,drop,signal,bookImbalance:Math.round(bi*100),tradePressure:Math.round(tp*100),deep:i.rsi!=null};
}
module.exports={scoreMarket};
