import assert from 'node:assert/strict';
import test from 'node:test';
import {
	alternarAislamiento, alternarBloqueoEnVista, alternarOcultacion,
	aparatoBloqueadoEnVista, aparatoVisibleEnVista, depurarVistaMontaje,
	restaurarVisibilidad, revelarAparato, vistaMontajeInicial,
} from '../src/modelo/vista-montaje.js';

test('ocultar no cambia los IDs ni la vista anterior y se puede recuperar', () => {
	const inicio = vistaMontajeInicial();
	const oculto = alternarOcultacion(inicio, 'km1');
	assert.equal(aparatoVisibleEnVista(inicio, 'km1'), true);
	assert.equal(aparatoVisibleEnVista(oculto, 'km1'), false);
	assert.equal(aparatoVisibleEnVista(oculto, 'q1'), true);
	assert.equal(aparatoVisibleEnVista(alternarOcultacion(oculto, 'km1'), 'km1'), true);
});

test('aislar es independiente del orden y recupera una pieza previamente oculta', () => {
	const oculto = alternarOcultacion(vistaMontajeInicial(), 'km1');
	const a = alternarAislamiento(oculto, ['km1', 'q1']);
	const b = alternarAislamiento(oculto, ['q1', 'km1']);
	for (const vista of [a, b]) {
		assert.equal(aparatoVisibleEnVista(vista, 'km1'), true);
		assert.equal(aparatoVisibleEnVista(vista, 'q1'), true);
		assert.equal(aparatoVisibleEnVista(vista, 'm1'), false);
		assert.equal(vista.ocultos.has('km1'), false);
	}
	assert.equal(alternarAislamiento(a, ['q1', 'km1']).aislados, undefined);
});

test('la vista se depura tras borrar y no reaparece en un documento nuevo', () => {
	const a = alternarAislamiento(alternarOcultacion(vistaMontajeInicial(), 'm1'), ['q1']);
	const depurada = depurarVistaMontaje(a, new Set(['q1']));
	assert.equal(depurada.ocultos.size, 0);
	assert.equal(aparatoVisibleEnVista(depurada, 'q1'), true);
	assert.equal(aparatoVisibleEnVista(depurada, 'm1'), false);
	assert.equal(aparatoVisibleEnVista(vistaMontajeInicial(), 'm1'), true);
});

test('seleccionar desde lista recupera una pieza oculta o aislada fuera', () => {
	const aislada = alternarAislamiento(vistaMontajeInicial(), ['q1']);
	const recuperada = revelarAparato(aislada, 'm1');
	assert.equal(recuperada.aislados, undefined);
	assert.equal(aparatoVisibleEnVista(recuperada, 'm1'), true);
	const oculta = alternarOcultacion(vistaMontajeInicial(), 'm1');
	assert.equal(aparatoVisibleEnVista(revelarAparato(oculta, 'm1'), 'm1'), true);
});

test('bloqueo de edición es reversible y no cambia selección ni visibilidad', () => {
	const inicio = vistaMontajeInicial();
	const bloqueada = alternarBloqueoEnVista(inicio, 'km1');
	assert.equal(aparatoBloqueadoEnVista(inicio, 'km1'), false);
	assert.equal(aparatoBloqueadoEnVista(bloqueada, 'km1'), true);
	assert.equal(aparatoVisibleEnVista(bloqueada, 'km1'), true);
	assert.equal(aparatoBloqueadoEnVista(alternarBloqueoEnVista(bloqueada, 'km1'), 'km1'), false);
});

test('ocultar, aislar y restaurar vista no desbloquean; la depuración elimina IDs viejos', () => {
	const bloqueada = alternarBloqueoEnVista(vistaMontajeInicial(), 'km1');
	const oculta = alternarOcultacion(bloqueada, 'km1');
	const aislada = alternarAislamiento(oculta, ['q1']);
	const restaurada = restaurarVisibilidad(aislada);
	assert.equal(aparatoBloqueadoEnVista(restaurada, 'km1'), true);
	assert.equal(aparatoVisibleEnVista(restaurada, 'km1'), true);
	assert.equal(aparatoBloqueadoEnVista(depurarVistaMontaje(restaurada, new Set(['q1'])), 'km1'), false);
	assert.equal(aparatoBloqueadoEnVista(vistaMontajeInicial(), 'km1'), false);
});
