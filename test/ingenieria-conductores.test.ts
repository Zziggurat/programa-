import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCaidaTensionV5 } from '../ejemplo/fixtures-fisica-v5.js';
import { descubrirCircuitos } from '../src/ingenieria/circuitos.js';
import { evaluarAlternativasSeccion, REGLA_CONDUCTORES } from '../src/ingenieria/conductores.js';
import { validarIngenieria } from '../src/ingenieria/validacion.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';

const conexiones = new Map([['q1', [['1', '2']] as const]]);

function configurado() {
	const p = fixtureCaidaTensionV5(); const c = descubrirCircuitos(p).circuitos.find((x) => x.cargas.includes('r1'))!;
	p.ingenieria = { version: 1, circuitos: { [c.id]: { version: 1, nombre: 'Carga larga', tipo: 'ALIMENTACION', criterios: {
		maxVoltageDropPercent: 0.5, maxLossW: 20,
		ampacityProfile: { nombre: 'Tabla de ensayo declarada', fuente: 'Dataset focal Gate C', puntos: [
			{ seccionMm2: 2.5, corrienteMaxA: 20 }, { seccionMm2: 4, corrienteMaxA: 25 }, { seccionMm2: 6, corrienteMaxA: 32 },
		] },
	} } } };
	return { p, c: descubrirCircuitos(p).circuitos.find((x) => x.cargas.includes('r1'))! };
}

test('Gate C usa caídas y pérdidas de PhysicsEngine contra criterios configurados', () => {
	const { p } = configurado(); const circuitos = descubrirCircuitos(p).circuitos;
	const fisica = simularFisicaProyecto(p, { conexionesCerradas: conexiones });
	const r = validarIngenieria({ proyecto: p, circuitos, fisica, reglas: [REGLA_CONDUCTORES] });
	const caidas = r.resultados.filter((x) => x.code === 'TS-CABLE-VOLTAGE-DROP');
	assert.ok(caidas.length >= 2); assert.ok(caidas.some((x) => x.status === 'FAIL'));
	assert.ok(caidas.every((x) => x.criterion?.origen === 'CONFIGURADO'));
	assert.ok(caidas.flatMap((x) => x.evidence).some((e) => e.codigo === 'LONGITUD' && e.origen === 'CONFIGURADO'));
	assert.ok(r.resultados.filter((x) => x.code === 'TS-CABLE-LOSS').every((x) => x.status === 'PASS'));
	assert.ok(r.resultados.filter((x) => x.code === 'TS-CABLE-AMPACITY').every((x) => x.status === 'PASS'));
});

test('Gate C no convierte ausencia de criterio o tabla de ampacidad en PASS ni FAIL', () => {
	const p = fixtureCaidaTensionV5(); const circuitos = descubrirCircuitos(p).circuitos;
	const fisica = simularFisicaProyecto(p, { conexionesCerradas: conexiones });
	const r = validarIngenieria({ proyecto: p, circuitos, fisica, reglas: [REGLA_CONDUCTORES] });
	assert.ok(r.resultados.some((x) => x.code === 'TS-CABLE-VOLTAGE-DROP-CRITERION' && x.status === 'INDETERMINATE'));
	const amp = r.resultados.filter((x) => x.code === 'TS-CABLE-AMPACITY-DATA');
	assert.ok(amp.length > 0 && amp.every((x) => x.status === 'INDETERMINATE' && x.provenance === 'NO_MODELADO'));
});

test('Gate C evalúa 2.5/4/6 mm² sin mutar el proyecto y recomienda solo según criterios modelados', () => {
	const { p, c } = configurado(); const antes = JSON.stringify(p);
	const r = evaluarAlternativasSeccion({ proyecto: p, conductorId: 'w-fase-carga', seccionesMm2: [6, 2.5, 4, 4],
		circuitId: c.id, contextoFisico: { conexionesCerradas: conexiones } });
	assert.equal(JSON.stringify(p), antes); assert.deepEqual(r.alternativas.map((x) => x.seccionMm2), [2.5, 4, 6]);
	const [a, b, d] = r.alternativas;
	assert.ok(a.resistenciaOhm! > b.resistenciaOhm! && b.resistenciaOhm! > d.resistenciaOhm!);
	assert.ok(a.caidaV! > b.caidaV! && b.caidaV! > d.caidaV!);
	assert.ok(a.perdidaW! > b.perdidaW! && b.perdidaW! > d.perdidaW!);
	assert.ok(a.iccA! < b.iccA! && b.iccA! < d.iccA!);
	assert.equal(a.estado, 'FAIL'); assert.equal(b.estado, 'PASS'); assert.equal(r.recomendadaMm2, 4);
	assert.match(r.explicacion, /menor alternativa evaluada/);
});

test('Gate C mantiene la recomendación indeterminada si falta un dato exigido', () => {
	const { p, c } = configurado(); p.ingenieria!.circuitos![c.id].criterios!.maxLossPercent = 2;
	const r = evaluarAlternativasSeccion({ proyecto: p, conductorId: 'w-fase-carga', seccionesMm2: [4, 6],
		circuitId: c.id, contextoFisico: { conexionesCerradas: conexiones } });
	assert.ok(r.alternativas.every((x) => x.estado === 'INDETERMINATE'));
	assert.equal(r.recomendadaMm2, undefined); assert.match(r.explicacion, /Ninguna alternativa puede declararse/);
});

test('Gate C persiste tabla de ampacidad explícita y descarta puntos inválidos', () => {
	const { p, c } = configurado(); const bruto = structuredClone(p) as unknown as Record<string, any>;
	bruto.ingenieria.circuitos[c.id].criterios.ampacityProfile.puntos.push({ seccionMm2: -1, corrienteMaxA: 99 });
	const q = cargarProyecto(JSON.stringify(bruto)).proyecto;
	const perfil = q.ingenieria?.circuitos?.[c.id].criterios?.ampacityProfile;
	assert.equal(perfil?.fuente, 'Dataset focal Gate C'); assert.equal(perfil?.puntos.length, 3);
	assert.deepEqual(perfil?.puntos.map((x) => x.seccionMm2), [2.5, 4, 6]);
});
