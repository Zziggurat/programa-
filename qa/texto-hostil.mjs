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
import { dirname } from 'node:path';import { fileURLToPath } from 'node:url';
import { abrirNavegador, esperarEditorListo, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';
const AQUI=dirname(fileURLToPath(import.meta.url)); const { servidor: s } = await servidorDeQA();
const b=await abrirNavegador(chromium);
const p=await b.newPage({viewport:{width:1500,height:900}});
let fallos=0; const must=(n,c,x='')=>{if(!c)fallos++;console.log(`${c?'OK  ':'FAIL'}  ${n}${x?' → '+x:''}`);};
p.on('dialog', async (d)=>{ fallos++; console.log('FAIL  se abrió un diálogo del navegador:', d.message()); await d.dismiss(); });

const TITULO_TARJETA = 'Arranque directo de motor (380 V)';
const TITULO_PROYECTO = 'Arranque directo de motor 380 V';
let fase = 'arranque';
async function estadoPreparacion() {
	return p.evaluate(() => {
		const proyecto = window.qa?.proyecto?.();
		const documento = window.qa?.documentoActivo?.();
		return {
			nombre: proyecto?.nombre,
			documentoId: documento?.id,
			ejemploProyecto: proyecto?.esEjemplo === true,
			ejemploDocumento: documento?.ejemplo === true,
			dispositivos: proyecto?.dispositivos?.length,
			conductores: proyecto?.conductores?.length,
			rieles: proyecto?.gabinete?.rieles?.length,
			modalEjemplos: document.getElementById('modal-ejemplos')?.hidden === false,
			modalExplicacion: document.getElementById('modal-explicacion')?.hidden === false,
			chipEjemplo: document.getElementById('chip-ejemplo')?.hidden === false,
			toast: document.getElementById('toast')?.textContent ?? '',
			guardado: document.getElementById('estado-guardado')?.textContent ?? '',
		};
	}).catch(error => ({ error: String(error) }));
}

async function abrirFixtureEditable() {
	fase = 'esperar editor persistente';
	await esperarEditorListo(p);
	if (await p.locator('#btn-cerrar-ayuda').isVisible().catch(() => false)) {
		await p.locator('#btn-cerrar-ayuda').click();
	}

	fase = 'abrir biblioteca de ejemplos';
	if (await p.locator('#inicio').isVisible().catch(() => false)) {
		await p.locator('#inicio-ejemplos').click();
	} else {
		await p.locator('#btn-aprender').click();
		await p.locator('#btn-ejemplos').click();
	}
	await p.locator('#modal-ejemplos').waitFor({ state: 'visible' });
	const tarjeta = p.locator('.tarjeta-ejemplo', { hasText: TITULO_TARJETA }).first();
	if (!(await tarjeta.count())) throw new Error(`No aparece el fixture «${TITULO_TARJETA}».`);

	fase = `abrir fixture «${TITULO_TARJETA}»`;
	await tarjeta.getByRole('button', { name: /Abrir y estudiar/i }).click();
	await Promise.race([
		p.locator('#modal-dialogo').waitFor({ state: 'visible', timeout: 2_000 }).catch(() => false),
		p.waitForFunction(titulo => window.qa.proyecto().nombre === titulo
			&& window.qa.proyecto().esEjemplo === true, TITULO_PROYECTO, { timeout: 2_000 }).catch(() => false),
	]);
	if (await p.locator('#modal-dialogo').isVisible().catch(() => false)) {
		await p.locator('#dialogo-ok').click();
	}
	await p.waitForFunction(titulo => {
		const proyecto = window.qa.proyecto();
		const documento = window.qa.documentoActivo?.();
		return proyecto.nombre === titulo && proyecto.esEjemplo === true
			&& documento?.ejemplo === true && proyecto.dispositivos.length >= 2
			&& proyecto.conductores.length > 0 && (proyecto.gabinete?.rieles?.length ?? 0) > 0;
	}, TITULO_PROYECTO, { timeout: 60_000 });
	if (await p.locator('#btn-cerrar-explicacion').isVisible().catch(() => false)) {
		await p.locator('#btn-cerrar-explicacion').click();
	}
	const antes = await estadoPreparacion();

	fase = 'crear copia editable del fixture';
	if (!(await trabajarSobreCopia(p, { timeout: 60_000 }))) {
		throw new Error(`El fixture abierto no ofreció una copia. ${JSON.stringify(await estadoPreparacion())}`);
	}
	await p.waitForFunction(({ titulo, documentoId }) => {
		const proyecto = window.qa.proyecto();
		const documento = window.qa.documentoActivo?.();
		return proyecto.nombre === `Copia de ${titulo}` && proyecto.esEjemplo !== true
			&& documento?.ejemplo === false && !!documento.id && documento.id !== documentoId
			&& proyecto.dispositivos.length >= 2 && proyecto.conductores.length > 0
			&& (proyecto.gabinete?.rieles?.length ?? 0) > 0;
	}, { titulo: TITULO_PROYECTO, documentoId: antes.documentoId }, { timeout: 60_000 });
}

// Cargas hostiles típicas: salir de un atributo, meter un manejador, inyectar una etiqueta.
const CARGAS = [
  `" onmouseover="document.documentElement.dataset.pwned='1'" x="`,
  `"><img src=x onerror="document.documentElement.dataset.pwned='2'">`,
  `'><script>document.documentElement.dataset.pwned='3'<\/script>`,
  `comilla " simple ' y <b>negrita</b>`,
];

try {
fase = 'cargar editor';
await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`, { waitUntil: 'domcontentloaded' });
// Fixture estable con aparatos, cables y rieles: las pruebas hostiles no pueden pasar sobre vacío.
await abrirFixtureEditable();

console.log('--- la NOTA del parte de obra (iba cruda al title) ---');
fase = 'abrir Planta 3D y esperar su fixture';
await p.locator('#btn-planta').click();
if (await p.locator('#btn-cerrar-guia-mundo').isVisible().catch(() => false)) {
	await p.locator('#btn-cerrar-guia-mundo').click();
}
await p.waitForFunction(() => Array.isArray(window.__plantaQA?.equipos)
	&& window.__plantaQA.equipos.some(e => e.x !== null), null, { timeout: 60_000 });
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
  if (r.salta) { must('el fixture conserva al menos un aparato para probar el marcado', false); break; }
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
if (r.salta) must('el fixture conserva al menos un riel para probar sus atributos', false);
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
if (r.salta) must('el fixture conserva dos aparatos para probar la selección múltiple', false);
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
if (r.salta) must('el fixture conserva al menos un riel para probar su panel', false);
else must('el panel de un riel NO crea nodos con su id', r.nodos === 0, `${r.nodos} nodos`);

} catch (error) {
	fallos++;
	console.error(`ERROR NO CONTROLADO [${fase}]: ${error?.stack ?? error}`);
	console.error(`ESTADO DE PREPARACIÓN: ${JSON.stringify(await estadoPreparacion())}`);
} finally {
	try { await p.close(); } catch (error) { fallos++; console.error(error); }
	try { await b.close(); } catch (error) { fallos++; console.error(error); }
	try {
		s.closeAllConnections?.();
		await new Promise((resolve, reject) => s.close(error => error ? reject(error) : resolve()));
	} catch (error) { fallos++; console.error(error); }
}
console.log(`\n=== ${fallos===0?'TODO OK ✔':fallos+' FALLO(S) ✗'} ===`);
process.exitCode=fallos?1:0;
