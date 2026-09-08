import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureAnalogicaIncompatibleV7 } from '../ejemplo/fixtures-ingenieria-v7.js';
import { resolverProyectoTecnico } from '../src/datos-tecnicos/resolver.js';
import { vincularProductoTecnico } from '../src/datos-tecnicos/operaciones.js';
import { claveDato, referenciaTecnica, type DatoTecnico, type VinculoTecnico } from '../src/datos-tecnicos/tipos.js';
import { ejecutarIngenieria } from '../src/ingenieria/engine.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { resolverComportamiento, validarComportamiento } from '../src/modelo/comportamiento.js';
import { memoriaVacia, simular } from '../src/motores/simulacion.js';
import { datoTecnico, productoTecnico } from './helpers/datos-tecnicos.js';

function fixture() {
	const p = fixtureAnalogicaIncompatibleV7();
	const tx = p.dispositivos.find(d => d.id === 'tx')!, plc = p.dispositivos.find(d => d.id === 'plc')!;
	if (tx.comportamiento?.clase !== 'sensor' || !tx.comportamiento.transmisor || plc.comportamiento?.clase !== 'controlador') throw new Error('Fixture inválido');
	tx.comportamiento.transmisor.salida.unidad = 'V'; tx.comportamiento.transmisor.salida.rango = [0, 10];
	tx.fisica = { version: 1, analogica: { resistenciaSalidaOhm: 1 } }; plc.fisica!.analogica!.burdenOhm = 100000;
	const tx2 = structuredClone(tx); tx2.id = 'tx2';
	plc.bornes.push({ id: 'AI2', tipo: 'senal' }, { id: 'DO2', tipo: 'control' });
	plc.comportamiento.entradasAnalogicas!.push({ ...structuredClone(plc.comportamiento.entradasAnalogicas![0]), borne: 'AI2' });
	plc.comportamiento.salidasDigitales.push({ borne: 'DO2', comun: '+24', electrica: { sistema: 'DC', tensionV: 24, tipoSalida: 'PNP', corrienteMaxA: .1 } });
	// El programa usa únicamente el canal sano. La lectura del canal retirado tampoco puede
	// filtrarse a sondas/DI por el adaptador legacy, aun cuando no lo mencione este programa.
	plc.programa = 'DO2 = AI2 > 5';
	p.dispositivos.push(tx2, { id: 'red', tipo: 'fuente', bornes: [{ id: '+', tipo: 'control' }, { id: '-', tipo: 'control' }],
		comportamiento: { version: 1, clase: 'fuente', salidas: [{ borne: '+', papel: 'fase', tensionV: 24 }, { borne: '-', papel: 'retorno', tensionV: 0 }] },
		fisica: { version: 1, fuente: { sistema: 'DC', tensionNominalV: 24, referencia: '-', fases: [{ borne: '+', fase: 'POSITIVO' }], rOhm: .1 } } });
	const agregar = (id: string, d: string, b: string, a: string, ab: string) => p.conductores.push({ id,
		de: { dispositivoId: d, borneId: b }, a: { dispositivoId: a, borneId: ab }, seccion: 1,
		fisica: { material: 'COBRE', longitudManualM: 1 } });
	agregar('ws2', 'tx2', 'OUT', 'plc', 'AI2'); agregar('wc2', 'tx2', 'COM', 'plc', 'AIC');
	for (const id of ['tx', 'tx2', 'plc']) agregar(`p-${id}`, 'red', '+', id, '+24');
	agregar('n-plc', 'red', '-', 'plc', '0V'); agregar('n-tx', 'red', '-', 'tx', 'COM');
	return p;
}

const campos = ['analogica.rango', 'analogica.unidad', 'analogica.modo'] as const;
type Campo = typeof campos[number];
type Causa = 'MISSING' | 'NOT_APPLICABLE' | 'SIN_HERENCIA';
function conAusencia(entidadId: 'tx' | 'plc', campo: Campo, causa: Causa) {
	const p = fixture();
	const valor = campo === 'analogica.rango' ? [0, 10] as [number, number] : campo === 'analogica.unidad' ? 'V' : entidadId === 'tx' ? 'activa' : 'pasiva';
	const dato: DatoTecnico = { ...datoTecnico(campo, valor, '1'), ...(entidadId === 'plc' ? { canal: 'AI1' } : {}),
		...(causa === 'MISSING' ? { condiciones: { contexto: 'instalación documentada' } } : causa === 'NOT_APPLICABLE' ? { condiciones: { sistema: 'AC' as const } } : {}) };
	const producto = productoTecnico({ id: `analogica-${entidadId}`, familia: entidadId === 'tx' ? 'ANALOGICA' : 'PLC', campos: [dato] });
	const vinculo: VinculoTecnico = { entidad: 'DEVICE', entidadId, producto: referenciaTecnica(producto), condiciones: { sistema: 'DC' },
		decisiones: { [claveDato(dato)]: causa === 'SIN_HERENCIA' ? { modo: 'SIN_HERENCIA', motivo: 'Semántica no disponible' } : { modo: 'CATALOGO' } } };
	return vincularProductoTecnico(p, vinculo, [producto]);
}

for (const entidad of ['tx', 'plc'] as const) for (const campo of campos) for (const causa of ['MISSING', 'NOT_APPLICABLE', 'SIN_HERENCIA'] as const) {
	test(`V8 ausencia analógica: ${entidad}/${campo}/${causa} no crea perfil inválido ni lectura legacy`, () => {
		const p = conAusencia(entidad, campo, causa), antes = structuredClone(p), tecnica = resolverProyectoTecnico(p);
		const r = tecnica.resoluciones.find(d => d.entidadId === entidad && d.campo === campo)!;
		assert.equal(r.estado, causa === 'SIN_HERENCIA' ? 'NOT_APPLICABLE' : causa);
		assert.match(r.pasos.join(' '), /NO_MODELADO/);
		for (const d of tecnica.proyecto.dispositivos) assert.deepEqual(validarComportamiento(d), []);
		const sensor = resolverComportamiento(tecnica.proyecto.dispositivos.find(d => d.id === 'tx')!);
		const plc = resolverComportamiento(tecnica.proyecto.dispositivos.find(d => d.id === 'plc')!);
		assert.equal(sensor?.clase, 'sensor'); assert.equal(plc?.clase, 'controlador');
		if (sensor?.clase !== 'sensor' || plc?.clase !== 'controlador') throw new Error('No se preservó la función restante');
		if (entidad === 'tx') assert.equal(sensor.transmisor, undefined);
		else assert.deepEqual(plc.entradasAnalogicas?.map(ai => ai.borne), ['AI2']);
		const ingenieria = ejecutarIngenieria({ proyecto: p });
		assert.ok(ingenieria.validacion.issues.some(i => i.code.startsWith('TS-DATA-') && i.status === 'INDETERMINATE'
			&& i.relatedEntities.some(e => e.id === entidad)));
		const sim = simular(p, { tx: { valor: 9 }, tx2: { valor: 9 } }, undefined, { ahora: 0, memoria: memoriaVacia() });
		const lectura = sim.controladores.find(c => c.dispositivoId === 'plc')!;
		assert.ok(lectura, 'El PLC alimentado conserva su programa');
		assert.equal(lectura.sondas.AI1, undefined, 'No se rescata estado.tx.valor como AI válida');
		assert.ok(!lectura.entradas.includes('AI1'), 'Una AI retirada tampoco se convierte en DI activa');
		assert.ok(lectura.sondas.AI2 > 8.8 && lectura.sondas.AI2 < 9.1, `Canal vecino: ${lectura.sondas.AI2}`);
		assert.ok(lectura.salidas.includes('DO2'), 'El canal sano sigue ejecutando el circuito existente');
		if (entidad === 'tx') assert.ok(!sim.sensoresAnalogicos.some(s => s.dispositivoId === 'tx'));
		else assert.ok(!sim.entradasAnalogicas.some(ai => ai.dispositivoId === 'plc' && ai.borne === 'AI1'));
		assert.deepEqual(p, antes);
	});
}

for (const entidad of ['tx', 'plc'] as const) test(`V8 ausencia analógica: vínculo roto ${entidad} no recupera transmisor/AI legacy`, () => {
	const p = conAusencia(entidad, 'analogica.rango', 'SIN_HERENCIA'); p.datosTecnicos!.revisiones = [];
	const tecnica = resolverProyectoTecnico(p);
	assert.ok(tecnica.problemas.some(x => x.entidadId === entidad));
	assert.doesNotThrow(() => ejecutarIngenieria({ proyecto: p }));
	const sim = simular(p, { tx: { valor: 9 }, tx2: { valor: 9 } }, undefined, { ahora: 0, memoria: memoriaVacia() });
	const lectura = sim.controladores.find(c => c.dispositivoId === 'plc')!;
	assert.equal(lectura.sondas.AI1, undefined);
	if (entidad === 'plc') assert.equal(lectura.sondas.AI2, undefined, 'Vínculo global roto no autoriza ninguna AI');
	else assert.ok(lectura.sondas.AI2 > 8.8, 'Un transmisor roto no bloquea otro transmisor');
});

test('V8 ausencia analógica: guardar/cargar, recomputar y reordenar preservan estado sin mutar diseño', () => {
	const p = conAusencia('plc', 'analogica.rango', 'SIN_HERENCIA'), base = resolverProyectoTecnico(p);
	const cargado = cargarProyecto(JSON.stringify(p)).proyecto;
	cargado.dispositivos.reverse(); cargado.conductores.reverse(); cargado.datosTecnicos!.vinculos.reverse();
	const nuevo = resolverProyectoTecnico(cargado);
	assert.deepEqual(nuevo.resoluciones, base.resoluciones);
	assert.deepEqual(nuevo.proyecto.dispositivos.find(d => d.id === 'plc')!.comportamiento,
		base.proyecto.dispositivos.find(d => d.id === 'plc')!.comportamiento);
	const original = resolverComportamiento(p.dispositivos.find(d => d.id === 'plc')!);
	assert.equal(original?.clase === 'controlador' && original.entradasAnalogicas?.length, 2);
});
