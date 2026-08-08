/**
 * QA de los DATOS DEL PROYECTO: un campo en blanco no puede convertirse en un dato declarado.
 *
 * Auditoría TS-P1-03. El formulario usaba `Number(input.value)` con un filtro común `v >= 0`, y
 * las dos cosas estaban mal: `Number('') === 0` y `0 >= 0`, así que dejar el ambiente en blanco
 * lo DECLARABA como 0 °C —medido: 7,6 °C interiores en vez de 42,6, treinta y cinco grados de
 * error y siempre hacia el lado que tranquiliza— y la placa de características salía afirmando
 * «0 °C» y «0 Hz» en un documento que se entrega firmado. Y el `>= 0` rechazaba −10 °C, que es
 * normal en una cubierta en invierno.
 *
 *   node qa/datos-proyecto.mjs
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
const p=await b.newPage({viewport:{width:1400,height:900}});
let fallos=0; const must=(n,c,x='')=>{if(!c)fallos++;console.log(`${c?'OK  ':'FAIL'}  ${n}${x?' → '+x:''}`);};
await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`); await p.waitForTimeout(1500);
await p.evaluate(()=>document.getElementById('btn-cerrar-ayuda')?.click());

const guardarCon = async (campos) => {
  await p.evaluate(()=>document.getElementById('btn-datos-proyecto')?.click());
  await p.waitForTimeout(400);
  await p.evaluate((c)=>{ for(const [id,v] of Object.entries(c)){ const el=document.getElementById(id); if(el) el.value=v; } }, campos);
  await p.evaluate(()=>document.getElementById('pr-guardar')?.click() ?? document.querySelector('#modal-proyecto .primario')?.click());
  await p.waitForTimeout(500);
  return p.evaluate(()=>({o:window.qa.proyecto().opciones}));
};

console.log('--- campo AMBIENTE vacío ---');
let r = await guardarCon({'pr-ambiente':'', 'pr-frecuencia':'', 'pr-icc':''});
must('vacío NO declara 0 °C', r.o.temperaturaAmbienteC === undefined, 'quedó: '+JSON.stringify(r.o.temperaturaAmbienteC));
must('vacío NO declara 0 Hz', r.o.frecuenciaHz === undefined, 'quedó: '+JSON.stringify(r.o.frecuenciaHz));

console.log('--- ambiente -10 °C (válido) ---');
r = await guardarCon({'pr-ambiente':'-10'});
must('-10 °C se conserva', r.o.temperaturaAmbienteC === -10, 'quedó: '+JSON.stringify(r.o.temperaturaAmbienteC));

console.log('--- basura y fuera de rango ---');
r = await guardarCon({'pr-ambiente':'calor'});
must('texto = sin declarar', r.o.temperaturaAmbienteC === undefined, JSON.stringify(r.o.temperaturaAmbienteC));
r = await guardarCon({'pr-ambiente':'999'});
must('999 °C = fuera de rango, sin declarar', r.o.temperaturaAmbienteC === undefined, JSON.stringify(r.o.temperaturaAmbienteC));

console.log('--- el térmico no queda en NaN ---');
r = await guardarCon({'pr-ambiente':''});
const term = await p.evaluate(()=>{ const t=window.qa.termico(); return t? {amb:t.temperaturaAmbienteC, int:t.temperaturaInteriorC}:null; });
must('con el campo vacío el térmico usa el valor por defecto, no 0 ni NaN',
  !!term && Number.isFinite(term.int) && term.amb >= 20, JSON.stringify(term));
// Y declarado bajo cero, el térmico tiene que USARLO.
await guardarCon({'pr-ambiente':'-10'});
const frio = await p.evaluate(()=>{ const t=window.qa.termico(); return t? {amb:t.temperaturaAmbienteC, int:t.temperaturaInteriorC}:null; });
must('declarando -10 °C el térmico calcula con -10', !!frio && frio.amb === -10 && Number.isFinite(frio.int), JSON.stringify(frio));
await b.close(); s.close();
console.log(`\n=== ${fallos===0?'P1-03 ARREGLADO ✔':fallos+' FALLO(S) ✗'} ===`);
process.exit(fallos?1:0);
