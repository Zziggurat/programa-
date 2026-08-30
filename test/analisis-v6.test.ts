import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCaidaTensionV5 } from '../ejemplo/fixtures-fisica-v5.js';
import { analizarTecnico } from '../src/diagnostico/analisis.js';
import type { ResultadoDiagnosticoIndustrial } from '../src/diagnostico/motor-causal.js';
import { resultadoFisicaVacio } from '../src/fisica/topologia-proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { simular } from '../src/motores/simulacion.js';

const sinDiagnosticos: ResultadoDiagnosticoIndustrial = { hallazgos: [], aristas: [], advertencias: [] };

test('V6 analisis: protección identifica fuente, upstream/downstream, curva, thermal y hotspots', () => {
	const proyecto = fixtureCaidaTensionV5(); const r = simular(proyecto);
	const a = analizarTecnico({ proyecto, fisica: r.fisica, diagnostico: r.diagnosticoIndustrial,
		equipoId: 'q1', estadosProteccion: r.protecciones });
	assert.equal(a.tipo, 'PROTECCION');
	assert.equal(a.estado, 'CERRADO');
	assert.equal(a.topologia.orientacion, 'INEQUIVOCA');
	assert.equal(a.topologia.fuenteId, 'red');
	assert.deepEqual(a.topologia.aguasArriba, ['red']);
	assert.deepEqual(a.topologia.aguasAbajo, ['r1']);
	assert.deepEqual(a.topologia.trayecto, ['red', 'q1', 'r1']);
	assert.ok(a.magnitudes.some((m) => m.codigo === 'I_IN' && m.valor! > 0.6));
	assert.ok(a.magnitudes.some((m) => m.codigo === 'THERMAL' && m.origen === 'ESTIMADO'));
	assert.ok(a.hotspots.every((h) => h.clasificacion === 'PERDIDA_ELEVADA' && !/temperatura real/i.test(h.detalle)));

	const invertido = { ...proyecto, dispositivos: [...proyecto.dispositivos].reverse(),
		conductores: [...proyecto.conductores].reverse() };
	const b = analizarTecnico({ proyecto: invertido, fisica: r.fisica, diagnostico: r.diagnosticoIndustrial,
		equipoId: 'q1', estadosProteccion: r.protecciones });
	assert.deepEqual(b, a);
});

test('V6 analisis: múltiples fuentes alcanzables dejan orientación indeterminada', () => {
	const proyecto = fixtureCaidaTensionV5(); const r = simular(proyecto);
	(r.fisica.medicion.ramas as Map<string, { id: string; de: string; a: string; zOhm: { re: number; im: number }; tipo: 'OTRO'; origen: 'CONFIGURADO' }>).set('par-link', {
		id: 'par-link', de: 'paralela::L', a: 'red::L', zOhm: { re: 0.01, im: 0 }, tipo: 'OTRO', origen: 'CONFIGURADO',
	});
	(r.fisica.medicion.fuentes as { id: string; de: string; a: string; modo: 'AC'; frecuenciaHz: number }[]).push({
		id: 'fuente:paralela:0', de: 'paralela::L', a: 'red::N', modo: 'AC', frecuenciaHz: 50,
	});
	const a = analizarTecnico({ proyecto, fisica: r.fisica, diagnostico: r.diagnosticoIndustrial, equipoId: 'q1' });
	assert.equal(a.topologia.orientacion, 'INDETERMINADA');
	assert.match(a.topologia.explicacion, /2 fuentes/);
});

function proyectoEquipos(): Proyecto {
	return {
		formato: 'tablero-studio', version: 1, nombre: 'Análisis equipos', hojas: [], conductores: [],
		dispositivos: [
			{ id: 'm1', tipo: 'motor', bornes: [], fisica: { version: 1, motor: { potenciaMecanicaNominalW: 3000,
				tensionNominalV: 400, frecuenciaHz: 50, fases: 3, eficiencia: 0.9, factorPotencia: 0.85, polos: 4 } } },
			{ id: 'v1', tipo: 'variador', bornes: [], fisica: { version: 1, vfd: { tensionEntradaNominalV: 400,
				fasesEntrada: 3, potenciaNominalW: 4000, eficiencia: 0.96, frecuenciaBaseHz: 50, frecuenciaMaxHz: 60,
				tensionSalidaMaxV: 400, perfil: 'V_F_LINEAL' } } },
			{ id: 't1', tipo: 'transformador', bornes: [], fisica: { version: 1, transformador: { primarioV: 400,
				secundarioV: 230, potenciaVA: 5000, impedanciaPct: 5 } } },
		],
	};
}

test('V6 analisis: motor, VFD y transformador publican sus contratos técnicos y provenance', () => {
	const proyecto = proyectoEquipos(); const fisica = resultadoFisicaVacio(); fisica.activo = true;
	fisica.motores.set('m1', { dispositivoId: 'm1', tensionV: 398, corrienteA: 6.2, potenciaEntradaW: 3500,
		potenciaReactivaVar: 2100, potenciaAparenteVA: 4081.7, factorPotencia: 0.8575,
		potenciaMecanicaEstimadaW: 3000, eficiencia: 0.9, rpm: 1450, rpmSincronas: 1500, deslizamiento: 1 / 30,
		corrienteNominalCalculadaA: 5.66, corrienteNominalUsadaA: 5.66, estado: 'marcha', diagnosticos: [], origen: 'ESTIMADO' });
	fisica.variadores.set('v1', { dispositivoId: 'v1', tensionEntradaV: 399, corrienteEntradaA: 7, potenciaEntradaW: 3800,
		tensionSalidaV: 320, corrienteSalidaA: 7.5, potenciaSalidaW: 3600, perdidasW: 200, eficiencia: 3600 / 3800,
		frecuenciaSalidaHz: 40, estado: 'marcha', diagnosticos: [], origen: 'ESTIMADO' });
	fisica.red.transformadores.set('transformador:t1', { id: 'transformador:t1', tensionPrimariaV: { re: 400, im: 0 },
		tensionSecundariaV: { re: 225, im: 0 }, corrientePrimariaA: { re: 8, im: -2 }, corrienteSecundariaA: { re: 13.5, im: -3.2 },
		potenciaEntradaVA: { re: 3200, im: 800 }, potenciaSalidaVA: { re: 3037.5, im: 720 }, perdidaCobreW: 162.5,
		eficiencia: 0.949, regulacionPct: 2.2, cargaPct: 62, origen: 'CALCULADO' });
	const diagnostico: ResultadoDiagnosticoIndustrial = { hallazgos: [{ id: 'h1', codigo: 'ROTOR_BLOQUEADO', equipoId: 'm1',
		clasificacion: 'ROOT_CAUSE', confianza: 'ALTA', estado: 'SOSTENIDA', resumen: 'Síntoma sustentado.', evidencias: [
			{ codigo: 'I', descripcion: 'Corriente observada.', valor: 6.2, unidad: 'A', origen: 'CALCULADO' },
		] }], aristas: [], advertencias: [] };

	const motor = analizarTecnico({ proyecto, fisica, diagnostico, equipoId: 'm1' });
	assert.equal(motor.tipo, 'MOTOR');
	assert.equal(motor.estado, 'MARCHA');
	assert.ok(['V', 'I', 'P', 'Q', 'S', 'PF', 'ETA', 'RPM', 'SLIP'].every((c) => motor.magnitudes.some((m) => m.codigo === c)));
	assert.equal(motor.diagnosticos[0].evidencias[0].valor, 6.2);
	assert.match(motor.resumen, /causa.*raíz/i);

	const vfd = analizarTecnico({ proyecto, fisica, diagnostico: sinDiagnosticos, equipoId: 'v1' });
	assert.equal(vfd.tipo, 'VFD');
	assert.ok(['VIN', 'IIN', 'PIN', 'VOUT', 'IOUT', 'FOUT', 'POUT', 'ETA', 'LOSS'].every((c) => vfd.magnitudes.some((m) => m.codigo === c)));

	const trafo = analizarTecnico({ proyecto, fisica, diagnostico: sinDiagnosticos, equipoId: 't1' });
	assert.equal(trafo.tipo, 'TRANSFORMADOR');
	assert.ok(['VP', 'IP', 'PP', 'QP', 'SP', 'VS', 'IS', 'PS', 'QS', 'SS', 'RATIO', 'Z_PCT', 'REG', 'LOSS', 'LOAD']
		.every((c) => trafo.magnitudes.some((m) => m.codigo === c)));
	assert.equal(trafo.magnitudes.find((m) => m.codigo === 'Z_PCT')?.origen, 'CONFIGURADO');
});

test('V6 analisis: circuito resume balance y no inventa orientación global', () => {
	const proyecto = fixtureCaidaTensionV5(); const r = simular(proyecto);
	const a = analizarTecnico({ proyecto, fisica: r.fisica, diagnostico: r.diagnosticoIndustrial });
	assert.equal(a.tipo, 'CIRCUITO');
	assert.equal(a.estado, 'RED_RESUELTA');
	assert.equal(a.topologia.orientacion, 'INDETERMINADA');
	assert.ok(['P_FUENTES', 'P_CARGAS', 'P_PERDIDAS', 'BALANCE'].every((c) => a.magnitudes.some((m) => m.codigo === c)));
	assert.ok(Math.abs(a.magnitudes.find((m) => m.codigo === 'BALANCE')!.valor!) < 0.5);
});
