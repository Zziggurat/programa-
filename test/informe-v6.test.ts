import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureCaidaTensionV5 } from '../ejemplo/fixtures-fisica-v5.js';
import { analizarTecnico } from '../src/diagnostico/analisis.js';
import type { ResultadoDiagnosticoIndustrial } from '../src/diagnostico/motor-causal.js';
import { crearInformeAnalisisV6, informeAnalisisV6AHtml } from '../src/diagnostico/informe.js';
import { simular } from '../src/motores/simulacion.js';

const diagnostico: ResultadoDiagnosticoIndustrial = {
	hallazgos: [
		{ id: 'diag:raiz', codigo: 'CONTACTO_RESISTIVO', equipoId: 'q1', clasificacion: 'ROOT_CAUSE', confianza: 'ALTA',
			estado: 'SOSTENIDA', resumen: 'Resistencia localizada anormal.', evidencias: [
				{ codigo: 'DELTA_V', descripcion: 'Caída localizada.', valor: 2.5, unidad: 'V', origen: 'CALCULADO' },
				{ codigo: 'R_EFECTIVA', descripcion: 'Resistencia ΔV/I.', valor: 0.25, unidad: 'Ω', origen: 'ESTIMADO' },
			] },
		{ id: 'diag:efecto', codigo: 'RIESGO_TERMICO', equipoId: 'q1', clasificacion: 'CONSEQUENCE', confianza: 'MEDIA',
			estado: 'SOSTENIDA', resumen: 'Pérdida localizada.', evidencias: [
				{ codigo: 'LOSS', descripcion: 'I²R.', valor: 25, unidad: 'W', origen: 'CALCULADO' },
			] },
	],
	aristas: [{ causaId: 'diag:raiz', efectoId: 'diag:efecto' }], advertencias: [],
};

test('V6 informe: estructura trazable conserva magnitudes, fallas, causas, evidencia y provenance', () => {
	const proyecto = fixtureCaidaTensionV5();
	const estado = { r1: { fallasFisicas: [{ id: 'cc-r1', tipo: 'L_N' as const, nodoA: 'r1::L', nodoB: 'r1::N' }] } };
	const r = simular(proyecto, estado);
	const analisis = analizarTecnico({ proyecto, fisica: r.fisica, diagnostico, equipoId: 'q1', estadosProteccion: r.protecciones });
	const entrada = { proyecto, fisica: r.fisica, analisis, trazabilidad: { projectId: 'project-42', revision: 7,
		snapshotId: 'snapshot-6', buildId: 'B-V6-TEST', generadoEn: '2026-08-30T12:34:56.000Z' } };
	const antes = structuredClone(proyecto);
	const informe = crearInformeAnalisisV6(entrada);
	assert.equal(informe.formato, 'tablerostudio-informe-analisis');
	assert.deepEqual(informe.trazabilidad, entrada.trazabilidad);
	assert.equal(informe.proyecto.id, 'project-42');
	assert.equal(informe.objetivo.id, 'q1');
	assert.ok(informe.magnitudes.some((m) => m.codigo === 'I_IN'));
	assert.ok(informe.protecciones.some((p) => p.dispositivoId === 'q1'));
	assert.ok(informe.fallasActivas.some((f) => f.id === 'cc-r1'));
	assert.deepEqual(informe.causas, ['diag:raiz']);
	assert.deepEqual(informe.consecuencias, ['diag:efecto']);
	assert.ok(informe.diagnosticos.flatMap((d) => d.evidencias).some((e) => e.codigo === 'R_EFECTIVA'));
	assert.ok(informe.provenance.includes('CALCULADO') && informe.provenance.includes('ESTIMADO'));
	assert.deepEqual(proyecto, antes, 'generar un informe no contamina el diseño persistente');
});

test('V6 informe: misma entrada produce estructura y HTML byte-idénticos', () => {
	const proyecto = fixtureCaidaTensionV5(); const r = simular(proyecto);
	const analisis = analizarTecnico({ proyecto, fisica: r.fisica, diagnostico, equipoId: 'q1' });
	const entrada = { proyecto, fisica: r.fisica, analisis, trazabilidad: { projectId: 'p', revision: 1,
		buildId: 'BUILD-FIJO', generadoEn: '2026-08-30T00:00:00.000Z' } };
	const a = crearInformeAnalisisV6(entrada); const b = crearInformeAnalisisV6(entrada);
	assert.deepEqual(a, b);
	assert.equal(informeAnalisisV6AHtml(a), informeAnalisisV6AHtml(b));
	(a.configuracionRelevante as { fisica?: { version?: number } }).fisica!.version = 999;
	assert.equal(proyecto.dispositivos.find((d) => d.id === 'q1')!.fisica!.version, 1,
		'la configuración del informe es una fotografía separada');
});

test('V6 informe: HTML autocontenido escapa contenido y declara límites no certificados', () => {
	const proyecto = fixtureCaidaTensionV5(); proyecto.nombre = '<script>alert(1)</script>';
	const r = simular(proyecto); const analisis = analizarTecnico({ proyecto, fisica: r.fisica, diagnostico, equipoId: 'q1' });
	const informe = crearInformeAnalisisV6({ proyecto, fisica: r.fisica, analisis,
		trazabilidad: { projectId: 'p&1', snapshotId: 's<2', buildId: 'BUILD-V6', generadoEn: '2026-08-30T00:00:00.000Z' } });
	const html = informeAnalisisV6AHtml(informe);
	assert.match(html, /<!doctype html>/i);
	assert.doesNotMatch(html, /<script>alert/);
	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.match(html, /BUILD-V6/);
	assert.match(html, /DELTA_V.*Caída localizada.*2,5 V.*CALCULADO/s);
	assert.match(html, /No constituyen certificación, conformidad legal ni informe oficial/);
	assert.doesNotMatch(html, /<script\b|https?:\/\//i);
});
