import assert from 'node:assert/strict';
import test from 'node:test';
import type { CircuitoIngenieria, EstadoTopologiaCircuito } from '../src/ingenieria/circuitos.js';
import {
	REGLA_TOPOLOGIA_CIRCUITOS, validarIngenieria, type EngineeringRule,
	type EstadoValidacionIngenieria, type ResultadoReglaIngenieria,
} from '../src/ingenieria/validacion.js';
import type { Proyecto } from '../src/modelo/tipos.js';

const proyecto: Proyecto = { formato: 'tablero-studio', version: 1, nombre: 'Validación V7', hojas: [],
	dispositivos: [], conductores: [], gabinete: { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] } };

function circuito(id: string, estadoTopologia: EstadoTopologiaCircuito): CircuitoIngenieria {
	const conFuente = estadoTopologia !== 'SIN_FUENTE';
	return { id, nombre: id, tipo: 'GENERICO', estadoTopologia, fuenteId: estadoTopologia === 'INEQUIVOCA' ? 'f1' : undefined,
		fuentes: conFuente ? estadoTopologia === 'AMBIGUA' ? ['f1', 'f2'] : ['f1'] : [], protecciones: [], maniobra: [],
		conductores: [], cargas: [`load-${id}`], senalesRelacionadas: [], equipos: [], subcircuitos: [], trayectos: [],
		ambiguedades: estadoTopologia === 'AMBIGUA' ? ['MULTIPLE_SOURCES:f1,f2'] : [] };
}

const resultado = (status: EstadoValidacionIngenieria, id: string): ResultadoReglaIngenieria => ({
	code: `TS-CIRCUIT-${status}`, category: 'CIRCUIT', severity: status === 'FAIL' ? 'ERROR' : status === 'WARNING' ? 'WARNING' : 'INFO',
	status, title: status, description: `resultado ${status}`, evidence: [{ codigo: `E-${id}`, descripcion: id, origen: 'CALCULADO' }],
	relatedEntities: [{ tipo: 'DEVICE', id }], provenance: 'CALCULADO', missingData: status === 'INDETERMINATE' ? ['dato X'] : [],
	remediationHints: status === 'FAIL' ? ['corregir X'] : [],
});

test('Gate B representa PASS, WARNING, FAIL, INDETERMINATE y NOT_APPLICABLE sin confundir severidad', () => {
	const estados: EstadoValidacionIngenieria[] = ['PASS', 'WARNING', 'FAIL', 'INDETERMINATE', 'NOT_APPLICABLE'];
	const regla: EngineeringRule = { code: 'TS-CIRCUIT-ESTADOS', category: 'CIRCUIT', scope: 'PROJECT',
		evaluate: () => estados.map((e, i) => resultado(e, String(i))) };
	const r = validarIngenieria({ proyecto, circuitos: [], reglas: [regla] });
	assert.deepEqual(r.resumen, { pass: 1, warning: 1, fail: 1, indeterminate: 1, notApplicable: 1,
		errores: 1, advertencias: 1, informacion: 1 });
	assert.deepEqual(r.issues.map((x) => x.status), ['FAIL', 'WARNING', 'INDETERMINATE']);
	assert.equal(r.issues.find((x) => x.status === 'INDETERMINATE')?.severity, 'INFO');
});

test('Gate B convierte topología inequívoca, ambigua y sin fuente en resultados honestos', () => {
	const r = validarIngenieria({ proyecto, circuitos: [
		circuito('ok', 'INEQUIVOCA'), circuito('amb', 'AMBIGUA'), circuito('none', 'SIN_FUENTE'),
	], reglas: [REGLA_TOPOLOGIA_CIRCUITOS] });
	assert.deepEqual(r.resultados.map((x) => x.status), ['WARNING', 'INDETERMINATE', 'PASS']);
	assert.match(r.issues.find((x) => x.status === 'WARNING')!.evidence[0].descripcion, /MULTIPLE_SOURCES/);
	assert.deepEqual(r.issues.find((x) => x.status === 'INDETERMINATE')!.missingData, ['fuente o raíz eléctrica explícita']);
	assert.equal(validarIngenieria({ proyecto, circuitos: [], reglas: [REGLA_TOPOLOGIA_CIRCUITOS] })
		.resultados[0].status, 'NOT_APPLICABLE');
});

test('Gate B deduplica una causa, conserva evidencia y elige el resultado más grave', () => {
	const warning = resultado('WARNING', 'q1'); warning.code = 'TS-PROT-DUPLICATE'; warning.category = 'PROTECTION';
	const fail = resultado('FAIL', 'q1'); fail.code = 'TS-PROT-DUPLICATE'; fail.category = 'PROTECTION';
	fail.evidence = [{ codigo: 'I', descripcion: 'corriente medida', valor: 22, unidad: 'A', origen: 'CALCULADO' }];
	fail.missingData = ['Icu']; warning.remediationHints = ['revisar calibre'];
	const regla: EngineeringRule = { code: 'TS-PROT-DUPLICATE', category: 'PROTECTION', scope: 'ENTITY',
		evaluate: () => [warning, fail] };
	const r = validarIngenieria({ proyecto, circuitos: [], reglas: [regla] });
	assert.equal(r.resultados.length, 1); assert.equal(r.issues.length, 1); assert.equal(r.issues[0].status, 'FAIL');
	assert.deepEqual(r.issues[0].evidence.map((e) => e.codigo), ['E-q1', 'I']);
	assert.deepEqual(r.issues[0].missingData, ['Icu']);
	assert.deepEqual(r.issues[0].remediationHints, ['corregir X', 'revisar calibre']);
});

test('Gate B ordena reglas, resultados, evidencia y entidades independientemente de arrays', () => {
	const a = resultado('WARNING', 'b'); a.code = 'TS-CABLE-Z'; a.category = 'CABLE';
	a.relatedEntities.push({ tipo: 'CONDUCTOR', id: 'w2' }, { tipo: 'CONDUCTOR', id: 'w1' });
	a.evidence.push({ codigo: 'A', descripcion: 'primera', origen: 'CONFIGURADO' });
	const b = resultado('FAIL', 'a'); b.code = 'TS-IO-A'; b.category = 'IO';
	const reglas: EngineeringRule[] = [
		{ code: 'TS-CABLE-Z', category: 'CABLE', scope: 'ENTITY', evaluate: () => [a] },
		{ code: 'TS-IO-A', category: 'IO', scope: 'ENTITY', evaluate: () => [b] },
	];
	const uno = validarIngenieria({ proyecto, circuitos: [], reglas });
	const a2 = structuredClone(a); a2.relatedEntities.reverse(); a2.evidence.reverse();
	const dos = validarIngenieria({ proyecto: structuredClone(proyecto), circuitos: [], reglas: [
		{ ...reglas[1], evaluate: () => [structuredClone(b)] }, { ...reglas[0], evaluate: () => [a2] },
	] });
	assert.deepEqual(dos, uno); assert.match(uno.issues[0].id, /^TS-IO-A:/);
});

test('Gate B no persiste issues ni mezcla el resultado con DiagnosticEngine V6', () => {
	const antes = JSON.stringify(proyecto); const r = validarIngenieria({ proyecto, circuitos: [circuito('amb', 'AMBIGUA')] });
	assert.equal(JSON.stringify(proyecto), antes); assert.ok(r.issues.length > 0);
	assert.doesNotMatch(JSON.stringify(proyecto), /issues|diagnostico|resultado/);
});
