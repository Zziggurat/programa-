import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { fixtureFallosIndustriales } from '../ejemplo/fixtures-simulacion-v2.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Dispositivo, RepresentacionEsquema, TipoDispositivo } from '../src/modelo/tipos.js';
import { montarEsquema, NOTA_SIMBOLOGIA_ESQUEMA, procedenciaSimboloEsquema,
	simboloDe } from '../src/motores/esquema.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';

const plantillaPorTipo: Record<TipoDispositivo, string> = {
	plc: 'esq.bloque-funcional.v1', variador: 'esq.bloque-funcional.v1',
	fuente: 'esq.fuente.v1', transformador: 'esq.transformador.v1',
	contactor: 'esq.contacto-electromagnetico.v1', rele: 'esq.contacto-electromagnetico.v1',
	disyuntor: 'esq.proteccion-contacto.v1', guardamotor: 'esq.proteccion-contacto.v1',
	seccionador: 'esq.proteccion-contacto.v1', diferencial: 'esq.diferencial.v1',
	fusible: 'esq.fusible.v1', motor: 'esq.motor.v1',
	pulsador: 'esq.mando.v1', selector: 'esq.mando.v1', piloto: 'esq.piloto.v1',
	sensor: 'esq.sensor.v1', bornero: 'esq.bornero.v1',
	valvula: 'esq.caja-generica.v1', resistencia: 'esq.caja-generica.v1',
	condensador: 'esq.caja-generica.v1', cable: 'esq.caja-generica.v1',
	otro: 'esq.caja-generica.v1',
};

function vista(dispositivoId: string, parte: RepresentacionEsquema['parte']): RepresentacionEsquema {
	return { id: `vista-${parte.tipo}`, dispositivoId, hojaId: 'h1',
		posicion: { columna: 3, fila: 4 }, parte };
}

test('ESQ-06: inventario de 22 tipos sigue exactamente el resolvedor que genera trazos', () => {
	assert.equal(Object.keys(plantillaPorTipo).length, 22);
	const licenciaRepo = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { license: string };
	for (const [tipo, id] of Object.entries(plantillaPorTipo) as [TipoDispositivo, string][]) {
		const d: Dispositivo = { id: tipo, tipo, bornes: [{ id: '1' }, { id: '2' }] };
		const geometria = simboloDe(d);
		assert.equal(geometria.plantilla.id, id, tipo);
		assert.deepEqual(procedenciaSimboloEsquema(d), geometria.plantilla, tipo);
		assert.ok(geometria.trazos.length > 0, tipo);
		assert.equal(geometria.pines.size, 2, tipo);
		assert.equal(geometria.plantilla.origen, 'trazos-generados-en-editor');
		assert.equal(geometria.plantilla.archivo, 'src/motores/esquema.ts');
		assert.equal(geometria.plantilla.licenciaDeclarada, licenciaRepo.license);
		assert.equal(geometria.plantilla.licenciaVerificada, false);
		assert.equal(geometria.plantilla.conformidadNormativa, 'NO_VERIFICADA');
		assert.ok(Object.isFrozen(geometria.plantilla));
	}
	assert.match(NOTA_SIMBOLOGIA_ESQUEMA, /GPL-2\.0-or-later declarada \(no verificada por símbolo\)/);
	assert.match(NOTA_SIMBOLOGIA_ESQUEMA, /No certifica normas ni fabricación/);
});

test('ESQ-06: bobina, contacto y bloque funcional se inventarían por geometría, no por tipo', () => {
	const bobina: Dispositivo = { id: 'k1', tipo: 'contactor', bornes: [{ id: 'A1' }, { id: 'A2' }] };
	const contacto: Dispositivo = { id: 'k2', tipo: 'contactor', bornes: [{ id: '13' }, { id: '14' }] };
	const bloque: Dispositivo = { ...bobina, terminales: [{ lado: 'izquierda', bornes: ['A1', 'A2'] }] };
	assert.equal(simboloDe(bobina).plantilla.id, 'esq.bobina-completa.v1');
	assert.equal(simboloDe(contacto).plantilla.id, 'esq.contacto-electromagnetico.v1');
	assert.equal(simboloDe(bloque).plantilla.id, 'esq.bloque-funcional.v1');
	assert.equal(simboloDe(bloque).plantilla.familia, 'bloque-funcional');
	assert.equal(simboloDe({ ...bloque, tipo: 'bornero' }).plantilla.id, 'esq.bornero.v1',
		'el bornero con bloques de terminales mantiene su geometría dedicada');
});

test('ESQ-06: montaje legacy y vistas parciales M2 conservan la ficha de la geometría dibujada', () => {
	const legacy = crearProyecto('Procedencia');
	legacy.dispositivos = [{ id: 'm1', tipo: 'motor', bornes: [{ id: 'U' }] }];
	const montadoLegacy = montarEsquema(legacy, calcularPotenciales(legacy));
	assert.equal(montadoLegacy.flatMap((h) => h.simbolos)[0]?.plantilla?.id, 'esq.motor.v1');
	assert.equal(legacy.dispositivos[0].comportamiento, undefined);

	const p = fixtureFallosIndustriales();
	const km = p.dispositivos.find((d) => d.id === 'km1');
	assert.ok(km);
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Maniobra' }];
	const bobina = vista('km1', { tipo: 'bobina' });
	const contactos = vista('km1', { tipo: 'contactos', pares: [{ entrada: '13', salida: '14' }] });
	contactos.id = 'vista-contactos';
	contactos.posicion = { columna: 5, fila: 4 };
	p.esquema = { representaciones: [bobina, contactos] };
	const antes = JSON.stringify(p);
	const simbolos = montarEsquema(p, calcularPotenciales(p)).flatMap((h) => h.simbolos);
	assert.deepEqual(simbolos.map((s) => s.plantilla?.id),
		['esq.bobina-parcial.v1', 'esq.contactos-parciales.v1']);
	for (const r of p.esquema.representaciones ?? []) {
		const s = simbolos.find((x) => x.representacionId === r.id);
		assert.deepEqual(s?.plantilla, procedenciaSimboloEsquema(km, r));
	}
	assert.equal(JSON.stringify(p), antes, 'los metadatos de procedencia no se persisten en Proyecto');
	const reabierto = cargarProyecto(antes);
	assert.deepEqual(reabierto.diagnosticos, []);
	const trasCarga = montarEsquema(reabierto.proyecto, calcularPotenciales(reabierto.proyecto))
		.flatMap((h) => h.simbolos);
	assert.deepEqual(trasCarga.map((s) => s.plantilla?.id), simbolos.map((s) => s.plantilla?.id));
});

test('ESQ-06: una vista parcial inválida no declara una plantilla que no llegó a dibujarse', () => {
	const motor: Dispositivo = { id: 'm1', tipo: 'motor', bornes: [{ id: 'U' }, { id: 'V' }] };
	assert.equal(procedenciaSimboloEsquema(motor, vista('m1', { tipo: 'bobina' })), undefined);
	assert.equal(procedenciaSimboloEsquema(motor, vista('m1', { tipo: 'contactos',
		pares: [{ entrada: 'U', salida: 'V' }] })), undefined);
});
