import assert from 'node:assert/strict';
import test from 'node:test';

import { hojaASvg } from '../app/esquema-svg.js';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { planActivacionRepresentaciones,
	planDesdoblamientoRepresentacion } from '../src/motores/crear-representaciones-esquema.js';
import { solapesColinealesSinResolver } from '../src/motores/cruces-esquema.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { penetracionesDeSimbolos, rutaOrtogonalM2 } from '../src/motores/ruteo-esquema-m2.js';

function ejemploM2(id: string): Proyecto {
	const p = EJEMPLOS.find((e) => e.id === id)!.crear();
	const plan = planActivacionRepresentaciones(p, calcularPotenciales(p));
	if (!plan.ok) throw new Error(plan.motivo);
	p.hojas = plan.valor.hojas;
	p.esquema = { ...p.esquema, representaciones: plan.valor.representaciones };
	return p;
}

const geometria = (p: Proyecto) => montarEsquema(p, calcularPotenciales(p))
	.flatMap((hoja) => hoja.hilos.map((hilo) => ({ hoja: hoja.id,
		id: hilo.conductorId, nodos: hilo.nodos })))
	.sort((a, b) => a.hoja < b.hoja ? -1 : a.hoja > b.hoja ? 1
		: a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

test('M2 reserva corredores ortogonales: arranque directo no cruza cajas ni comparte tinta no justificada', () => {
	const p = ejemploM2('arranque-directo');
	const antes = JSON.stringify(p);
	const hojas = montarEsquema(p, calcularPotenciales(p));
	assert.equal(hojas.length, 2);
	assert.equal(hojas.reduce((n, h) => n + h.hilos.length, 0), 16);
	for (const hoja of hojas) {
		assert.deepEqual(penetracionesDeSimbolos(hoja), []);
		assert.deepEqual(solapesColinealesSinResolver(hoja), []);
		assert.equal(hoja.problemas?.filter((x) => x.codigo === 'ruta-grafica-sin-corredor').length, 0);
		assert.doesNotMatch(hojaASvg(hoja), /SOLAPE SIN RESOLVER|ruta gráfica sin corredor/i);
		for (const hilo of hoja.hilos) {
			const conductor = p.conductores.find((c) => c.id === hilo.conductorId)!;
			assert.deepEqual(hilo.bornes, { de: conductor.de, a: conductor.a });
			assert.ok(hilo.nodos.length >= 2);
		}
	}
	assert.equal(JSON.stringify(p), antes, 'el recorrido de papel no modifica el circuito ni la ruta física');
});

test('M2 obtiene la misma tinta por ID al invertir arrays, guardar y reabrir', () => {
	const p = ejemploM2('arranque-directo');
	const base = geometria(p);
	const invertido = structuredClone(p);
	invertido.conductores.reverse();
	invertido.dispositivos.reverse();
	invertido.esquema!.representaciones!.reverse();
	assert.deepEqual(geometria(invertido), base);
	assert.deepEqual(geometria(cargarProyecto(JSON.stringify(p)).proyecto), base);
});

test('al desdoblar KM1 el borne compartido deriva mediante abanico corto sin fusionar w24', () => {
	const p = ejemploM2('arranque-directo');
	const origen = p.esquema!.representaciones!.find((r) => r.dispositivoId === 'km1')!;
	const plan = planDesdoblamientoRepresentacion(p, origen.id, {
		bobina: { hojaId: 'h2', columna: 1, fila: 5 },
		polos: { hojaId: 'h1', columna: 1, fila: 3 },
		auxiliares: { hojaId: 'h2', columna: 1, fila: 3 },
	});
	if (!plan.ok) throw new Error(plan.motivo);
	p.esquema!.representaciones!.splice(p.esquema!.representaciones!.indexOf(origen), 1, ...plan.valor);
	const hojas = montarEsquema(p, calcularPotenciales(p));
	for (const hoja of hojas) {
		assert.deepEqual(solapesColinealesSinResolver(hoja), []);
		assert.deepEqual(penetracionesDeSimbolos(hoja), []);
	}
	const mando = hojas.find((h) => h.id === 'h2')!;
	const w24 = mando.hilos.find((h) => h.conductorId === 'w24')!;
	assert.deepEqual(w24.bornes?.de, { dispositivoId: 'x2', borneId: '3' });
	assert.equal(Math.abs(w24.nodos[0].x - w24.nodos[1].x), 3);
	assert.equal(Math.abs(w24.nodos[0].y - w24.nodos[1].y), 3);
	assert.doesNotMatch(hojaASvg(mando, { interactivo: true }), /SOLAPE SIN RESOLVER/);
	const invertido = structuredClone(p);
	invertido.conductores.reverse();
	assert.deepEqual(geometria(invertido), geometria(p));
});

test('sin corredor seguro el router no inventa un trayecto a través de la caja', () => {
	const simbolo = { dispositivoId: 'barrera', designacion: '-B1', columna: 1,
		x: 5, y: 0, ancho: 10, alto: 20, trazos: [], pines: new Map() };
	const hoja = { simbolos: [simbolo], anchoMm: 20, altoMm: 20 };
	const limites = { x0: 0, x1: 20, y0: 0, y1: 20, superior: 3, inferior: 17 };
	assert.equal(rutaOrtogonalM2({ x: 2, y: 10 }, { x: 18, y: 10 }, hoja, [], limites), undefined,
		'la caja toca ambos límites verticales: no existe rodeo interior');
});

test('PLC de 24 V: un borne lateral sale de su caja antes de usar carril, sin solapes', () => {
	const p = ejemploM2('control-24v');
	const hojas = montarEsquema(p, calcularPotenciales(p));
	for (const hoja of hojas) {
		assert.deepEqual(penetracionesDeSimbolos(hoja), []);
		assert.deepEqual(solapesColinealesSinResolver(hoja), []);
		assert.equal(hoja.problemas?.filter((x) => x.codigo === 'ruta-grafica-sin-corredor').length, 0);
	}
	const c14 = hojas.flatMap((h) => h.hilos).find((h) => h.conductorId === 'c14')!;
	assert.deepEqual(c14.bornes?.de, { dispositivoId: 'a1', borneId: 'DO1' });
	assert.equal(c14.nodos[0].y, c14.nodos[1].y);
	assert.ok(c14.nodos[1].x >= c14.nodos[0].x + 3,
		'el conductor abandona el costado derecho del PLC antes de girar');
});

test('ejemplos principales: el orden de arrays no altera tinta y ningún cruce de caja queda silencioso', () => {
	for (const id of ['arranque-directo', 'bomba-boya', 'estrella-triangulo',
		'control-24v', 'uma-cubierta']) {
		const p = ejemploM2(id);
		const base = geometria(p);
		const invertido = structuredClone(p);
		invertido.dispositivos.reverse();
		invertido.conductores.reverse();
		invertido.esquema!.representaciones!.reverse();
		assert.deepEqual(geometria(invertido), base, id);
		for (const hoja of montarEsquema(p, calcularPotenciales(p))) {
			const pendientes = new Set(hoja.problemas?.filter((x) => x.codigo === 'ruta-grafica-sin-corredor')
				.map((x) => x.conductorId));
			assert.equal(pendientes.size, 0, `${id}: el ejemplo principal requiere un corredor pendiente`);
			assert.deepEqual(penetracionesDeSimbolos(hoja), [], `${id}: caja penetrada`);
			const solapes = solapesColinealesSinResolver(hoja);
			if (id !== 'uma-cubierta') assert.deepEqual(solapes, [], `${id}: tinta compartida`);
			else if (solapes.length) assert.match(hojaASvg(hoja), /SOLAPE SIN RESOLVER/);
		}
	}
});
