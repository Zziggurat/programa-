import { claveDato, claveRevision, referenciaTecnica, type PaqueteTecnico, type ReferenciaTecnica, type RevisionTecnica } from './tipos.js';
import { DatosTecnicosInvalidos, inspeccionarDatosNoConfiables, parsearJsonTecnico, validarPaqueteTecnico, validarRevisionTecnica } from './schema.js';

/** Canon 1: claves ordenadas por código UTF-16; arrays conservan orden salvo conjuntos explícitos. */
export function jsonCanonico(v: unknown): string {
	if (v === null || typeof v !== 'object') {
		if (typeof v === 'number' && !Number.isFinite(v)) throw new DatosTecnicosInvalidos('No se canonizan números no finitos.');
		const s = JSON.stringify(v); if (s === undefined) throw new DatosTecnicosInvalidos('Valor no JSON.'); return s;
	}
	if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
	return `{${Object.keys(v).filter(k => (v as Record<string, unknown>)[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${jsonCanonico((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

// SHA-256 portable y síncrono para las fronteras puras Node/file://. No firma ni autentica
// documentos. Tests comparan bloques/padding/UTF-8 contra node:crypto y WebCrypto.
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
export function sha256Texto(texto: string): string {
	const bytes = new TextEncoder().encode(texto); const length = Math.ceil((bytes.length + 9) / 64) * 64;
	const data = new Uint8Array(length); data.set(bytes); data[bytes.length] = 0x80;
	const view = new DataView(data.buffer); view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(length - 4, bytes.length * 8);
	const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]); const w = new Uint32Array(64);
	for (let start = 0; start < length; start += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(start + i * 4);
		for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10)); }
		let [a,b,c,d,e,f,g,j] = h;
		for (let i = 0; i < 64; i++) { const t1 = (j + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0; const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0; j=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0; }
		[a,b,c,d,e,f,g,j].forEach((x, i) => { h[i] = (h[i] + x) >>> 0; });
	}
	return `sha256:${Array.from(h, x => x.toString(16).padStart(8, '0')).join('')}`;
}
export function contenidoCanonicoRevision(revision: RevisionTecnica): string {
	const { hash: _hash, ...r } = structuredClone(revision);
	// Campos condicionados y filas son conjuntos; puntos de curva/factor tienen orden técnico.
	if (r.tipo === 'PRODUCTO') {
		r.campos.sort((a,b) => comparar(`${claveDato(a)}:${jsonCanonico(a.condiciones ?? {})}`, `${claveDato(b)}:${jsonCanonico(b.condiciones ?? {})}`));
		if (r.gruposSalidas) { r.gruposSalidas.sort((a,b) => comparar(a.id,b.id)); r.gruposSalidas.forEach(g => g.canales.sort()); }
	} else if (r.tipo === 'AMPACIDAD') {
		r.filas.sort((a,b) => comparar(jsonCanonico(a), jsonCanonico(b))); r.factores.sort((a,b) => comparar(a.id,b.id));
		r.combinaciones.forEach(c => c.sort()); r.combinaciones.sort((a,b) => comparar(jsonCanonico(a),jsonCanonico(b)));
	}
	return jsonCanonico(r);
}
export const comparar = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function publicarRevision<T extends RevisionTecnica>(borrador: T): T {
	const r = structuredClone(borrador); r.hash = `sha256:${'0'.repeat(64)}`;
	validarRevisionTecnica(r); r.hash = sha256Texto(contenidoCanonicoRevision(r)); return r;
}
export function verificarRevision(r: RevisionTecnica): void {
	validarRevisionTecnica(r);
	if (r.hash !== sha256Texto(contenidoCanonicoRevision(r))) throw new DatosTecnicosInvalidos(`Integridad inválida: ${r.nombre} r${r.revision}. El hash no acredita autenticidad.`);
}
export function dependenciasRevision(r: RevisionTecnica): ReferenciaTecnica[] { return r.tipo === 'PRODUCTO' && r.curva ? [r.curva] : []; }
export function indexarRevisiones(revisiones: readonly RevisionTecnica[], verificar = true): Map<string, RevisionTecnica> {
	const mapa = new Map<string, RevisionTecnica>();
	for (const r of revisiones) { if (verificar) verificarRevision(r); const key = claveRevision(referenciaTecnica(r)); const previa = mapa.get(key); if (previa && previa.hash !== r.hash) throw new DatosTecnicosInvalidos(`CONFLICT: ${key} ya existe con otro contenido.`); mapa.set(key, r); }
	return mapa;
}
export function congelarSubconjunto(referencias: readonly ReferenciaTecnica[], disponibles: readonly RevisionTecnica[]): RevisionTecnica[] {
	const indice = indexarRevisiones(disponibles, false); const elegido = new Map<string, RevisionTecnica>();
	const visitar = (ref: ReferenciaTecnica): void => { const k = claveRevision(ref); const r = indice.get(k); if (!r || r.hash !== ref.hash) throw new DatosTecnicosInvalidos(`MISSING: dependencia exacta ${k}`); if (elegido.has(k)) return; verificarRevision(r); elegido.set(k, r); dependenciasRevision(r).forEach(visitar); };
	referencias.forEach(visitar); return structuredClone([...elegido.entries()].sort(([a],[b]) => comparar(a,b)).map(([,r]) => r));
}
function referenciasOrdenadas(revisiones: readonly RevisionTecnica[]): ReferenciaTecnica[] { return revisiones.map(referenciaTecnica).sort((a,b) => comparar(claveRevision(a), claveRevision(b))); }
export function crearPaqueteTecnico(revisiones: RevisionTecnica[]): PaqueteTecnico {
	const rs = congelarSubconjunto(revisiones.map(referenciaTecnica), revisiones); const referencias = referenciasOrdenadas(rs);
	return { formato: 'tablero-studio-datos-tecnicos', version: 1, canon: 1, revisiones: rs, manifiesto: { referencias, hash: sha256Texto(jsonCanonico(referencias)) } };
}
export function leerPaqueteTecnico(texto: string): PaqueteTecnico {
	const p = parsearJsonTecnico(texto); validarPaqueteTecnico(p); indexarRevisiones(p.revisiones);
	congelarSubconjunto(p.manifiesto.referencias, p.revisiones);
	if (p.manifiesto.hash !== sha256Texto(jsonCanonico(referenciasOrdenadas(p.revisiones)))) throw new DatosTecnicosInvalidos('Integridad inválida del manifiesto.');
	return p;
}
/** Mismos controles que el parser puro, cediendo el hilo durante los hashes costosos.
 * No se escribe nada y el candidato es local hasta completar TODA la validación. */
export async function leerPaqueteTecnicoAsync(texto: string, opciones: { signal?: AbortSignal; progreso?: (n: number, total: number) => void } = {}): Promise<PaqueteTecnico> {
	const comprobarCancelacion = () => { if (opciones.signal?.aborted) throw new DatosTecnicosInvalidos('Importación cancelada.'); };
	comprobarCancelacion();
	await new Promise<void>(resolve => setTimeout(resolve, 0));
	const p = parsearJsonTecnico(texto); validarPaqueteTecnico(p);
	for (let i = 0; i < p.revisiones.length; i++) {
		comprobarCancelacion(); verificarRevision(p.revisiones[i]);
		if ((i + 1) % 100 === 0) {
			opciones.progreso?.(i + 1, p.revisiones.length);
			await new Promise<void>(resolve => setTimeout(resolve, 0));
		}
	}
	const indice = indexarRevisiones(p.revisiones, false);
	for (const r of p.revisiones) for (const ref of dependenciasRevision(r)) {
		if (indice.get(claveRevision(ref))?.hash !== ref.hash) throw new DatosTecnicosInvalidos('MISSING: dependencia exacta del paquete.');
	}
	if (p.manifiesto.hash !== sha256Texto(jsonCanonico(referenciasOrdenadas(p.revisiones)))) throw new DatosTecnicosInvalidos('Integridad inválida del manifiesto.');
	comprobarCancelacion(); return p;
}
/** Huella completa del snapshot de diseño: se usa al preparar/aplicar, nunca por frame. */
export function hashSnapshotTecnico(proyecto: unknown): string { inspeccionarDatosNoConfiables(proyecto); return sha256Texto(jsonCanonico(proyecto)); }
