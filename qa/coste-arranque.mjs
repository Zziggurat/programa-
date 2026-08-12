/**
 * CUÁNTO CUESTA ARRANCAR Y MOVERSE. Los números, medidos, no supuestos.
 *
 * Tercera auditoría, TS3-P3-02: «El archivo único de 2,53 MB cumple el objetivo legítimo de abrirse
 * sin instalación ni red. `inlineDynamicImports` es, por tanto, una decisión documentada y no un bug
 * por sí sola. […] Medir en un equipo objetivo: tiempo hasta primer tablero interactivo, memoria en
 * reposo, memoria después de Planta, frame time y tiempo de PDF. No perseguir solo kilobytes».
 *
 * Eso es exactamente lo que hace esto, y nada más. NO optimiza: pone los cinco números encima de la
 * mesa para que la próxima vez se puedan comparar. Sin la medida, «va rápido» y «va lento» son
 * opiniones, y cualquier cambio en el arranque pasa sin que nadie se entere hasta que el compañero
 * se queja.
 *
 * LOS TOPES SON DE ROTURA, NO DE OBJETIVO. Aquí se dibuja por software (SwiftShader), sin tarjeta
 * gráfica: los tiempos no se parecen a los de un portátil normal y poner un tope ajustado sería
 * fabricar una prueba que falla sola los martes. Lo que se vigila es que algo se haya ROTO —treinta
 * segundos para abrir un tablero, un dossier que no termina—, y lo que se lee son las cifras.
 *
 * La memoria sale de `performance.memory`, que es de Chromium y no está en otros navegadores. Si no
 * está, se dice y se sigue: es un dato menos, no un fallo.
 *
 *   node qa/coste-arranque.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const { servidor } = await servidorDeQA();
const b = await abrirNavegador(chromium);
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const cifras = [];
const apuntar = (que, valor, unidad) => { cifras.push({ que, valor, unidad }); };
const qa = (fn, ...a) => p.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

const memoriaMB = () => p.evaluate(() => {
	const m = performance.memory;
	return m ? Math.round(m.usedJSHeapSize / 1048576) : null;
});

/* ---- 1 · Hasta el primer tablero con el que se puede trabajar ---- */

console.log('--- hasta el primer tablero interactivo ---');
const t0 = Date.now();
await p.goto(`http://127.0.0.1:${servidor.address().port}/?qa=1&inicio=0`);
/*
 * «Interactivo» no es que se haya pintado el HTML: es que se puede EMPEZAR A TRABAJAR. O sea, que
 * el catálogo tiene aparatos que pulsar y que la sonda contesta, que es cuando el editor está
 * montado de verdad. Medir hasta `load` daría un número bonito y falso.
 */
await p.waitForFunction(() => !!window.qa?.proyecto
	&& document.querySelectorAll('#catalogo button').length > 0, { timeout: 60_000 });
const tInteractivo = Date.now() - t0;
apuntar('primer tablero interactivo', tInteractivo, 'ms');
must('el editor arranca (tope de rotura: 30 s)', tInteractivo < 30_000, `${tInteractivo} ms`);

await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(300);

const memReposo = await memoriaMB();
if (memReposo === null) console.log('     (sin performance.memory: la memoria no se puede medir aquí)');
else { apuntar('memoria en reposo', memReposo, 'MB'); }

/* ---- 2 · Un tablero de trabajo de verdad ---- */

console.log('\n--- con un tablero cargado ---');
const tCarga = Date.now();
await p.evaluate(() => document.getElementById('btn-empezar-ejemplo')?.click());
await p.waitForTimeout(400);
if (await p.isVisible('#modal-ejemplos')) {
	await p.locator('.tarjeta-ejemplo button').nth(2).click();
	await p.waitForFunction(() => (window.qa?.proyecto()?.dispositivos.length ?? 0) > 3, { timeout: 60_000 });
	if (await p.isVisible('#modal-dialogo')) await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
	await p.waitForTimeout(300);
	await p.evaluate(() => document.getElementById('btn-cerrar-explicacion')?.click());
	await trabajarSobreCopia(p);
	await p.waitForTimeout(200);
}
apuntar('abrir un ejemplo', Date.now() - tCarga, 'ms');
const aparatos = (await p.evaluate(() => window.qa.proyecto())).dispositivos.length;
must('CONDICIÓN PREVIA: hay un tablero de verdad en pantalla', aparatos > 3, `${aparatos} aparatos`);

/* ---- 3 · Frame time ---- */

/*
 * SE CRONOMETRA EL RENDER, NO EL `requestAnimationFrame`.
 *
 * El primer intento midió el hueco entre llamadas de rAF sobre 60 fotogramas, y dio 1.814 ms por
 * fotograma: medio fotograma por segundo. Eso no es lo que cuesta dibujar el tablero —el editor va
 * fino— sino que en una pestaña sin pantalla el navegador estrangula el rAF y llama cuando quiere.
 * La prueba estaba midiendo el andamiaje y llamándolo rendimiento del programa.
 *
 * Con `window.qa.medirDibujado()` se llama al render 30 veces seguidas y se cronometra cada una,
 * que es el coste de verdad de pintar la escena que hay montada.
 */
console.log('\n--- fluidez ---');
const frame = await qa('medirDibujado', 30);
apuntar('dibujar un fotograma (mediana)', frame.mediana, 'ms');
apuntar('dibujar un fotograma (el peor)', frame.peor, 'ms');
must('el dibujado no está atascado (tope de rotura: 500 ms por fotograma)', frame.mediana < 500,
	`${frame.mediana} ms`);

/* ---- 4 · El dossier en PDF, que es lo más caro que hace el programa ---- */

/*
 * Este es el número que más BAILA de todos: dos medidas seguidas, sin tocar nada, dieron 7,4 s y
 * 63,7 s. No es el programa —es que el contenedor comparte CPU con lo que haya al lado—. Por eso
 * el tope está donde está: lo que se vigila aquí es que el dossier TERMINE, no cuánto tarda. La
 * cifra de la tabla solo sirve comparada consigo misma en la misma máquina y en la misma tarde.
 */
console.log('\n--- dossier en PDF ---');
const tPdf = Date.now();
await p.evaluate(() => document.getElementById('btn-pdf').click());
await p.waitForFunction(() => /KB/.test(document.getElementById('dos-estado')?.textContent ?? ''),
	{ timeout: 240_000 });
const msPdf = Date.now() - tPdf;
apuntar('dossier en PDF (muy variable)', msPdf, 'ms');
must('el dossier termina (tope de rotura: 180 s)', msPdf < 180_000, `${msPdf} ms`);
await p.evaluate(() => document.getElementById('dos-cerrar').click());
await p.waitForTimeout(400);

/* ---- 5 · Y la Planta, que es la otra herramienta entera ---- */

console.log('\n--- después de abrir la Planta ---');
const tPlanta = Date.now();
await p.evaluate(() => document.getElementById('btn-planta').click());
await p.waitForFunction(() => {
	const m = document.getElementById('mundo');
	return m && !m.hidden && document.getElementById('mundo-lienzo')?.clientWidth > 0;
}, { timeout: 120_000 });
await p.waitForTimeout(2500);   // que termine de construirse la cubierta entera
const msPlanta = Date.now() - tPlanta;
apuntar('abrir la Planta', msPlanta, 'ms');
must('la Planta abre (tope de rotura: 60 s)', msPlanta < 60_000, `${msPlanta} ms`);

const memPlanta = await memoriaMB();
if (memPlanta !== null) {
	apuntar('memoria con la Planta abierta', memPlanta, 'MB');
	apuntar('lo que añade la Planta', memPlanta - (memReposo ?? 0), 'MB');
}

/* ---- El informe, que es para lo que está esto ---- */

console.log('\n=== COSTE MEDIDO (dibujado por software, sin tarjeta gráfica) ===');
const ancho = Math.max(...cifras.map((c) => c.que.length));
for (const c of cifras) console.log(`  ${c.que.padEnd(ancho)}  ${String(c.valor).padStart(7)} ${c.unidad}`);
console.log('\nEstas cifras son PARA COMPARAR entre versiones, no para presumir: en un equipo con');
console.log('tarjeta gráfica salen mucho más bajas. Lo que importa es si suben de golpe.');

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ===`);
await b.close(); servidor.close();
process.exit(fallos === 0 ? 0 : 1);
