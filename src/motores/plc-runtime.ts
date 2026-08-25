import type {
	ConfiguracionProgramaPLC, EstadoAlarmaPLC, EstadoPIDPLC, EtiquetaPLC, FuerzasPLC,
	ImagenEntradasPLC, ImagenSalidasPLC, OrdenesRuntimePLC, RuntimePLC, ValorAnalogicoPLC,
} from '../modelo/programa-plc.js';
import type { CalidadSenalAnalogica } from '../modelo/senal-analogica.js';
import type { ExprPLC, ProgramaPLCCompilado } from './plc-compilador.js';
import { evaluar, esperasDe, memoriaLogicaVacia, salidasActivas, valoresAnalogicos } from './logica.js';

export interface ResultadoActualizacionPLC {
	runtime: RuntimePLC;
	scansEjecutados: number;
	salidasCambiaron: boolean;
}

const EVENTOS_MAXIMOS = 200;

export function crearRuntimePLC(programa: ProgramaPLCCompilado): RuntimePLC {
	const variables: Record<string, boolean | number> = {};
	for (const tag of Object.values(programa.etiquetas)) variables[tag.nombre] = inicialDe(tag);
	variables.FIRST_SCAN = false;
	return {
		estado: programa.modoInicial === 'RUN' ? 'RUN' : 'STOP',
		modoSolicitado: programa.modoInicial,
		pausado: false,
		primerScanPendiente: true,
		scan: 0,
		duracionUltimoScanMs: 0,
		entradas: { digitales: {}, analogicas: {} },
		salidas: salidasSeguras(programa),
		variables,
		temporizadores: {}, contadores: {}, secuencias: {}, alarmas: {}, pids: {}, flancos: {},
		interlocks: [], fuerzas: {}, forzadas: [], errores: [], eventos: [],
		legacy: memoriaLogicaVacia(),
	};
}

export function reiniciarRuntimePLC(programa: ProgramaPLCCompilado): RuntimePLC {
	return crearRuntimePLC(programa);
}

/**
 * Scheduler determinista de un PLC. Captura una imagen por scan y publica todas las salidas juntas.
 * El llamador debe invocarlo para todos los PLC con imágenes ya congeladas y comprometer después
 * todos los runtimes, de modo que el orden de los dispositivos no afecte al resultado.
 */
export function actualizarRuntimePLC(
	programa: ProgramaPLCCompilado,
	anterior: RuntimePLC | undefined,
	entradas: ImagenEntradasPLC,
	ahoraMs: number,
	alimentado: boolean,
	ordenes: OrdenesRuntimePLC = {},
): ResultadoActualizacionPLC {
	let runtime = anterior ? clonarRuntime(anterior) : crearRuntimePLC(programa);
	const salidasAntes = runtime.salidas;
	if (ordenes.reiniciar) runtime = crearRuntimePLC(programa);
	if (ordenes.modo) runtime.modoSolicitado = ordenes.modo;
	if (ordenes.pausado !== undefined) runtime.pausado = ordenes.pausado;
	if (ordenes.fuerzas) runtime.fuerzas = clonarFuerzas(ordenes.fuerzas);
	runtime.forzadas = nombresFuerzas(runtime.fuerzas);
	procesarAlarmas(runtime, ordenes, ahoraMs);

	if (!alimentado) {
		if (runtime.estado !== 'SIN_ALIMENTACION') evento(runtime, ahoraMs, 'ESTADO', 'PLC sin alimentación; salidas seguras');
		runtime.estado = 'SIN_ALIMENTACION';
		runtime.salidas = salidasSeguras(programa);
		runtime.entradas = imagenConFuerzas(entradas, runtime.fuerzas);
		runtime.primerScanPendiente = true;
		runtime.ultimoScanMs = undefined;
		runtime.proximoScanMs = undefined;
		reiniciarNoRetain(runtime, programa);
		reiniciarBloques(runtime);
		return resultado(runtime, salidasAntes, 0);
	}

	if (programa.errores.length) {
		runtime.estado = 'FAULT';
		runtime.errores = programa.errores.map((e) => `L${e.linea}: ${e.mensaje}`);
		runtime.salidas = salidasSeguras(programa);
		eventoUnico(runtime, ahoraMs, 'FAULT', `Programa inválido: ${runtime.errores[0]}`);
		return resultado(runtime, salidasAntes, 0);
	}

	if (runtime.modoSolicitado === 'STOP') {
		if (runtime.estado !== 'STOP') evento(runtime, ahoraMs, 'ESTADO', 'PLC en STOP; salidas seguras');
		runtime.estado = 'STOP';
		runtime.salidas = salidasSeguras(programa);
		runtime.entradas = imagenConFuerzas(entradas, runtime.fuerzas);
		runtime.primerScanPendiente = true;
		runtime.proximoScanMs = ahoraMs;
		return resultado(runtime, salidasAntes, 0);
	}

	if (runtime.estado !== 'RUN') {
		runtime.estado = 'RUN'; runtime.primerScanPendiente = true; runtime.proximoScanMs = ahoraMs;
		evento(runtime, ahoraMs, 'ESTADO', 'PLC en RUN');
	}
	if (runtime.proximoScanMs === undefined) runtime.proximoScanMs = ahoraMs;
	const paso = ordenes.paso === true;
	if (runtime.pausado && !paso) return resultado(runtime, salidasAntes, 0);
	const pendientesSinLimite = paso ? 1 : ahoraMs >= runtime.proximoScanMs
		? Math.floor((ahoraMs - runtime.proximoScanMs) / programa.periodoScanMs) + 1 : 0;
	const pendientes = Math.min(pendientesSinLimite, programa.catchUpMaximo);
	const catchUpRecortado = pendientesSinLimite > programa.catchUpMaximo;
	let ejecutados = 0;
	for (let i = 0; i < pendientes; i++) {
		/* Si se recorta un backlog, el último scan representa el presente; no congela timers atrás. */
		const instante: number = paso || catchUpRecortado && i === pendientes - 1
			? ahoraMs : Math.min(ahoraMs, runtime.proximoScanMs ?? ahoraMs);
		const dtMs = runtime.ultimoScanMs === undefined ? programa.periodoScanMs
			: Math.max(0, instante - runtime.ultimoScanMs);
		try {
			ejecutarScan(programa, runtime, entradas, instante, dtMs);
			runtime.ultimoScanMs = instante;
			runtime.proximoScanMs = instante + programa.periodoScanMs;
			runtime.scan++;
			runtime.primerScanPendiente = false;
			ejecutados++;
		} catch (e) {
			runtime.estado = 'FAULT';
			runtime.errores = [(e as Error).message];
			runtime.salidas = salidasSeguras(programa);
			evento(runtime, instante, 'FAULT', (e as Error).message);
			break;
		}
	}
	if (!paso && catchUpRecortado) {
		/* Se descarta backlog sobrante: tiempo monotónico y costo acotado. */
		runtime.proximoScanMs = ahoraMs + programa.periodoScanMs;
		evento(runtime, ahoraMs, 'SCAN', `Catch-up limitado a ${programa.catchUpMaximo} scans`);
	}
	return resultado(runtime, salidasAntes, ejecutados);
}

function ejecutarScan(
	programa: ProgramaPLCCompilado,
	runtime: RuntimePLC,
	entradasCrudas: ImagenEntradasPLC,
	ahoraMs: number,
	dtMs: number,
): void {
	const inicio = rendimientoAhora();
	const entradas = imagenConFuerzas(entradasCrudas, runtime.fuerzas);
	runtime.entradas = entradas;
	runtime.errores = [];
	runtime.interlocks = [];
	runtime.forzadas = nombresFuerzas(runtime.fuerzas);
	const valores: Record<string, boolean | number> = { ...runtime.variables, FIRST_SCAN: runtime.primerScanPendiente };
	for (const tag of Object.values(programa.etiquetas)) {
		if (tag.io?.clase === 'DI') valores[tag.nombre] = entradas.digitales[tag.io.borne] ?? false;
		if (tag.io?.clase === 'AI') valores[tag.nombre] = entradas.analogicas[tag.io.borne]?.valor ?? Number.NaN;
		if (tag.io?.clase === 'DO') valores[tag.nombre] = runtime.salidas.digitales[tag.io.borne] ?? false;
		if (tag.io?.clase === 'AO') valores[tag.nombre] = runtime.salidas.analogicas[tag.io.borne] ?? 0;
	}
	let operaciones = 0;
	const flancosNuevos: Record<string, boolean> = {};
	const ctx: Contexto = {
		valores, entradas, flancosPrevios: runtime.flancos, flancosNuevos,
		operacion: () => { if (++operaciones > programa.operacionesPorScan) throw new Error(`Watchdog PLC: más de ${programa.operacionesPorScan} operaciones en un scan`); },
	};

	if (programa.legacy) {
		const lecturaBase = {
			activos: new Set(Object.entries(entradas.digitales).filter(([, v]) => v).map(([k]) => k)),
			valores: Object.fromEntries(Object.entries(entradas.analogicas).flatMap(([k, v]) => v.valor === undefined ? [] : [[k, v.valor]])),
		};
		const memoria = runtime.legacy ?? memoriaLogicaVacia();
		let digitales = new Set(Object.entries(runtime.salidas.digitales).filter(([, v]) => v).map(([k]) => k));
		let estable = false;
		/*
		 * El adaptador legacy permitía que un renglón leyera otra salida. Se estabiliza esa lógica
		 * DENTRO del scan, sin volver a resolver el circuito eléctrico ni ejecutar otro scan.
		 */
		for (let pasada = 0; pasada < Math.max(2, programa.legacy.reglas.length + 1); pasada++) {
			const siguientes = salidasActivas(programa.legacy.reglas,
				{ ...lecturaBase, salidasPrevias: digitales }, { ahora: ahoraMs, memoria });
			if (igualesSet(digitales, siguientes)) { digitales = siguientes; estable = true; break; }
			digitales = siguientes;
		}
		if (!estable) throw new Error('El programa legacy no estabiliza sus salidas dentro de un scan');
		const lecturaFinal = { ...lecturaBase, salidasPrevias: digitales };
		const analogicas = valoresAnalogicos(programa.legacy.reglas, lecturaFinal);
		runtime.legacy = memoria;
		runtime.salidas = aplicarFuerzasSalida({
			digitales: Object.fromEntries(Object.keys(runtime.salidas.digitales).map((b) => [b, digitales.has(b)])),
			analogicas: { ...runtime.salidas.analogicas, ...analogicas },
		}, runtime.fuerzas);
		runtime.duracionUltimoScanMs = rendimientoAhora() - inicio;
		return;
	}

	for (const s of programa.secuencias) runtime.secuencias[s.nombre] ??= s.inicial;
	for (const s of programa.secuencias) for (const estado of s.estados) {
		valores[`${s.nombre}.${estado}`] = runtime.secuencias[s.nombre] === estado;
	}
	/* Bloques se calculan contra la imagen y memoria del scan anterior. */
	for (const t of programa.temporizadores) {
		const entrada = bool(evalExpr(t.entrada, ctx));
		const previo = runtime.temporizadores[t.nombre] ?? { tipo: t.tipo, IN: false, Q: false, PT: t.ptMs, ET: 0 };
		let ET = previo.ET; let Q = previo.Q;
		if (t.tipo === 'TON') { ET = entrada ? Math.min(t.ptMs, ET + dtMs) : 0; Q = entrada && ET >= t.ptMs; }
		if (t.tipo === 'TOF') { if (entrada) { ET = 0; Q = true; } else { ET = Math.min(t.ptMs, ET + dtMs); Q = previo.Q && ET < t.ptMs; } }
		if (t.tipo === 'TP') {
			const sube = entrada && !previo.IN;
			if (sube && !Q) { Q = true; ET = 0; }
			else if (Q) { ET = Math.min(t.ptMs, ET + dtMs); if (ET >= t.ptMs) Q = false; }
			else ET = 0;
		}
		runtime.temporizadores[t.nombre] = { tipo: t.tipo, IN: entrada, Q, PT: t.ptMs, ET };
		valores[`${t.nombre}.Q`] = Q; valores[`${t.nombre}.ET`] = ET / 1000;
	}
	for (const c of programa.contadores) {
		const entrada = bool(evalExpr(c.entrada, ctx)); const control = bool(evalExpr(c.control, ctx));
		const previo = runtime.contadores[c.nombre] ?? { tipo: c.tipo, CV: c.tipo === 'CTD' ? c.pv : 0, PV: c.pv, Q: false, entradaAnterior: false };
		let CV = previo.CV;
		if (c.tipo === 'CTU') { if (control) CV = 0; else if (entrada && !previo.entradaAnterior) CV++; }
		else { if (control) CV = c.pv; else if (entrada && !previo.entradaAnterior) CV--; }
		const Q = c.tipo === 'CTU' ? CV >= c.pv : CV <= 0;
		runtime.contadores[c.nombre] = { tipo: c.tipo, CV, PV: c.pv, Q, entradaAnterior: entrada };
		valores[`${c.nombre}.Q`] = Q; valores[`${c.nombre}.CV`] = CV;
	}
	for (const s of programa.secuencias) {
		const candidatas = programa.transiciones.filter((t) => t.secuencia === s.nombre && t.desde === runtime.secuencias[s.nombre] && bool(evalExpr(t.condicion, ctx)))
			.sort((a, b) => b.prioridad - a.prioridad || a.linea - b.linea);
		if (candidatas.length) runtime.secuencias[s.nombre] = candidatas[0].hacia;
		for (const estado of s.estados) valores[`${s.nombre}.${estado}`] = runtime.secuencias[s.nombre] === estado;
	}

	const escriturasInternas: Record<string, boolean | number> = {};
	const digitales: Record<string, boolean> = {};
	const analogicas: Record<string, number> = {};
	for (const tag of Object.values(programa.etiquetas)) {
		if (tag.io?.clase === 'DO') digitales[tag.io.borne] = false;
		if (tag.io?.clase === 'AO') analogicas[tag.io.borne] = 0;
	}
	const destinosSetReset = new Set(programa.setReset.map((s) => s.destino));
	for (const destino of destinosSetReset) {
		const set = programa.setReset.some((s) => s.destino === destino && s.tipo === 'set' && bool(evalExpr(s.condicion, ctx)));
		const reset = programa.setReset.some((s) => s.destino === destino && s.tipo === 'reset' && bool(evalExpr(s.condicion, ctx)));
		const anterior = bool(valores[destino] ?? false); const v = reset ? false : set ? true : anterior;
		const tag = programa.etiquetas[destino];
		if (tag.io?.clase === 'DO') digitales[tag.io.borne] = v;
		else { escriturasInternas[destino] = v; valores[destino] = v; }
	}
	/* Las variables internas siguen el orden de programa; las E/S solo se publican al final. */
	for (const a of programa.asignaciones) {
		const v = evalExpr(a.valor, ctx); const tag = programa.etiquetas[a.destino];
		if (tag.io?.clase === 'DO') digitales[tag.io.borne] = bool(v);
		else if (tag.io?.clase === 'AO') analogicas[tag.io.borne] = real(v);
		else { escriturasInternas[a.destino] = v; valores[a.destino] = v; }
	}

	for (const p of programa.pids) {
		const calidad = calidadDeExpr(p.pv, entradas);
		const pvCruda = evalExpr(p.pv, ctx); const pv = calidad === 'normal' ? real(pvCruda) : Number.NaN;
		const sp = real(evalExpr(p.sp, ctx)); const anterior = runtime.pids[p.nombre] ?? pidInicial(calidad);
		const auto = p.auto ? bool(evalExpr(p.auto, ctx)) : true; const dtS = Math.max(0.001, dtMs / 1000);
		let salida = anterior.salida; let integral = anterior.integral; let errorAnterior = anterior.errorAnterior; let saturado = false;
		if (!auto && p.manual) salida = real(evalExpr(p.manual, ctx));
		else if (calidad !== 'normal' || !Number.isFinite(pv)) {
			if (p.malaPV === 'SAFE') salida = p.minimo;
			else if (p.malaPV === 'FAULT') throw new Error(`PID ${p.nombre}: PV inválida (${calidad})`);
		} else {
			const error = sp - pv; const proporcional = p.kp * error;
			const candidatoI = p.tiS > 0 ? integral + p.kp * error * dtS / p.tiS : integral;
			const derivada = p.tdS > 0 ? p.kp * p.tdS * (error - errorAnterior) / dtS : 0;
			const bruto = proporcional + candidatoI + derivada;
			salida = Math.max(p.minimo, Math.min(p.maximo, bruto)); saturado = salida !== bruto;
			if (!saturado || (bruto > p.maximo && error < 0) || (bruto < p.minimo && error > 0)) integral = candidatoI;
			errorAnterior = error;
		}
		analogicas[programa.etiquetas[p.salida].io!.borne] = Math.max(p.minimo, Math.min(p.maximo, salida));
		runtime.pids[p.nombre] = { salida, integral, errorAnterior, manual: !auto, saturado, calidadPV: calidad };
	}

	for (const a of programa.alarmas) {
		const condicion = bool(evalExpr(a.condicion, ctx)); const previa = runtime.alarmas[a.id];
		const activa = a.enclavada ? condicion || (previa?.activa ?? false) : condicion;
		const alarma: EstadoAlarmaPLC = {
			id: a.id, severidad: a.severidad, mensaje: a.mensaje, activa, enclavada: a.enclavada,
			reconocida: activa ? (previa?.reconocida ?? false) : false,
			desdeMs: activa ? (previa?.desdeMs ?? ahoraMs) : undefined,
		};
		if (activa && !previa?.activa) evento(runtime, ahoraMs, 'ALARMA', `${a.severidad}: ${a.mensaje}`);
		runtime.alarmas[a.id] = alarma; valores[`ALARM.${a.id}`] = activa;
	}
	for (const i of programa.interlocks) {
		const permiso = bool(evalExpr(i.permiso, ctx));
		const tag = programa.etiquetas[i.salida]; const borne = tag.io?.borne ?? i.salida;
		const activo = digitales[borne] === true && !permiso;
		if (activo) digitales[borne] = false;
		runtime.interlocks.push({ salida: i.salida, mensaje: i.mensaje, activo });
	}

	for (const [k, v] of Object.entries(escriturasInternas)) runtime.variables[k] = v;
	runtime.variables.FIRST_SCAN = runtime.primerScanPendiente;
	runtime.flancos = { ...runtime.flancos, ...flancosNuevos };
	runtime.salidas = aplicarFuerzasSalida({ digitales, analogicas }, runtime.fuerzas);
	runtime.duracionUltimoScanMs = rendimientoAhora() - inicio;
}

function igualesSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	return a.size === b.size && [...a].every((x) => b.has(x));
}

interface Contexto {
	valores: Record<string, boolean | number>;
	entradas: ImagenEntradasPLC;
	flancosPrevios: Record<string, boolean>;
	flancosNuevos: Record<string, boolean>;
	operacion: () => void;
}

function evalExpr(e: ExprPLC, ctx: Contexto): boolean | number {
	ctx.operacion();
	switch (e.op) {
		case 'literal': return e.valor;
		case 'ref': return ctx.valores[e.nombre] ?? (e.tipo === 'BOOL' ? false : Number.NaN);
		case 'not': return !bool(evalExpr(e.valor, ctx));
		case 'neg': return -real(evalExpr(e.valor, ctx));
		case 'and': return bool(evalExpr(e.izquierda, ctx)) && bool(evalExpr(e.derecha, ctx));
		case 'or': return bool(evalExpr(e.izquierda, ctx)) || bool(evalExpr(e.derecha, ctx));
		case 'add': return real(evalExpr(e.izquierda, ctx)) + real(evalExpr(e.derecha, ctx));
		case 'sub': return real(evalExpr(e.izquierda, ctx)) - real(evalExpr(e.derecha, ctx));
		case 'mul': return real(evalExpr(e.izquierda, ctx)) * real(evalExpr(e.derecha, ctx));
		case 'div': { const d = real(evalExpr(e.derecha, ctx)); if (d === 0) throw new Error('División por cero: PLC a FAULT y salidas seguras'); return real(evalExpr(e.izquierda, ctx)) / d; }
		case 'gt': return real(evalExpr(e.izquierda, ctx)) > real(evalExpr(e.derecha, ctx));
		case 'gte': return real(evalExpr(e.izquierda, ctx)) >= real(evalExpr(e.derecha, ctx));
		case 'lt': return real(evalExpr(e.izquierda, ctx)) < real(evalExpr(e.derecha, ctx));
		case 'lte': return real(evalExpr(e.izquierda, ctx)) <= real(evalExpr(e.derecha, ctx));
		case 'eq': return evalExpr(e.izquierda, ctx) === evalExpr(e.derecha, ctx);
		case 'neq': return evalExpr(e.izquierda, ctx) !== evalExpr(e.derecha, ctx);
		case 'rising':
		case 'falling': {
			const actual = bool(evalExpr(e.valor, ctx)); const previo = ctx.flancosPrevios[e.id] ?? false;
			ctx.flancosNuevos[e.id] = actual;
			return e.op === 'rising' ? actual && !previo : !actual && previo;
		}
		case 'valid': return ctx.entradas.analogicas[e.nombre]?.calidad === 'normal';
		case 'bad': return ctx.entradas.analogicas[e.nombre]?.calidad !== 'normal';
		case 'min': return Math.min(...e.valores.map((v) => real(evalExpr(v, ctx))));
		case 'max': return Math.max(...e.valores.map((v) => real(evalExpr(v, ctx))));
		case 'clamp': return Math.max(real(evalExpr(e.minimo, ctx)), Math.min(real(evalExpr(e.maximo, ctx)), real(evalExpr(e.valor, ctx))));
	}
}

function calidadDeExpr(e: ExprPLC, entradas: ImagenEntradasPLC): CalidadSenalAnalogica {
	if (e.op === 'ref') return entradas.analogicas[e.nombre]?.calidad ?? 'normal';
	return 'normal';
}

function inicialDe(tag: EtiquetaPLC): boolean | number {
	if (tag.inicial !== undefined && (tag.tipo === 'BOOL' ? typeof tag.inicial === 'boolean' : typeof tag.inicial === 'number')) return tag.inicial;
	return tag.tipo === 'BOOL' ? false : 0;
}

function reiniciarNoRetain(runtime: RuntimePLC, programa: ProgramaPLCCompilado): void {
	for (const tag of Object.values(programa.etiquetas)) if (!tag.retain) runtime.variables[tag.nombre] = inicialDe(tag);
}

function reiniciarBloques(runtime: RuntimePLC): void {
	runtime.temporizadores = {}; runtime.contadores = {}; runtime.secuencias = {}; runtime.pids = {}; runtime.flancos = {};
}

function salidasSeguras(programa: ProgramaPLCCompilado): ImagenSalidasPLC {
	const digitales: Record<string, boolean> = {}; const analogicas: Record<string, number> = {};
	for (const tag of Object.values(programa.etiquetas)) {
		if (tag.io?.clase === 'DO') digitales[tag.io.borne] = false;
		if (tag.io?.clase === 'AO') analogicas[tag.io.borne] = 0;
	}
	return { digitales, analogicas };
}

function imagenConFuerzas(entrada: ImagenEntradasPLC, fuerzas: FuerzasPLC): ImagenEntradasPLC {
	const digitales = { ...entrada.digitales, ...(fuerzas.DI ?? {}) };
	const analogicas = { ...entrada.analogicas };
	for (const [k, valor] of Object.entries(fuerzas.AI ?? {})) analogicas[k] = { valor, calidad: 'normal', origen: 'inyectado' };
	return { digitales, analogicas };
}

function aplicarFuerzasSalida(salidas: ImagenSalidasPLC, fuerzas: FuerzasPLC): ImagenSalidasPLC {
	return { digitales: { ...salidas.digitales, ...(fuerzas.DO ?? {}) }, analogicas: { ...salidas.analogicas, ...(fuerzas.AO ?? {}) } };
}

function nombresFuerzas(f: FuerzasPLC): string[] {
	return (['DI', 'DO', 'AI', 'AO'] as const).flatMap((clase) => Object.keys(f[clase] ?? {}).map((k) => `${clase}:${k}`)).sort();
}

function procesarAlarmas(runtime: RuntimePLC, ordenes: OrdenesRuntimePLC, ahora: number): void {
	for (const id of ordenes.ackAlarmas ?? []) {
		const alarma = runtime.alarmas[id.toUpperCase()];
		if (alarma?.activa && !alarma.reconocida) { alarma.reconocida = true; evento(runtime, ahora, 'ACK', `Alarma ${id} reconocida`); }
	}
	for (const id of ordenes.resetAlarmas ?? []) {
		const alarma = runtime.alarmas[id.toUpperCase()];
		if (alarma?.enclavada && alarma.reconocida) { alarma.activa = false; alarma.desdeMs = undefined; evento(runtime, ahora, 'RESET', `Alarma ${id} rearmada`); }
	}
}

function evento(runtime: RuntimePLC, instanteMs: number, tipo: RuntimePLC['eventos'][number]['tipo'], mensaje: string): void {
	runtime.eventos.push({ instanteMs, tipo, mensaje });
	if (runtime.eventos.length > EVENTOS_MAXIMOS) runtime.eventos.splice(0, runtime.eventos.length - EVENTOS_MAXIMOS);
}

function eventoUnico(runtime: RuntimePLC, instanteMs: number, tipo: RuntimePLC['eventos'][number]['tipo'], mensaje: string): void {
	const ultimo = runtime.eventos.at(-1);
	if (ultimo?.tipo !== tipo || ultimo.mensaje !== mensaje) evento(runtime, instanteMs, tipo, mensaje);
}

function resultado(runtime: RuntimePLC, antes: ImagenSalidasPLC, scansEjecutados: number): ResultadoActualizacionPLC {
	return { runtime, scansEjecutados, salidasCambiaron: JSON.stringify(antes) !== JSON.stringify(runtime.salidas) };
}

function clonarRuntime(r: RuntimePLC): RuntimePLC {
	return structuredClone(r);
}

function clonarFuerzas(f: FuerzasPLC): FuerzasPLC {
	return structuredClone(f);
}

function pidInicial(calidadPV: CalidadSenalAnalogica): EstadoPIDPLC {
	return { salida: 0, integral: 0, errorAnterior: 0, manual: false, saturado: false, calidadPV };
}

const bool = (v: boolean | number): boolean => v === true;
function real(v: boolean | number): number {
	if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Operación REAL con valor inválido');
	return v;
}

function rendimientoAhora(): number {
	return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export function esperasLegacyPLC(programa: ProgramaPLCCompilado, runtime: RuntimePLC, ahoraMs: number) {
	if (!programa.legacy) return [];
	const lectura = {
		activos: new Set(Object.entries(runtime.entradas.digitales).filter(([, v]) => v).map(([k]) => k)),
		valores: Object.fromEntries(Object.entries(runtime.entradas.analogicas).flatMap(([k, v]) => v.valor === undefined ? [] : [[k, v.valor]])),
		salidasPrevias: new Set(Object.entries(runtime.salidas.digitales).filter(([, v]) => v).map(([k]) => k)),
	};
	return esperasDe(programa.legacy.reglas, lectura, { ahora: ahoraMs, memoria: runtime.legacy ?? memoriaLogicaVacia() });
}

/** Ayuda de migración: el `programa` histórico se compila sin tocar el documento persistente. */
export function configLegacyPLC(fuente: string): ConfiguracionProgramaPLC {
	return { version: 1, lenguaje: 'legacy', FUENTE: fuente, modoInicial: 'RUN', periodoScanMs: 100 };
}
