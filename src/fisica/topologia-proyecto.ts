import type { Dispositivo, Proyecto } from '../modelo/tipos.js';
import { resolverComportamiento } from '../modelo/comportamiento.js';
import type { OrigenDatoFisico } from '../modelo/fisica.js';
import { calcularConductorFisico, resolverLongitudConductor, type ResultadoConductorFisico } from './conductores.js';
import { complejo, magnitud, polar } from './complejos.js';
import type { FallaFisicaRuntime, ResultadoFallaFisica } from './fallas.js';
import { aplicarFallosTopologia, resolverFalla } from './fallas.js';
import {
	CURVAS_PROTECCION_GENERICAS, analizarSelectividad, evaluarCurva, type EvaluacionCurvaProteccion,
	type ResultadoSelectividad,
} from './protecciones.js';
import { resolverRedFisica } from './solver.js';
import type {
	CargaRedFisica, DiagnosticoFisica, FuenteRedFisica, RedFisica, ResultadoRedFisica,
	RamaRedFisica,
} from './tipos.js';
import type { ResultadoLazoAnalogicoFisico } from './analogicas.js';

const Z_CONTACTO_OHM = complejo(1e-6);

export interface ContextoTopologiaFisica {
	conexionesCerradas?: ReadonlyMap<string, readonly (readonly [string, string])[]>;
	longitudesM?: ReadonlyMap<string, { metros: number; origen: OrigenDatoFisico }>;
	fallas?: readonly FallaFisicaRuntime[];
	bornesEnergizados?: ReadonlySet<string>;
}

export interface ResultadoConductorProyectoFisica extends ResultadoConductorFisico {
	conductorId: string;
	corrienteA: number;
	caidaV: number;
	caidaPct?: number;
	perdidaW: number;
}

export interface ResultadoProteccionProyectoFisica {
	dispositivoId: string;
	corrienteA: number;
	inA?: number;
	evaluacion: EvaluacionCurvaProteccion;
	corrienteResidualA?: number;
	fallas: string[];
}

export interface CoordinacionFisicaProyecto extends ResultadoSelectividad {
	fallaId: string;
	aguasAbajoId: string;
	aguasArribaId: string;
}

export interface ResultadoFisicaElectrica {
	activo: boolean;
	red: ResultadoRedFisica;
	conductores: Map<string, ResultadoConductorProyectoFisica>;
	protecciones: Map<string, ResultadoProteccionProyectoFisica>;
	fallas: ResultadoFallaFisica[];
	selectividad: CoordinacionFisicaProyecto[];
	lazosAnalogicos: ResultadoLazoAnalogicoFisico[];
	diagnosticos: DiagnosticoFisica[];
}

const clave = (dispositivoId: string, borneId: string): string => `${dispositivoId}::${borneId}`;

export function resultadoFisicaVacio(): ResultadoFisicaElectrica {
	return {
		activo: false,
		red: { nodos: new Map(), ramas: new Map(), cargas: new Map(), fuentes: new Map(), diagnosticos: [],
			potenciaCargasW: 0, potenciaPerdidasW: 0, potenciaFuentesW: 0,
			metricas: { nodos: 0, ramas: 0, iteraciones: 0, convergio: true, tiempoMs: 0, residuoKclA: 0, errorBalanceW: 0 } },
		conductores: new Map(), protecciones: new Map(), fallas: [], selectividad: [], lazosAnalogicos: [], diagnosticos: [],
	};
}

function cargaDesde(dispositivo: Dispositivo): CargaRedFisica[] {
	const c = dispositivo.fisica?.carga;
	if (!c) return [];
	const pares: [string, string, number][] = c.fases
		? c.fases.map((fase, i) => [fase, '__estrella_v5', i] as [string, string, number])
		: c.terminales ? [[c.terminales[0], c.terminales[1], 0]] : [];
	return pares.map(([de, a, indice]) => {
		const id = `carga:${dispositivo.id}:${indice}`;
		const comunes = { id, de: clave(dispositivo.id, de),
			a: a === '__estrella_v5' ? `${dispositivo.id}::__estrella_v5` : clave(dispositivo.id, a),
			dispositivoId: dispositivo.id, origen: 'CONFIGURADO' as const };
		if (c.modelo === 'CONSTANT_Z') return { ...comunes, modelo: c.modelo, zOhm: complejo(c.rOhm ?? 1e9, c.xOhm ?? 0) };
		if (c.modelo === 'CONSTANT_I') return { ...comunes, modelo: c.modelo, corrienteA: (c.corrienteA ?? 0) / pares.length,
			factorPotencia: c.factorPotencia };
		return { ...comunes, modelo: c.modelo,
			potenciaVA: complejo((c.pW ?? 0) / pares.length, (c.qVar ?? 0) / pares.length),
			tensionNominalV: (dispositivo.tensionNominal ?? 230) / (c.fases ? Math.sqrt(3) : 1) };
	});
}

function fuenteDesde(dispositivo: Dispositivo) {
	const f = dispositivo.fisica?.fuente;
	if (!f) return [];
	const z = (f.rOhm !== undefined || f.xOhm !== undefined) && magnitud(complejo(f.rOhm ?? 0, f.xOhm ?? 0)) > 0
		? complejo(f.rOhm ?? 0, f.xOhm ?? 0) : undefined;
	const simple = f.sistema === 'AC_TRIFASICA' ? f.tensionNominalV / Math.sqrt(3) : f.tensionNominalV;
	return f.fases.map((fase, i) => {
		const angulo = fase.anguloDeg ?? (fase.fase === 'L2' ? -120 : fase.fase === 'L3' ? 120 : 0);
		return {
			id: `fuente:${dispositivo.id}:${i}`, de: clave(dispositivo.id, fase.borne),
			a: clave(dispositivo.id, f.referencia), tensionV: f.sistema === 'DC' ? complejo(simple) : polar(simple, angulo * Math.PI / 180),
			zInternaOhm: z, origenImpedancia: z ? 'CONFIGURADO' as const : 'NO_MODELADO' as const,
			frecuenciaHz: f.sistema === 'DC' ? 0 : f.frecuenciaHz,
		};
	});
}

function fuenteTransformadorDesde(
	dispositivo: Dispositivo,
	bornesEnergizados: ReadonlySet<string> | undefined,
	diagnosticos: DiagnosticoFisica[],
): FuenteRedFisica[] {
	const t = dispositivo.fisica?.transformador;
	if (!t) return [];
	const perfil = resolverComportamiento(dispositivo);
	if (perfil?.clase !== 'fuente') {
		diagnosticos.push({ codigo: 'CONFIGURACION_INVALIDA',
			mensaje: `${dispositivo.id} declara transformador fisico sin perfil funcional de fuente`, elementos: [dispositivo.id] });
		return [];
	}
	const fases = perfil.salidas.filter((s) => s.papel === 'fase');
	const retornos = perfil.salidas.filter((s) => s.papel === 'retorno');
	if (fases.length !== 1 || retornos.length !== 1) {
		diagnosticos.push({ codigo: 'CONFIGURACION_INVALIDA',
			mensaje: `${dispositivo.id}: V5 basico solo modela un secundario monofasico`, elementos: [dispositivo.id] });
		return [];
	}
	const de = clave(dispositivo.id, fases[0].borne); const a = clave(dispositivo.id, retornos[0].borne);
	/* En la integracion funcional, un secundario solo existe si V2 ya lo marco energizado. La
	 * llamada directa al adaptador (sin ese conjunto) se usa en tests matematicos y lo habilita. */
	if (bornesEnergizados && !bornesEnergizados.has(de)) return [];
	let zInternaOhm;
	if (t.potenciaVA && t.impedanciaPct !== undefined) {
		const modulo = t.secundarioV * t.secundarioV / t.potenciaVA * t.impedanciaPct / 100;
		const xr = Math.max(0, t.xSobreR ?? 3);
		const r = modulo / Math.sqrt(1 + xr * xr);
		zInternaOhm = complejo(r, r * xr);
	}
	return [{ id: `transformador:${dispositivo.id}`, de, a, tensionV: complejo(t.secundarioV), zInternaOhm,
		origenImpedancia: zInternaOhm ? 'CONFIGURADO' : 'NO_MODELADO', frecuenciaHz: t.frecuenciaHz }];
}

function rutaProtecciones(red: RedFisica, desde: string): string[] {
	const objetivos = new Set(red.fuentes.map((f) => f.de));
	const vecinos = new Map<string, { nodo: string; proteccion?: string }[]>();
	for (const r of red.ramas) {
		const agregar = (a: string, b: string) => {
			const lista = vecinos.get(a) ?? []; lista.push({ nodo: b, proteccion: r.tipo === 'PROTECCION' ? r.dispositivoId : undefined }); vecinos.set(a, lista);
		};
		agregar(r.de, r.a); agregar(r.a, r.de);
	}
	const cola: { nodo: string; protecciones: string[] }[] = [{ nodo: desde, protecciones: [] }];
	const vistos = new Set([desde]);
	while (cola.length) {
		const actual = cola.shift()!;
		if (objetivos.has(actual.nodo)) return actual.protecciones;
		for (const v of vecinos.get(actual.nodo) ?? []) if (!vistos.has(v.nodo)) {
			vistos.add(v.nodo); cola.push({ nodo: v.nodo, protecciones: v.proteccion
				? [...actual.protecciones, v.proteccion] : actual.protecciones });
		}
	}
	return [];
}

export function simularFisicaProyecto(proyecto: Proyecto, contexto: ContextoTopologiaFisica = {}): ResultadoFisicaElectrica {
	const activo = proyecto.dispositivos.some((d) => d.fisica) || proyecto.conductores.some((c) => c.fisica);
	if (!activo) return resultadoFisicaVacio();
	const diagnosticos: DiagnosticoFisica[] = [];
	const nodos = proyecto.dispositivos.flatMap((d) => d.bornes.map((b) => ({ id: clave(d.id, b.id), referencia: false })));
	for (const d of proyecto.dispositivos) if (d.fisica?.carga?.fases) nodos.push({ id: `${d.id}::__estrella_v5`, referencia: false });
	for (const d of proyecto.dispositivos) if (d.fisica?.fuente) {
		const id = clave(d.id, d.fisica.fuente.referencia);
		const nodo = nodos.find((n) => n.id === id); if (nodo) nodo.referencia = true;
	}
	for (const d of proyecto.dispositivos) if (d.fisica?.transformador) {
		const perfil = resolverComportamiento(d);
		if (perfil?.clase === 'fuente') for (const retorno of perfil.salidas.filter((s) => s.papel === 'retorno')) {
			const nodo = nodos.find((n) => n.id === clave(d.id, retorno.borne)); if (nodo) nodo.referencia = true;
		}
	}
	const datosConductores = new Map<string, ResultadoConductorFisico>();
	const ramas: RamaRedFisica[] = proyecto.conductores.flatMap((c): RamaRedFisica[] => {
		const de = proyecto.dispositivos.find((d) => d.id === c.de.dispositivoId)?.posicion;
		const a = proyecto.dispositivos.find((d) => d.id === c.a.dispositivoId)?.posicion;
		const estimacionM = de && a ? Math.hypot(de.x - a.x, de.y - a.y) / 1000 : undefined;
		const declarada = contexto.longitudesM?.get(c.id);
		const longitud = declarada ?? resolverLongitudConductor(c.fisica, undefined, estimacionM);
		if (!(c.seccion && c.seccion > 0) || longitud.metros <= 0) {
			diagnosticos.push({ codigo: 'CONFIGURACION_INVALIDA', mensaje: `Cable ${c.id} sin seccion o longitud fisica fiable`, elementos: [c.id] });
			return [{ id: `conductor:${c.id}`, de: clave(c.de.dispositivoId, c.de.borneId), a: clave(c.a.dispositivoId, c.a.borneId),
				zOhm: Z_CONTACTO_OHM, tipo: 'CONDUCTOR' as const, conductorId: c.id, origen: 'NO_MODELADO' as const }];
		}
		const datos = calcularConductorFisico({ seccionMm2: c.seccion, longitud, config: c.fisica });
		datosConductores.set(c.id, datos);
		return [{ id: `conductor:${c.id}`, de: clave(c.de.dispositivoId, c.de.borneId), a: clave(c.a.dispositivoId, c.a.borneId),
			zOhm: magnitud(datos.zOhm) > 0 ? datos.zOhm : Z_CONTACTO_OHM, tipo: 'CONDUCTOR' as const,
			conductorId: c.id, origen: datos.origenLongitud }];
	});
	for (const d of proyecto.dispositivos) {
		const perfil = resolverComportamiento(d);
		const tipo = perfil?.clase === 'proteccion' ? 'PROTECCION' as const : 'CONTACTO' as const;
		for (const [i, par] of (contexto.conexionesCerradas?.get(d.id) ?? []).entries()) ramas.push({
			id: `interno:${d.id}:${i}`, de: clave(d.id, par[0]), a: clave(d.id, par[1]), zOhm: Z_CONTACTO_OHM,
			tipo, dispositivoId: d.id, origen: 'ESTIMADO',
		});
		for (const [i, par] of (d.puentesInternos ?? []).entries()) ramas.push({
			id: `puente:${d.id}:${i}`, de: clave(d.id, par[0]), a: clave(d.id, par[1]), zOhm: Z_CONTACTO_OHM,
			tipo: 'CONTACTO', dispositivoId: d.id, origen: 'CONFIGURADO',
		});
	}
	const fuentes: FuenteRedFisica[] = proyecto.dispositivos.flatMap(fuenteDesde);
	for (const d of proyecto.dispositivos) fuentes.push(...fuenteTransformadorDesde(d, contexto.bornesEnergizados, diagnosticos));
	const redBase: RedFisica = { nodos, ramas, fuentes, cargas: proyecto.dispositivos.flatMap(cargaDesde) };
	/*
	 * Abrir un conductor o aumentar la resistencia de un terminal no es solo un diagnostico:
	 * cambia la matriz que se resuelve. Los cortocircuitos siguen usando Thevenin como corriente
	 * prospectiva, pero las alteraciones serie se aplican primero y por tanto tambien modifican
	 * el camino, la caida y la Icc que ven los demas fallos del mismo ensayo.
	 */
	const red = aplicarFallosTopologia(redBase, contexto.fallas ?? []);
	const resultadoRed = resolverRedFisica(red);
	const tensionReferencia = Math.max(0, ...red.fuentes.map((f) => magnitud(f.tensionV)));
	const conductores = new Map<string, ResultadoConductorProyectoFisica>();
	for (const [id, datos] of datosConductores) {
		const rr = resultadoRed.ramas.get(`conductor:${id}`); if (!rr) continue;
		const caidaV = magnitud(rr.caidaV);
		conductores.set(id, { ...datos, conductorId: id, corrienteA: magnitud(rr.corrienteA), caidaV,
			caidaPct: tensionReferencia > 0 ? caidaV / tensionReferencia * 100 : undefined, perdidaW: rr.perdidaW });
	}
	const protecciones = new Map<string, ResultadoProteccionProyectoFisica>();
	for (const d of proyecto.dispositivos) {
		const perfil = resolverComportamiento(d); if (perfil?.clase !== 'proteccion') continue;
		const corrientes = [...resultadoRed.ramas].filter(([id]) => id.startsWith(`interno:${d.id}:`)).map(([, r]) => r.corrienteA);
		const corrienteA = Math.max(0, ...corrientes.map(magnitud));
		const inA = d.fisica?.proteccion?.inA ?? d.corrienteNominal;
		const curvaPropia = d.fisica?.proteccion?.puntos?.length ? {
			id: d.fisica.proteccion.curva ?? `CURVA:${d.id}`, descripcion: 'Curva configurada por el proyecto',
			puntos: d.fisica.proteccion.puntos, instantaneoDesdeIn: d.fisica.proteccion.instantaneoDesdeIn, origen: 'CONFIGURADO' as const,
		} : CURVAS_PROTECCION_GENERICAS[d.fisica?.proteccion?.curva ?? d.curvaDisparo ?? ''];
		const residual = corrientes.length > 1 ? magnitud(corrientes.reduce((s, i) => ({ re: s.re + i.re, im: s.im + i.im }), complejo(0))) : undefined;
		protecciones.set(d.id, { dispositivoId: d.id, corrienteA, inA,
			evaluacion: evaluarCurva(curvaPropia, corrienteA, inA ?? 0), corrienteResidualA: residual, fallas: [] });
	}
	const fallas = (contexto.fallas ?? []).map((f) => resolverFalla(red, f));
	const selectividad: CoordinacionFisicaProyecto[] = [];
	for (const falla of fallas) {
		if (!falla.nodoA || !falla.iccA) continue;
		const camino = rutaProtecciones(red, falla.nodoA);
		const corriente = magnitud(falla.iccA);
		for (const id of camino) {
			const p = protecciones.get(id); const d = proyecto.dispositivos.find((x) => x.id === id);
			if (!p || !d) continue;
			const curva = CURVAS_PROTECCION_GENERICAS[d.fisica?.proteccion?.curva ?? d.curvaDisparo ?? ''];
			if (corriente > p.corrienteA) {
				p.corrienteA = corriente; p.evaluacion = evaluarCurva(curva, corriente, p.inA ?? 0);
			}
			p.fallas.push(falla.id);
		}
		for (let i = 0; i + 1 < camino.length; i++) {
			const abajo = protecciones.get(camino[i]); const arriba = protecciones.get(camino[i + 1]);
			if (!abajo || !arriba) continue;
			const da = proyecto.dispositivos.find((d) => d.id === camino[i])!;
			const ar = proyecto.dispositivos.find((d) => d.id === camino[i + 1])!;
			const curva = (d: Dispositivo) => CURVAS_PROTECCION_GENERICAS[d.fisica?.proteccion?.curva ?? d.curvaDisparo ?? ''];
			const eAbajo = evaluarCurva(curva(da), corriente, abajo.inA ?? 0);
			const eArriba = evaluarCurva(curva(ar), corriente, arriba.inA ?? 0);
			selectividad.push({ fallaId: falla.id, aguasAbajoId: da.id, aguasArribaId: ar.id,
				...analizarSelectividad(eAbajo, eArriba) });
		}
	}
	return { activo, red: resultadoRed, conductores, protecciones, fallas, selectividad,
		lazosAnalogicos: [], diagnosticos: [...diagnosticos, ...resultadoRed.diagnosticos, ...fallas.flatMap((f) => f.diagnosticos)] };
}
