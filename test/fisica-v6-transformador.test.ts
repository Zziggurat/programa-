import assert from 'node:assert/strict';
import test from 'node:test';
import { complejo, magnitud } from '../src/fisica/complejos.js';
import { resolverRedFisica } from '../src/fisica/solver.js';
import type { RedFisica } from '../src/fisica/tipos.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { cargarProyecto } from '../src/modelo/cargar.js';

const cerca = (a: number, b: number, t = 1e-3) => assert.ok(Math.abs(a - b) <= t * Math.max(1, Math.abs(b)), `${a} != ${b}`);

function redTrafo(cargaOhm: number, zPrimariaOhm = 5): RedFisica {
	return {
		nodos: [{ id: 'p1' }, { id: 'p0', referencia: true }, { id: 's1' }, { id: 's0', referencia: true }],
		ramas: [],
		fuentes: [{ id: 'red', de: 'p1', a: 'p0', tensionV: complejo(230),
			zInternaOhm: complejo(0.1), origenImpedancia: 'CONFIGURADO' }],
		transformadores: [{ id: 't1', primarioDe: 'p1', primarioA: 'p0', secundarioDe: 's1', secundarioA: 's0',
			relacion: 10, zSeriePrimarioOhm: complejo(zPrimariaOhm), potenciaNominalVA: 230, origen: 'CALCULADO' }],
		cargas: [{ id: 'z1', de: 's1', a: 's0', modelo: 'CONSTANT_Z', zOhm: complejo(cargaOhm), origen: 'CONFIGURADO' }],
	};
}

test('V6 transformador: relación V/I, impedancia reflejada y balance no crean potencia', () => {
	const r = resolverRedFisica(redTrafo(23)); const t = r.transformadores.get('t1')!;
	assert.equal(r.metricas.convergio, true);
	cerca(magnitud(t.corrienteSecundariaA), magnitud(t.corrientePrimariaA) * 10, 1e-9);
	cerca(magnitud(t.tensionPrimariaV), magnitud(t.tensionSecundariaV) * 10 + magnitud(t.corrientePrimariaA) * 5, 2e-3);
	cerca(t.potenciaEntradaVA.re, t.potenciaSalidaVA.re + t.perdidaCobreW, 1e-6);
	assert.ok(Math.abs(r.metricas.errorBalanceW) < 1e-3);
	assert.ok((t.eficiencia ?? 0) > 0 && (t.eficiencia ?? 2) <= 1);
});

test('V6 transformador: más carga y más Z% aumentan corriente primaria y regulación', () => {
	const ligera = resolverRedFisica(redTrafo(230, 5)).transformadores.get('t1')!;
	const cargada = resolverRedFisica(redTrafo(23, 5)).transformadores.get('t1')!;
	const altaZ = resolverRedFisica(redTrafo(23, 15)).transformadores.get('t1')!;
	assert.ok(magnitud(cargada.corrientePrimariaA) > magnitud(ligera.corrientePrimariaA));
	assert.ok((cargada.regulacionPct ?? 0) > (ligera.regulacionPct ?? Infinity));
	assert.ok((altaZ.regulacionPct ?? 0) > (cargada.regulacionPct ?? Infinity));
});

function proyectoTrafo(): Proyecto {
	return {
		formato: 'tablero-studio', version: 1, nombre: 'Fixture V6 — transformador bajo carga', hojas: [],
		gabinete: { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] },
		dispositivos: [
			{ id: 'red', tipo: 'otro', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
				fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230, referencia: 'N',
					fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.1, xOhm: 0 } } },
			{ id: 't1', tipo: 'transformador', bornes: [
				{ id: 'P1', tipo: 'L' }, { id: 'P2', tipo: 'N' }, { id: 'S1', tipo: 'L' }, { id: 'S2', tipo: 'N' },
			], comportamiento: { version: 1, clase: 'fuente', primario: { entradas: ['P1'], retornos: ['P2'] },
				salidas: [{ borne: 'S1', papel: 'fase', tensionV: 23 }, { borne: 'S2', papel: 'retorno', tensionV: 23 }] },
				fisica: { version: 1, transformador: { primarioV: 230, secundarioV: 23,
					primarioTerminales: ['P1', 'P2'], secundarioTerminales: ['S1', 'S2'],
					potenciaVA: 230, impedanciaPct: 5, xSobreR: 0, perdidasVacioW: 2 } } },
			{ id: 'z1', tipo: 'resistencia', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
				fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 23 } } },
		],
		conductores: [
			{ id: 'wp1', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 't1', borneId: 'P1' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'wp2', de: { dispositivoId: 't1', borneId: 'P2' }, a: { dispositivoId: 'red', borneId: 'N' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'ws1', de: { dispositivoId: 't1', borneId: 'S1' }, a: { dispositivoId: 'z1', borneId: 'L' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'ws2', de: { dispositivoId: 'z1', borneId: 'N' }, a: { dispositivoId: 't1', borneId: 'S2' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
		],
	};
}

test('V6 transformador: configuración persistente activa el modelo acoplado sin fuente secundaria falsa', () => {
	const p = cargarProyecto(JSON.stringify(proyectoTrafo())).proyecto;
	const r = simularFisicaProyecto(p); const t = r.red.transformadores.get('transformador:t1')!;
	assert.ok(t);
	assert.equal(r.red.fuentes.has('transformador:t1'), false);
	assert.ok(magnitud(t.corrientePrimariaA) > 0.09);
	assert.ok(magnitud(t.corrienteSecundariaA) > 0.9);
	assert.ok(magnitud(t.tensionSecundariaV) < 23);
	assert.ok(Math.abs(r.red.metricas.errorBalanceW) < 0.1);
	assert.ok(r.red.ramas.has('transformador-vacio:t1'));
});

test('V6 transformador: resultado es estable al invertir nodos, ramas y cargas', () => {
	const a = resolverRedFisica(redTrafo(23)); const red = redTrafo(23);
	red.nodos.reverse(); red.ramas.reverse(); red.cargas.reverse(); red.transformadores!.reverse();
	const b = resolverRedFisica(red);
	cerca(magnitud(a.transformadores.get('t1')!.corrientePrimariaA), magnitud(b.transformadores.get('t1')!.corrientePrimariaA), 1e-9);
});
