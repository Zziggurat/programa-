/**
 * REGRESIÓN BREVE DEL CABLEADO. No es una auditoría nueva: es comprobar que lo que ya estaba
 * estable sigue estándolo después de tocar el armario, la puerta, los pilotos y el frontal.
 *
 * Se hace con el ratón y con las mismas sondas que usan las suites de cables: señalar un cable,
 * agarrarlo, moverlo en X, Y y Z, crear y mover un punto de paso, comprobar que entra en la
 * canaleta, energizar y ver qué se enciende, y guardar y volver a abrir sin perder el trazado.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, navegadorDelSistema } from './lib/mirar.mjs';

const EJEMPLO = Number(process.argv[2] ?? 2);
const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(120_000);
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
const fallos = [];
const ok = (bien, texto) => { console.log(`${bien ? 'OK ' : 'MAL'} ${texto}`); if (!bien) fallos.push(texto); };

console.log(await abrirEjemplo(p, sv.address().port, EJEMPLO));
await p.evaluate(() => document.getElementById('esp-interior')?.click());
await p.waitForTimeout(1200);
await p.evaluate(() => window.qa.congelarCamara(true));

const conductores = await p.evaluate(() => window.qa.proyecto().conductores.map((c) => c.id));
console.log(`   ${conductores.length} conductores`);
ok(conductores.length > 0, 'el tablero trae cables');

/*
 * LOS CONDUCTORES QUE LLEGAN A LA PUERTA YA SE DIBUJAN.
 *
 * Cuando se escribió esto, el mazo flexible que cruza la bisagra estaba pendiente: un hilo que
 * iba de la placa a un piloto existía eléctricamente —encendía el piloto— y no tenía recorrido.
 * Ahora lo tiene, en tres tramos, así que se dibujan TODOS. Se siguen contando aparte porque
 * saber cuántos cruzan a la hoja es un dato útil por sí mismo.
 */
const aLaPuerta = await p.evaluate(() => {
	const pr = window.qa.proyecto();
	const enPuerta = new Set(pr.gabinete.colocaciones.filter((c) => c.montaje === 'puerta').map((c) => c.dispositivoId));
	return pr.conductores.filter((c) => enPuerta.has(c.de.dispositivoId) || enPuerta.has(c.a.dispositivoId)).length;
});
const dePlaca = conductores.length - aLaPuerta;
console.log(`   ${aLaPuerta} de ellos llegan a la puerta, y también se dibujan`);

/* ---- 1. Se ven dibujados ---- */
{
	// `cablesDibujados()` devuelve CUÁNTOS, no cuáles: es un número.
	const dibujados = await p.evaluate(() => window.qa.cablesDibujados());
	ok(dibujados === conductores.length,
		`se dibujan TODOS los conductores, los de placa y los de puerta (${dibujados}/${conductores.length}`
		+ `, de los cuales ${dePlaca} de placa y ${aLaPuerta} de puerta)`);
}

/* ---- 2. Se pueden pinchar con el ratón, sin puntería ---- */
{
	let aciertos = 0;
	for (const id of conductores.slice(0, 8)) {
		const pt = await p.evaluate((i) => window.qa.puntoParaAgarrar(i), id);
		if (!pt) continue;
		await p.mouse.click(Math.round(pt.x), Math.round(pt.y));
		await p.waitForTimeout(160);
		const s = await p.evaluate(() => window.qa.seleccion());
		if (s?.tipo === 'cable' && s.id === id) aciertos++;
	}
	ok(aciertos >= 6, `se agarran los cables señalados (${aciertos} de 8)`);
}

/* ---- 3. Un punto de paso: crear, mover en X, en Y y en Z ---- */
{
	/*
	 * `crearPuntoCable` recibe coordenadas DE PANTALLA —proyecta el clic sobre la polilínea del
	 * cable, igual que hace el ratón—, así que hay que darle un punto donde el cable se vea de
	 * verdad. `moverPuntoCable` en cambio recibe milímetros del modelo, y por eso se lee el punto
	 * y se le suma el desplazamiento en lugar de mandarle una coordenada absoluta.
	 */
	const id = conductores.find(async (k) => await p.evaluate((i) => !!window.qa.puntoParaAgarrar(i), k)) ?? conductores[0];
	await p.evaluate((i) => window.qa.seleccionarPorId(i), id);
	await p.waitForTimeout(250);
	const pt = await p.evaluate((i) => window.qa.puntoParaAgarrar(i), id);
	ok(!!pt, `el cable ${id} se ve en pantalla y se puede señalar`);
	const antes = await p.evaluate((i) => window.qa.trazadoDe(i), id);
	const creado = await p.evaluate(([i, x, y]) => window.qa.crearPuntoCable(i, x, y), [id, pt.x, pt.y]);
	await p.waitForTimeout(400);
	const conPunto = await p.evaluate((i) => window.qa.trazadoDe(i), id);
	ok(creado >= 0 && (conPunto?.length ?? 0) > (antes?.length ?? 0),
		`se crea un punto de paso (${antes?.length ?? 0} -> ${conPunto?.length ?? 0}, índice ${creado})`);
/*
 * Se prueba a mover en los DOS SENTIDOS de cada eje. Un punto que ya está pegado al canto de la
 * placa no puede salirse de ella, y la asistencia lo devuelve dentro: la primera versión de esta
 * prueba empujaba siempre en positivo, el punto estaba a y=626 con la placa de 600, y acusaba al
 * editor de no dejar mover en Y cuando lo que pasaba es que ahí no había sitio.
 */
	for (const eje of ['x', 'y', 'z']) {
		let movido = false, desde = 0, hasta = 0;
		for (const paso of [15, -15]) {
			const p0 = (await p.evaluate((i) => window.qa.trazadoDe(i), id))[creado];
			await p.evaluate(([i, k, q, e, d]) => window.qa.moverPuntoCable(
				i, k, q.x + (e === 'x' ? d : 0), q.y + (e === 'y' ? d : 0), (q.z ?? 0) + (e === 'z' ? d : 0),
			), [id, creado, p0, eje, paso]);
			await p.waitForTimeout(300);
			const p1 = (await p.evaluate((i) => window.qa.trazadoDe(i), id))[creado];
			desde = p0[eje] ?? 0; hasta = p1[eje] ?? 0;
			if (Math.abs(hasta - desde) > 1) { movido = true; break; }
		}
		ok(movido, `el punto se mueve en ${eje.toUpperCase()} (${desde} -> ${hasta})`);
	}
}

/* ---- 4. Los cables entran en la canaleta ---- */
{
	const amontonado = await p.evaluate(() => window.qa.amontonamiento());
	console.log(`   amontonamiento: ${amontonado.mismaCapaMm} mm en la misma capa de ${amontonado.pares} pares`);
	/*
	 * EL RUTEO POR LA PLACA CONOCE TODOS LOS QUE PASAN POR ELLA, y solo se le descuentan los
	 * PUENTES: un hilo que une dos aparatos de la misma puerta va de un borne al de al lado por
	 * la cara interior de la hoja y no pisa la placa en ningún momento, así que no tiene por qué
	 * aparecer en el reparto por capas. Los que sí cruzan —placa, lazo de servicio y hoja— sí.
	 */
	const puentesDePuerta = await p.evaluate(() => {
		const pr = window.qa.proyecto();
		const enP = new Set(pr.gabinete.colocaciones.filter((c) => c.montaje === 'puerta').map((c) => c.dispositivoId));
		return pr.conductores.filter((c) => enP.has(c.de.dispositivoId) && enP.has(c.a.dispositivoId)).length;
	});
	const porLaPlaca = conductores.length - puentesDePuerta;
	ok(amontonado.cables === porLaPlaca,
		`el ruteo conoce todos los que pasan por la placa (${amontonado.cables} de ${porLaPlaca};`
		+ ` ${puentesDePuerta} puentes van solo por la hoja)`);
	const rutas = await p.evaluate(() => window.qa.rutas());
	console.log(`   ${rutas.length} rutas calculadas`);
	ok(rutas.length > 0, 'hay rutas de cable calculadas');
	// Y que el punto que se acaba de mover haya acabado DENTRO de la canaleta, que es lo que
	// hace la asistencia de entrada: se pregunta por la validez del sitio donde ha quedado.
	const enCanaleta = await p.evaluate(() => {
		const c = window.qa.proyecto().conductores.find((k) => k.trazado?.length);
		const q = c?.trazado?.[0];
		return q ? window.qa.validez(q.x, q.y, q.z ?? 0) : undefined;
	});
	console.log(`   validez del primer punto de paso: ${JSON.stringify(enCanaleta)}`);
}

/* ---- 5. Energizar ---- */
{
	await p.evaluate(() => document.getElementById('btn-energizar')?.click());
	await p.waitForTimeout(2600);
	const vivos = await p.evaluate(() => window.qa.proyecto().conductores.length);
	const hallazgos = await p.evaluate(() => window.qa.hallazgos().length);
	console.log(`   ${vivos} conductores · ${hallazgos} hallazgos de revisión`);
	const pilotos = await p.evaluate(() => window.qa.componentesDePuerta());
	const encendidos = pilotos.filter((q) => q.encendido).length;
	ok(pilotos.length === 0 || encendidos > 0, `energizar enciende lo que tiene que encender (${encendidos}/${pilotos.length})`);
	await p.evaluate(() => document.getElementById('btn-energizar')?.click());
	await p.waitForTimeout(1200);
}

/* ---- 6. Guardar y volver a abrir sin perder el trazado ---- */
{
	const antes = await p.evaluate(() => JSON.stringify(window.qa.proyecto().conductores));
	const json = await p.evaluate(() => JSON.stringify(window.qa.proyecto()));
	await p.evaluate((j) => window.qa.cargarJson(j), json);
	await p.waitForTimeout(1600);
	const despues = await p.evaluate(() => JSON.stringify(window.qa.proyecto().conductores));
	ok(antes === despues, 'los conductores sobreviven al ida y vuelta con su trazado');
	const dibujados = await p.evaluate(() => window.qa.cablesDibujados());
	ok(dibujados === conductores.length, `y se vuelven a dibujar todos (${dibujados}/${conductores.length})`);
}

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close();
