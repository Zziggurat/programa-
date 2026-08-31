/** Descubrimiento determinista de circuitos de ingeniería sobre el grafo eléctrico persistente. */
import { resolverComportamiento, type ComportamientoSimulacion, type ParBornesSimulacion } from '../modelo/comportamiento.js';
import type {
	CriteriosCircuitoIngenieria, MetadatosCircuitoIngenieria, TipoCircuitoIngenieria,
} from '../modelo/ingenieria.js';
import type { Conductor, Dispositivo, Proyecto } from '../modelo/tipos.js';

export type EstadoTopologiaCircuito = 'INEQUIVOCA' | 'AMBIGUA' | 'SIN_FUENTE';

export interface TrayectoCircuitoIngenieria {
	fuenteId: string;
	raiz: string;
	destino: string;
	nodos: string[];
	dispositivos: string[];
	conductores: string[];
}

export interface CircuitoIngenieria {
	id: string;
	nombre: string;
	tipo: TipoCircuitoIngenieria;
	estadoTopologia: EstadoTopologiaCircuito;
	fuenteId?: string;
	fuentes: string[];
	protecciones: string[];
	maniobra: string[];
	conductores: string[];
	cargas: string[];
	senalesRelacionadas: string[];
	equipos: string[];
	subcircuitos: string[];
	trayectos: TrayectoCircuitoIngenieria[];
	ambiguedades: string[];
	criterios?: CriteriosCircuitoIngenieria;
	metadatos?: MetadatosCircuitoIngenieria;
}

export interface ResultadoDescubrimientoCircuitos {
	circuitos: CircuitoIngenieria[];
	ambiguo: boolean;
	advertencias: string[];
}

interface Arista {
	id: string;
	a: string;
	b: string;
	conductorId?: string;
}
interface Vecino { nodo: string; arista: Arista }
interface Raiz { nodo: string; dispositivoId: string; modo: 'AC' | 'DC' | 'VFD' }
interface Destino { nodo: string; dispositivoId: string }
interface Busqueda { distancia: Map<string, number>; caminos: Map<string, number>; previo: Map<string, Vecino> }

const clave = (dispositivoId: string, borneId: string): string => `${dispositivoId}::${borneId}`;
const dispositivoDeNodo = (nodo: string): string => nodo.slice(0, nodo.indexOf('::'));
const unicoOrdenado = (valores: Iterable<string>): string[] => [...new Set(valores)].sort((a, b) => a.localeCompare(b));
const codificar = (valor: string): string => encodeURIComponent(valor).replace(/%/g, '~');

function paresInternos(perfil: ComportamientoSimulacion | undefined): ParBornesSimulacion[] {
	if (!perfil) return [];
	switch (perfil.clase) {
		case 'contactos-electromagneticos': return [...perfil.polos, ...perfil.contactos];
		case 'proteccion': return [...perfil.polos, ...perfil.contactos];
		case 'mando': return [...perfil.contactos];
		case 'sensor': return [...perfil.contactos];
		case 'pasivo': return [...perfil.conexiones];
		default: return [];
	}
}

function construirGrafo(proyecto: Proyecto): { vecinos: Map<string, Vecino[]>; aristas: Arista[] } {
	const vecinos = new Map<string, Vecino[]>(); const aristas: Arista[] = [];
	const registrarNodo = (nodo: string) => { if (!vecinos.has(nodo)) vecinos.set(nodo, []); };
	const agregar = (arista: Arista) => {
		registrarNodo(arista.a); registrarNodo(arista.b); aristas.push(arista);
		vecinos.get(arista.a)!.push({ nodo: arista.b, arista });
		vecinos.get(arista.b)!.push({ nodo: arista.a, arista });
	};
	for (const d of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		for (const b of d.bornes) registrarNodo(clave(d.id, b.id));
		const paresVistos = new Set<string>();
		const agregarInterna = (id: string, borneA: string, borneB: string) => {
			const extremos = [borneA, borneB].sort(); const firma = extremos.join('\u0000');
			if (paresVistos.has(firma)) return; paresVistos.add(firma);
			agregar({ id, a: clave(d.id, borneA), b: clave(d.id, borneB) });
		};
		const pares = paresInternos(resolverComportamiento(d));
		pares.forEach((p, i) => agregarInterna(`interno:${d.id}:${i}`, p.entrada, p.salida));
		(d.puentesInternos ?? []).forEach((p, i) => agregarInterna(`puente-interno:${d.id}:${i}`, p[0], p[1]));
		(d.puentes ?? []).forEach((grupo, gi) => grupo.slice(1).forEach((borne, i) =>
			agregarInterna(`puente:${d.id}:${gi}:${i}`, grupo[0], borne)));
	}
	for (const c of [...proyecto.conductores].sort((a, b) => a.id.localeCompare(b.id))) {
		agregar({ id: `conductor:${c.id}`, a: clave(c.de.dispositivoId, c.de.borneId),
			b: clave(c.a.dispositivoId, c.a.borneId), conductorId: c.id });
	}
	for (const lista of vecinos.values()) lista.sort((a, b) => a.nodo.localeCompare(b.nodo) || a.arista.id.localeCompare(b.arista.id));
	return { vecinos, aristas: aristas.sort((a, b) => a.id.localeCompare(b.id)) };
}

function raicesDe(dispositivo: Dispositivo): Raiz[] {
	const perfil = resolverComportamiento(dispositivo); const r: Raiz[] = [];
	if (perfil?.clase === 'fuente') {
		const modo: Raiz['modo'] = dispositivo.fisica?.fuente?.sistema === 'DC' ? 'DC' : 'AC';
		for (const salida of perfil.salidas.filter((s) => s.papel === 'fase')) {
			r.push({ nodo: clave(dispositivo.id, salida.borne), dispositivoId: dispositivo.id, modo });
		}
	}
	if (dispositivo.fisica?.fuente) {
		const modo: Raiz['modo'] = dispositivo.fisica.fuente.sistema === 'DC' ? 'DC' : 'AC';
		for (const fase of dispositivo.fisica.fuente.fases) r.push({ nodo: clave(dispositivo.id, fase.borne), dispositivoId: dispositivo.id, modo });
	}
	if (perfil?.clase === 'variador') {
		for (const borne of [perfil.salida.u, perfil.salida.v, perfil.salida.w]) {
			r.push({ nodo: clave(dispositivo.id, borne), dispositivoId: dispositivo.id, modo: 'VFD' });
		}
	}
	const porNodo = new Map(r.map((x) => [x.nodo, x]));
	return [...porNodo.values()].sort((a, b) => a.nodo.localeCompare(b.nodo));
}

function destinosDe(dispositivo: Dispositivo): Destino[] {
	const perfil = resolverComportamiento(dispositivo); let bornes: string[] = [];
	if (perfil) switch (perfil.clase) {
		case 'contactos-electromagneticos': bornes = [perfil.bobina.entrada]; break;
		case 'controlador': bornes = perfil.alimentacion.entradas; break;
		case 'fuente': bornes = perfil.primario?.entradas ?? []; break;
		case 'sensor': bornes = perfil.alimentacion ? [perfil.alimentacion.entrada] : []; break;
		case 'variador': bornes = perfil.alimentacion.fases; break;
		case 'carga': bornes = perfil.alimentacion.fases; break;
		default: bornes = [];
	}
	const carga = dispositivo.fisica?.carga;
	if (!bornes.length && carga) bornes = carga.fases ? [...carga.fases] : carga.terminales ? [carga.terminales[0]] : [];
	return unicoOrdenado(bornes).map((borne) => ({ nodo: clave(dispositivo.id, borne), dispositivoId: dispositivo.id }));
}

function buscar(raiz: string, vecinos: ReadonlyMap<string, Vecino[]>): Busqueda {
	const distancia = new Map([[raiz, 0]]); const caminos = new Map([[raiz, 1]]); const previo = new Map<string, Vecino>();
	const cola = [raiz];
	for (let qi = 0; qi < cola.length; qi++) {
		const actual = cola[qi]; const siguienteDistancia = distancia.get(actual)! + 1;
		for (const v of vecinos.get(actual) ?? []) {
			const existente = distancia.get(v.nodo);
			if (existente === undefined) {
				distancia.set(v.nodo, siguienteDistancia); caminos.set(v.nodo, caminos.get(actual) ?? 1);
				previo.set(v.nodo, { nodo: actual, arista: v.arista }); cola.push(v.nodo);
			} else if (existente === siguienteDistancia) {
				caminos.set(v.nodo, Math.min(2, (caminos.get(v.nodo) ?? 1) + (caminos.get(actual) ?? 1)));
				const p = previo.get(v.nodo); const candidato = `${actual}\u0000${v.arista.id}`;
				if (!p || candidato < `${p.nodo}\u0000${p.arista.id}`) previo.set(v.nodo, { nodo: actual, arista: v.arista });
			}
		}
	}
	return { distancia, caminos, previo };
}

function reconstruir(raiz: Raiz, destino: Destino, b: Busqueda): TrayectoCircuitoIngenieria | undefined {
	if (!b.distancia.has(destino.nodo)) return undefined;
	const nodos = [destino.nodo]; const aristas: Arista[] = []; let actual = destino.nodo;
	while (actual !== raiz.nodo) {
		const p = b.previo.get(actual); if (!p) return undefined;
		aristas.push(p.arista); actual = p.nodo; nodos.push(actual);
	}
	nodos.reverse(); aristas.reverse();
	return { fuenteId: raiz.dispositivoId, raiz: raiz.nodo, destino: destino.nodo, nodos,
		dispositivos: unicoOrdenado(nodos.map(dispositivoDeNodo)),
		conductores: unicoOrdenado(aristas.flatMap((a) => a.conductorId ? [a.conductorId] : [])) };
}

function inferirTipo(proyecto: Proyecto, carga: Dispositivo, raices: Raiz[]): TipoCircuitoIngenieria {
	if (raices.some((r) => r.modo === 'VFD') || carga.tipo === 'variador') return 'VFD';
	if (carga.tipo === 'motor') return 'MOTOR';
	if (carga.tipo === 'plc') return 'PLC';
	if (carga.bornes.some((b) => b.tipo === 'senal')) return 'INSTRUMENTACION';
	const perfil = resolverComportamiento(carga);
	if (perfil?.clase === 'contactos-electromagneticos' || perfil?.clase === 'mando' || carga.tipo === 'piloto') {
		return raices.some((r) => r.modo === 'DC') ? 'CONTROL_DC' : 'CONTROL_AC';
	}
	if (raices.some((r) => r.modo === 'DC')) return 'CONTROL_DC';
	return raices.length ? 'ALIMENTACION' : 'GENERICO';
}

function idCircuito(fuentes: readonly string[], cargaId: string): string {
	return `circuito:${codificar(fuentes.length ? [...fuentes].sort().join('|') : 'sin-fuente')}->${codificar(cargaId)}`;
}

function esProteccion(d: Dispositivo): boolean { return resolverComportamiento(d)?.clase === 'proteccion'; }
function esManiobra(d: Dispositivo): boolean {
	const clase = resolverComportamiento(d)?.clase;
	return clase === 'contactos-electromagneticos' || clase === 'mando';
}

/**
	* Deriva circuitos por carga y camino de alimentación. Los retornos no se usan para inventar
	* orientación: una carga termina el recorrido y una fuente/VFD inicia otro.
	*/
export function descubrirCircuitos(proyecto: Proyecto): ResultadoDescubrimientoCircuitos {
	const { vecinos } = construirGrafo(proyecto); const porId = new Map(proyecto.dispositivos.map((d) => [d.id, d]));
	const raices = proyecto.dispositivos.flatMap(raicesDe).sort((a, b) => a.nodo.localeCompare(b.nodo));
	const busquedas = new Map(raices.map((r) => [r.nodo, buscar(r.nodo, vecinos)]));
	const circuitos: CircuitoIngenieria[] = []; const advertencias: string[] = [];
	for (const carga of [...proyecto.dispositivos].sort((a, b) => a.id.localeCompare(b.id))) {
		const destinos = destinosDe(carga); if (!destinos.length) continue;
		const alcanzables = raices.filter((r) => destinos.some((d) => busquedas.get(r.nodo)!.distancia.has(d.nodo)));
		const fuentes = unicoOrdenado(alcanzables.map((r) => r.dispositivoId)); const id = idCircuito(fuentes, carga.id);
		const ambiguedades: string[] = [];
		if (fuentes.length > 1) ambiguedades.push(`MULTIPLE_SOURCES:${fuentes.join(',')}`);
		for (const destino of destinos) {
			const desde = alcanzables.filter((r) => busquedas.get(r.nodo)!.distancia.has(destino.nodo));
			if (!desde.length) ambiguedades.push(`TERMINAL_SIN_FUENTE:${destino.nodo}`);
			if (desde.some((r) => (busquedas.get(r.nodo)!.caminos.get(destino.nodo) ?? 0) > 1)) {
				ambiguedades.push(`CAMINOS_PARALELOS:${destino.nodo}`);
			}
		}
		const trayectos = alcanzables.flatMap((raiz) => destinos.flatMap((destino) => {
			const t = reconstruir(raiz, destino, busquedas.get(raiz.nodo)!); return t ? [t] : [];
		})).sort((a, b) => a.raiz.localeCompare(b.raiz) || a.destino.localeCompare(b.destino));
		const equipos = unicoOrdenado([carga.id, ...trayectos.flatMap((t) => t.dispositivos)]);
		const conductores = unicoOrdenado(trayectos.flatMap((t) => t.conductores));
		const metadata = proyecto.ingenieria?.circuitos?.[id];
		const criterios = { ...proyecto.ingenieria?.criterios, ...metadata?.criterios };
		const senalesRelacionadas = unicoOrdenado(proyecto.conductores.flatMap((c: Conductor) => {
			if (!equipos.includes(c.de.dispositivoId) && !equipos.includes(c.a.dispositivoId)) return [];
			const borneDe = porId.get(c.de.dispositivoId)?.bornes.find((b) => b.id === c.de.borneId);
			const borneA = porId.get(c.a.dispositivoId)?.bornes.find((b) => b.id === c.a.borneId);
			return borneDe?.tipo === 'senal' || borneA?.tipo === 'senal' ? [c.id] : [];
		}));
		const estadoTopologia: EstadoTopologiaCircuito = !alcanzables.length ? 'SIN_FUENTE'
			: ambiguedades.length ? 'AMBIGUA' : 'INEQUIVOCA';
		if (ambiguedades.length) advertencias.push(...ambiguedades.map((a) => `${id}:${a}`));
		circuitos.push({ id, nombre: metadata?.nombre ?? `Circuito ${carga.designacion ?? carga.descripcion ?? carga.id}`,
			tipo: metadata?.tipo ?? inferirTipo(proyecto, carga, alcanzables), estadoTopologia,
			fuenteId: fuentes.length === 1 ? fuentes[0] : undefined, fuentes,
			protecciones: equipos.filter((x) => { const d = porId.get(x); return !!d && esProteccion(d); }),
			maniobra: equipos.filter((x) => { const d = porId.get(x); return !!d && esManiobra(d); }),
			conductores, cargas: [carga.id], senalesRelacionadas, equipos, subcircuitos: [], trayectos,
			ambiguedades: unicoOrdenado(ambiguedades),
			criterios: Object.keys(criterios).length ? criterios : undefined, metadatos: metadata });
	}
	circuitos.sort((a, b) => a.id.localeCompare(b.id));
	const porCarga = new Map(circuitos.flatMap((c) => c.cargas.map((id) => [id, c] as const)));
	for (const hijo of circuitos) {
		const padre = hijo.fuenteId ? porCarga.get(hijo.fuenteId) : undefined;
		if (padre && padre.id !== hijo.id) padre.subcircuitos = unicoOrdenado([...padre.subcircuitos, hijo.id]);
	}
	return { circuitos, ambiguo: circuitos.some((c) => c.estadoTopologia === 'AMBIGUA'),
		advertencias: unicoOrdenado(advertencias) };
}
