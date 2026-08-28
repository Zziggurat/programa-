import assert from 'node:assert/strict';
import test from 'node:test';
import type { Proyecto } from '../src/modelo/tipos.js';
import { actualizarProteccionesRuntime, memoriaVacia, simular, type EstadoTablero } from '../src/motores/simulacion.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';

function fixture(): Proyecto {
	return {
		formato: 'tablero-studio', version: 1, nombre: 'Fixture V5 — caída de tensión', hojas: [],
		dispositivos: [
			{ id: 'red', tipo: 'otro', descripcion: 'Fuente V5', tensionNominal: 230, bornes: [
				{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' },
			], fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230, frecuenciaHz: 50,
				referencia: 'N', fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.05, xOhm: 0 } } },
			{ id: 'q1', tipo: 'disyuntor', corrienteNominal: 16, curvaDisparo: 'C', bornes: [
				{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' },
			], fisica: { version: 1, proteccion: { inA: 16, curva: 'C' } } },
			{ id: 'r1', tipo: 'resistencia', tensionNominal: 230, bornes: [
				{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' },
			], fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 23 } } },
		],
		conductores: [
			{ id: 'w1', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'q1', borneId: '1' }, seccion: 2.5,
				fisica: { material: 'COBRE', longitudManualM: 20 } },
			{ id: 'w2', de: { dispositivoId: 'q1', borneId: '2' }, a: { dispositivoId: 'r1', borneId: 'L' }, seccion: 2.5,
				fisica: { material: 'COBRE', longitudManualM: 20 } },
			{ id: 'w3', de: { dispositivoId: 'red', borneId: 'N' }, a: { dispositivoId: 'r1', borneId: 'N' }, seccion: 2.5,
				fisica: { material: 'COBRE', longitudManualM: 20 } },
		],
	};
}

test('V5 integrado: la topologia funcional alimenta el mismo solver cuantitativo', () => {
	const r = simular(fixture());
	assert.equal(r.fisica.activo, true);
	assert.equal(r.fisica.red.metricas.convergio, true);
	const carga = r.fisica.red.cargas.get('carga:r1:0')!;
	assert.ok(carga.potenciaVA.re > 2200 && carga.potenciaVA.re < 2300);
	assert.ok(r.fisica.conductores.get('w2')!.corrienteA > 9);
	assert.ok(r.fisica.conductores.get('w2')!.caidaV > 0);
	assert.ok(r.fisica.red.potenciaPerdidasW > 0);
	assert.ok(Math.abs(r.fisica.red.metricas.errorBalanceW) < 0.1);
	assert.equal(r.fisica.protecciones.get('q1')!.evaluacion.region, 'NORMAL');
});

test('V5 integrado: una falla L-N usa el camino real y dispara la proteccion sin doble tiempo', () => {
	const p = fixture();
	const estado: EstadoTablero = { r1: { fallasFisicas: [{ id: 'cc-r1', tipo: 'L_N', nodoA: 'r1::L', nodoB: 'r1::N' }] } };
	const memoria = memoriaVacia();
	const r = simular(p, estado, undefined, { ahora: 1000, memoria });
	const falla = r.fisica.fallas[0];
	// Tres tramos de 20 m limitan deliberadamente la Icc a unos cientos de amperios.
	assert.ok(falla.iccA && Math.hypot(falla.iccA.re, falla.iccA.im) > 100);
	assert.equal(r.fisica.protecciones.get('q1')!.evaluacion.region, 'INSTANTANEA');
	const paso = actualizarProteccionesRuntime(p, estado, r, 1000, memoria);
	assert.equal(paso.estado.q1.disparado, true);
	assert.equal(paso.eventos[0].causa, 'cortocircuito');
	const abierto = simular(p, paso.estado, r.activos, { ahora: 1000, memoria });
	assert.equal(abierto.fisica.protecciones.get('q1')!.corrienteA, 0);
});

test('V5 integrado: abrir conductor y terminal flojo alteran la red resuelta', () => {
	const p = fixture();
	const abierta = simular(p, { r1: { fallasFisicas: [{ id: 'abierto-w2', tipo: 'CONDUCTOR_ABIERTO', ramaId: 'conductor:w2' }] } });
	assert.equal(abierta.fisica.red.ramas.has('conductor:w2'), false);
	assert.ok((abierta.fisica.red.cargas.get('carga:r1:0')?.potenciaVA.re ?? Infinity) < 1e-6);

	const normal = simular(p);
	const flojo = simular(p, { r1: { fallasFisicas: [{ id: 'flojo-w2', tipo: 'RESISTENCIA_ANORMAL',
		ramaId: 'conductor:w2', resistenciaAdicionalOhm: 5 }] } });
	assert.ok(flojo.fisica.conductores.get('w2')!.corrienteA < normal.fisica.conductores.get('w2')!.corrienteA);
	assert.ok(flojo.fisica.red.ramas.get('conductor:w2')!.caidaV.re
		> normal.fisica.red.ramas.get('conductor:w2')!.caidaV.re);
});

test('V5 integrado: un proyecto V4 sin perfiles fisicos no paga solver ni cambia resultados', () => {
	const p = fixture();
	for (const d of p.dispositivos) delete d.fisica;
	for (const c of p.conductores) delete c.fisica;
	const r = simular(p);
	assert.equal(r.fisica.activo, false);
	assert.equal(r.fisica.red.metricas.iteraciones, 0);
});

test('V5 transformador basico: secundario aislado usa relacion y Z porcentual configuradas', () => {
	const p: Proyecto = {
		formato: 'tablero-studio', version: 1, nombre: 'Trafo V5', hojas: [], conductores: [],
		dispositivos: [
			{ id: 't1', tipo: 'transformador', bornes: [{ id: 'S1', tipo: 'L' }, { id: 'S2', tipo: 'N' }],
				comportamiento: { version: 1, clase: 'fuente', salidas: [
					{ borne: 'S1', papel: 'fase', tensionV: 24 }, { borne: 'S2', papel: 'retorno', tensionV: 24 },
				] },
				fisica: { version: 1, transformador: { primarioV: 230, secundarioV: 24, potenciaVA: 240,
					impedanciaPct: 5, xSobreR: 3, frecuenciaHz: 50 } } },
			{ id: 'z1', tipo: 'resistencia', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
				fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 24 } } },
		],
	};
	p.conductores = [
		{ id: 'w1', de: { dispositivoId: 't1', borneId: 'S1' }, a: { dispositivoId: 'z1', borneId: 'L' }, seccion: 2.5,
			fisica: { material: 'COBRE', longitudManualM: 1 } },
		{ id: 'w2', de: { dispositivoId: 'z1', borneId: 'N' }, a: { dispositivoId: 't1', borneId: 'S2' }, seccion: 2.5,
			fisica: { material: 'COBRE', longitudManualM: 1 } },
	];
	const r = simularFisicaProyecto(p);
	assert.equal(r.red.metricas.convergio, true);
	assert.ok((r.red.cargas.get('carga:z1:0')?.tensionV.re ?? 0) > 23);
	assert.equal(r.red.fuentes.get('transformador:t1')?.origenImpedancia, 'CONFIGURADO');
});

test('V5 integrado: un fusible fundido abre la topologia y deja corriente posterior cero', () => {
	const p = fixture();
	const q = p.dispositivos.find((d) => d.id === 'q1')!;
	q.tipo = 'fusible';
	q.comportamiento = { version: 1, clase: 'proteccion', funcion: 'fusible', rearmable: false,
		polos: [{ entrada: '1', salida: '2' }], contactos: [] };
	const sano = simular(p);
	assert.ok(sano.fisica.conductores.get('w2')!.corrienteA > 9);
	const fundido = simular(p, { q1: { disparado: true } });
	assert.ok(fundido.protecciones.some((x) => x.dispositivoId === 'q1' && x.estado === 'fundido'));
	assert.ok(fundido.fisica.conductores.get('w2')!.corrienteA < 1e-9);
});
