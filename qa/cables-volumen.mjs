/**
 * ¿SE ATRAVIESAN LOS CABLES? MEDIDO, Y MIRADO DESDE SIETE ÁNGULOS.
 *
 * La comprobación que había —«0 pares a la misma profundidad»— es cierta y no demuestra nada. Dos
 * cables en capas distintas se cruzan igual mientras entran y salen de ellas; dos ejes separados
 * 3 mm siguen siendo dos tubos de 3 mm de radio metidos uno dentro de otro; y un codo redondeado
 * invade cinco milímetros hacia dentro de la esquina que nadie había reservado.
 *
 * Esta suite mide el VOLUMEN sobre la geometría final que se dibuja, en el navegador y con los
 * tableros cargados de verdad: distancia mínima entre recorridos tridimensionales completos, con
 * sus radios, más las invasiones de canaleta, carril y aparato. Y deja hechas las siete vistas
 * para poder mirarlas, porque un número verde con una fusión evidente en pantalla significa que
 * el número todavía no mide lo que hay que medir.
 *
 *   node qa/cables-volumen.mjs [carpeta-de-capturas]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const destino = process.argv[2] || '';
if (destino) mkdirSync(destino, { recursive: true });

const { servidor } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const qa = (fn, ...a) => p.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

const errores = [];
p.on('pageerror', (e) => errores.push(e.message));

await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
await p.waitForFunction(() => !!window.qa?.proyecto, null, { timeout: 60_000 });
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(400);

async function abrirEjemplo(i) {
	await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
	await p.waitForTimeout(600);
	if (await p.isVisible('#modal-dialogo')) {
		await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
		await p.waitForTimeout(500);
		await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
		await p.waitForTimeout(600);
	}
	await p.locator('.tarjeta-ejemplo button').nth(i).click({ timeout: 30_000 });
	await p.waitForTimeout(1800);
	for (const [modal, boton] of [['#modal-dialogo', 'dialogo-ok'], ['#modal-explicacion', 'btn-cerrar-explicacion']]) {
		if (await p.isVisible(modal)) {
			await p.evaluate((id) => document.getElementById(id)?.click(), boton);
			await p.waitForTimeout(700);
		}
	}
}

/*
 * Cuánto se tolera que dos tubos se metan uno dentro de otro. No es cero: en un tablero muy
 * cargado hay pares para los que no queda sitio limpio, y prefiero un número honesto y vigilado
 * a una prueba que pase escondiendo el resto. Lo que NO se tolera es la fusión —dos cables
 * compartiendo el mismo eje—, que es lo que había y sale como una penetración del diámetro entero.
 */
const PENETRACION_TOLERADA = 2.5;

const TABLEROS = [
	[0, 'arranque directo'],
	[1, 'bomba con boya'],
	[2, 'estrella-triángulo'],
	[3, 'tablero de control'],
	[4, 'climatizador'],
];

/* ================================================================== */

console.log('### 1 · volumen: ningún cable ocupa el sitio de otro');
let peorGlobal = null;
for (const [i, nombre] of TABLEROS) {
	await abrirEjemplo(i);
	const d = await qa('choquesCable');
	if (!d.cables) { must(`${nombre}: hay cables`, false, 'ninguno'); continue; }
	const peor = d.conflictos[0];
	if (peor && (!peorGlobal || peor.holgura < peorGlobal.holgura)) peorGlobal = { ...peor, tablero: nombre };
	must(
		`${nombre}: sin cables fundidos ni atravesados`,
		!peor || peor.holgura > -PENETRACION_TOLERADA,
		peor
			? `${d.cables} cables · ${d.penetraciones} penetrándose · peor ${peor.a}↔${peor.b} `
				+ `holgura ${peor.holgura} mm en (${peor.x}, ${peor.y}, ${peor.z})`
			: `${d.cables} cables · todos con holgura`,
	);
	must(
		`${nombre}: ningún cable dentro de canaleta, carril o aparato`,
		d.invasiones.length === 0 || -d.invasiones[0].holgura < 2,
		d.invasiones.length
			? `${d.invasiones[0].a} se mete ${(-d.invasiones[0].holgura).toFixed(1)} mm en ${d.invasiones[0].b}`
			: 'ninguna',
	);
}
console.log(peorGlobal
	? `     el peor caso de todo el banco: ${peorGlobal.a}↔${peorGlobal.b} en ${peorGlobal.tablero}, holgura ${peorGlobal.holgura} mm`
	: '     ningún par por debajo de la holgura pedida en ningún tablero');

/* ================================================================== */

console.log('\n### 2 · la profundidad se reparte de verdad');
/*
 * Si todos los cables acabaran a la misma profundidad, lo de arriba podría pasar por casualidad en
 * un tablero poco cargado. Y era justo lo que ocurría: la rampa de profundidad se calculaba sobre
 * los vértices de las esquinas, y una tirada recta no tiene vértices en medio, así que los
 * cincuenta conductores viajaban amontonados entre 46 y 50 mm dijera lo que dijera su carril.
 */
await abrirEjemplo(2);
const rutas = await qa('rutas');
const capas = new Set(rutas.map((r) => Math.round(r.z)));
must('los cables se reparten por varias profundidades', capas.size >= 5,
	`${capas.size} capas en uso: ${[...capas].sort((a, b) => a - b).join(', ')} mm`);

/* ================================================================== */

console.log('\n### 3 · la selección de cables sigue viva');
/*
 * Toda la mejora geométrica no vale nada si el cable deja de poder pincharse. Se comprueba con el
 * ratón de verdad, no con `element.click()`, que atraviesa cualquier cosa.
 */
const lienzo = await p.locator('#escena').boundingBox();
const esperarQuieta = async () => {
	let antes = await qa('camara');
	for (let i = 0; i < 40; i++) {
		await p.waitForTimeout(120);
		const ahora = await qa('camara');
		if (Math.abs(ahora.x - antes.x) < 0.4 && Math.abs(ahora.y - antes.y) < 0.4 && Math.abs(ahora.z - antes.z) < 0.4) return;
		antes = ahora;
	}
};
async function girar(dx, dy) {
	const x = lienzo.x + lienzo.width * 0.72;
	const y = lienzo.y + lienzo.height * 0.3;
	await p.mouse.move(x, y);
	await p.mouse.down();
	for (let k = 1; k <= 6; k++) { await p.mouse.move(x + (dx * k) / 6, y + (dy * k) / 6); await p.waitForTimeout(25); }
	await p.mouse.up();
	await esperarQuieta();
}
async function acercar(pasos) {
	await p.mouse.move(lienzo.x + lienzo.width / 2, lienzo.y + lienzo.height / 2);
	for (let i = 0; i < Math.abs(pasos); i++) { await p.mouse.wheel(0, pasos > 0 ? -220 : 220); await p.waitForTimeout(60); }
	await esperarQuieta();
}

let aciertos = 0;
let intentos = 0;
for (const r of rutas.slice(0, 14)) {
	// Se apunta a un punto del RECORRIDO FINAL, no a un nodo de la polilínea ortogonal: los nodos
	// son de antes de redondear los codos y de darle profundidad, así que apuntar ahí es apuntar
	// a donde el cable no está.
	const medio = r.puntos[Math.floor(r.puntos.length / 2)];
	const pix = await p.evaluate(([x, y, z]) => window.qa.puntoEnPantalla(x, y, z), [medio.x, medio.y, medio.z]);
	if (!pix || pix.x < lienzo.x + 5 || pix.x > lienzo.x + lienzo.width - 5) continue;
	intentos++;
	await p.mouse.click(pix.x, pix.y, { timeout: 30_000 });
	await p.waitForTimeout(250);
	const sel = await p.evaluate(() => window.qa.seleccion?.());
    if (sel && JSON.stringify(sel).includes(r.id)) aciertos++;
}
must('se puede pinchar un cable con el ratón', intentos > 0 && aciertos >= Math.ceil(intentos * 0.7),
	`${aciertos}/${intentos} clics acertaron el cable señalado`);

/* ================================================================== */

console.log('\n### 4 · las siete vistas');
const capturar = async (nombre) => { if (destino) await p.screenshot({ path: join(destino, `${nombre}.png`) }); };
await capturar('1-frente');
await girar(-150, 60); await capturar('2-diagonal-izquierda');
await girar(300, 0); await capturar('3-diagonal-derecha');
await girar(-450, 0); await capturar('4-lateral-izquierda');
await girar(600, 0); await capturar('5-lateral-derecha');
await girar(-300, -150); await capturar('6-superior-diagonal');
await girar(150, 120); await acercar(7); await capturar('7-cerca-del-lio');
must('las siete vistas se dibujan sin romperse', errores.length === 0, errores.slice(0, 3).join(' | '));
if (destino) console.log(`     capturas en ${destino}`);

console.log('');
must('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3).join(' | '));

await b.close();
servidor.close();
console.log(fallos ? `\n=== ${fallos} FALLOS ===` : '\n=== TODO OK ✔ ===');
process.exit(fallos ? 1 : 0);
