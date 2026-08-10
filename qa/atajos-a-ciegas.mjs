/**
 * QA de ATAJOS: ninguna tecla edita el tablero cuando el tablero no se ve.
 *
 * Auditoría TS-P1-04. El manejador de teclas colgaba de `window` y solo se apartaba en dos casos:
 * escribiendo en un `<input>`, y con el esquema o la Visualización delante. Todo lo demás pasaba
 * de largo. Comprobado antes del arreglo:
 *
 *   · Con la PLANTA 3D abierta —que ocupa la pantalla entera y del tablero no deja ver ni un
 *     tornillo— Ctrl+Z deshacía un cambio del tablero sin que se notara nada, y Supr abría un
 *     «¿Eliminar -Q1 y sus cables?» sobre el plano de la cubierta, preguntando por un aparato que
 *     no estabas mirando. Un sí de más ahí borra trabajo que ni se sabía que estaba en riesgo.
 *   · Con la ventana de INICIO delante, igual.
 *   · Corrigiendo el TEXTO DEL DOSSIER, que son bloques `contenteditable` —o sea `<div>`, no
 *     `<input>`—, Supr para borrar una letra abría la misma pregunta de eliminar el aparato.
 *   · Y con un «¿Eliminar…?» ya abierto, otro Supr encolaba una segunda pregunta detrás.
 *
 * De paso: ese diálogo no enfocaba nada cuando no llevaba campo de texto, y sus teclas cuelgan
 * de él mismo, así que Escape no lo cerraba por mucho que se pulsara.
 *
 *   node qa/atajos-a-ciegas.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http'; import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
import { abrirNavegador } from './lib/entorno.mjs';
const AQUI = dirname(fileURLToPath(import.meta.url)); const ROOT = join(AQUI, '..', 'app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const s = http.createServer((q, r) => {
	let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html';
	const f = join(ROOT, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; }
	r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f));
});
await new Promise((r) => s.listen(0, r));
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1600);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.evaluate(() => document.getElementById('modo-editor')?.click());
await p.evaluate(() => window.qa.medirAnadir('disyuntor-1p', 5));
// Se suelta el último aparato con un clic en la placa: Esc lo borraría y además gastaría un paso
// de historial, y aquí hace falta saber exactamente cuántos hay y cuántos Ctrl+Z quedan.
await p.mouse.click(700, 500);
await p.waitForTimeout(700);

const est = () => p.evaluate(() => ({
	aparatos: window.qa.proyecto().dispositivos.length,
	dialogo: !document.getElementById('modal-dialogo').hidden,
	pregunta: document.getElementById('dialogo-msg')?.textContent ?? '',
}));
const elegir = () => p.evaluate(() =>
	window.qa.seleccionarPorId(window.qa.proyecto().gabinete.colocaciones[0].dispositivoId));

/*
 * CONDICIÓN PREVIA: con el tablero delante, esas mismas teclas SÍ hacen lo suyo.
 *
 * Sin esto, una prueba que solo mirase «no pasó nada» pasaría también si los atajos estuvieran
 * rotos del todo, que no es lo que se quiere comprobar.
 */
const base = await est();
await p.keyboard.press('Control+z');
await p.waitForTimeout(700);
const trasDeshacer = await est();
must('CONDICIÓN PREVIA: con el tablero delante, Ctrl+Z deshace',
	trasDeshacer.aparatos === base.aparatos - 1, `${base.aparatos} → ${trasDeshacer.aparatos} aparatos`);
await p.keyboard.press('Control+y');
await p.waitForTimeout(700);

await elegir();
await p.keyboard.press('Delete');
await p.waitForTimeout(800);
const trasSupr = await est();
must('CONDICIÓN PREVIA: con el tablero delante, Supr pregunta si eliminar',
	trasSupr.dialogo, trasSupr.pregunta || 'no preguntó nada');

// Y ya que está abierto: Escape tiene que poder cerrarlo sin tocar el ratón.
await p.keyboard.press('Escape');
await p.waitForTimeout(500);
must('Escape cierra el «¿Eliminar…?» sin ir a buscar el ratón', !(await est()).dialogo,
	(await est()).dialogo ? 'sigue abierto' : 'cerrado');

const partida = await est();
console.log(`\npartida: ${partida.aparatos} aparatos\n`);

/** Aporrea los atajos que editan el tablero y devuelve qué cambió. */
const aporrear = async () => {
	await p.keyboard.press('Control+z');
	await p.waitForTimeout(500);
	await p.keyboard.press('Delete');
	await p.waitForTimeout(600);
	await p.keyboard.press('Control+v');
	await p.waitForTimeout(500);
	return est();
};

/* --- 1. Con la PLANTA 3D delante --- */
await elegir();
await p.evaluate(() => document.getElementById('btn-planta')?.click());
await p.waitForTimeout(6500);
await p.evaluate(() => document.getElementById('btn-cerrar-guia-mundo')?.click());
await p.waitForTimeout(600);
must('CONDICIÓN PREVIA: la Planta 3D está de verdad delante',
	await p.evaluate(() => !document.getElementById('mundo').hidden), '');
const conPlanta = await aporrear();
must('con la Planta 3D delante, los atajos no tocan el tablero',
	conPlanta.aparatos === partida.aparatos && !conPlanta.dialogo,
	`${partida.aparatos} → ${conPlanta.aparatos} aparatos`
	+ (conPlanta.dialogo ? ` · preguntó «${conPlanta.pregunta}»` : ' · sin preguntas'));
// Y las teclas de la Planta siguen llegando: H esconde y muestra sus paneles.
const panelesAntes = await p.evaluate(() => document.getElementById('mundo').classList.contains('sin-paneles'));
await p.keyboard.press('h');
await p.waitForTimeout(600);
const panelesDespues = await p.evaluate(() => document.getElementById('mundo').classList.contains('sin-paneles'));
must('la Planta 3D sigue oyendo sus propias teclas (H)', panelesAntes !== panelesDespues,
	`paneles escondidos: ${panelesAntes} → ${panelesDespues}`);

/*
 * Y ESCAPE TIENE QUE SEGUIR CERRANDO LO QUE ESTÁ ENCIMA.
 *
 * Escape no es un atajo de edición: es la tecla de «cierra la ventana de arriba», y el manejador
 * del tablero es el ÚNICO sitio donde se cierran. Al apartarlo con una herramienta delante lo
 * bloqueé sin querer, y con la ventana de INICIO —que es cómo arranca el programa— la guía rápida
 * y los datos del proyecto dejaban de cerrarse con el teclado. Lo cazó `qa/entrega.mjs` sobre el
 * archivo empaquetado, que es el único que arranca en Inicio de verdad; aquí se cubre también.
 */
await p.evaluate(() => document.getElementById('mundo-guia')?.click());
await p.waitForTimeout(600);
const guiaAbierta = await p.evaluate(() => !document.getElementById('modal-guia-mundo').hidden);
await p.keyboard.press('Escape');
await p.waitForTimeout(500);
must('con la Planta delante, Escape sigue cerrando la ventana de encima',
	guiaAbierta && await p.evaluate(() => document.getElementById('modal-guia-mundo').hidden),
	guiaAbierta ? 'la guía de la Planta se cerró' : 'no llegó a abrirse: no prueba nada');
await p.evaluate(() => document.getElementById('mundo-salir')?.click());
await p.waitForTimeout(1800);

/* --- 2. Con la ventana de INICIO delante --- */
await elegir();
await p.evaluate(() => { document.getElementById('inicio').hidden = false; });
await p.waitForTimeout(500);
const conInicio = await aporrear();
must('con la ventana de Inicio delante, los atajos no tocan el tablero',
	conInicio.aparatos === partida.aparatos && !conInicio.dialogo,
	`${partida.aparatos} → ${conInicio.aparatos} aparatos`
	+ (conInicio.dialogo ? ` · preguntó «${conInicio.pregunta}»` : ' · sin preguntas'));
await p.evaluate(() => { document.getElementById('inicio').hidden = true; });
await p.waitForTimeout(400);

/* --- 3. Corrigiendo el TEXTO DEL DOSSIER (contenteditable) --- */
await elegir();
await p.evaluate(() => document.getElementById('btn-pdf')?.click());   // abre el dossier editable
await p.waitForTimeout(3500);
await p.evaluate(() => document.getElementById('dos-add-texto')?.click());  // un apartado propio
await p.waitForTimeout(1200);
const enfocado = await p.evaluate(() => {
	const e = document.querySelector('[contenteditable="true"]');
	if (!e) return false;
	e.focus();
	return document.activeElement === e;
});
must('CONDICIÓN PREVIA: el cursor está dentro de un texto del dossier', enfocado,
	enfocado ? 'sí' : 'no se encontró ningún bloque editable');
const conDossier = await aporrear();
must('escribiendo en el dossier, Supr no pregunta por borrar un aparato',
	conDossier.aparatos === partida.aparatos && !conDossier.dialogo,
	`${partida.aparatos} → ${conDossier.aparatos} aparatos`
	+ (conDossier.dialogo ? ` · preguntó «${conDossier.pregunta}»` : ' · sin preguntas'));

must('sin errores de JavaScript', errs.length === 0, errs.slice(0, 2).join(' | ') || 'ninguno');

console.log(`\n${fallos === 0 ? '✅ CADA HERRAMIENTA CON SUS TECLAS' : `❌ ${fallos} FALLO(S)`}`);
await b.close(); s.close();
process.exit(fallos ? 1 : 0);
