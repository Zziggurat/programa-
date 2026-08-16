/* En qué fase del recorrido de un cable cae cada conflicto. */
import { EJEMPLOS } from '/workspace/programa-/dist/ejemplo/biblioteca.js';
import { conflictosDe } from '/workspace/programa-/dist/app/colisiones-cables.js';
import { HOLGURA_CABLE, trazosDeCables, rutasDeCables } from '/workspace/programa-/dist/app/escena3d.js';
import { huellaCanaleta, RedCanaletas } from '/workspace/programa-/dist/app/canaletas-red.js';

const solo = process.argv[2];
for (const ej of EJEMPLOS) {
	if (solo && !ej.id.includes(solo)) continue;
	const p = ej.crear();
	const canal = p.gabinete?.canaletas ?? [];
	const cans = canal.map((c) => ({ id: c.id, ...huellaCanaleta(c), alto: c.alto }));
	const red = new RedCanaletas(canal);
	const rutas = rutasDeCables(p);
	const trazos = trazosDeCables(p);
	const porId = new Map(rutas.map((r) => [r.conductorId, r]));

	/* Fase de un punto para un cable dado. */
	const fase = (id, q) => {
		const r = porId.get(id);
		if (!r) return 'desconocida';
		const dDe = Math.hypot(q.x - r.de.x, q.y - r.de.y, q.z - r.de.z);
		const dA = Math.hypot(q.x - r.a.x, q.y - r.a.y, q.z - r.a.z);
		if (Math.min(dDe, dA) <= 14) return 'borne';
		const dentro = cans.filter((k) => q.x >= k.x0 && q.x <= k.x1 && q.y >= k.y0 && q.y <= k.y1 && q.z < k.alto);
		if (dentro.length > 1) return 'cruce de ductos';
		if (dentro.length === 1) return 'dentro de ducto';
		// fuera de ducto: ¿está cerca de su borne de salida o ya viajando?
		const cerca = Math.min(dDe, dA);
		if (cerca < 90) return dDe < dA ? 'abanico origen' : 'abanico destino';
		return 'tramo expuesto';
	};

	const conf = conflictosDe(trazos, HOLGURA_CABLE).filter((c) => c.holgura < 0);
	const cuenta = new Map();
	const peorPorFase = new Map();
	for (const c of conf) {
		// La fase se decide por el cable al que MÁS le duele: el que tiene el punto más cerca de su borne.
		const fa = fase(c.a, c.donde);
		const fb = fase(c.b, c.donde);
		const orden = ['borne', 'abanico origen', 'abanico destino', 'cruce de ductos', 'dentro de ducto', 'tramo expuesto'];
		const f = orden.indexOf(fa) <= orden.indexOf(fb) ? fa : fb;
		cuenta.set(f, (cuenta.get(f) ?? 0) + 1);
		if (!peorPorFase.has(f) || c.holgura < peorPorFase.get(f).holgura) peorPorFase.set(f, c);
	}
	console.log(`\n${ej.titulo}: ${conf.length} pares penetrados`);
	for (const [f, n] of [...cuenta].sort((x, y) => y[1] - x[1])) {
		const w = peorPorFase.get(f);
		console.log(`   ${String(n).padStart(3)}  ${f.padEnd(17)} peor ${w.holgura.toFixed(2)} (${w.a}/${w.b}) en (${w.donde.x.toFixed(0)},${w.donde.y.toFixed(0)},${w.donde.z.toFixed(0)})`);
	}
}
