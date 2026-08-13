/**
 * ENERGIZAR Y PULSAR CON EL RATÓN, QUE ES LO QUE HACE UNA PERSONA.
 *
 * Diego pregunta por qué al energizar «no pasa nada» y sale «Nada está funcionando todavía»,
 * incluso en los tableros de ejemplo. Hay dos respuestas posibles y hay que separarlas:
 *
 *   (a) es lo correcto. Energizar da TENSIÓN, no arranca nada: en un tablero de verdad tampoco
 *       arranca el motor al subir el automático. Hace falta apretar MARCHA, cerrar la boya o
 *       activar la sonda. El aviso es informativo y lo dice.
 *   (b) es un fallo: el clic sobre el aparato en el 3D no acciona, y entonces el usuario no tiene
 *       forma de hacer nada y el aviso se queda puesto para siempre.
 *
 * `qa/ejemplos-energizados.mjs` NO distingue una de otra, porque acciona llamando a
 * `window.qa.accionar(id)` —una sonda interna—, no pinchando. Es el mismo punto ciego que dejó
 * pasar la pantalla congelada: probar por dentro un camino que por fuera puede estar cerrado.
 *
 * Esto pincha con el RATÓN, sobre el aparato, en el sitio donde se ve en pantalla.
 *
 *   node qa/energizar-con-raton.mjs
 */
import { chromium } from 'playwright-core';
import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';

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

/**
 * Abre el ejemplo nº `i` y deja el tablero sin ventanas encima.
 *
 * Para NAVEGAR se pulsa con JavaScript, como el resto de las suites: «Ver un tablero de ejemplo»
 * vive dentro de un menú desplegable y abrirlo no es lo que se está probando aquí —de eso se
 * encarga `qa/todos-los-botones.mjs`, que sí lo hace con el ratón—. El ratón de verdad se reserva
 * para lo único que importa en esta prueba: pinchar el aparato en el tablero 3D.
 */
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
	if (await p.isVisible('#modal-dialogo')) {
		await p.evaluate(() => document.getElementById('dialogo-ok')?.click());
		await p.waitForTimeout(900);
	}
	if (await p.isVisible('#modal-explicacion')) {
		await p.evaluate(() => document.getElementById('btn-cerrar-explicacion')?.click());
		await p.waitForTimeout(500);
	}
	return qa('proyecto');
}

/**
 * Dónde se ve un aparato en la pantalla, en píxeles.
 *
 * La colocación da su esquina en milímetros sobre la placa; el centro de su cara es lo que se ve
 * y lo que se pincha. `puntoEnPantalla` hace la cuenta con la cámara que hay puesta ahora mismo.
 */
async function puntoDelAparato(id) {
	const pr = await qa('proyecto');
	const col = pr.gabinete.colocaciones.find((c) => c.dispositivoId === id);
	if (!col) return null;
	const d = pr.dispositivos.find((x) => x.id === id);
	if (!d) return null;
	const ancho = col.ancho ?? d.ancho ?? 18;
	const alto = col.alto ?? d.alto ?? 45;
	// El frente del aparato sobresale de la placa; se pincha ahí, no en el fondo.
	return qa('puntoEnPantalla', col.x + ancho / 2, col.y + alto / 2, 60);
}

/**
 * Acciona un mando desde la lista de «Mandos» del panel, con el RATÓN.
 *
 * Es el camino que tiene el usuario cuando el aparato no está montado dentro del armario, que es
 * el caso de los pulsadores de marcha y paro y de la boya en tres de los cinco ejemplos.
 */
async function accionarDesdeElPanel(id) {
	const sel = `#sim-mandos [data-mando="${id}"]`;
	if (!(await p.isVisible(sel))) return { ok: false, motivo: 'no aparece en la lista de Mandos' };
	await p.locator(sel).click({ timeout: 30_000 });
	await p.waitForTimeout(900);
	return { ok: true };
}

/** Pincha el aparato con el ratón, donde se ve en el tablero 3D. */
async function pinchar(id) {
	const pt = await puntoDelAparato(id);
	if (!pt) return { ok: false, motivo: 'no está montado en el armario: no hay nada que pinchar' };
	if (pt.x < 0 || pt.y < 0 || pt.x > 1500 || pt.y > 950) {
		return { ok: false, motivo: `cae fuera de la ventana (${Math.round(pt.x)}, ${Math.round(pt.y)})` };
	}
	await p.mouse.move(pt.x, pt.y);
	await p.waitForTimeout(120);
	await p.mouse.down();
	await p.waitForTimeout(90);
	await p.mouse.up();
	await p.waitForTimeout(900);
	return { ok: true, punto: `${Math.round(pt.x)}, ${Math.round(pt.y)}` };
}

/* ================================================================== */

console.log('### 1 · arranque directo: energizar y apretar MARCHA con el ratón');

const uno = await abrirEjemplo(0);
must('CONDICIÓN PREVIA: el arranque directo está cargado', uno.dispositivos.length > 5,
	`${uno.dispositivos.length} aparatos`);

await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(1200);
const trasEnergizar = await qa('simulacion');
must('el tablero coge tensión', trasEnergizar.energizado);

/*
 * QUE NO ARRANQUE NADA AL ENERGIZAR ES LO CORRECTO, y conviene dejarlo escrito: subir el
 * automático de un tablero de verdad tampoco pone el motor en marcha. Lo que hay que comprobar es
 * que DESPUÉS, apretando, arranque.
 */
must('al energizar todavía no funciona nada (es lo correcto: falta apretar MARCHA)',
	trasEnergizar.activos.length === 0, trasEnergizar.activos.join(' ') || '(nada)');
console.log(`     aviso en pantalla: «${(trasEnergizar.avisos[0] ?? '').slice(0, 70)}»`);

/*
 * -S1 y -S0 NO están montados en el armario: son de puerta. Por eso no se pueden pinchar en el 3D
 * —no tienen cuerpo— y por eso hay una lista de «Mandos» en el panel. Se comprueban las dos cosas:
 * que efectivamente no hay nada que pinchar (para que quede escrito el porqué) y que desde el
 * panel sí se puede arrancar.
 */
const clicEn3D = await pinchar('s1');
must('CONSTATACIÓN: el pulsador de marcha no está en el armario, no hay nada que pinchar',
	!clicEn3D.ok, clicEn3D.motivo ?? '(sí se pudo pinchar)');

const desdePanel = await accionarDesdeElPanel('s1');
must('el pulsador de MARCHA sale en la lista de Mandos y se puede pulsar', desdePanel.ok,
	desdePanel.motivo ?? '');

const trasPulsar = await qa('simulacion');
must('al pulsarlo con el RATÓN, KM1 se mete y el motor arranca',
	trasPulsar.activos.includes('km1') && trasPulsar.activos.includes('m1'),
	trasPulsar.activos.join(' ') || '(nada: el mando no accionó)');

const mandos = await qa('estadoSim');
console.log(`     mandos accionados: ${mandos.map((m) => m.id).join(' ') || '(ninguno)'}`);

/* ------------------------------------------------------------------ */

console.log('\n### 2 · la bomba con boya: cerrar la boya con el ratón');

await abrirEjemplo(1);
if (!(await qa('simulacion')).energizado) {
	await p.evaluate(() => document.getElementById('btn-energizar')?.click());
	await p.waitForTimeout(1200);
}
const bombaAntes = await qa('simulacion');
must('la bomba tampoco arranca sola al energizar', !bombaAntes.activos.includes('m1'),
	bombaAntes.activos.join(' ') || '(nada)');

const boya = await accionarDesdeElPanel('b1');
must('la boya sale en la lista de Mandos y se puede accionar', boya.ok, boya.motivo ?? '');
const bombaDespues = await qa('simulacion');
must('con la boya cerrada la bomba arranca',
	bombaDespues.activos.includes('km1') && bombaDespues.activos.includes('m1'),
	bombaDespues.activos.join(' ') || '(nada: el mando no accionó)');

/* ------------------------------------------------------------------ */

console.log('\n### 3 · lo que está montado DENTRO sí se pincha en el tablero');

/*
 * La otra mitad del camino: un aparato que sí tiene cuerpo en el 3D —el guardamotor `-Q1`— se
 * acciona pinchándolo. Si esto se rompiera, la lista de mandos taparía el fallo.
 */
const clicQ1 = await pinchar('q1');
must('se puede pinchar -Q1 en el tablero 3D', clicQ1.ok, clicQ1.motivo ?? clicQ1.punto);
const mandosQ1 = await qa('estadoSim');
must('y el clic lo abre de verdad', mandosQ1.some((m) => m.id === 'q1' && m.cerrado === false),
	JSON.stringify(mandosQ1.find((m) => m.id === 'q1') ?? null));

/* ------------------------------------------------------------------ */

console.log(`\nerrores de JavaScript: ${errores.length}`);
must('ni un error de JavaScript', errores.length === 0, errores.slice(0, 2).join(' | '));

await b.close();
servidor.close();
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
