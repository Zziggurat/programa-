/**
 * QA del GUARDADO AUTOMÁTICO: lo que haces sigue ahí al recargar. Todo, no casi todo.
 *
 * Auditoría TS-P1-08. La propuesta de la auditoría era arquitectónica —un `commitProyecto()` por
 * el que pasara todo cambio— y el motivo era que hay muchos sitios que tocan `proyecto` y cada uno
 * tiene que acordarse de llamar a `recalcular()`, que es quien guarda. El que se olvide no da
 * ningún error: simplemente ese cambio no llega al disco, y se pierde al cerrar la pestaña.
 *
 * Antes de mover la arquitectura hay que saber si eso PASA de verdad y en qué sitios, porque un
 * refactor grande sobre la parte que guarda el trabajo de la gente es exactamente donde no se
 * quiere andar a ciegas. Así que esta prueba no mira el código: hace una jornada de trabajo
 * corriente —de las que se hacen en un rato— y luego RECARGA LA PÁGINA y comprueba, dato a dato,
 * qué sobrevivió.
 *
 * Es la pregunta del usuario, no la del programador: «si se me cierra el navegador, ¿pierdo esto?».
 *
 *   node qa/se-guarda-solo.mjs
 */
import { chromium } from 'playwright-core';
import http from 'node:http'; import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const AQUI = dirname(fileURLToPath(import.meta.url)); const ROOT = join(AQUI, '..', 'app', 'dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const s = http.createServer((q, r) => {
	let u = decodeURIComponent(q.url.split('?')[0]); if (u === '/') u = '/index.html';
	const f = join(ROOT, u); if (!existsSync(f)) { r.statusCode = 404; r.end(''); return; }
	r.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream'); r.end(readFileSync(f));
});
await new Promise((r) => s.listen(0, r));
const b = await chromium.launch({
	executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
	args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
let fallos = 0;
const must = (n, c, x = '') => { if (!c) fallos++; console.log(`${c ? 'OK  ' : 'FAIL'}  ${n}${x ? ' → ' + x : ''}`); };
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

await p.goto(`http://127.0.0.1:${s.address().port}/?qa=1&inicio=0`);
await p.waitForTimeout(1600);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.evaluate(() => document.getElementById('modo-editor')?.click());
await p.waitForTimeout(300);

/** Escribe en un campo como lo haría una persona. */
const escribir = (id, valor) => p.evaluate(({ id, valor }) => {
	const e = document.getElementById(id);
	if (!e) return false;
	e.value = String(valor);
	e.dispatchEvent(new Event('input', { bubbles: true }));
	e.dispatchEvent(new Event('change', { bubbles: true }));
	return true;
}, { id, valor });

/**
 * La huella del proyecto: lo que tendría que seguir igual tras recargar.
 *
 * Se comparan datos del MODELO, no píxeles: lo que se guarda es el proyecto, y si el proyecto
 * está entero lo demás se vuelve a dibujar solo.
 */
const huella = () => p.evaluate(() => {
	const pr = window.qa.proyecto();
	const g = pr.gabinete ?? {};
	return {
		nombre: pr.nombre,
		aparatos: pr.dispositivos.length,
		cables: pr.conductores.length,
		colocaciones: (g.colocaciones ?? []).length,
		rieles: (g.rieles ?? []).length,
		placa: `${g.ancho}×${g.alto}`,
		cliente: pr.datos?.cliente ?? '',
		obra: pr.datos?.obra ?? '',
		revision: pr.datos?.revision ?? '',
		icc: pr.opciones?.iccPresuntaKA ?? null,
		ambiente: pr.opciones?.temperaturaAmbienteC ?? null,
		columnasEsquema: pr.esquema?.columnasPorHoja ?? null,
		empresaDossier: pr.dossier?.empresa?.nombre ?? '',
		// La designación y la ficha del PRIMER aparato: es lo que se edita a mano en el panel.
		primero: (() => {
			const d = pr.dispositivos.find((x) => !x.campo);
			return d ? `${d.designacion ?? ''}|${d.descripcion ?? ''}|${d.corrienteNominal ?? ''}` : '';
		})(),
	};
});

/* ------------------------- Una jornada de trabajo corriente ------------------------- */

console.log('--- se hace un rato de trabajo ---');

// 1. Sacar aparatos del catálogo y soltarlos.
await p.evaluate(() => window.qa.medirAnadir('disyuntor-1p', 3));
await p.mouse.click(700, 500);
await p.waitForTimeout(500);

// 2. Ponerle nombre al proyecto.
await escribir('nombre-proyecto', 'Tablero UMA-3-343 cubierta');
await p.waitForTimeout(300);

// 3. Datos del proyecto (cliente, obra, revisión) y las opciones de la instalación.
await p.evaluate(() => document.getElementById('btn-datos-proyecto')?.click());
await p.waitForTimeout(600);
const campos = await p.evaluate(() => [...document.querySelectorAll('#modal-proyecto input, #modal-proyecto select')]
	.map((e) => e.id).filter(Boolean));
await escribir('pr-cliente', 'Nuevo Pudahuel');
await escribir('pr-obra', 'Terminal Internacional');
await escribir('pr-revision', 'B');
await escribir('pr-icc', '6');
await escribir('pr-ambiente', '40');
await p.evaluate(() => document.getElementById('btn-guardar-proyecto')?.click());
await p.waitForTimeout(600);

// 4. Tocar la estructura: agrandar la placa y añadir un riel.
await p.evaluate(() => { document.getElementById('seccion-estructura').open = true; });
await escribir('dim-ancho', 80);
await p.click('#aplicar-dim');
await p.waitForTimeout(500);
await p.click('#btn-add-riel');
await p.waitForTimeout(500);

// 5. Editar la ficha del primer aparato, que es donde se corrigen los datos de catálogo.
await p.evaluate(() => window.qa.seleccionarPorId(window.qa.proyecto().gabinete.colocaciones[0].dispositivoId));
await p.waitForTimeout(400);
const fichaEditada = await escribir('dev-descripcion', 'Disyuntor de la bomba de condensados');
await p.waitForTimeout(400);

/*
 * 6. Cablear dos bornes a clics, que es el trabajo de verdad.
 *
 * Se hace en modo Trabajo —en Editor el clic mueve el aparato, no cablea— y se prueban PARES
 * hasta que uno entra: los bornes tapados por otro aparato no se pueden pinchar, y cuál queda
 * tapado depende del ángulo de la cámara. Que el paso se quede en nada y la prueba diga después
 * «0 cables antes, 0 después: OK» sería un aprobado que no vale, así que si no consigue tender
 * ninguno se dice y cuenta como fallo.
 */
await p.evaluate(() => document.getElementById('modo-trabajo')?.click());
await p.waitForTimeout(600);
const bornes = await p.evaluate(() => window.qa.bornes());
let cableado = false;
for (const a of bornes) {
	if (cableado) break;
	for (const z of bornes) {
		if (z.dispositivo === a.dispositivo) continue;
		const pa = await p.evaluate(({ d, b }) => window.qa.puntoParaBorne(d, b), { d: a.dispositivo, b: a.borne });
		const pb = await p.evaluate(({ d, b }) => window.qa.puntoParaBorne(d, b), { d: z.dispositivo, b: z.borne });
		if (!pa || !pb) continue;
		await p.mouse.click(pa.x, pa.y); await p.waitForTimeout(250);
		await p.mouse.click(pb.x, pb.y); await p.waitForTimeout(450);
		cableado = await p.evaluate(() => window.qa.proyecto().conductores.length > 0);
		if (cableado) break;
		await p.keyboard.press('Escape'); await p.waitForTimeout(150);
	}
}
must('CONDICIÓN PREVIA: se llegó a tender un cable', cableado,
	cableado ? 'sí' : 'ningún par de bornes era pinchable: el paso de cablear no prueba nada');
await p.evaluate(() => document.getElementById('modo-editor')?.click());
await p.waitForTimeout(400);

// 7. Ajustes del dossier: la empresa que firma.
await p.evaluate(() => document.getElementById('btn-pdf')?.click());
await p.waitForTimeout(3000);
const empresaEditada = await escribir('dos-empresa-nombre', 'SERMAN');
await p.waitForTimeout(800);
await p.evaluate(() => document.getElementById('dos-cerrar')?.click());
await p.waitForTimeout(800);

const antes = await huella();
console.log(JSON.stringify(antes, null, 1));
must('CONDICIÓN PREVIA: el rato de trabajo cambió el proyecto de verdad',
	antes.aparatos >= 3 && antes.nombre.includes('UMA-3-343'),
	`${antes.aparatos} aparatos, «${antes.nombre}»`);
must('CONDICIÓN PREVIA: los campos de la ventana de proyecto existen',
	campos.includes('pr-cliente') && campos.includes('pr-icc'), campos.slice(0, 8).join(', '));

/* ------------------------- Y ahora se cierra el navegador ------------------------- */

console.log('\n--- se recarga la página, como si se hubiera cerrado el navegador ---');
await p.reload();
await p.waitForTimeout(2500);
await p.evaluate(() => document.getElementById('btn-cerrar-ayuda')?.click());
await p.waitForTimeout(400);
const despues = await huella();

const nombreDe = {
	nombre: 'el nombre del proyecto',
	aparatos: 'los aparatos sacados del catálogo',
	cables: 'los cables tendidos',
	colocaciones: 'dónde quedó montado cada aparato',
	rieles: 'los rieles',
	placa: 'el tamaño de la placa',
	cliente: 'el cliente',
	obra: 'la obra',
	revision: 'la revisión',
	icc: 'la Icc presunta',
	ambiente: 'la temperatura ambiente',
	columnasEsquema: 'las columnas del esquema',
	empresaDossier: 'la empresa que firma el dossier',
	primero: 'la ficha del aparato editada a mano',
};
for (const [clave, comoSeLlama] of Object.entries(nombreDe)) {
	// Solo se exige lo que la jornada llegó a cambiar: lo que no se tocó no prueba nada.
	const seTocó = clave === 'columnasEsquema' ? false
		: clave === 'empresaDossier' ? empresaEditada
			: clave === 'primero' ? fichaEditada
				: true;
	if (!seTocó) continue;
	must(`sobrevive ${comoSeLlama}`, JSON.stringify(antes[clave]) === JSON.stringify(despues[clave]),
		`antes ${JSON.stringify(antes[clave])} · después ${JSON.stringify(despues[clave])}`);
}

must('sin errores de JavaScript', errs.length === 0, errs.slice(0, 2).join(' | ') || 'ninguno');

console.log(`\n${fallos === 0 ? '✅ NO SE PIERDE NADA' : `❌ ${fallos} COSA(S) SE PIERDEN AL RECARGAR`}`);
await b.close(); s.close();
process.exit(fallos ? 1 : 0);
