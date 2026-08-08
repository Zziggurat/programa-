/**
 * QA de CAPAS: con una herramienta a pantalla completa abierta, lo que se abre encima se puede pulsar.
 *
 * Auditoría TS-P0-02. Los z-index estaban puestos a ojo y `#mundo` acabó en 70, por encima de
 * todos los modales (46), del diálogo bloqueante (50) y del toast (60). Con la Planta 3D abierta,
 * los tres botones de «Llevar al tablero» —incluido el de cerrar— devolvían `mundo-lienzo` en
 * `elementFromPoint`: el puente entre las dos herramientas era inusable. Y un aviso de «no se
 * pudo guardar» tampoco se habría visto.
 *
 * No se comprueban números de z-index —eso sería fijar la implementación— sino lo único que
 * importa: que el clic llegue.
 *
 *   node qa/capas.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http'; import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const AQUI=dirname(fileURLToPath(import.meta.url)); const ROOT=join(AQUI,'..','app','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
const f=join(ROOT,p);if(!existsSync(f)){r.statusCode=404;r.end('');return;}
r.setHeader('Content-Type',MIME[extname(f)]??'application/octet-stream');r.end(readFileSync(f));});
await new Promise(r=>s.listen(0,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1500,height:900}});
let fallos=0; const must=(n,c,x='')=>{if(!c)fallos++;console.log(`${c?'OK  ':'FAIL'}  ${n}${x?' → '+x:''}`);};

await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`); await p.waitForTimeout(1500);
await p.evaluate(()=>document.getElementById('btn-cerrar-ayuda')?.click());

/** ¿Todos los controles de este overlay reciben el clic de verdad? */
const alcanzable = (id) => p.evaluate((i)=>{
  const m=document.getElementById(i); if(!m) return {existe:false};
  m.hidden=false;
  const ctrls=[...m.querySelectorAll('button, input, select')].filter(x=>x.offsetParent!==null).slice(0,6);
  const malos=ctrls.filter(x=>{ const r=x.getBoundingClientRect();
    if(r.width===0||r.height===0) return false;
    // Un control por debajo del scroll no está TAPADO, está fuera de la ventana: `elementFromPoint`
    // devuelve null ahí y contarlo sería un falso positivo (le pasó al «Entendido» de la guía).
    if(r.top<0 || r.bottom>innerHeight || r.left<0 || r.right>innerWidth) return false;
    const t=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
    return !(t===x || x.contains(t) || m.contains(t)); });
  return {existe:true, controles:ctrls.length, tapados:malos.length,
          quienTapa: malos[0] ? (()=>{const r=malos[0].getBoundingClientRect(); const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return t?.id||t?.tagName;})() : null};
}, id);

console.log('--- con la PLANTA 3D abierta ---');
await p.evaluate(()=>document.getElementById('btn-planta')?.click());
await p.waitForTimeout(4500);
await p.evaluate(()=>document.getElementById('btn-cerrar-guia-mundo')?.click());
await p.waitForTimeout(500);
for (const id of ['modal-puente','modal-dialogo','modal-guia-mundo','modal-proyecto','modal-drc']) {
  const r = await alcanzable(id);
  must(`#${id} se puede pulsar`, r.existe && r.tapados===0, `${r.controles} controles, ${r.tapados} tapados${r.quienTapa?' por '+r.quienTapa:''}`);
  await p.evaluate((i)=>{document.getElementById(i).hidden=true;}, id);
}
const toast = await p.evaluate(()=>{ const t=document.getElementById('toast'); t.hidden=false; t.textContent='prueba';
  const r=t.getBoundingClientRect(); const e=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
  const v = t===e || t.contains(e) || getComputedStyle(t).zIndex > getComputedStyle(document.getElementById('mundo')).zIndex;
  return {z:getComputedStyle(t).zIndex, zMundo:getComputedStyle(document.getElementById('mundo')).zIndex}; });
must('el toast queda por encima de la Planta', Number(toast.z) > Number(toast.zMundo), `toast ${toast.z} vs mundo ${toast.zMundo}`);
await p.evaluate(()=>{document.getElementById('toast').hidden=true; document.getElementById('mundo').hidden=true;});

console.log('--- sin herramienta abierta (que no se haya roto lo de antes) ---');
for (const id of ['modal-ayuda','modal-ejemplos','modal-proyecto','modal-dialogo']) {
  const r = await alcanzable(id);
  must(`#${id} se puede pulsar`, r.existe && r.tapados===0, `${r.controles} controles, ${r.tapados} tapados${r.quienTapa?' por '+r.quienTapa:''}`);
  await p.evaluate((i)=>{document.getElementById(i).hidden=true;}, id);
}
await b.close(); s.close();
console.log(`\n=== ${fallos===0?'TODO OK ✔':fallos+' FALLO(S) ✗'} ===`);
process.exit(fallos?1:0);
