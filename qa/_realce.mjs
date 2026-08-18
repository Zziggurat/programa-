/** El mismo encuadre con tres intensidades de realce de selección, para elegir mirando. */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
const RAIZ='/workspace/programa-/app/dist', SALIDA=process.argv[2]??'/tmp/realce';
mkdirSync(SALIDA,{recursive:true});
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json'};
const sv=http.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const f=join(RAIZ,u);if(!existsSync(f)){r.statusCode=404;r.end('');return;}r.setHeader('Content-Type',MIME[extname(f)]??'application/octet-stream');r.end(readFileSync(f));});
await new Promise(r=>sv.listen(0,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:1600,height:1000}}); p.setDefaultTimeout(60000);
const er=[]; p.on('pageerror',e=>er.push(e.message));
const qa=(fn,...a)=>p.evaluate(([f,ar])=>window.qa[f](...ar),[fn,a]);
await p.goto(`http://127.0.0.1:${sv.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(()=>!!window.qa?.proyecto,null,{timeout:60000});
await p.evaluate(()=>document.getElementById('btn-cerrar-ayuda')?.click()); await p.waitForTimeout(400);
await p.evaluate(()=>document.getElementById('btn-empezar-ejemplo')?.click()); await p.waitForTimeout(600);
if(await p.isVisible('#modal-dialogo')){await p.evaluate(()=>document.getElementById('dialogo-ok')?.click());await p.waitForTimeout(500);await p.evaluate(()=>document.getElementById('btn-empezar-ejemplo')?.click());await p.waitForTimeout(600);}
await p.locator('.tarjeta-ejemplo button').nth(2).click({timeout:120000}); await p.waitForTimeout(2000);
for(const[m,bt]of[['#modal-dialogo','dialogo-ok'],['#modal-explicacion','btn-cerrar-explicacion']]){if(await p.isVisible(m)){await p.evaluate(i=>document.getElementById(i)?.click(),bt);await p.waitForTimeout(700);}}
await p.evaluate(()=>document.getElementById('modo-trabajo')?.click()); await p.waitForTimeout(600);
const ids=await p.evaluate(()=>window.qa.proyecto().dispositivos.map(d=>({id:d.id,tipo:d.tipo})));
const km=ids.find(d=>d.tipo==='contactor').id;
const c=await qa('bulto',km);
const r=Math.max(30,c.radio)*2.4*3.2;
await qa('verDesde',{x:c.x+Math.sin(0.4)*r,y:c.y+Math.sin(0.25)*r,z:c.z+Math.cos(0.4)*Math.cos(0.25)*r,tx:c.x,ty:c.y,tz:c.z});
await p.waitForTimeout(500);
for (const v of [0, 0.03, 0.06]) {
  await qa('realceSeleccion', v);
  await qa('elegir', km);
  await p.waitForTimeout(700);
  await p.screenshot({path:join(SALIDA,`realce-${String(v).replace('.','_')}.png`)});
  console.log('realce', v, '->', `realce-${String(v).replace('.','_')}.png`);
}
// Y el hover, sin selección, para ver que se distingue de los otros dos.
await qa('elegir', undefined); await p.waitForTimeout(300);
await qa('hoverDispositivo', km); await p.waitForTimeout(500);
await p.screenshot({path:join(SALIDA,'hover-aparato.png')});
console.log(er.length?`ERRORES: ${er.slice(0,2).join(' | ')}`:'sin errores de JavaScript');
await b.close(); sv.close();
