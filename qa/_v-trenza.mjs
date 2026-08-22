/**
 * LA TRENZA DE MASA Y LOS AJUSTES DEL MAZO, DESDE LA INTERFAZ DE VERDAD.
 *
 * Dos cosas que solo valen si llegan hasta la geometría. La trenza no es un conductor del
 * esquema —no se numera, no se energiza, no se pincha— pero sí es una cosa que cruza una bisagra
 * y que por tanto tiene el mismo problema que el mazo: no puede quedar tirante ni asomar por
 * fuera de la chapa. Y los ajustes del mazo no son una pantalla de opciones: si mover la holgura
 * no cambia el lazo, lo que hay es un formulario decorativo.
 *
 * Se toca todo por la interfaz, con los mismos campos que tiene delante el usuario.
 */
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { servir, abrirEjemplo, SALIDA, puerta, navegadorDelSistema } from './lib/mirar.mjs';

const sv = await servir();
const b = await chromium.launch({
	...(navegadorDelSistema() ? { executablePath: navegadorDelSistema() } : {}),
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
p.setDefaultTimeout(120_000);
const errores = [];
p.on('pageerror', (e) => errores.push(e.message));
const fallos = [];
const ok = (bien, t) => { console.log(`${bien ? 'OK ' : 'MAL'} ${t}`); if (!bien) fallos.push(t); };

console.log(await abrirEjemplo(p, sv.address().port, 2));

/** Abre el cajón de montaje, donde viven los campos de la puerta y del mazo. */
async function abrirMontaje() {
	await p.evaluate(() => document.getElementById('hta-estructura')?.click());
	await p.waitForTimeout(500);
	await p.evaluate(() => {
		const d = document.getElementById('seccion-estructura');
		if (d) d.open = true;
	});
	await p.waitForTimeout(300);
}
const aplicar = async () => {
	await p.evaluate(() => document.getElementById('aplicar-dim')?.click());
	await p.waitForTimeout(1600);
};
const largoLazo = async (id) => (await p.evaluate(() => window.qa.mazoPuerta())).largos[id];

/* ---- 1. Sin trenza no hay trenza ---- */
{
	const t = await p.evaluate(() => window.qa.trenza());
	ok(t === undefined, 'un tablero que no la pide no la lleva dibujada');
}

await abrirMontaje();

/* ---- 2. La holgura del lazo llega hasta la geometría ---- */
{
	const antes = await largoLazo('w51');
	await p.fill('#mazo-holgura', '90');
	await aplicar();
	const desp = await largoLazo('w51');
	console.log(`   lazo de w51: ${antes.toFixed(0)} → ${desp.toFixed(0)} mm con 90 mm de holgura`);
	ok(desp > antes + 30, `subir la holgura alarga el lazo (${antes.toFixed(0)} → ${desp.toFixed(0)} mm)`);
	// Y se guarda SOLO lo que el usuario apartó de lo propuesto.
	const guardado = await p.evaluate(() => window.qa.proyecto().gabinete.mazoPuerta);
	console.log(`   guardado: ${JSON.stringify(guardado)}`);
	ok(guardado?.holgura === 90, 'la holgura queda escrita en el proyecto');
	ok(guardado?.pasoSujecion === undefined && guardado?.desdeBisagra === undefined,
		'y lo que nadie tocó NO se escribe (sigue siendo una propuesta)');

	await p.fill('#mazo-holgura', '0');
	await aplicar();
	const vuelta = await largoLazo('w51');
	ok(Math.abs(vuelta - antes) < 6, `y volver a cero devuelve el lazo (${vuelta.toFixed(0)} mm)`);
	ok(await p.evaluate(() => window.qa.proyecto().gabinete.mazoPuerta) === undefined,
		'con todo en lo propuesto, el ajuste desaparece del proyecto');
}

/* ---- 3. El paso de amarre llega a las sujeciones ---- */
{
	const antes = (await p.evaluate(() => window.qa.mazoPuerta())).sujeciones;
	await p.fill('#mazo-paso', '50');
	await aplicar();
	const desp = (await p.evaluate(() => window.qa.mazoPuerta())).sujeciones;
	console.log(`   amarres: ${antes} → ${desp} al bajar el paso de 110 a 50 mm`);
	ok(desp > antes, `amarrar más a menudo pone más amarres (${antes} → ${desp})`);
	await p.fill('#mazo-paso', '110');
	await aplicar();
}

/* ---- 4. La trenza de masa: existe, no se pincha y no asoma por fuera ---- */
{
	await p.evaluate(() => { document.getElementById('caja-bonding').checked = true; });
	await aplicar();
	// CON LA PUERTA CERRADA, que es cuando «no asomar por delante de la chapa» significa algo:
	// abierta, la hoja se ha ido de sitio y su cara exterior ya no es la frontera de nada.
	await puerta(p, 0);
	const t = await p.evaluate(() => window.qa.trenza());
	ok(!!t, 'marcada la casilla, la trenza está tendida');
	if (t) {
		console.log(`   trenza Ø${(t.radio * 2).toFixed(1)} · reserva ${t.reserva.toFixed(0)} mm · zMax ${t.zMax.toFixed(0)}`);
		ok(t.conductor === undefined && t.raycastPropio,
			`no le roba el clic a ningún conductor del esquema (conductor ${t.conductor} · rayos apagados ${t.raycastPropio})`);
		// La cara EXTERIOR de la hoja, medida por el programa: por delante de ahí ya se ve desde
		// fuera del armario con la puerta cerrada.
		ok(t.zMax <= t.caraHoja, `y no asoma por delante de la hoja (z ${t.zMax.toFixed(0)} ≤ ${t.caraHoja.toFixed(0)})`);
		// No se cuenta con los conductores: el mazo de mando sigue teniendo los suyos.
		const m = await p.evaluate(() => window.qa.mazoPuerta());
		ok(m.conductores.length === 4, `y no se cuela en el mazo de mando (${m.conductores.length} lazos)`);
	}
}

/* ---- 5. Y aguanta abrir la puerta, que es lo único que la deforma ---- */
{
	const largos = [];
	for (const t of [0, 0.35, 0.7, 1]) {
		await puerta(p, t);
		const q = await p.evaluate(() => window.qa.trenza());
		largos.push(q ? q.reserva : 0);
		if (t === 1 && q) console.log(`   con la puerta abierta del todo, zMax de la trenza ${q.zMax.toFixed(0)}`);
	}
	// La reserva es lo que hay CORTADO: no cambia al abrir. Si cambiara, el cable se estaría
	// estirando, que es exactamente lo que un lazo de servicio existe para evitar.
	ok(largos.every((l) => Math.abs(l - largos[0]) < 0.5), `la trenza no se estira al abrir (${largos.map((l) => l.toFixed(0)).join(' · ')})`);
	await puerta(p, 1);
	await p.screenshot({ path: join(SALIDA, 'v-trenza-abierta.png') });
	await puerta(p, 0);
	await p.screenshot({ path: join(SALIDA, 'v-trenza-cerrada.png') });
}

/* ---- 6. Entradas de cable declaradas ---- */
{
	await p.evaluate(() => document.getElementById('btn-add-entrada')?.click());
	await p.waitForTimeout(900);
	const e = await p.evaluate(() => window.qa.proyecto().gabinete.entradas);
	console.log(`   entradas declaradas: ${JSON.stringify(e)}`);
	ok(Array.isArray(e) && e.length === 1 && e[0].rosca === 'M20', 'se puede declarar una entrada de cable');
	const fila = await p.evaluate(() => !!document.querySelector('.fila-estructura[data-tipo="entrada"]'));
	ok(fila, 'y sale en la lista para editarla');
	await p.evaluate(() => {
		const f = document.querySelector('.fila-estructura[data-tipo="entrada"] [data-campo="x"]');
		f.value = '150';
	});
	await aplicar();
	const movida = await p.evaluate(() => window.qa.proyecto().gabinete.entradas[0].x);
	ok(movida === 150, `y moverla la mueve (x = ${movida})`);
}

console.log(errores.length ? `ERRORES JS: ${errores.join(' | ')}` : 'sin errores de JavaScript');
if (errores.length) fallos.push('errores de JavaScript');
console.log(fallos.length ? `\n${fallos.length} FALLOS` : '\nTODO PASA');
await b.close(); sv.close(); process.exit(0);
