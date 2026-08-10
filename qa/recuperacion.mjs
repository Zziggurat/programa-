/**
 * QA de RECUPERACIÓN: un tablero guardado que no se puede abrir NO se pisa jamás.
 *
 * El arranque hacía `try { … } catch { proyectoNuevo() }` y el primer `recalcular()` guardaba
 * encima. Un autosave de versión futura llamado «MI TABLERO IMPORTANTE» quedaba convertido en
 * «Tablero nuevo» al recargar. Justo cuando alguien más quiere su trabajo —al abrirlo con otra
 * versión del programa— se lo borrábamos.
 *
 * Se comprueban los tres motivos por los que puede no leerse, que en los tres el byte original
 * siga ahí incluso después de seguir trabajando, y que el camino normal no se haya estropeado.
 *
 *   node qa/recuperacion.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http'; import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
import { abrirNavegador } from './lib/entorno.mjs';
const AQUI=dirname(fileURLToPath(import.meta.url)); const ROOT=join(AQUI,'..','app','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
const f=join(ROOT,p);if(!existsSync(f)){r.statusCode=404;r.end('');return;}
r.setHeader('Content-Type',MIME[extname(f)]??'application/octet-stream');r.end(readFileSync(f));});
await new Promise(r=>s.listen(0,r));
const b=await abrirNavegador(chromium);
const p=await b.newPage({viewport:{width:1300,height:850}});
const url=`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`;
const CLAVE='tablerostudio-proyecto';
let fallos=0; const must=(n,c,x='')=>{if(!c)fallos++;console.log(`${c?'OK  ':'FAIL'}  ${n}${x?' → '+x:''}`);};

for (const [rot, contenido] of [
  ['versión futura', JSON.stringify({formato:'tablero-studio',version:999,nombre:'MI TABLERO IMPORTANTE',dispositivos:[],conductores:[],hojas:[],gabinete:{ancho:600,alto:600}})],
  ['JSON a medias', '{"formato":"tablero-studio","version":1,"nombre":"A MEDIAS"'],
  ['otro programa',  JSON.stringify({formato:'otra-cosa',datos:1})],
]) {
  await p.goto(url); await p.waitForTimeout(700);
  await p.evaluate(([k,v])=>localStorage.setItem(k,v),[CLAVE,contenido]);
  await p.reload(); await p.waitForTimeout(2600);
  const ahora = await p.evaluate((k)=>localStorage.getItem(k),CLAVE);
  must(`«${rot}»: el guardado sigue intacto`, ahora===contenido,
    ahora===contenido?`${ahora.length} bytes`:`quedó: ${String(ahora).slice(0,50)}`);
  const dlg = await p.evaluate(()=>({visible:!document.getElementById('modal-dialogo').hidden, msg:document.getElementById('dialogo-msg')?.textContent?.slice(0,60)}));
  must(`«${rot}»: avisa y ofrece salida`, dlg.visible, dlg.msg);
  // Escribir en el tablero NO debe pisar el guardado mientras esté congelado.
  await p.evaluate(()=>{ document.getElementById('dialogo-cancelar')?.click(); });
  await p.waitForTimeout(400);
  await p.evaluate(()=>{ window.qa?.recalcular?.(); });
  await p.waitForTimeout(600);
  const tras = await p.evaluate((k)=>localStorage.getItem(k),CLAVE);
  must(`«${rot}»: sigue intacto tras trabajar`, tras===contenido, tras===contenido?'':`quedó: ${String(tras).slice(0,50)}`);
}

/*
 * Y EL CASO QUE FALTABA: el archivo que SÍ se lee, pero al que hay que quitarle algo.
 *
 * Segunda auditoría, TS2-P0-01. Los tres de arriba son archivos que el cargador RECHAZA lanzando,
 * y solo ese camino congelaba el guardado. El cargador tiene otro, que es el que se usa a diario:
 * leerlo y ARREGLARLO. Ese devolvía `arreglos` y el arranque los tiraba, así que el primer
 * `autoguardar()` reemplazaba el original con la versión saneada y lo que se había quitado
 * desaparecía sin que nadie lo hubiera visto pasar. Con la suite anterior pasando en verde.
 *
 * El «cable suelto» no es un caso de laboratorio: es lo que queda cuando alguien borra un aparato
 * en una versión y abre el archivo en otra. Dentro de ese cable está a qué borna iba.
 */
const REPARABLE = JSON.stringify({
  formato:'tablero-studio', version:1, nombre:'CON UN CABLE SUELTO',
  hojas:[{id:'h1',numero:1,titulo:'Hoja 1'}],
  gabinete:{ancho:600,alto:600,canaletas:[],rieles:[{id:'r1',y:100,xInicio:0,xFin:500}],colocaciones:[]},
  dispositivos:[{id:'q1',tipo:'disyuntor',bornes:[{id:'1',tipo:'L'},{id:'2',tipo:'L'}]}],
  conductores:[{id:'w1',de:{dispositivoId:'q1',borneId:'1'},a:{dispositivoId:'BORRADO',borneId:'X'}}],
});

await p.goto(url); await p.waitForTimeout(700);
await p.evaluate(([k,v])=>localStorage.setItem(k,v),[CLAVE,REPARABLE]);
await p.reload(); await p.waitForTimeout(2600);

const trasAbrir = await p.evaluate((k)=>localStorage.getItem(k),CLAVE);
must('«reparable»: el original sigue intacto nada más abrir', trasAbrir===REPARABLE,
  trasAbrir===REPARABLE?`${trasAbrir.length} bytes`:`quedó: ${String(trasAbrir).slice(0,70)}`);

const aviso = await p.evaluate(()=>({visible:!document.getElementById('modal-dialogo').hidden,
  msg:document.getElementById('dialogo-msg')?.textContent??''}));
must('«reparable»: dice QUÉ se quitó, antes de pisar nada',
  aviso.visible && /corregirlo|se quitó/i.test(aviso.msg), aviso.msg.slice(0,80));

// Trabajar sin haber aceptado la corrección NO puede pisar el original.
await p.evaluate(()=>{ document.getElementById('dialogo-cancelar')?.click(); });
await p.waitForTimeout(400);
await p.evaluate(()=>{ document.getElementById('dialogo-cancelar')?.click(); });
await p.waitForTimeout(400);
await p.evaluate(()=>{ window.qa?.recalcular?.(); });
await p.waitForTimeout(800);
const trasTrabajar = await p.evaluate((k)=>localStorage.getItem(k),CLAVE);
must('«reparable»: sigue intacto tras seguir trabajando', trasTrabajar===REPARABLE,
  trasTrabajar===REPARABLE?'':`quedó: ${String(trasTrabajar).slice(0,70)}`);

// Y en cuanto se acepta la corrección, el guardado vuelve a funcionar: no queda bloqueado.
await p.goto(url); await p.waitForTimeout(700);
await p.evaluate(([k,v])=>localStorage.setItem(k,v),[CLAVE,REPARABLE]);
await p.reload(); await p.waitForTimeout(2600);
await p.evaluate(()=>{ document.getElementById('dialogo-cancelar')?.click(); });   // no descargo
await p.waitForTimeout(400);
await p.evaluate(()=>{ document.getElementById('dialogo-ok')?.click(); });          // sí acepto
await p.waitForTimeout(1200);
const trasAceptar = await p.evaluate((k)=>localStorage.getItem(k),CLAVE);
must('«reparable»: al ACEPTAR, el guardado vuelve a funcionar',
  !!trasAceptar && trasAceptar!==REPARABLE && trasAceptar.includes('tablero-studio'),
  String(trasAceptar).slice(0,60));

// Y el camino normal debe seguir guardando.
await p.goto(url); await p.waitForTimeout(700);
await p.evaluate(()=>localStorage.removeItem('tablerostudio-proyecto'));
await p.reload(); await p.waitForTimeout(2200);
const normal = await p.evaluate(()=>localStorage.getItem('tablerostudio-proyecto'));
must('sin nada guardado, el autoguardado funciona igual que siempre', !!normal && normal.includes('tablero-studio'), String(normal).slice(0,50));
await b.close(); s.close();
// Qué demuestra esto, exactamente: que en los CUATRO caminos por los que un guardado puede no
// leerse tal cual —tres que el cargador rechaza y uno que repara—, el original sigue byte por
// byte hasta que su dueño decide. No demuestra nada sobre otros caminos que no estén aquí.
console.log(`\n=== ${fallos===0?'el guardado anterior no se pisa en ninguno de los 4 casos ✔':fallos+' FALLO(S) ✗'} ===`);
process.exit(fallos?1:0);
