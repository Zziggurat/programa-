/**
 * QA de las ENTRADAS que no son un archivo: plantilla dañada y portapapeles corrupto.
 *
 * Tercera auditoría, TS3-P1-06 y TS3-P2-01. Las dos vivían en `localStorage`, las dos se leían
 * con un `JSON.parse` y a usar la estructura tal cual, y las dos tiraban el programa:
 *
 *   {proyecto:{}}      → «Cannot read properties of undefined (reading 'length')» al abrir la
 *                        biblioteca, que se quedaba sin abrir aunque hubiera plantillas buenas
 *   {aparatos:[null]}  → «Cannot read properties of null (reading 'ancho')» al pegar
 *
 * Que vivan en el navegador y no lleguen por correo no las hace de fiar: las escribe una versión
 * del programa que puede no ser la que las lee, y sobreviven entre sesiones.
 *
 *   node qa/entradas-hostiles.mjs
 */
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor: s } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));

await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1600);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());

/* ============ 1. Cinco plantillas buenas y una rota ============ */
console.log('--- una plantilla dañada entre cinco buenas ---');
await p.evaluate(() => {
	const buena = window.qa.proyecto();
	const lista = [];
	for (let i = 1; i <= 5; i++) {
		lista.push({ nombre: `Buena ${i}`, fecha: new Date().toISOString(), proyecto: buena });
	}
	// La rota va EN MEDIO a propósito: si el fallo para el bucle, se ven las de antes y no las
	// de después, y con la rota al final no se notaría nada.
	lista.splice(2, 0, { nombre: 'Rota', fecha: 'no-es-una-fecha', proyecto: {} });
	localStorage.setItem('tablerostudio-plantillas', JSON.stringify(lista));
});
errs.length = 0;
await p.evaluate(() => document.getElementById('btn-ejemplos')?.click());
await p.waitForTimeout(900);

const bib = await p.evaluate(() => ({
	abierta: !document.getElementById('modal-ejemplos').hidden,
	tarjetas: document.querySelectorAll('#lista-ejemplos .tarjeta-ejemplo').length,
	abribles: document.querySelectorAll('#lista-ejemplos [data-plantilla]').length,
	cuarentena: document.querySelectorAll('#lista-ejemplos .en-cuarentena').length,
	descargables: document.querySelectorAll('#lista-ejemplos [data-bajar-plantilla]').length,
}));
must('la biblioteca se abre igual', bib.abierta);
must('las cinco buenas se pueden abrir', bib.abribles === 5, `${bib.abribles} abribles`);
must('y la rota sale en cuarentena, no desaparece', bib.cuarentena === 1, JSON.stringify(bib));
must('   con un botón para descargarla tal cual está', bib.descargables === 1);
must('sin un solo error de JavaScript', errs.length === 0, errs.slice(0, 2).join(' | '));

// Abrir una de las buenas tiene que seguir funcionando con la rota en la lista.
const antes = await p.evaluate(() => window.qa.proyecto().nombre);
await p.evaluate(() => document.querySelector('#lista-ejemplos [data-plantilla]')?.click());
await p.waitForTimeout(400);
await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
await p.waitForTimeout(800);
must('y una plantilla buena se abre con la rota en la lista',
	await p.evaluate(() => window.qa.proyecto().nombre.startsWith('Buena')),
	`antes «${antes}», ahora «${await p.evaluate(() => window.qa.proyecto().nombre)}»`);

/* ============ 2. El portapapeles corrupto ============ */
console.log('\n--- el portapapeles con basura dentro ---');
await p.evaluate(() => { document.getElementById('modal-ejemplos').hidden = true; });
for (const [rot, valor] of [
	['{aparatos:[null]}', '{"aparatos":[null]}'],
	['aparatos que no es lista', '{"aparatos":"nada"}'],
	['un aparato sin medidas', '{"aparatos":[{"dispositivo":{"id":"d","tipo":"disyuntor","bornes":[]}}]}'],
	['JSON a medias', '{"aparatos":['],
	['un aparato sin id', '{"aparatos":[{"dispositivo":{"tipo":"disyuntor"},"ancho":18,"alto":85}]}'],
]) {
	errs.length = 0;
	const aparatosAntes = await p.evaluate(() => window.qa.proyecto().dispositivos.length);
	await p.evaluate((v) => localStorage.setItem('tablerostudio-portapapeles', v), valor);
	await p.evaluate(() => document.getElementById('mundo').hidden = true);
	await p.keyboard.press('Control+v');
	await p.waitForTimeout(600);
	const despues = await p.evaluate(() => window.qa.proyecto().dispositivos.length);
	must(`«${rot}»: no revienta`, errs.length === 0, errs.slice(0, 1).join(''));
	must(`«${rot}»: y no mete nada raro en el tablero`, despues === aparatosAntes,
		`${aparatosAntes} → ${despues}`);
}

// Y copiar/pegar de verdad tiene que seguir funcionando.
console.log('\n--- y el copiar/pegar normal sigue funcionando ---');
await p.evaluate(() => localStorage.removeItem('tablerostudio-portapapeles'));
// La plantilla que se abrió arriba venía de un tablero vacío: se saca un aparato del catálogo
// para tener algo que copiar. Sin esto la comprobación decía «el tablero estaba vacío», que es
// verdad y no prueba nada del copiar/pegar.
await p.evaluate(() => window.qa.medirAnadir('disyuntor-1p', 1));
await p.mouse.click(700, 500);
await p.waitForTimeout(700);
const ok = await p.evaluate(() => {
	const pr = window.qa.proyecto();
	const d = pr.gabinete?.colocaciones?.[0]?.dispositivoId;
	if (!d) return false;
	window.qa.seleccionarPorId(d);
	return true;
});
if (ok) {
	const antesN = await p.evaluate(() => window.qa.proyecto().dispositivos.length);
	await p.keyboard.press('Control+c'); await p.waitForTimeout(300);
	await p.keyboard.press('Control+v'); await p.waitForTimeout(800);
	const despuesN = await p.evaluate(() => window.qa.proyecto().dispositivos.length);
	must('Ctrl+C / Ctrl+V pega un aparato', despuesN === antesN + 1, `${antesN} → ${despuesN}`);
} else {
	must('había un aparato que copiar', false, 'el tablero estaba vacío');
}

await b.close(); s.close();
console.log(`\n=== ${fallos === 0 ? 'plantillas y portapapeles aguantan basura ✔' : `${fallos} FALLO(S) ✗`} ===`);
process.exit(fallos ? 1 : 0);
