import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	base64ABytes, bytesABase64, hidratarImagenesDeProyecto, proyectoParaPersistir,
} from '../src/componentes/assets.js';
import { crearProyecto } from '../src/modelo/proyecto.js';

const proyectoConAsset = () => {
	const p = crearProyecto('Con asset');
	p.dispositivos = [{
		id: 'k1', tipo: 'contactor', bornes: [], assetId: `sha256:${'a'.repeat(64)}`,
		imagen: 'blob:runtime-anterior',
		comportamiento: {
			version: 1, clase: 'contactos-electromagneticos',
			bobina: { entrada: 'A1', retorno: 'A2' }, polos: [], contactos: [],
		},
	}];
	return p;
};

test('la copia persistente conserva el asset y elimina solamente la URL runtime', () => {
	const original = proyectoConAsset();
	const guardable = proyectoParaPersistir(original);
	assert.equal(guardable.dispositivos[0].imagen, undefined);
	assert.match(guardable.dispositivos[0].assetId ?? '', /^sha256:/);
	assert.equal(guardable.dispositivos[0].comportamiento?.clase, 'contactos-electromagneticos');
	assert.equal(original.dispositivos[0].imagen, 'blob:runtime-anterior', 'no muta el editor');
});

test('hidratar deduplica lecturas, informa faltantes y revoca cada URL una sola vez', async () => {
	const p = proyectoConAsset();
	p.dispositivos.push({ ...structuredClone(p.dispositivos[0]), id: 'k2' });
	p.dispositivos.push({
		id: 'x1', tipo: 'otro', bornes: [], assetId: `sha256:${'b'.repeat(64)}`,
	});
	for (const d of p.dispositivos) delete d.imagen;
	const lecturas: string[] = [];
	const creadas: string[] = [];
	const revocadas: string[] = [];
	const h = await hidratarImagenesDeProyecto(p, async (id) => {
		lecturas.push(id);
		return id.includes('aaaa') ? { id, mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) } : undefined;
	}, {
		crear: () => { const url = `blob:prueba-${creadas.length + 1}`; creadas.push(url); return url; },
		revocar: (url) => revocadas.push(url),
	});
	assert.equal(lecturas.filter((id) => id.includes('aaaa')).length, 1, 'un asset compartido se abre una vez');
	assert.deepEqual(h.proyecto.dispositivos.slice(0, 2).map((d) => d.imagen), ['blob:prueba-1', 'blob:prueba-2']);
	assert.deepEqual(h.faltantes, [`sha256:${'b'.repeat(64)}`]);
	h.liberar(); h.liberar();
	assert.deepEqual(revocadas, creadas);
});

test('base64 portable conserva bytes binarios', () => {
	const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
	assert.deepEqual(base64ABytes(bytesABase64(bytes)), bytes);
});
