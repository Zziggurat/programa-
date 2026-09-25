import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Proyecto } from '../src/modelo/tipos.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { montarEsquema } from '../src/motores/esquema.js';
import { generarReferencias } from '../src/motores/referencias.js';
import {
	aplicarRenumeracionEsquema, previsualizarRenumeracionEsquema,
} from '../src/motores/renumeracion-esquema.js';

function fixture(): Proyecto {
	const p = crearProyecto('M2 renumeración');
	p.hojas = [{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' }];
	p.gabinete = { ancho: 500, alto: 600, canaletas: [], rieles: [], colocaciones: [] };
	p.dispositivos = [
		{ id: 'k2', tipo: 'rele', numero: 8, designacion: '-K8',
			bornes: [{ id: 'A1' }, { id: 'A2' }] },
		{ id: 'q1', tipo: 'disyuntor', numero: 4, designacion: '-Q4',
			bornes: [{ id: '1' }, { id: '2' }] },
		{ id: 'k1', tipo: 'contactor', numero: 5, designacion: '-K5',
			rol: { tipo: 'maestro' },
			bornes: ['A1', 'A2', '1/L1', '2/T1'].map((id) => ({ id })),
			comportamiento: { version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }], contactos: [] } },
		{ id: 'kf', tipo: 'rele', numero: 1, designacion: '-K2', congelado: true,
			bornes: [{ id: 'A1' }, { id: 'A2' }] },
		{ id: 'aux', tipo: 'rele', numero: 9, designacion: '-K9', congelado: true,
			rol: { tipo: 'esclavo', maestroId: 'k1', contacto: 'NA' },
			bornes: [{ id: '13' }, { id: '14' }] },
		{ id: 'foto', tipo: 'otro', numero: 7, designacion: 'FOTO', imagen: 'data:image/png;base64,AA==',
			bornes: [{ id: 'p' }] },
	];
	p.esquema = { representaciones: [
		{ id: 'v-k2', dispositivoId: 'k2', hojaId: 'mando',
			posicion: { columna: 2, fila: 1 }, parte: { tipo: 'completa' } },
		{ id: 'v-q1', dispositivoId: 'q1', hojaId: 'potencia',
			posicion: { columna: 1, fila: 1 }, parte: { tipo: 'completa' } },
		{ id: 'v-k1-polo', dispositivoId: 'k1', hojaId: 'potencia',
			posicion: { columna: 9, fila: 2 }, parte: { tipo: 'contactos',
				pares: [{ entrada: '1/L1', salida: '2/T1' }] } },
		{ id: 'v-k1-bobina', dispositivoId: 'k1', hojaId: 'mando',
			posicion: { columna: 1, fila: 1 }, parte: { tipo: 'bobina' } },
		{ id: 'v-kf', dispositivoId: 'kf', hojaId: 'mando',
			posicion: { columna: 3, fila: 1 }, parte: { tipo: 'completa' } },
		{ id: 'v-aux', dispositivoId: 'aux', hojaId: 'mando',
			posicion: { columna: 4, fila: 1 }, parte: { tipo: 'completa' } },
	] };
	p.conductores = [{ id: 'w-pendiente', de: { dispositivoId: 'k1', borneId: 'A1' },
		a: { dispositivoId: 'q1', borneId: '2' }, estadoRutaFisica: 'pendiente', numero: 'CTRL-1',
		congelado: true }];
	return p;
}

const etiquetas = (p: Proyecto) => Object.fromEntries(p.dispositivos.map((d) => [d.id, d.designacion]));

test('ESQ-08 preview es puro, toma bobina como ancla y reserva texto congelado aunque numero esté obsoleto', () => {
	const p = fixture(), antes = JSON.stringify(p);
	const plan = previsualizarRenumeracionEsquema(p);
	assert.equal(JSON.stringify(p), antes);
	assert.deepEqual(plan.conflictos, []);
	assert.equal(plan.filas.some((f) => f.dispositivoId === 'foto'), false,
		'la imagen inerte no recibe designación eléctrica');
	assert.equal(plan.filas.find((f) => f.dispositivoId === 'k1')?.ubicacion.origen, 'BOBINA');
	assert.equal(plan.filas.find((f) => f.dispositivoId === 'k1')?.designacionPropuesta, '-K1');
	assert.equal(plan.filas.find((f) => f.dispositivoId === 'k2')?.designacionPropuesta, '-K3');
	assert.equal(plan.filas.find((f) => f.dispositivoId === 'q1')?.designacionPropuesta, '-Q1');
	assert.equal(plan.filas.find((f) => f.dispositivoId === 'kf')?.designacionPropuesta, '-K2');
	assert.equal(plan.filas.find((f) => f.dispositivoId === 'kf')?.numeroPropuesto, 1,
		'no se reinterpreta el número antiguo del congelado');
	assert.equal(JSON.stringify(p), antes, 'cancelar el preview no modifica nada');
});

test('ESQ-08 aplicación conserva ID, hoja, representación, conexión pendiente y referencia maestro/esclavo', () => {
	const p = fixture();
	const ids = p.dispositivos.map((d) => d.id), hojas = structuredClone(p.hojas);
	const vistas = structuredClone(p.esquema?.representaciones), cables = structuredClone(p.conductores);
	aplicarRenumeracionEsquema(p, previsualizarRenumeracionEsquema(p));
	assert.deepEqual(p.dispositivos.map((d) => d.id), ids);
	assert.deepEqual(p.hojas, hojas);
	assert.deepEqual(p.esquema?.representaciones, vistas);
	assert.deepEqual(p.conductores, cables);
	assert.equal(p.dispositivos.find((d) => d.id === 'aux')?.rol?.tipo, 'esclavo');
	assert.equal(p.dispositivos.find((d) => d.id === 'kf')?.designacion, '-K2');
	assert.equal(p.dispositivos.find((d) => d.id === 'foto')?.designacion, 'FOTO');
	const refs = generarReferencias(p);
	assert.equal(refs.cruzadas.find((x) => x.maestroId === 'k1')?.designacion, '-K1');
	assert.equal(refs.maestroDeEsclavo.get('aux')?.designacion, '-K1');
	const h = montarEsquema(p, calcularPotenciales(p));
	assert.ok(h.some((hoja) => hoja.simbolos.some((s) => s.dispositivoId === 'k1')));
});

test('ESQ-08 invertir arrays no cambia el preview por ubicación e ID', () => {
	const a = fixture(), b = fixture();
	b.dispositivos.reverse(); b.hojas.reverse(); b.esquema!.representaciones!.reverse();
	const pa = previsualizarRenumeracionEsquema(a), pb = previsualizarRenumeracionEsquema(b);
	assert.deepEqual(pa.filas, pb.filas);
	assert.deepEqual(pa.conflictos, pb.conflictos);
	aplicarRenumeracionEsquema(a, pa); aplicarRenumeracionEsquema(b, pb);
	assert.deepEqual(etiquetas(a), etiquetas(b));
});

test('ESQ-08 rechaza congelados duplicados, sin etiqueta y plantillas colisionantes', () => {
	const duplicado = fixture();
	duplicado.dispositivos.find((d) => d.id === 'aux')!.designacion = '-k２';
	const plan = previsualizarRenumeracionEsquema(duplicado);
	assert.ok(plan.conflictos.some((c) => c.codigo === 'DESIGNACION_CONGELADA_DUPLICADA'));
	(plan.conflictos as unknown as unknown[]).splice(0);
	const antes = JSON.stringify(duplicado);
	assert.throws(() => aplicarRenumeracionEsquema(duplicado, plan), /conflictos/,
		'alterar el preview no autoriza una aplicación insegura');
	assert.equal(JSON.stringify(duplicado), antes);
	const sinEtiqueta = fixture(); sinEtiqueta.dispositivos.find((d) => d.id === 'kf')!.designacion = undefined;
	assert.ok(previsualizarRenumeracionEsquema(sinEtiqueta).conflictos.some((c) =>
		c.codigo === 'CONGELADO_SIN_DESIGNACION'));
	const sinNumero = fixture(); sinNumero.opciones = { formatoDesignacion: '-K' };
	assert.ok(previsualizarRenumeracionEsquema(sinNumero).conflictos.some((c) =>
		c.codigo === 'PLANTILLA_NO_UNIVOCA'));
	const sinClase = fixture(); sinClase.opciones = { formatoDesignacion: '-{n}' };
	assert.ok(previsualizarRenumeracionEsquema(sinClase).conflictos.some((c) =>
		c.codigo === 'DESIGNACION_PROPUESTA_DUPLICADA'));
});

test('ESQ-08 revalida snapshot/proyecto y prohíbe mutar un ejemplo', () => {
	const p = fixture(), otro = fixture();
	const plan = previsualizarRenumeracionEsquema(p);
	const antesOtro = JSON.stringify(otro);
	assert.throws(() => aplicarRenumeracionEsquema(otro, plan), /cambi[oó]/);
	assert.equal(JSON.stringify(otro), antesOtro);
	p.nombre = 'Editado mientras se confirmaba';
	const antes = JSON.stringify(p);
	assert.throws(() => aplicarRenumeracionEsquema(p, plan), /cambi[oó]/);
	assert.equal(JSON.stringify(p), antes);
	const ejemplo = fixture(); ejemplo.esEjemplo = true;
	const antesEjemplo = JSON.stringify(ejemplo);
	assert.throws(() => aplicarRenumeracionEsquema(ejemplo,
		previsualizarRenumeracionEsquema(ejemplo)), /solo lectura/);
	assert.equal(JSON.stringify(ejemplo), antesEjemplo);
});

test('ESQ-08 renumeración permanece tras guardar/cargar con hojas y rutas pendientes idénticas', () => {
	const p = fixture();
	aplicarRenumeracionEsquema(p, previsualizarRenumeracionEsquema(p));
	const abierto = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(etiquetas(abierto.proyecto), etiquetas(p));
	assert.deepEqual(abierto.proyecto.hojas, p.hojas);
	assert.deepEqual(abierto.proyecto.esquema?.representaciones, p.esquema?.representaciones);
	assert.equal(JSON.stringify(abierto.proyecto.conductores), JSON.stringify(p.conductores),
		'el cargador puede añadir propiedades undefined sin cambiar los datos persistentes');
	assert.equal(generarReferencias(abierto.proyecto).maestroDeEsclavo.get('aux')?.designacion, '-K1');
});
