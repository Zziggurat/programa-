/**
 * QA de los dos problemas que se ven en un tablero real:
 *
 *  1. CABLES FUNDIDOS: dos conductores que llegan al mismo borne (o que corren en paralelo)
 *     dibujados exactamente uno encima de otro, de modo que parecen un solo cable.
 *  2. SELECCIÓN DESCALIBRADA: apuntas a un cable y el programa agarra el de al lado, porque
 *     el tubo grueso invisible de agarre del vecino le robaba el clic.
 *
 *   node qa/cables-fusion.mjs
 */
import { chromium } from 'playwright-core';

import { join } from 'node:path';
import { abrirNavegador, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const { servidor: server } = await servidorDeQA();
const url = `http://127.0.0.1:${server.address().port}/?qa=1&inicio=0`;

const browser = await abrirNavegador(chromium);
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const cdp = await page.context().newCDPSession(page);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

let fallos = 0;
const must = (n, c, extra = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${extra ? ' → ' + extra : ''}`); };
const info = (t) => console.log('     ' + t);
const jsClick = (id) => page.evaluate((i) => document.getElementById(i)?.click(), id);
const qa = (fn, ...a) => page.evaluate(([f, args]) => window.qa[f](...args), [fn, a]);
const LIBRE = { x0: 320, x1: 966, y0: 60, y1: 782 };
const enZona = (p) => p && p.x > LIBRE.x0 && p.x < LIBRE.x1 && p.y > LIBRE.y0 && p.y < LIBRE.y1;

await page.goto(url);
await page.waitForTimeout(900);

/** Abre un tablero de la biblioteca (índice de la tarjeta) y lo deja en modo Trabajo. */
async function abrirEjemplo(indice) {
	await jsClick('btn-nuevo'); await page.waitForTimeout(250);
	if (await page.isVisible('#modal-dialogo')) { await jsClick('dialogo-ok'); await page.waitForTimeout(350); }
	await jsClick('btn-empezar-ejemplo'); await page.waitForTimeout(350);
	if (await page.isVisible('#modal-ejemplos')) {
		await page.locator('.tarjeta-ejemplo button').nth(indice).click(); await page.waitForTimeout(650);
if (await page.isVisible('#modal-dialogo')) { await page.evaluate(() => document.getElementById('dialogo-ok')?.click()); await page.waitForTimeout(300); }
		await jsClick('btn-cerrar-explicacion'); await trabajarSobreCopia(page);
	}
	// La guía de primera visita se queda por delante del lienzo: se cierra, como haría cualquiera.
	if (await page.isVisible('#modal-ayuda')) { await jsClick('btn-cerrar-ayuda'); await page.waitForTimeout(200); }
	await jsClick('modo-trabajo'); await page.waitForTimeout(300);
	await jsClick('btn-centrar'); await page.waitForTimeout(400);
}

/** Comprueba que nada tapa el lienzo antes de pinchar (un modal abierto se comería el clic). */
async function lienzoLibre() {
	return !(await page.isVisible('#modal-ayuda')) && !(await page.isVisible('#modal-dialogo'))
		&& !(await page.isVisible('#modal-ejemplos')) && !(await page.isVisible('#modal-explicacion'));
}

/* ============ 1. Ningún cable puede salir FUNDIDO con otro de su mismo borne ============ */

const SEPARACION_MIN = 4; // mm: por debajo de esto dos cables se ven como uno solo

/** Punto 3D a `dist` mm de un extremo del recorrido final. */
function puntaDe(puntos, dist, desdeElFinal) {
	const lista = desdeElFinal ? puntos.slice().reverse() : puntos;
	let restante = dist;
	for (let i = 1; i < lista.length; i++) {
		const a = lista[i - 1]; const b = lista[i];
		const largo = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
		if (largo >= restante && largo > 0) {
			const t = restante / largo;
			return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
		}
		restante -= largo;
	}
	return lista[lista.length - 1];
}

for (const [indice, nombre] of [[0, 'Arranque directo'], [1, 'Bomba con boya'], [2, 'Arranque estrella-triángulo']]) {
	console.log(`\n--- 1. ${nombre}: cables que comparten borne ---`);
	await abrirEjemplo(indice);
	const proyecto = await qa('proyecto');
	const rutas = await qa('rutas');
	const porId = new Map(rutas.map((r) => [r.id, r]));

	// Agrupa los conductores por borne y comprueba que las puntas de los que comparten uno
	// están separadas: si coincidieran, se verían fundidas en una sola conexión.
	const enBorne = new Map();
	for (const c of proyecto.conductores) {
		for (const [ref, alFinal] of [[c.de, false], [c.a, true]]) {
			const clave = `${ref.dispositivoId}:${ref.borneId}`;
			if (!enBorne.has(clave)) enBorne.set(clave, []);
			enBorne.get(clave).push({ id: c.id, alFinal });
		}
	}
	let compartidos = 0;
	let fundidos = 0;
	let peor = Infinity;
	for (const [clave, lista] of enBorne) {
		if (lista.length < 2) continue;
		compartidos++;
		for (let i = 0; i < lista.length; i++) {
			for (let j = i + 1; j < lista.length; j++) {
				const a = porId.get(lista[i].id); const b = porId.get(lista[j].id);
				if (!a || !b) continue;
				// Fin de la zona física: radio mínimo del codo (10 + 4r) más la separación
				// visual exigida. En un cable de 6 mm² son 26 mm; antes de eso aún está abriendo.
				const finZona = 10 + 4 * Math.max(a.radio, b.radio) + SEPARACION_MIN;
				const pa = puntaDe(a.puntos, finZona, lista[i].alFinal);
				const pb = puntaDe(b.puntos, finZona, lista[j].alFinal);
				const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
				peor = Math.min(peor, d);
				if (d < SEPARACION_MIN) { fundidos++; info(`fundidos en ${clave}: ${lista[i].id} y ${lista[j].id} (${d.toFixed(1)} mm)`); }
			}
		}
	}
	info(`${compartidos} bornes con más de un cable · separación mínima ${peor === Infinity ? '—' : peor.toFixed(1) + ' mm'}`);
	must('ningún par de cables sale fundido del mismo borne', fundidos === 0, `${fundidos} pares`);

	/* ---- y tampoco pueden ir uno DENTRO de otro a lo largo del recorrido ---- */
	/*
	 * Lo que se exige es que ningún cable vaya metido dentro de otro: mismo recorrido Y misma
	 * profundidad, o sea indistinguibles por mucho que se gire la vista. Correr en paralelo por
	 * el mismo pasillo, en capas distintas, no es un defecto: es lo que hace un mazo de verdad,
	 * y medirlo en plano —que es lo que hacía esta prueba antes, con un tope de 45 mm/cable
	 * puesto a ojo— castigaba precisamente el peinado bien hecho.
	 */
	const am = await qa('amontonamiento');
	const porCable = am.cables ? Math.round(am.totalMm / am.cables) : 0;
	info(`en paralelo: ${am.totalMm} mm en ${am.pares} pares de ${am.cables} cables (${porCable} mm/cable)`);
	info(`eje 3D coincidente: ${am.fusionMm} mm en ${am.paresFusionados} pares`);
	must('ningún cable va metido DENTRO de otro', am.fusionMm === 0,
		`${am.fusionMm} mm en ${am.paresFusionados} pares`);
}

/* ============ 2. La selección tiene que caer en el cable que se está señalando ============ */

console.log('\n--- 2. Apuntar y seleccionar: el clic cae en el cable señalado ---');
await abrirEjemplo(2);
/*
 * Todas las muestras se calculan dentro de la página. Antes se hacían 170 viajes secuenciales
 * Playwright ↔ navegador y cada uno volvía a proyectar todas las rutas. La afirmación no cambia:
 * se siguen comprobando TODOS los puntos de TODOS los cables, solo se evita pagar 170 veces el
 * protocolo remoto entre ambos procesos.
 */
const cobertura = await page.evaluate((zona) => {
	const dentro = (p) => p && p.x > zona.x0 && p.x < zona.x1 && p.y > zona.y0 && p.y < zona.y1;
	return window.qa.rutas().map((ruta) => {
		let puntos = window.qa.puntosVisiblesDeCable(ruta.id, 7).filter(dentro);
		/*
		 * Siete muestras mantienen barata la pasada normal. Si no encuentran ninguna, se agota el
		 * recorrido con 21 antes de declarar el cable inaccesible. La condición es general: `w18`
		 * fue quien reveló el hueco, pero cualquier conductor completamente oculto debe poner rojo.
		 */
		if (puntos.length === 0) puntos = window.qa.puntosVisiblesDeCable(ruta.id, 21).filter(dentro);
		return {
			id: ruta.id,
			muestras: puntos.map((punto) => ({
				id: ruta.id, elegido: window.qa.cableEnPixel(punto.x, punto.y),
			})),
		};
	});
}, LIBRE);
const sinMuestra = cobertura.filter((c) => c.muestras.length === 0).map((c) => c.id);
const muestras = cobertura.flatMap((c) => c.muestras);
const probados = muestras.length;
const aciertos = muestras.filter((m) => m.elegido === m.id).length;
const errados = muestras.filter((m) => m.elegido !== m.id)
	.map((m) => `${m.id} → ${m.elegido ?? 'nada'}`);
info(`${aciertos}/${probados} clics cayeron en el cable señalado`);
if (errados.length) info('errados: ' + errados.slice(0, 6).join(', '));
if (sinMuestra.length) info('sin punto frontal propio: ' + sinMuestra.slice(0, 10).join(', '));
must('cada cable tiene al menos un punto frontal comprobable', sinMuestra.length === 0,
	`${cobertura.length - sinMuestra.length}/${cobertura.length}`);
must('apuntar a un cable selecciona ESE cable', aciertos === probados, `${aciertos}/${probados}`);

/* ---- Y el clic de verdad (ratón real) también, incluso con la cámara girada ---- */

/**
 * Espera a que la cámara deje de moverse DE VERDAD.
 *
 * La órbita lleva amortiguación: al soltar el ratón la cámara sigue frenando sola. Esperar un
 * tiempo fijo no basta — en una máquina lenta cada fotograma tarda mucho más y la cámara todavía
 * se está moviendo. Si la prueba calcula el píxel donde se ve un cable y pincha ahí mientras
 * tanto, apunta a una escena y pincha en otra, y un tubo fino se le escapa por un píxel.
 */
async function esperarCamaraQuieta(maximoMs = 6000) {
	/*
	 * Un solo viaje al navegador. Hacer el mismo sondeo con un `page.evaluate` por muestra
	 * convertía seis segundos de espera máxima en decenas de segundos bajo SwiftShader: cada
	 * consulta tenía que esperar su turno detrás del render. La condición y la cadencia de 120 ms
	 * son las mismas; solo el polling vive ahora donde está la cámara.
	 */
	await page.evaluate((limite) => new Promise((resolver) => {
		let antes = window.qa.camara();
		const hasta = performance.now() + limite;
		const mirar = () => {
			const ahora = window.qa.camara();
			if (Object.keys(ahora).every((k) => Math.abs(ahora[k] - antes[k]) < 0.02)
				|| performance.now() >= hasta) { resolver(undefined); return; }
			antes = ahora;
			setTimeout(mirar, 120);
		};
		setTimeout(mirar, 120);
	}), maximoMs);
}

async function girarCamara(dx, dy) {
	await qa('congelarCamara', false);   // para girar sí interesa el glisado, como al usuario
	const x = LIBRE.x1 - 30, y = LIBRE.y0 + 30;
	await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(30);
	for (let k = 1; k <= 5; k++) { await page.mouse.move(x + (dx * k) / 5, y + (dy * k) / 5); await page.waitForTimeout(25); }
	await page.mouse.up();
	await esperarCamaraQuieta();
}

for (const [dx, dy, comoSeVe] of [[0, 0, 'de frente'], [110, 0, 'girado a la derecha'], [-90, -60, 'girado a la izquierda y arriba']]) {
	if (dx || dy) await girarCamara(dx, dy);
	// La órbita nunca se para del todo: se le quita la amortiguación para medir y pinchar sobre
	// la misma vista. Sin esto fallaba un cable de cada treinta y tantos, distinto cada vez.
	await qa('congelarCamara', true);
	await page.waitForTimeout(120);
	const lista = await qa('rutas');
	/*
	 * La decisión geométrica ya se comprobó exhaustivamente arriba (170 puntos de todos los
	 * cables). Aquí se verifica otra capa: que eventos trusted de botón atraviesen el manejador y
	 * produzcan la selección. Ocho cables repartidos de extremo a extremo de la lista cubren ese
	 * camino sin repetir 177 veces el raycast volumétrico más caro de la sonda.
	 */
	const reales = [...new Set(Array.from({ length: Math.min(8, lista.length) }, (_, i) =>
		lista[Math.round((i * (lista.length - 1)) / Math.max(1, Math.min(8, lista.length) - 1))]))];
	let ok = 0; let total = 0;
	const mal = [];
	const sinPunto = [];
	/*
	 * La lectura de la selección anterior y la búsqueda del punto siguiente comparten visita al
	 * navegador. El orden sigue siendo el correcto: clic trusted → leer a quién eligió → Esc para
	 * limpiar → buscar el próximo punto ya en estado limpio. No se precalculan puntos sobre una
	 * escena distinta; solo se evita pagar dos turnos de protocolo para dos operaciones contiguas.
	 */
	const preparar = (id, conSeleccion, limpiar = false) => page.evaluate(([cable, zona, leerSeleccion, cancelar]) => {
		const seleccion = leerSeleccion ? window.qa.seleccion() : undefined;
		/*
		 * Escape solo prepara el caso siguiente; no es la entrada bajo prueba. La aplicación no
		 * distingue eventos trusted aquí (ni debería: cancelar no concede ninguna capacidad), y el
		 * clic que se valida sigue entrando por CDP como evento real del navegador.
		 */
		if (cancelar) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		return { seleccion, candidato: window.qa.puntoParaAgarrar(cable, 9, zona) };
	}, [id, LIBRE, conSeleccion, limpiar]);
	await page.keyboard.press('Escape');
	let preparado = await preparar(reales[0].id, false);
	for (let indice = 0; indice < reales.length; indice++) {
		const r = reales[indice];
		// Esc antes de cada intento: si un clic anterior arrancó un cableado sin querer, TODOS los
		// clics siguientes se los come el tendido y saldrían como fallo en cascada, tapando cuál
		// fue el que falló de verdad. Desde el segundo cable, el Esc ocurre al preparar esta entrada.
		/*
		 * Apuntar, COMPROBAR que el píxel sigue siendo suyo y pinchar sin soltar el aliento.
		 *
		 * La órbita tiene inercia y nunca se para del todo, así que entre calcular el píxel y
		 * pinchar la vista se mueve un pelo y un tubo fino se escapa. Antes se reapuntaba una vez
		 * y se pinchaba a ciegas: si el segundo punto también llegaba tarde, fallo. Y salía un
		 * cable distinto en cada pasada, que es la firma de una carrera y no de un bug.
		 *
		 * Ahora se reintenta hasta cuatro veces y entre la comprobación y el clic NO hay espera:
		 * la ventana en la que la cámara puede moverse queda cerrada.
		 */
		/*
		 * La cámara está congelada: repetir la misma búsqueda determinista no puede dar otro resultado.
		 * Nueve muestras cubren el recorrido sin los 30 raycasts por cable del valor
		 * predeterminado, y la zona se filtra DENTRO de la sonda para no elegir primero un punto que
		 * luego se descarte aquí.
		 */
		const candidato = preparado.candidato;
		/*
		 * `puntoParaAgarrar` ya exige, con el mismo raycaster de `cableEnPixel`, que el primer tubo
		 * visible sea éste. Repetir la consulta desde Playwright no añadía una condición: añadía un
		 * segundo viaje. La equivalencia semántica se comprueba exhaustivamente justo arriba; aquí
		 * corresponde comprobar la otra capa, el evento trusted y su selección final.
		 */
		const p = enZona(candidato) ? candidato : undefined;
		if (!p) {
			sinPunto.push(r.id);
			if (indice + 1 < reales.length) {
				preparado = await preparar(reales[indice + 1].id, false, true);
			}
			continue;
		}
		// El clic se completa antes de leer la selección. Leerla entre pointerdown y pointerup —como
		// hacía la prueba anterior— observaba el estado anterior porque un clic corto se confirma al
		// SOLTAR, justo después de comprobar el umbral de arrastre.
		/*
		 * Entrada REAL del navegador, pero sin un `mouseMoved` previo. El hover del producto proyecta
		 * todas las rutas y ya se prueba por separado; repetirlo para los 59 cables y tres cámaras
		 * convertía esta regresión en 6–10 minutos. CDP entrega eventos trusted de botón con las mismas
		 * coordenadas, sin añadir un segundo benchmark de pointermove a cada aserción de selección.
		 */
		await cdp.send('Input.dispatchMouseEvent', {
			type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1,
		});
		await cdp.send('Input.dispatchMouseEvent', {
			type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1,
		});
		let sel;
		if (indice + 1 < reales.length) {
			preparado = await preparar(reales[indice + 1].id, true, true);
			sel = preparado.seleccion;
		} else {
			sel = await qa('seleccion');
		}
		total++;
		if (sel?.tipo === 'cable' && sel.id === r.id) ok++;
		else {
			// En el camino verde no se pagan lecturas de diagnóstico. Si falla, se recogen TODAS en
			// una sola visita, para que el mensaje siga siendo igual de accionable.
			const diagnostico = await page.evaluate(([x, y]) => ({
				pixel: window.qa.cableEnPixel(x, y),
				hits: window.qa.diagnosticoPixel(x, y),
				estado: window.qa.estadoInteraccion(),
				encima: document.elementFromPoint(x, y)?.id || document.elementFromPoint(x, y)?.tagName,
			}), [p.x, p.y]);
			mal.push(`${r.id}@(${Math.round(p.x)},${Math.round(p.y)}) → ${sel ? sel.tipo + ':' + sel.id : 'nada'} `
				+ `(pixel=${diagnostico.pixel}) [${diagnostico.hits.join(' ')}] `
				+ `${JSON.stringify(diagnostico.estado)} encima=${diagnostico.encima}`);
		}
	}
	must(`nada tapa el lienzo (${comoSeVe})`, await lienzoLibre());
	must(`toda la muestra tiene un punto comprobable (${comoSeVe})`, total === reales.length,
		`${total}/${reales.length}${sinPunto.length ? `; sin punto: ${sinPunto.slice(0, 6).join(', ')}` : ''}`);
	if (mal.length) info('fallaron: ' + mal.join(' | '));
	must(`el clic real agarra el cable señalado (${comoSeVe})`, ok === total && total > 0, `${ok}/${total}`);
}

/* ============ 3. Coherencia ============ */
console.log('\n--- 3. Coherencia ---');
const finales = await qa('proyecto');
const dibujados = await qa('cablesDibujados');
must('ningún cable fantasma', dibujados === finales.conductores.length, `${dibujados}/${finales.conductores.length}`);
must('sin errores de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ✗ ===`);
await browser.close();
server.close();
process.exit(fallos === 0 ? 0 : 1);
