/**
 * QA de las funciones profesionales: esquema eléctrico, DRC eléctrico, multi-selección con
 * alineado, rótulos y DXF. Son las que convierten el programa en algo entregable a un cliente,
 * así que se prueban tocando la interfaz de verdad, no llamando a las funciones por dentro.
 *
 *   node qa/profesional.mjs
 */
import { chromium } from 'playwright-core';

import { join } from 'node:path';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const info = (t) => console.log('     ' + t);
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (f, ...a) => page.evaluate(([n, g]) => window.qa[n](...g), [f, a]);

await page.goto(url); await page.waitForTimeout(900);
if (await page.isVisible('#modal-ayuda')) { await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(200); }
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(350);
if (await page.isVisible('#modal-ejemplos')) {
	await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(700);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
	await jsClick('btn-cerrar-explicacion'); await jsClick('btn-copiar-ejemplo'); await page.waitForTimeout(200);   // un ejemplo es de solo lectura: se trabaja sobre una copia, como haría el usuario
} else {
	info('OJO: no se abrió la biblioteca de ejemplos; se sigue con el tablero que hubiera');
}
info(`proyecto de partida: «${(await qa('proyecto')).nombre}»`);

/* ============================ 1. La barra cabe en pantalla ============================ */
console.log('\n--- 1. La barra superior no se desborda ---');
const barra = await page.evaluate(() => {
	const b = document.getElementById('barra');
	const r = b.getBoundingClientRect();
	const ultimo = [...b.children].at(-1).getBoundingClientRect();
	return { alto: r.height, desbordaAbajo: ultimo.bottom > r.bottom + 1, botones: b.querySelectorAll('button').length };
});
info(`${barra.botones} botones, ${Math.round(barra.alto)} px de alto`);
must('la barra no se parte en dos filas', !barra.desbordaAbajo);
must('la barra mantiene su altura de una fila', barra.alto <= 52, `${Math.round(barra.alto)} px`);

/* ============================== 2. Esquema eléctrico ============================== */
console.log('\n--- 2. Esquema eléctrico ---');
await jsClick('btn-esquema'); await page.waitForTimeout(800);
must('se abre la vista de esquema', await page.isVisible('#panel-esquema'));
const hojas1 = await page.textContent('#esq-indicador');
info(`indicador: ${hojas1}`);
must('hay al menos una hoja', /Hoja \d+ \/ \d+/.test(hojas1));

const simbolos = await page.evaluate(() => document.querySelectorAll('#esquema-hoja [data-dispositivo]').length);
const hilos = await page.evaluate(() => document.querySelectorAll('#esquema-hoja [data-conductor]').length);
info(`${simbolos} símbolos y ${hilos} hilos dibujados`);
must('se dibujan símbolos', simbolos > 0);
must('se dibujan hilos', hilos > 0);

// Todos los aparatos del tablero deben acabar en alguna hoja: un aparato que no sale del
// esquema es un aparato que el electricista no va a montar.
const proyecto = await qa('proyecto');
const enTablero = proyecto.dispositivos.filter((d) => !d.imagen).map((d) => d.id);
const dibujados = new Set();
const total = Number(hojas1.split('/')[1].trim());
for (let h = 0; h < total; h++) {
	for (const id of await page.evaluate(() => [...document.querySelectorAll('#esquema-hoja [data-dispositivo]')].map((e) => e.getAttribute('data-dispositivo')))) {
		dibujados.add(id);
	}
	if (h < total - 1) { await jsClick('esq-siguiente'); await page.waitForTimeout(450); }
}
const faltan = enTablero.filter((id) => !dibujados.has(id));
must('TODOS los aparatos salen en el esquema', faltan.length === 0, faltan.join(', '));

// Nada puede salirse del papel.
const fuera = await page.evaluate(() => {
	const svg = document.querySelector('#esquema-hoja svg');
	const vb = svg.viewBox.baseVal;
	let mal = 0;
	for (const g of svg.querySelectorAll('[data-dispositivo]')) {
		const b = g.getBBox();
		if (b.x < -1 || b.y < -1 || b.x + b.width > vb.width + 1 || b.y + b.height > vb.height + 1) mal++;
	}
	return mal;
});
must('ningún símbolo se sale de la hoja', fuera === 0, `${fuera} fuera`);

// Pinchar un símbolo selecciona ese aparato en todo el programa.
// Se manda un pointerdown + pointerup, que es lo que hace un ratón de verdad ANTES del click:
// desde que el símbolo se puede arrastrar para colocarlo, quien escucha es «pointerdown», y un
// «click» sintético a secas no toca nada (un usuario nunca genera un click sin pointerdown).
await page.evaluate(() => {
	const g = document.querySelector('#esquema-hoja [data-dispositivo]');
	const r = g.getBoundingClientRect();
	const opciones = { bubbles: true, button: 0, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
	g.dispatchEvent(new PointerEvent('pointerdown', opciones));
	window.dispatchEvent(new PointerEvent('pointerup', opciones));
});
await page.waitForTimeout(400);
const selTrasClic = await qa('seleccion');
must('pinchar un símbolo selecciona ese aparato', selTrasClic?.tipo === 'dispositivo', JSON.stringify(selTrasClic));

// Navegación y zoom.
await jsClick('esq-ajustar'); await page.waitForTimeout(250);
const anchoAjustado = await page.evaluate(() => document.getElementById('esquema-hoja').getBoundingClientRect().width);
await jsClick('esq-acercar'); await page.waitForTimeout(250);
const anchoZoom = await page.evaluate(() => document.getElementById('esquema-hoja').getBoundingClientRect().width);
must('el zoom acerca de verdad', anchoZoom > anchoAjustado, `${Math.round(anchoAjustado)} → ${Math.round(anchoZoom)} px`);

await jsClick('esq-cerrar'); await page.waitForTimeout(400);
must('se cierra y vuelve el tablero 3D', !(await page.isVisible('#panel-esquema')));

/* ============ 2b. El plano tiene que ser LEGIBLE en los tres ejemplos ============ */
console.log('\n--- 2b. Legibilidad del esquema (nada tapa a nada) ---');
for (const [indice, nombre] of [[0, 'Arranque directo'], [1, 'Bomba con boya'], [2, 'Tablero de control']]) {
	await jsClick('btn-nuevo'); await page.waitForTimeout(250);
	if (await page.isVisible('#modal-dialogo')) { await jsClick('dialogo-ok'); await page.waitForTimeout(350); }
	await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(350);
	if (await page.isVisible('#modal-ejemplos')) {
		await page.evaluate((i) => document.querySelectorAll('.tarjeta-ejemplo button')[i].click(), indice);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
		await page.waitForTimeout(700);
		await jsClick('btn-cerrar-explicacion'); await page.waitForTimeout(200);
	}
	await jsClick('btn-esquema'); await page.waitForTimeout(700);
	const total = Number((await page.textContent('#esq-indicador')).split('/')[1]?.trim() ?? 1);
	let solapesTotal = 0;
	const muestras = [];
	for (let h = 0; h < total; h++) {
		const r = await page.evaluate(() => {
			const svg = document.querySelector('#esquema-hoja svg');
			if (!svg) return { n: 0, ej: [] };
			const textos = [...svg.querySelectorAll('text')].map((t) => ({ b: t.getBBox(), s: t.textContent }));
			let n = 0; const ej = [];
			for (let i = 0; i < textos.length; i++) for (let j = i + 1; j < textos.length; j++) {
				const a = textos[i].b, c = textos[j].b;
				if (a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height) {
					n++; if (ej.length < 4) ej.push(`«${textos[i].s}»/«${textos[j].s}»`);
				}
			}
			return { n, ej };
		});
		solapesTotal += r.n;
		muestras.push(...r.ej);
		if (h < total - 1) { await jsClick('esq-siguiente'); await page.waitForTimeout(450); }
	}
	if (muestras.length) info(muestras.slice(0, 5).join(' · '));
	must(`${nombre}: ningún texto del plano tapa a otro`, solapesTotal === 0, `${solapesTotal} solapes en ${total} hojas`);

	/*
	 * Y CON MARGEN, no por los pelos.
	 *
	 * Segunda auditoría, TS2-P1-10. La comprobación de arriba pasaba aquí y la auditoría veía 8
	 * solapes por ejemplo, porque la corrió en Windows. `system-ui` es una fuente distinta en cada
	 * sistema, y el cajetín llevaba las alturas puestas a mano: medido, «DIBUJÓ» tenía 0,13 mm de
	 * aire con su valor —la `J` baja por debajo de la línea base y se comía el hueco—. Con la
	 * fuente de este equipo daba positivo por trece centésimas; con la de otro, negativo.
	 *
	 * Un plano que se lee bien en la máquina del que lo dibuja y se pisa en la del que lo monta es
	 * un plano roto, y «cero solapes» no lo detecta: hace falta exigir AIRE.
	 */
	const aire = await page.evaluate(() => {
		const svg = document.querySelector('#esquema-hoja svg');
		if (!svg) return [];
		const t = [...svg.querySelectorAll('text')].map((x) => ({ b: x.getBBox(), s: x.textContent }));
		const rotulos = ['CLIENTE', 'OBRA', 'DIBUJÓ', 'FECHA', 'HOJA', 'REV.'];
		return t.filter((x) => rotulos.includes(x.s)).map((r) => {
			const v = t.filter((x) => x !== r && x.b.x < r.b.x + r.b.width && r.b.x < x.b.x + x.b.width
				&& x.b.y > r.b.y).sort((a, c) => a.b.y - c.b.y)[0];
			return v ? { rotulo: r.s, mm: +(v.b.y - (r.b.y + r.b.height)).toFixed(2) } : null;
		}).filter(Boolean);
	});
	const MINIMO = 0.6;   // por debajo de esto, otra fuente lo pone en negativo
	const justos = aire.filter((a) => a.mm < MINIMO);
	must(`${nombre}: el cajetín deja aire suficiente para cualquier fuente`, justos.length === 0,
		justos.length ? justos.map((a) => `${a.rotulo} ${a.mm}mm`).join(', ')
			: `mínimo ${Math.min(...aire.map((a) => a.mm)).toFixed(2)} mm (umbral ${MINIMO})`);
	await jsClick('esq-cerrar'); await page.waitForTimeout(300);
}

/* ============================ 3. DRC eléctrico ============================ */
console.log('\n--- 3. DRC eléctrico (la física, no solo el dibujo) ---');
// Se monta a propósito el error clásico: automático grande sobre cable fino.
await page.evaluate(() => {
	const p = window.qa.proyecto();
	const q = p.dispositivos.find((d) => d.tipo === 'disyuntor');
	if (q) q.corrienteNominal = 32;
	for (const c of p.conductores) c.seccion = 1.5;
});
await jsClick('btn-centrar'); await page.waitForTimeout(200);
await page.evaluate(() => window.qa.recalcular?.());
await page.waitForTimeout(400);
const hall = await qa('hallazgos');
const r9 = hall.filter((h) => h.regla === 'R9-proteccion-sobredimensionada');
info(`${hall.length} hallazgos · ${r9.length} de coordinación`);
must('detecta la protección sobredimensionada sobre cable fino', r9.length > 0);
if (r9.length) {
	must('el mensaje dice a qué sección subir', /mm²/.test(r9[0].mensaje), r9[0].mensaje.slice(0, 90));
	must('lo marca como ERROR, no como aviso', r9[0].severidad === 'error');
}
const r11 = hall.filter((h) => h.regla === 'R11-sin-tierra');
info(`${r11.length} bornes de tierra sin conectar`);

/* ====================== 4. Multi-selección, mover y alinear ====================== */
console.log('\n--- 4. Multi-selección y alineado ---');
await jsClick('btn-nuevo'); await page.waitForTimeout(250);
if (await page.isVisible('#modal-dialogo')) { await jsClick('dialogo-ok'); await page.waitForTimeout(350); }
await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(350);
if (await page.isVisible('#modal-ejemplos')) {
	await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(700);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
	await jsClick('btn-cerrar-explicacion'); await page.waitForTimeout(200);
} else {
	info('OJO: no se abrió la biblioteca de ejemplos; se sigue con el tablero que hubiera');
}
info(`proyecto de partida: «${(await qa('proyecto')).nombre}»`);
await jsClick('modo-editor'); await page.waitForTimeout(300);

const p0 = await qa('proyecto');
const colocados = p0.gabinete.colocaciones
	.filter((c) => { const d = p0.dispositivos.find((x) => x.id === c.dispositivoId); return d && !d.imagen; })
	.slice(0, 3);
must('hay al menos 3 aparatos para agrupar', colocados.length === 3);

await page.evaluate((ids) => {
	document.activeElement?.blur?.();
	window.qa.seleccionarPorId(ids[0]);
	window.qa.anadirASeleccion(ids[1]);
	window.qa.anadirASeleccion(ids[2]);
}, colocados.map((c) => c.dispositivoId));
await page.waitForTimeout(350);
must('el panel pasa a modo grupo', /3 aparatos seleccionados/.test(await page.textContent('#panel-der')));

// Se descoloca uno a propósito: si los tres ya estuvieran a la misma altura, alinear no
// cambiaría nada y no habría nada que deshacer después (el Ctrl+Z se iría a la acción anterior,
// que es abrir el ejemplo, y se llevaría el tablero por delante).
await page.evaluate((id) => {
	const p = window.qa.proyecto();
	const c = p.gabinete.colocaciones.find((x) => x.dispositivoId === id);
	if (c) c.y += 25;
	window.qa.recalcular?.();
}, colocados[1].dispositivoId);
await page.waitForTimeout(300);

// Alinear arriba: todos deben acabar a la misma Y.
await page.click('[data-alinear="arriba"]'); await page.waitForTimeout(450);
const tras = await qa('proyecto');
const ys = colocados.map((c) => tras.gabinete.colocaciones.find((x) => x.dispositivoId === c.dispositivoId).y);
info(`Y tras alinear: ${ys.join(', ')}`);
must('alinear arriba deja todos a la misma altura', new Set(ys).size === 1, ys.join(', '));

// Y nada puede quedar encimado ni fuera de la placa.
const cols = tras.gabinete.colocaciones;
let choques = 0;
for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
	const a = cols[i], b = cols[j];
	if (a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto) choques++;
}
must('alinear no deja aparatos encimados', choques === 0, `${choques} choques`);
must('todo sigue dentro de la placa', cols.every((c) => c.x >= 0 && c.y >= 0
	&& c.x + c.ancho <= tras.gabinete.ancho && c.y + c.alto <= tras.gabinete.alto));

// Repartir por igual.
await page.click('[data-alinear="repartir-h"]'); await page.waitForTimeout(450);
const rep = await qa('proyecto');
const orden = colocados
	.map((c) => rep.gabinete.colocaciones.find((x) => x.dispositivoId === c.dispositivoId))
	.sort((a, b) => a.x - b.x);
const huecos = [orden[1].x - (orden[0].x + orden[0].ancho), orden[2].x - (orden[1].x + orden[1].ancho)];
info(`huecos: ${huecos.map((h) => Math.round(h)).join(' y ')} mm`);
must('repartir deja la misma separación entre aparatos', Math.abs(huecos[0] - huecos[1]) <= 2, huecos.join(', '));

// Ctrl+Z deshace el alineado completo.
await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
const trasZ = await qa('proyecto');
info(`tras Ctrl+Z: «${trasZ.nombre}» con ${trasZ.dispositivos.length} aparatos y `
	+ `${trasZ.gabinete.colocaciones.length} colocaciones (antes: «${rep.nombre}» con `
	+ `${rep.dispositivos.length} y ${rep.gabinete.colocaciones.length})`);
must('Ctrl+Z deshace el alineado', JSON.stringify(trasZ.gabinete.colocaciones) !== JSON.stringify(rep.gabinete.colocaciones));

/* ============================ 5. Rótulos y DXF ============================ */
console.log('\n--- 5. Entregables: rótulos y DXF ---');
const descargas = [];
page.on('download', (d) => descargas.push(d.suggestedFilename()));

// Se ESPERA a la descarga en vez de dar por hecho que cabe en un tiempo fijo: generar el PDF
// tarda lo que tarde la máquina, y un tiempo fijo convierte una prueba buena en una lotería.
await Promise.all([
	page.waitForEvent('download', { timeout: 30000 }).catch(() => undefined),
	jsClick('btn-etiquetas'),
]);
await page.waitForTimeout(300);
must('los rótulos se descargan en PDF', descargas.some((f) => /rotulos\.pdf$/.test(f)), descargas.join(', '));

await Promise.all([
	page.waitForEvent('download', { timeout: 30000 }).catch(() => undefined),
	jsClick('btn-dxf-placa'),
]);
await page.waitForTimeout(300);
must('la placa se descarga en DXF', descargas.some((f) => /placa\.dxf$/.test(f)), descargas.join(', '));

await Promise.all([
	page.waitForEvent('download', { timeout: 30000 }).catch(() => undefined),
	jsClick('btn-dxf-esquema'),
]);
await page.waitForTimeout(300);
must('el esquema se descarga en DXF', descargas.some((f) => /esquema-\d+\.dxf$/.test(f)), descargas.join(', '));

/* ==================== 6. Copiar/pegar y plantillas propias ==================== */
console.log('\n--- 6. Copiar, pegar y plantillas ---');
await jsClick('modo-editor'); await page.waitForTimeout(300);
const antesCopia = (await qa('proyecto')).dispositivos.length;
const unId = (await qa('proyecto')).gabinete.colocaciones[0].dispositivoId;
await page.evaluate((id) => { document.activeElement?.blur?.(); window.qa.seleccionarPorId(id); }, unId);
await page.waitForTimeout(250);
await page.keyboard.press('Control+c'); await page.waitForTimeout(300);
await page.keyboard.press('Control+v'); await page.waitForTimeout(600);
const trasPegar = await qa('proyecto');
must('Ctrl+C / Ctrl+V pega un aparato', trasPegar.dispositivos.length === antesCopia + 1,
	`${antesCopia} → ${trasPegar.dispositivos.length}`);
must('el pegado NO trae cables del original',
	!trasPegar.conductores.some((c) => c.de.dispositivoId === trasPegar.dispositivos.at(-1).id
		|| c.a.dispositivoId === trasPegar.dispositivos.at(-1).id));
must('ninguna designación queda repetida tras pegar',
	new Set(trasPegar.dispositivos.map((d) => d.designacion)).size === trasPegar.dispositivos.length);
const colPegado = trasPegar.gabinete.colocaciones.find((c) => c.dispositivoId === trasPegar.dispositivos.at(-1).id);
must('el pegado cae dentro de la placa', !!colPegado && colPegado.x >= 0
	&& colPegado.x + colPegado.ancho <= trasPegar.gabinete.ancho);
let choquePegado = 0;
for (const o of trasPegar.gabinete.colocaciones) {
	if (o.dispositivoId === colPegado.dispositivoId) continue;
	if (colPegado.x < o.x + o.ancho && o.x < colPegado.x + colPegado.ancho
		&& colPegado.y < o.y + o.alto && o.y < colPegado.y + colPegado.alto) choquePegado++;
}
must('el pegado no queda encimado con otro aparato', choquePegado === 0, `${choquePegado}`);

// Copiar un GRUPO y pegarlo entero.
const tresIds = trasPegar.gabinete.colocaciones.slice(0, 3).map((c) => c.dispositivoId);
await page.evaluate((ids) => {
	document.activeElement?.blur?.();
	window.qa.seleccionarPorId(ids[0]);
	window.qa.anadirASeleccion(ids[1]);
	window.qa.anadirASeleccion(ids[2]);
}, tresIds);
await page.waitForTimeout(300);
const antesGrupo = (await qa('proyecto')).dispositivos.length;
await page.keyboard.press('Control+c'); await page.waitForTimeout(300);
await page.keyboard.press('Control+v'); await page.waitForTimeout(700);
must('se pega el grupo entero', (await qa('proyecto')).dispositivos.length === antesGrupo + 3,
	`${antesGrupo} → ${(await qa('proyecto')).dispositivos.length}`);

// Guardar como plantilla y volver a abrirla.
await page.evaluate(() => localStorage.removeItem('tablerostudio-plantillas'));
await jsClick('btn-plantilla'); await page.waitForTimeout(350);
if (await page.isVisible('#modal-dialogo')) {
	await page.fill('#dialogo-input', 'Mi arranque de prueba');
	await jsClick('dialogo-ok'); await page.waitForTimeout(500);
}
const guardadas = await page.evaluate(() => JSON.parse(localStorage.getItem('tablerostudio-plantillas') ?? '[]').length);
must('la plantilla queda guardada', guardadas === 1, `${guardadas}`);

await jsClick('btn-nuevo'); await page.waitForTimeout(250);
if (await page.isVisible('#modal-dialogo')) { await jsClick('dialogo-ok'); await page.waitForTimeout(400); }
const vacio = (await qa('proyecto')).dispositivos.length;
await jsClick('btn-ejemplos'); await page.waitForTimeout(450);
must('la plantilla aparece en la biblioteca', await page.isVisible('[data-plantilla="0"]'));
await page.click('[data-plantilla="0"]'); await page.waitForTimeout(400);
// Abrir una plantilla reemplaza el tablero: desde que eso avisa, hay que aceptarlo.
if (await page.isVisible('#modal-dialogo')) { await jsClick('dialogo-ok'); await page.waitForTimeout(600); }
await page.waitForTimeout(300);
const recuperado = await qa('proyecto');
must('al abrir la plantilla vuelve el tablero entero', recuperado.dispositivos.length > vacio,
	`${vacio} → ${recuperado.dispositivos.length}`);
must('la plantilla conserva su nombre', recuperado.nombre === 'Mi arranque de prueba', recuperado.nombre);
must('la plantilla conserva los cables', recuperado.conductores.length > 0, `${recuperado.conductores.length}`);

/* ============================== 7. Coherencia ============================== */
console.log('\n--- 7. Coherencia final ---');
const fin = await qa('proyecto');
must('sin cables fantasma', (await qa('cablesDibujados')) === fin.conductores.length,
	`${await qa('cablesDibujados')}/${fin.conductores.length}`);
must('sin errores de JavaScript en toda la sesión', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ✗ ===`);
await browser.close(); server.close();
process.exit(fallos === 0 ? 0 : 1);
