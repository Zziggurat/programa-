/**
 * QA del ZOOM de la Planta 3D: la rueda tiene tope, y acerca a donde se mira.
 *
 * Auditoría TS-P1-05. `OrbitControls` viene sin límites de acercamiento, y en una planta de
 * 690 × 293 m eso no es un detalle. Medido antes del arreglo, empezando a 468 m del centro:
 *
 *     60 muescas de rueda hacia atrás  →   103.827.876 m  (103.000 km)
 *    120 muescas de rueda hacia atrás  → 23.048.820.267.856 m  (más lejos que Plutón)
 *
 * El plano de fondo de la cámara está en `far`, unos 2,2 km. O sea que muchísimo antes de llegar
 * ahí la cubierta deja de dibujarse y la pantalla se queda NEGRA, sin un mensaje ni una pista:
 * quien la está usando no puede saber si el programa se colgó o si se fue de viaje. Hacia dentro
 * pasaba lo simétrico —la cámara atraviesa la máquina y se queda dentro del chasis—.
 *
 * Lo que se comprueba aquí es lo que se ve, no los números de la implementación:
 *   · por mucho que se gire la rueda, la planta sigue DENTRO del plano de fondo;
 *   · por mucho que se gire al revés, la cámara no se mete dentro de una máquina;
 *   · «Vista general» reencuadra siempre, que es la salida de emergencia;
 *   · la rueda apuntando a un lado lleva la vista HACIA ese lado (zoom al cursor).
 *
 *   node qa/planta-zoom.mjs
 */
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';
const AQUI = dirname(fileURLToPath(import.meta.url)); const { servidor: s } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1500);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.evaluate(() => document.getElementById('btn-planta')?.click());
await p.waitForTimeout(6000);
await p.evaluate(() => document.getElementById('btn-cerrar-guia-mundo')?.click());
await p.waitForTimeout(600);

/** Dónde está la cámara y a qué distancia del centro de la planta. */
const donde = () => p.evaluate(() => {
	const c = window.__plantaQA.camara();
	return { x: c.x, y: c.y, z: c.z, d: Math.hypot(c.x, c.y, c.z) };
});
const tamano = await p.evaluate(() => window.__plantaQA.tamano());
const lado = Math.max(tamano.ancho, tamano.fondo);
// Mismo `far` que monta la Planta: es el plano tras el cual ya no se dibuja nada.
const far = Math.max(1200, lado * 3.2);

const rueda = async (dy, veces, x = 700, y = 450) => {
	await p.mouse.move(x, y);
	for (let i = 0; i < veces; i++) await p.mouse.wheel(0, dy);
	await p.waitForTimeout(900);
};

const inicio = await donde();
console.log(`planta ${Math.round(tamano.ancho)} × ${Math.round(tamano.fondo)} m · `
	+ `far = ${Math.round(far)} m · cámara inicial a ${Math.round(inicio.d)} m`);

/* --- 1. Alejarse a lo bestia: la planta tiene que seguir viéndose --- */
await rueda(400, 45);
const lejos = await donde();
// La esquina más lejana de la cubierta está, como mucho, a media diagonal del centro.
const mediaDiagonal = Math.hypot(tamano.ancho, tamano.fondo) / 2;
must('45 muescas de rueda no sacan la planta del plano de fondo',
	lejos.d + mediaDiagonal < far,
	`cámara a ${Math.round(lejos.d)} m; el borde más lejano quedaría a `
	+ `${Math.round(lejos.d + mediaDiagonal)} m de ${Math.round(far)}`);

await rueda(400, 45);
const masLejos = await donde();
must('seguir girando la rueda ya no aleja más', Math.abs(masLejos.d - lejos.d) < 1,
	`${Math.round(lejos.d)} m → ${Math.round(masLejos.d)} m`);

/* --- 2. «Vista general» reencuadra: la salida de emergencia --- */
await p.evaluate(() => document.getElementById('mundo-sims').click());
await p.waitForTimeout(800);
const reencuadrada = await donde();
must('«Vista general» devuelve la vista de siempre', Math.abs(reencuadrada.d - inicio.d) < 1,
	`${Math.round(masLejos.d)} m → ${Math.round(reencuadrada.d)} m (de inicio: ${Math.round(inicio.d)} m)`);

/* --- 3. Acercarse a lo bestia: no meterse dentro de una máquina --- */
// Se enfoca una máquina de verdad —de las que están situadas en el plano—, que es cuando uno se
// acerca a mirarla de cerca.
const objetivo = await p.evaluate(() => {
	const e = window.__plantaQA.equipos.find((x) => x.x != null && x.ancho);
	return { tag: e.tag, ancho: (e.ancho ?? 0) / 1000, fondo: (e.fondo ?? 0) / 1000 };
});
/*
 * CON EL SEGUNDO ARGUMENTO. Segunda auditoría, TS2-P2-10: aquí se llamaba `seleccionar(t)` a
 * secas, y `enfocar` vale `false` por defecto. O sea que el caso que esta suite anunciaba como
 * «máquina enfocada» no enfocaba la cámara: comprobaba el tope de acercamiento contra el encuadre
 * general, que es otra cosa y además la que ya comprueban los casos de arriba.
 */
await p.evaluate((t) => window.__plantaQA.seleccionar(t, true), objetivo.tag);
await p.waitForTimeout(900);
// Y se comprueba que ENFOCÓ de verdad, en vez de darlo por hecho: el punto de órbita tiene que
// haberse ido hasta la máquina. Sin esto, un cambio que rompa el enfoque dejaría la suite en
// verde midiendo otra cosa, que es exactamente lo que pasaba.
const dondeMira = await p.evaluate(() => window.__plantaQA.puntoDeOrbita());
// La posición se pide EN COORDENADAS DE ESCENA. Convertir las del plano a mano aquí fue el
// primer intento y salía «la vista mira a -53,-99 y la máquina está en 1571,475»: los equipos
// vienen en milímetros con el origen del DWG y la escena está centrada y en metros.
const posMaquina = await p.evaluate((t) => window.__plantaQA.posicionDeEquipo(t), objetivo.tag);
must('enfocar una máquina lleva la vista HASTA ella',
	!!posMaquina && Math.hypot(dondeMira.x - posMaquina.x, dondeMira.z - posMaquina.z) < 5,
	posMaquina
		? `la vista mira a ${dondeMira.x.toFixed(1)},${dondeMira.z.toFixed(1)} y la máquina está en `
			+ `${posMaquina.x.toFixed(1)},${posMaquina.z.toFixed(1)}`
		: 'la sonda no encontró la máquina en la escena');
const antesDeAcercar = await donde();
await rueda(-400, 60);
const cerca = await donde();
const dist = Math.hypot(cerca.x - antesDeAcercar.x, cerca.y - antesDeAcercar.y, cerca.z - antesDeAcercar.z);
// La cámara puede acercarse todo lo que quiera al punto de órbita menos el tope; lo que no puede
// es llegar a cero, que es lo que la mete dentro del chasis de la máquina enfocada.
const alPunto = await p.evaluate(() => {
	const c = window.__plantaQA.camara(); const t = window.__plantaQA.puntoDeOrbita();
	return Math.hypot(c.x - t.x, c.y - t.y, c.z - t.z);
});
must('60 muescas acercando no meten la cámara dentro de la máquina', alPunto >= 4.5,
	`${objetivo.tag} mide ${objetivo.ancho.toFixed(1)} × ${objetivo.fondo.toFixed(1)} m; la cámara `
	+ `se queda a ${alPunto.toFixed(1)} m del punto de mira tras recorrer ${Math.round(dist)} m`);

/* --- 4. La rueda acerca a DONDE SE MIRA, no siempre al centro --- */
await p.evaluate(() => document.getElementById('mundo-sims').click());
await p.waitForTimeout(800);
// Se esconden los paneles (tecla H): así se garantiza que la rueda cae sobre la cubierta y no
// sobre el buscador o la ficha, que no giran la cámara y darían un falso «no se mueve».
await p.evaluate(() => document.getElementById('mundo-paneles').click());
await p.waitForTimeout(600);
const puntoAntes = await p.evaluate(() => window.__plantaQA.puntoDeOrbita());
const camAntes = await donde();
// Rueda apuntando lejos del centro de la pantalla: el punto al que se mira tiene que MOVERSE.
await rueda(-400, 8, 1050, 640);
const puntoDespues = await p.evaluate(() => window.__plantaQA.puntoDeOrbita());
const camDespues = await donde();
const corrido = Math.hypot(puntoDespues.x - puntoAntes.x, puntoDespues.z - puntoAntes.z);
must('la rueda de verdad acerca', camDespues.d < camAntes.d - 20,
	`${Math.round(camAntes.d)} m → ${Math.round(camDespues.d)} m`);
must('la rueda lleva la vista hacia donde apunta el ratón', corrido > 5,
	`el punto de órbita se corrió ${corrido.toFixed(1)} m por la cubierta`);

must('sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | ') || 'ninguno');

console.log(`\n${fallos === 0 ? '✅ ZOOM CON TOPES' : `❌ ${fallos} FALLO(S)`}`);
await b.close(); s.close();
process.exit(fallos ? 1 : 0);
