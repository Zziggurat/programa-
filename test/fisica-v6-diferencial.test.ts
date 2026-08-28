import assert from 'node:assert/strict';
import test from 'node:test';
import type { Proyecto } from '../src/modelo/tipos.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { actualizarProteccionesRuntime, memoriaVacia, simular, type EstadoTablero } from '../src/motores/simulacion.js';

function fixtureDiferencial(conPe = true): Proyecto {
	const p: Proyecto = {
		formato: 'tablero-studio', version: 1, nombre: 'Fixture V6 — diferencial y fuga PE', hojas: [],
		dispositivos: [
			{ id: 'red', tipo: 'otro', bornes: [
				{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }, { id: 'PE', tipo: 'PE' },
			], fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230,
				frecuenciaHz: 50, referencia: 'N', referenciaPe: conPe ? 'PE' : undefined,
				fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.2, xOhm: 0 } } },
			{ id: 'qf1', tipo: 'diferencial', sensibilidadMA: 30, corrienteNominal: 40,
				bornes: [{ id: '1', tipo: 'L' }, { id: '2', tipo: 'L' }, { id: 'N1', tipo: 'N' }, { id: 'N2', tipo: 'N' }],
				comportamiento: { version: 1, clase: 'proteccion', funcion: 'diferencial', rearmable: true,
					polos: [{ entrada: '1', salida: '2' }, { entrada: 'N1', salida: 'N2' }], contactos: [] },
				fisica: { version: 1, diferencial: { corrienteResidualNominalA: 0.03, retardoS: 0,
					conductoresMedidos: [{ entrada: '1', salida: '2' }, { entrada: 'N1', salida: 'N2' }] } } },
			{ id: 'z1', tipo: 'resistencia', bornes: [
				{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }, { id: 'PE', tipo: 'PE' },
			], fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 230 } } },
		],
		conductores: [
			{ id: 'w-l-in', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'qf1', borneId: '1' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'w-l-out', de: { dispositivoId: 'qf1', borneId: '2' }, a: { dispositivoId: 'z1', borneId: 'L' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'w-n-out', de: { dispositivoId: 'z1', borneId: 'N' }, a: { dispositivoId: 'qf1', borneId: 'N2' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			{ id: 'w-n-in', de: { dispositivoId: 'qf1', borneId: 'N1' }, a: { dispositivoId: 'red', borneId: 'N' }, seccion: 2.5, fisica: { longitudManualM: 1 } },
			...(conPe ? [{ id: 'w-pe', de: { dispositivoId: 'red', borneId: 'PE' }, a: { dispositivoId: 'z1', borneId: 'PE' }, seccion: 2.5, fisica: { longitudManualM: 1 } }] : []),
		],
		gabinete: { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] },
	};
	return p;
}

const fuga = (): EstadoTablero => ({ z1: { fallasFisicas: [{ id: 'fuga-z1', tipo: 'L_PE',
	nodoA: 'z1::L', nodoB: 'z1::PE', zFallaOhm: { re: 1000, im: 0 } }] } });

test('V6 diferencial: la suma fasorial orientada es casi cero en servicio normal', () => {
	const r = simular(fixtureDiferencial());
	const q = r.fisica.protecciones.get('qf1')!;
	assert.equal(q.modeloResidual, 'RESIDUAL_RMS_MODELED');
	assert.equal(q.estadoResidual, 'NORMAL');
	assert.equal(q.corrienteResidualNominalA, 0.03);
	assert.ok((q.corrienteResidualA ?? Infinity) < 1e-6);
});

test('V6 diferencial: fuga L-PE atraviesa solo fase, dispara V2 y re-resuelve sin doble tiempo', () => {
	const p = fixtureDiferencial(); const estado = fuga(); const memoria = memoriaVacia();
	const r = simular(p, estado, undefined, { ahora: 1000, memoria });
	const q = r.fisica.protecciones.get('qf1')!;
	assert.equal(q.estadoResidual, 'ACTUACION');
	assert.ok((q.corrienteResidualA ?? 0) > 0.2);
	const paso = actualizarProteccionesRuntime(p, estado, r, 1000, memoria);
	assert.deepEqual(paso.eventos.map((e) => [e.causa, e.origen]), [['fuga-tierra', 'calculado']]);
	const abierto = simular(p, paso.estado, r.activos, { ahora: 1000, memoria });
	assert.ok((abierto.fisica.protecciones.get('qf1')?.corrienteA ?? Infinity) < 1e-9);
	const repetido = actualizarProteccionesRuntime(p, paso.estado, abierto, 1000, memoria);
	assert.equal(repetido.eventos.length, 0);
	assert.equal(memoria.protecciones?.qf1.cargaTermica, 1);
});

test('V6 diferencial: sin camino PE no se inventa residual ni disparo', () => {
	const p = fixtureDiferencial(false); const estado = fuga(); const memoria = memoriaVacia();
	const r = simular(p, estado, undefined, { ahora: 0, memoria });
	assert.ok((r.fisica.protecciones.get('qf1')?.corrienteResidualA ?? Infinity) < 1e-6);
	assert.equal(actualizarProteccionesRuntime(p, estado, r, 0, memoria).eventos.length, 0);
});

test('V6 diferencial: configuración persiste y el orden de arrays no altera IΔ', () => {
	const p = fixtureDiferencial();
	const cargado = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.equal(cargado.dispositivos.find((d) => d.id === 'qf1')?.fisica?.diferencial?.corrienteResidualNominalA, 0.03);
	const a = simular(p, fuga()).fisica.protecciones.get('qf1')!.corrienteResidualA!;
	p.dispositivos.reverse(); p.conductores.reverse();
	const b = simular(p, fuga()).fisica.protecciones.get('qf1')!.corrienteResidualA!;
	assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
});
