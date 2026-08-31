import type { Dispositivo, Proyecto } from '../modelo/tipos.js';
import { resolverComportamiento } from '../modelo/comportamiento.js';
import type { OrigenDatoFisico } from '../modelo/fisica.js';
import { calcularConductorFisico, resolverLongitudConductor, type ResultadoConductorFisico } from './conductores.js';
import { complejo, magnitud, polar } from './complejos.js';
import type { FallaFisicaRuntime, ResultadoFallaFisica } from './fallas.js';
import { aplicarAlteracionesSerieTopologia, aplicarFallosTopologia, resolverFalla } from './fallas.js';
import {
	CURVAS_PROTECCION_GENERICAS, analizarSelectividad, evaluarCurva, type EvaluacionCurvaProteccion,
	type PerfilCurvaProteccion, type ResultadoSelectividad,
} from './protecciones.js';
import { resolverRedFisica } from './solver.js';
import type {
	CargaRedFisica, DiagnosticoFisica, FuenteRedFisica, RedFisica, ResultadoRedFisica,
	RamaRedFisica, TransformadorRedFisica,
} from './tipos.js';
import type { ResultadoLazoAnalogicoFisico } from './analogicas.js';
import { calcularPlacaMotor, factorCorrienteMotor,
	type EstadoMotorParaFisica, type ResultadoMotorFisico } from './motores.js';
import { tensionSalidaVfd, validarVfdFisico,
	type EstadoVfdParaFisica, type ResultadoVfdFisico } from './variadores.js';
import { analizarTrifasico, type AnalisisTrifasicoFisico } from './trifasica.js';

const Z_CONTACTO_OHM = complejo(1e-6);

export interface ContextoTopologiaFisica {
	conexionesCerradas?: ReadonlyMap<string, readonly (readonly [string, string])[]>;
	longitudesM?: ReadonlyMap<string, { metros: number; origen: OrigenDatoFisico }>;
	seccionesMm2?: ReadonlyMap<string, number>;
	fallas?: readonly FallaFisicaRuntime[];
	bornesEnergizados?: ReadonlySet<string>;
	motores?: ReadonlyMap<string, EstadoMotorParaFisica>;
	variadores?: ReadonlyMap<string, EstadoVfdParaFisica>;
}

export interface ResultadoConductorProyectoFisica extends ResultadoConductorFisico {
	conductorId: string;
	corrienteA: number;
	caidaV: number;
	caidaPct?: number;
	perdidaW: number;
}

export interface ResultadoContactoProyectoFisica {
	ramaId: string;
	dispositivoId: string;
	terminales: [string, string];
	corrienteA: number;
	caidaV: number;
	resistenciaEfectivaOhm?: number;
	perdidaW: number;
	origen: OrigenDatoFisico;
}

export interface ResultadoProteccionProyectoFisica {
	dispositivoId: string;
	corrienteA: number;
	inA?: number;
	evaluacion: EvaluacionCurvaProteccion;
	corrienteResidualA?: number;
	corrienteResidualFasorA?: { re: number; im: number };
	corrienteResidualNominalA?: number;
	retardoResidualS?: number;
	estadoResidual?: 'NORMAL' | 'ACTUACION' | 'NO_DISPONIBLE';
	modeloResidual?: 'RESIDUAL_RMS_MODELED';
	fallas: string[];
}

export interface CoordinacionFisicaProyecto extends ResultadoSelectividad {
	fallaId: string;
	aguasAbajoId: string;
	aguasArribaId: string;
}

/**
 * Datos ya normalizados por PhysicsEngine que puede consultar un instrumento.
 *
 * No es una segunda red ni se persiste: conserva exactamente la topologia efectiva (incluidas
 * aperturas y resistencias de ensayo) que produjo `red`. La UI puede medir sobre este snapshot,
 * pero no volver a resolverlo ni reconstruirlo desde el Proyecto.
 */
export interface ContextoMedicionFisica {
	energizada: boolean;
	ramas: ReadonlyMap<string, Pick<RamaRedFisica, 'id' | 'de' | 'a' | 'zOhm' | 'tipo' | 'origen'>>;
	fuentes: readonly {
		id: string;
		de: string;
		a: string;
		modo: 'AC' | 'DC';
		frecuenciaHz?: number;
	}[];
}

export interface ResultadoFisicaElectrica {
	activo: boolean;
	red: ResultadoRedFisica;
	conductores: Map<string, ResultadoConductorProyectoFisica>;
	contactos: Map<string, ResultadoContactoProyectoFisica>;
	protecciones: Map<string, ResultadoProteccionProyectoFisica>;
	fallas: ResultadoFallaFisica[];
	selectividad: CoordinacionFisicaProyecto[];
	lazosAnalogicos: ResultadoLazoAnalogicoFisico[];
	motores: Map<string, ResultadoMotorFisico>;
	variadores: Map<string, ResultadoVfdFisico>;
	trifasicos: Map<string, AnalisisTrifasicoFisico>;
	medicion: ContextoMedicionFisica;
	diagnosticos: DiagnosticoFisica[];
}

const clave = (dispositivoId: string, borneId: string): string => `${dispositivoId}::${borneId}`;

export function perfilCurvaProteccionDispositivo(dispositivo: Dispositivo): PerfilCurvaProteccion | undefined {
	const config = dispositivo.fisica?.proteccion;
	return config?.puntos?.length ? {
		id: config.curva ?? `CURVA:${dispositivo.id}`,
		descripcion: 'Curva configurada por el proyecto',
		puntos: config.puntos,
		instantaneoDesdeIn: config.instantaneoDesdeIn,
		origen: 'CONFIGURADO',
	} : CURVAS_PROTECCION_GENERICAS[config?.curva ?? dispositivo.curvaDisparo ?? ''];
}

export function resultadoFisicaVacio(): ResultadoFisicaElectrica {
	return {
		activo: false,
		red: { nodos: new Map(), ramas: new Map(), cargas: new Map(), fuentes: new Map(), transformadores: new Map(), diagnosticos: [],
			potenciaCargasW: 0, potenciaPerdidasW: 0, potenciaFuentesW: 0,
			metricas: { nodos: 0, ramas: 0, iteraciones: 0, convergio: true, tiempoMs: 0, residuoKclA: 0, errorBalanceW: 0 } },
		conductores: new Map(), contactos: new Map(), protecciones: new Map(), fallas: [], selectividad: [], lazosAnalogicos: [],
		motores: new Map(), variadores: new Map(), trifasicos: new Map(),
		medicion: { energizada: false, ramas: new Map(), fuentes: [] }, diagnosticos: [],
	};
}

function fuentesVfdDesde(dispositivo: Dispositivo, estado: EstadoVfdParaFisica | undefined): FuenteRedFisica[] {
	const config = dispositivo.fisica?.vfd; const perfil = resolverComportamiento(dispositivo);
	if (!config || perfil?.clase !== 'variador' || !estado || !['marcha', 'decel'].includes(estado.estado)
		|| estado.frecuenciaHz <= 0) return [];
	const tensionLinea = tensionSalidaVfd(config, estado.frecuenciaHz);
	const tensionFase = tensionLinea / Math.sqrt(3);
	const neutro = `${dispositivo.id}::__salida_n_v6`;
	return ([perfil.salida.u, perfil.salida.v, perfil.salida.w] as const).map((borne, i) => ({
		id: `vfd-salida:${dispositivo.id}:${i}`, de: clave(dispositivo.id, borne), a: neutro,
		tensionV: polar(tensionFase, [0, -120, 120][i] * Math.PI / 180),
		zInternaOhm: complejo(config.rSalidaOhm ?? 0.01), origenImpedancia: 'ESTIMADO' as const,
		frecuenciaHz: estado.frecuenciaHz,
	}));
}

function cargasEntradaVfdDesde(
	dispositivo: Dispositivo,
	estado: EstadoVfdParaFisica | undefined,
	proyecto: Proyecto,
	motores: ReadonlyMap<string, EstadoMotorParaFisica> | undefined,
): CargaRedFisica[] {
	const config = dispositivo.fisica?.vfd; const perfil = resolverComportamiento(dispositivo);
	if (!config || perfil?.clase !== 'variador' || !estado || estado.estado === 'falla' || estado.frecuenciaHz <= 0) return [];
	const vout = tensionSalidaVfd(config, estado.frecuenciaHz);
	let pout = 0;
	for (const motor of proyecto.dispositivos) {
		const cm = motor.fisica?.motor; const em = motores?.get(motor.id);
		if (!cm || em?.alimentadoPorVariadorId !== dispositivo.id) continue;
		const placa = calcularPlacaMotor(cm); const factor = factorCorrienteMotor(cm, em);
		if (em.estado === 'arrancando' || em.motivoFalla === 'motor-bloqueado' || em.motivoFalla === 'perdida-fase') {
			pout += Math.sqrt(cm.fases === 3 ? 3 : 1) * vout * placa.corrienteNominalUsadaA * factor * cm.factorPotencia;
		} else pout += placa.potenciaEntradaNominalW * factor * (vout / Math.max(1e-9, cm.tensionNominalV)) ** 2;
	}
	if (!(pout > 0)) return [];
	const pin = pout / config.eficiencia;
	if (config.fasesEntrada === 1) {
		const fase = perfil.alimentacion.fases[0]; const retorno = perfil.alimentacion.retornos[0];
		if (!fase || !retorno) return [];
		return [{ id: `vfd-entrada:${dispositivo.id}:0`, de: clave(dispositivo.id, fase), a: clave(dispositivo.id, retorno),
			modelo: 'CONSTANT_PQ', potenciaVA: complejo(pin), tensionNominalV: config.tensionEntradaNominalV,
			dispositivoId: dispositivo.id, origen: 'ESTIMADO' }];
	}
	const fases = perfil.alimentacion.fases.slice(0, 3); if (fases.length < 3) return [];
	const vFase = config.tensionEntradaNominalV / Math.sqrt(3);
	const rFase = vFase * vFase / Math.max(1e-9, pin / 3);
	return fases.map((fase, i) => ({ id: `vfd-entrada:${dispositivo.id}:${i}`,
		de: clave(dispositivo.id, fase), a: `${dispositivo.id}::__entrada_n_v6`, modelo: 'CONSTANT_Z' as const,
		zOhm: complejo(rFase), dispositivoId: dispositivo.id, origen: 'ESTIMADO' as const }));
}

function cargaDesde(dispositivo: Dispositivo, estadoMotor?: EstadoMotorParaFisica): CargaRedFisica[] {
	const motor = dispositivo.fisica?.motor;
	if (motor) {
		const perfil = resolverComportamiento(dispositivo);
		if (perfil?.clase !== 'carga' || perfil.efecto !== 'giro') return [];
		const placa = calcularPlacaMotor(motor);
		const factor = factorCorrienteMotor(motor, estadoMotor);
		if (factor <= 0) return [];
		const pares: [string, string, number][] = motor.fases === 3 && perfil.alimentacion.fases.length >= 3
			? perfil.alimentacion.fases.slice(0, 3).map((fase, i) => [fase, '__estrella_v5', i] as [string, string, number])
			: perfil.alimentacion.fases[0] && perfil.alimentacion.retornos[0]
				? [[perfil.alimentacion.fases[0], perfil.alimentacion.retornos[0], 0]] : [];
		const transitorio = estadoMotor?.estado === 'arrancando' || estadoMotor?.motivoFalla === 'motor-bloqueado'
			|| estadoMotor?.motivoFalla === 'perdida-fase';
		return pares.map(([de, a, indice]): CargaRedFisica => {
			const comunes = { id: `motor:${dispositivo.id}:${indice}`, de: clave(dispositivo.id, de),
				a: a === '__estrella_v5' ? `${dispositivo.id}::__estrella_v5` : clave(dispositivo.id, a),
				dispositivoId: dispositivo.id, origen: transitorio ? 'ESTIMADO' as const : 'CALCULADO' as const };
			/* Equivalente Z de ingeniería en todo el régimen V6. Conserva In/PF a tensión de placa,
			 * permite estrella flotante y hace que la caída de red limite la corriente. No pretende
			 * ser el circuito electromagnético dq de una máquina real. */
			const vFase = motor.tensionNominalV / (motor.fases === 3 ? Math.sqrt(3) : 1);
			/* Con V/f lineal, la reactancia equivalente cae con la frecuencia junto con la tensión.
			 * Mantener Z fija hacía que un rotor bloqueado a 10 Hz pareciera consumir 1/5 de la
			 * corriente: justo lo contrario del diagnóstico que debe ver el variador. Este escalado
			 * conserva la corriente de ingeniería; no pretende modelar saturación ni el circuito dq. */
			const escalaFrecuencia = estadoMotor?.alimentadoPorVariadorId
				? Math.max(0.01, (estadoMotor.frecuenciaElectricaHz ?? motor.frecuenciaHz) / motor.frecuenciaHz) : 1;
			const z = vFase / Math.max(1e-9, placa.corrienteNominalUsadaA * factor) * escalaFrecuencia;
			const angulo = Math.acos(motor.factorPotencia);
			return { ...comunes, modelo: 'CONSTANT_Z', zOhm: complejo(z * Math.cos(angulo), z * Math.sin(angulo)) };
		});
	}
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
	if (t.primarioTerminales && t.secundarioTerminales) return [];
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

function transformadorAcopladoDesde(dispositivo: Dispositivo, diagnosticos: DiagnosticoFisica[]): TransformadorRedFisica[] {
	const t = dispositivo.fisica?.transformador;
	if (!t?.primarioTerminales || !t.secundarioTerminales) return [];
	if (!(t.primarioV > 0) || !(t.secundarioV > 0)) {
		diagnosticos.push({ codigo: 'CONFIGURACION_INVALIDA', mensaje: `${dispositivo.id}: relacion de transformacion invalida`, elementos: [dispositivo.id] });
		return [];
	}
	const relacion = t.primarioV / t.secundarioV;
	let zSeriePrimarioOhm = complejo(1e-9);
	let origen: OrigenDatoFisico = 'NO_MODELADO';
	if (t.potenciaVA && t.impedanciaPct !== undefined) {
		const zBase = t.primarioV * t.primarioV / t.potenciaVA;
		const modulo = zBase * t.impedanciaPct / 100;
		const xr = Math.max(0, t.xSobreR ?? 3);
		const r = modulo / Math.sqrt(1 + xr * xr);
		zSeriePrimarioOhm = complejo(r, r * xr); origen = 'CALCULADO';
	}
	return [{ id: `transformador:${dispositivo.id}`,
		primarioDe: clave(dispositivo.id, t.primarioTerminales[0]), primarioA: clave(dispositivo.id, t.primarioTerminales[1]),
		secundarioDe: clave(dispositivo.id, t.secundarioTerminales[0]), secundarioA: clave(dispositivo.id, t.secundarioTerminales[1]),
		relacion, zSeriePrimarioOhm, potenciaNominalVA: t.potenciaVA, origen }];
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
	for (const d of proyecto.dispositivos) if (d.fisica?.carga?.fases || d.fisica?.motor?.fases === 3) nodos.push({ id: `${d.id}::__estrella_v5`, referencia: false });
	for (const d of proyecto.dispositivos) if (d.fisica?.vfd) {
		nodos.push({ id: `${d.id}::__salida_n_v6`, referencia: true });
		if (d.fisica.vfd.fasesEntrada === 3) nodos.push({ id: `${d.id}::__entrada_n_v6`, referencia: false });
	}
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
	const datosContactos = new Map<string, { dispositivoId: string; terminales: [string, string]; origen: OrigenDatoFisico }>();
	const ramasMedidasDiferencial = new Map<string, { ramaId: string; signo: 1 | -1 }[]>();
	const ramas: RamaRedFisica[] = proyecto.conductores.flatMap((c): RamaRedFisica[] => {
		const de = proyecto.dispositivos.find((d) => d.id === c.de.dispositivoId)?.posicion;
		const a = proyecto.dispositivos.find((d) => d.id === c.a.dispositivoId)?.posicion;
		const estimacionM = de && a ? Math.hypot(de.x - a.x, de.y - a.y) / 1000 : undefined;
		const declarada = contexto.longitudesM?.get(c.id);
		const longitud = declarada ?? resolverLongitudConductor(c.fisica, undefined, estimacionM);
		const seccionMm2 = contexto.seccionesMm2?.get(c.id) ?? c.seccion;
		if (!(seccionMm2 && seccionMm2 > 0) || longitud.metros <= 0) {
			diagnosticos.push({ codigo: 'CONFIGURACION_INVALIDA', mensaje: `Cable ${c.id} sin seccion o longitud fisica fiable`, elementos: [c.id] });
			return [{ id: `conductor:${c.id}`, de: clave(c.de.dispositivoId, c.de.borneId), a: clave(c.a.dispositivoId, c.a.borneId),
				zOhm: Z_CONTACTO_OHM, tipo: 'CONDUCTOR' as const, conductorId: c.id, origen: 'NO_MODELADO' as const }];
		}
		const datos = calcularConductorFisico({ seccionMm2, longitud, config: c.fisica,
			origenSeccion: contexto.seccionesMm2?.has(c.id) ? 'INYECTADO' : 'CONFIGURADO' });
		datosConductores.set(c.id, datos);
		return [{ id: `conductor:${c.id}`, de: clave(c.de.dispositivoId, c.de.borneId), a: clave(c.a.dispositivoId, c.a.borneId),
			zOhm: magnitud(datos.zOhm) > 0 ? datos.zOhm : Z_CONTACTO_OHM, tipo: 'CONDUCTOR' as const,
			conductorId: c.id, origen: datos.origenLongitud }];
	});
	for (const d of proyecto.dispositivos) {
		const perfil = resolverComportamiento(d);
		const tipo = perfil?.clase === 'proteccion' ? 'PROTECCION' as const : 'CONTACTO' as const;
		const conexiones = contexto.conexionesCerradas?.get(d.id) ?? [];
		const medidos = perfil?.clase === 'proteccion' && perfil.funcion === 'diferencial'
			? (d.fisica?.diferencial?.conductoresMedidos ?? perfil.polos)
				.filter((p) => ![p.entrada, p.salida].some((id) => d.bornes.find((b) => b.id === id)?.tipo === 'PE'))
			: [];
		for (const [i, par] of conexiones.entries()) {
			const ramaId = `interno:${d.id}:${i}`;
			datosContactos.set(ramaId, { dispositivoId: d.id, terminales: [...par], origen: 'ESTIMADO' });
			ramas.push({ id: ramaId, de: clave(d.id, par[0]), a: clave(d.id, par[1]), zOhm: Z_CONTACTO_OHM,
				tipo, dispositivoId: d.id, origen: 'ESTIMADO' });
			const medido = medidos.find((p) => (p.entrada === par[0] && p.salida === par[1])
				|| (p.entrada === par[1] && p.salida === par[0]));
			if (medido) {
				const lista = ramasMedidasDiferencial.get(d.id) ?? [];
				lista.push({ ramaId, signo: medido.entrada === par[0] ? 1 : -1 });
				ramasMedidasDiferencial.set(d.id, lista);
			}
		}
		for (const [i, par] of (d.puentesInternos ?? []).entries()) ramas.push({
			id: `puente:${d.id}:${i}`, de: clave(d.id, par[0]), a: clave(d.id, par[1]), zOhm: Z_CONTACTO_OHM,
			tipo: 'CONTACTO', dispositivoId: d.id, origen: 'CONFIGURADO',
		});
		const referenciaPe = d.fisica?.fuente?.referenciaPe;
		if (referenciaPe) ramas.push({
			id: `referencia-pe:${d.id}`, de: clave(d.id, d.fisica!.fuente!.referencia),
			a: clave(d.id, referenciaPe), zOhm: Z_CONTACTO_OHM,
			tipo: 'CONTACTO', dispositivoId: d.id, origen: 'CONFIGURADO',
		});
	}
	const fuentes: FuenteRedFisica[] = proyecto.dispositivos.flatMap(fuenteDesde);
	for (const d of proyecto.dispositivos) fuentes.push(...fuenteTransformadorDesde(d, contexto.bornesEnergizados, diagnosticos));
	for (const d of proyecto.dispositivos) fuentes.push(...fuentesVfdDesde(d, contexto.variadores?.get(d.id)));
	const transformadores = proyecto.dispositivos.flatMap((d) => transformadorAcopladoDesde(d, diagnosticos));
	for (const d of proyecto.dispositivos) {
		const t = d.fisica?.transformador;
		if (!t?.primarioTerminales || !(t.perdidasVacioW && t.perdidasVacioW > 0)) continue;
		const rNucleo = t.primarioV * t.primarioV / t.perdidasVacioW;
		ramas.push({ id: `transformador-vacio:${d.id}`, de: clave(d.id, t.primarioTerminales[0]),
			a: clave(d.id, t.primarioTerminales[1]), zOhm: complejo(rNucleo), tipo: 'TRANSFORMADOR',
			dispositivoId: d.id, origen: 'CONFIGURADO' });
	}
	const redBase: RedFisica = { nodos, ramas, fuentes, transformadores,
		cargas: proyecto.dispositivos.flatMap((d) => [
			...cargaDesde(d, contexto.motores?.get(d.id)),
			...cargasEntradaVfdDesde(d, contexto.variadores?.get(d.id), proyecto, contexto.motores),
		]) };
	/*
	 * Abrir un conductor o aumentar la resistencia de un terminal no es solo un diagnostico:
	 * cambia la matriz que se resuelve. Los cortocircuitos siguen usando Thevenin como corriente
	 * prospectiva, pero las alteraciones serie se aplican primero y por tanto tambien modifican
	 * el camino, la caida y la Icc que ven los demas fallos del mismo ensayo.
	 */
	const fallasRuntime = contexto.fallas ?? [];
	const redPrefalla = aplicarAlteracionesSerieTopologia(redBase, fallasRuntime);
	const red = aplicarFallosTopologia(redBase, fallasRuntime);
	const resultadoRed = resolverRedFisica(red);
	const tensionReferencia = Math.max(0, ...red.fuentes.map((f) => magnitud(f.tensionV)));
	const conductores = new Map<string, ResultadoConductorProyectoFisica>();
	for (const [id, datos] of datosConductores) {
		const rr = resultadoRed.ramas.get(`conductor:${id}`); if (!rr) continue;
		const caidaV = magnitud(rr.caidaV);
		conductores.set(id, { ...datos, conductorId: id, corrienteA: magnitud(rr.corrienteA), caidaV,
			caidaPct: tensionReferencia > 0 ? caidaV / tensionReferencia * 100 : undefined, perdidaW: rr.perdidaW });
	}
	const contactos = new Map<string, ResultadoContactoProyectoFisica>();
	for (const [ramaId, datos] of datosContactos) {
		const rr = resultadoRed.ramas.get(ramaId); if (!rr) continue;
		const corrienteA = magnitud(rr.corrienteA); const caidaV = magnitud(rr.caidaV);
		contactos.set(ramaId, { ramaId, ...datos, corrienteA, caidaV,
			resistenciaEfectivaOhm: corrienteA > 1e-9 ? caidaV / corrienteA : undefined, perdidaW: rr.perdidaW });
	}
	const protecciones = new Map<string, ResultadoProteccionProyectoFisica>();
	for (const d of proyecto.dispositivos) {
		const perfil = resolverComportamiento(d); if (perfil?.clase !== 'proteccion') continue;
		const corrientes = [...resultadoRed.ramas].filter(([id]) => id.startsWith(`interno:${d.id}:`)).map(([, r]) => r.corrienteA);
		const corrienteA = Math.max(0, ...corrientes.map(magnitud));
		const inA = d.fisica?.proteccion?.inA ?? d.corrienteNominal;
		const medidas = ramasMedidasDiferencial.get(d.id) ?? [];
		const fasorResidual = medidas.length >= 2 ? medidas.reduce((s, m) => {
			const i = resultadoRed.ramas.get(m.ramaId)?.corrienteA;
			return i ? { re: s.re + m.signo * i.re, im: s.im + m.signo * i.im } : s;
		}, complejo(0)) : undefined;
		const umbralResidual = d.fisica?.diferencial?.corrienteResidualNominalA
			?? (d.sensibilidadMA !== undefined ? d.sensibilidadMA / 1000 : undefined);
		const residual = fasorResidual ? magnitud(fasorResidual) : undefined;
		protecciones.set(d.id, { dispositivoId: d.id, corrienteA, inA,
			evaluacion: evaluarCurva(perfilCurvaProteccionDispositivo(d), corrienteA, inA ?? 0),
			corrienteResidualA: residual, corrienteResidualFasorA: fasorResidual,
			corrienteResidualNominalA: umbralResidual,
			retardoResidualS: d.fisica?.diferencial?.retardoS ?? 0,
			estadoResidual: residual === undefined || umbralResidual === undefined ? 'NO_DISPONIBLE'
				: residual >= umbralResidual ? 'ACTUACION' : 'NORMAL',
			modeloResidual: medidas.length >= 2 ? 'RESIDUAL_RMS_MODELED' : undefined,
			fallas: [] });
	}
	const motores = new Map<string, ResultadoMotorFisico>();
	for (const d of proyecto.dispositivos) {
		const config = d.fisica?.motor; if (!config) continue;
		const placa = calcularPlacaMotor(config); const estadoMotor = contexto.motores?.get(d.id);
		const cargasMotor = [...resultadoRed.cargas].filter(([id]) => id.startsWith(`motor:${d.id}:`)).map(([, c]) => c);
		const s = cargasMotor.reduce((a, c) => ({ re: a.re + c.potenciaVA.re, im: a.im + c.potenciaVA.im }), complejo(0));
		const corrienteA = Math.max(0, ...cargasMotor.map((c) => magnitud(c.corrienteA)));
		const tensionFase = cargasMotor.length ? cargasMotor.reduce((a, c) => a + magnitud(c.tensionV), 0) / cargasMotor.length : 0;
		const tensionV = config.fases === 3 ? tensionFase * Math.sqrt(3) : tensionFase;
		const diagnosticosMotor = [...placa.diagnosticos];
		/* Un motor tras VFD no debe compararse siempre contra su tensión de placa: a 10 Hz el perfil
		 * V/f ordena aproximadamente 1/5 de tensión. Usar 400 V como umbral fabricaba una pérdida de
		 * fase y una subtensión sanas. La presencia sigue midiéndose fase por fase en la solución. */
		const escalaVf = estadoMotor?.alimentadoPorVariadorId && estadoMotor.frecuenciaElectricaHz !== undefined
			? Math.max(0, Math.min(1, estadoMotor.frecuenciaElectricaHz / config.frecuenciaHz)) : 1;
		const tensionEsperadaV = config.tensionNominalV * escalaVf;
		const tensionNominalFase = tensionEsperadaV / (config.fases === 3 ? Math.sqrt(3) : 1);
		const fasesFisicasPresentes = cargasMotor.filter((c) => magnitud(c.tensionV) >= tensionNominalFase * 0.2).length;
		const fasesPresentes = Math.min(estadoMotor?.fasesPresentes ?? config.fases, fasesFisicasPresentes);
		if (fasesPresentes < config.fases) diagnosticosMotor.push({
			codigo: 'PERDIDA_FASE', mensaje: `${fasesPresentes}/${config.fases} fases físicas presentes.`, origen: 'CALCULADO' });
		if (estadoMotor?.motivoFalla === 'motor-bloqueado') diagnosticosMotor.push({ codigo: 'ROTOR_BLOQUEADO',
			mensaje: 'RPM nulas con corriente de rotor bloqueado estimada.', origen: 'ESTIMADO' });
		if (estadoMotor?.motivoFalla === 'sobrecarga') diagnosticosMotor.push({ codigo: 'SOBRECARGA_MECANICA',
			mensaje: 'Carga mecánica de ensayo superior a la nominal.', origen: 'INYECTADO' });
		if (tensionV > 0 && tensionV < tensionEsperadaV * (config.umbralSubtension ?? 0.9)) diagnosticosMotor.push({
			codigo: 'UNDERVOLTAGE', mensaje: `${tensionV.toFixed(1)} V por debajo del umbral configurado.`, origen: 'CALCULADO' });
		const aparente = magnitud(s); const bloqueado = estadoMotor?.motivoFalla === 'motor-bloqueado';
		const fallaFisica = diagnosticosMotor.some((x) => ['PERDIDA_FASE', 'UNDERVOLTAGE', 'ROTOR_BLOQUEADO'].includes(x.codigo));
		motores.set(d.id, { dispositivoId: d.id, tensionV, corrienteA,
			potenciaEntradaW: s.re, potenciaReactivaVar: s.im, potenciaAparenteVA: aparente,
			factorPotencia: aparente > 1e-9 ? s.re / aparente : undefined,
			potenciaMecanicaEstimadaW: bloqueado ? 0 : Math.max(0, s.re * config.eficiencia * (estadoMotor?.velocidadActual ?? 1)),
			eficiencia: config.eficiencia, rpm: bloqueado ? 0 : estadoMotor?.rpmEstimada,
			rpmSincronas: placa.rpmSincronas, deslizamiento: placa.deslizamiento,
			corrienteNominalCalculadaA: placa.corrienteNominalCalculadaA,
			corrienteNominalUsadaA: placa.corrienteNominalUsadaA,
			estado: fallaFisica ? 'falla' : estadoMotor?.estado ?? 'marcha', diagnosticos: diagnosticosMotor,
			origen: estadoMotor?.estado === 'arrancando' || estadoMotor?.estado === 'falla' ? 'ESTIMADO' : 'CALCULADO' });
	}
	const variadores = new Map<string, ResultadoVfdFisico>();
	for (const d of proyecto.dispositivos) {
		const config = d.fisica?.vfd; const perfil = resolverComportamiento(d);
		if (!config || perfil?.clase !== 'variador') continue;
		const estadoVfd = contexto.variadores?.get(d.id) ?? { estado: 'listo' as const, frecuenciaHz: 0, frecuenciaObjetivoHz: 0 };
		const entradas = [...resultadoRed.cargas].filter(([id]) => id.startsWith(`vfd-entrada:${d.id}:`)).map(([, c]) => c);
		const salidas = [...resultadoRed.fuentes].filter(([id]) => id.startsWith(`vfd-salida:${d.id}:`)).map(([, f]) => f);
		const inputBornes = perfil.alimentacion.fases.slice(0, config.fasesEntrada);
		const vEntradaFases = inputBornes.map((b) => resultadoRed.nodos.get(clave(d.id, b))?.tensionV).filter((v): v is { re: number; im: number } => !!v);
		const tensionEntradaV = config.fasesEntrada === 3 ? (vEntradaFases.reduce((s, v) => s + magnitud(v), 0)
			/ Math.max(1, vEntradaFases.length)) * Math.sqrt(3)
			: vEntradaFases[0] && perfil.alimentacion.retornos[0]
				? magnitud({ re: vEntradaFases[0].re - (resultadoRed.nodos.get(clave(d.id, perfil.alimentacion.retornos[0]))?.tensionV?.re ?? 0),
					im: vEntradaFases[0].im - (resultadoRed.nodos.get(clave(d.id, perfil.alimentacion.retornos[0]))?.tensionV?.im ?? 0) }) : 0;
		const potenciaEntradaW = entradas.reduce((s, c) => s + Math.max(0, c.potenciaVA.re), 0);
		const potenciaSalidaW = salidas.reduce((s, f) => s + Math.max(0, f.potenciaEntregadaVA.re), 0);
		const corrienteEntradaA = Math.max(0, ...entradas.map((c) => magnitud(c.corrienteA)));
		const corrienteSalidaA = Math.max(0, ...salidas.map((f) => magnitud(f.corrienteEntregadaA)));
		const tensionSalidaV = tensionSalidaVfd(config, estadoVfd.frecuenciaHz);
		const diagnosticosVfd = validarVfdFisico(config);
		if (tensionEntradaV > 0 && tensionEntradaV < config.tensionEntradaNominalV * (config.umbralSubtension ?? 0.85)) diagnosticosVfd.push({
			codigo: 'VFD_UNDERVOLTAGE', mensaje: `${tensionEntradaV.toFixed(1)} V en entrada.`, origen: 'CALCULADO' });
		if (config.limiteCorrienteA && corrienteSalidaA > config.limiteCorrienteA) diagnosticosVfd.push({
			codigo: 'VFD_OVERCURRENT', mensaje: `${corrienteSalidaA.toFixed(2)} A supera ${config.limiteCorrienteA} A.`, origen: 'CALCULADO' });
		if (config.fasesEntrada === 3 && vEntradaFases.length < 3) diagnosticosVfd.push({ codigo: 'VFD_PHASE_LOSS',
			mensaje: `${vEntradaFases.length}/3 fases de entrada con tensión resoluble.`, origen: 'CALCULADO' });
		variadores.set(d.id, { dispositivoId: d.id, tensionEntradaV, corrienteEntradaA, potenciaEntradaW,
			tensionSalidaV, corrienteSalidaA, potenciaSalidaW, perdidasW: Math.max(0, potenciaEntradaW - potenciaSalidaW),
			eficiencia: potenciaEntradaW > 1e-9 ? Math.max(0, Math.min(1, potenciaSalidaW / potenciaEntradaW)) : undefined,
			frecuenciaSalidaHz: estadoVfd.frecuenciaHz, estado: estadoVfd.estado, diagnosticos: diagnosticosVfd, origen: 'ESTIMADO' });
	}
	const trifasicos = new Map<string, AnalisisTrifasicoFisico>();
	for (const d of proyecto.dispositivos) {
		const config = d.fisica?.fuente; if (config?.sistema !== 'AC_TRIFASICA') continue;
		const orden = { L1: 0, L2: 1, L3: 2 } as const;
		const fases = config.fases.map((fase, indice) => ({ fase, indice }))
			.filter((x): x is { fase: typeof x.fase & { fase: keyof typeof orden }; indice: number } => x.fase.fase in orden)
			.sort((a, b) => orden[a.fase.fase] - orden[b.fase.fase]);
		if (fases.length !== 3) continue;
		const tensiones = fases.map(({ indice }) => resultadoRed.fuentes.get(`fuente:${d.id}:${indice}`)?.tensionTerminalV);
		const corrientes = fases.map(({ indice }) => resultadoRed.fuentes.get(`fuente:${d.id}:${indice}`)?.corrienteEntregadaA);
		if (tensiones.some((x) => !x) || corrientes.some((x) => !x)) continue;
		trifasicos.set(d.id, analizarTrifasico(d.id,
			tensiones as [{ re: number; im: number }, { re: number; im: number }, { re: number; im: number }],
			corrientes as [{ re: number; im: number }, { re: number; im: number }, { re: number; im: number }],
			config.umbralDesequilibrioPct));
	}
	const fallas = fallasRuntime.map((f) => resolverFalla(redPrefalla, f));
	const selectividad: CoordinacionFisicaProyecto[] = [];
	for (const falla of fallas) {
		if (!falla.nodoA || !falla.iccA) continue;
		const camino = rutaProtecciones(red, falla.nodoA);
		const corriente = magnitud(falla.iccA);
		for (const id of camino) {
			const p = protecciones.get(id); const d = proyecto.dispositivos.find((x) => x.id === id);
			if (!p || !d) continue;
			if (corriente > p.corrienteA) {
				p.corrienteA = corriente; p.evaluacion = evaluarCurva(perfilCurvaProteccionDispositivo(d), corriente, p.inA ?? 0);
			}
			p.fallas.push(falla.id);
		}
		for (let i = 0; i + 1 < camino.length; i++) {
			const abajo = protecciones.get(camino[i]); const arriba = protecciones.get(camino[i + 1]);
			if (!abajo || !arriba) continue;
			const da = proyecto.dispositivos.find((d) => d.id === camino[i])!;
			const ar = proyecto.dispositivos.find((d) => d.id === camino[i + 1])!;
			const eAbajo = evaluarCurva(perfilCurvaProteccionDispositivo(da), corriente, abajo.inA ?? 0);
			const eArriba = evaluarCurva(perfilCurvaProteccionDispositivo(ar), corriente, arriba.inA ?? 0);
			selectividad.push({ fallaId: falla.id, aguasAbajoId: da.id, aguasArribaId: ar.id,
				...analizarSelectividad(eAbajo, eArriba) });
		}
	}
	const medicion: ContextoMedicionFisica = {
		/* Tension presente, aunque el circuito no consuma, exige la misma precaucion que en campo. */
		energizada: [...resultadoRed.nodos.values()].some((n) => n.tensionV && magnitud(n.tensionV) > 1e-6),
		ramas: new Map(red.ramas.map((r) => [r.id, {
			id: r.id, de: r.de, a: r.a, zOhm: r.zOhm, tipo: r.tipo, origen: r.origen,
		}])),
		fuentes: red.fuentes.map((f) => ({ id: f.id, de: f.de, a: f.a,
			modo: f.frecuenciaHz === 0 ? 'DC' as const : 'AC' as const, frecuenciaHz: f.frecuenciaHz })),
	};
	return { activo, red: resultadoRed, conductores, contactos, protecciones, fallas, selectividad, motores, variadores, trifasicos, medicion,
		lazosAnalogicos: [], diagnosticos: [...diagnosticos, ...resultadoRed.diagnosticos, ...fallas.flatMap((f) => f.diagnosticos)] };
}
