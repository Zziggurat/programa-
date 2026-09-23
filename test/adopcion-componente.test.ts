import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAdopcionRevisionComponente } from '../src/componentes/adopcion.js';
import {
	instanciarComponentePersonalizado, type DefinicionComponentePersonalizado,
} from '../src/componentes/personalizados.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import type { Proyecto } from '../src/modelo/tipos.js';

const asset = (letra: string): string => `sha256:${letra.repeat(64)}`;

function definicion(revision = 1): DefinicionComponentePersonalizado {
	const nuevo = revision > 1;
	return {
		formato: 'tablero-studio-componente', version: 1,
		id: 'cmp-k', revision, nombre: nuevo ? 'Contactor r2' : 'Contactor r1',
		creadoEn: '2026-09-22T00:00:00.000Z', modificadoEn: '2026-09-22T00:00:00.000Z',
		tipoDispositivo: 'contactor', dimensiones: {
			anchoMm: nuevo ? 50 : 40, altoMm: 65, fondoMm: nuevo ? 80 : 70,
		},
		assetId: asset(nuevo ? 'b' : 'a'),
		terminales: [
			{ id: nuevo ? 'B1' : 'A1', tipo: 'control', u: 0.2, v: 0.2, maxConductores: 2 },
			{ id: 'A2', tipo: 'control', u: 0.7, v: 0.2 },
			{ id: nuevo ? 'IN' : 'L1', tipo: 'L', u: 0.2, v: 0.8, seccionMaxMm2: 4 },
			{ id: 'T1', tipo: 'L', u: 0.7, v: 0.8 },
		],
		comportamiento: {
			version: 1, clase: 'contactos-electromagneticos',
			bobina: { entrada: nuevo ? 'B1' : 'A1', retorno: 'A2' },
			polos: [{ entrada: nuevo ? 'IN' : 'L1', salida: 'T1' }], contactos: [],
		},
		parametros: { tensionV: nuevo ? 48 : 24, corrienteA: 9 },
	};
}

function proyectoBase(): Proyecto {
	const proyecto = crearProyecto('Adopción');
	const d = instanciarComponentePersonalizado(definicion(), 'k1', {
		imagenResuelta: 'data:image/png;base64,AQID', campo: false,
	});
	d.designacion = '=M+T-K7'; d.numero = 7; d.congelado = true;
	d.funcion = 'M'; d.ubicacion = 'T'; d.hojaId = 'h1'; d.posicion = { x: 2, y: 3 };
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Mando' }];
	proyecto.dispositivos = [d, { id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }, { id: '2' }] }];
	proyecto.conductores = [
		{ id: 'w1', de: { dispositivoId: 'k1', borneId: 'A1' }, a: { dispositivoId: 'x1', borneId: '1' }, seccion: 1.5 },
		{ id: 'w2', de: { dispositivoId: 'x1', borneId: '2' }, a: { dispositivoId: 'k1', borneId: 'L1' }, seccion: 2.5 },
	];
	proyecto.gabinete = { ancho: 400, alto: 300, canaletas: [], rieles: [], colocaciones: [
		{ dispositivoId: 'k1', x: 10, y: 20, ancho: 40, alto: 65, rielId: 'r1' },
	] };
	return proyecto;
}

test('adopción es propuesta aislada: conserva identidad/cables y reconstruye perfil, asset y envolvente', () => {
	const proyecto = proyectoBase();
	const antes = structuredClone(proyecto);
	const { candidato, impacto } = prepararAdopcionRevisionComponente(proyecto, 'k1', definicion(2), {
		A1: 'B1', L1: 'IN',
	});
	assert.deepEqual(proyecto, antes, 'preparar o cancelar no muta el documento abierto');
	assert.notStrictEqual(candidato, proyecto);
	const d = candidato.dispositivos[0];
	assert.equal(d.id, 'k1'); assert.equal(d.designacion, '=M+T-K7'); assert.equal(d.numero, 7);
	assert.equal(d.campo, false); assert.equal(d.hojaId, 'h1');
	assert.deepEqual(d.posicion, { x: 2, y: 3 });
	assert.deepEqual(d.componentePersonalizado, { definicionId: 'cmp-k', revision: 2 });
	assert.equal(d.tensionNominal, 48); assert.equal(d.profundidad, 80);
	assert.equal(d.assetId, asset('b')); assert.equal(d.imagen, undefined, 'no reutilizar la imagen resuelta de r1');
	assert.equal(d.comportamiento?.clase, 'contactos-electromagneticos');
	if (d.comportamiento?.clase === 'contactos-electromagneticos') {
		assert.equal(d.comportamiento.bobina.entrada, 'B1');
		assert.equal(d.comportamiento.polos[0].entrada, 'IN');
	}
	assert.deepEqual(candidato.conductores.map((c) => c.id), ['w1', 'w2']);
	assert.equal(candidato.conductores[0].de.borneId, 'B1');
	assert.equal(candidato.conductores[1].a.borneId, 'IN');
	assert.equal(candidato.gabinete?.colocaciones[0].ancho, 50);
	assert.equal(impacto.revisionAnterior, 1); assert.equal(impacto.revisionNueva, 2);
	assert.deepEqual(impacto.conductoresAfectados, ['w1', 'w2']);
	assert.equal(impacto.cambiaPerfil, true); assert.equal(impacto.cambiaImagen, true);
	assert.equal(impacto.requiereHidratarAsset, true);
	assert.equal(impacto.requiereRevisionDeRuta, true);
	assert.deepEqual(impacto.puertosRetirados, []);
	assert.deepEqual(impacto.puertosAnadidos, []);
	const reabierto = cargarProyecto(JSON.stringify(candidato));
	assert.equal(reabierto.arreglos.length, 0, reabierto.arreglos.join(' | '));
	assert.equal(reabierto.proyecto.dispositivos[0].componentePersonalizado?.revision, 2);
	assert.equal(reabierto.proyecto.conductores[0].de.borneId, 'B1');
});

test('si solo cambia el asset, la imagen runtime se invalida y la ruta requiere revisión', () => {
	const proyecto = proyectoBase();
	const nueva = definicion(); nueva.revision = 2; nueva.assetId = asset('b');
	const { candidato, impacto } = prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, {
		A1: 'A1', L1: 'L1',
	});
	assert.equal(candidato.dispositivos[0].imagen, undefined);
	assert.equal(impacto.requiereHidratarAsset, true);
	assert.equal(impacto.requiereRevisionDeRuta, true);
	assert.equal(impacto.cambiaEnvolvente, false);
});

test('puentes y bloques físicos remapean IDs; no se pierden al cambiar el perfil', () => {
	const proyecto = proyectoBase();
	proyecto.dispositivos[0].puentesInternos = [['A1', 'A2']];
	proyecto.dispositivos[0].puentes = [['A1', 'L1']];
	proyecto.dispositivos[0].terminales = [{ lado: 'arriba', bornes: ['A1', 'L1'] }];
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', definicion(2), {
		A1: 'B1', L1: 'IN',
	}), /Falta.*A2/);
	const { candidato } = prepararAdopcionRevisionComponente(proyecto, 'k1', definicion(2), {
		A1: 'B1', A2: 'A2', L1: 'IN',
	});
	assert.deepEqual(candidato.dispositivos[0].puentesInternos, [['B1', 'A2']]);
	assert.deepEqual(candidato.dispositivos[0].puentes, [['B1', 'IN']]);
	assert.deepEqual(candidato.dispositivos[0].terminales?.[0].bornes, ['B1', 'IN']);
});

test('el mapeo exige todos los puertos conectados y no acepta identidad, revisión ni destinos falsos', () => {
	const proyecto = proyectoBase();
	const nueva = definicion(2);
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1' }), /Falta.*L1/);
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1', L1: 'NO' }), /inexistente/);
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1', L1: 'B1' }), /mismo borne/);
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1', L1: 'IN', FANTASMA: 'T1' }), /anterior inexistente/);
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', definicion(), { A1: 'A1', L1: 'L1' }), /revisión posterior/);
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', { ...nueva, id: 'otra' }, { A1: 'B1', L1: 'IN' }), /otra definición/);
	proyecto.esEjemplo = true;
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1', L1: 'IN' }), /solo lectura/);
});

test('rechaza degradar PE, exceder bornes y recolocar encima de otro aparato', () => {
	const proyecto = proyectoBase();
	const nueva = definicion(2);
	proyecto.dispositivos[0].bornes[0].tipo = 'PE';
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1', L1: 'IN' }), /protección PE/);
	proyecto.dispositivos[0].bornes[0].tipo = 'control';
	nueva.terminales[0].maxConductores = 1;
	proyecto.conductores.push({ id: 'w3', de: { dispositivoId: 'k1', borneId: 'A1' },
		a: { dispositivoId: 'x1', borneId: '2' } });
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1', L1: 'IN' }), /solo admite 1/);
	proyecto.conductores.pop();
	nueva.terminales[0].maxConductores = 2;
	nueva.terminales[2].seccionMaxMm2 = 1;
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1', L1: 'IN' }), /supera la sección/);
	nueva.terminales[2].seccionMaxMm2 = 4;
	proyecto.gabinete!.colocaciones.push({ dispositivoId: 'x1', x: 53, y: 20, ancho: 20, alto: 65 });
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1', L1: 'IN' }), /colisiona/);
	proyecto.gabinete!.colocaciones.push({ dispositivoId: 'k1', x: 100, y: 20, ancho: 40, alto: 65 });
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, { A1: 'B1', L1: 'IN' }), /varias colocaciones/);
});

test('capacidad no declarada no se convierte en un máximo físico supuesto', () => {
	const proyecto = proyectoBase();
	const nueva = definicion(2);
	delete nueva.terminales[0].maxConductores;
	proyecto.conductores.push(
		{ id: 'w3', de: { dispositivoId: 'k1', borneId: 'A1' }, a: { dispositivoId: 'x1', borneId: '2' } },
		{ id: 'w4', de: { dispositivoId: 'k1', borneId: 'A1' }, a: { dispositivoId: 'x1', borneId: '1' } },
	);
	const { candidato } = prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, {
		A1: 'B1', L1: 'IN',
	});
	assert.equal(candidato.conductores.filter((c) => c.de.dispositivoId === 'k1' && c.de.borneId === 'B1').length, 3);
	assert.equal(candidato.dispositivos[0].bornes.find((b) => b.id === 'B1')?.maxConductores, undefined);
});

test('adoptar otra mecánica exige recolocar; la instancia fija su nuevo contrato al confirmar', () => {
	const proyecto = proyectoBase();
	const nueva = definicion(2);
	nueva.montaje = { metodo: 'atornillado-placa', anclajes: [{ xMm: 5, yMm: 5 }] };
	assert.throws(() => prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, {
		A1: 'B1', L1: 'IN',
	}), /no cabe.*riel/);
	proyecto.gabinete!.colocaciones[0].rielId = undefined;
	const { candidato, impacto } = prepararAdopcionRevisionComponente(proyecto, 'k1', nueva, {
		A1: 'B1', L1: 'IN',
	});
	assert.equal(impacto.estadoMontaje, 'GEOMETRIA_COMPATIBLE');
	assert.deepEqual(candidato.dispositivos[0].montajeComponente, nueva.montaje);
	assert.equal(proyecto.dispositivos[0].montajeComponente, undefined);
});

test('remapea referencias técnicas puntuales y conserva los enlaces técnicos para revisión explícita', () => {
	const proyecto = proyectoBase();
	proyecto.datosTecnicos = {
		version: 1, revisiones: [], vinculos: [{ entidad: 'DEVICE', entidadId: 'k1',
			producto: { tipo: 'PRODUCTO', catalogoId: 'c', id: 'p', revision: 1, hash: 'h' },
			decisiones: {}, condiciones: {},
		}], instalaciones: [], prospectiva: [{ proteccionId: 'k1',
			de: { dispositivoId: 'k1', borneId: 'L1' },
			a: { dispositivoId: 'x1', borneId: '1' }, tipo: 'L_N',
		}],
	};
	const { candidato, impacto } = prepararAdopcionRevisionComponente(proyecto, 'k1', definicion(2), {
		A1: 'B1', L1: 'IN',
	});
	assert.equal(candidato.datosTecnicos?.prospectiva?.[0].de.borneId, 'IN');
	assert.equal(proyecto.datosTecnicos.prospectiva?.[0].de.borneId, 'L1');
	assert.equal(impacto.requiereRevisionTecnica, true);
});
