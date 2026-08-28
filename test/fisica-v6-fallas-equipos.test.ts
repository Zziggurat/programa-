import assert from 'node:assert/strict';
import test from 'node:test';
import type { Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { magnitud } from '../src/fisica/complejos.js';
import { BIBLIOTECA_FALLAS_EQUIPO, resolverFallasEquipo, type FallaEquipoRuntime } from '../src/fisica/fallas-equipos.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { contactosCerrados, simular } from '../src/motores/simulacion.js';

function circuitoSerie(conProteccion = false): Proyecto {
	const dispositivos: Dispositivo[] = [
		{ id: 'red', tipo: 'otro', campo: true, tensionNominal: 230, bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
			comportamiento: { version: 1, clase: 'fuente', salidas: [
				{ borne: 'L', papel: 'fase', tensionV: 230 }, { borne: 'N', papel: 'retorno', tensionV: 230 },
			] }, fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230,
				referencia: 'N', fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.05 } } },
		...(conProteccion ? [{ id: 'q1', tipo: 'disyuntor' as const, bornes: [{ id: 'I' }, { id: 'O' }],
			comportamiento: { version: 1 as const, clase: 'proteccion' as const, funcion: 'termomagnetico' as const,
				rearmable: true, polos: [{ entrada: 'I', salida: 'O' }], contactos: [] },
			fisica: { version: 1 as const, proteccion: { inA: 16 } } }] : []),
		{ id: 'z1', tipo: 'resistencia', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
			fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 23 } } },
	];
	return { formato: 'tablero-studio', version: 1, nombre: 'Fallas V6', hojas: [],
		gabinete: { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] }, dispositivos,
		conductores: conProteccion ? [
			{ id: 'w1', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'q1', borneId: 'I' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'w2', de: { dispositivoId: 'q1', borneId: 'O' }, a: { dispositivoId: 'z1', borneId: 'L' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'w3', de: { dispositivoId: 'z1', borneId: 'N' }, a: { dispositivoId: 'red', borneId: 'N' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
		] : [
			{ id: 'w1', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'z1', borneId: 'L' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'w2', de: { dispositivoId: 'z1', borneId: 'N' }, a: { dispositivoId: 'red', borneId: 'N' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
		] };
}

test('V6 fallas: biblioteca tipada cubre familias y declara honestamente lo no modelado', () => {
	for (const familia of ['conductor', 'contacto', 'proteccion', 'motor', 'transformador', 'variador', 'sensor', 'controlador'] as const) {
		assert.ok([...BIBLIOTECA_FALLAS_EQUIPO.values()].some((d) => d.familia === familia));
	}
	assert.equal(BIBLIOTECA_FALLAS_EQUIPO.get('BOBINA_EN_CORTO')!.modelado, 'NO_MODELADO');
	assert.equal(BIBLIOTECA_FALLAS_EQUIPO.get('FASE_ABIERTA_TRANSFORMADOR')!.modelado, 'NO_MODELADO');
});

test('V6 fallas conductor/protección: la condición cambia topología, corriente y diagnóstico base', () => {
	const p = circuitoSerie(); const normal = simular(p);
	const abierta: FallaEquipoRuntime = { id: 'f-w1', codigo: 'CONDUCTOR_ABIERTO', objetivo: { tipo: 'CONDUCTOR', conductorId: 'w1' } };
	const r = simular(p, { z1: { fallasEquipos: [abierta] } });
	assert.ok(normal.fisica.red.potenciaCargasW > 2000); assert.equal(r.fisica.red.potenciaCargasW, 0);
	assert.equal(r.diagnosticosFallasEquipo[0].estado, 'APLICADA');
	const resistiva = simular(p, { z1: { fallasEquipos: [{ id: 'r-w1', codigo: 'RESISTENCIA_ELEVADA',
		objetivo: { tipo: 'CONDUCTOR', conductorId: 'w1' }, parametros: { resistenciaOhm: 20 } }] } });
	assert.ok(resistiva.fisica.conductores.get('w1')!.corrienteA < normal.fisica.conductores.get('w1')!.corrienteA);

	const pq = circuitoSerie(true);
	const trip = simular(pq, { q1: { fallasEquipos: [{ id: 'trip-q1', codigo: 'DISYUNTOR_DISPARADO',
		objetivo: { tipo: 'DISPOSITIVO', dispositivoId: 'q1' } }] } });
	assert.equal(trip.fisica.red.potenciaCargasW, 0); assert.equal(trip.protecciones[0].estado, 'disparado');
});

test('V6 fallas contactor/relé: bobina, no-cierre, soldadura y conflicto son deterministas', () => {
	const km: Dispositivo = { id: 'km1', tipo: 'otro', bornes: ['A1', 'A2', 'L1', 'T1'].map((id) => ({ id })),
		comportamiento: { version: 1, clase: 'contactos-electromagneticos', bobina: { entrada: 'A1', retorno: 'A2' },
			polos: [{ entrada: 'L1', salida: 'T1' }], contactos: [] } };
	const objetivo = { tipo: 'CONTACTO' as const, dispositivoId: 'km1', terminales: ['L1', 'T1'] as [string, string] };
	assert.deepEqual(contactosCerrados(km, {}, true), [['L1', 'T1']]);
	assert.deepEqual(contactosCerrados(km, { fallasEquipos: [{ id: 'nc', codigo: 'CONTACTO_NO_CIERRA', objetivo }] }, true), []);
	assert.deepEqual(contactosCerrados(km, { fallasEquipos: [{ id: 's', codigo: 'CONTACTO_SOLDADO', objetivo }] }, false), [['L1', 'T1']]);
	const conflicto = [{ id: 'a', codigo: 'CONTACTO_NO_CIERRA' as const, objetivo },
		{ id: 'b', codigo: 'CONTACTO_SOLDADO' as const, objetivo }];
	assert.deepEqual(contactosCerrados(km, { fallasEquipos: conflicto }, false), []);
	assert.ok(resolverFallasEquipo(conflicto).diagnosticos.every((d) => d.estado === 'DIAGNOSTICO_INDETERMINADO'));
	assert.equal(resolverFallasEquipo([{ id: 'bob', codigo: 'BOBINA_ABIERTA',
		objetivo: { tipo: 'DISPOSITIVO', dispositivoId: 'km1' } }]).diagnosticos[0].estado, 'APLICADA');
	const circuitoBobina: Proyecto = { formato: 'tablero-studio', version: 1, nombre: 'Bobina abierta', hojas: [],
		gabinete: { ancho: 200, alto: 200, rieles: [], canaletas: [], colocaciones: [] },
		dispositivos: [{ id: 'red', tipo: 'otro', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
			comportamiento: { version: 1, clase: 'fuente', salidas: [
				{ borne: 'L', papel: 'fase', tensionV: 230 }, { borne: 'N', papel: 'retorno', tensionV: 230 },
			] } }, km], conductores: [
			{ id: 'a1', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'km1', borneId: 'A1' } },
			{ id: 'a2', de: { dispositivoId: 'km1', borneId: 'A2' }, a: { dispositivoId: 'red', borneId: 'N' } },
		] };
	assert.equal(simular(circuitoBobina).activos.has('km1'), true);
	assert.equal(simular(circuitoBobina, { km1: { fallasEquipos: [{ id: 'bob', codigo: 'BOBINA_ABIERTA',
		objetivo: { tipo: 'DISPOSITIVO', dispositivoId: 'km1' } }] } }).activos.has('km1'), false);
});

test('V6 fallas motor/VFD/sensor/PLC: normalización conserva familias y más de una falla', () => {
	const efectos = resolverFallasEquipo([
		{ id: 'm-lock', codigo: 'ROTOR_BLOQUEADO', objetivo: { tipo: 'DISPOSITIVO', dispositivoId: 'm1' } },
		{ id: 'v-uv', codigo: 'VFD_UNDERVOLTAGE', objetivo: { tipo: 'DISPOSITIVO', dispositivoId: 'v1' } },
		{ id: 's-open', codigo: 'SENSOR_CIRCUITO_ABIERTO', objetivo: { tipo: 'CANAL', dispositivoId: 's1', borneId: 'OUT' } },
		{ id: 'plc-stop', codigo: 'PLC_STOP', objetivo: { tipo: 'DISPOSITIVO', dispositivoId: 'plc1' } },
		{ id: 'plc-map', codigo: 'PLC_IO_MAPPING', objetivo: { tipo: 'CANAL', dispositivoId: 'plc1', borneId: 'DI1' } },
	]);
	assert.deepEqual(efectos.funcionales.get('m1'), ['motor-bloqueado']);
	assert.deepEqual(efectos.funcionales.get('v1'), ['subtension']);
	assert.deepEqual(efectos.funcionales.get('s1'), ['circuito-analogico-abierto']);
	assert.equal(efectos.parchesEstado.get('plc1')!.fallo, true);
	assert.equal(efectos.diagnosticos.find((d) => d.fallaId === 'plc-map')!.estado, 'NO_MODELADA');
	assert.equal(efectos.diagnosticos.length, 5);
});

test('V6 fallas transformador: secundario abierto elimina acoplamiento y entrega cero', () => {
	const p: Proyecto = { formato: 'tablero-studio', version: 1, nombre: 'Trafo fallo', hojas: [],
		gabinete: { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] },
		dispositivos: [
			{ id: 'red', tipo: 'otro', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
				fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230, referencia: 'N', fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.1 } } },
			{ id: 't1', tipo: 'transformador', bornes: ['P1', 'P2', 'S1', 'S2'].map((id) => ({ id })),
				comportamiento: { version: 1, clase: 'fuente', primario: { entradas: ['P1'], retornos: ['P2'] },
					salidas: [{ borne: 'S1', papel: 'fase', tensionV: 23 }, { borne: 'S2', papel: 'retorno', tensionV: 23 }] },
				fisica: { version: 1, transformador: { primarioV: 230, secundarioV: 23, primarioTerminales: ['P1', 'P2'],
					secundarioTerminales: ['S1', 'S2'], potenciaVA: 230, impedanciaPct: 5 } } },
			{ id: 'z1', tipo: 'resistencia', bornes: [{ id: 'L' }, { id: 'N' }],
				fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 23 } } },
		], conductores: [
			{ id: 'wp1', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 't1', borneId: 'P1' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'wp2', de: { dispositivoId: 't1', borneId: 'P2' }, a: { dispositivoId: 'red', borneId: 'N' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'ws1', de: { dispositivoId: 't1', borneId: 'S1' }, a: { dispositivoId: 'z1', borneId: 'L' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'ws2', de: { dispositivoId: 'z1', borneId: 'N' }, a: { dispositivoId: 't1', borneId: 'S2' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
		] };
	const normal = simularFisicaProyecto(p);
	const efecto = resolverFallasEquipo([{ id: 't-open', codigo: 'SECUNDARIO_ABIERTO',
		objetivo: { tipo: 'TRANSFORMADOR', dispositivoId: 't1' } }]);
	const abierto = simularFisicaProyecto(p, { fallas: efecto.fisicas });
	assert.ok(normal.red.potenciaCargasW > 10); assert.equal(abierto.red.potenciaCargasW, 0);
	assert.equal(abierto.red.transformadores.size, 0);
	assert.ok(magnitud(normal.red.transformadores.get('transformador:t1')!.corrienteSecundariaA) > 0.5);
});
