/**
 * QUE LO LOCAL SIGA SIENDO LOCAL.
 *
 * No se busca optimizar nada: se busca comprobar que las funciones nuevas no han metido una
 * reconstrucción donde no la había. Y no se mide en milisegundos —un ordenador rápido reconstruye
 * el armario entero sin que se note—: se mira la IDENTIDAD de los objetos de la escena. Si el
 * grupo del armario sigue siendo el mismo objeto después de mover un piloto, nadie lo ha vuelto a
 * montar. Si cambia, se ha rehecho aunque se vea igual.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, navegadorDelSistema } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(90_000);
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
const fallos = [];
const ok = (bien, texto) => { console.log(`${bien ? 'OK ' : 'MAL'} ${texto}`); if (!bien) fallos.push(texto); };

console.log(await abrirEjemplo(p, sv.address().port, 2));
await p.evaluate(() => document.getElementById('esp-frontal')?.click());
await p.waitForTimeout(1400);
async function camaraQuieta() {
	let antes = '';
	for (let i = 0; i < 60; i++) {
		const ahora = JSON.stringify(await p.evaluate(() => window.qa.camaraAhora()));
		if (ahora === antes) return;
		antes = ahora; await p.waitForTimeout(120);
	}
}
await camaraQuieta();

const ident = () => p.evaluate(() => window.qa.identidades());
const piezas = () => p.evaluate(() => window.qa.piezasDelFrontal());
const punto = (c, i) => p.evaluate(([a, k]) => window.qa.puntoEnPantallaDeFrontal(a, k), [c, i]);
const contadores = async () => (await p.evaluate(() => window.qa.cronometroLeer())).contadores;

/** Corre una acción y dice qué se ha reconstruido y cuánto cable se ha rehecho. */
async function coste(nombre, accion) {
	const antes = await ident();
	await p.evaluate(() => window.qa.cronometro(true));
	await accion();
	const c = await contadores();
	await p.evaluate(() => window.qa.cronometro(false));
	const despues = await ident();
	const cambiados = Object.keys(antes).filter((k) => k !== 'frontal' && k !== 'mallasEnEscena'
		&& antes[k] !== despues[k]);
	const frontalCambiado = despues.frontal.filter((f) => !antes.frontal.includes(f)).map((f) => f.split('=')[0]);
	console.log(`   ${nombre}: rehecho ${cambiados.length ? cambiados.join(',') : 'nada'}`
		+ ` · frontal rehecho ${frontalCambiado.length ? frontalCambiado.join(',') : 'nada'}`
		+ ` · repartos ${c.repartos} cables ${c.cablesConstruidos} tubos ${c.tubos}`
		+ ` · mallas ${antes.mallasEnEscena} -> ${despues.mallasEnEscena}`);
	return { cambiados, frontalCambiado, c, antes, despues };
}

const lista = await piezas();
const ap = lista.filter((q) => q.clase === 'aparato');

/* ---- 1. Mover un piloto arrastrándolo ---- */
{
	const pt = await punto('aparato', ap[0].id);
	const r = await coste('arrastrar un piloto', async () => {
		await p.mouse.move(Math.round(pt.x), Math.round(pt.y));
		await p.mouse.down();
		for (let i = 1; i <= 12; i++) { await p.mouse.move(Math.round(pt.x + i * 6), Math.round(pt.y + i * 2)); await p.waitForTimeout(18); }
		await p.mouse.up();
		await p.waitForTimeout(300);
	});
	ok(!r.cambiados.includes('envolvente'), 'mover un piloto NO reconstruye el armario');
	ok(!r.cambiados.includes('puerta'), 'ni la puerta');
	ok(r.frontalCambiado.length === 0, 'ni ninguna pieza del frontal: solo se recoloca');
	ok(r.c.cablesConstruidos === 0 && r.c.tubos === 0, 'ni se rehace un solo cable');
}

/* ---- 2. Pasar el ratón por encima (hover) ---- */
{
	const pt = await punto('aparato', ap[1].id);
	const r = await coste('cien movimientos de ratón', async () => {
		for (let i = 0; i < 100; i++) await p.mouse.move(Math.round(pt.x + (i % 20) - 10), Math.round(pt.y + (i % 7)));
		await p.waitForTimeout(200);
	});
	ok(r.cambiados.length === 0 && r.frontalCambiado.length === 0, 'pasar el ratón no reconstruye nada');
	ok(r.c.repartos === 0 && r.c.cablesConstruidos === 0, 'ni recalcula el ruteo');
}

/* ---- 3. Cambiar el color de un piloto ---- */
{
	const pt = await punto('aparato', ap[0].id);
	await p.mouse.click(Math.round(pt.x), Math.round(pt.y));
	await p.waitForTimeout(300);
	const campo = await p.evaluate(() => {
		for (const s of document.querySelectorAll('#panel-der select')) {
			if ([...s.options].some((o) => o.value === 'rojo')) return s.id;
		}
		return null;
	});
	const r = await coste('cambiar el color de la lente', async () => {
		await p.selectOption(`#${campo}`, 'azul');
		await p.waitForTimeout(500);
	});
	ok(!r.cambiados.includes('envolvente') && !r.cambiados.includes('puerta'), 'cambiar el color no reconstruye el armario ni la puerta');
	ok(r.frontalCambiado.length === 1 && r.frontalCambiado[0] === `aparato:${ap[0].id}`,
		`solo se rehace ESA pieza (${r.frontalCambiado.join(',') || 'ninguna'})`);
	ok(r.c.cablesConstruidos === 0 && r.c.tubos === 0, 'y ni un cable');
}

/* ---- 4. Encender y apagar ---- */
{
	const r = await coste('energizar', async () => {
		await p.evaluate(() => document.getElementById('btn-energizar')?.click());
		await p.waitForTimeout(2400);
	});
	ok(r.frontalCambiado.length === 0, 'encender no crea geometría: solo cambia materiales');
	ok(r.antes.mallasEnEscena === r.despues.mallasEnEscena, `ni una malla más (${r.antes.mallasEnEscena} -> ${r.despues.mallasEnEscena})`);
	await p.evaluate(() => document.getElementById('btn-energizar')?.click());
	await p.waitForTimeout(1200);
}

/* ---- 5. Abrir y cerrar la puerta ---- */
{
	const r = await coste('abrir y cerrar la puerta', async () => {
		await p.evaluate(() => document.getElementById('btn-puerta')?.click());
		await p.waitForTimeout(900);
		await p.evaluate(() => document.getElementById('btn-puerta')?.click());
		await p.waitForTimeout(900);
	});
	ok(r.cambiados.length === 0 && r.frontalCambiado.length === 0, 'abrir la puerta no reconstruye ningún componente');
	ok(r.c.cablesConstruidos === 0, 'ni rehace cables');
}

/* ---- 6. Cambiar de espacio de trabajo ---- */
{
	const r = await coste('frontal -> interior -> conjunto -> frontal', async () => {
		for (const id of ['esp-interior', 'esp-conjunto', 'esp-frontal']) {
			await p.evaluate((i) => document.getElementById(i)?.click(), id);
			await p.waitForTimeout(800);
		}
		await camaraQuieta();
	});
	ok(r.cambiados.length === 0, 'cambiar de espacio no reconstruye la escena');
	ok(r.frontalCambiado.length === 0, 'ni las piezas del frontal');
	ok(r.c.cablesConstruidos === 0 && r.c.repartos === 0, 'ni el ruteo de cables');
}

/* ---- 7. Mover VARIOS elementos a la vez ---- */
{
	await p.evaluate((k) => window.qa.marcarEnFrontal(k), lista.slice(0, 5).map((q) => [q.clase, q.id]));
	await p.waitForTimeout(300);
	const pt = await punto(lista[0].clase, lista[0].id);
	const r = await coste('arrastrar cinco piezas juntas', async () => {
		await p.mouse.move(Math.round(pt.x), Math.round(pt.y));
		await p.mouse.down();
		for (let i = 1; i <= 12; i++) { await p.mouse.move(Math.round(pt.x - i * 4), Math.round(pt.y + i * 3)); await p.waitForTimeout(18); }
		await p.mouse.up();
		await p.waitForTimeout(300);
	});
	ok(r.frontalCambiado.length === 0, 'mover cinco piezas tampoco reconstruye ninguna');
	ok(r.cambiados.length === 0, 'ni el armario');
}

/* ---- 8. Y el dibujado, por si acaso ---- */
{
	/*
	 * LA MEDIANA SE MIDE AQUÍ; EL PEOR FOTOGRAMA, NO. Y conviene decir por qué.
	 *
	 * Esta prueba encadena siete acciones instrumentadas —cada una con su cronómetro, su lectura
	 * de identidades y su recuento de mallas— y al final mide el dibujado. En ese punto el peor
	 * fotograma sale del orden del segundo, y se persiguió a fondo: se repitió la MISMA secuencia
	 * de acciones en `qa/_v-tiron2.mjs` midiendo después de cada paso —arrastrar un piloto,
	 * cambiar un color, energizar y desenergizar, abrir y cerrar la puerta, marcar cinco piezas,
	 * arrastrarlas juntas, cien movimientos de ratón, pasear por los tres espacios y hasta con el
	 * cronómetro de la sonda encendido— y el peor fotograma NUNCA pasó de 50 ms, con la mediana
	 * entre 22 y 31. También se probó apagando sombras (la mediana cae a la mitad: ahí está el
	 * grueso del coste), quitando la serigrafía, vaciando la puerta y escondiendo el armario.
	 *
	 * O sea: ningún estado al que llega el programa produce ese pico.
	 *
	 * YA SE SABE DE DÓNDE SALE, y se puede reproducir a voluntad: `qa/_v-perfil.mjs` lo mide a
	 * solas, abre una SEGUNDA escena de Three dibujando a la vez y lo vuelve a medir. Este
	 * contenedor dibuja por software y todas las pestañas comparten un único proceso de GPU: con
	 * vecino, el peor fotograma pasó de 30 ms a 7.253 ms, y al cerrar el vecino volvió a 24 ms.
	 * El pico es de contención en el banco de pruebas —dos suites de QA corriendo a la vez, que
	 * es como se corren— y no de nada que haga el programa. Medido dentro de una sola tarea de
	 * JavaScript, dibujar el tablero cuesta entre 15 y 20 ms de principio a fin de la sesión.
	 *
	 * Por eso aquí se afirma lo que esta medida SÍ sostiene —la mediana— y el peor caso se
	 * imprime como dato. Quien quiera vigilarlo tiene `_v-tiron2.mjs` y `_v-perfil.mjs`.
	 */
	const tandas = [];
	for (let i = 0; i < 3; i++) {
		if (i) await p.waitForTimeout(700);
		tandas.push(await p.evaluate(() => window.qa.medirDibujado(30)));
	}
	for (let i = 0; i < 3; i++) console.log(`   dibujado, tanda ${i + 1}: mediana ${tandas[i].mediana} ms · peor ${tandas[i].peor} ms`);
	console.log('   (el peor caso no es comparable: es contención del banco, demostrada en _v-perfil.mjs)');
	for (let i = 0; i < 3; i++) {
		ok(tandas[i].mediana < 60, `tanda ${i + 1}: mediana de dibujado razonable (${tandas[i].mediana} ms en SwiftShader por software)`);
	}
}

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
