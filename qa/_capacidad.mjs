import { EJEMPLOS } from '/workspace/programa-/dist/ejemplo/biblioteca.js';
import { trazosDeCables, radioDeCable } from '/workspace/programa-/dist/app/escena3d.js';
import { RedCanaletas, ESPESOR } from '/workspace/programa-/dist/app/canaletas-red.js';
import {
	auditarTramo, tramoQueQuerria, seccionNecesaria, medidaRecomendada,
} from '/workspace/programa-/dist/app/capacidad-canaletas.js';

const soloEste = process.argv[2];
for (const ej of EJEMPLOS) {
	if (soloEste && !ej.id.includes(soloEste)) continue;
	const p = ej.crear();
	const canal = p.gabinete?.canaletas ?? [];
	if (!canal.length) continue;
	const red = new RedCanaletas(canal);
	const trazos = trazosDeCables(p);
	const radioMax = Math.max(...trazos.map((t) => t.radio));

	// ¿quién está dentro de algún tramo? (por longitud recorrida dentro de la huella interior)
	const dentroDe = new Map();
	for (const t of red.tramos) {
		for (const tr of trazos) {
			let largo = 0;
			for (let i = 1; i < tr.puntos.length; i++) {
				const a = tr.puntos[i - 1], b = tr.puntos[i];
				const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
				const eje = t.esH ? m.x : m.y, cruz = t.esH ? m.y : m.x;
				if (eje < t.desde || eje > t.hasta) continue;
				if (Math.abs(cruz - t.centro) > t.semiancho) continue;
				if (m.z < t.zMin || m.z > t.zMax) continue;
				largo += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
			}
			if (largo > 20) {
				if (!dentroDe.has(tr.id)) dentroDe.set(tr.id, []);
				dentroDe.get(tr.id).push(t.id);
			}
		}
	}

	// demanda insatisfecha: cables fuera y a qué tramo habrían querido ir
	const demanda = new Map();
	const radiosPorTramo = new Map();
	for (const c of p.conductores) {
		const tr = trazos.find((q) => q.id === c.id);
		if (!tr) continue;
		const a = tr.puntos[0], b = tr.puntos[tr.puntos.length - 1];
		const quiere = tramoQueQuerria(red, a, b);
		if (!quiere) continue;
		if (!radiosPorTramo.has(quiere)) radiosPorTramo.set(quiere, []);
		radiosPorTramo.get(quiere).push(tr.radio);
		if (dentroDe.has(c.id)) continue;
		if (!demanda.has(quiere)) demanda.set(quiere, []);
		demanda.get(quiere).push(c.id);
	}

	console.log(`\n=== ${ej.titulo} · ${trazos.length} conductores, ${dentroDe.size} por canaleta ===`);
	console.log('canaleta | interior   | seccion | cables | ocup max | hueco libre | ranuras   | estado    | motivo');
	for (const t of red.tramos) {
		const a = auditarTramo(t, trazos, radioMax, demanda.get(t.id) ?? []);
		console.log(
			`${a.id.padEnd(8)} | ${String(a.anchoInterior).padStart(3)}x${String(a.altoInterior).padEnd(3)}    | ` +
			`${String(Math.round(a.seccion)).padStart(6)} | ${String(a.cables.length).padStart(6)} | ` +
			`${(a.ocupacionMaxima * 100).toFixed(1).padStart(7)}% | ` +
			`Ø${(a.radioLibreMinimo * 2).toFixed(1).padStart(5)} mm | ` +
			`${String(a.ranurasUsadas).padStart(2)}/${String(a.ranurasTotales).padEnd(2)} sat ${String(a.ranurasSaturadas).padStart(2)} | ` +
			`${a.estado.padEnd(9)} | ${a.motivo}`,
		);
		const fuera = demanda.get(t.id) ?? [];
		const radios = radiosPorTramo.get(t.id) ?? [];
		if (fuera.length) {
			const nec = seccionNecesaria(radios);
			const med = medidaRecomendada(nec, radioMax, ESPESOR);
			console.log(`         | demanda: ${radios.length} conductores lo querrían (${fuera.length} se quedaron fuera)`);
			console.log(`         | seccion necesaria al 45% de llenado: ${Math.round(nec)} mm2 · tiene ${Math.round(a.seccion)} · recomendada ${med ? `${med.ancho}x${med.alto}` : 'ninguna de la escalera'}`);
			console.log(`         | por diametro dentro: ${a.porRadio.map((q) => `Ø${(q.radio * 2).toFixed(1)}×${q.n}`).join(' ')}`);
		}
		if (process.argv.includes('--bocas')) {
			const llenas = a.bocas.filter((q) => q.cables.length).sort((x, y) => y.usado - x.usado);
			console.log('         | bocas usadas:', llenas.slice(0, 10).map((q) => `${Math.round(q.eje)}:${q.usado.toFixed(1)}mm(${q.cables.length})`).join(' '));
		}
	}
}
