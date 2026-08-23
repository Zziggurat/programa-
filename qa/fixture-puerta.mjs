/**
 * Regresión compacta de navegador para el fixture permanente de puerta.
 *
 * La semántica y la geometría fina viven en `test/fixture-puerta.test.ts`, donde tardan menos de
 * un segundo. Aquí solo se comprueba la integración real: biblioteca → escena → puerta móvil →
 * mazo/PE/bonding, sin sumar otra suite al gate estable de trece minutos.
 */
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { abrirNavegador, servidorDeQA } from './lib/entorno.mjs';
import { abrirEjemplo, puerta } from './lib/mirar.mjs';

const { servidor, url } = await servidorDeQA();
// ANGLE escribe `debug.log` en el directorio actual de Windows. El navegador trabaja en un cwd
// temporal propio para que una regresión verde no ensucie el repositorio.
const cwdInicial = process.cwd();
const cwdNavegador = mkdtempSync(join(tmpdir(), 'qa-fixture-puerta-'));
process.chdir(cwdNavegador);
let navegador;
let fallos = 0;
const errores = [];
const must = (nombre, condicion, extra = '') => {
	if (!condicion) fallos++;
	console.log(`${condicion ? 'OK  ' : 'FAIL'}  ${nombre}${extra ? ` → ${extra}` : ''}`);
};

try {
	navegador = await abrirNavegador(chromium);
	const p = await navegador.newPage({ viewport: { width: 1400, height: 900 } });
	p.setDefaultTimeout(90_000);
	p.on('console', (m) => {
		if (m.type() === 'error' && !/favicon|404|Not Found/i.test(m.text())) errores.push(m.text());
	});
	p.on('pageerror', (e) => errores.push(`PAGEERROR: ${e.message}`));

	// Es el sexto ejemplo y se añade al final para no mover los índices históricos del QA.
	const nombre = await abrirEjemplo(p, new URL(url).port, 5);
	must('se abre el fixture permanente desde la biblioteca', /semántica completa de puerta/i.test(nombre), nombre);

	const proyecto = await p.evaluate(() => window.qa.proyecto());
	const borne = (d, b) => proyecto.dispositivos.find((x) => x.id === d)?.bornes.find((x) => x.id === b);
	must('0V conserva tipo funcional', borne('x1', '0V')?.tipo === 'control', JSON.stringify(borne('x1', '0V')));
	must('el punto de hoja conserva tipo PE', borne('pe-hoja', 'PE')?.tipo === 'PE', JSON.stringify(borne('pe-hoja', 'PE')));
	must('las clases no están forzadas para aprobar el fixture', proyecto.conductores.every((c) => c.clase === undefined));

	const mazo = await p.evaluate(() => window.qa.mazoPuerta());
	must('el mazo de mando contiene solo ida y retorno funcional',
		JSON.stringify(mazo.conductores) === JSON.stringify(['w-mando', 'w-0v-puerta']), mazo.conductores.join(', '));
	must('el PE aislado usa el corredor de protección',
		JSON.stringify(mazo.protecciones) === JSON.stringify(['w-pe-puerta']), mazo.protecciones.join(', '));
	must('el cable de campo queda fuera del mazo',
		!mazo.conductores.includes('w-campo') && !mazo.protecciones.includes('w-campo'));
	must('los conductores internos quedan fuera del mazo',
		![...mazo.conductores, ...mazo.protecciones].some((id) => id.startsWith('w-int')));

	const trenza = await p.evaluate(() => window.qa.trenza());
	must('el bonding existe como entidad independiente', !!trenza);
	must('el bonding no se presenta como conductor seleccionable',
		trenza?.conductor === undefined && trenza?.raycastPropio === true);

	const donde = await p.evaluate(() => window.qa.dondeMazo());
	const porId = new Map(donde.porCable.map((c) => [c.id, c]));
	const xEntrada = (id) => Number(porId.get(id)?.guia?.[0]?.split(',')[0]);
	const xPe = xEntrada('w-pe-puerta');
	const separaciones = ['w-mando', 'w-0v-puerta'].map((id) => Math.abs(xEntrada(id) - xPe));
	must('mando y PE ocupan corredores distintos en la hoja',
		separaciones.every((d) => Number.isFinite(d) && d >= 6), separaciones.map((d) => d.toFixed(1)).join(' / '));

	const forma = (m) => JSON.stringify({
		enLaPuerta: m.enLaPuerta, flexibles: m.flexibles, sujeciones: m.sujeciones,
		conductores: m.conductores, protecciones: m.protecciones,
	});
	const formaInicial = forma(mazo);
	const reservas = [];
	const centros = [];
	for (const [etiqueta, t] of [['cerrada', 0], ['parcial', 0.5], ['abierta', 1]]) {
		await puerta(p, t);
		const actual = await p.evaluate(() => ({
			mazo: window.qa.mazoPuerta(), donde: window.qa.dondeMazo(), trenza: window.qa.trenza(),
		}));
		must(`la puerta ${etiqueta} no crea ni pierde geometrías`, forma(actual.mazo) === formaInicial);
		const caja = actual.donde.porCable.find((c) => c.id === 'w-mando')?.hoja;
		const finitos = caja && Object.values(caja.min).concat(Object.values(caja.max)).every(Number.isFinite);
		must(`la geometría con puerta ${etiqueta} permanece finita`, !!finitos);
		reservas.push(actual.trenza?.reserva);
		centros.push(caja ? (caja.min.x + caja.max.x) / 2 : Number.NaN);
	}
	must('abrir la puerta mueve el tramo solidario con la hoja', Math.abs(centros[2] - centros[0]) > 20,
		centros.map((x) => x.toFixed(1)).join(' → '));
	must('la reserva de bonding no cambia al abrir', reservas.every((r) => r === reservas[0]), reservas.join(' / '));

	const dibujados = await p.evaluate(() => window.qa.cablesDibujados());
	must('no hay conductores fantasma', dibujados === proyecto.conductores.length,
		`${dibujados}/${proyecto.conductores.length}`);
	must('sin errores de JavaScript', errores.length === 0, errores.slice(0, 3).join(' | '));
} catch (error) {
	fallos++;
	console.error(error?.stack ?? error);
} finally {
	if (navegador) await navegador.close();
	await new Promise((resolve) => servidor.close(resolve));
	process.chdir(cwdInicial);
	rmSync(cwdNavegador, { recursive: true, force: true });
}

console.log(fallos === 0 ? '\n=== TODO OK ✔ ===' : `\n=== ${fallos} FALLOS ===`);
process.exit(fallos === 0 ? 0 : 1);
