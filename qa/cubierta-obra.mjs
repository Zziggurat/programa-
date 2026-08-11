/**
 * QA del LEVANTAMIENTO en la cubierta: el parte de obra y las tiradas que se guardan.
 *
 * Es lo que separa un visor de una herramienta de campo. Se comprueba de punta a punta:
 * anotar el estado de una máquina, que se vea en la lista y en el color del 3D, medir una tirada,
 * guardarla con su cable, que los metros se sumen por tipo de manguera, y —lo que de verdad
 * importa— que todo eso SIGA AHÍ al cerrar y volver a abrir la herramienta.
 *
 *   node qa/cubierta-obra.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAL = join(AQUI, '_salida'); mkdirSync(SAL, { recursive: true });
const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const click = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (!b) throw new Error('no existe #' + i); b.click(); }, id);
const qa = (f, ...a) => page.evaluate(([fn, args]) => window.__plantaQA[fn](...args), [f, a]);

async function abrirCubierta() {
	await page.goto(url, { waitUntil: 'load' });
	await page.waitForTimeout(1500);
	await click('btn-cerrar-ayuda'); await page.waitForTimeout(200);
/** La guía del visor se abre sola la primera vez: se cierra, como haría cualquiera al entrar. */
async function cerrarGuiaDelMundo() {
	if (await page.isVisible('#modal-guia-mundo')) {
		await page.evaluate(() => document.getElementById('btn-cerrar-guia-mundo')?.click());
		await page.waitForTimeout(300);
	}
}

	await click('btn-planta');
	await page.waitForTimeout(3500);
	await cerrarGuiaDelMundo();
}

await abrirCubierta();
must('el visor abre', await page.isVisible('#mundo'));
await qa('olvidarLevantamiento');   // que la prueba no dependa de lo que dejó la anterior

const tags = await page.evaluate(() => window.__plantaQA.equipos.slice(0, 3).map((e) => e.tag));

console.log('--- 1. Anotar el parte de obra de una máquina ---');
const nota = await qa('anotar', tags[0], 'problema', 'falta el prensaestopas de la entrada');
must('la nota se guarda con su estado', nota?.estado === 'problema', JSON.stringify(nota));
must('y con el texto tal cual se escribió', nota?.nota === 'falta el prensaestopas de la entrada');
must('la ficha enseña el estado marcado',
	await page.evaluate(() => !!document.querySelector('#mundo-ficha .chip-estado.activo')));

const avance1 = await qa('avance');
const de = (a, e) => a.find((x) => x.estado === e).cuantos;
must('el avance cuenta la máquina con problema', de(avance1, 'problema') === 1);
must('y lo que nadie ha tocado sigue contando como pendiente', de(avance1, 'pendiente') > 100,
	`${de(avance1, 'pendiente')} pendientes`);
must('la barra de avance está pintada',
	await page.evaluate(() => document.querySelectorAll('#mundo-avance .barra-obra span').length >= 2));

console.log('\n--- 2. El estado se ve en la lista sin abrir la ficha ---');
await qa('buscar', '');
const puntos = await page.evaluate(() =>
	[...document.querySelectorAll('#mundo-lista .punto-obra')].filter((p) => !p.classList.contains('vacio')).length);
must('la fila de la máquina anotada lleva su punto de color', puntos === 1, `${puntos} puntos`);

console.log('\n--- 3. Colorear el 3D por estado de obra ---');
const color = await qa('colorear', 'obra');
must('«Estado en obra» es un modo de color', color.leyenda === 5, `${color.leyenda} entradas de leyenda`);
must('la leyenda sale en pantalla',
	await page.evaluate(() => document.querySelectorAll('#mundo-leyenda-color .mundo-fila-sis').length >= 2));
await qa('colorear', 'tipo');

console.log('\n--- 4. Medir una tirada y guardarla con su cable ---');
must('el modo medir se activa', await qa('medir', true));
await qa('medirEquipo', tags[0]);
const med = await qa('medirEquipo', tags[1]);
must('con dos puntos ya hay medida', med && med.cablePedido > 0, JSON.stringify(med));
must('sale el formulario de guardar', await page.isVisible('#tirada-guardar'));
const t1 = await qa('guardarTirada', 'Tablero → máquina 1', 4, 2.5);
must('la tirada se guarda con su nombre', t1?.nombre === 'Tablero → máquina 1', JSON.stringify(t1));
must('y con el cable elegido', t1?.conductores === 4 && t1?.seccion === 2.5);
must('los metros son los que medía la cinta', t1?.metros === med.cablePedido,
	`${t1?.metros} vs ${med.cablePedido}`);
must('al guardar, la cinta se reinicia para la siguiente',
	!(await page.isVisible('#tirada-guardar')));

console.log('\n--- 5. Una segunda tirada del mismo cable SUMA metros ---');
await qa('medirEquipo', tags[0]);
await qa('medirEquipo', tags[2]);
const t2 = await qa('guardarTirada', 'Tablero → máquina 2', 4, 2.5);
const pedido = await qa('pedido');
must('el pedido agrupa por manguera', pedido.length === 1, JSON.stringify(pedido));
must('y suma los metros de las dos tiradas', pedido[0].metros === Math.ceil(t1.metros + t2.metros),
	`${pedido[0].metros} vs ${t1.metros}+${t2.metros}`);
must('la lista de pedido está en pantalla',
	await page.evaluate(() => document.querySelectorAll('#mundo-tiradas .fila-pedido').length >= 2));

console.log('\n--- 6. Un cable distinto es OTRA fila del pedido ---');
await qa('medirEquipo', tags[1]);
await qa('medirEquipo', tags[2]);
await qa('guardarTirada', 'Señal de la sonda', 2, 0.75);
const pedido2 = await qa('pedido');
must('ahora hay dos mangueras que pedir', pedido2.length === 2, JSON.stringify(pedido2));
must('ordenadas de menor a mayor sección', pedido2[0].seccion < pedido2[1].seccion);

console.log('\n--- 7. LO GUARDADO SOBREVIVE A CERRAR EL PROGRAMA ---');
await page.screenshot({ path: join(SAL, 'cubierta-obra.png') });
await abrirCubierta();
const pedido3 = await qa('pedido');
must('las tiradas siguen ahí tras recargar', pedido3.length === 2, JSON.stringify(pedido3));
must('con los mismos metros', pedido3[0].metros === pedido2[0].metros && pedido3[1].metros === pedido2[1].metros);
const avance2 = await qa('avance');
must('y el parte de obra también', de(avance2, 'problema') === 1);
await page.evaluate((t) => window.__plantaQA.seleccionar(t), tags[0]);
must('la nota escrita se vuelve a leer en la ficha',
	await page.evaluate(() => document.getElementById('mundo-nota')?.value?.includes('prensaestopas')));

console.log('\n--- 8. Se puede vaciar lo medido sin perder el parte ---');
/*
 * Se confirma en el DIÁLOGO DE LA APLICACIÓN, no en el del navegador.
 *
 * Segunda auditoría, TS2-P2-07: «Vaciar tiradas» era el último `confirm()` nativo que quedaba, y
 * el propio `index.html` explica por qué no se usan —en un `file://` o dentro de un visor con
 * restricciones puede estar bloqueado, y entonces devuelve `false` sin enseñar nada y el botón
 * deja de funcionar sin que nadie entienda por qué—. Aquí se aceptaba con
 * `page.on('dialog', …)`, que es la forma de responder al del navegador; al cambiarlo, esta
 * comprobación cazó el cambio de camino a la primera vuelta de la batería.
 */
await click('tiradas-vaciar'); await page.waitForTimeout(400);
must('CONDICIÓN PREVIA: pregunta antes de borrar',
	await page.evaluate(() => !document.getElementById('modal-dialogo').hidden));
await page.evaluate(() => document.getElementById('dialogo-ok')?.click());
await page.waitForTimeout(500);
must('las tiradas se borran', (await qa('pedido')).length === 0);
must('pero el parte de obra sigue', de(await qa('avance'), 'problema') === 1);

console.log('\n--- 9. Sin errores ---');
await qa('olvidarLevantamiento');
must('ningún error de JavaScript en todo el recorrido', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
