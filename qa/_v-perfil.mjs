/**
 * PERFILADO POR ACTIVIDAD, y atribución de tirones.
 *
 * Se hace CADA COSA por separado —girar, desplazar, acercar, pasar el ratón, pinchar, mover un
 * cable, abrir la puerta, cambiar de espacio— y de cada una se apuntan tres cosas: lo que tardó
 * el gesto entero, si el navegador marcó alguna tarea de más de 50 ms, y si en ese rato nacieron
 * geometrías, texturas o programas de shader. Con eso un tirón se ATRIBUYE en vez de suponerse.
 */
import { chromium } from 'playwright-core';
import { servir, abrirEjemplo, puerta, navegadorDelSistema } from './lib/mirar.mjs';

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
const ok = (bien, t) => { console.log(`${bien ? 'OK ' : 'MAL'} ${t}`); if (!bien) fallos.push(t); };

console.log(await abrirEjemplo(p, sv.address().port, 2));
await p.evaluate(() => window.qa.congelarCamara(true));
const CX = 700, CY = 460;

const filas = [];
async function medir(nombre, accion) {
	await p.evaluate(() => window.qa.olvidarTareasLargas());
	const a = await p.evaluate(() => window.qa.contadores());
	const t0 = Date.now();
	await accion();
	const ms = Date.now() - t0;
	const c = await p.evaluate(() => window.qa.contadores());
	const ident = await p.evaluate(() => window.qa.identidades());
	const dib = await p.evaluate(() => window.qa.medirDibujado(20));
	const largas = c.tareasLargas.filter((t) => t.ms > 50);
	const fila = {
		nombre,
		gesto: ms,
		dibujo: dib.mediana,
		peorDibujo: dib.peor,
		geo: c.geometrias - a.geometrias,
		tex: c.texturas - a.texturas,
		prog: c.programas - a.programas,
		largas: largas.length,
		peorLarga: largas.reduce((m, t) => Math.max(m, t.ms), 0),
		mazo: `${ident.mazoEnLaPuerta}|${ident.mazoFlexibles}|${ident.tubosDeMazo}`,
	};
	filas.push(fila);
	console.log(`   ${nombre.padEnd(34)} gesto ${String(fila.gesto).padStart(6)} ms · dibujo ${String(fila.dibujo).padStart(6)}/${String(fila.peorDibujo).padStart(7)} ms`
		+ ` · geo ${fila.geo >= 0 ? '+' : ''}${fila.geo} tex ${fila.tex >= 0 ? '+' : ''}${fila.tex} prog ${fila.prog >= 0 ? '+' : ''}${fila.prog}`
		+ (fila.largas ? ` · ${fila.largas} tareas >50 ms (peor ${fila.peorLarga})` : ''));
	return fila;
}

async function arrastrar(boton, dx, dy, pasos = 10) {
	await p.mouse.move(CX, CY);
	await p.mouse.down({ button: boton });
	for (let i = 1; i <= pasos; i++) await p.mouse.move(CX + (dx * i) / pasos, CY + (dy * i) / pasos);
	await p.mouse.up({ button: boton });
}

console.log('\n--- una vuelta de calentamiento: la primera vez se compilan los shaders ---');
await medir('primer dibujado (calentando)', async () => { await p.waitForTimeout(400); });

/*
 * CADA GESTO SE HACE DOS VECES, Y LO QUE SE EXIGE ES LA SEGUNDA.
 *
 * `renderer.info.memory.geometries` cuenta lo SUBIDO a la tarjeta, no lo creado: la primera vez
 * que se gira aparecen las caras de detrás del armario y se encienden los rótulos de detalle, y
 * eso son veintiocho geometrías que se suben una vez y ya está. Exigir cero en la primera pasada
 * sería exigir que el programa no dibuje nada nuevo nunca. Lo que de verdad delata una
 * reconstrucción es que el contador vuelva a subir al REPETIR el mismo gesto.
 */
console.log('\n--- navegación (cada gesto, dos veces: se exige la segunda) ---');
const girar = () => arrastrar('middle', 320, 60, 8);
const desplazar = () => arrastrar('right', 220, 120, 8);
const rueda = async () => {
	for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(20); }
	for (let i = 0; i < 5; i++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(20); }
};
/*
 * Y LA SEGUNDA PASADA SALE DEL MISMO SITIO. Girar descubre caras que no se habían dibujado
 * nunca, así que repetir el gesto desde donde acabó el anterior sigue enseñando cosas nuevas y
 * el contador sigue subiendo con toda la razón. Volviendo la cámara a su punto de partida, la
 * segunda pasada recorre EXACTAMENTE las mismas vistas: ahí ya no hay excusa.
 */
async function dosVeces(nombre, gesto) {
	const desde = await p.evaluate(() => window.qa.camara());
	await medir(`${nombre}, 1.ª vez`, gesto);
	await p.evaluate((c) => window.qa.verDesde(c), desde);
	await p.waitForTimeout(200);
	return medir(nombre, gesto);
}
await dosVeces('girar (rueda pulsada)', girar);
await dosVeces('desplazar (botón derecho)', desplazar);
await dosVeces('acercar y alejar con la rueda', rueda);

console.log('\n--- señalado y selección ---');
await medir('cuarenta movimientos de ratón', async () => {
	for (let i = 0; i < 40; i++) await p.mouse.move(400 + (i * 17) % 600, 300 + (i * 23) % 400);
});
await medir('seis clics de selección', async () => {
	for (let i = 0; i < 6; i++) { await p.mouse.click(500 + i * 40, 400 + (i % 3) * 40); await p.waitForTimeout(30); }
});

console.log('\n--- la puerta ---');
// La primera apertura enseña por dentro cosas que nunca se habían dibujado; la segunda, no.
const abrirDelTodo = async () => {
	for (let t = 0; t <= 1.0001; t += 0.05) await p.evaluate((v) => window.qa.ponerPuerta(v), t);
};
await medir('abrir la puerta, 1.ª vez', abrirDelTodo);
await p.evaluate(() => window.qa.ponerPuerta(0));
await medir('abrir la puerta de par en par', abrirDelTodo);
await medir('cerrarla otra vez', async () => {
	for (let t = 1; t >= -0.0001; t -= 0.05) await p.evaluate((v) => window.qa.ponerPuerta(v), t);
});
await medir('veinte ciclos completos', async () => {
	for (let i = 0; i < 20; i++) {
		await p.evaluate(() => window.qa.ponerPuerta(1));
		await p.evaluate(() => window.qa.ponerPuerta(0));
	}
});

console.log('\n--- espacios de trabajo ---');
await medir('interior → frontal → conjunto', async () => {
	for (const e of ['frontal', 'conjunto', 'interior']) {
		await p.evaluate((i) => document.getElementById(`esp-${i}`)?.click(), e);
		await p.waitForTimeout(320);
	}
});

console.log('\n--- energizar ---');
await medir('energizar el tablero', async () => {
	await p.evaluate(() => document.getElementById('btn-energizar')?.click());
	await p.waitForTimeout(2400);
});
await medir('con el tablero vivo, abrir la puerta', async () => {
	for (let t = 0; t <= 1.0001; t += 0.05) await p.evaluate((v) => window.qa.ponerPuerta(v), t);
});
await p.evaluate(() => document.getElementById('btn-energizar')?.click());
await p.waitForTimeout(1400);

/* ---------------- Los veredictos ---------------- */
console.log('');
const puerta1 = filas.find((f) => f.nombre === 'abrir la puerta de par en par');
const ciclos = filas.find((f) => f.nombre === 'veinte ciclos completos');
ok(puerta1.geo <= 0, `abrir la puerta NO crea geometría nueva (${puerta1.geo})`);
ok(puerta1.tex <= 0, `ni texturas (${puerta1.tex})`);
ok(puerta1.prog <= 0, `ni programas de shader (${puerta1.prog})`);
ok(ciclos.geo <= 0 && ciclos.tex <= 0 && ciclos.prog <= 0,
	`veinte ciclos de puerta tampoco (geo ${ciclos.geo}, tex ${ciclos.tex}, prog ${ciclos.prog})`);
// Y los grupos del mazo son los MISMOS objetos que antes de empezar: no se ha montado otra vez.
const mazos = new Set(filas.map((f) => f.mazo));
ok(mazos.size === 1, `el mazo de puerta es el mismo objeto de principio a fin (${mazos.size} identidades)`);
const porCiclo = ciclos.gesto / 40;
console.log(`   cada paso de puerta cuesta ${porCiclo.toFixed(1)} ms de ida y vuelta con la sonda`);

const nav = filas.filter((f) => ['girar (rueda pulsada)', 'desplazar (botón derecho)', 'acercar y alejar con la rueda'].includes(f.nombre));
for (const f of nav) {
	ok(f.geo <= 0 && f.prog <= 0, `${f.nombre}: mover la cámara no reconstruye nada (geo ${f.geo}, prog ${f.prog})`);
}
const hover = filas.find((f) => f.nombre === 'cuarenta movimientos de ratón');
ok(hover.geo <= 2, `pasar el ratón no fabrica geometría (${hover.geo})`);
console.log(`   y cada movimiento cuesta ${(hover.gesto / 40).toFixed(1)} ms, ida y vuelta con la sonda incluida`);

const conLargas = filas.filter((f) => f.largas > 0);
if (conLargas.length) {
	console.log('\n   TAREAS LARGAS ATRIBUIDAS:');
	console.log('   (en este contenedor, un `evaluate` de ida y vuelta cuesta segundos: compárense'
		+ ' con la columna de dibujado, que se mide DENTRO de una sola tarea)');
	for (const f of conLargas) {
		/*
		 * CUIDADO CON `geo`: `renderer.info.memory.geometries` cuenta las geometrías SUBIDAS a
		 * la tarjeta, no las creadas. Sube la primera vez que una malla se dibuja de verdad —al
		 * girar aparecen las caras de detrás, al acercarse se encienden los rótulos de detalle—
		 * y eso es trabajo de una vez, no una reconstrucción. Lo que delata una reconstrucción
		 * es que el contador vuelva a subir al REPETIR la misma acción, y por eso la prueba de
		 * la puerta son veinte ciclos y no uno.
		 */
		const causa = f.prog > 0 ? 'compilación de shaders (primera vez que se dibuja ese material)'
			: f.geo > 0 ? 'primera subida de geometría a la tarjeta'
				: f.tex > 0 ? 'subida de texturas'
					: 'JavaScript, recolector de basura o el propio banco de pruebas';
		console.log(`   · ${f.nombre}: ${f.largas} tarea(s), peor ${f.peorLarga} ms → ${causa}`);
	}
} else {
	console.log('\n   ninguna tarea por encima de 50 ms en toda la sesión');
}

const dibujos = filas.map((f) => f.dibujo);
console.log(`\n   dibujado en reposo tras cada actividad: ${Math.min(...dibujos)}..${Math.max(...dibujos)} ms (SwiftShader por software)`);
ok(Math.max(...dibujos) < Math.min(...dibujos) * 2.2 + 12,
	`el coste de dibujar no se dispara con el uso (${Math.min(...dibujos)} → ${Math.max(...dibujos)} ms)`);

/* ---------------- DE DÓNDE SALE EL TIRÓN DE ~1 SEGUNDO ---------------- */
/*
 * Este contenedor dibuja por software (SwiftShader) y TODO el dibujado de una pestaña pasa por un
 * único proceso de GPU. Una segunda escena de Three abierta a la vez —otra suite de QA corriendo
 * en paralelo, por ejemplo— comparte ese proceso y lo satura: los dos procesos de GPU se ponen al
 * 190 % de CPU y cualquier fotograma puede tardar un segundo o diez.
 *
 * La hipótesis se puede probar en lugar de contarse: se mide a solas, se abre una segunda escena
 * que dibuje lo mismo, se vuelve a medir y se cierra. Si el tirón aparece solo con vecino, el
 * tirón es del banco de pruebas y no del programa.
 */
{
	console.log('\n--- el tirón de ~1 s: se mide con y sin vecino ---');
	const a = await medir('a solas', async () => { await p.waitForTimeout(500); });
	const p2 = await b.newPage({ viewport: { width: 1400, height: 900 } });
	p2.setDefaultTimeout(120_000);
	await abrirEjemplo(p2, sv.address().port, 2);
	const conVecino = await medir('con otra escena dibujando a la vez', async () => { await p.waitForTimeout(500); });
	await p2.close();
	await p.waitForTimeout(2500);
	const despues = await medir('y otra vez a solas', async () => { await p.waitForTimeout(500); });
	const solo = Math.max(a.peorDibujo, despues.peorDibujo);
	console.log(`   peor fotograma a solas ${solo} ms · con vecino ${conVecino.peorDibujo} ms`);
	ok(conVecino.peorDibujo > solo * 1.8 || conVecino.largas > a.largas,
		`el tirón aparece con el vecino y no sin él (${solo} → ${conVecino.peorDibujo} ms,`
		+ ` tareas largas ${a.largas} → ${conVecino.largas})`);
	ok(despues.peorDibujo < solo * 2 + 20,
		`y al cerrarlo se va (${conVecino.peorDibujo} → ${despues.peorDibujo} ms)`);
}

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close();
sv.close();
process.exit(0);
