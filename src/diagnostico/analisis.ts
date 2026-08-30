import { conjugado, magnitud, multiplicar, restar } from '../fisica/complejos.js';
import type { ResultadoFisicaElectrica } from '../fisica/topologia-proyecto.js';
import type { OrigenDatoFisico } from '../modelo/fisica.js';
import type { Proyecto } from '../modelo/tipos.js';
import type { HallazgoDiagnostico, ResultadoDiagnosticoIndustrial } from './motor-causal.js';

export type TipoAnalisisTecnico = 'CIRCUITO' | 'EQUIPO' | 'PROTECCION' | 'MOTOR' | 'VFD' | 'TRANSFORMADOR';
export type OrientacionAnalisis = 'INEQUIVOCA' | 'INDETERMINADA';

export interface MagnitudAnalisis {
	codigo: string;
	etiqueta: string;
	valor?: number;
	unidad?: string;
	origen: OrigenDatoFisico;
}

export interface TopologiaAnalisis {
	orientacion: OrientacionAnalisis;
	fuenteId?: string;
	aguasArriba: string[];
	aguasAbajo: string[];
	conductores: string[];
	trayecto: string[];
	explicacion: string;
}

export interface HotspotAnalisis {
	elementoId: string;
	perdidaW: number;
	clasificacion: 'PERDIDA_ELEVADA';
	origen: 'CALCULADO';
	detalle: string;
}

export interface ResultadoAnalisisTecnico {
	tipo: TipoAnalisisTecnico;
	objetivoId: string;
	titulo: string;
	resumen: string;
	estado: string;
	magnitudes: MagnitudAnalisis[];
	topologia: TopologiaAnalisis;
	hotspots: HotspotAnalisis[];
	diagnosticos: HallazgoDiagnostico[];
	limitaciones: string[];
}

export interface ContextoAnalisisTecnico {
	proyecto: Proyecto;
	fisica: ResultadoFisicaElectrica;
	diagnostico: ResultadoDiagnosticoIndustrial;
	equipoId?: string;
	estadosProteccion?: readonly {
		dispositivoId: string;
		estado: string;
		cargaTermica: number;
	}[];
}

const redondear = (v: number, decimales = 4): number => Math.round(v * 10 ** decimales) / 10 ** decimales;
const mag = (codigo: string, etiqueta: string, valor: number | undefined, unidad: string, origen: OrigenDatoFisico): MagnitudAnalisis => ({
	codigo, etiqueta, valor: valor === undefined ? undefined : redondear(valor), unidad, origen,
});
const idDispositivo = (nodo: string): string => nodo.split('::')[0];

function tituloEquipo(proyecto: Proyecto, id: string): string {
	const d = proyecto.dispositivos.find((x) => x.id === id);
	return d?.designacion ?? d?.descripcion ?? id;
}

function tipoDeEquipo(contexto: ContextoAnalisisTecnico): TipoAnalisisTecnico {
	if (!contexto.equipoId) return 'CIRCUITO';
	const d = contexto.proyecto.dispositivos.find((x) => x.id === contexto.equipoId);
	if (d?.fisica?.motor) return 'MOTOR';
	if (d?.fisica?.vfd) return 'VFD';
	if (d?.fisica?.transformador) return 'TRANSFORMADOR';
	if (d?.fisica?.proteccion || d?.fisica?.diferencial) return 'PROTECCION';
	return 'EQUIPO';
}

function topologiaEquipo(proyecto: Proyecto, fisica: ResultadoFisicaElectrica, equipoId?: string): TopologiaAnalisis {
	const vacia = (explicacion: string): TopologiaAnalisis => ({ orientacion: 'INDETERMINADA', aguasArriba: [], aguasAbajo: [],
		conductores: [], trayecto: [], explicacion });
	if (!equipoId) return vacia('El resumen global no fuerza una única orientación de circuito.');
	const nodosEquipo = proyecto.dispositivos.find((d) => d.id === equipoId)?.bornes.map((b) => `${equipoId}::${b.id}`) ?? [];
	if (!nodosEquipo.length) return vacia('El equipo no declara bornes persistentes.');
	const vecinos = new Map<string, string[]>();
	for (const r of [...fisica.medicion.ramas.values()].sort((a, b) => a.id.localeCompare(b.id))) {
		const agregar = (a: string, b: string) => { const lista = vecinos.get(a) ?? []; lista.push(b); vecinos.set(a, lista); };
		agregar(r.de, r.a); agregar(r.a, r.de);
	}
	const componente = new Set<string>(); const colaComponente = [...nodosEquipo].sort();
	while (colaComponente.length) {
		const actual = colaComponente.shift()!; if (componente.has(actual)) continue; componente.add(actual);
		for (const v of (vecinos.get(actual) ?? []).sort()) if (!componente.has(v)) colaComponente.push(v);
	}
	const fuentes = fisica.medicion.fuentes.filter((f) => componente.has(f.de) || componente.has(f.a));
	const propietarios = [...new Set(fuentes.map((f) => idDispositivo(f.de)))].sort();
	if (propietarios.length !== 1) return vacia(propietarios.length
		? `La topología contiene ${propietarios.length} fuentes; aguas arriba/abajo no es inequívoco.`
		: 'No existe una fuente alcanzable desde los bornes del equipo.');
	const raices = [...new Set(fuentes.map((f) => f.de))].sort();
	const distancia = new Map<string, number>(raices.map((id) => [id, 0])); const cola = [...raices];
	while (cola.length) {
		const actual = cola.shift()!; const d = distancia.get(actual)!;
		for (const v of (vecinos.get(actual) ?? []).sort()) if (!distancia.has(v)) { distancia.set(v, d + 1); cola.push(v); }
	}
	const arriba = new Set<string>(); const abajo = new Set<string>(); const conductores: string[] = []; let ambiguo = false;
	for (const c of [...proyecto.conductores].sort((a, b) => a.id.localeCompare(b.id))) {
		const extremoEquipo = c.de.dispositivoId === equipoId ? c.de : c.a.dispositivoId === equipoId ? c.a : undefined;
		if (!extremoEquipo || !fisica.medicion.ramas.has(`conductor:${c.id}`)) continue;
		conductores.push(c.id);
		const otro = c.de.dispositivoId === equipoId ? c.a : c.de;
		const borne = proyecto.dispositivos.find((d) => d.id === equipoId)?.bornes.find((b) => b.id === extremoEquipo.borneId);
		/* N y PE son retornos/referencias; usarlos para orientar potencia invierte el camino aparente. */
		if (borne?.tipo === 'N' || borne?.tipo === 'PE') continue;
		const de = distancia.get(`${equipoId}::${extremoEquipo.borneId}`);
		const hacia = distancia.get(`${otro.dispositivoId}::${otro.borneId}`);
		if (de === undefined || hacia === undefined || de === hacia) { ambiguo = true; continue; }
		(de > hacia ? arriba : abajo).add(otro.dispositivoId);
	}
	const aguasArriba = [...arriba].sort((a, b) => a.localeCompare(b));
	const aguasAbajo = [...abajo].sort((a, b) => a.localeCompare(b));
	const orientacion = !ambiguo && (aguasArriba.length > 0 || aguasAbajo.length > 0) ? 'INEQUIVOCA' : 'INDETERMINADA';
	return { orientacion, fuenteId: propietarios[0], aguasArriba, aguasAbajo, conductores,
		trayecto: [propietarios[0], ...aguasArriba, equipoId, ...aguasAbajo].filter((id, i, a) => a.indexOf(id) === i),
		explicacion: orientacion === 'INEQUIVOCA'
			? 'Orientación derivada de una única fuente alcanzable y distancias topológicas por bornes activos.'
			: 'Algún tramo no admite una orientación única; se conserva como indeterminado.' };
}

function hotspots(contexto: ContextoAnalisisTecnico): HotspotAnalisis[] {
	const { fisica, equipoId } = contexto; const total = Math.max(0, fisica.red.potenciaPerdidasW);
	const umbral = Math.max(1, total * 0.05); const salida: HotspotAnalisis[] = [];
	for (const c of [...fisica.conductores.values()].sort((a, b) => a.conductorId.localeCompare(b.conductorId))) {
		const original = contexto.proyecto.conductores.find((x) => x.id === c.conductorId);
		if (equipoId && original && original.de.dispositivoId !== equipoId && original.a.dispositivoId !== equipoId) continue;
		if (c.perdidaW >= umbral) salida.push({ elementoId: c.conductorId, perdidaW: redondear(c.perdidaW),
			clasificacion: 'PERDIDA_ELEVADA', origen: 'CALCULADO',
			detalle: 'Pérdida eléctrica localizada; no equivale a una temperatura ni prueba sobrecalentamiento.' });
	}
	for (const c of [...fisica.contactos.values()].sort((a, b) => a.ramaId.localeCompare(b.ramaId))) {
		if (equipoId && c.dispositivoId !== equipoId || c.perdidaW < umbral) continue;
		salida.push({ elementoId: c.ramaId, perdidaW: redondear(c.perdidaW), clasificacion: 'PERDIDA_ELEVADA', origen: 'CALCULADO',
			detalle: 'Pérdida I²R localizada; se requiere un modelo térmico para hablar de temperatura.' });
	}
	return salida.sort((a, b) => b.perdidaW - a.perdidaW || a.elementoId.localeCompare(b.elementoId));
}

function magnitudesCircuito(fisica: ResultadoFisicaElectrica): MagnitudAnalisis[] {
	return [
		mag('P_FUENTES', 'Potencia activa de fuentes', fisica.red.potenciaFuentesW, 'W', 'CALCULADO'),
		mag('P_CARGAS', 'Potencia activa de cargas', fisica.red.potenciaCargasW, 'W', 'CALCULADO'),
		mag('P_PERDIDAS', 'Pérdidas de red', fisica.red.potenciaPerdidasW, 'W', 'CALCULADO'),
		mag('BALANCE', 'Error de balance', fisica.red.metricas.errorBalanceW, 'W', 'CALCULADO'),
	];
}

function magnitudesEquipo(contexto: ContextoAnalisisTecnico, tipo: TipoAnalisisTecnico): MagnitudAnalisis[] {
	const { proyecto, fisica, equipoId } = contexto; if (!equipoId) return magnitudesCircuito(fisica);
	const d = proyecto.dispositivos.find((x) => x.id === equipoId); if (!d) return [];
	if (tipo === 'MOTOR') {
		const m = fisica.motores.get(equipoId); const c = d.fisica?.motor; if (!m || !c) return [];
		return [
			mag('P_N_PLACA', 'Potencia mecánica de placa', c.potenciaMecanicaNominalW, 'W', 'CONFIGURADO'),
			mag('V', 'Tensión en motor', m.tensionV, 'V', m.origen), mag('I', 'Corriente', m.corrienteA, 'A', m.origen),
			mag('P', 'Potencia activa de entrada', m.potenciaEntradaW, 'W', m.origen), mag('Q', 'Potencia reactiva', m.potenciaReactivaVar, 'var', m.origen),
			mag('S', 'Potencia aparente', m.potenciaAparenteVA, 'VA', m.origen), mag('PF', 'Factor de potencia', m.factorPotencia, '', m.origen),
			mag('ETA', 'Eficiencia configurada', m.eficiencia * 100, '%', 'CONFIGURADO'),
			mag('RPM', 'Velocidad', m.rpm, 'rpm', m.origen), mag('RPM_SYNC', 'Velocidad síncrona', m.rpmSincronas, 'rpm', 'CALCULADO'),
			mag('SLIP', 'Deslizamiento', m.deslizamiento === undefined ? undefined : m.deslizamiento * 100, '%', 'CALCULADO'),
			mag('I_IN', 'Corriente / In', m.corrienteNominalUsadaA > 0 ? m.corrienteA / m.corrienteNominalUsadaA : undefined, '×In', 'CALCULADO'),
		];
	}
	if (tipo === 'VFD') {
		const v = fisica.variadores.get(equipoId); if (!v) return [];
		return [mag('VIN', 'Tensión de entrada', v.tensionEntradaV, 'V', v.origen), mag('IIN', 'Corriente de entrada', v.corrienteEntradaA, 'A', v.origen),
			mag('PIN', 'Potencia de entrada', v.potenciaEntradaW, 'W', v.origen), mag('VOUT', 'Tensión de salida', v.tensionSalidaV, 'V', v.origen),
			mag('IOUT', 'Corriente de salida', v.corrienteSalidaA, 'A', v.origen), mag('FOUT', 'Frecuencia de salida', v.frecuenciaSalidaHz, 'Hz', v.origen),
			mag('POUT', 'Potencia de salida', v.potenciaSalidaW, 'W', v.origen), mag('ETA', 'Eficiencia', v.eficiencia === undefined ? undefined : v.eficiencia * 100, '%', v.origen),
			mag('LOSS', 'Pérdidas', v.perdidasW, 'W', v.origen)];
	}
	if (tipo === 'TRANSFORMADOR') {
		const t = fisica.red.transformadores.get(`transformador:${equipoId}`); const c = d.fisica?.transformador; if (!t || !c) return [];
		const sp = multiplicar(t.tensionPrimariaV, conjugado(t.corrientePrimariaA));
		const ss = multiplicar(t.tensionSecundariaV, conjugado(t.corrienteSecundariaA));
		return [mag('VP', 'Tensión primaria', magnitud(t.tensionPrimariaV), 'V', t.origen), mag('IP', 'Corriente primaria', magnitud(t.corrientePrimariaA), 'A', t.origen),
			mag('PP', 'P primaria', sp.re, 'W', t.origen), mag('QP', 'Q primaria', sp.im, 'var', t.origen), mag('SP', 'S primaria', magnitud(sp), 'VA', t.origen),
			mag('VS', 'Tensión secundaria', magnitud(t.tensionSecundariaV), 'V', t.origen), mag('IS', 'Corriente secundaria', magnitud(t.corrienteSecundariaA), 'A', t.origen),
			mag('PS', 'P secundaria', ss.re, 'W', t.origen), mag('QS', 'Q secundaria', ss.im, 'var', t.origen), mag('SS', 'S secundaria', magnitud(ss), 'VA', t.origen),
			mag('RATIO', 'Relación Vp/Vs', c.primarioV / c.secundarioV, '', 'CONFIGURADO'), mag('Z_PCT', 'Impedancia', c.impedanciaPct, '%', 'CONFIGURADO'),
			mag('REG', 'Regulación', t.regulacionPct, '%', t.origen), mag('LOSS', 'Pérdidas cobre', t.perdidaCobreW, 'W', t.origen),
			mag('LOAD', 'Carga', t.cargaPct, '%', t.origen)];
	}
	if (tipo === 'PROTECCION') {
		const p = fisica.protecciones.get(equipoId); if (!p) return [];
		const e = contexto.estadosProteccion?.find((x) => x.dispositivoId === equipoId);
		return [mag('I', 'Corriente actual', p.corrienteA, 'A', 'CALCULADO'), mag('IN', 'Calibre In', p.inA, 'A', 'CONFIGURADO'),
			mag('I_IN', 'Corriente / In', p.inA && p.inA > 0 ? p.corrienteA / p.inA : undefined, '×In', 'CALCULADO'),
			mag('THERMAL', 'Memoria térmica', e?.cargaTermica === undefined ? undefined : e.cargaTermica * 100, '%', 'ESTIMADO'),
			mag('TRIP_MIN', 'Ventana de disparo mínima', p.evaluacion.tMinS, 's', p.evaluacion.origen),
			mag('TRIP_MAX', 'Ventana de disparo máxima', p.evaluacion.tMaxS, 's', p.evaluacion.origen),
			mag('I_DELTA', 'Corriente residual', p.corrienteResidualA, 'A', p.modeloResidual ? 'CALCULADO' : 'NO_MODELADO'),
			mag('I_DELTA_N', 'Umbral residual', p.corrienteResidualNominalA, 'A', p.corrienteResidualNominalA === undefined ? 'NO_MODELADO' : 'CONFIGURADO')];
	}
	const cargas = [...fisica.red.cargas.values()].filter((c) => c.id.includes(`:${equipoId}:`));
	const s = cargas.reduce((a, c) => ({ re: a.re + c.potenciaVA.re, im: a.im + c.potenciaVA.im }), { re: 0, im: 0 });
	return cargas.length ? [mag('P', 'Potencia activa', s.re, 'W', 'CALCULADO'), mag('Q', 'Potencia reactiva', s.im, 'var', 'CALCULADO'),
		mag('S', 'Potencia aparente', magnitud(s), 'VA', 'CALCULADO')] : [];
}

function estadoDe(contexto: ContextoAnalisisTecnico, tipo: TipoAnalisisTecnico): string {
	const id = contexto.equipoId;
	if (!id) return contexto.fisica.red.metricas.convergio ? 'RED_RESUELTA' : 'RESULTADO_DEGRADADO';
	if (tipo === 'MOTOR') return contexto.fisica.motores.get(id)?.estado.toUpperCase() ?? 'NO_DISPONIBLE';
	if (tipo === 'VFD') return contexto.fisica.variadores.get(id)?.estado.toUpperCase() ?? 'NO_DISPONIBLE';
	if (tipo === 'PROTECCION') return contexto.estadosProteccion?.find((x) => x.dispositivoId === id)?.estado.toUpperCase()
		?? contexto.fisica.protecciones.get(id)?.evaluacion.region ?? 'NO_DISPONIBLE';
	if (tipo === 'TRANSFORMADOR') return contexto.fisica.red.transformadores.has(`transformador:${id}`) ? 'ACOPLADO' : 'NO_DISPONIBLE';
	return 'CALCULADO';
}

export function analizarTecnico(contexto: ContextoAnalisisTecnico): ResultadoAnalisisTecnico {
	const tipo = tipoDeEquipo(contexto); const objetivoId = contexto.equipoId ?? '@circuito';
	const diagnosticos = contexto.diagnostico.hallazgos
		.filter((h) => !contexto.equipoId || h.equipoId === contexto.equipoId)
		.sort((a, b) => a.id.localeCompare(b.id));
	const raices = diagnosticos.filter((h) => h.clasificacion === 'ROOT_CAUSE' && h.estado === 'SOSTENIDA');
	const resumen = raices.length
		? `${raices.length} causa(s) raíz sostenida(s): ${raices.map((h) => h.resumen).join(' ')}`
		: diagnosticos.some((h) => h.estado === 'INDETERMINADA')
			? 'La evidencia disponible no permite una causa única.'
			: 'Sin patrones de falla V6 sostenidos en la evidencia disponible.';
	return {
		tipo, objetivoId,
		titulo: contexto.equipoId ? `${tipo} · ${tituloEquipo(contexto.proyecto, contexto.equipoId)}` : `CIRCUITO · ${contexto.proyecto.nombre}`,
		resumen, estado: estadoDe(contexto, tipo), magnitudes: magnitudesEquipo(contexto, tipo),
		topologia: topologiaEquipo(contexto.proyecto, contexto.fisica, contexto.equipoId),
		hotspots: hotspots(contexto), diagnosticos,
		limitaciones: [
			'Upstream/downstream solo se declara con una fuente alcanzable y una orientación topológica inequívoca.',
			'PERDIDA_ELEVADA es potencia disipada calculada; no es una temperatura ni certifica sobrecalentamiento.',
			'Los resultados pertenecen al modelo fasorial y a los perfiles configurados; no constituyen certificación normativa.',
		],
	};
}

/** Potencia activa que entra por una rama en su extremo `de`; útil para pruebas de orientación. */
export function potenciaEntranteRama(fisica: ResultadoFisicaElectrica, ramaId: string): number | undefined {
	const r = fisica.red.ramas.get(ramaId); const t = fisica.medicion.ramas.get(ramaId);
	const v = t && fisica.red.nodos.get(t.de)?.tensionV; if (!r || !t || !v) return undefined;
	return multiplicar(v, conjugado(r.corrienteA)).re;
}
