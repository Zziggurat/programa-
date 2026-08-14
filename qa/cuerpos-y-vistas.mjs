/**
 * QUE LOS APARATOS SEAN CUERPOS, NO CARTONES QUE SE ATRAVIESAN.
 *
 * La queja era «se ven en el aire las cosas» y «no parece profesional». Mirando la escena de
 * cerca, lo que había debajo era esto, y no se veía de frente:
 *
 *   · el cable se enganchaba SIEMPRE a 46 mm de fondo, pero cada modelo pintaba sus bornes a
 *     otra cota —60 el disyuntor, 68 el contactor, 16 el relé, 6 el pulsador—, así que el cable
 *     nacía dentro del cuerpo, por detrás del tornillo del que decía salir;
 *   · esas filas de bornes caían dentro del plástico macizo: geometría enterrada, invisible, que
 *     solo servía para interpenetrar con la carcasa;
 *   · la tapa del portafusible giraba sobre su centro, así que media tapa se hundía diez
 *     milímetros dentro del propio fusible y la punta se salía cuatro por delante de la huella
 *     declarada, por donde pasan los cables;
 *   · la bobina del transformador era un bloque MÁS GRUESO que el núcleo, metido dentro de él.
 *
 * Nada de eso da error ni se nota de frente. Se mide, y entonces salta. Esta suite mide.
 *
 * Y además deja las siete vistas hechas para poder mirarlas: frente, diagonal por los dos lados,
 * perfil, planta, y dos acercamientos.
 *
 *   node qa/cuerpos-y-vistas.mjs [carpeta-de-capturas]
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
	for (const cerrar of ['dialogo-ok', 'btn-cerrar-explicacion']) {
		const modal = cerrar === 'dialogo-ok' ? '#modal-dialogo' : '#modal-explicacion';
		if (await p.isVisible(modal)) {
			await p.evaluate((id) => document.getElementById(id)?.click(), cerrar);
			await p.waitForTimeout(700);
		}
	}
}

const solape = (a, b, eje) => Math.min(a[`max${eje}`], b[`max${eje}`]) - Math.max(a[`min${eje}`], b[`min${eje}`]);

/* ================================================================== */

console.log('### 1 · cada aparato ocupa su sitio y solo el suyo');
await abrirEjemplo(1);   // estrella-triángulo: el más poblado y el que más cables cruza
const cuerpos = await qa('cuerpos');
must('hay aparatos que medir', cuerpos.length > 0, `${cuerpos.length} aparatos`);

/*
 * 1.a — NADIE SE SALE DE SU HUELLA.
 *
 * La huella (x, y, ancho, alto) es lo que el editor reserva para el aparato: es con lo que
 * comprueba que dos aparatos no chocan y con lo que reparte los corredores por los que van los
 * cables. Si la geometría se sale de ella, el programa cree que hay hueco donde no lo hay, y el
 * cable se tiende por encima de un plástico que no sabía que estaba ahí.
 *
 * Se deja 3 mm de margen: los rótulos y las patas de fijación sobresalen a propósito.
 */
const MARGEN = 3;
const desbordados = cuerpos.filter((c) => (
	c.minX < c.x - MARGEN || c.maxX > c.x + c.ancho + MARGEN
	|| c.minY < c.y - MARGEN || c.maxY > c.y + c.alto + MARGEN
));
must('ningún aparato se sale de su huella', desbordados.length === 0,
	desbordados.map((c) => `${c.id} (${Math.round(c.minX - c.x)}…${Math.round(c.maxX - c.x - c.ancho)} mm)`).join(', ')
	|| `${cuerpos.length} dentro`);

/*
 * 1.b — NINGÚN APARATO ATRAVIESA A OTRO.
 *
 * Dos aparatos vecinos en el mismo riel se tocan, y eso está bien; lo que no puede haber es que
 * uno META cuerpo dentro del otro. Se mide el solape en los tres ejes a la vez: si los tres son
 * positivos, los volúmenes se cruzan de verdad.
 */
let penetraciones = [];
for (let i = 0; i < cuerpos.length; i++) {
	for (let j = i + 1; j < cuerpos.length; j++) {
		const dx = solape(cuerpos[i], cuerpos[j], 'X');
		const dy = solape(cuerpos[i], cuerpos[j], 'Y');
		const dz = solape(cuerpos[i], cuerpos[j], 'Z');
		const menor = Math.min(dx, dy, dz);
		if (menor > 1.5) penetraciones.push(`${cuerpos[i].id}∩${cuerpos[j].id} ${menor.toFixed(1)} mm`);
	}
}
must('ningún aparato se mete dentro de otro', penetraciones.length === 0,
	penetraciones.slice(0, 6).join(', ') || `${cuerpos.length * (cuerpos.length - 1) / 2} pares limpios`);

/*
 * 1.c — TODOS ARRANCAN EN LA PLACA Y NINGUNO SE VA AL FONDO.
 *
 * Un aparato con geometría por detrás de z=0 estaría metido dentro de la placa de montaje, y uno
 * con el frente más allá del fondo del armario, atravesando la puerta.
 */
const hundidos = cuerpos.filter((c) => c.minZ < -1);
must('ningún aparato se hunde en la placa', hundidos.length === 0,
	hundidos.map((c) => `${c.id} z=${c.minZ.toFixed(1)}`).join(', '));
/*
 * 1.d — NADIE SE COME EL CARRIL.
 *
 * Un TS35 ocupa los primeros 8 mm por detrás del aparato. Los cuerpos eran bloques macizos que
 * arrancaban en la placa, así que TODOS llevaban el carril metido dentro del plástico: dos
 * sólidos atravesándose, en cada aparato del tablero. De frente no se ve porque el carril queda
 * tapado; se ve al girar y se mide siempre. Solo la pinza puede bajar a agarrarse a los labios.
 */
const comenCarril = cuerpos.filter((c) => c.zSobreCarril !== null && c.zSobreCarril < 5);
must('ningún aparato lleva el carril dentro del cuerpo', comenCarril.length === 0,
	comenCarril.map((c) => `${c.id} z=${c.zSobreCarril.toFixed(1)}`).join(', ')
	|| `${cuerpos.length} con canal`);

const fondo = await p.evaluate(() => window.qa.proyecto().gabinete.profundidad);
const asomados = cuerpos.filter((c) => c.maxZ > fondo - 10);
must('ningún aparato llega a la puerta', asomados.length === 0,
	asomados.map((c) => `${c.id} z=${c.maxZ.toFixed(0)}/${fondo}`).join(', '));

/* ================================================================== */

console.log('\n### 2 · el cable sale del tornillo que se ve');
/*
 * Se compara el anclaje que usa el cable con la cota a la que el modelo pinta el tornillo. Es la
 * comprobación que faltaba: cada uno tenía su número y nadie los enfrentaba.
 */
const bornes = await p.evaluate(() => {
	const pr = window.qa.proyecto();
	// Solo los aparatos COLOCADOS en la placa. Los de campo (la red, el motor, la boya) entran
	// por un prensaestopas en el borde del armario, y su cable arranca allí a propósito.
	const enPlaca = new Set((pr.gabinete?.colocaciones ?? []).map((c) => c.dispositivoId));
	const puntos = [];
	for (const c of pr.conductores ?? []) {
		for (const extremo of [c.de, c.a]) {
			if (!enPlaca.has(extremo.dispositivoId)) continue;
			const a = window.qa.anclaje(extremo.dispositivoId, extremo.borneId);
			if (a) puntos.push({ id: `${extremo.dispositivoId}:${extremo.borneId}`, z: a.z });
		}
	}
	return puntos;
});
must('hay cables que comprobar', bornes.length > 0, `${bornes.length} extremos en la placa`);
const desalineados = bornes.filter((x) => Math.abs(x.z - 46) > 0.5);
must('todos los cables arrancan en la cota de conexión', desalineados.length === 0,
	desalineados.slice(0, 5).map((x) => `${x.id} z=${x.z}`).join(', ') || `${bornes.length} extremos a 46 mm`);
// Y esa cota tiene que caer dentro del cuerpo del aparato: si no, el tornillo estaría al aire.
const sinCuerpo = cuerpos.filter((c) => c.minZ > 46 || c.maxZ < 46);
must('la cota de conexión cae en el cuerpo de todos', sinCuerpo.length === 0,
	sinCuerpo.map((c) => `${c.id} ${c.minZ.toFixed(0)}…${c.maxZ.toFixed(0)}`).join(', '));

/* ================================================================== */

console.log('\n### 3 · las siete vistas');
/*
 * Mirar solo de frente es lo que dejó pasar el problema: de frente, un cable pegado a un plano y
 * un cable tendido en el espacio se ven igual. Se recorren los ángulos desde los que sí se nota.
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
// Se gira con el ratón de verdad, como el usuario: así se comprueba de paso que los controles
// llevan la cámara donde se pide y que la escena aguanta el giro.
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
const capturar = async (nombre) => { if (destino) await p.screenshot({ path: join(destino, `${nombre}.png`) }); };

await capturar('1-frente');
await girar(-150, 60); await capturar('2-diagonal-izquierda');
await girar(300, 0); await capturar('3-diagonal-derecha');
await girar(150, -50); await capturar('4-perfil');
await girar(-300, -140); await capturar('5-planta');
await girar(150, 90);                              // vuelta a la diagonal para los acercamientos
await acercar(6); await capturar('6-cerca-cableado');
await acercar(5); await capturar('7-cerca-aparato');
must('las siete vistas se dibujan sin romperse', errores.length === 0, errores.slice(0, 3).join(' | '));
if (destino) console.log(`     capturas en ${destino}`);

/* ================================================================== */

console.log('\n### 4 · lo mismo en los demás ejemplos');
for (const [i, nombre] of [[0, 'arranque directo'], [2, 'tablero de control'], [3, 'climatizador']]) {
	await abrirEjemplo(i);
	const cs = await qa('cuerpos');
	const fuera = cs.filter((c) => (
		c.minX < c.x - MARGEN || c.maxX > c.x + c.ancho + MARGEN
		|| c.minY < c.y - MARGEN || c.maxY > c.y + c.alto + MARGEN || c.minZ < -1
	));
	let cruces = 0;
	for (let a = 0; a < cs.length; a++) {
		for (let z = a + 1; z < cs.length; z++) {
			if (Math.min(solape(cs[a], cs[z], 'X'), solape(cs[a], cs[z], 'Y'), solape(cs[a], cs[z], 'Z')) > 1.5) cruces++;
		}
	}
	must(`${nombre}: cuerpos limpios`, fuera.length === 0 && cruces === 0,
		`${cs.length} aparatos, ${fuera.length} desbordados, ${cruces} cruces`);
}

console.log('');
must('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3).join(' | '));

await b.close();
servidor.close();
console.log(fallos ? `\n=== ${fallos} FALLOS ===` : '\n=== TODO OK ✔ ===');
process.exit(fallos ? 1 : 0);
