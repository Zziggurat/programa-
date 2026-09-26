import assert from 'node:assert/strict';
import test from 'node:test';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { asignarPlanesAutomaticos, prepararAsignacionPlanesAutomaticos } from '../app/escena3d.js';
import { resolverLongitudConductor } from '../src/fisica/conductores.js';
import { simularFisicaProyecto } from '../src/fisica/topologia-proyecto.js';
import { resistenciaCaminoAnalogico } from '../src/fisica/analogicas.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import { contextoEstaticoIngenieria } from '../src/ingenieria/contexto-estatico.js';
import { cargarProyecto, ArchivoInvalido } from '../src/modelo/cargar.js';
import { longitudPlanRutaAutomaticaMm } from '../src/modelo/plan-ruta-automatica.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { simular } from '../src/motores/simulacion.js';
import { revisarTablero } from '../src/motores/revision.js';

test('CAB-27: V9 conserva prioridad declarada y solo una decisión explícita adopta XYZ', () => {
	const p = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	p.version = 4;
	assert.equal(asignarPlanesAutomaticos(p, prepararAsignacionPlanesAutomaticos(p, new Set(['w4']))), 1);
	const c = p.conductores.find((x) => x.id === 'w4')!;
	const xyz = longitudPlanRutaAutomaticaMm(c.planRutaAutomatica!);
	c.fisica = { longitudManualM: 3.2 };
	const legacy = revisarTablero(p);
	assert.equal(legacy.resumen.longitudCableMm,
		legacy.ruteo.rutas.filter((r) => r.conductorId !== c.id)
			.reduce((total, r) => total + r.longitudMm, 0),
		'la suma de metros 2D no incorpora el plan XYZ concurrente');
	assert.equal(legacy.longitudesElectricasMm.get(c.id),
		legacy.ruteo.rutas.find((r) => r.conductorId === c.id)!.longitudMm,
		'ausencia de selector conserva incluso el cálculo DRC previo del router 2D');
	c.fisica.politicaLongitudElectrica = 'RUTA_XYZ';
	assert.equal(revisarTablero(p).longitudesElectricasMm.get(c.id), xyz);
	c.fisica.politicaLongitudElectrica = 'DECLARADA';
	assert.equal(revisarTablero(p).longitudesElectricasMm.get(c.id), 3200);
	delete c.fisica.longitudManualM;
	assert.equal(revisarTablero(p).longitudesElectricasMm.has(c.id), false,
		'una elección declarada sin dato no vuelve silenciosamente al router legacy');
	c.fisica.politicaLongitudElectrica = 'RUTA_XYZ';
	const cargado = cargarProyecto(JSON.stringify(p)).proyecto;
	assert.equal(revisarTablero(cargado).longitudesElectricasMm.get(c.id), xyz);
	const invertido = structuredClone(cargado);
	invertido.conductores.reverse(); invertido.dispositivos.reverse();
	assert.equal(revisarTablero(invertido).longitudesElectricasMm.get(c.id), xyz);
	c.estadoRutaFisica = 'pendiente';
	assert.equal(revisarTablero(p).longitudesElectricasMm.has(c.id), false,
		'un plan pendiente no aporta una longitud eléctrica activa');
	const hostil = structuredClone(cargado);
	hostil.conductores.find((x) => x.id === c.id)!.fisica!.politicaLongitudElectrica =
		'INVENTADA' as 'RUTA_XYZ';
	assert.throws(() => cargarProyecto(JSON.stringify(hostil)), ArchivoInvalido,
		'una política desconocida no se degrada a la compatibilidad anterior');
});

test('CAB-27: PhysicsEngine y Energizar comparten longitud y procedencia seleccionadas', () => {
	const p = crearProyecto('Ensayo de longitud');
	p.dispositivos = [
		{ id: 'red', tipo: 'otro', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
			fisica: { version: 1, fuente: { sistema: 'AC_MONOFASICA', tensionNominalV: 230,
				frecuenciaHz: 50, referencia: 'N', fases: [{ borne: 'L', fase: 'L' }], rOhm: 0.05 } } },
		{ id: 'r1', tipo: 'resistencia', bornes: [{ id: 'L', tipo: 'L' }, { id: 'N', tipo: 'N' }],
			fisica: { version: 1, carga: { modelo: 'CONSTANT_Z', terminales: ['L', 'N'], rOhm: 23 } } },
	];
	p.conductores = [
		{ id: 'w1', de: { dispositivoId: 'red', borneId: 'L' }, a: { dispositivoId: 'r1', borneId: 'L' },
			seccion: 2.5, fisica: { material: 'COBRE', longitudManualM: 20,
				politicaLongitudElectrica: 'RUTA_XYZ' },
			rutaFisica: { version: 1, modo: 'MANUAL', marco: 'PLACA', geometria: 'POLILINEA',
				nodos: [{ id: 'n1', x: 100, y: 100, z: 30 }] } },
		{ id: 'w2', de: { dispositivoId: 'r1', borneId: 'N' }, a: { dispositivoId: 'red', borneId: 'N' },
			seccion: 2.5, fisica: { material: 'COBRE', longitudManualM: 1 } },
	];
	const medida = new Map([['w1', 50_000]]);
	assert.equal(revisarTablero(p, { longitudesMm: new Map([['w1', 1000]]),
		referenciasManualesMm: medida }).longitudesElectricasMm.get('w1'), 50_000,
		'el DRC no toma el largo 2D concurrente cuando la política es XYZ');
	const fisica = simularFisicaProyecto(p, { referenciasManualesMm: medida });
	assert.equal(fisica.conductores.get('w1')?.longitudM, 50);
	assert.equal(fisica.conductores.get('w1')?.origenLongitud, 'ESTIMADO');
	assert.equal(ejecutarIngenieria({ proyecto: p,
		contextoFisico: contextoEstaticoIngenieria(p, medida) }).fisica.conductores.get('w1')?.longitudM, 50,
		'el informe estático no usa otra longitud que la simulación');
	assert.equal(simular(p, {}, undefined, undefined, medida).fisica.conductores.get('w1')?.longitudM, 50);
	assert.equal(simularFisicaProyecto(p).conductores.has('w1'), false,
		'sin medición M6 del snapshot no se usa la longitud declarada ni una recta 2D');
	assert.equal(resistenciaCaminoAnalogico(p, 'red::L', 'r1::L').ohm, undefined);
	assert.ok((resistenciaCaminoAnalogico(p, 'red::L', 'r1::L', medida).ohm ?? 0) > 0,
		'la comprobación analógica comparte la referencia adoptada, sin usar metros declarados inactivos');
	const editada = new Map([['w1', 25_000]]);
	assert.equal(revisarTablero(p, { referenciasManualesMm: editada }).longitudesElectricasMm.get('w1'), 25_000);
	assert.equal(simular(p, {}, undefined, undefined, editada).fisica.conductores.get('w1')?.longitudM, 25,
		'la edición aceptada actualiza el cálculo sin tocar la longitud declarada');
	const inyectada = simularFisicaProyecto(p, { referenciasManualesMm: medida,
		longitudesM: new Map([['w1', { metros: 42, origen: 'INYECTADO' as const }]]) });
	assert.equal(inyectada.conductores.get('w1')?.longitudM, 42,
		'un ensayo de runtime se identifica como inyectado y prevalece solo en esa sesión');
	p.conductores[0].fisica!.politicaLongitudElectrica = 'DECLARADA';
	assert.equal(simularFisicaProyecto(p, { referenciasManualesMm: medida }).conductores.get('w1')?.longitudM, 20);
	delete p.conductores[0].fisica!.politicaLongitudElectrica;
	assert.equal(simularFisicaProyecto(p, { referenciasManualesMm: medida }).conductores.get('w1')?.longitudM, 20,
		'proyectos antiguos conservan el contrato previo');
	p.conductores[0].estadoRutaFisica = 'pendiente';
	assert.equal(resistenciaCaminoAnalogico(p, 'red::L', 'r1::L', medida).ohm, undefined,
		'una conexión pendiente tampoco cierra un camino analógico por tener metros declarados');
});

test('CAB-27: fuente explícita ausente permanece NO_MODELADO y no toma estimación de respaldo', () => {
	assert.deepEqual(resolverLongitudConductor({ longitudManualM: 8,
		politicaLongitudElectrica: 'RUTA_XYZ' }, undefined, 0.5),
		{ metros: 0, origen: 'NO_MODELADO' });
	assert.deepEqual(resolverLongitudConductor({ politicaLongitudElectrica: 'DECLARADA' }, 2, 0.5),
		{ metros: 0, origen: 'NO_MODELADO' });
	assert.deepEqual(resolverLongitudConductor({ longitudManualM: 8 }, 2, 0.5),
		{ metros: 8, origen: 'CONFIGURADO' });
});
