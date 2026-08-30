import assert from 'node:assert/strict';
import test from 'node:test';
import type { Proyecto } from '../src/modelo/tipos.js';
import { diagnosticarProyecto, validarGrafoCausal } from '../src/diagnostico/motor-causal.js';
import { resultadoFisicaVacio } from '../src/fisica/topologia-proyecto.js';
import type { ResultadoMotorFisico } from '../src/fisica/motores.js';
import { analizarTrifasico } from '../src/fisica/trifasica.js';
import { polar } from '../src/fisica/complejos.js';

function proyectoDiagnostico(): Proyecto {
	return { formato: 'tablero-studio', version: 1, nombre: 'Diagnóstico V6', hojas: [],
		gabinete: { ancho: 300, alto: 300, rieles: [], canaletas: [], colocaciones: [] },
		dispositivos: [
			{ id: 'm1', tipo: 'motor', bornes: ['U', 'V', 'W', 'PE'].map((id) => ({ id, tipo: id === 'PE' ? 'PE' as const : 'L' as const })),
				fisica: { version: 1, motor: { potenciaMecanicaNominalW: 3000, tensionNominalV: 400, frecuenciaHz: 50,
					fases: 3, eficiencia: 0.9, factorPotencia: 0.85, corrienteNominalA: 6, polos: 4 } } },
			{ id: 'v1', tipo: 'variador', bornes: [], fisica: { version: 1, vfd: { tensionEntradaNominalV: 400,
				fasesEntrada: 3, potenciaNominalW: 4000, eficiencia: 0.95, frecuenciaBaseHz: 50,
				frecuenciaMaxHz: 50, tensionSalidaMaxV: 400, umbralSubtension: 0.85, perfil: 'V_F_LINEAL' } } },
			{ id: 't1', tipo: 'transformador', bornes: [], fisica: { version: 1, transformador: { primarioV: 400,
				secundarioV: 230, potenciaVA: 1000, impedanciaPct: 5 } } },
			{ id: 'q0', tipo: 'diferencial', bornes: [{ id: 'PE', tipo: 'PE' }] },
		],
		conductores: [
			{ id: 'wu', de: { dispositivoId: 'v1', borneId: 'U' }, a: { dispositivoId: 'm1', borneId: 'U' } },
			{ id: 'wv', de: { dispositivoId: 'v1', borneId: 'V' }, a: { dispositivoId: 'm1', borneId: 'V' } },
			{ id: 'ww', de: { dispositivoId: 'v1', borneId: 'W' }, a: { dispositivoId: 'm1', borneId: 'W' } },
			{ id: 'wpe', de: { dispositivoId: 'q0', borneId: 'PE' }, a: { dispositivoId: 'm1', borneId: 'PE' } },
		] };
}

function motorFisico(corrienteA: number, rpm: number, tensionV = 400): ResultadoMotorFisico {
	return { dispositivoId: 'm1', tensionV, corrienteA, potenciaEntradaW: 3000, potenciaReactivaVar: 1000,
		potenciaAparenteVA: 3200, factorPotencia: 0.85, potenciaMecanicaEstimadaW: rpm ? 2700 : 0,
		eficiencia: 0.9, rpm, rpmSincronas: 1500, corrienteNominalCalculadaA: 6, corrienteNominalUsadaA: 6,
		estado: rpm ? 'marcha' as const : 'falla' as const, diagnosticos: [], origen: 'CALCULADO' as const };
}

test('V6 diagnóstico motor: saludable, rotor bloqueado y causas competidoras son explícitos', () => {
	const p = proyectoDiagnostico(); const fisica = resultadoFisicaVacio(); fisica.activo = true;
	fisica.motores.set('m1', motorFisico(6, 1450));
	const sano = diagnosticarProyecto({ proyecto: p, fisica, equipoId: 'm1' });
	assert.equal(sano.hallazgos[0].codigo, 'OPERACION_NORMAL');

	fisica.motores.set('m1', motorFisico(32, 0));
	const bloqueado = diagnosticarProyecto({ proyecto: p, fisica, equipoId: 'm1' });
	const root = bloqueado.hallazgos.find((h) => h.codigo === 'ROTOR_BLOQUEADO')!;
	assert.equal(root.clasificacion, 'ROOT_CAUSE'); assert.equal(root.confianza, 'ALTA');
	assert.ok(root.evidencias.some((e) => e.codigo === 'I_SOBRE_IN'));
	assert.equal(bloqueado.hallazgos.find((h) => h.codigo === 'FALTA_ALIMENTACION')!.estado, 'DESCARTADA');
	assert.ok(bloqueado.aristas.some((a) => a.causaId === root.id));

	fisica.motores.set('m1', motorFisico(0, 0, 0));
	const ambiguo = diagnosticarProyecto({ proyecto: p, fisica, equipoId: 'm1' });
	assert.equal(ambiguo.hallazgos.filter((h) => h.estado === 'INDETERMINADA').length, 2);
	assert.ok(ambiguo.hallazgos.every((h) => h.confianza !== 'CONFIRMADO'));
});

test('V6 diagnóstico contacto resistivo: infiere desde ΔV/I/pérdida y no lee ground truth', () => {
	const p = proyectoDiagnostico(); const fisica = resultadoFisicaVacio(); fisica.activo = true;
	fisica.contactos.set('interno:km1:1', { ramaId: 'interno:km1:1', dispositivoId: 'km1', terminales: ['L2', 'T2'],
		corrienteA: 8, caidaV: 4, resistenciaEfectivaOhm: 0.5, perdidaW: 32, origen: 'INYECTADO' });
	fisica.trifasicos.set('red', analizarTrifasico('red', [polar(230, 0), polar(210, -2), polar(230, 2)],
		[polar(8, 0), polar(3, -2), polar(8, 2)], 10));
	const a = diagnosticarProyecto({ proyecto: p, fisica });
	const root = a.hallazgos.find((h) => h.codigo === 'CONTACTO_RESISTIVO')!;
	assert.equal(root.confianza, 'CONFIRMADO');
	assert.deepEqual(root.evidencias.map((e) => e.codigo), ['CONTACTO_CERRADO', 'DELTA_V', 'PERDIDA_LOCAL', 'R_EFECTIVA']);
	assert.ok(a.hallazgos.some((h) => h.codigo === 'CAIDA_TENSION' && h.clasificacion === 'CONSEQUENCE'));
	assert.ok(a.hallazgos.some((h) => h.codigo === 'RIESGO_TERMICO' && h.clasificacion === 'SECONDARY_EFFECT'));
	assert.ok(a.hallazgos.some((h) => h.codigo === 'DESEQUILIBRIO' && h.equipoId === 'km1'));
	assert.ok(a.aristas.some((e) => e.causaId === root.id && e.efectoId.includes('unbalance')));
	/* Cambiar la etiqueta de falla inyectada no entra al contexto del motor causal y no cambia nada. */
	fisica.fallas.push({ id: 'ground-truth-distinto', tipo: 'L_N', origen: 'INYECTADO', diagnosticos: [] });
	assert.deepEqual(diagnosticarProyecto({ proyecto: p, fisica }), a);
});

test('V6 diagnóstico pérdida de fase: localiza rama ausente o conserva hipótesis honesta', () => {
	const p = proyectoDiagnostico(); const fisica = resultadoFisicaVacio(); fisica.activo = true;
	const m = motorFisico(8, 0); m.diagnosticos.push({ codigo: 'PERDIDA_FASE', mensaje: '2/3 fases', origen: 'CALCULADO' });
	fisica.motores.set('m1', m);
	const r = diagnosticarProyecto({ proyecto: p, fisica, motores: [{ dispositivoId: 'm1', estado: 'falla', alimentado: false,
		fasesPresentes: 2, fasesRequeridas: 3, velocidadActual: 0, rpmEstimada: 0, corrienteNominalA: 6 }] });
	const root = r.hallazgos.find((h) => h.codigo === 'CONDUCTOR_ABIERTO_PROBABLE')!;
	assert.equal(root.confianza, 'ALTA'); assert.ok(root.evidencias.some((e) => e.codigo === 'RAMA_AUSENTE'));
});

test('V6 diagnóstico RCD/VFD/transformador: magnitudes y umbrales sostienen las conclusiones', () => {
	const p = proyectoDiagnostico(); const fisica = resultadoFisicaVacio(); fisica.activo = true;
	fisica.variadores.set('v1', { dispositivoId: 'v1', tensionEntradaV: 300, corrienteEntradaA: 0,
		potenciaEntradaW: 0, tensionSalidaV: 0, corrienteSalidaA: 0, potenciaSalidaW: 0, perdidasW: 0,
		frecuenciaSalidaHz: 0, estado: 'falla', diagnosticos: [], origen: 'CALCULADO' });
	fisica.red.transformadores.set('transformador:t1', { id: 'transformador:t1', tensionPrimariaV: { re: 400, im: 0 },
		tensionSecundariaV: { re: 190, im: 0 }, corrientePrimariaA: { re: 4, im: 0 }, corrienteSecundariaA: { re: 7, im: 0 },
		potenciaEntradaVA: { re: 1200, im: 0 }, potenciaSalidaVA: { re: 1150, im: 0 }, perdidaCobreW: 50,
		eficiencia: 0.958, regulacionPct: 17, cargaPct: 120, origen: 'CALCULADO' });
	fisica.protecciones.set('q0', { dispositivoId: 'q0', corrienteA: 8, inA: 16,
		evaluacion: { region: 'NORMAL', multiploIn: 0.5, origen: 'ESTIMADO', explicacion: 'normal' },
		corrienteResidualA: 0.12, corrienteResidualNominalA: 0.03, estadoResidual: 'ACTUACION', fallas: [] });
	fisica.conductores.set('wpe', { conductorId: 'wpe', material: 'COBRE', seccionMm2: 2.5, longitudM: 1,
		temperaturaC: 20, r20Ohm: 0.01, rOhm: 0.01, xOhm: 0, zOhm: { re: 0.01, im: 0 },
		origenLongitud: 'CONFIGURADO', origenSeccion: 'CONFIGURADO', origenReactancia: 'NO_MODELADO',
		corrienteA: 0.12, caidaV: 0.0012, caidaPct: 0.001, perdidaW: 0.000144 });
	const r = diagnosticarProyecto({ proyecto: p, fisica });
	assert.ok(r.hallazgos.find((h) => h.codigo === 'VFD_SUBTENSION_ENTRADA')!.evidencias.some((e) => e.codigo === 'V_THRESHOLD'));
	assert.equal(r.hallazgos.find((h) => h.codigo === 'TRANSFORMADOR_SOBRECARGADO')!.confianza, 'ALTA');
	assert.equal(r.hallazgos.find((h) => h.codigo === 'FUGA_TIERRA_PROBABLE')!.confianza, 'ALTA');
	assert.ok(r.hallazgos.find((h) => h.codigo === 'FUGA_TIERRA_PROBABLE')!.evidencias.some((e) => e.codigo === 'I_PE'));
});

test('V6 diagnóstico: salida y grafo son deterministas y los ciclos se rechazan', () => {
	const p = proyectoDiagnostico(); const fisica = resultadoFisicaVacio(); fisica.motores.set('m1', motorFisico(32, 0));
	const a = diagnosticarProyecto({ proyecto: p, fisica }); const b = diagnosticarProyecto({ proyecto: structuredClone(p), fisica });
	assert.deepEqual(a, b); assert.deepEqual(a.advertencias, []);
	assert.deepEqual(validarGrafoCausal([{ causaId: 'a', efectoId: 'b' }, { causaId: 'b', efectoId: 'a' }]), ['CICLO_CAUSAL:a']);
});
