/**
 * QA de TEXTO HOSTIL: nada de lo que el usuario escriba —o venga en un archivo importado— puede
 * convertirse en HTML.
 *
 * Auditoría TS-P1-01. `escaparHtml` escapaba `& < >` pero NO las comillas, y casi todo su uso es
 * dentro de un atributo (`title="${esc(x)}"`), donde una comilla no rompe el texto: lo cierra.
 * Y la nota del parte de obra iba al `title` del punto de estado SIN pasar por `esc` siquiera.
 * El proyecto y el parte se importan de archivos y de otros equipos: ese texto no es de fiar.
 *
 *   node qa/texto-hostil.mjs
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
p.on('dialog', async (d)=>{ fallos++; console.log('FAIL  se abrió un diálogo del navegador:', d.message()); await d.dismiss(); });

// Cargas hostiles típicas: salir de un atributo, meter un manejador, inyectar una etiqueta.
const CARGAS = [
  `" onmouseover="document.documentElement.dataset.pwned='1'" x="`,
  `"><img src=x onerror="document.documentElement.dataset.pwned='2'">`,
  `'><script>document.documentElement.dataset.pwned='3'<\/script>`,
  `comilla " simple ' y <b>negrita</b>`,
];

await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`); await p.waitForTimeout(1500);
await p.evaluate(()=>document.getElementById('btn-cerrar-ayuda')?.click());
// Un tablero con aparatos, para poder probar también el marcado.
await p.evaluate(()=>document.getElementById('btn-ejemplos')?.click());
await p.waitForTimeout(500);
await p.evaluate(()=>document.querySelectorAll('.tarjeta-ejemplo button')[0]?.click());
await p.waitForTimeout(1800);
await p.evaluate(()=>document.getElementById('btn-cerrar-explicacion')?.click());
await p.waitForTimeout(400);

console.log('--- la NOTA del parte de obra (iba cruda al title) ---');
await p.evaluate(()=>document.getElementById('btn-planta')?.click());
await p.waitForTimeout(4500);
await p.evaluate(()=>document.getElementById('btn-cerrar-guia-mundo')?.click());
for (const carga of CARGAS) {
  const r = await p.evaluate((c)=>{
    const q = window.__plantaQA;
    const tag = q.equipos.find(e=>e.x!==null).tag;
    q.anotar(tag, 'montado', c);
    const fila = document.querySelector(`#mundo-lista [data-tag="${CSS.escape(tag)}"] .punto-obra`);
    return { title: fila?.getAttribute('title') ?? '(sin punto)', pwned: document.documentElement.dataset.pwned ?? null };
  }, carga);
  must(`nota «${carga.slice(0,26)}…» no ejecuta nada`, !r.pwned, r.pwned ? 'pwned='+r.pwned : '');
  must(`   y la nota se lee entera en el tooltip`, r.title.includes(carga.slice(0, 12)), r.title.slice(0, 46));
}
const nodos = await p.evaluate(()=>({img:document.querySelectorAll('#mundo-lista img').length, scripts:document.querySelectorAll('#mundo-lista script').length}));
must('no se creó ninguna etiqueta que no tocaba', nodos.img===0 && nodos.scripts===0, JSON.stringify(nodos));

console.log('--- el MARCADO de un aparato ---');
await p.evaluate(()=>{document.getElementById('mundo').hidden=true;});
for (const carga of CARGAS.slice(0,2)) {
  const r = await p.evaluate((c)=>{
    const pr = window.qa.proyecto();
    if (!pr.dispositivos.length) return {salta:true};
    pr.dispositivos[0].designacion = c;
    window.qa.recalcular();
    return { pwned: document.documentElement.dataset.pwned ?? null,
             imgs: document.querySelectorAll('#panel-izq img, #panel-der img').length };
  }, carga);
  if (r.salta) { console.log('  (tablero vacío, se salta)'); break; }
  must(`marcado «${carga.slice(0,22)}…» no ejecuta nada`, !r.pwned && r.imgs===0, JSON.stringify(r));
}
await b.close(); s.close();
console.log(`\n=== ${fallos===0?'TODO OK ✔':fallos+' FALLO(S) ✗'} ===`);
process.exit(fallos?1:0);
