import assert from 'node:assert/strict';
import test from 'node:test';
import type { Proyecto } from '../src/modelo/tipos.js';
import type { TipoFalloRuntime } from '../src/motores/fallos-runtime.js';
import { memoriaVacia, simular } from '../src/motores/simulacion.js';
import { tensionSalidaVfd, validarVfdFisico } from '../src/fisica/variadores.js';

function fixtureVfd(importado = false): Proyecto {
	return {
		formato: 'tablero-studio', version: 1, nombre: 'Fixture V6 — VFD y motor', hojas: [],
		gabinete: { ancho: 500, alto: 400, rieles: [], canaletas: [], colocaciones: [] },
		dispositivos: [
			{ id: 'red', tipo: 'otro', campo: true, tensionNominal: 230,
				bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
				comportamiento: { version: 1, clase: 'fuente', salidas: [
					{ borne: 'L', papel: 'fase', tensionV: 230 }, { borne: 'N', papel: 'retorno', tensionV: 230 },
				] },
				fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230, referencia: 'N',
					fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.05, xOhm: 0 } } },
			{ id: 'vfd', tipo: importado ? 'otro' : 'variador', imagen: importado ? 'asset://vfd-v6' : undefined,
				bornes: ['L', 'N', 'RUN', 'AI', 'COM', 'U', 'V', 'W'].map((id) => ({ id, tipo: id === 'N' ? 'N' as const : 'L' as const })),
				comportamiento: { version: 1, clase: 'variador',
					alimentacion: { fases: ['L'], retornos: ['N'], fasesMinimas: 1 }, mando: { run: 'RUN' },
					referencia: { borne: 'AI', comun: 'COM', unidad: 'V', rango: [0, 10] },
					salida: { u: 'U', v: 'V', w: 'W', tensionV: 400 },
					frecuencia: { minimaHz: 0, maximaHz: 50, rampaHzS: 10 } },
				fisica: { version: 1, vfd: { tensionEntradaNominalV: 230, fasesEntrada: 1,
					potenciaNominalW: 4000, eficiencia: 0.95, frecuenciaBaseHz: 50, frecuenciaMaxHz: 50,
					tensionSalidaMaxV: 400, limiteCorrienteA: 12, umbralSubtension: 0.85,
					rSalidaOhm: 0.02, perfil: 'V_F_LINEAL' } } },
			{ id: 'm1', tipo: importado ? 'otro' : 'motor', imagen: importado ? 'asset://motor-v6' : undefined,
				tensionNominal: 400, bornes: ['U1', 'V1', 'W1'].map((id) => ({ id, tipo: 'L' as const })),
				comportamiento: { version: 1, clase: 'carga', efecto: 'giro',
					alimentacion: { fases: ['U1', 'V1', 'W1'], retornos: [], fasesMinimas: 3 },
					dinamicaMotor: { polos: 4, tiempoArranqueS: 1, tiempoParadaS: 1 } },
				fisica: { version: 1, motor: { potenciaMecanicaNominalW: 3000, tensionNominalV: 400,
					frecuenciaHz: 50, fases: 3, eficiencia: 0.9, factorPotencia: 0.85, rpmNominal: 1450,
					polos: 4, corrienteArranqueMultiplo: 6, tiempoArranqueS: 1 } } },
		],
		conductores: [
			{ id: 'wi-l', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'vfd', borneId: 'L' }, seccion: 4, fisica: { longitudManualM: 2 } },
			{ id: 'wi-n', de: { dispositivoId: 'vfd', borneId: 'N' }, a: { dispositivoId: 'red', borneId: 'N' }, seccion: 4, fisica: { longitudManualM: 2 } },
			{ id: 'run', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'vfd', borneId: 'RUN' }, seccion: 1, fisica: { longitudManualM: 1 } },
			{ id: 'wo-u', de: { dispositivoId: 'vfd', borneId: 'U' }, a: { dispositivoId: 'm1', borneId: 'U1' }, seccion: 2.5, fisica: { longitudManualM: 5 } },
			{ id: 'wo-v', de: { dispositivoId: 'vfd', borneId: 'V' }, a: { dispositivoId: 'm1', borneId: 'V1' }, seccion: 2.5, fisica: { longitudManualM: 5 } },
			{ id: 'wo-w', de: { dispositivoId: 'vfd', borneId: 'W' }, a: { dispositivoId: 'm1', borneId: 'W1' }, seccion: 2.5, fisica: { longitudManualM: 5 } },
		],
	};
}

test('V6 VFD: V/f lineal, saturación y validación son explícitas', () => {
	const c = fixtureVfd().dispositivos.find((d) => d.id === 'vfd')!.fisica!.vfd!;
	assert.equal(tensionSalidaVfd(c, 10), 80);
	assert.equal(tensionSalidaVfd(c, 25), 200);
	assert.equal(tensionSalidaVfd(c, 50), 400);
	assert.equal(tensionSalidaVfd(c, 60), 400);
	assert.equal(validarVfdFisico(c).length, 0);
	assert.ok(validarVfdFisico({ ...c, eficiencia: 1.2 }).some((d) => d.codigo === 'VFD_CONFIG_INVALIDA'));
});

test('V6 VFD: RUN entrega red 3~, alimenta motor y conserva balance energético estimado', () => {
	const p = fixtureVfd(); const memoria = memoriaVacia(); const estado = { vfd: { valor: 10 } };
	const r0 = simular(p, estado, undefined, { ahora: 0, memoria });
	const r = simular(p, estado, r0.activos, { ahora: 5000, memoria }); const v = r.fisica.variadores.get('vfd')!;
	assert.equal(r.variadores[0].frecuenciaHz, 50, JSON.stringify({ runtime: r.variadores[0], fisica: v }));
	assert.ok(v.tensionSalidaV > 399 && v.tensionSalidaV <= 400);
	assert.ok(v.corrienteSalidaA > 5 && v.corrienteSalidaA < 12);
	assert.ok(v.potenciaEntradaW >= v.potenciaSalidaW);
	assert.ok(v.perdidasW >= 0);
	assert.ok((v.eficiencia ?? 0) > 0.85 && (v.eficiencia ?? 2) <= 1);
	assert.ok(Math.abs(r.fisica.red.metricas.errorBalanceW) < 0.5);
	assert.equal(r.fisica.motores.get('m1')!.rpm, 1450);
});

test('V6 VFD: 25 Hz reduce tensión, potencia y velocidad respecto de 50 Hz', () => {
	const ejecutar = (valor: number) => {
		const p = fixtureVfd(); const memoria = memoriaVacia();
		const a = simular(p, { vfd: { valor } }, undefined, { ahora: 0, memoria });
		return simular(p, { vfd: { valor } }, a.activos, { ahora: 5000, memoria });
	};
	const mitad = ejecutar(5); const plena = ejecutar(10);
	assert.equal(mitad.fisica.variadores.get('vfd')!.tensionSalidaV, 200);
	assert.ok(mitad.fisica.variadores.get('vfd')!.potenciaSalidaW < plena.fisica.variadores.get('vfd')!.potenciaSalidaW);
	assert.ok(mitad.motores[0].rpmEstimada! < plena.motores[0].rpmEstimada!);
});

test('V6 VFD: rotor bloqueado provoca overcurrent físico, FAULT enclavado y salida despejada', () => {
	const p = fixtureVfd(); const memoria = memoriaVacia();
	let r = simular(p, { vfd: { valor: 10 } }, undefined, { ahora: 0, memoria });
	r = simular(p, { vfd: { valor: 10 }, m1: { fallos: ['motor-bloqueado'] as TipoFalloRuntime[] } }, r.activos,
		{ ahora: 1000, memoria });
	assert.equal(r.variadores[0].estado, 'falla', JSON.stringify({ runtime: r.variadores[0],
		motor: r.motores[0], fisica: r.fisica.variadores.get('vfd'), motorFisico: r.fisica.motores.get('m1') }));
	assert.equal(r.variadores[0].motivoFalla, 'sobrecarga');
	assert.ok(r.fisica.variadores.get('vfd')!.diagnosticos.some((d) => d.codigo === 'VFD_OVERCURRENT'));
	assert.equal(r.fisica.variadores.get('vfd')!.potenciaSalidaW, 0);
	assert.equal(memoria.variadores?.vfd.falloEnclavado, true);
});

test('V6 VFD: subtensión de red real provoca FAULT y un perfil importado es equivalente', () => {
	const ejecutar = (importado: boolean) => {
		const p = fixtureVfd(importado); p.dispositivos.find((d) => d.id === 'red')!.fisica!.fuente!.tensionNominalV = 150;
		const memoria = memoriaVacia(); const a = simular(p, { vfd: { valor: 10 } }, undefined, { ahora: 0, memoria });
		return simular(p, { vfd: { valor: 10 } }, a.activos, { ahora: 5000, memoria });
	};
	const a = ejecutar(false); const b = ejecutar(true);
	assert.equal(a.variadores[0].motivoFalla, 'subtension');
	assert.ok(a.fisica.variadores.get('vfd')!.diagnosticos.some((d) => d.codigo === 'VFD_UNDERVOLTAGE'));
	assert.deepEqual({ estado: a.variadores[0].estado, motivo: a.variadores[0].motivoFalla },
		{ estado: b.variadores[0].estado, motivo: b.variadores[0].motivoFalla });
});
