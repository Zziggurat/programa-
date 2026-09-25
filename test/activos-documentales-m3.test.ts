import assert from 'node:assert/strict';
import test from 'node:test';
import { activosIncrustablesEnDossier } from '../src/modelo/activos-documentales.js';
import { crearProyecto } from '../src/modelo/proyecto.js';

test('DOC-08: solo logo y bloques de imagen con contenido requieren consentimiento para el ZIP', () => {
	const p = crearProyecto('Prueba');
	assert.deepEqual(activosIncrustablesEnDossier(p), { logo: false, imagenes: 0, total: 0 });
	p.dossier = { empresa: { logo: 'data:image/png;base64,AAAA' }, bloques: [
		{ id: 'a', tipo: 'imagen', donde: 'portada', imagen: 'data:image/png;base64,AAAA' },
		{ id: 'b', tipo: 'imagen', donde: 'final', imagen: 'data:image/png;base64,BBBB' },
		{ id: 'c', tipo: 'imagen', donde: 'principio' },
		{ id: 'd', tipo: 'texto', donde: 'final', trozos: [{ texto: 'Texto ordinario' }] },
	] };
	assert.deepEqual(activosIncrustablesEnDossier(p), { logo: true, imagenes: 2, total: 3 });
	p.dossier.empresa = undefined;
	assert.deepEqual(activosIncrustablesEnDossier(p), { logo: false, imagenes: 2, total: 2 });
});
