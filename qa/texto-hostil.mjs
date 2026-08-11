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
import { abrirNavegador } from './lib/entorno.mjs';
const AQUI=dirname(fileURLToPath(import.meta.url)); const ROOT=join(AQUI,'..','app','dist');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
const f=join(ROOT,p);if(!existsSync(f)){r.statusCode=404;r.end('');return;}
r.setHeader('Content-Type',MIME[extname(f)]??'application/octet-stream');r.end(readFileSync(f));});
await new Promise(r=>s.listen(0,r));
const b=await abrirNavegador(chromium);
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
/*
 * ------------------------------------------------------------------------------------------
 * LAS RUTAS QUE ESTA SUITE NO MIRABA.
 *
 * Segunda auditoría, TS2-P1-05. Aquí se comprobaba la nota de obra y el marcado de un aparato, y
 * con eso se dio por cerrada «la inyección». No lo estaba: la auditoría reprodujo cuatro caminos
 * más con marcadores inocuos, y los cuatro creaban NODOS de verdad en el DOM.
 *
 * Que una suite pase no dice nada de lo que no mira. Aquí van los cuatro, con el mismo método:
 * se mete un marcador que no ejecuta nada y se comprueba que sale como TEXTO y no como etiqueta.
 * ------------------------------------------------------------------------------------------ */

console.log('\n--- el buscador del catálogo ---');
await p.evaluate(() => { document.getElementById('mundo').hidden = true; });
const MARCA = '<em data-marca-hostil="1">sin-coincidencia-xyz</em>';
await p.evaluate((c) => {
	const caja = document.getElementById('buscar-catalogo');
	if (!caja) return;
	caja.value = c;
	caja.dispatchEvent(new Event('input', { bubbles: true }));
}, MARCA);
await p.waitForTimeout(500);
let r = await p.evaluate(() => ({
	nodos: document.querySelectorAll('#catalogo [data-marca-hostil]').length,
	texto: document.querySelector('.catalogo-vacio')?.textContent ?? '',
}));
must('buscar con etiquetas NO crea nodos', r.nodos === 0, `${r.nodos} nodos`);
must('   y el término buscado se lee entero, como texto', r.texto.includes('sin-coincidencia-xyz'),
	r.texto.slice(0, 60));

console.log('\n--- el nombre de una PLANTILLA propia ---');
await p.evaluate((c) => {
	const lista = [{ nombre: c, fecha: new Date().toISOString(), proyecto: window.qa.proyecto() }];
	localStorage.setItem('tablerostudio-plantillas', JSON.stringify(lista));
}, '<em data-marca-hostil="2">plantilla</em>');
await p.evaluate(() => document.getElementById('btn-ejemplos')?.click());
await p.waitForTimeout(700);
r = await p.evaluate(() => ({
	nodos: document.querySelectorAll('#lista-ejemplos [data-marca-hostil]').length,
	texto: document.querySelector('#lista-ejemplos .tarjeta-ejemplo h4')?.textContent ?? '',
}));
must('el nombre de una plantilla NO crea nodos', r.nodos === 0, `${r.nodos} nodos`);
await p.evaluate(() => { document.getElementById('modal-ejemplos').hidden = true; localStorage.removeItem('tablerostudio-plantillas'); });

/*
 * Un id de RIEL con una comilla. Es el caso que reprodujo la auditoría, y el sitio importa: aquí
 * el id va dentro de un ATRIBUTO (`data-id="…"`), no entre etiquetas. Entre etiquetas, una comilla
 * no hace nada; dentro de un atributo, lo cierra y abre el siguiente. Lo probé primero con un id
 * de borne —que va en el contenido de un `<span>`— y pasaba con el código roto y con el arreglado,
 * o sea que no probaba nada: el fallo estaba en el otro sitio.
 */
console.log('\n--- un id de RIEL con comillas, desde el archivo ---');
r = await p.evaluate(() => {
	const pr = window.qa.proyecto();
	const g = pr.gabinete;
	if (!g?.rieles?.length) return { salta: true };
	g.rieles[0].id = 'r1" data-marca-hostil="3';
	window.qa.recalcular();
	window.qa.pintarEstructura?.();
	return { salta: false, nodos: document.querySelectorAll('[data-marca-hostil]').length,
		texto: document.querySelector('.fila-estructura .id')?.textContent ?? '' };
});
if (r.salta) console.log('  (sin rieles, se salta)');
else {
	must('un id de riel con comillas NO crea atributos', r.nodos === 0, `${r.nodos} nodos`);
	must('   y se lee entero, como texto', r.texto.includes('data-marca-hostil'), r.texto.slice(0, 40));
}

console.log('\n--- la FUENTE de un trozo del dossier ---');
r = await p.evaluate(() => {
	const pr = window.qa.proyecto();
	pr.dossier = pr.dossier ?? {};
	pr.dossier.bloques = [{ id: 'bx', tipo: 'texto', donde: 'final', trozos: [
		{ texto: 'hola', fuente: 'serif;x:y" data-marca-hostil="4' },
	] }];
	return JSON.stringify(pr).length > 0;
});
await p.evaluate(() => document.getElementById('btn-pdf')?.click());
await p.waitForTimeout(3000);
const dos = await p.evaluate(() => ({
	nodos: document.querySelectorAll('#dos-secciones [data-marca-hostil], .dos-texto [data-marca-hostil]').length,
	estilo: document.querySelector('.dos-texto span')?.getAttribute('style') ?? '',
}));
must('la fuente de un trozo NO puede cerrar el atributo style', dos.nodos === 0,
	`${dos.nodos} nodos · style=«${dos.estilo}»`);
must('   y una fuente inventada simplemente no se aplica',
	!dos.estilo.includes('marca-hostil'), dos.estilo.slice(0, 60));

/*
 * ------------------------------------------------------------------------------------------
 * TERCERA AUDITORÍA, TS3-P1-04. Tres rutas más que seguían construyendo `innerHTML` con datos
 * del proyecto. La prueba de la auditoría metió dos designaciones con markup y creó DOS NODOS
 * DOM reales en la selección múltiple, aunque el texto se leyera como «MARCA-A, MARCA-B».
 *
 * La CSP del entregable reduce que se pueda EJECUTAR algo, y no se demostró ejecución. Pero no
 * impide alterar el DOM, los estilos ni la interfaz, y el build de desarrollo no lleva esa CSP.
 * ------------------------------------------------------------------------------------------ */

console.log('\n--- selección múltiple, DRC del aparato y panel de riel ---');
const MARCA3 = '<em data-marca-hostil="5">X</em>';
r = await p.evaluate((c) => {
	const pr = window.qa.proyecto();
	if (pr.dispositivos.length < 2) return { salta: true };
	pr.dispositivos[0].designacion = `${c}A`;
	pr.dispositivos[1].designacion = `${c}B`;
	window.qa.recalcular();
	window.qa.seleccionarPorId(pr.dispositivos[0].id);
	window.qa.anadirASeleccion(pr.dispositivos[1].id);
	return { salta: false,
		nodos: document.querySelectorAll('#panel-der [data-marca-hostil]').length,
		texto: document.querySelector('#panel-der .pista')?.textContent ?? '' };
}, MARCA3);
if (r.salta) console.log('  (menos de dos aparatos, se salta)');
else {
	must('la selección múltiple NO crea nodos con las designaciones', r.nodos === 0, `${r.nodos} nodos`);
	must('   y las enseña como texto', r.texto.includes('data-marca-hostil'), r.texto.slice(0, 50));
}

// El id de un riel, que va dentro de un <h1> del panel de estructura.
r = await p.evaluate((c) => {
	const g = window.qa.proyecto().gabinete;
	if (!g?.rieles?.length) return { salta: true };
	g.rieles[0].id = `r1${c}`;
	window.qa.recalcular();
	window.qa.pintarEstructura?.();
	// Se selecciona el riel para que se pinte su panel, que es el otro sink.
	const fila = document.querySelector('.fila-estructura');
	fila?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	return { salta: false, nodos: document.querySelectorAll('[data-marca-hostil]').length };
}, MARCA3);
if (r.salta) console.log('  (sin rieles, se salta)');
else must('el panel de un riel NO crea nodos con su id', r.nodos === 0, `${r.nodos} nodos`);

await b.close(); s.close();
console.log(`\n=== ${fallos===0?'TODO OK ✔':fallos+' FALLO(S) ✗'} ===`);
process.exit(fallos?1:0);
