/**
 * QA de lo que se pidió tras probar la beta: la ventana de inicio, el alzado 2D y el suelo.
 *
 *  1. El programa abre en una VENTANA DE INICIO donde se elige herramienta, no directamente en
 *     el gabinete. Y desde el editor se puede volver a ella.
 *  2. Hay un botón 3D/2D. El 2D es un ALZADO ORTOGRÁFICO de verdad: sin perspectiva y sin giro.
 *     Se comprueba con la propiedad que define lo ortográfico —dos aparatos igual de altos miden
 *     lo mismo en pantalla aunque uno sobresalga mucho más que el otro—, no mirando una foto.
 *  3. Al agrandar la caja, el tablero NO atraviesa la rejilla del suelo.
 *
 *   node qa/inicio-vistas.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SAL = join(AQUI, '_salida'); mkdirSync(SAL, { recursive: true });
const { servidor: server } = await servidorDeQA();
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/i.test(m.text())) errs.push(m.text()); });

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const click = (id) => page.evaluate((i) => { const b = document.getElementById(i); if (!b) throw new Error('no existe #' + i); b.click(); }, id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);

/* ---------- 1. La ventana de inicio ---------- */
console.log('--- 1. El programa abre en la ventana de inicio ---');
await page.goto(`${base}?qa=1`, { waitUntil: 'load' });
await page.waitForTimeout(1600);
must('sale la ventana de inicio, no el gabinete', await page.isVisible('#inicio'));
must('deja elegir trabajo de tableros', await page.isVisible('#inicio-tableros'));
must('deja elegir ir a terreno', await page.isVisible('#inicio-terreno'));
must('no abre la guía por debajo del inicio', !(await page.isVisible('#modal-ayuda')));
await page.screenshot({ path: join(SAL, 'inicio.png') });

await click('inicio-tableros'); await page.waitForTimeout(500);
must('«Trabajo de tableros» lleva al editor', !(await page.isVisible('#inicio')));
must('y el editor está montado y con tamaño', await page.evaluate(() => {
	const c = document.querySelector('#escena canvas');
	return !!c && c.clientWidth > 600 && c.clientHeight > 400;
}));
must('el catálogo está a mano', await page.evaluate(
	() => document.querySelectorAll('#catalogo .item-catalogo').length > 20));

await click('btn-inicio'); await page.waitForTimeout(300);
must('la marca de la barra vuelve al inicio', await page.isVisible('#inicio'));
await click('inicio-ejemplos'); await page.waitForTimeout(500);
must('desde el inicio se abren los ejemplos', await page.isVisible('#modal-ejemplos'));
must('y la ventana de inicio se aparta', !(await page.isVisible('#inicio')));

// Cargar un tablero con aparatos de fondos MUY distintos, que es donde se nota el alzado.
await page.locator('.tarjeta-ejemplo button').nth(2).click(); await page.waitForTimeout(900);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await click('btn-cerrar-explicacion'); await page.waitForTimeout(200);
const aparatos = await page.evaluate(() => window.qa.proyecto().dispositivos.map((d) => d.id));
must('el ejemplo trae aparatos para medir', aparatos.length > 4, `${aparatos.length}`);
// Fondos de trabajo: la placa (0) y la cara de un variador, el aparato que más sobresale.
const FONDOS = [0, 60, 120];

/* ---------- 2. El alzado 2D ---------- */
console.log('\n--- 2. La vista 2D es un alzado de verdad ---');
must('hay un botón 3D/2D en la barra', await page.isVisible('#btn-2d'));
must('arranca en 3D', (await qa('vista2D')).activa === false);

/** Escala de pantalla (px/mm) a cada profundidad de trabajo. */
const escalas = async () => {
	const out = [];
	for (const z of FONDOS) out.push(await qa('escalaEnPantalla', z));
	return out;
};
const esc3D = await escalas();
const disp3D = Math.max(...esc3D) / Math.min(...esc3D);

await click('btn-2d'); await page.waitForTimeout(700);
const v2 = await qa('vista2D');
must('el botón enciende la vista 2D', v2.activa);
must('la cámara que dibuja es ORTOGRÁFICA', v2.ortografica);
must('en el alzado no se puede girar la vista', v2.gira === false);
must('se apaga la niebla (desteñía el alzado)', v2.niebla === false);
must('el botón pasa a ofrecer volver al 3D',
	(await page.textContent('#btn-2d-texto')).trim() === '3D');
must('el cuerpo marca la vista 2D', await page.evaluate(() => document.body.classList.contains('vista-2d')));
await page.screenshot({ path: join(SAL, 'vista-2d.png') });

/*
 * LA PRUEBA DE FONDO, la que dice si esto es un alzado o una foto de frente: 100 mm de mundo
 * tienen que medir los MISMOS píxeles a ras de la placa que en la cara de un variador que
 * sobresale 12 cm. En ortográfica la escala no depende de la profundidad; en perspectiva sí, y
 * por eso un aparato que sobresale se dibuja más grande que su vecino aunque midan lo mismo.
 */
const esc2D = await escalas();
const disp2D = Math.max(...esc2D) / Math.min(...esc2D);
must('en 2D la escala NO cambia con la profundidad', disp2D < 1.001,
	`${esc2D.map((e) => e.toFixed(4)).join(' / ')} px/mm · dispersión ${((disp2D - 1) * 100).toFixed(2)} %`);
must('y el tablero se ve a un tamaño razonable', esc2D[0] > 0.15 && esc2D[0] < 6,
	`${esc2D[0].toFixed(3)} px/mm`);

// La contraprueba: en 3D esa escala SÍ cambia, que es justo lo que molesta al leer un tablero.
must('en 3D la escala cambia con la profundidad (por eso hacía falta el 2D)', disp3D > 1.01,
	`${esc3D.map((e) => e.toFixed(4)).join(' / ')} px/mm · dispersión ${((disp3D - 1) * 100).toFixed(2)} %`);

await click('btn-2d'); await page.waitForTimeout(700);
must('el botón devuelve al 3D', (await qa('vista2D')).activa === false);
must('vuelve la niebla del 3D', (await qa('vista2D')).niebla === true);

// Se puede cablear igual estando en 2D: los bornes se localizan con la cámara viva.
await click('btn-2d'); await page.waitForTimeout(600);
await click('modo-trabajo'); await page.waitForTimeout(400);
const bornes2D = await qa('bornes');
must('en el alzado los bornes siguen localizables en pantalla', bornes2D.length > 5, `${bornes2D.length}`);
must('y caen dentro del lienzo', bornes2D.filter((b) => b.x > 0 && b.x < 1440 && b.y > 0 && b.y < 900).length > 5);
await click('btn-2d'); await page.waitForTimeout(500);
await click('modo-editor'); await page.waitForTimeout(300);

/* ---------- 3. El suelo ---------- */
console.log('\n--- 3. Al agrandar la caja no se atraviesa el suelo ---');
const suelo0 = await qa('suelo');
must('de partida el suelo está por debajo del tablero', suelo0.y <= suelo0.fondoDelTablero + 1,
	`suelo ${suelo0.y.toFixed(0)} · tablero ${suelo0.fondoDelTablero.toFixed(0)}`);

/** Escribe una medida de la caja y aplica, como haría el usuario. */
async function ponerCaja(campo, valorCm) {
	await page.evaluate(([id, v]) => {
		const el = document.getElementById(id);
		el.value = String(v);
		el.dispatchEvent(new Event('change', { bubbles: true }));
	}, [campo, valorCm]);
	await click('aplicar-dim');
	await page.waitForTimeout(700);
}

for (const alto of [120, 180, 240]) {
	await ponerCaja('caja-alto', alto);
	const s = await qa('suelo');
	must(`con la caja a ${alto} cm el suelo sigue por debajo`, s.y <= s.fondoDelTablero + 1,
		`suelo ${s.y.toFixed(0)} · tablero ${s.fondoDelTablero.toFixed(0)}`);
}
// Y también al revés: al encoger, el suelo sube y no se queda en el sótano.
await ponerCaja('caja-alto', 60);
const sFin = await qa('suelo');
must('al encoger la caja el suelo vuelve a subir', sFin.y > -900 && sFin.y <= sFin.fondoDelTablero + 1,
	`suelo ${sFin.y.toFixed(0)} · tablero ${sFin.fondoDelTablero.toFixed(0)}`);
await page.screenshot({ path: join(SAL, 'suelo.png') });

/* ---------- 4. El parpadeo de los frentes ---------- */
/*
 * «Los controladores parpadean sus letras y su textura». Era z-fighting: la tapa del frente
 * quedaba a 0,2 mm de la cara del cuerpo y el rótulo a 0,7 mm de la tapa, y a la distancia a la
 * que se mira un tablero entero el buffer de profundidad no resuelve eso. Se comprueba la
 * geometría, que es determinista, y no una captura: este contenedor renderiza por software y
 * comparar fotogramas mediría la tarjeta gráfica del servidor, no el arreglo.
 */
console.log('\n--- 4. Ninguna cara del frente se pelea con la de detrás ---');
await click('btn-nuevo'); await page.waitForTimeout(200);
if (await page.isVisible('#modal-dialogo')) { await click('dialogo-ok'); await page.waitForTimeout(400); }
await click('btn-empezar-blanco'); await page.waitForTimeout(300);

/** Coloca uno de cada familia con frente cargado de detalles y devuelve sus ids. */
const puestos = [];
for (const nombre of ['Disyuntor 2P C6', 'Contactor 3P 9A', 'PLC 8E/4S', 'Variador 0.75 kW',
	'Fuente 24 V 2.5 A', 'Bornero 8 bornas 4 mm²']) {
	const b = page.locator('#catalogo button', { hasText: nombre }).first();
	if (!(await b.count())) continue;
	const antes = (await qa('proyecto')).dispositivos.map((d) => d.id);
	await b.click({ force: true }); await page.waitForTimeout(400);
	const nuevo = (await qa('proyecto')).dispositivos.find((d) => !antes.includes(d.id));
	if (nuevo) puestos.push({ id: nuevo.id, nombre });
}
// Y un CONTROLADOR, que es el aparato del que vino la queja: «los controladores parpadean sus
// letras y su textura». Su frente es el más cargado: tapa, rótulo, pantalla, LEDs y puertos.
await click('btn-controlador-medida'); await page.waitForTimeout(400);
must('se abre el diálogo del controlador a medida', await page.isVisible('#modal-controlador'));
await page.evaluate(() => {
	const set = (id, v) => {
		const el = document.getElementById(id);
		el.value = v;
		el.dispatchEvent(new Event('change', { bubbles: true }));
	};
	set('ctrl-fabricante', 'Honeywell');
	set('ctrl-referencia', 'PUB6438S');
	set('ctrl-arriba', 'UI1-8, COM');
	set('ctrl-abajo', 'DO1-6, DOC');
	set('ctrl-izquierda', '24V~, 24V COM, GND');
	set('ctrl-derecha', 'MS/TP+, MS/TP-, SHLD');
});
await page.waitForTimeout(200);
await click('btn-crear-controlador'); await page.waitForTimeout(800);
const pCtrl = await qa('proyecto');
const ctrl = pCtrl.dispositivos.find((d) => d.referencia === 'PUB6438S');
must('el controlador queda colocado en la placa', !!ctrl, ctrl?.designacion);
if (ctrl) puestos.push({ id: ctrl.id, nombre: 'Controlador Honeywell' });
must('hay aparatos con frente que revisar', puestos.length >= 5, puestos.map((p) => p.nombre).join(', '));

/** Pares de caras planas paralelas que se solapan en XY y quedan demasiado juntas en Z. */
function conflictos(piezas) {
	const malos = [];
	for (let i = 0; i < piezas.length; i++) {
		for (let j = i + 1; j < piezas.length; j++) {
			const a = piezas[i];
			const b = piezas[j];
			if (a.sesgo || b.sesgo) continue;          // una calcomanía sesgada gana siempre
			// Solape real en planta (no vale rozarse por una esquina).
			const solapeX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
			const solapeY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
			if (solapeX < 1 || solapeY < 1) continue;
			// Caras frontales enfrentadas: las dos miran a la cámara y están casi en el mismo plano.
			const d = Math.abs(a.z1 - b.z1);
			if (d > 0.001 && d < 0.5) malos.push({ z: a.z1.toFixed(2), otro: b.z1.toFixed(2), d: d.toFixed(2) });
		}
	}
	return malos;
}

for (const { id, nombre } of puestos) {
	const piezas = await qa('capasDeFrente', id);
	const malos = conflictos(piezas);
	must(`${nombre}: ninguna cara a menos de 0,5 mm de otra`, malos.length === 0,
		malos.length ? `${malos.length} pares, p. ej. z=${malos[0].z} vs ${malos[0].otro} (${malos[0].d} mm)`
			: `${piezas.length} piezas revisadas`);
}
// Y que los rótulos impresos lleven el sesgo que los pone siempre por delante.
const conSesgo = await Promise.all(puestos.map(async ({ id }) =>
	(await qa('capasDeFrente', id)).some((p) => p.sesgo)));
must('los rótulos impresos van sesgados hacia la cámara', conSesgo.filter(Boolean).length >= 4,
	`${conSesgo.filter(Boolean).length} de ${puestos.length} aparatos`);

/* ---------- 5. Manejo de cables y de aparatos, estilo Tinkercad ---------- */
console.log('\n--- 5. El cable se ve mientras se lleva de un borne a otro ---');
await click('btn-nuevo'); await page.waitForTimeout(200);
if (await page.isVisible('#modal-dialogo')) { await click('dialogo-ok'); await page.waitForTimeout(400); }
await click('btn-empezar-ejemplo'); await page.waitForTimeout(400);
await page.locator('.tarjeta-ejemplo button').nth(0).click(); await page.waitForTimeout(1000);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
await click('btn-cerrar-explicacion'); await page.waitForTimeout(300);
await click('modo-trabajo'); await page.waitForTimeout(400);
await click('btn-centrar'); await page.waitForTimeout(700);

/*
 * Dos bornes separados y que NO estén ya conectados entre sí: el tablero de ejemplo viene
 * cableado, y sobre un par ya unido el programa avisa y no tiende nada (con razón).
 */
const visibles = (await qa('bornes')).filter((b) => b.x > 60 && b.x < 1380 && b.y > 60 && b.y < 880);
const yaUnidos = new Set((await qa('proyecto')).conductores.flatMap((c) => [
	`${c.de.dispositivoId}:${c.de.borneId}|${c.a.dispositivoId}:${c.a.borneId}`,
	`${c.a.dispositivoId}:${c.a.borneId}|${c.de.dispositivoId}:${c.de.borneId}`,
]));
let bA;
let bB;
for (const p of visibles) {
	const q = visibles.find((o) => o.dispositivo !== p.dispositivo
		&& Math.hypot(o.x - p.x, o.y - p.y) > 120
		&& !yaUnidos.has(`${p.dispositivo}:${p.borne}|${o.dispositivo}:${o.borne}`));
	if (q) { bA = p; bB = q; break; }
}
must('hay dos bornes sin conectar para probar el tendido', !!bA && !!bB);

const cablesAntes = (await qa('proyecto')).conductores.length;
await page.mouse.move(bA.x, bA.y);
await page.mouse.down();
await page.waitForTimeout(200);
// LO QUE FALTABA: el cable tiene que verse ya, sin mover el ratón.
const goma0 = (await qa('estadoInteraccion')).goma;
must('al apretar el borne YA aparece el cable', goma0.montado, JSON.stringify(goma0));
must('y es un tubo, no una raya de un píxel', goma0.tubo);

// Y tiene que estirarse mientras se lleva al otro borne (la animación que se pedía).
await page.mouse.move((bA.x + bB.x) / 2, (bA.y + bB.y) / 2, { steps: 6 }); await page.waitForTimeout(150);
const goma1 = (await qa('estadoInteraccion')).goma;
await page.mouse.move(bB.x, bB.y, { steps: 6 }); await page.waitForTimeout(150);
const goma2 = (await qa('estadoInteraccion')).goma;
must('el cable se estira al llevarlo hacia el otro borne',
	goma2.largo > goma1.largo && goma1.largo > 0, `${goma0.largo} → ${goma1.largo} → ${goma2.largo} mm`);

// Y se remata SOLTANDO, sin un segundo clic.
await page.mouse.up(); await page.waitForTimeout(500);
const cablesDespues = (await qa('proyecto')).conductores.length;
must('soltando sobre el otro borne queda el cable hecho', cablesDespues === cablesAntes + 1,
	`${cablesAntes} → ${cablesDespues}`);
must('y el cable en vivo desaparece', !(await qa('estadoInteraccion')).goma.montado);
await page.screenshot({ path: join(SAL, 'cable-en-vivo.png') });

console.log('\n--- 6. Los cables no se montan unos sobre otros ---');
const amont = await qa('amontonamiento');
must('el amontonamiento se mide', amont.cables > 10, `${amont.cables} cables`);
must('cada cable va prácticamente por su sitio', amont.totalMm / amont.cables < 25,
	`${Math.round(amont.totalMm / amont.cables)} mm/cable · ${amont.pares} pares · ${amont.totalMm} mm en total`);
// Y en 3D corren a profundidades distintas, para que los cruces se apilen en vez de atravesarse.
const profundidades = new Set((await qa('rutas')).map((r) => r.z));
must('los cables se reparten en capas de profundidad', profundidades.size > 1,
	`${profundidades.size} capas: ${[...profundidades].sort((a, b) => a - b).join(', ')} mm`);

console.log('\n--- 7. El aparato nuevo se coloca donde está el ratón ---');
await click('modo-editor'); await page.waitForTimeout(400);
const antesAparatos = (await qa('proyecto')).dispositivos.length;
await page.locator('#catalogo button', { hasText: 'Relé auxiliar 24 V' }).first().click({ force: true });
await page.waitForTimeout(500);
const nuevo = (await qa('proyecto')).dispositivos.at(-1);
must('el aparato entra al proyecto', (await qa('proyecto')).dispositivos.length === antesAparatos + 1);
must('y queda pegado al ratón esperando dónde soltarlo', await page.evaluate(
	() => document.getElementById('ayuda').textContent.includes('pegado al ratón')));

/** Lleva el ratón a un punto de la placa y lee dónde acabó el aparato. */
const dondeCae = async (mx, my) => {
	await page.mouse.move(mx, my, { steps: 4 }); await page.waitForTimeout(220);
	const col = (await qa('proyecto')).gabinete.colocaciones.find((c) => c.dispositivoId === nuevo.id);
	return { x: col.x, y: col.y };
};
const arriba = await dondeCae(700, 320);
const abajo = await dondeCae(700, 620);
must('sigue al ratón por la placa', Math.abs(abajo.y - arriba.y) > 20,
	`y ${arriba.y} → ${abajo.y} mm`);
await page.mouse.click(700, 620); await page.waitForTimeout(500);
must('el clic lo suelta ahí', !(await page.evaluate(
	() => document.getElementById('ayuda').textContent.includes('pegado al ratón'))));
const colFinal = (await qa('proyecto')).gabinete.colocaciones.find((c) => c.dispositivoId === nuevo.id);
must('y se queda donde se soltó, no en el riel de arriba', Math.abs(colFinal.y - abajo.y) < 2,
	`y=${colFinal.y} mm`);
must('pegado a un riel, como manda un aparato DIN', !!colFinal.rielId, colFinal.rielId);

console.log('\n--- 8. En el alzado 2D se mueve el punto, no la cámara ---');
await click('modo-trabajo'); await page.waitForTimeout(400);
await click('btn-2d'); await page.waitForTimeout(700);
const cableId = (await qa('proyecto')).conductores[0].id;
const agarre = await qa('puntoParaAgarrar', cableId);
must('se localiza un punto del cable en el alzado', !!agarre, JSON.stringify(agarre));
if (agarre) {
	// Doble clic para crear la unión, y luego se arrastra, igual que en 3D.
	await page.mouse.dblclick(agarre.x, agarre.y); await page.waitForTimeout(400);
	const rutaAntes = (await qa('rutas')).find((r) => r.id === cableId);
	const camaraAntes = await qa('vista2D');   // se mide AQUÍ, con este tablero y este encuadre
	await page.mouse.move(agarre.x, agarre.y);
	await page.mouse.down();
	await page.mouse.move(agarre.x + 70, agarre.y + 40, { steps: 8 }); await page.waitForTimeout(250);
	const durante = await qa('vista2D');
	await page.mouse.up(); await page.waitForTimeout(400);
	const rutaDespues = (await qa('rutas')).find((r) => r.id === cableId);
	must('arrastrar mueve el CABLE', JSON.stringify(rutaAntes.nodos) !== JSON.stringify(rutaDespues.nodos));
	// Este era el bug: en el alzado el botón izquierdo desplaza la hoja, así que sin bloquear la
	// cámara al empezar el arrastre se movía la vista entera en vez del punto del cable.
	must('la cámara del alzado queda bloqueada mientras se arrastra', durante.suelta === false);
	must('y NO se mueve ni un milímetro',
		durante.x === camaraAntes.x && durante.y === camaraAntes.y && durante.zoom === camaraAntes.zoom,
		`antes (${camaraAntes.x}, ${camaraAntes.y}) z${camaraAntes.zoom} → durante (${durante.x}, ${durante.y}) z${durante.zoom}`);
	must('la vista sigue siendo el alzado', camaraAntes.activa && (await qa('vista2D')).activa);
}
await click('btn-2d'); await page.waitForTimeout(400);

console.log('\n--- 9. Sin errores ---');
must('ningún error de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
