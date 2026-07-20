/**
 * Corre todos los motores sobre el proyecto de ejemplo y escribe la documentación
 * en ejemplo/salida/: BOM, lista de conductores, planes de borneros e informe HTML.
 *
 *   npm run ejemplo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tableroEjemplo } from './tablero-ejemplo.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores, numerarDispositivos } from '../src/motores/numeracion.js';
import { verificarProyecto } from '../src/motores/drc.js';
import { generarReferencias } from '../src/motores/referencias.js';
import { generarPlanBorneros } from '../src/motores/bornes.js';
import { rutearConductores } from '../src/motores/ruteo.js';
import { sincronizarEsquemaGabinete } from '../src/motores/sincronizacion.js';
import {
	bomACSV, borneroACSV, conductoresACSV, generarBOM,
	generarInformeHTML, generarListaConductores,
} from '../src/motores/documentacion.js';

const proyecto = tableroEjemplo();

// 1. Numeración IEC de dispositivos, potenciales y numeración de conductores.
numerarDispositivos(proyecto);
const potenciales = calcularPotenciales(proyecto);
numerarConductores(proyecto, potenciales);

// 2. Motores de análisis.
const hallazgos = verificarProyecto(proyecto, potenciales);
const referencias = generarReferencias(proyecto);
const planesBorneros = generarPlanBorneros(proyecto, potenciales);
const ruteo = rutearConductores(proyecto);
const sincronizacion = sincronizarEsquemaGabinete(proyecto);

// 3. Salidas.
const carpeta = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ejemplo', 'salida');
mkdirSync(carpeta, { recursive: true });

writeFileSync(join(carpeta, 'bom.csv'), bomACSV(generarBOM(proyecto)));
writeFileSync(join(carpeta, 'conductores.csv'), conductoresACSV(generarListaConductores(proyecto, ruteo)));
for (const plan of planesBorneros) {
	writeFileSync(join(carpeta, `bornero-${plan.designacion.replaceAll(/[^\w-]/g, '_')}.csv`), borneroACSV(plan));
}
writeFileSync(
	join(carpeta, 'informe.html'),
	generarInformeHTML({ proyecto, potenciales, hallazgos, referencias, planesBorneros, ruteo, sincronizacion }),
);

// 4. Resumen por consola.
console.log(`Proyecto: ${proyecto.nombre}`);
console.log(`Dispositivos: ${proyecto.dispositivos.length} — Conductores: ${proyecto.conductores.length}`);
console.log(`Potenciales eléctricos: ${potenciales.potenciales.length}`);
console.log('\nDesignaciones IEC asignadas:');
for (const d of proyecto.dispositivos) console.log(`  ${(d.designacion ?? '').padEnd(8)} ${d.descripcion ?? d.id}`);
console.log('\nDRC:');
for (const h of hallazgos) console.log(`  [${h.severidad}] ${h.regla}: ${h.mensaje}`);
console.log('\nReferencias cruzadas:');
for (const x of referencias.cruzadas) {
	const contactos = x.contactos.map((c) => `${c.contacto} en ${c.posicion}`).join(', ') || '(sin contactos)';
	console.log(`  ${x.designacion} (${x.posicion}) → ${contactos}`);
}
console.log('\nRuteo de cables:');
for (const r of ruteo.rutas) {
	const c = proyecto.conductores.find((x) => x.id === r.conductorId)!;
	console.log(`  ${String(c.numero).padEnd(4)} ${r.longitudMm} mm por [${r.canaletasUsadas.join(', ')}]`);
}
for (const a of ruteo.avisos) console.log(`  (aviso) ${a}`);
console.log(`\nSincronización esquema↔gabinete: ${sincronizacion.sincronizado ? 'OK' : 'con diferencias'}`);
if (!sincronizacion.sincronizado) console.log(`  Faltan en gabinete: ${sincronizacion.faltanEnGabinete.join(', ')}`);
console.log(`\nDocumentación escrita en ${carpeta}`);
