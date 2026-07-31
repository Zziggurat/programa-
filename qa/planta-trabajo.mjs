/**
 * QA de la planta COMO HERRAMIENTA DE TRABAJO.
 *
 * El visor ya enseñaba la cubierta; esto comprueba que además sirva para trabajar en ella:
 * buscar una máquina entre 129, filtrarlas, colorearlas por el criterio que interese, medir una
 * tirada de cable y llevarse las elegidas al editor convertidas en el tablero que las gobierna.
 *
 * Es la prueba de extremo a extremo del puente entre las dos herramientas: termina abriendo el
 * tablero generado en el editor y comprobando que está de verdad ahí, con sus borneras.
 *
 *   node qa/planta-trabajo.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAL = join(AQUI, '_salida'); mkdirSync(SAL, { recursive: true });
const ROOT = join(AQUI, '..', 'app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
	let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
	const f = join(ROOT, p); if (!existsSync(f)) { res.statusCode = 404; res.end(''); return; }
	res.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const click = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (!b) throw new Error('no existe #' + i); b.click(); }, id);
const qa = (f, ...a) => page.evaluate(([fn, args]) => window.__plantaQA[fn](...args), [f, a]);

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await click('btn-cerrar-ayuda'); await page.waitForTimeout(200);
await click('btn-planta');
await page.waitForTimeout(3500);   // construir la escena lleva su tiempo
must('el visor abre', await page.isVisible('#mundo'));

console.log('--- 1. Buscar una máquina entre todas ---');
must('hay caja de búsqueda', await page.isVisible('#mundo-q'));
const todas = await qa('buscar', '');
must('sin escribir nada salen todas', todas.encontradas > 100, `${todas.encontradas}`);
must('y ninguna se ve apagada', todas.apagadas === 0, `${todas.apagadas} apagadas`);

const primera = todas.tags[0];
const soloUna = await qa('buscar', primera.replace(/-/g, '').toLowerCase());
must('escribir el marcado sin guiones la encuentra', soloUna.tags[0] === primera,
	`buscando «${primera}» salió «${soloUna.tags[0]}»`);
// Solo se apaga lo que está montado en el 3D: el plano sitúa en planta 41 de las 129 máquinas.
must('y TODAS las demás del 3D se apagan', soloUna.apagadas === soloUna.montadas - 1,
	`${soloUna.apagadas} apagadas de ${soloUna.montadas} montadas`);

const porSenal = await qa('buscar', 'valvula');
must('se busca por lo que hace la señal', porSenal.encontradas > 0, `${porSenal.encontradas}`);
const nada = await qa('buscar', 'zzzz');
must('lo que no existe no encuentra nada', nada.encontradas === 0);
must('y lo dice en vez de dejar la lista vacía',
	(await page.textContent('#mundo-lista')).includes('Nada encaja'));
await qa('buscar', '');

console.log('\n--- 2. Filtros ---');
const antes = Number((await page.textContent('#mundo-cuenta-txt')).match(/\d+/)[0]);
await page.evaluate(() => document.querySelector('[data-chip="1"]').click());   // Extractores
await page.waitForTimeout(200);
const conFiltro = await page.textContent('#mundo-cuenta-txt');
const vex = Number(conFiltro.match(/\d+/)[0]);
must('filtrar por extractores reduce la lista', vex > 0 && vex < antes, `${vex} de ${antes}`);
must('el contador dice de cuántas', /de \d+ máquinas/.test(conFiltro), conFiltro);
await page.evaluate(() => document.querySelector('[data-chip="1"]').click());
await page.waitForTimeout(200);
must('quitar el filtro las devuelve todas',
	Number((await page.textContent('#mundo-cuenta-txt')).match(/\d+/)[0]) === antes);

console.log('\n--- 3. Colorear por lo que interesa ---');
for (const [modo, minimoLeyenda] of [['tipo', 2], ['controlador', 6], ['puntos', 4], ['tablero', 2]]) {
	const r = await qa('colorear', modo);
	must(`«${modo}» tiene su leyenda completa`, r.leyenda >= minimoLeyenda,
		`${r.leyenda} filas, ${r.distintos} colores en el 3D`);
}
must('colorear por señales pinta de varios colores en el 3D',
	(await qa('colorear', 'puntos')).distintos >= 3);
must('la leyenda del color está a la vista',
	(await page.textContent('#mundo-leyenda-color')).length > 10);
// Elegir «Controlador» y ver dos colores donde la leyenda dice seis canales parecería un fallo:
// el visor tiene que explicar que el plano no sitúa en planta a todas las máquinas.
must('avisa de que no todas están situadas en planta',
	/sit[uú]a en planta/i.test(await page.textContent('#mundo-leyenda-color')));
await qa('colorear', 'tipo');

console.log('\n--- 4. La cinta métrica ---');
must('está apagada al abrir', !(await page.isVisible('#mundo-cinta')));
await qa('medir', true);
must('el modo Medir se enciende', await page.isVisible('#mundo-cinta'));
must('el botón se ve activo', await page.evaluate(
	() => document.getElementById('mundo-medir').classList.contains('activo')));
await qa('marcarPunto', 0, 0, 0);
must('con un solo punto todavía no hay medida',
	(await page.textContent('#mundo-cinta-cuerpo')).includes('1 punto marcado'));
const med = await qa('marcarPunto', 30, 0, 40);
must('con dos puntos ya mide', !!med, JSON.stringify(med));
must('la recta de un 30-40 son 50 m', Math.abs(med.recta - 50) < 0.01, `${med.recta}`);
must('el recorrido por bandeja son 70 m, no 50', Math.abs(med.recorrido - 70) < 0.01, `${med.recorrido}`);
must('se pide más cable del que mide la recta', med.cablePedido > med.recta, `${med.cablePedido} m`);
const panel = await page.textContent('#mundo-cinta-cuerpo');
must('el panel enseña lo que hay que pedir', panel.includes(`${med.cablePedido} m`), panel.slice(0, 90));
must('y dice que lleva reserva', /reserva/i.test(panel));
// Medir PINCHANDO UNA MÁQUINA toma su centro exacto, que es de donde a donde se mide de verdad.
await qa('medir', false); await qa('medir', true);
const conMaquinas = await page.evaluate(() => {
	const q = window.__plantaQA;
	const situadas = q.equipos.filter((e) => e.x !== null).slice(0, 2).map((e) => e.tag);
	q.medirEquipo(situadas[0]);
	const m = q.medirEquipo(situadas[1]);
	return { tags: situadas, medida: m, panel: document.getElementById('mundo-cinta-cuerpo').textContent };
});
must('se puede medir de máquina a máquina', !!conMaquinas.medida,
	JSON.stringify(conMaquinas.medida));
must('y el panel dice por qué máquinas pasa',
	conMaquinas.tags.every((t) => conMaquinas.panel.includes(t)),
	conMaquinas.tags.join(' → '));
await qa('medir', false);
must('apagar el modo Medir cierra el panel', !(await page.isVisible('#mundo-cinta')));

console.log('\n--- 5. Elegir máquinas para el tablero ---');
must('el botón de llevar al tablero empieza apagado',
	await page.evaluate(() => document.getElementById('mundo-a-tablero').disabled));
// Las tres máquinas con más señales del plano.
const conMasSenales = await page.evaluate(() => window.__plantaQA.equipos
	.slice().sort((a, b) => b.puntos.length - a.puntos.length).slice(0, 3).map((e) => e.tag));
must('el plano trae máquinas con diagrama', conMasSenales.length === 3, conMasSenales.join(', '));
must('quedan tres elegidas', (await qa('elegir', conMasSenales)) === 3);
must('ya se puede llevar al tablero',
	!(await page.evaluate(() => document.getElementById('mundo-a-tablero').disabled)));
must('el panel dice cuántas y cuántas señales',
	/3 máquinas · \d+ señales/.test(await page.textContent('#mundo-elegidas-txt')),
	await page.textContent('#mundo-elegidas-txt'));

console.log('\n--- 6. El tablero que sale del plano ---');
const puente = await qa('puente');
must('trae todas las señales de las tres', puente.senales > 15, `${puente.senales} señales`);
must('y sus bornas', puente.bornas >= puente.senales * 2, `${puente.bornas} bornas`);
must('con aparatos y cableado', puente.dispositivos > 8 && puente.conductores > puente.senales,
	`${puente.dispositivos} aparatos, ${puente.conductores} cables`);
must('avisa de que el controlador es genérico',
	puente.notas.some((n) => /gen[eé]rico/i.test(n)), puente.notas.join(' | ').slice(0, 120));
must('el nombre dice de dónde sale', /máquinas de la cubierta/i.test(puente.nombre), puente.nombre);

console.log('\n--- 7. La ventana de revisión, antes de armar nada ---');
await click('mundo-a-tablero'); await page.waitForTimeout(400);
must('se abre la lista de señales para revisarla', await page.isVisible('#modal-puente'));
const tabla = await page.textContent('#puente-tabla');
must('la tabla trae el marcado de la máquina', tabla.includes(conMasSenales[0]), tabla.slice(0, 80));
must('y a qué terminal va cada señal', /UI\d|DI\d|AO\d|DO\d/.test(tabla));
must('las notas están a la vista',
	(await page.evaluate(() => document.querySelectorAll('#puente-notas li').length)) >= 3);
await click('btn-puente-cancelar'); await page.waitForTimeout(200);
must('cancelar no arma nada', !(await page.isVisible('#modal-puente')));
must('y el visor sigue abierto', await page.isVisible('#mundo'));

console.log('\n--- 8. Llevarlo de verdad al editor ---');
await click('mundo-a-tablero'); await page.waitForTimeout(400);
await click('btn-puente-crear'); await page.waitForTimeout(1500);
must('el visor se cierra y se vuelve al editor', !(await page.isVisible('#mundo')));
must('el editor está a la vista', await page.isVisible('#escena'));
const proy = await page.evaluate(() => window.qa.proyecto());
must('el proyecto abierto es el del plano', /cubierta/i.test(proy.nombre), proy.nombre);
const borneros = proy.dispositivos.filter((d) => d.tipo === 'bornero');
must('trae una bornera por máquina más el peine de comunes', borneros.length === 4,
	`${borneros.length} borneras`);
for (const tag of conMasSenales) {
	must(`la bornera de ${tag} está rotulada`,
		borneros.some((b) => (b.descripcion ?? '').includes(tag)));
}
must('trae el controlador', proy.dispositivos.some((d) => d.tipo === 'plc'));
must('y la alimentación', proy.dispositivos.some((d) => d.tipo === 'fuente'));
must('está cableado', proy.conductores.length > 40, `${proy.conductores.length} conductores`);
must('y colocado en la placa', (proy.gabinete?.colocaciones ?? []).length === proy.dispositivos.filter(
	(d) => !d.campo && d.tipo !== 'otro').length,
	`${(proy.gabinete?.colocaciones ?? []).length} colocaciones`);

console.log('\n--- 9. El tablero generado no tiene faltas ---');
const drc = await page.evaluate(() => window.qa.drc());
const errores = drc.filter((h) => h.severidad === 'error');
must('ningún error de DRC', errores.length === 0,
	errores.slice(0, 3).map((e) => e.mensaje).join(' | '));

console.log('\n--- 10. Sin errores ---');
must('ningún error de JavaScript en todo el recorrido', errs.length === 0, errs.slice(0, 3).join(' | '));

await page.screenshot({ path: join(SAL, 'planta-trabajo.png') });
await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
