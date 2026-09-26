/**
 * CAB-24: reproduccion focal de una edicion que redistribuye cables ajenos.
 *
 * No integra el gate verde: --assert-locality sale con codigo 1 mientras el
 * producto no preserve las rutas. Requiere compilar TypeScript antes de correr.
 */
import { EJEMPLOS } from '../dist/ejemplo/biblioteca.js';
import { rutasDeCables } from '../dist/app/escena3d.js';
import { leerRutaFisicaV1 } from '../dist/src/modelo/ruta-fisica.js';
import { cargarProyecto, VERSION_FORMATO } from '../dist/src/modelo/cargar.js';

const ejemplo = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo));
if (!ejemplo) throw new Error('Falta el ejemplo de arranque directo.');
const proyecto = ejemplo.crear();
const editado = proyecto.conductores.find((c) => c.id === 'w4');
if (!editado) throw new Error('Falta w4 en el ejemplo de arranque directo.');

const firma = (ruta) => JSON.stringify({ puntos: ruta.puntos, nodos: ruta.nodos, z: ruta.z });
const antes = new Map(rutasDeCables(proyecto).map((r) => [r.conductorId, firma(r)]));
editado.rutaFisica = leerRutaFisicaV1({ version: 1, modo: 'MANUAL', marco: 'PLACA',
	geometria: 'POLILINEA', nodos: [
		{ id: 'w4:n1', x: 180, y: 110, z: 27 },
		{ id: 'w4:n2', x: 230, y: 110, z: 27 },
	] });
delete editado.trazado;
const despues = new Map(rutasDeCables(proyecto).map((r) => [r.conductorId, firma(r)]));
const ajenos = [...antes.keys()].filter((id) => id !== editado.id && despues.has(id));
const movidos = ajenos.filter((id) => antes.get(id) !== despues.get(id));
proyecto.version = VERSION_FORMATO;
const cargado = cargarProyecto(JSON.stringify(proyecto));
if (cargado.arreglos.length) throw new Error(`La reapertura altero el fixture: ${cargado.arreglos.join('; ')}`);
const reabierto = new Map(rutasDeCables(cargado.proyecto).map((r) => [r.conductorId, firma(r)]));
const seConservaCambio = ajenos.every((id) => despues.get(id) === reabierto.get(id));
const movidosTrasReapertura = ajenos.filter((id) => antes.get(id) !== reabierto.get(id));
console.log(JSON.stringify({ ejemplo: ejemplo.titulo, cableEditado: editado.id,
	cablesComparables: ajenos.length, ajenosMovidos: movidos.length, ids: movidos,
	ajenosMovidosTrasReapertura: movidosTrasReapertura.length,
	resultadoDeterministaTrasReapertura: seConservaCambio }, null, 2));
if (!seConservaCambio) throw new Error('El ruteo cambio de nuevo al reabrir el mismo proyecto.');
if (process.argv.includes('--assert-locality') && movidos.length) {
	console.error(`CAB-24 incumplido: editar ${editado.id} redistribuyo ${movidos.length} cables ajenos.`);
	process.exitCode = 1;
}
