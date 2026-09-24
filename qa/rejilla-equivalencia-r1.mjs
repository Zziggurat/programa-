/**
 * Equivalencia bit a bit del ruteo antes/después de mantener físicamente la rejilla.
 * Ejecutar tras `tsc`: `node qa/rejilla-equivalencia-r1.mjs`.
 * Deliberadamente fuera del gate rápido: R1 y estrella-triángulo hacen reparto completo.
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { EJEMPLOS } from '../dist/ejemplo/biblioteca.js';
import { cargarProyecto } from '../dist/src/modelo/cargar.js';
import { invalidarCacheRuteo, rutasDeCables } from '../dist/app/escena3d.js';
import { crearDensidadR1 } from './lib/densidad-r1.mjs';

const ejemplo = (id) => {
	const e = EJEMPLOS.find((x) => x.id === id);
	if (!e) throw new Error(`Falta el ejemplo ${id}`);
	return e.crear();
};

// Hashes del reparto anterior (HEAD 962bcc5), sobre proyectos normalizados por cargarProyecto.
// Incluyen puntos 3D completos, radio, profundidad y orden de salida; no redondean coordenadas.
const casos = [
	['arranque-directo', () => ejemplo('arranque-directo'), 28,
		'33e460c49967b04eaedca41119756c3291a7f71bd3cd75bc4d21824a73a876c2'],
	['control-24v', () => ejemplo('control-24v'), 23,
		'45e13bc1fdd19d0e95bce2f669664d0b9c6bbefbbe67d4fdbcd18e14b200b442'],
	['estrella-triangulo', () => ejemplo('estrella-triangulo'), 59,
		'e78c976af0cf5e60a87c56968f1e19f2cbc44978d10f74a0a555009437a07560'],
	['R1', crearDensidadR1, 98,
		'c907eb6594d6565ca3cb4659a5073e20a668626d09c09e368fdc369f2cb3022a'],
	['R1+drag aux-b', () => {
		const p = crearDensidadR1();
		p.gabinete.colocaciones.find((c) => c.dispositivoId === 'aux-b').x += 12;
		return p;
	}, 98, 'bc123f7aa429afc59201b12eb775ea6599bf0a9a2c2b48adf8eb4a96a8756073'],
];

for (const [id, crear, cantidad, esperado] of casos) {
	const proyecto = cargarProyecto(JSON.stringify(crear())).proyecto;
	invalidarCacheRuteo();
	const inicio = performance.now();
	const rutas = rutasDeCables(proyecto);
	const ms = Math.round(performance.now() - inicio);
	const hash = createHash('sha256').update(JSON.stringify(rutas)).digest('hex');
	if (rutas.length !== cantidad || hash !== esperado)
		throw new Error(`${id}: rutas ${rutas.length}/${cantidad}; SHA256 ${hash}, esperado ${esperado}`);
	console.log(`OK ${id}: ${rutas.length} rutas idénticas · ${ms} ms · ${hash}`);
}
console.log(`5/5 escenarios de reparto idénticos; ninguna ruta, profundidad o carril cambió.`);
