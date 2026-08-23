/**
 * QA de APARATOS FANTASMA: duplicar y pegar nunca dejan un aparato que no está en la placa.
 *
 * Auditoría TS-P1-10. Dos fallos distintos, los dos por tocar el proyecto antes de saber si el
 * aparato cabía:
 *
 *   A) `duplicarDispositivo` hacía `capturar()` y metía la copia en `proyecto.dispositivos`
 *      ANTES de buscarle sitio. Si no había hueco, hacía `return` y la copia se quedaba dentro
 *      sin colocación: invisible en la placa, pero contada en la lista de materiales, en el DRC
 *      y en el archivo guardado. Un aparato que el cliente paga y que nadie monta. Encima el
 *      `capturar()` dejaba un paso de historial de una operación que no llegó a pasar, así que
 *      el primer Ctrl+Z se gastaba en deshacer la nada.
 *
 *   B) `pegarAparatos` comprobaba el hueco del PRIMERO y pegaba todos con el mismo desfase.
 *      El que caía sobre un aparato ya montado, con su fila llena de lado a lado, se quedaba
 *      con `xLibreCercano(...) ?? col.x`: es decir, EXACTAMENTE encima del otro, tapado por él,
 *      mientras el aviso decía «1 aparato pegado» como si todo hubiera ido bien.
 *
 * QUÉ HACE FALTA PARA LLEGAR AHÍ (importa, porque si el montaje no es el de verdad la prueba
 * pasa con el código viejo y no demuestra nada):
 *
 *   · `buscarHueco` solo devuelve `undefined` si el gabinete NO TIENE NINGÚN RIEL. Con un riel,
 *     por lleno que esté, siempre contesta: pone el aparato al final del riel con más sitio
 *     aunque sobresalga de la placa. Quitar un riel NO se lleva los aparatos que tenía encima,
 *     así que «aparatos montados y cero rieles» es un estado normal: es el caso A.
 *   · `xLibreCercano` recorre TODO el ancho de la placa a esa altura de 5 en 5 mm. Solo falla si
 *     en esa fila no queda ni un hueco del ancho del aparato: es lo que hace falta para el B.
 *
 * Por eso el montaje se comprueba ANTES de probar nada: placa de 20 cm, un solo riel de lado a
 * lado y disyuntores hasta que la fila no admita ni uno más. Si esa condición previa no se
 * cumple, la prueba FALLA en vez de seguir y dar un OK que no valdría.
 *
 *   node qa/sin-fantasmas.mjs
 */
import { chromium } from 'playwright-core';
import { join, dirname } from 'node:path';import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';
const AQUI = dirname(fileURLToPath(import.meta.url)); const { servidor: s } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };

await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1800);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
// Ctrl+D, Ctrl+C y Ctrl+V solo responden en modo Editor: en Trabajo o Visualización no hacen nada.
await p.evaluate(() => document.getElementById('modo-editor')?.click());
await p.waitForTimeout(300);

/* ---------------------------------------------------------------------------------------------
 * MONTAJE: una placa estrecha con UN riel de borde a borde, para poder llenar la fila entera.
 * ------------------------------------------------------------------------------------------- */

/** Escribe en un input como lo haría el usuario (para que la app se entere del cambio). */
const escribir = (id, valor) => p.evaluate(({ id, valor }) => {
	const e = document.getElementById(id);
	e.value = String(valor);
	e.dispatchEvent(new Event('input', { bubbles: true }));
	e.dispatchEvent(new Event('change', { bubbles: true }));
}, { id, valor });

// La estructura vive en el cajón Montaje desde la reorganización de herramientas. Abrir solo el
// `<details>` deja el formulario oculto y no representa una acción posible del usuario.
await p.click('#hta-estructura');
await p.click('#seccion-estructura > summary');
await p.locator('#aplicar-dim').waitFor({ state: 'visible' });

// Primera pasada: encoger la placa. «Aplicar» estira/encoge los rieles con la placa, así que el
// largo del riel hay que ponerlo DESPUÉS, en una segunda pasada donde el ancho ya no cambia.
await escribir('dim-ancho', 20);
await escribir('dim-alto', 30);
await p.click('#aplicar-dim');
await p.waitForTimeout(400);

// Segunda pasada: riel1 de x=0 a x=200 (toda la placa).
await p.evaluate(() => {
	const fila = document.querySelector('#lista-rieles .fila-estructura');
	const poner = (campo, v) => {
		const e = fila.querySelector(`[data-campo="${campo}"]`);
		e.value = String(v); e.dispatchEvent(new Event('change', { bubbles: true }));
	};
	poner('x', 0); poner('largo', 200);
});
await p.click('#aplicar-dim');
await p.waitForTimeout(400);

/*
 * Y se quitan los otros dos rieles, con su ✕, que es como se quitan de verdad.
 *
 * No es adorno: `buscarHueco` recorre TODOS los rieles y, si alguno está vacío, manda ahí la
 * copia y no hay nada que reproducir. Con riel2 y riel3 puestos —fuera de la placa al encogerla,
 * pero puestos— el pegado se iba a y=215 tan contento. El fallo vive cuando el único riel que
 * hay es el que está lleno, así que el montaje tiene que dejar exactamente eso.
 */
await p.evaluate(() => {
	const filas = [...document.querySelectorAll('#lista-rieles .fila-estructura')];
	for (const f of filas.slice(1)) f.querySelector('[data-quitar]').click();
});
await p.waitForTimeout(400);

// Se llena la fila. `medirAnadir` llama al MISMO `anadirDesdeCatalogo` que el botón del catálogo.
// El último queda pegado al ratón (así nace un aparato del catálogo) y Esc lo cancela.
await p.evaluate(() => window.qa.medirAnadir('disyuntor-1p', 8));
await p.keyboard.press('Escape');
await p.waitForTimeout(600);

/** Radiografía del proyecto: lo que hace falta para juzgar las dos pruebas. */
const radiografia = () => p.evaluate(() => {
	const pr = window.qa.proyecto();
	const g = pr.gabinete;
	const cols = g.colocaciones;
	const solapan = [];
	for (let i = 0; i < cols.length; i++) {
		for (let j = i + 1; j < cols.length; j++) {
			const a = cols[i]; const c = cols[j];
			if (a.x < c.x + c.ancho && c.x < a.x + a.ancho && a.y < c.y + c.alto && c.y < a.y + a.alto) {
				solapan.push(`${a.dispositivoId}↔${c.dispositivoId}`);
			}
		}
	}
	// Un aparato de CAMPO (la red, el motor) vive fuera de la placa a propósito y no tiene
	// colocación: no es un fantasma. Fantasma es el que debería estar montado y no está.
	const fantasmas = pr.dispositivos
		.filter((d) => !d.campo && !d.imagen && !cols.some((c) => c.dispositivoId === d.id))
		.map((d) => d.designacion ?? d.id);
	return {
		rieles: g.rieles.length, ancho: g.ancho, alto: g.alto,
		aparatos: pr.dispositivos.length, colocaciones: cols.length,
		fantasmas, solapan,
		fila: cols.map((c) => ({ id: c.dispositivoId, x: c.x, y: c.y, w: c.ancho, h: c.alto })),
	};
});

/**
 * ¿Queda de verdad algún sitio libre para un aparato de ancho×alto en esa misma fila?
 *
 * Repite el barrido de `xLibreCercano` (todo el ancho útil, de 5 en 5 mm). Es la condición
 * previa de las dos pruebas: si esto dice que sí, el fallo original NO se puede reproducir y
 * cualquier OK posterior sería falso.
 */
const huecoEnLaFila = (y, ancho, alto) => p.evaluate(({ y, ancho, alto }) => {
	const g = window.qa.proyecto().gabinete;
	const choca = (x) => g.colocaciones.some((c) =>
		x < c.x + c.ancho && c.x < x + ancho && y < c.y + c.alto && c.y < y + alto);
	for (let x = 0; x <= g.ancho - ancho; x += 5) if (!choca(x)) return x;
	return undefined;
}, { y, ancho, alto });

const montaje = await radiografia();
const primero = montaje.fila[0];
console.log(`montaje: placa ${montaje.ancho}×${montaje.alto}, ${montaje.rieles} rieles, `
	+ `${montaje.colocaciones} aparatos en y=${primero?.y}`);
console.log('         ' + montaje.fila.map((c) => `${c.x}–${c.x + c.w}`).join(' '));

const libreAntes = await huecoEnLaFila(primero.y, primero.w, primero.h);
must('CONDICIÓN PREVIA: un solo riel, y lleno de lado a lado',
	montaje.rieles === 1 && montaje.colocaciones >= 7 && libreAntes === undefined,
	libreAntes === undefined ? `${montaje.rieles} riel, ${montaje.colocaciones} aparatos, ni un hueco de ${primero.w} mm`
		: `queda sitio en x=${libreAntes}: el fallo no se puede reproducir`);
must('CONDICIÓN PREVIA: la placa arranca sin fantasmas ni solapes',
	montaje.fantasmas.length === 0 && montaje.solapan.length === 0,
	`fantasmas=${montaje.fantasmas.length} solapes=${montaje.solapan.length}`);

/* ---------------------------------------------------------------------------------------------
 * B) PEGAR en una fila llena: la copia no puede quedar escondida debajo de otro aparato.
 * ------------------------------------------------------------------------------------------- */
console.log('\n--- B) pegar con la fila llena ---');
await p.evaluate(() => window.qa.seleccionarPorId(window.qa.proyecto().gabinete.colocaciones[0].dispositivoId));
await p.keyboard.press('Control+c');
await p.waitForTimeout(200);
await p.keyboard.press('Control+v');
await p.waitForTimeout(800);

const trasPegar = await radiografia();
must('se pegó el aparato', trasPegar.colocaciones === montaje.colocaciones + 1,
	`${montaje.colocaciones} → ${trasPegar.colocaciones}`);
must('la copia NO queda encima de otro aparato', trasPegar.solapan.length === 0,
	trasPegar.solapan.join(', ') || 'ninguna pareja se pisa');
must('lo pegado está montado (sin fantasmas)', trasPegar.fantasmas.length === 0,
	trasPegar.fantasmas.join(', ') || 'ninguno');

/* ---------------------------------------------------------------------------------------------
 * A) DUPLICAR sin rieles y sin hueco: no puede entrar un aparato que no se monta.
 * ------------------------------------------------------------------------------------------- */
console.log('\n--- A) duplicar sin rieles y sin hueco ---');
// Se quita el riel que queda con su ✕, como haría quien va a rehacer la estructura. Quitar un
// riel NO se lleva por delante los aparatos que tenía encima: por eso «aparatos y cero rieles»
// es un estado al que se llega sin hacer nada raro, y es justo donde `buscarHueco` se rinde.
await p.evaluate(() => {
	for (const btn of [...document.querySelectorAll('#lista-rieles [data-quitar]')]) btn.click();
});
await p.waitForTimeout(600);

const sinRieles = await radiografia();
must('CONDICIÓN PREVIA: no queda ningún riel y los aparatos siguen puestos',
	sinRieles.rieles === 0 && sinRieles.colocaciones === trasPegar.colocaciones,
	`${sinRieles.rieles} rieles, ${sinRieles.colocaciones} aparatos`);

await p.evaluate(() => window.qa.seleccionarPorId(window.qa.proyecto().gabinete.colocaciones[0].dispositivoId));
await p.waitForTimeout(200);
await p.keyboard.press('Control+d');
await p.waitForTimeout(800);

const trasDuplicar = await radiografia();
must('el duplicado imposible no deja un aparato fantasma', trasDuplicar.fantasmas.length === 0,
	trasDuplicar.fantasmas.join(', ') || 'ninguno');
must('el duplicado imposible no cambia el proyecto',
	trasDuplicar.aparatos === sinRieles.aparatos && trasDuplicar.colocaciones === sinRieles.colocaciones,
	`${sinRieles.aparatos} aparatos → ${trasDuplicar.aparatos}`);
must('sigue avisando de que no cabe',
	(await p.evaluate(() => document.getElementById('toast')?.textContent ?? '')).toLowerCase().includes('sitio'),
	await p.evaluate(() => document.getElementById('toast')?.textContent ?? ''));

// Y el Ctrl+Z siguiente tiene que deshacer el ÚLTIMO CAMBIO DE VERDAD —quitar el tercer riel—,
// no un paso de historial vacío que el duplicado fallido hubiera dejado a cuenta de nada. Con el
// fallo original, el `capturar()` del duplicado se colaba en la pila y ese Ctrl+Z se gastaba en
// quitar el fantasma: el riel seguía sin aparecer y había que pulsar dos veces sin explicación.
await p.keyboard.press('Control+z');
await p.waitForTimeout(800);
const trasDeshacer = await radiografia();
must('Ctrl+Z devuelve el riel quitado, no gasta el paso en el duplicado fallido',
	trasDeshacer.rieles === 1,
	`${sinRieles.rieles} rieles antes de Ctrl+Z → ${trasDeshacer.rieles} después`);

console.log(`\n${fallos === 0 ? '✅ SIN FANTASMAS' : `❌ ${fallos} FALLO(S)`}`);
await b.close(); s.close();
process.exit(fallos ? 1 : 0);
