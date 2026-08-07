/**
 * QA de la segunda herramienta: el visor 3D de la planta.
 *
 * Comprueba lo que se le pidió: que sea una herramienta SEPARADA del editor de tableros, que la
 * planta salga del plano de verdad (los equipos y sus metros de instalación), que se puedan ver
 * los puntos de control de cada máquina, que las dos vistas funcionen, y que el visor NO deje de
 * avisar de que las alturas son de proyecto y no del plano.
 *
 *   node qa/planta.mjs
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
const texto = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() ?? '', sel);

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await click('btn-cerrar-ayuda'); await page.waitForTimeout(200);

console.log('--- 1. Es una herramienta aparte ---');
must('el botón de la planta está en la barra', await page.isVisible('#btn-planta'));
must('el visor está cerrado al arrancar', !(await page.isVisible('#mundo')));
/** La guía del visor se abre sola la primera vez: se cierra, como haría cualquiera al entrar. */
async function cerrarGuiaDelMundo() {
	if (await page.isVisible('#modal-guia-mundo')) {
		await page.evaluate(() => document.getElementById('btn-cerrar-guia-mundo')?.click());
		await page.waitForTimeout(300);
	}
}

await click('btn-planta');
await page.waitForTimeout(3500);   // construir la escena lleva su tiempo
await cerrarGuiaDelMundo();
must('el visor se abre a pantalla completa', await page.isVisible('#mundo'));
must('tapa el editor de tableros', await page.evaluate(() => {
	const m = document.getElementById('mundo').getBoundingClientRect();
	return m.width >= window.innerWidth - 2 && m.height >= window.innerHeight - 2;
}));
must('dibuja la planta en 3D', await page.evaluate(() => {
	const c = document.getElementById('mundo-lienzo');
	return !!c && c.clientWidth > 800 && c.clientHeight > 500;
}));

console.log('\n--- 2. Los datos son los del plano ---');
const res = await texto('#mundo-resumen');
must('el resumen cuenta las UMAs', /9[0-9]/.test(res), res.replace(/\s+/g, ' ').slice(0, 90));
must('el título dice de qué archivo sale', (await texto('#mundo-titulo')).includes('.dxf')
	|| (await texto('#mundo-titulo')).includes('.dwg'), await texto('#mundo-titulo'));
const ley = await texto('#mundo-leyenda');
for (const s of ['Inyección', 'Extracción', 'Bus LON']) {
	must(`la leyenda incluye «${s}»`, ley.includes(s));
}
must('la leyenda da metros de cada sistema', /\d+\s*m/.test(ley), ley.replace(/\s+/g, ' ').slice(0, 80));

/*
 * LA CUBIERTA, no solo las máquinas. El plano trae debajo de las capas de clima la obra entera
 * —petos, barandas, muros, lucernarios, escaleras y pilares— y sin ella el visor enseñaba tubos
 * flotando sobre una losa lisa. Se comprueba que está montada y que sale de datos, no de adorno.
 */
console.log('\n--- 2b. La obra de la cubierta ---');
const montado = await page.evaluate(() => window.__plantaQA.montado());
must('la obra está montada en la escena', montado.obra >= 5, `${montado.obra} mallas`);
must('con tramos de verdad, no cuatro palos', montado.tramosObra > 1000, `${montado.tramosObra} tramos`);
const obraTexto = await texto('#mundo-leyenda-obra');
for (const que of ['Bordes y petos', 'Barandas', 'Muros', 'Pilares']) {
	must(`la leyenda nombra «${que}»`, obraTexto.includes(que));
}
must('los pilares salen del plano con su cuenta', /Pilares de estructura · \d+/.test(obraTexto),
	obraTexto.split('\n').pop());
// Una malla por familia y no una por tramo: con 1.800 tramos sueltos el paseo iría a tirones.
must('cada familia va en UNA malla (el paseo tiene que ir fluido)', montado.obra <= 8, `${montado.obra} mallas`);

console.log('\n--- 3. NO deja de avisar de lo que es supuesto ---');
const aviso = await texto('#mundo-aviso');
must('avisa de que las alturas son de proyecto', /altura|cota/i.test(aviso), aviso.slice(0, 70));
must('y de que el recorrido en planta sí es del plano', /planta/i.test(aviso));

console.log('\n--- 4. Se puede consultar una máquina ---');
const conPuntos = await page.evaluate(() => {
	const q = window.__plantaQA;
	return q ? q.equipos.filter((e) => e.x !== null && e.puntos.length > 0).length : -1;
});
must('hay máquinas situadas con puntos de control', conPuntos > 5, `${conPuntos}`);
// Se exige sobre LOS PUNTOS DE LA MÁQUINA QUE SE ABRE, no sobre unas siglas escritas a mano.
// Estaban puestas VAF, VAC y EF, que eran las de la máquina que salía primera en la lista; al
// modelar la terminal entera se sitúan 107 máquinas en vez de 43, la primera pasó a ser otra y
// la prueba se caía sin que nada estuviera roto. Lo que hay que exigir es que la ficha nombre
// cada punto de esa máquina y explique qué es cada sigla.
const ficha = await page.evaluate(() => {
	const q = window.__plantaQA;
	const e = q.equipos.find((x) => x.x !== null && x.puntos.length >= 6);
	q.seleccionar(e.tag);
	return { tag: e.tag, puntos: e.puntos.map((p) => ({ sigla: p.sigla, que: p.que })), ctrl: e.controlador };
});
await page.waitForTimeout(400);
const html = await texto('#mundo-ficha');
must(`la ficha muestra ${ficha.tag}`, html.includes(ficha.tag), html.replace(/\s+/g, ' ').slice(0, 80));
must('la ficha lista sus puntos de control', /Puntos de control/.test(html));
const sinNombrar = ficha.puntos.filter((p) => !html.includes(p.sigla));
must('la ficha nombra TODOS los puntos de esa máquina', sinNombrar.length === 0,
	`${ficha.puntos.length} puntos${sinNombrar.length ? ' · faltan: ' + sinNombrar.map((p) => p.sigla).join(',') : ''}`);
const sinExplicar = ficha.puntos.filter((p) => !html.includes(p.que));
must('explica qué es cada sigla, no solo la sigla', sinExplicar.length === 0,
	sinExplicar.length ? 'sin explicar: ' + sinExplicar.map((p) => p.sigla).join(',')
		: ficha.puntos.slice(0, 3).map((p) => `${p.sigla}=${p.que}`).join(' · '));
await page.screenshot({ path: join(SAL, 'planta-sims.png') });

console.log('\n--- 5. Las dos vistas ---');
must('arranca en vista general', await page.evaluate(
	() => document.getElementById('mundo-sims').classList.contains('activo')));
must('la ayuda de paseo está oculta en vista general', !(await page.isVisible('#mundo-ayuda-paseo')));
const camSims = await page.evaluate(() => window.__plantaQA.camara());
await click('mundo-paseo'); await page.waitForTimeout(700);
must('al pasear cambia el botón activo', await page.evaluate(
	() => document.getElementById('mundo-paseo').classList.contains('activo')));
must('aparece la ayuda de teclas', await page.isVisible('#mundo-ayuda-paseo'));
const camPaseo = await page.evaluate(() => window.__plantaQA.camara());
must('la cámara baja a la altura de los ojos', Math.abs(camPaseo.y - 1.7) < 0.2, `y=${camPaseo.y.toFixed(2)} m`);
must('y cambia de sitio respecto a la vista general',
	Math.abs(camPaseo.y - camSims.y) > 5, `${camSims.y.toFixed(1)} → ${camPaseo.y.toFixed(1)}`);

// Andar. Se mide en DOS pasos y por un motivo: este contenedor renderiza por software y da 2-3
// fps, así que medir el paseo en tiempo real mediría la gráfica del servidor y no el programa.
// Primero se comprueba que la tecla llega y mueve algo; luego, que el movimiento es el que toca,
// con un reloj simulado.
const fps = await page.evaluate(() => window.__plantaQA.fps());
console.log(`     (fps reales del contenedor: ${fps})`);
await page.mouse.move(800, 500);
await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
await page.waitForTimeout(150);
const trasTecla = await page.evaluate(() => window.__plantaQA.camara());
const conTecla = Math.hypot(trasTecla.x - camPaseo.x, trasTecla.z - camPaseo.z);
must('la tecla W llega al visor y mueve la cámara', conTecla > 0.3, `${conTecla.toFixed(2)} m`);

const paso = await page.evaluate(() => {
	// Se mantiene W pulsada y se anda un segundo de reloj simulado.
	window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
	const r = window.__plantaQA.andar(1);
	window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
	return r;
});
must('en un segundo se recorren metros de verdad', paso.avanzado > 8 && paso.avanzado < 25,
	`${paso.avanzado.toFixed(1)} m/s`);
must('y sin despegarse del suelo', Math.abs(paso.y - 1.7) < 0.05, `y=${paso.y.toFixed(2)} m`);
must('sin salirse de la losa', await page.evaluate(() => {
	const q = window.__plantaQA; const c = q.camara(); const t = q.tamano();
	return Math.abs(c.x) <= t.ancho / 2 + 10 && Math.abs(c.z) <= t.fondo / 2 + 10;
}));
await page.screenshot({ path: join(SAL, 'planta-paseo.png') });

/*
 * EL SENTIDO DEL RATÓN. Estaba invertido en vertical porque se negaba el vector de dirección
 * entero, y con él la altura. Se comprueba con números, no a ojo: arrastrar hacia arriba tiene
 * que SUBIR la mirada, y arrastrar a la derecha tiene que girarla a la derecha.
 *
 * «A la derecha», mirando hacia una dirección cualquiera, se decide con el producto vectorial:
 * el componente Y de (antes × después) es negativo cuando el giro es horario visto desde arriba,
 * que es lo que tiene que pasar al llevar el ratón a la derecha.
 */
console.log('\n--- 6. El ratón mira hacia donde se arrastra ---');
const mirar = (dx, dy) => page.evaluate(([x, y]) => window.__plantaQA.mirar(x, y), [dx, dy]);
const invertir = (v) => page.evaluate((x) => window.__plantaQA.invertirRaton(x), v);
const giroY = (a, b) => a.z * b.x - a.x * b.z;

await invertir(false);
const centro = await mirar(0, 0);
const arriba = await mirar(0, -120);             // el ratón sube: clientY disminuye
must('arrastrar hacia arriba sube la mirada', arriba.y > centro.y + 0.05,
	`y ${centro.y.toFixed(3)} → ${arriba.y.toFixed(3)}`);
const abajo = await mirar(0, 240);
must('y arrastrar hacia abajo la baja', abajo.y < arriba.y - 0.05,
	`y ${arriba.y.toFixed(3)} → ${abajo.y.toFixed(3)}`);
const antes = await mirar(0, -120);              // volver a la horizontal
const derecha = await mirar(150, 0);
must('arrastrar a la derecha gira la vista a la derecha', giroY(antes, derecha) < -0.01,
	`giro ${giroY(antes, derecha).toFixed(3)}`);
const izquierda = await mirar(-300, 0);
must('y a la izquierda, a la izquierda', giroY(derecha, izquierda) > 0.01,
	`giro ${giroY(derecha, izquierda).toFixed(3)}`);
await mirar(150, 0);

// Quien lo prefiera al revés lo tiene a un clic, y el programa se acuerda.
must('hay un interruptor de ratón invertido', await page.isVisible('#mundo-invertir'));
await invertir(true);
const base2 = await mirar(0, 0);
const invArriba = await mirar(0, -120);
must('con el ratón invertido, arrastrar arriba baja la mirada', invArriba.y < base2.y - 0.05,
	`y ${base2.y.toFixed(3)} → ${invArriba.y.toFixed(3)}`);
must('la preferencia queda guardada', await page.evaluate(
	() => localStorage.getItem('tablero-studio:raton-invertido') === '1'));
await invertir(false); await mirar(0, 120);

console.log('\n--- 7. El botón de la casa lleva al inicio ---');
must('el visor tiene botón de inicio', await page.isVisible('#mundo-inicio'));
await click('mundo-inicio'); await page.waitForTimeout(500);
must('cierra el visor', !(await page.isVisible('#mundo')));
must('y deja a la vista la ventana de inicio', await page.isVisible('#inicio'));
await click('inicio-terreno'); await page.waitForTimeout(2000); await cerrarGuiaDelMundo();
must('desde el inicio se vuelve a terreno', await page.isVisible('#mundo'));
must('y la ventana de inicio se quita de en medio', !(await page.isVisible('#inicio')));

console.log('\n--- 8. Salir y volver al editor ---');
await click('mundo-salir'); await page.waitForTimeout(500);
must('el visor se cierra', !(await page.isVisible('#mundo')));
must('el editor de tableros sigue ahí', await page.isVisible('#escena'));
must('y su catálogo también', await page.evaluate(
	() => document.querySelectorAll('#catalogo .item-catalogo').length > 20));
await click('btn-planta'); await page.waitForTimeout(1200); await cerrarGuiaDelMundo();
must('se puede volver a abrir', await page.isVisible('#mundo'));

/*
 * Reportado a mano: «al pasear, si aprietas el botón derecho para mover la cámara se abre el menú
 * de guardar imagen, y al quitarlo sigues caminando sin poder parar». Eran dos cosas: nada evitaba
 * el menú del navegador, y con el menú delante el `keyup` de la W se lo comía él, así que la tecla
 * se quedaba apretada para siempre.
 */
console.log('\n--- 8b. Pasear: el botón derecho mira, y se puede parar ---');
await click('mundo-paseo'); await page.waitForTimeout(900);
must('se entra al paseo', (await page.evaluate(() => window.__plantaQA.vista())) === 'paseo');

// Sobre el 3D y sobre los paneles del HUD: el primer arreglo solo cubría el lienzo y el fallo
// seguía saliendo al pinchar con el derecho encima del buscador o de la lista de máquinas.
for (const [donde, sel] of [['sobre la cubierta', '#mundo-lienzo'], ['sobre el panel del HUD', '#mundo-buscador'], ['sobre la lista de máquinas', '#mundo-panel']]) {
	const evitado = await page.evaluate((s) => {
		const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
		document.querySelector(s).dispatchEvent(ev);
		return ev.defaultPrevented;
	}, sel);
	must(`el botón derecho NO abre el menú del navegador (${donde})`, evitado);
}

// Y aunque el foco se pierda de una forma que no conozcamos, una tecla no puede quedarse colgada:
// el sistema repite el keydown mientras está apretada, así que la que deja de repetirse se suelta.
await page.keyboard.down('KeyW');
await page.waitForTimeout(200);
must('con la W apretada de verdad, anda', await page.evaluate(() => window.__plantaQA.andando()));
await page.evaluate(() => {
	const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
	document.querySelector('#mundo-buscador').dispatchEvent(ev);
});
await page.waitForTimeout(300);
must('el menú del HUD deja de hacerte caminar', !(await page.evaluate(() => window.__plantaQA.andando())));
await page.keyboard.up('KeyW');

console.log('\n--- 8c. Los paneles se pliegan y se despliegan ---');
must('el botón de paneles existe', await page.isVisible('#mundo-paneles'));
must('empiezan a la vista', await page.isVisible('#mundo-buscador'));
await click('mundo-paneles'); await page.waitForTimeout(400);
must('el botón los esconde', await page.evaluate(
	() => document.getElementById('mundo').classList.contains('sin-paneles')));
await page.keyboard.press('h'); await page.waitForTimeout(400);
must('y la tecla H los vuelve a sacar', await page.evaluate(
	() => !document.getElementById('mundo').classList.contains('sin-paneles')));

// Se aprieta la W y se comprueba que anda; luego se le roba el foco, como hacía el menú.
await page.mouse.move(640, 400);
await page.keyboard.down('KeyW');
await page.waitForTimeout(250);
must('con la W apretada, anda', await page.evaluate(() => window.__plantaQA.andando()));
const antesDeRobar = await page.evaluate(() => window.__plantaQA.camara());
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(400);
must('al perder el foco deja de andar', !(await page.evaluate(() => window.__plantaQA.andando())));
const despuesDeRobar = await page.evaluate(() => window.__plantaQA.camara());
await page.waitForTimeout(500);
const masTarde = await page.evaluate(() => window.__plantaQA.camara());
const quieto = Math.hypot(masTarde.x - despuesDeRobar.x, masTarde.z - despuesDeRobar.z) < 0.05;
must('y se queda QUIETO, no sigue caminando solo', quieto,
	`${antesDeRobar.x.toFixed(1)} → ${despuesDeRobar.x.toFixed(1)} → ${masTarde.x.toFixed(1)}`);
await page.keyboard.up('KeyW');
await click('mundo-sims'); await page.waitForTimeout(400);

/*
 * Lo que se reportó a mano probándolo: las teclas se trababan, no se podían quitar puntos sueltos
 * de la cinta y no había forma de saber para qué sirve esta vista.
 */
console.log('\n--- 8d. Las teclas no se traban al mantenerlas ---');
await click('mundo-paseo'); await page.waitForTimeout(800);
await page.mouse.move(640, 400);
await page.keyboard.down('KeyW');
// Más de lo que tarda el sistema en empezar a REPETIR la tecla: ahí es donde se trababa, porque
// la red que soltaba «teclas colgadas» a los 500 ms se comía una tecla que seguía apretada.
await page.waitForTimeout(1500);
must('con la W apretada 1,5 s sigue andando', await page.evaluate(() => window.__plantaQA.andando()));
const p1 = await page.evaluate(() => window.__plantaQA.camara());
await page.waitForTimeout(700);
const p2 = await page.evaluate(() => window.__plantaQA.camara());
must('y de verdad avanza, no se queda clavado', Math.hypot(p2.x - p1.x, p2.z - p1.z) > 0.5,
	`${Math.hypot(p2.x - p1.x, p2.z - p1.z).toFixed(1)} m en 0,7 s`);
await page.keyboard.up('KeyW');
await page.waitForTimeout(300);
must('al soltarla, para', !(await page.evaluate(() => window.__plantaQA.andando())));

// Escribiendo en el buscador no se anda: la W es una letra, no un paso.
await page.click('#mundo-q');
await page.keyboard.type('uma');
await page.waitForTimeout(200);
must('escribiendo en el buscador NO se camina', !(await page.evaluate(() => window.__plantaQA.andando())));
await page.evaluate(() => { const c = document.getElementById('mundo-q'); c.value = ''; c.blur(); });
await click('mundo-sims'); await page.waitForTimeout(500);

console.log('\n--- 8e. La cinta deja quitar un punto cualquiera ---');
await click('mundo-medir'); await page.waitForTimeout(400);
for (const [x, y] of [[620, 420], [700, 450], [780, 430]]) {
	await page.mouse.click(x, y); await page.waitForTimeout(250);
}
const conTres = await page.evaluate(() => document.querySelectorAll('#mundo-cinta [data-punto]').length);
must('se marcan tres puntos y se listan', conTres === 3, `${conTres}`);
await page.evaluate(() => document.querySelector('#mundo-cinta [data-punto="0"]').click());
await page.waitForTimeout(350);
const conDos = await page.evaluate(() => document.querySelectorAll('#mundo-cinta [data-punto]').length);
must('el aspa quita ESE punto, no el último', conDos === 2, `${conDos}`);
await click('mundo-medir'); await page.waitForTimeout(300);

console.log('\n--- 8f. La guía explica para qué sirve la cubierta ---');
must('hay botón de guía', await page.isVisible('#mundo-guia'));
await click('mundo-guia'); await page.waitForTimeout(400);
must('la guía se abre', await page.isVisible('#modal-guia-mundo'));
const guia = await page.evaluate(() => document.getElementById('texto-guia-mundo').textContent);
for (const tema of ['Cómo va la obra', 'Parte de obra', 'Llevar al tablero', 'Medir', 'alturas son de proyecto']) {
	must(`la guía explica «${tema}»`, guia.includes(tema));
}
await click('btn-cerrar-guia-mundo'); await page.waitForTimeout(300);
must('y se cierra', !(await page.isVisible('#modal-guia-mundo')));

console.log('\n--- 9. Sin errores ---');
must('ningún error de JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

await browser.close(); server.close();
console.log(`\n=== ${fallos === 0 ? 'TODO OK ✔' : fallos + ' FALLO(S) ✗'} ===`);
process.exit(fallos === 0 ? 0 : 1);
