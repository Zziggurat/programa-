/** Puente de contrato entre los QA visibles M1; no sustituye su recorrido de navegador. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { prepararAdopcionRevisionComponente } from '../src/componentes/adopcion.js';
import { instanciarComponentePersonalizado, leerPaqueteProyecto,
	type DefinicionComponentePersonalizado } from '../src/componentes/personalizados.js';
import { referenciaTecnica } from '../src/datos-tecnicos/tipos.js';
import { simular } from '../src/motores/simulacion.js';
import { BackendPersistenciaMemoria, RepositorioProyectosCore,
	type ContenidoComponentePersonalizado } from '../src/persistencia/index.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { datoTecnico, productoTecnico } from './helpers/datos-tecnicos.js';

const PNG_R1 = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfFYAAAAASUVORK5CYII=', 'base64'));
const PNG_R2 = Uint8Array.from(Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64'));

function repositorioLimpio(): RepositorioProyectosCore {
	let secuencia = 0;
	return new RepositorioProyectosCore(new BackendPersistenciaMemoria(), {
		crearId: () => `m1-${++secuencia}`,
		reloj: () => new Date('2026-09-23T00:00:00.000Z'),
	});
}

function contenidoContactor(assetId: string): ContenidoComponentePersonalizado {
	const producto = productoTecnico({ id: 'contactor-m1', familia: 'BOBINA',
		campos: [datoTecnico('bobina.tensionNominalV', 220, 'V')] });
	const terminales: ContenidoComponentePersonalizado['terminales'] = [
		['1/L1', 'L', .18, .08], ['2/T1', 'L', .18, .60],
		['3/L2', 'L', .50, .08], ['4/T2', 'L', .50, .60],
		['5/L3', 'L', .82, .08], ['6/T3', 'L', .82, .60],
		['A1', 'control', .15, .82], ['A2', 'control', .85, .82],
		['13', 'control', .12, .38], ['14', 'control', .12, .50],
		['21', 'control', .88, .38], ['22', 'control', .88, .50],
	].map(([id, tipo, u, v]) => ({ id: id as string, tipo: tipo as 'L' | 'control',
		u: u as number, v: v as number }));
	return {
		nombre: 'Contactor propio M1', referencia: 'M1-KM-220', tipoDispositivo: 'contactor',
		dimensiones: { anchoMm: 45, altoMm: 86, fondoMm: 75 }, assetId, terminales,
		comportamiento: {
			version: 1, clase: 'contactos-electromagneticos', bobina: { entrada: 'A1', retorno: 'A2' },
			polos: [
				{ entrada: '1/L1', salida: '2/T1' }, { entrada: '3/L2', salida: '4/T2' },
				{ entrada: '5/L3', salida: '6/T3' },
			],
			contactos: [
				{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' },
				{ entrada: '21', salida: '22', reposo: 'cerrado', funcion: 'auxiliar' },
			],
		},
		parametros: { tensionV: 220, corrienteA: 9 },
		fichaTecnica: { producto: referenciaTecnica(producto), revisiones: [producto] },
	};
}

function contenidoDe(definicion: DefinicionComponentePersonalizado): ContenidoComponentePersonalizado {
	const { formato: _formato, version: _version, id: _id, revision: _revision,
		creadoEn: _creado, modificadoEn: _modificado, ...contenido } = structuredClone(definicion);
	return contenido;
}

function tableroConContactor(definicion: DefinicionComponentePersonalizado, nombre: string): Proyecto {
	const ejemplo = EJEMPLOS.find(({ id }) => id === 'arranque-directo');
	assert.ok(ejemplo);
	const proyecto = ejemplo.crear();
	proyecto.nombre = nombre;
	const indice = proyecto.dispositivos.findIndex(({ id }) => id === 'km1');
	assert.ok(indice >= 0);
	const nativo = proyecto.dispositivos[indice];
	const propio = instanciarComponentePersonalizado(definicion, nativo.id);
	propio.designacion = nativo.designacion;
	propio.numero = nativo.numero;
	propio.hojaId = nativo.hojaId;
	propio.congelado = nativo.congelado;
	propio.rol = nativo.rol;
	propio.puentesInternos = structuredClone(nativo.puentesInternos);
	proyecto.dispositivos[indice] = propio;
	return proyecto;
}

const topologia = (proyecto: Proyecto): string[] => proyecto.conductores.map(({ id, de, a, seccion }) =>
	`${id}:${de.dispositivoId}.${de.borneId}>${a.dispositivoId}.${a.borneId}:${seccion ?? ''}`).sort();

function firmaSimulacion(proyecto: Proyecto, marcha: boolean) {
	const resultado = simular(proyecto, marcha ? { s1: { activo: true } } : {});
	return {
		activos: [...resultado.activos].sort(),
		conductoresVivos: [...resultado.conductoresVivos].sort(),
		motor: resultado.funcionando.some(({ designacion }) => designacion === '-M1'),
		oscila: resultado.oscila,
	};
}

test('M1 integrado: contactor A/B, foto r2, adopción solo A y paquete técnico limpio', async () => {
	const origen = repositorioLimpio();
	const assetR1 = await origen.guardarAsset('image/png', PNG_R1);
	const r1 = await origen.crearComponente({ id: 'cmp-contactor-m1',
		definicion: contenidoContactor(assetR1.id) });
	const a = await origen.crear({ proyecto: tableroConContactor(r1, 'Tablero A') });
	const b = await origen.crear({ proyecto: tableroConContactor(r1, 'Tablero B') });
	assert.notEqual(a.id, b.id, 'dos documentos independientes, no una copia del mismo registro');
	const firmaCables = topologia(a.proyecto);
	assert.equal(firmaCables.length, 28);
	const reposo = firmaSimulacion(a.proyecto, false);
	const trabajo = firmaSimulacion(a.proyecto, true);
	assert.equal(reposo.motor, false);
	assert.equal(trabajo.motor, true, 'el contactor propio acciona el motor al alimentar su bobina');
	assert.ok(trabajo.activos.includes('km1'));
	assert.deepEqual(firmaSimulacion(b.proyecto, false), reposo);
	assert.deepEqual(firmaSimulacion(b.proyecto, true), trabajo);

	const assetR2 = await origen.guardarAsset('image/png', PNG_R2);
	const r2 = await origen.actualizarComponente(r1.id, { revisionEsperada: 1,
		definicion: { ...contenidoDe(r1), assetId: assetR2.id } });
	assert.notEqual(r2.assetId, r1.assetId);
	for (const campo of ['terminales', 'comportamiento', 'dimensiones', 'parametros', 'fichaTecnica'] as const) {
		assert.deepEqual(r2[campo], r1[campo], `${campo} cambió al revisar solo la foto`);
	}
	for (const documento of [a, b]) {
		const fijado = await origen.abrir(documento.id);
		assert.equal(fijado.proyecto.dispositivos.find(({ id }) => id === 'km1')?.componentePersonalizado?.revision, 1);
		assert.deepEqual(topologia(fijado.proyecto), firmaCables);
		assert.deepEqual(firmaSimulacion(fijado.proyecto, false), reposo);
		assert.deepEqual(firmaSimulacion(fijado.proyecto, true), trabajo);
	}

	const documentoA = await origen.abrir(a.id);
	const mapa = Object.fromEntries(r1.terminales.map(({ id }) => [id, id]));
	const { candidato, impacto } = prepararAdopcionRevisionComponente(documentoA.proyecto, 'km1', r2, mapa);
	assert.equal(impacto.cambiaImagen, true);
	assert.equal(impacto.cambiaPerfil, false);
	assert.equal(impacto.cambiaEnvolvente, false);
	assert.deepEqual(topologia(candidato), firmaCables);
	assert.deepEqual(firmaSimulacion(candidato, false), reposo);
	assert.deepEqual(firmaSimulacion(candidato, true), trabajo);
	assert.equal((await origen.abrir(a.id)).proyecto.dispositivos.find(({ id }) => id === 'km1')?.componentePersonalizado?.revision,
		1, 'preparar/cancelar no publica el candidato');
	const adoptado = await origen.guardar(a.id, { revisionEsperada: documentoA.revision, proyecto: candidato });
	assert.equal(adoptado.proyecto.dispositivos.find(({ id }) => id === 'km1')?.componentePersonalizado?.revision, 2);
	assert.deepEqual(topologia(adoptado.proyecto), firmaCables);
	assert.deepEqual(firmaSimulacion(adoptado.proyecto, false), reposo);
	assert.deepEqual(firmaSimulacion(adoptado.proyecto, true), trabajo);
	const aunB = await origen.abrir(b.id);
	assert.equal(aunB.proyecto.dispositivos.find(({ id }) => id === 'km1')?.componentePersonalizado?.revision, 1);
	assert.deepEqual(topologia(aunB.proyecto), firmaCables);
	assert.deepEqual(firmaSimulacion(aunB.proyecto, true), trabajo);

	const paquete = await origen.exportarPaquete(a.id);
	assert.equal(paquete.version, 3, 'la ficha exacta exige proyecto V3');
	assert.deepEqual(paquete.componentes.map(({ revision }) => revision), [2]);
	assert.deepEqual(paquete.componentes[0].fichaTecnica, r2.fichaTecnica);
	assert.deepEqual(paquete.assets.map(({ id }) => id), [assetR2.id]);
	assert.deepEqual(topologia(paquete.proyecto), firmaCables);
	const sinRevisionTecnica = structuredClone(paquete);
	sinRevisionTecnica.componentes[0].fichaTecnica!.revisiones = [];
	assert.throws(() => leerPaqueteProyecto(JSON.stringify(sinRevisionTecnica)),
		/MISSING|dependencia exacta/, 'un paquete sin su producto técnico no es portable');
	const destino = repositorioLimpio();
	const importado = await destino.importarPaquete(leerPaqueteProyecto(JSON.stringify(paquete)));
	assert.deepEqual(topologia(importado.proyecto), firmaCables);
	assert.deepEqual(firmaSimulacion(importado.proyecto, false), reposo);
	assert.deepEqual(firmaSimulacion(importado.proyecto, true), trabajo);
	assert.deepEqual((await destino.abrirRevisionComponente(r2.id, 2)).fichaTecnica, r2.fichaTecnica);
	assert.deepEqual((await destino.abrirAsset(assetR2.id))?.bytes, PNG_R2);
	assert.equal((await destino.exportarPaquete(importado.id)).version, 3);
});
