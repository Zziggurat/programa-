/**
 * Tests del motor de esquema. Comprueban la TOPOLOGÍA del plano (que cada aparato tenga su
 * símbolo, que los hilos lleguen a los pines correctos, que las referencias entre hojas
 * apunten a donde deben) sin dibujar nada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores } from '../src/motores/numeracion.js';
import { generarReferencias } from '../src/motores/referencias.js';
import {
	ANCHO_MAX_SIMBOLO, anchoColumna, esBloqueFuncional, esPotencia, HOJA_A3, montarEsquema, posicionesEnEsquema,
	repartirEnColumnas, rutaHilo, separarEtiquetas, simboloDe,
} from '../src/motores/esquema.js';

/** Arranque directo mínimo: automático → contactor → motor, con su mando. */
function arranqueDirecto(): Proyecto {
	const p = crearProyecto('arranque');
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', corrienteNominal: 10, polos: 3, bornes: [
			{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }, { id: '3', tipo: 'L' }, { id: '4', tipo: 'L' },
		] },
		{ id: 'km1', tipo: 'contactor', designacion: '-KM1', rol: { tipo: 'maestro' }, bornes: [
			{ id: '1/L1', tipo: 'L' }, { id: '2/T1', tipo: 'L' }, { id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' },
		] },
		{ id: 'm1', tipo: 'motor', designacion: '-M1', corrienteNominal: 8, polos: 3, bornes: [
			{ id: 'U', tipo: 'L' }, { id: 'V', tipo: 'L' },
		] },
		{ id: 's1', tipo: 'pulsador', designacion: '-S1', bornes: [
			{ id: '13', tipo: 'control' }, { id: '14', tipo: 'control' },
		] },
	];
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'q1', borneId: '2' }, a: { dispositivoId: 'km1', borneId: '1/L1' }, seccion: 2.5 },
		{ id: 'c2', de: { dispositivoId: 'km1', borneId: '2/T1' }, a: { dispositivoId: 'm1', borneId: 'U' }, seccion: 2.5 },
		{ id: 'c3', de: { dispositivoId: 's1', borneId: '14' }, a: { dispositivoId: 'km1', borneId: 'A1' }, seccion: 1 },
	];
	return p;
}

const montar = (p: Proyecto) => {
	const pot = calcularPotenciales(p);
	numerarConductores(p, pot);
	return montarEsquema(p, pot);
};

/* --------------------------------- Símbolos --------------------------------- */

test('simboloDe: cada borne del aparato tiene su punto de conexión', () => {
	const s = simboloDe({ id: 'q', tipo: 'disyuntor', bornes: [
		{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' },
	] });
	assert.equal(s.pines.size, 4);
	for (const id of ['1', '2', '3', '4']) assert.ok(s.pines.has(id), `falta el pin ${id}`);
});

test('simboloDe: los pines pares quedan arriba y los impares abajo (entrada → salida)', () => {
	const s = simboloDe({ id: 'q', tipo: 'disyuntor', bornes: [{ id: '1' }, { id: '2' }] });
	assert.ok(s.pines.get('1')!.y < 0, 'el 1 entra por arriba');
	assert.ok(s.pines.get('2')!.y > 0, 'el 2 sale por abajo');
});

test('simboloDe: un motor lleva su círculo con la M', () => {
	const s = simboloDe({ id: 'm', tipo: 'motor', bornes: [{ id: 'U' }] });
	assert.ok(s.trazos.some((t) => t.tipo === 'circulo'));
	assert.ok(s.trazos.some((t) => t.tipo === 'texto' && t.texto === 'M'));
});

test('simboloDe: la bobina de un contactor se dibuja como rectángulo; el contacto, como trazo', () => {
	const bobina = simboloDe({ id: 'k', tipo: 'contactor', bornes: [{ id: 'A1' }, { id: 'A2' }] });
	const contacto = simboloDe({ id: 'k2', tipo: 'contactor', bornes: [{ id: '13' }, { id: '14' }] });
	assert.equal(bobina.trazos.filter((t) => t.tipo === 'linea').length > contacto.trazos.filter((t) => t.tipo === 'linea').length, true);
});

test('simboloDe: un tipo desconocido no revienta y sale como caja con sus pines', () => {
	const s = simboloDe({ id: 'x', tipo: 'otro', bornes: [{ id: 'a' }, { id: 'b' }] });
	assert.equal(s.pines.size, 2);
	assert.ok(s.trazos.length > 0);
});

test('simboloDe: un aparato sin bornes no rompe el dibujo', () => {
	const s = simboloDe({ id: 'v', tipo: 'otro', bornes: [] });
	assert.equal(s.pines.size, 0);
	assert.ok(s.ancho > 0 && s.alto > 0);
});

/* ------------------------------ Fuerza vs mando ------------------------------ */

test('esPotencia: motores y guardamotores son fuerza; pulsadores y PLC son mando', () => {
	assert.ok(esPotencia({ id: 'm', tipo: 'motor', bornes: [] }));
	assert.ok(esPotencia({ id: 'g', tipo: 'guardamotor', bornes: [] }));
	assert.ok(!esPotencia({ id: 's', tipo: 'pulsador', bornes: [{ id: '13', tipo: 'control' }] }));
	assert.ok(!esPotencia({ id: 'a', tipo: 'plc', bornes: [{ id: 'I1', tipo: 'senal' }] }));
});

/* ------------------------------ Reparto en columnas ------------------------------ */

test('repartirEnColumnas: cada aparato cae en una columna distinta', () => {
	const p = arranqueDirecto();
	const cols = repartirEnColumnas(p, p.dispositivos);
	assert.equal(cols.size, p.dispositivos.length);
	assert.equal(new Set(cols.values()).size, p.dispositivos.length, 'no se pisan dos aparatos');
});

test('repartirEnColumnas: los aparatos conectados quedan en columnas contiguas', () => {
	const p = arranqueDirecto();
	const cols = repartirEnColumnas(p, p.dispositivos);
	// q1 y km1 están unidos por c1: no deben quedar en extremos opuestos de la hoja.
	assert.ok(Math.abs(cols.get('q1')! - cols.get('km1')!) <= 2,
		`q1=${cols.get('q1')} km1=${cols.get('km1')}: los conectados van juntos`);
});

test('repartirEnColumnas: un aparato suelto también recibe columna (no se pierde)', () => {
	const p = arranqueDirecto();
	p.dispositivos.push({ id: 'solo', tipo: 'piloto', designacion: '-P9', bornes: [{ id: 'X1' }] });
	const cols = repartirEnColumnas(p, p.dispositivos);
	assert.ok(cols.has('solo'));
});

/* --------------------------------- Montaje --------------------------------- */

test('montarEsquema: separa fuerza y mando en hojas distintas', () => {
	const hojas = montar(arranqueDirecto());
	assert.ok(hojas.length >= 2, `salieron ${hojas.length} hojas`);
	assert.ok(hojas.some((h) => /potencia/i.test(h.titulo)));
	assert.ok(hojas.some((h) => /mando/i.test(h.titulo)));
});

test('montarEsquema: TODOS los aparatos acaban dibujados, ninguno se pierde', () => {
	const p = arranqueDirecto();
	const hojas = montar(p);
	const dibujados = new Set(hojas.flatMap((h) => h.simbolos.map((s) => s.dispositivoId)));
	for (const d of p.dispositivos) assert.ok(dibujados.has(d.id), `${d.designacion} no se dibujó`);
});

test('montarEsquema: cada símbolo cabe dentro de la hoja', () => {
	const hojas = montar(arranqueDirecto());
	for (const h of hojas) {
		for (const s of h.simbolos) {
			assert.ok(s.x >= 0 && s.x + s.ancho <= h.anchoMm, `${s.designacion} se sale a lo ancho`);
			assert.ok(s.y >= 0 && s.y + s.alto <= h.altoMm, `${s.designacion} se sale a lo alto`);
		}
	}
});

test('montarEsquema: los hilos empiezan y acaban exactamente en un pin', () => {
	const p = arranqueDirecto();
	const hojas = montar(p);
	let comprobados = 0;
	for (const h of hojas) {
		const pines = new Map<string, { x: number; y: number }>();
		for (const s of h.simbolos) for (const [id, punto] of s.pines) pines.set(`${s.dispositivoId}::${id}`, punto);
		for (const hilo of h.hilos) {
			const c = p.conductores.find((x) => x.id === hilo.conductorId)!;
			const a = pines.get(`${c.de.dispositivoId}::${c.de.borneId}`)!;
			const b = pines.get(`${c.a.dispositivoId}::${c.a.borneId}`)!;
			const ini = hilo.nodos[0];
			const fin = hilo.nodos[hilo.nodos.length - 1];
			assert.deepEqual({ x: ini.x, y: ini.y }, { x: a.x, y: a.y }, `${hilo.conductorId} no nace en su borne`);
			assert.deepEqual({ x: fin.x, y: fin.y }, { x: b.x, y: b.y }, `${hilo.conductorId} no llega a su borne`);
			comprobados++;
		}
	}
	assert.ok(comprobados > 0, 'debe haber hilos dentro de alguna hoja');
});

test('montarEsquema: los hilos son ortogonales (solo tramos rectos, como en un plano)', () => {
	for (const h of montar(arranqueDirecto())) {
		for (const hilo of h.hilos) {
			for (let i = 0; i < hilo.nodos.length - 1; i++) {
				const a = hilo.nodos[i];
				const b = hilo.nodos[i + 1];
				assert.ok(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01,
					`tramo diagonal en ${hilo.conductorId}`);
			}
		}
	}
});

test('montarEsquema: cada hilo lleva el número de su potencial', () => {
	const hojas = montar(arranqueDirecto());
	const conNumero = hojas.flatMap((h) => h.hilos).filter((x) => x.numero);
	assert.ok(conNumero.length > 0, 'los hilos deben ir numerados');
});

test('montarEsquema: un conductor que cruza de hoja deja referencia en AMBAS hojas', () => {
	const p = arranqueDirecto();
	// c1 va de -Q1 (potencia) a -KM1; el mando de -KM1 está en la otra hoja.
	const hojas = montar(p);
	const cruzados = p.conductores.filter((c) => {
		const hojaDe = (id: string) => hojas.findIndex((h) => h.simbolos.some((s) => s.dispositivoId === id));
		return hojaDe(c.de.dispositivoId) !== hojaDe(c.a.dispositivoId);
	});
	if (cruzados.length === 0) return; // este proyecto no cruza: nada que comprobar
	const conRef = hojas.filter((h) => h.referencias.some((r) => /→ \//.test(r.texto)));
	assert.ok(conRef.length >= 2, 'las dos hojas deben marcar el enlace');
});

test('montarEsquema: un proyecto vacío devuelve cero hojas en vez de reventar', () => {
	assert.deepEqual(montarEsquema(crearProyecto('vacío'), calcularPotenciales(crearProyecto('vacío'))), []);
});

test('montarEsquema: las imágenes de referencia no salen en el esquema', () => {
	const p = arranqueDirecto();
	p.dispositivos.push({ id: 'foto', tipo: 'otro', designacion: 'foto', imagen: 'data:,x', bornes: [{ id: 'p1' }] });
	const dibujados = montar(p).flatMap((h) => h.simbolos.map((s) => s.dispositivoId));
	assert.ok(!dibujados.includes('foto'));
});

test('montarEsquema: muchos aparatos se reparten en varias hojas sin perder ninguno', () => {
	const p = crearProyecto('grande');
	p.dispositivos = Array.from({ length: 26 }, (_, i) => ({
		id: `k${i}`, tipo: 'rele' as const, designacion: `-K${i + 1}`,
		bornes: [{ id: 'A1', tipo: 'control' as const }, { id: 'A2', tipo: 'control' as const }],
	}));
	const hojas = montar(p);
	const dibujados = new Set(hojas.flatMap((h) => h.simbolos.map((s) => s.dispositivoId)));
	assert.equal(dibujados.size, 26, `se dibujaron ${dibujados.size} de 26`);
	assert.ok(hojas.length >= 3, `26 aparatos en 10 columnas necesitan ≥3 hojas (salieron ${hojas.length})`);
	assert.equal(new Set(hojas.map((h) => h.numero)).size, hojas.length, 'las hojas se numeran sin repetir');
});

test('montarEsquema: un contacto esclavo apunta a la hoja donde está su bobina', () => {
	const p = arranqueDirecto();
	p.dispositivos.push({
		id: 'km1c', tipo: 'contactor', designacion: '-KM1:13', rol: { tipo: 'esclavo', maestroId: 'km1', contacto: 'NA' },
		bornes: [{ id: '13', tipo: 'control' }, { id: '14', tipo: 'control' }],
	});
	const refs = montar(p).flatMap((h) => h.referencias).filter((r) => r.dispositivoId === 'km1c');
	assert.equal(refs.length, 1);
	assert.match(refs[0].texto, /bobina \/\d+\.\d+/);
});

/* --------------------------------- Ruta de hilos --------------------------------- */

test('rutaHilo: dos pines en la misma vertical se unen con un hilo recto', () => {
	const r = rutaHilo({ x: 50, y: 100 }, { x: 50, y: 200 }, HOJA_A3 as never as { altoMm: number });
	assert.equal(r.length, 2);
});

test('rutaHilo: pines en columnas distintas cruzan por una banda libre, no en diagonal', () => {
	const r = rutaHilo({ x: 50, y: 120 }, { x: 200, y: 120 }, { altoMm: 297 });
	assert.equal(r.length, 4);
	assert.equal(r[1].y, r[2].y, 'el tramo de cruce es horizontal');
	assert.ok(r[1].y < 120 || r[1].y > 120, 'el cruce no pasa por encima de los símbolos');
});

test('anchoColumna: las columnas reparten el ancho útil de la hoja', () => {
	const a = anchoColumna(HOJA_A3, 10);
	assert.ok(a > 30 && a < 50, `salió ${a} mm`);
	assert.ok(Math.abs(a * 10 - (HOJA_A3.ancho - 30)) < 0.01);
});

/* ------------------- Legibilidad: nada puede tapar a nada ------------------- */

test('separarEtiquetas: dos etiquetas en el mismo punto acaban separadas', () => {
	const es = [
		{ texto: '5 → /2.1', p: { x: 100, y: 150 } },
		{ texto: '6 → /2.1', p: { x: 100, y: 150 } },
	];
	separarEtiquetas(es);
	assert.ok(Math.abs(es[0].p.y - es[1].p.y) >= 4, `quedaron a ${Math.abs(es[0].p.y - es[1].p.y).toFixed(1)} mm`);
});

test('separarEtiquetas: si no se pisan, no se toca ninguna (el plano no se descoloca solo)', () => {
	const es = [
		{ texto: '1', p: { x: 50, y: 100 } },
		{ texto: '2', p: { x: 200, y: 100 } },
		{ texto: '3', p: { x: 50, y: 200 } },
	];
	const antes = es.map((e) => ({ ...e.p }));
	separarEtiquetas(es);
	assert.deepEqual(es.map((e) => e.p), antes);
});

test('separarEtiquetas: un montón en el mismo sitio se apilan todas sin repetir altura', () => {
	const es = Array.from({ length: 8 }, (_, i) => ({ texto: `hilo ${i}`, p: { x: 120, y: 200 } }));
	separarEtiquetas(es);
	const ys = es.map((e) => Math.round(e.p.y * 10) / 10);
	assert.equal(new Set(ys).size, ys.length, `alturas repetidas: ${ys.join(', ')}`);
});

test('separarEtiquetas: las de arriba suben y las de abajo bajan (se alejan del dibujo)', () => {
	const arriba = [{ texto: 'a', p: { x: 100, y: 40 } }, { texto: 'b', p: { x: 100, y: 40 } }];
	separarEtiquetas(arriba, { altoMm: 297 });
	assert.ok(arriba[1].p.y < 40 || arriba[0].p.y < 40, 'en la mitad de arriba se apilan hacia arriba');

	const abajo = [{ texto: 'a', p: { x: 100, y: 250 } }, { texto: 'b', p: { x: 100, y: 250 } }];
	separarEtiquetas(abajo, { altoMm: 297 });
	assert.ok(abajo[1].p.y > 250 || abajo[0].p.y > 250, 'en la mitad de abajo se apilan hacia abajo');
});

test('separarEtiquetas: una etiqueta no se queda encima de un símbolo', () => {
	const es = [{ texto: 'PE → /2.3', p: { x: 100, y: 150 } }];
	separarEtiquetas(es, { obstaculos: [{ x: 90, y: 145, ancho: 20, alto: 12 }] });
	assert.ok(es[0].p.y < 145 || es[0].p.y > 157, `se quedó sobre el símbolo en y=${es[0].p.y}`);
});

test('montarEsquema: en los ejemplos, ninguna etiqueta del plano se pisa con otra', () => {
	const p = arranqueDirecto();
	const ancho = (t: string) => Math.max(7, t.length * 1.7);
	for (const h of montar(p)) {
		for (let i = 0; i < h.referencias.length; i++) {
			for (let j = i + 1; j < h.referencias.length; j++) {
				const a = h.referencias[i];
				const b = h.referencias[j];
				const seTocanEnX = Math.abs(a.p.x - b.p.x) < (ancho(a.texto) + ancho(b.texto)) / 2;
				const seTocanEnY = Math.abs(a.p.y - b.p.y) < 3.9;
				assert.ok(!(seTocanEnX && seTocanEnY),
					`«${a.texto}» y «${b.texto}» se pisan en la hoja ${h.numero}`);
			}
		}
	}
});

test('montarEsquema: cada hilo con número deja su etiqueta en la hoja', () => {
	const hojas = montar(arranqueDirecto());
	for (const h of hojas) {
		const conNumero = h.hilos.filter((x) => x.numero).length;
		const etiquetasDeHilo = h.referencias.filter((r) => r.tipo === 'hilo').length;
		assert.equal(etiquetasDeHilo, conNumero, `hoja ${h.numero}: ${etiquetasDeHilo} etiquetas para ${conNumero} hilos`);
	}
});

/* ------------------- Bloques funcionales y posición en el plano ------------------- */

/** Controlador real: caja con muchos terminales y borneras declaradas por ficha de datos. */
function controlador(): Proyecto {
	const p = crearProyecto('controlador');
	p.dispositivos = [{
		id: 'a1', tipo: 'plc', designacion: '-A1', referencia: 'PUB6438S',
		bornes: [
			...['24V~', '24V COM', 'GND'].map((id) => ({ id, tipo: 'control' as const })),
			...Array.from({ length: 6 }, (_, i) => ({ id: `UI${i + 1}`, tipo: 'senal' as const })),
			...Array.from({ length: 8 }, (_, i) => ({ id: `DO${i + 1}`, tipo: 'senal' as const })),
		],
		terminales: [
			{ lado: 'izquierda', bornes: ['24V~', '24V COM', 'GND'] },
			{ lado: 'arriba', bornes: ['UI1', 'UI2', 'UI3', 'UI4', 'UI5', 'UI6'] },
			{ lado: 'derecha', bornes: ['DO1', 'DO2', 'DO3', 'DO4', 'DO5', 'DO6', 'DO7', 'DO8'] },
		],
	}];
	return p;
}

test('un controlador se dibuja como bloque, no como un aparato de dos filas', () => {
	const d = controlador().dispositivos[0];
	assert.ok(esBloqueFuncional(d));
	const s = simboloDe(d);
	// Con el reparto en dos filas serían 8 vías × 8 mm = 64 mm: se comería la columna vecina.
	assert.ok(s.ancho <= ANCHO_MAX_SIMBOLO, `ancho ${s.ancho} mm`);
	assert.equal(s.pines.size, d.bornes.length, 'todos los terminales tienen pin');
});

test('el bloque respeta el agrupamiento real de las borneras del equipo', () => {
	const d = controlador().dispositivos[0];
	const s = simboloDe(d);
	// Lo que en el aparato va arriba o a la izquierda, en el plano va al costado izquierdo.
	const xIzq = s.pines.get('24V~')!.x;
	assert.equal(s.pines.get('UI1')!.x, xIzq, 'las entradas comparten costado con la alimentación');
	assert.ok(s.pines.get('DO1')!.x > xIzq, 'las salidas van al otro costado');
	// Y dentro de un costado no hay dos terminales en el mismo punto.
	const puntos = new Set([...s.pines.values()].map((p) => `${p.x.toFixed(2)}:${p.y.toFixed(2)}`));
	assert.equal(puntos.size, s.pines.size);
});

test('el bloque rotula cada terminal: es lo que se aprieta en obra', () => {
	const s = simboloDe(controlador().dispositivos[0]);
	const textos = s.trazos.filter((t) => t.tipo === 'texto').map((t) => (t as { texto: string }).texto);
	for (const id of ['24V~', 'UI1', 'UI6', 'DO8']) assert.ok(textos.includes(id), `falta el rótulo ${id}`);
	assert.ok(textos.includes('PUB6438S'), 'el bloque lleva la referencia del equipo');
});

test('un aparato con muchos polos no se sale de su columna', () => {
	const p = crearProyecto('ancho');
	p.dispositivos = [{
		id: 'q', tipo: 'disyuntor', designacion: '-Q1',
		bornes: Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), tipo: 'L' as const })),
	}];
	assert.ok(simboloDe(p.dispositivos[0]).ancho <= ANCHO_MAX_SIMBOLO);
	assert.ok(simboloDe(p.dispositivos[0]).ancho <= anchoColumna(HOJA_A3, 10));
});

test('ningún símbolo se sale del marco de la hoja, por alto que sea', () => {
	const p = controlador();
	// Un equipo enorme: 60 terminales por costado.
	p.dispositivos[0].bornes = Array.from({ length: 120 }, (_, i) => ({ id: `T${i + 1}`, tipo: 'senal' as const }));
	p.dispositivos[0].terminales = [
		{ lado: 'arriba', bornes: p.dispositivos[0].bornes.slice(0, 60).map((b) => b.id) },
		{ lado: 'abajo', bornes: p.dispositivos[0].bornes.slice(60).map((b) => b.id) },
	];
	const hojas = montarEsquema(p, calcularPotenciales(p));
	for (const h of hojas) {
		for (const s of h.simbolos) {
			assert.ok(s.y >= 0 && s.y + s.alto <= h.altoMm, `${s.designacion} se sale de la hoja`);
			assert.ok(s.x >= 0 && s.x + s.ancho <= h.anchoMm, `${s.designacion} se sale de la hoja`);
		}
	}
});

test('la posición que se cita es la del plano montado, no un número de cortesía', () => {
	const p = arranqueDirecto();
	const hojas = montarEsquema(p, calcularPotenciales(p));
	const posiciones = posicionesEnEsquema(hojas);
	assert.equal(posiciones.size, hojas.reduce((n, h) => n + h.simbolos.length, 0));
	for (const h of hojas) {
		for (const s of h.simbolos) {
			assert.equal(posiciones.get(s.dispositivoId), `${h.numero}.${s.columna}`);
			assert.ok(s.columna >= 1 && s.columna <= h.columnas, `columna ${s.columna} fuera de la rejilla`);
		}
	}
	// Y el índice de referencias usa esa misma posición, no otra.
	const indice = generarReferencias(p, posiciones).indice;
	for (const e of indice) {
		if (posiciones.has(e.dispositivoId)) assert.equal(e.posicion, posiciones.get(e.dispositivoId));
	}
});

test('un bornero grande sigue dibujándose como bornero, no como bloque', () => {
	const p = crearProyecto('bornero');
	p.dispositivos = [{
		id: 'x1', tipo: 'bornero', designacion: '-X1',
		bornes: Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), tipo: 'control' as const })),
	}];
	assert.equal(esBloqueFuncional(p.dispositivos[0]), false);
	const s = simboloDe(p.dispositivos[0]);
	assert.ok(s.trazos.some((t) => t.tipo === 'circulo'), 'conserva la fila de círculos del bornero');
	assert.ok(s.ancho <= ANCHO_MAX_SIMBOLO, 'y sigue cabiendo en su columna');
});
