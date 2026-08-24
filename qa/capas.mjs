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
import { dirname } from 'node:path';import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';
const AQUI=dirname(fileURLToPath(import.meta.url)); const { servidor: s } = await servidorDeQA();
const b=await abrirNavegador(chromium);
const p=await b.newPage({viewport:{width:1500,height:900}});
let fallos=0; const must=(n,c,x='')=>{if(!c)fallos++;console.log(`${c?'OK  ':'FAIL'}  ${n}${x?' → '+x:''}`);};
// El arranque documental bloquea el <body> mientras monta IndexedDB. Un reloj fijo puede vencer
// antes en una campaña cargada y convertir el bloqueo deliberado en un falso fallo de capas.
const esperarEditorListo = () => p.waitForFunction(() =>
  !document.body.classList.contains('persistencia-pendiente') && !document.body.inert,
  null, { timeout: 30_000 });

await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`);
await esperarEditorListo(); await p.waitForTimeout(1500);
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
/*
 * --- UNA VENTANA ENCIMA DE OTRA ---
 *
 * Esto es lo que se le escapó a la prueba de arriba, que abre las ventanas DE UNA EN UNA: todas
 * comparten `--capa-modal`, así que entre ellas el empate lo desempata el navegador por orden en
 * el documento, y ese orden no tiene nada que ver con el orden en que se abren.
 *
 * En la primera visita la guía rápida está abierta. Se pulsaba «Empezar con un ejemplo» y la
 * ventana de ejemplos salía DEBAJO de la guía —`#modal-ayuda` va después en el HTML—: se veían
 * las tarjetas atenuadas al fondo y no se podía pinchar ninguna. Con la guía delante, que es
 * justo cuando alguien mira el programa por primera vez, esa puerta estaba cerrada.
 */
console.log('--- una ventana encima de otra ---');
await p.reload();
await esperarEditorListo();
await p.waitForTimeout(1600);
// Se abre la guía con su botón: al recargar ya no salta sola —solo lo hace la primera visita— y
// la situación que importa es la misma, la guía delante y alguien que quiere ver un ejemplo.
await p.evaluate(()=>document.getElementById('btn-ayuda')?.click());
await p.waitForTimeout(500);
must('CONDICIÓN PREVIA: la guía está abierta',
  await p.evaluate(()=>!document.getElementById('modal-ayuda').hidden), '');
// Sin cerrar la guía —a propósito— se abre la ventana de ejemplos, como haría cualquiera.
await p.evaluate(()=>document.getElementById('btn-empezar-ejemplo')?.click());
await p.waitForTimeout(800);
const encima = await p.evaluate(()=>{
  const btn = document.querySelector('.tarjeta-ejemplo button');
  if (!btn) return {hay:false};
  const r = btn.getBoundingClientRect();
  const t = document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);
  return {hay:true, manda: t?.closest('[id^=modal-]')?.id ?? t?.id ?? t?.tagName};
});
must('con la guía abierta, un ejemplo se puede elegir de verdad',
  encima.hay && encima.manda === 'modal-ejemplos',
  encima.hay ? `en la tarjeta manda ${encima.manda}` : 'no salieron tarjetas de ejemplo');

/* ============ Una herramienta a pantalla completa se abre USABLE ============ */

/*
 * Las herramientas viven en `--capa-herramienta` (40) y las ventanas en `--capa-modal` (60). Si al
 * abrir el dossier, el esquema o la Planta queda una ventana abierta, la herramienta sale DEBAJO
 * de ella y encima marcada `inert`: ni se ve ni se puede tocar.
 *
 * Lo destapó `qa/dossier-personalizado.mjs`, que no cierra la guía del primer arranque: Playwright
 * rellenaba el campo de la empresa sin protestar y sin escribir nada, y el fallo aparecía tres
 * pasos más allá como «lo que se escribe se guarda con el proyecto → undefined».
 */
console.log('\n--- una herramienta a pantalla completa se abre usable ---');
for (const [herramienta, boton, dentro] of [
  ['panel-dossier', 'btn-pdf', 'dos-empresa-nombre'],
  ['panel-esquema', 'btn-esquema', 'esq-acercar'],
]) {
  // Se deja la guía abierta A PROPÓSITO: es la situación que rompía.
  await p.evaluate(()=>document.getElementById('btn-ayuda')?.click()
    ?? document.getElementById('modal-ayuda')?.removeAttribute('hidden'));
  await p.waitForTimeout(300);
  await p.evaluate((b)=>document.getElementById(b)?.click(), boton);
  await p.waitForTimeout(2500);
  const v = await p.evaluate(([h,d])=>{
    const caja = document.getElementById(h);
    const campo = document.getElementById(d);
    return {
      visible: !!caja && !caja.hidden,
      inerte: !!caja?.closest('[inert]') || !!caja?.hasAttribute('inert'),
      guiaAbierta: !document.getElementById('modal-ayuda')?.hidden,
      alcanzable: !!campo && campo.offsetParent !== null && !campo.closest('[inert]'),
    };
  }, [herramienta, dentro]);
  must(`#${herramienta}: se abre`, v.visible);
  must(`#${herramienta}: NO queda inerte con una ventana abierta detrás`, !v.inerte);
  must(`#${herramienta}: la guía se cierra al abrirlo`, !v.guiaAbierta);
  must(`#${herramienta}: sus controles se pueden usar`, v.alcanzable);
  // Se cierra para la siguiente vuelta.
  await p.evaluate((h)=>{ const c=document.getElementById(h); if(c) c.hidden = true; }, herramienta);
  await p.waitForTimeout(200);
}

await b.close(); s.close();
console.log(`\n=== ${fallos===0?'TODO OK ✔':fallos+' FALLO(S) ✗'} ===`);
process.exit(fallos?1:0);
