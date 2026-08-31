import assert from 'node:assert/strict';
import test from 'node:test';
import type { CircuitoIngenieria } from '../src/ingenieria/circuitos.js';
import { datosCoordinacion, REGLA_PROTECCIONES } from '../src/ingenieria/protecciones.js';
import { validarIngenieria } from '../src/ingenieria/validacion.js';
import { resultadoFisicaVacio } from '../src/fisica/topologia-proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Dispositivo, Proyecto } from '../src/modelo/tipos.js';

const proteccion = (id: string, inA: number, curva: 'B' | 'C' | 'D', icuKA?: number): Dispositivo => ({
	id, tipo: 'disyuntor', corrienteNominal: inA, curvaDisparo: curva, bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }],
	comportamiento: { version: 1, clase: 'proteccion', polos: [{ entrada: '1', salida: '2' }], contactos: [],
		rearmable: true, funcion: 'termomagnetico' },
	fisica: { version: 1, proteccion: { inA, curva, capacidadCorte: icuKA ? { icuKA, icsKA: icuKA / 2 } : undefined } },
});
const motor: Dispositivo = { id: 'm1', tipo: 'motor', corrienteNominal: 9, bornes: [{ id: 'U', tipo: 'L' }],
	comportamiento: { version: 1, clase: 'carga', alimentacion: { fases: ['U'], retornos: [], fasesMinimas: 1 }, efecto: 'giro' },
	fisica: { version: 1, motor: { potenciaMecanicaNominalW: 4000, tensionNominalV: 400, frecuenciaHz: 50,
		fases: 3, eficiencia: 0.9, factorPotencia: 0.85, corrienteNominalA: 9, corrienteArranqueMultiplo: 6, tiempoArranqueS: 2 } } };
const proyecto: Proyecto = { formato: 'tablero-studio', version: 1, nombre: 'Protecciones V7', hojas: [],
	gabinete: { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] }, conductores: [],
	dispositivos: [proteccion('q0', 16, 'D', 6), proteccion('q1', 10, 'C', 0.5), motor] };
const circuito: CircuitoIngenieria = { id: 'circuito:red->m1', nombre: 'Motor', tipo: 'MOTOR', estadoTopologia: 'INEQUIVOCA',
	fuenteId: 'red', fuentes: ['red'], protecciones: ['q0', 'q1'], maniobra: [], conductores: [], cargas: ['m1'],
	senalesRelacionadas: [], equipos: ['q0', 'q1', 'm1'], subcircuitos: [], ambiguedades: [], trayectos: [{
		fuenteId: 'red', raiz: 'red::L', destino: 'm1::U',
		nodos: ['red::L', 'q0::1', 'q0::2', 'q1::1', 'q1::2', 'm1::U'],
		dispositivos: ['m1', 'q0', 'q1', 'red'], conductores: [],
	}] };

function fisica() {
	const f = resultadoFisicaVacio(); f.activo = true;
	const evalQ = { region: 'NORMAL' as const, multiploIn: 0.5, origen: 'ESTIMADO' as const, explicacion: 'normal' };
	f.protecciones.set('q0', { dispositivoId: 'q0', corrienteA: 9, inA: 16, evaluacion: evalQ, fallas: ['sc'] });
	f.protecciones.set('q1', { dispositivoId: 'q1', corrienteA: 9, inA: 10, evaluacion: evalQ, fallas: ['sc'] });
	f.fallas.push({ id: 'sc', tipo: 'L_N', iccA: { re: 1000, im: 0 }, origen: 'CALCULADO', diagnosticos: [] });
	f.motores.set('m1', { dispositivoId: 'm1', tensionV: 400, corrienteA: 9, potenciaEntradaW: 4400,
		potenciaReactivaVar: 2000, potenciaAparenteVA: 4800, factorPotencia: 0.85, potenciaMecanicaEstimadaW: 4000,
		eficiencia: 0.9, rpm: 1450, rpmSincronas: 1500, corrienteNominalCalculadaA: 8.1, corrienteNominalUsadaA: 9,
		estado: 'marcha', diagnosticos: [], origen: 'CALCULADO' });
	const abajo = { region: 'TERMICA' as const, multiploIn: 5, tMinS: 0.5, tMaxS: 5, origen: 'ESTIMADO' as const, explicacion: 'q1' };
	const arriba = { region: 'TERMICA' as const, multiploIn: 3, tMinS: 2, tMaxS: 20, origen: 'ESTIMADO' as const, explicacion: 'q0' };
	f.selectividad.push({ fallaId: 'sc', aguasAbajoId: 'q1', aguasArribaId: 'q0', clasificacion: 'PARCIAL',
		explicacion: 'Las bandas se solapan', aguasAbajo: abajo, aguasArriba: arriba });
	return f;
}

test('Gate D distingue corriente operativa, corriente de diseño e In', () => {
	const r = validarIngenieria({ proyecto, circuitos: [circuito], fisica: fisica(), reglas: [REGLA_PROTECCIONES] });
	const calibres = r.resultados.filter((x) => x.code === 'TS-PROT-RATING');
	assert.equal(calibres.length, 2); assert.ok(calibres.every((x) => x.status === 'PASS'));
	assert.ok(calibres.every((x) => x.evidence.some((e) => e.codigo === 'I_OPERATING')));
	const p = structuredClone(proyecto); p.dispositivos.find((d) => d.id === 'q1')!.fisica!.proteccion!.inA = 8;
	const f = fisica(); f.protecciones.get('q1')!.inA = 8;
	const rojo = validarIngenieria({ proyecto: p, circuitos: [circuito], fisica: f, reglas: [REGLA_PROTECCIONES] });
	assert.equal(rojo.resultados.find((x) => x.code === 'TS-PROT-RATING' && x.relatedEntities.some((e) => e.id === 'q1'))?.status, 'FAIL');
});

test('Gate D compara Icc con Icu/Icn configurado y no inventa el dato ausente', () => {
	const r = validarIngenieria({ proyecto, circuitos: [circuito], fisica: fisica(), reglas: [REGLA_PROTECCIONES] });
	const cortes = r.resultados.filter((x) => x.code === 'TS-PROT-BREAKING-CAPACITY');
	assert.equal(cortes.find((x) => x.relatedEntities.some((e) => e.id === 'q0'))?.status, 'PASS');
	assert.equal(cortes.find((x) => x.relatedEntities.some((e) => e.id === 'q1'))?.status, 'FAIL');
	const p = structuredClone(proyecto); delete p.dispositivos.find((d) => d.id === 'q1')!.fisica!.proteccion!.capacidadCorte;
	const falta = validarIngenieria({ proyecto: p, circuitos: [circuito], fisica: fisica(), reglas: [REGLA_PROTECCIONES] });
	const issue = falta.resultados.find((x) => x.code === 'TS-PROT-BREAKING-CAPACITY-DATA' && x.relatedEntities.some((e) => e.id === 'q1'))!;
	assert.equal(issue.status, 'INDETERMINATE'); assert.deepEqual(issue.missingData, ['Icu o Icn configurado']);
});

test('Gate D superpone arranque de motor sobre la curva sin afirmar coordinación de fabricante', () => {
	const r = validarIngenieria({ proyecto, circuitos: [circuito], fisica: fisica(), reglas: [REGLA_PROTECCIONES] });
	const q1 = r.resultados.find((x) => x.code === 'TS-PROT-MOTOR-START' && x.relatedEntities.some((e) => e.id === 'q1'))!;
	assert.equal(q1.status, 'WARNING'); assert.ok(q1.evidence.some((e) => e.codigo === 'I_START' && e.origen === 'ESTIMADO'));
	const p = structuredClone(proyecto); const d = p.dispositivos.find((x) => x.id === 'q1')!;
	d.curvaDisparo = 'B'; d.fisica!.proteccion!.curva = 'B';
	const instantanea = validarIngenieria({ proyecto: p, circuitos: [circuito], fisica: fisica(), reglas: [REGLA_PROTECCIONES] });
	assert.equal(instantanea.resultados.find((x) => x.code === 'TS-PROT-MOTOR-START' && x.relatedEntities.some((e) => e.id === 'q1'))?.status, 'FAIL');
});

test('Gate D eleva selectividad V5/V6 y entrega datos de curva sin recalcularlos en UI', () => {
	const f = fisica(); const r = validarIngenieria({ proyecto, circuitos: [circuito], fisica: f, reglas: [REGLA_PROTECCIONES] });
	const coord = r.resultados.find((x) => x.code === 'TS-COORD-SELECTIVITY')!;
	assert.equal(coord.status, 'WARNING'); assert.match(coord.description, /solapan/);
	const datos = datosCoordinacion(proyecto, [circuito], f);
	assert.equal(datos.length, 1); assert.equal(datos[0].clasificacion, 'PARCIAL');
	assert.equal(datos[0].aguasArriba.perfil?.id, 'MODELO_GEN_D');
	assert.deepEqual(datos[0].aguasAbajo.evaluacion, f.selectividad[0].aguasAbajo);
	assert.deepEqual(datosCoordinacion(structuredClone(proyecto), [structuredClone(circuito)], structuredClone(f)), datos);
});

test('Gate D conserva Icn/Icu/Ics opcionales al guardar y elimina valores inválidos', () => {
	const bruto = structuredClone(proyecto) as unknown as Record<string, any>;
	bruto.dispositivos[0].fisica.proteccion.capacidadCorte = { icnKA: 10, icuKA: 15, icsKA: -1 };
	const p = cargarProyecto(JSON.stringify(bruto)).proyecto;
	assert.deepEqual(p.dispositivos[0].fisica?.proteccion?.capacidadCorte, { icnKA: 10, icuKA: 15, icsKA: undefined });
});
