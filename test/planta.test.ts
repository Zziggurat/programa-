/**
 * Tests de la planta como HERRAMIENTA DE TRABAJO: buscar una máquina entre 129, colorearlas por
 * lo que interesa, medir una tirada de cable y sacar de ahí el tablero que las gobierna.
 *
 * Se prueban contra el archivo real de la cubierta —el que salió del DWG del proyectista—, no
 * contra datos de laboratorio: si el extractor cambia y deja de rotular los controladores, estas
 * pruebas lo dicen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { Infraestructura } from '../src/modelo/infraestructura.js';
import { Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import {
	buscarEquipos, canalDe, canalesDe, colorDeEquipo, leyendaColor, medirTirada, normalizar,
} from '../src/motores/planta.js';
import {
	contarES, familiaDePunto, listaDeSenales, tableroDesdeEquipos,
} from '../src/motores/planta-tablero.js';
import { Hallazgo, verificarProyecto } from '../src/motores/drc.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarDispositivos } from '../src/motores/numeracion.js';
import { generarPlanBorneros } from '../src/motores/bornes.js';
import { simular } from '../src/motores/simulacion.js';
import { declarado } from '../src/modelo/proyecto.js';

// El archivo de la cubierta se lee del disco y no se importa: son 380 kB de datos del proyecto,
// no código, y meterlos en la compilación los copiaría a `dist` en cada build.
const inf = JSON.parse(
	readFileSync(new URL('../../datos/cubierta.json', import.meta.url), 'utf8'),
) as Infraestructura;

/** Errores de DRC de un proyecto ya numerado. Los avisos no cuentan: son opiniones, no faltas. */
const erroresDe = (p: Parameters<typeof calcularPotenciales>[0]): Hallazgo[] =>
	verificarProyecto(p, calcularPotenciales(p)).filter((h) => h.severidad === 'error');

/* --------------------------------- Buscar --------------------------------- */

test('el archivo de la cubierta trae máquinas de verdad', () => {
	assert.ok(inf.equipos.length > 100, `solo ${inf.equipos.length} máquinas`);
	assert.ok(inf.equipos.some((e) => e.puntos.length >= 8), 'ninguna máquina con diagrama completo');
});

test('se busca como se escribe: sin guiones, sin tildes y sin mayúsculas', () => {
	assert.equal(normalizar('UMA-3-343'), 'UMA3343');
	assert.equal(normalizar('uma 3 343'), 'UMA3343');
	assert.equal(normalizar('Inyección'), 'INYECCION');
});

test('escribir el marcado encuentra la máquina, y la pone primera', () => {
	const uno = inf.equipos.find((e) => e.tipo === 'uma')!;
	const r = buscarEquipos(inf, { texto: uno.tag.replace(/-/g, '').toLowerCase() });
	assert.equal(r[0]?.tag, uno.tag, `buscando «${uno.tag}» salió «${r[0]?.tag}»`);
});

test('escribir solo el número encuentra todas las que lo llevan', () => {
	const uno = inf.equipos.find((e) => e.tipo === 'uma')!;
	const numero = uno.tag.split('-').pop()!;
	const r = buscarEquipos(inf, { texto: numero });
	assert.ok(r.some((e) => e.tag === uno.tag), `«${numero}» no encuentra ${uno.tag}`);
});

test('se puede buscar por lo que hace la señal, no solo por el marcado', () => {
	const r = buscarEquipos(inf, { texto: 'valvula' });
	assert.ok(r.length > 0, 'buscar «valvula» no encuentra ninguna máquina con válvula');
	assert.ok(r.every((e) => e.puntos.some((p) => /v[aá]lvula/i.test(p.que))),
		'ha salido una máquina que no tiene ninguna válvula');
});

test('los filtros se acumulan y no se contradicen', () => {
	const r = buscarEquipos(inf, { tipo: 'vex', conPuntos: true, situados: true });
	assert.ok(r.length > 0, 'ningún extractor situado y con puntos');
	for (const e of r) {
		assert.equal(e.tipo, 'vex');
		assert.ok(e.puntos.length > 0);
		assert.ok(e.x !== null);
	}
});

test('filtrar por sigla saca solo las que tienen ese punto', () => {
	const r = buscarEquipos(inf, { sigla: 'VAF' });
	assert.ok(r.length > 0, 'ninguna máquina con válvula de agua fría');
	assert.ok(r.every((e) => e.puntos.some((p) => p.sigla === 'VAF')));
});

test('sin texto ni filtros salen todas', () => {
	assert.equal(buscarEquipos(inf).length, inf.equipos.length);
});

/* --------------------------------- Colorear --------------------------------- */

test('el canal se saca del nombre del controlador y no se inventa', () => {
	const conCtrl = inf.equipos.find((e) => e.controlador)!;
	assert.match(canalDe(conCtrl)!, /^CH\d+$/);
	const sinCtrl = inf.equipos.find((e) => !e.controlador)!;
	assert.equal(canalDe(sinCtrl), undefined, 'se ha inventado un canal para una máquina sin controlador');
});

test('cada canal tiene su color y dos canales distintos no comparten color', () => {
	const canales = canalesDe(inf);
	assert.ok(canales.length >= 2, `solo ${canales.length} canal(es) en el plano`);
	const colores = canales.map((c) => {
		const e = inf.equipos.find((x) => canalDe(x) === c)!;
		return colorDeEquipo(e, 'controlador', canales);
	});
	assert.equal(new Set(colores).size, colores.length, 'dos canales pintados del mismo color');
});

test('la leyenda de cada modo cuenta TODAS las máquinas, sin dejarse ninguna', () => {
	for (const modo of ['tipo', 'controlador', 'puntos', 'tablero'] as const) {
		const suma = leyendaColor(inf, modo).reduce((s, l) => s + l.cuantos, 0);
		assert.equal(suma, inf.equipos.length,
			`la leyenda de «${modo}» suma ${suma} y hay ${inf.equipos.length} máquinas`);
	}
});

test('más señales, color más fuerte', () => {
	const pocas = { tag: 'a', tagSeguro: true, tipo: 'uma' as const, x: 0, y: 0, ancho: null, fondo: null, alto: null, puntos: [{ sigla: 'E', que: '', clase: 'salida digital' }], controlador: null, enTablero: false };
	const muchas = { ...pocas, puntos: Array.from({ length: 9 }, () => ({ sigla: 'E', que: '', clase: 'salida digital' })) };
	const verde = (c: number): number => (c >> 8) & 255;
	assert.ok(verde(colorDeEquipo(muchas, 'puntos', [])) > verde(colorDeEquipo(pocas, 'puntos', [])),
		'nueve señales no se ven más que una');
});

/* --------------------------------- Medir --------------------------------- */

test('con un solo punto no hay medida', () => {
	assert.equal(medirTirada([{ x: 0, y: 0, z: 0 }]), undefined);
});

test('el recorrido de un cable no es la línea recta: va en ortogonal', () => {
	const m = medirTirada([{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }])!;
	assert.equal(m.recta, 5, 'la recta de un 3-4-5 son 5 m');
	assert.equal(m.recorrido, 7, 'por la bandeja son 3 + 4 = 7 m, no 5');
	assert.equal(m.tramos, 1);
});

test('se cuentan la subida y la bajada, y la reserva', () => {
	const m = medirTirada([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }])!;
	assert.equal(m.recorrido, 10);
	assert.ok(m.vertical > 6, `solo ${m.vertical} m de subida y bajada a la bandeja`);
	// 10 de recorrido + 6,4 de vertical, con un 10 % de reserva y redondeando hacia arriba.
	assert.equal(m.cablePedido, Math.ceil((10 + m.vertical) * 1.1));
	assert.ok(m.cablePedido > m.recta, 'se pediría menos cable del que hace falta');
});

test('una tirada de varios tramos suma todos', () => {
	const m = medirTirada([
		{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 0, z: 5 },
	])!;
	assert.equal(m.tramos, 2);
	assert.equal(m.recorrido, 15);
});

/* ------------------------- Del mundo al tablero ------------------------- */

/** Las tres máquinas con más señales: el caso que más cosas puede romper. */
const masCompletas = (n: number): string[] => [...inf.equipos]
	.sort((a, b) => b.puntos.length - a.puntos.length)
	.slice(0, n).map((e) => e.tag);

/** Las borneras DE MÁQUINA, sin contar el peine de comunes. */
const bornerasDeMaquina = (p: Proyecto): Dispositivo[] =>
	p.dispositivos.filter((d) => d.tipo === 'bornero' && d.id !== 'x0');

test('cada punto del plano va a la familia de E/S que le toca', () => {
	assert.equal(familiaDePunto({ sigla: 'TAS', que: '', clase: 'entrada analógica' }), 'UI');
	assert.equal(familiaDePunto({ sigla: 'EF', que: '', clase: 'entrada digital' }), 'DI');
	assert.equal(familiaDePunto({ sigla: 'VAF', que: '', clase: 'salida analógica' }), 'AO');
	assert.equal(familiaDePunto({ sigla: 'PP', que: '', clase: 'salida digital' }), 'DO');
	assert.equal(familiaDePunto({ sigla: 'STR', que: '', clase: 'red' }), 'bus');
});

test('la lista de señales no repite un terminal del controlador', () => {
	const tags = masCompletas(4);
	const equipos = tags.map((t) => inf.equipos.find((e) => e.tag === t)!);
	const senales = listaDeSenales(equipos);
	assert.ok(senales.length > 20, `solo ${senales.length} señales en cuatro máquinas completas`);
	const terminales = senales.map((s) => s.terminal);
	assert.equal(new Set(terminales).size, terminales.length, 'dos señales al mismo terminal');
	// Y dentro de una misma bornera, tampoco se repite una borna.
	for (const t of tags) {
		const mias = senales.filter((s) => s.tag === t);
		const bornas = mias.flatMap((s) => [s.borna, s.bornaComun]);
		assert.equal(new Set(bornas).size, bornas.length, `bornas repetidas en la bornera de ${t}`);
	}
});

test('el tablero que sale de la cubierta se sostiene solo: pasa el DRC', () => {
	const r = tableroDesdeEquipos(inf, masCompletas(3));
	numerarDispositivos(r.proyecto);
	const errores = erroresDe(r.proyecto);
	assert.deepEqual(errores.map((e) => e.mensaje), [],
		`el tablero generado trae errores de DRC:\n${errores.map((e) => `  · ${e.mensaje}`).join('\n')}`);
});

test('el tablero trae una bornera por máquina, rotulada con su marcado', () => {
	const tags = masCompletas(3);
	const r = tableroDesdeEquipos(inf, tags);
	const borneros = bornerasDeMaquina(r.proyecto);
	assert.equal(borneros.length, tags.length);
	for (const t of tags) {
		assert.ok(borneros.some((b) => (b.descripcion ?? '').includes(t)),
			`no hay bornera rotulada para ${t}`);
	}
});

test('cada señal queda cableada de la máquina a la borna y de la borna al controlador', () => {
	const r = tableroDesdeEquipos(inf, masCompletas(2));
	const a1 = r.proyecto.dispositivos.find((d) => d.id === 'a1')!;
	const bornes = new Set(a1.bornes.map((b) => b.id));
	for (const s of r.senales) {
		assert.ok(bornes.has(s.terminal), `el controlador no tiene el terminal ${s.terminal}`);
		const llega = r.proyecto.conductores.some((c) =>
			(c.a.dispositivoId === 'a1' && c.a.borneId === s.terminal)
			|| (c.de.dispositivoId === 'a1' && c.de.borneId === s.terminal));
		assert.ok(llega, `la señal ${s.tag}:${s.sigla} no llega al terminal ${s.terminal}`);
	}
});

test('el controlador se dimensiona a las señales que hay, redondeando al bloque', () => {
	const tags = masCompletas(3);
	const equipos = tags.map((t) => inf.equipos.find((e) => e.tag === t)!);
	const es = contarES(equipos);
	const r = tableroDesdeEquipos(inf, tags);
	const a1 = r.proyecto.dispositivos.find((d) => d.id === 'a1')!;
	for (const familia of ['UI', 'DI', 'AO', 'DO'] as const) {
		const cuantos = a1.bornes.filter((b) => new RegExp(`^${familia}\\d+$`).test(b.id)).length;
		assert.ok(cuantos >= es[familia],
			`hacen falta ${es[familia]} ${familia} y el controlador trae ${cuantos}`);
		assert.ok(cuantos - es[familia] < 4,
			`sobran ${cuantos - es[familia]} ${familia}: se ha redondeado de más`);
	}
});

test('los comunes van puenteados y solo sale UN hilo al controlador por familia', () => {
	const tags = masCompletas(1);
	const r = tableroDesdeEquipos(inf, tags);
	const bornero = bornerasDeMaquina(r.proyecto)[0]!;
	assert.ok((bornero.puentes ?? []).length >= 1, 'los comunes no están puenteados');
	const familias = new Set(r.senales.map((s) => s.familia));
	for (const f of familias) {
		const comun = { UI: 'UIC', DI: 'DIC', AO: 'AOC', DO: 'DOC', bus: 'SHLD' }[f];
		const hilos = r.proyecto.conductores.filter((c) =>
			(c.a.dispositivoId === 'a1' && c.a.borneId === comun)
			|| (c.de.dispositivoId === 'a1' && c.de.borneId === comun));
		assert.equal(hilos.length, 1, `${hilos.length} hilos al común ${comun}: para eso está el puente`);
	}
});

test('una máquina sin diagrama de puntos se dice, no se cuela vacía', () => {
	const sin = inf.equipos.find((e) => e.puntos.length === 0)!;
	const con = inf.equipos.find((e) => e.puntos.length >= 6)!;
	const r = tableroDesdeEquipos(inf, [sin.tag, con.tag]);
	assert.deepEqual(r.sinPuntos, [sin.tag]);
	assert.ok(r.notas.some((n) => n.includes(sin.tag)), 'no se avisa de la máquina sin puntos');
	assert.equal(bornerasDeMaquina(r.proyecto).length, 1);
});

test('el resultado dice siempre que el controlador es genérico', () => {
	const r = tableroDesdeEquipos(inf, masCompletas(1));
	assert.ok(r.notas.some((n) => /gen[eé]rico/i.test(n)),
		'no se avisa de que el controlador hay que cambiarlo');
});

test('el plan de borneros del tablero generado sale entero y con destinos', () => {
	const r = tableroDesdeEquipos(inf, masCompletas(2));
	numerarDispositivos(r.proyecto);
	const planes = generarPlanBorneros(r.proyecto);
	assert.equal(planes.length, 3, 'dos borneras de máquina más el peine de comunes');
	for (const plan of planes) {
		assert.ok(plan.filas.length > 0, `la bornera ${plan.designacion} sale vacía`);
		for (const f of plan.filas) {
			assert.ok(f.internas.length + f.externas.length > 0,
				`la borna ${plan.designacion}:${f.borna} no va a ningún lado`);
		}
	}
});

test('sin máquinas sale un tablero vacío pero válido, no un error', () => {
	const r = tableroDesdeEquipos(inf, []);
	assert.equal(r.senales.length, 0);
	assert.equal(r.bornas, 0);
	assert.ok(r.proyecto.dispositivos.length >= 4, 'ni siquiera trae la alimentación');
	numerarDispositivos(r.proyecto);
	assert.deepEqual(erroresDe(r.proyecto).map((e) => e.mensaje), []);
});

test('los aparatos generados caben en la placa que se les asigna', () => {
	const r = tableroDesdeEquipos(inf, masCompletas(4));
	const g = r.proyecto.gabinete!;
	for (const c of g.colocaciones) {
		assert.ok(c.x >= 0 && c.x + c.ancho <= g.ancho,
			`${c.dispositivoId} se sale por el lado: x=${c.x} an=${c.ancho} placa=${g.ancho}`);
		assert.ok(c.y >= 0 && c.y + c.alto <= g.alto,
			`${c.dispositivoId} se sale por abajo: y=${c.y} al=${c.alto} placa=${g.alto}`);
	}
	// Y ninguno se monta encima de otro.
	for (let i = 0; i < g.colocaciones.length; i++) {
		for (let j = i + 1; j < g.colocaciones.length; j++) {
			const a = g.colocaciones[i];
			const b = g.colocaciones[j];
			const choca = a.x < b.x + b.ancho && b.x < a.x + a.ancho
				&& a.y < b.y + b.alto && b.y < a.y + a.alto;
			assert.ok(!choca, `${a.dispositivoId} y ${b.dispositivoId} se pisan en la placa`);
		}
	}
});

/*
 * Auditoría TS-P1-06. El puente creaba la fuente con bornes `+24`/`0V` —como vienen rotuladas las
 * fuentes de 24 V CC de verdad— pero la simulación buscaba el secundario por el id (`+V`/`S1`,
 * `-V`/`S2`), así que ese secundario no existía para ella: el PLC quedaba muerto en un tablero
 * que el propio programa acababa de armar. Ninguna prueba lo vio porque todos los ejemplos usan
 * aparatos del catálogo, que sí se llaman `+V`/`-V`.
 */
test('el tablero armado desde la planta se energiza de verdad', () => {
	const tags = inf.equipos.filter((e) => e.puntos.length > 0).slice(0, 3).map((e) => e.tag);
	const { proyecto } = tableroDesdeEquipos(inf, tags);

	const fuente = proyecto.dispositivos.find((d) => d.tipo === 'fuente')!;
	assert.ok(fuente, 'el puente arma una fuente');
	assert.equal(fuente.bornes.find((b) => b.id === '+24')?.lado, 'secundario+',
		'el lado va DECLARADO, no deducido del nombre del borne');
	assert.equal(fuente.bornes.find((b) => b.id === '0V')?.lado, 'secundario-');

	const r = simular(proyecto);
	const vivo = (id: string) => [...r.vivos.keys()].some((k) => String(k).startsWith(`${id}::`));
	assert.ok(vivo(fuente.id), 'la fuente tiene tensión');
	const secundario = [...r.vivos.entries()]
		.filter(([k]) => String(k).startsWith(`${fuente.id}::+24`) || String(k).startsWith(`${fuente.id}::0V`));
	assert.equal(secundario.length, 2, 'los dos bornes del secundario nacen como fuente');
	assert.equal(secundario[0][1].tension, 24, 'y lo hacen a 24 V');

	const plc = proyecto.dispositivos.find((d) => d.tipo === 'plc');
	if (plc) assert.ok(vivo(plc.id), 'el controlador queda alimentado');
});

/*
 * El puente declaraba Icc 6 kA, ambiente 40 °C y montaje mural. No salen de ninguna parte: el
 * plano no los trae. Declararlos hacía que el DRC verificase el poder de corte contra una Icc
 * inventada y que la placa de características los imprimiese como datos del proyecto.
 */
test('el puente NO se inventa la Icc, el ambiente ni el montaje', () => {
	const tags = inf.equipos.filter((e) => e.puntos.length > 0).slice(0, 2).map((e) => e.tag);
	const { proyecto, notas } = tableroDesdeEquipos(inf, tags);
	assert.equal(declarado(proyecto, 'iccPresuntaKA'), false);
	assert.equal(declarado(proyecto, 'temperaturaAmbienteC'), false);
	assert.equal(declarado(proyecto, 'montajeGabinete'), false);
	assert.ok(notas.some((n) => /sin declarar/i.test(n)), 'y lo dice en las notas del resultado');
});

/*
 * Segunda auditoría, TS2-P1-03 y TS2-P1-04. La prueba de arriba comprobaba que la fuente y el
 * controlador quedaban ALIMENTADOS, y con eso se dio por bueno el puente. No era suficiente: un
 * tablero puede tener tensión en la alimentación y no operar. Estas dos comprueban lo que de
 * verdad importa —que el mando LLEGA a la máquina, y que el DRC no avisa de lo que él mismo acaba
 * de armar—, y las dos fallan contra el código anterior.
 */

/** Los bornes vivos de un aparato, por su id. */
const vivosDe = (r: ReturnType<typeof simular>, id: string): string[] =>
	[...r.vivos.keys()].map(String).filter((k) => k.startsWith(`${id}::`)).map((k) => k.split('::')[1]);

test('el mando del controlador LLEGA a la máquina de la cubierta', () => {
	const tags = inf.equipos.filter((e) => e.puntos.length > 0).slice(0, 3).map((e) => e.tag);
	const { proyecto } = tableroDesdeEquipos(inf, tags);
	const plc = proyecto.dispositivos.find((d) => d.tipo === 'plc')!;
	const salida = plc.bornes.find((b) => /^DO\d+$/.test(b.id))!.id;

	/*
	 * Antes NO llegaba. La simulación buscaba el común de las salidas como `+24`/`+V`, y este DDC
	 * se llama `24V~` / `24V COM` —como se rotula uno de verdad—, así que el `find` devolvía
	 * `undefined` y ninguna salida cerraba. Medido: forzando DO1 y AO1 quedaban vivos exactamente
	 * los dos bornes de alimentación del PLC y CERO bornas del bornero y CERO puntos de campo.
	 */
	const r = simular(proyecto, { [plc.id]: { salidas: [salida] } });
	assert.ok(vivosDe(r, plc.id).includes(salida), `${salida} tiene que quedar vivo al cerrar`);

	// Y de ahí, por su hilo, hasta la borna del bornero y la borna de la máquina en la cubierta.
	const saltos = (dev: string, borne: string): { dispositivoId: string; borneId: string }[] =>
		proyecto.conductores
			.filter((c) => (c.de.dispositivoId === dev && c.de.borneId === borne)
				|| (c.a.dispositivoId === dev && c.a.borneId === borne))
			.map((c) => (c.de.dispositivoId === dev && c.de.borneId === borne ? c.a : c.de));

	const enBornero = saltos(plc.id, salida);
	assert.equal(enBornero.length, 1, 'la salida va a una borna, y a una sola');
	assert.ok(vivosDe(r, enBornero[0].dispositivoId).includes(enBornero[0].borneId),
		'la borna asignada del bornero queda viva');

	const enCampo = saltos(enBornero[0].dispositivoId, enBornero[0].borneId)
		.filter((p) => p.dispositivoId !== plc.id);
	assert.equal(enCampo.length, 1, 'y de la borna sale un hilo a la máquina');
	const maquina = proyecto.dispositivos.find((d) => d.id === enCampo[0].dispositivoId)!;
	assert.ok(maquina.campo, 'que es un aparato de campo, en la cubierta');
	assert.ok(vivosDe(r, maquina.id).includes(enCampo[0].borneId),
		`${maquina.id}::${enCampo[0].borneId} —el punto de campo— tiene que quedar vivo`);

	// Sin energizar señales ajenas: ninguna otra E/S del controlador se mueve.
	const otras = vivosDe(r, plc.id).filter((b) => /^(DO|AO|UI|DI)\d+$/.test(b) && b !== salida);
	assert.deepEqual(otras, [], 'cerrar una salida no puede energizar las demás');
});

test('el tablero recién armado desde la Planta NO trae avisos de tensión inventados', () => {
	/*
	 * Salían tres, y los tres eran mentira: el PE que une el 220 con el 24 —que para eso está— y
	 * los dos bornes del PRIMARIO de la fuente, que están a 220 y se leían a 24 porque la tensión
	 * era un dato del aparato y no del borne.
	 */
	for (const n of [0, 1, 3, 8]) {
		const tags = inf.equipos.filter((e) => e.puntos.length > 0).slice(0, n).map((e) => e.tag);
		const { proyecto } = tableroDesdeEquipos(inf, tags);
		const r6 = verificarProyecto(proyecto, calcularPotenciales(proyecto))
			.filter((h) => h.regla === 'R6-conflicto-tension');
		assert.deepEqual(r6.map((h) => h.mensaje), [], `con ${n} máquinas`);
	}
});

/*
 * Segunda auditoría, TS2-P2-05. `recta` sumaba la distancia euclidiana de CADA TRAMO, que con tres
 * o más puntos es la longitud de la polilínea, no la recta entre los extremos. El tipo prometía
 * «distancia en línea recta entre los extremos» y daba otra cosa, así que las dos medidas que se
 * dan —la recta como mínimo teórico y el recorrido ortogonal como lo que se pide— dejaban de poder
 * compararse justo cuando más falta hace: en una tirada que da un rodeo.
 */
test('la medida en recta es de punta a punta, no la suma de los tramos', () => {
	// Una tirada en L: 0,0 → 10,0 → 10,10. La recta es la diagonal; el recorrido, los dos lados.
	const m = medirTirada([
		{ x: 0, y: 3.2, z: 0 }, { x: 10, y: 3.2, z: 0 }, { x: 10, y: 3.2, z: 10 },
	])!;
	assert.ok(Math.abs(m.recta - Math.hypot(10, 10)) < 0.001, `recta = ${m.recta}, esperada 14,14`);
	assert.equal(m.recorrido, 20, 'el recorrido sí suma los dos lados');
	assert.ok(m.recta < m.recorrido, 'y por eso la recta tiene que salir MENOR que el recorrido');

	// Con dos puntos las dos coinciden en línea, que es lo que hacía que el fallo no se viera.
	const recto = medirTirada([{ x: 0, y: 3.2, z: 0 }, { x: 6, y: 3.2, z: 0 }])!;
	assert.equal(recto.recta, 6);
	assert.equal(recto.recorrido, 6);
});
