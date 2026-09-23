/**
 * QA de las correcciones pedidas tras usar el programa de verdad:
 *  1. Tapas de canaleta opacas en Visualización (no fantasma).
 *  2. Uniones de cable SOLO con doble clic (izquierdo o derecho); arrastrar no las crea.
 *  3. Los menús de la barra se despliegan enteros, sin barra de scroll en la cabecera.
 *  4. No queda rastro de «Auto-ordenar cables».
 *  5. El chip del DRC abre el detalle de los hallazgos.
 *  7. Imagen de referencia: añadirla, ponerle puntos de conexión y cablearlos.
 *
 *   node qa/correcciones.mjs
 */
import { chromium } from 'playwright-core';

import { join } from 'node:path';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

let browser;
let page;
const errs = [];

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const info = (t) => console.log('     ' + t);
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (f, ...a) => page.evaluate(([n, g]) => window.qa[n](...g), [f, a]);
const LIBRE = { x0: 340, x1: 1060, y0: 110, y1: 800 };
const HOLGADA = { x0: LIBRE.x0 + 40, x1: LIBRE.x1 - 40, y0: LIBRE.y0 + 40, y1: LIBRE.y1 - 80 };
const enZona = (p) => p && p.x > LIBRE.x0 && p.x < LIBRE.x1 && p.y > LIBRE.y0 && p.y < LIBRE.y1;
const puntoAgarreEnLienzo = async (id, separadoDe, zonas = [HOLGADA, LIBRE]) => {
	for (const zona of zonas) for (const muestras of [31, 61, 121, 241]) {
		const p = await qa('puntoParaAgarrar', id, muestras, zona);
		if (enZona(p) && (!separadoDe || Math.hypot(p.x - separadoDe.x, p.y - separadoDe.y) > 60)) return p;
	}
	return undefined;
};

async function abrirEjemploCableado() {
	await jsClick('btn-empezar-ejemplo');
	await page.locator('#modal-ejemplos').waitFor({ state: 'visible', timeout: 60_000 });
	await page.locator('.tarjeta-ejemplo').filter({ has: page.getByRole('heading', {
		name: 'Arranque directo de motor (380 V)', exact: true,
	}) }).getByRole('button', { name: 'Abrir y estudiar', exact: true }).click();
	await page.waitForFunction(() => {
		const dialogo = document.getElementById('modal-dialogo');
		return document.getElementById('chip-ejemplo')?.hidden === false
			|| !!dialogo && !dialogo.hidden && getComputedStyle(dialogo).display !== 'none';
	}, null, { timeout: 60_000 });
	if (await page.isVisible('#modal-dialogo')) {
		await jsClick('dialogo-ok');
		await page.waitForFunction(() => document.getElementById('chip-ejemplo')?.hidden === false,
			null, { timeout: 60_000 });
	}
	if (await page.isVisible('#modal-explicacion')) await jsClick('btn-cerrar-explicacion');
	if (!(await trabajarSobreCopia(page, { timeout: 60_000 }))) {
		throw new Error('El ejemplo no produjo una copia editable confirmada.');
	}
	await page.waitForFunction(() => window.qa.rutas().length > 0, null, { timeout: 60_000 });
}

try {
browser = await abrirNavegador(chromium);
page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });
await page.goto(url); await page.waitForTimeout(900);
if (await page.isVisible('#modal-ayuda')) { await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(200); }
await abrirEjemploCableado();

/* ================= 3. La barra no hace scroll y los menús se despliegan ================= */
console.log('\n--- 3. Barra y menús desplegables ---');
const barra = await page.evaluate(() => {
	const b = document.getElementById('barra');
	return { scroll: b.scrollWidth > b.clientWidth + 1, alto: b.getBoundingClientRect().height,
		overflow: getComputedStyle(b).overflowX };
});
info(`alto ${Math.round(barra.alto)} px · overflow-x: ${barra.overflow}`);
must('la barra NO crea barra de scroll', !barra.scroll);
must('la barra no recorta a sus hijos', barra.overflow === 'visible');

// La barra tiene que aguantar en TODOS los estados del chip de guardado y a varios anchos.
// El chip cambia de texto y ancho; incluir la revisión más larga razonable, no rótulos V7.
// medirla solo recién cargada, con el texto más corto, deja pasar el desbordamiento real.
for (const w of [1024, 1152, 1280, 1366, 1440, 1536, 1600, 1745, 1800, 1920]) {
	await page.setViewportSize({ width: w, height: 900 });
	await page.waitForTimeout(200);
	for (const [clase, texto] of [
		['', 'r999 · Guardado local'], ['sucio', 'r999 · Cambios pendientes'],
		['sucio', 'r999 · Guardando…'], ['fallo', 'r999 · Sin guardar'],
	]) {
		const m = await page.evaluate(({ c, texto }) => {
			const chip = document.getElementById('estado-guardado');
			const antes = { clase: chip.className, texto: chip.textContent };
			chip.className = c;
			chip.textContent = texto;
			// La app remide los rótulos cuando cambia el estado; la prueba hace lo mismo para medir
			// la barra como queda de verdad y no a mitad de ajuste.
			window.qa.ajustarBarra();
			const b = document.getElementById('barra');
			const r = { scroll: b.scrollWidth > b.clientWidth + 1, texto: chip.textContent };
			chip.className = antes.clase; chip.textContent = antes.texto;
			return r;
		}, { c: clase, texto });
		must(`la barra aguanta a ${w} px con «${m.texto}»`, !m.scroll);
	}
}
await page.setViewportSize({ width: 1400, height: 900 });
await page.waitForTimeout(250);

for (const [boton, menu] of [['btn-aprender', 'menu-aprender'], ['btn-exportar', 'menu-exportar']]) {
	await jsClick(boton); await page.waitForTimeout(250);
	const caja = await page.evaluate((m) => {
		const lista = document.querySelector(`#${m} .lista`);
		const r = lista.getBoundingClientRect();
		const vis = getComputedStyle(lista).display !== 'none';
		// ¿Se ve entero dentro de la ventana y por debajo de la barra?
		return { vis, dentro: r.top >= 40 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
			alto: r.height, botones: lista.querySelectorAll('button').length };
	}, menu);
	must(`«${boton}» despliega su lista`, caja.vis);
	must(`la lista de «${boton}» se ve entera en pantalla`, caja.dentro, `alto ${Math.round(caja.alto)} px`);
	must(`la lista de «${boton}» tiene sus opciones`, caja.botones >= 2, `${caja.botones} opciones`);
	await page.mouse.click(700, 500); await page.waitForTimeout(250);
	must(`«${boton}» se cierra al pinchar fuera`,
		!(await page.evaluate((m) => getComputedStyle(document.querySelector(`#${m} .lista`)).display !== 'none', menu)));
}

/* ================= 4. Auto-ordenar eliminado ================= */
console.log('\n--- 4. «Auto-ordenar cables» eliminado ---');
must('no queda el botón en la interfaz', !(await page.evaluate(() => !!document.getElementById('btn-ordenar-cables'))));
must('no queda el texto en ninguna parte',
	!(await page.evaluate(() => document.body.innerHTML.includes('Auto-ordenar'))));

/* ================= 5. El chip del DRC abre el detalle ================= */
console.log('\n--- 5. Detalle de la verificación eléctrica ---');
// Se provoca un error a propósito para que haya algo que mostrar.
await page.evaluate(() => {
	const p = window.qa.proyecto();
	const q = p.dispositivos.find((d) => d.tipo === 'disyuntor' || d.tipo === 'guardamotor');
	if (q) q.corrienteNominal = 40;
	for (const c of p.conductores) c.seccion = 1.5;
	window.qa.recalcular();
});
await page.waitForTimeout(500);
await jsClick('chip-drc'); await page.waitForTimeout(400);
must('el chip abre el detalle', await page.isVisible('#modal-drc'));
const items = await page.evaluate(() => document.querySelectorAll('#drc-detalle li').length);
info(`${items} hallazgos listados`);
must('se listan los hallazgos', items > 0);
must('el resumen dice cuántos hay', /error|aviso/i.test(await page.textContent('#drc-resumen')));
// Pinchar un hallazgo salta a su culpable.
const clicable = await page.evaluate(() => !!document.querySelector('#drc-detalle li.clicable'));
if (clicable) {
	await page.click('#drc-detalle li.clicable'); await page.waitForTimeout(500);
	must('pinchar un hallazgo cierra el detalle', !(await page.isVisible('#modal-drc')));
	must('y selecciona el elemento culpable', !!(await qa('seleccion')));
} else {
	await jsClick('btn-cerrar-drc'); await page.waitForTimeout(250);
}
must('el detalle se cierra', !(await page.isVisible('#modal-drc')));

/* ================= 2. Uniones solo con doble clic ================= */
console.log('\n--- 2. Uniones de cable: solo con doble clic ---');
await jsClick('btn-nuevo'); await page.waitForTimeout(250);
await page.locator('#modal-dialogo').waitFor({ state: 'visible', timeout: 20_000 });
await jsClick('dialogo-ok');
await page.waitForFunction(() => window.qa.proyecto().conductores.length === 0,
	null, { timeout: 60_000 });
// De aquí abajo se crean uniones en un cable y se añade una imagen de referencia: se edita.
await abrirEjemploCableado();
await jsClick('modo-trabajo'); await page.waitForTimeout(350);
await jsClick('btn-centrar'); await page.waitForTimeout(500);

const uniones = async (id) => ((await qa('proyecto')).conductores.find((c) => c.id === id)?.trazado ?? []).length;
const rutas = await qa('rutas');
let cable;
for (const zona of [HOLGADA, LIBRE]) {
	for (const r of rutas) {
		const p = await puntoAgarreEnLienzo(r.id, undefined, [zona]);
		if (!p) continue;
		const lejos = await puntoAgarreEnLienzo(r.id, p, [zona]);
		if (lejos) { cable = { id: r.id, p }; break; }
	}
	if (cable) break;
}
must('hay un cable con el que probar', !!cable);
if (!cable) throw new Error('El ejemplo no ofrece un cable agarrable con dos puntos separados en la zona de prueba.');
info(`probando con ${cable.id} en (${Math.round(cable.p.x)}, ${Math.round(cable.p.y)})`);

// (a) Arrastrar un cable SIN uniones no debe crear ninguna.
const antesArrastre = await uniones(cable.id);
await page.mouse.move(cable.p.x, cable.p.y);
await page.mouse.down(); await page.waitForTimeout(60);
for (let k = 1; k <= 6; k++) { await page.mouse.move(cable.p.x + 7 * k, cable.p.y + 5 * k); await page.waitForTimeout(30); }
await page.mouse.up(); await page.waitForTimeout(350);
must('arrastrar el cable NO crea uniones', (await uniones(cable.id)) === antesArrastre,
	`${antesArrastre} → ${await uniones(cable.id)}`);

// (b) Un solo clic derecho tampoco.
const p2 = await puntoAgarreEnLienzo(cable.id);
if (!p2) throw new Error('El cable perdió su punto agarrable antes del clic derecho.');
await page.mouse.click(p2.x, p2.y, { button: 'right' }); await page.waitForTimeout(400);
must('un solo clic derecho NO crea unión', (await uniones(cable.id)) === antesArrastre,
	`${antesArrastre} → ${await uniones(cable.id)}`);

// (c) Doble clic izquierdo SÍ.
const p3 = await puntoAgarreEnLienzo(cable.id);
must('el cable sigue localizable', enZona(p3));
if (!p3) throw new Error('El cable perdió su punto agarrable antes del doble clic izquierdo.');
await page.mouse.dblclick(p3.x, p3.y); await page.waitForTimeout(450);
const trasDoble = await uniones(cable.id);
must('doble clic izquierdo crea una unión', trasDoble === antesArrastre + 1, `${antesArrastre} → ${trasDoble}`);

// (d) Doble clic derecho SÍ.
const p4 = await puntoAgarreEnLienzo(cable.id);
if (!p4) throw new Error('El cable perdió su punto agarrable antes del doble clic derecho.');
// Dos clics derechos SEGUIDOS. Se despachan los eventos «contextmenu» directamente porque
// el ida y vuelta del control remoto del navegador tarda ~700 ms entre clic y clic —más que
// cualquier persona— y eso, no el programa, es lo que rompería la prueba.
await page.evaluate(([x, y]) => {
	const lienzo = document.querySelector('#escena canvas');
	for (let i = 0; i < 2; i++) {
		lienzo.dispatchEvent(new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
	}
}, [p4.x, p4.y]);
await page.waitForTimeout(500);
must('doble clic derecho crea otra unión', (await uniones(cable.id)) === trasDoble + 1,
	`${trasDoble} → ${await uniones(cable.id)}`);

// (e) Y una unión existente sí se puede arrastrar.
//
// Se pincha SOBRE la unión, no en un punto cualquiera del tubo. Esta prueba usaba
// `puntoParaAgarrar`, que devuelve un píxel cualquiera del cable, y fallaba —con razón—: agarrar
// el cable donde no hay unión NO lo deforma, y es a propósito (las uniones se crean con doble
// clic; si no, mover un cable un poco llenaría el tablero de puntos sin querer). Pedía una
// conducta que el programa no tiene ni debe tener.
const conUnion = (await qa('proyecto')).conductores.find((c) => c.id === cable.id);
const antesPos = JSON.stringify(conUnion.trazado);
const pu = await qa('puntoDeUnion', cable.id, 0);
must('la unión creada se localiza en pantalla', enZona(pu), JSON.stringify(pu));
if (enZona(pu)) {
	await page.mouse.move(pu.x, pu.y); await page.mouse.down(); await page.waitForTimeout(60);
	for (let k = 1; k <= 6; k++) { await page.mouse.move(pu.x + 8 * k, pu.y + 6 * k); await page.waitForTimeout(30); }
	await page.mouse.up(); await page.waitForTimeout(400);
	const desp = JSON.stringify((await qa('proyecto')).conductores.find((c) => c.id === cable.id).trazado);
	must('una unión existente sí se arrastra', desp !== antesPos, `${antesPos} → ${desp}`);
}

// Y lo contrario, que es la regla de verdad: lejos de toda unión, el cable NO se deforma.
{
	const antes = JSON.stringify((await qa('proyecto')).conductores.find((c) => c.id === cable.id).trazado);
	const union = await qa('puntoDeUnion', cable.id, 0);
	const lejos = await puntoAgarreEnLienzo(cable.id, union);
	if (!union || !lejos) throw new Error('No existe un punto agarrable separado de la unión para verificar el arrastre.');
	await page.mouse.move(lejos.x, lejos.y); await page.mouse.down(); await page.waitForTimeout(60);
	for (let k = 1; k <= 6; k++) { await page.mouse.move(lejos.x + 8 * k, lejos.y + 6 * k); await page.waitForTimeout(30); }
	await page.mouse.up(); await page.waitForTimeout(400);
	const desp = JSON.stringify((await qa('proyecto')).conductores.find((c) => c.id === cable.id).trazado);
	must('arrastrar LEJOS de una unión no deforma el cable', desp === antes);
}

/* ================= 1. Tapas de canaleta opacas en Visualización ================= */
console.log('\n--- 1. Tapas de canaleta en Visualización ---');
const tapasNormal = await page.evaluate(() => window.qa.tapas());
info(`trabajando: ${tapasNormal.map((t) => `opacidad ${t.opacidad}`).join(', ') || 'sin canaletas'}`);
must('trabajando, la tapa es translúcida para ver el cableado',
	tapasNormal.length === 0 || tapasNormal.every((t) => t.transparente));
await jsClick('btn-ver'); await page.waitForTimeout(800);
const tapasVista = await page.evaluate(() => window.qa.tapas());
info(`en Visualización: ${tapasVista.map((t) => `opacidad ${t.opacidad}`).join(', ') || 'sin canaletas'}`);
must('en Visualización la tapa es PVC macizo (opaca)',
	tapasVista.length > 0 && tapasVista.every((t) => !t.transparente && t.opacidad === 1),
	JSON.stringify(tapasVista.slice(0, 2)));
await jsClick('btn-ver'); await page.waitForTimeout(600);

/* ================= 7. Imagen de referencia con pines y cables ================= */
console.log('\n--- 7. Imagen de referencia: pines y cableado ---');
await jsClick('modo-editor'); await page.waitForTimeout(300);
const antesImg = (await qa('proyecto')).dispositivos.length;
// PNG de 2×2 px en base64: sirve igual que una foto real para la prueba.
await page.setInputFiles('#archivo-imagen', {
	name: 'controlador.png', mimeType: 'image/png',
	buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64'),
});
// Cargar y decodificar la imagen es asíncrono: se espera a que aparezca de verdad, no un
// tiempo fijo (un tiempo fijo hace que la prueba falle sola en una máquina cargada).
await page.waitForFunction(
	(n) => window.qa.proyecto().dispositivos.filter((d) => d.imagen).length > n,
	(await qa('proyecto')).dispositivos.filter((d) => d.imagen).length,
	{ timeout: 15000 },
).catch(() => {});
await page.waitForTimeout(300);
const conImg = await qa('proyecto');
must('la imagen se añade como aparato', conImg.dispositivos.length === antesImg + 1,
	`${antesImg} → ${conImg.dispositivos.length}`);
const img = conImg.dispositivos.find((d) => d.imagen);
if (!img) {
	console.log('\n=== ' + (fallos + 1) + ' FALLOS ✗ (sin imagen no se puede seguir) ===');
	await browser.close(); server.close(); process.exit(1);
}
must('la imagen queda seleccionada', (await qa('seleccion'))?.id === img.id);
must('se coloca en la placa', conImg.gabinete.colocaciones.some((c) => c.dispositivoId === img.id));

// Añadir puntos de conexión sobre la imagen.
must('aparece el botón de añadir punto de conexión', await page.isVisible('#btn-pin'));
const puestos = [];
for (const [dx, dy] of [[-0.25, -0.25], [0.25, -0.25], [0, 0.3]]) {
	// El modo «añadir punto» se queda activo para poner varios seguidos: solo se enciende si
	// está apagado (pulsarlo otra vez lo apagaría).
	if (!(await qa('estadoInteraccion')).modoPin) { await jsClick('btn-pin'); await page.waitForTimeout(250); }
	const centro = await qa('puntoDeImagen', img.id, dx, dy);
	if (!centro) continue;
	await page.mouse.click(centro.x, centro.y); await page.waitForTimeout(400);
	// El programa pide el nombre del punto, como haría con un usuario de verdad.
	if (await page.isVisible('#modal-dialogo')) {
		await page.fill('#dialogo-input', `T${puestos.length + 1}`);
		await jsClick('dialogo-ok'); await page.waitForTimeout(500);
	}
	puestos.push(((await qa('proyecto')).dispositivos.find((d) => d.id === img.id)?.bornes ?? []).length);
}
const bornesImg = (await qa('proyecto')).dispositivos.find((d) => d.id === img.id)?.bornes ?? [];
info(`puntos tras cada clic: ${puestos.join(' → ')}`);
must('se pueden añadir puntos de conexión sobre la imagen', bornesImg.length >= 2, `${bornesImg.length} puntos`);
must('cada punto guarda su posición sobre la imagen (u,v)',
	bornesImg.length > 0 && bornesImg.every((b) => typeof b.u === 'number' && typeof b.v === 'number'));
must('los nombres escritos se respetan', bornesImg.every((b) => /^T\d$/.test(b.id)), bornesImg.map((b) => b.id).join(', '));

// Cablear uno de esos puntos con un aparato del tablero.
await jsClick('modo-trabajo'); await page.waitForTimeout(400);
await jsClick('btn-centrar'); await page.waitForTimeout(500);
const antesCables = (await qa('proyecto')).conductores.length;
const pinA = await qa('puntoParaBorne', img.id, bornesImg[0].id);
const otro = (await qa('proyecto')).dispositivos.find((d) => d.id !== img.id && d.bornes.length);
const pinB = otro ? await qa('puntoParaBorne', otro.id, otro.bornes.at(-1).id) : undefined;
if (!pinA) {
	// Sin esto, un fallo aquí no dice nada: no se sabe si la esfera del terminal falta en la
	// escena o si es que algo la tapa. Y lo que la tapaba era que la foto caía encima de los
	// aparatos, cuyos terminales sobresalen por delante de ella: por eso se dice con QUÉ se encima.
	info('esferas del aparato imagen: ' + JSON.stringify(await page.evaluate((id) =>
		window.qa.bornes().filter((b) => b.dispositivo === id), img.id)));
	const pj = await qa('proyecto');
	const ci = pj.gabinete.colocaciones.find((c) => c.dispositivoId === img.id);
	const encima = pj.gabinete.colocaciones.filter((c) => c.dispositivoId !== img.id
		&& ci.x < c.x + c.ancho && c.x < ci.x + ci.ancho && ci.y < c.y + c.alto && c.y < ci.y + ci.alto);
	info(`la imagen ocupa ${JSON.stringify(ci)} y se encima con ${encima.length}: `
		+ encima.map((c) => c.dispositivoId).join(', '));
}
must('los puntos de la imagen son clicables en 3D', !!pinA, JSON.stringify(pinA));
if (pinA && pinB) {
	await page.mouse.click(pinA.x, pinA.y); await page.waitForTimeout(400);
	must('pinchar el punto de la imagen inicia el cableado', !!(await qa('estadoInteraccion')).cableando);
	await page.mouse.click(pinB.x, pinB.y); await page.waitForTimeout(600);
	must('el cableado se remata al tocar el segundo borne', !(await qa('estadoInteraccion')).cableando);
	const desp = await qa('proyecto');
	must('se crea el cable desde la imagen al aparato', desp.conductores.length === antesCables + 1,
		`${antesCables} → ${desp.conductores.length}`);
	must('ese cable se dibuja (no es fantasma)', (await qa('cablesDibujados')) === desp.conductores.length,
		`${await qa('cablesDibujados')}/${desp.conductores.length}`);
}

/* ================= Coherencia ================= */
console.log('\n--- Coherencia final ---');
const fin = await qa('proyecto');
must('sin cables fantasma', (await qa('cablesDibujados')) === fin.conductores.length,
	`${await qa('cablesDibujados')}/${fin.conductores.length}`);
must('sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
if (browser) try { await browser.close(); } catch (error) { fallos++; console.error('Cierre Chromium:', error); }
	server.closeAllConnections?.();
	try { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
	catch (error) { fallos++; console.error('Cierre servidor:', error); }
}
console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ✗ ===`);
process.exitCode = fallos === 0 ? 0 : 1;
