import type { ConfiguracionProgramaPLC, EtiquetaPLC, SeveridadAlarmaPLC, TipoDatoPLC } from '../modelo/programa-plc.js';
import type { ErrorLogica, ReglaLogica } from './logica.js';
import { leerPrograma } from './logica.js';

export interface ErrorCompilacionPLC {
	linea: number;
	texto: string;
	mensaje: string;
}

export type ExprPLC =
	| { op: 'literal'; tipo: TipoDatoPLC; valor: boolean | number }
	| { op: 'ref'; tipo: TipoDatoPLC; nombre: string }
	| { op: 'not' | 'neg'; tipo: TipoDatoPLC; valor: ExprPLC }
	| { op: 'and' | 'or' | 'add' | 'sub' | 'mul' | 'div' | 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq'; tipo: TipoDatoPLC; izquierda: ExprPLC; derecha: ExprPLC }
	| { op: 'rising' | 'falling'; tipo: 'BOOL'; valor: ExprPLC; id: string }
	| { op: 'valid' | 'bad'; tipo: 'BOOL'; nombre: string }
	| { op: 'min' | 'max'; tipo: 'REAL'; valores: ExprPLC[] }
	| { op: 'clamp'; tipo: 'REAL'; valor: ExprPLC; minimo: ExprPLC; maximo: ExprPLC };

export interface AsignacionPLC { tipo: 'asignacion'; linea: number; destino: string; valor: ExprPLC }
export interface SetResetPLC { tipo: 'set' | 'reset'; linea: number; destino: string; condicion: ExprPLC }
export interface TemporizadorPLC { tipo: 'TON' | 'TOF' | 'TP'; linea: number; nombre: string; entrada: ExprPLC; ptMs: number }
export interface ContadorPLC { tipo: 'CTU' | 'CTD'; linea: number; nombre: string; entrada: ExprPLC; control: ExprPLC; pv: number }
export interface SecuenciaPLC { nombre: string; inicial: string; estados: string[] }
export interface TransicionPLC { linea: number; secuencia: string; desde: string; hacia: string; condicion: ExprPLC; prioridad: number }
export interface AlarmaPLC { linea: number; id: string; condicion: ExprPLC; severidad: SeveridadAlarmaPLC; enclavada: boolean; mensaje: string }
export interface InterlockPLC { linea: number; salida: string; permiso: ExprPLC; mensaje: string }
export interface PIDPLC {
	linea: number; nombre: string; pv: ExprPLC; sp: ExprPLC; salida: string;
	kp: number; tiS: number; tdS: number; minimo: number; maximo: number;
	auto?: ExprPLC; manual?: ExprPLC; malaPV: 'HOLD' | 'SAFE' | 'FAULT';
}

export interface ProgramaPLCCompilado {
	lenguaje: ConfiguracionProgramaPLC['lenguaje'];
	periodoScanMs: number;
	modoInicial: 'RUN' | 'STOP';
	operacionesPorScan: number;
	catchUpMaximo: number;
	etiquetas: Record<string, EtiquetaPLC>;
	asignaciones: AsignacionPLC[];
	setReset: SetResetPLC[];
	temporizadores: TemporizadorPLC[];
	contadores: ContadorPLC[];
	secuencias: SecuenciaPLC[];
	transiciones: TransicionPLC[];
	alarmas: AlarmaPLC[];
	interlocks: InterlockPLC[];
	pids: PIDPLC[];
	errores: ErrorCompilacionPLC[];
	legacy?: { reglas: ReglaLogica[]; errores: ErrorLogica[] };
}

export interface IOProgramaPLC {
	DI: string[];
	DO: string[];
	AI: string[];
	AO: string[];
}

const NOMBRE = '[A-Za-z_][A-Za-z0-9_.]*';
const RE_NOMBRE = new RegExp(`^${NOMBRE}$`);
const MAX_FUENTE = 100_000;
const MAX_LINEAS = 2_000;
const MAX_ETIQUETAS = 1_000;

const normalizar = (s: string): string => s.trim().toUpperCase();
const numero = (s: string): number => Number(s.replace(',', '.'));

function etiqueta(nombre: string, tipo: TipoDatoPLC, io?: EtiquetaPLC['io']): EtiquetaPLC {
	return { nombre: normalizar(nombre), tipo, io };
}

function basePrograma(config: ConfiguracionProgramaPLC): Omit<ProgramaPLCCompilado, 'etiquetas'> {
	return {
		lenguaje: config.lenguaje,
		periodoScanMs: Math.max(10, Math.min(5_000, config.periodoScanMs ?? 100)),
		modoInicial: config.modoInicial ?? (config.lenguaje === 'legacy' ? 'RUN' : 'STOP'),
		operacionesPorScan: Math.max(50, Math.min(100_000, config.limites?.operacionesPorScan ?? 5_000)),
		catchUpMaximo: Math.max(1, Math.min(100, config.limites?.catchUpMaximo ?? 10)),
		asignaciones: [], setReset: [], temporizadores: [], contadores: [], secuencias: [],
		transiciones: [], alarmas: [], interlocks: [], pids: [], errores: [],
	};
}

/** Compila el DSL seguro a IR tipado. No usa eval ni genera JavaScript. */
export function compilarProgramaPLC(config: ConfiguracionProgramaPLC, io: IOProgramaPLC): ProgramaPLCCompilado {
	const base = basePrograma(config);
	const etiquetas: Record<string, EtiquetaPLC> = {};
	const programa: ProgramaPLCCompilado = { ...base, etiquetas };
	const agregar = (e: EtiquetaPLC, linea = 0): void => {
		const nombre = normalizar(e.nombre);
		if (!RE_NOMBRE.test(nombre)) {
			programa.errores.push({ linea, texto: e.nombre, mensaje: 'nombre de etiqueta inválido' });
			return;
		}
		const previa = etiquetas[nombre];
		if (previa && (previa.tipo !== e.tipo || previa.io?.clase !== e.io?.clase || previa.io?.borne !== e.io?.borne)) {
			programa.errores.push({ linea, texto: e.nombre, mensaje: `la etiqueta ${nombre} está declarada dos veces con tipos incompatibles` });
			return;
		}
		etiquetas[nombre] = { ...e, nombre };
	};
	for (const borne of io.DI) agregar(etiqueta(borne, 'BOOL', { clase: 'DI', borne }));
	for (const borne of io.DO) agregar(etiqueta(borne, 'BOOL', { clase: 'DO', borne }));
	for (const borne of io.AI) agregar(etiqueta(borne, 'REAL', { clase: 'AI', borne }));
	for (const borne of io.AO) agregar(etiqueta(borne, 'REAL', { clase: 'AO', borne }));
	agregar(etiqueta('FIRST_SCAN', 'BOOL'));
	for (const e of config.etiquetas ?? []) agregar(e);

	if (config.FUENTE.length > MAX_FUENTE) {
		programa.errores.push({ linea: 0, texto: '', mensaje: `el programa supera ${MAX_FUENTE} caracteres` });
		return programa;
	}
	const lineas = config.FUENTE.split(/\r?\n/);
	if (lineas.length > MAX_LINEAS) {
		programa.errores.push({ linea: 0, texto: '', mensaje: `el programa supera ${MAX_LINEAS} renglones` });
		return programa;
	}
	if (config.lenguaje === 'legacy') {
		const leido = leerPrograma(config.FUENTE);
		programa.legacy = leido;
		return programa;
	}

	/* Primera pasada: variables y símbolos que otros renglones pueden referenciar. */
	lineas.forEach((crudo, i) => {
		const texto = sinComentario(crudo);
		if (!texto) return;
		let m = /^VAR\s+(BOOL|REAL)\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\s+(RETAIN))?(?:\s*=\s*(.+))?$/i.exec(texto);
		if (m) {
			const tipo = normalizar(m[1]) as TipoDatoPLC;
			const inicial = m[4] === undefined ? undefined : literalInicial(m[4], tipo);
			if (m[4] !== undefined && inicial === undefined) error(i, crudo, `valor inicial ${tipo} inválido`);
			agregar({ nombre: m[2], tipo, retain: !!m[3], inicial }, i + 1);
			return;
		}
		m = /^(TON|TOF|TP)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(texto);
		if (m) {
			agregar(etiqueta(`${m[2]}.Q`, 'BOOL'), i + 1);
			agregar(etiqueta(`${m[2]}.ET`, 'REAL'), i + 1);
			return;
		}
		m = /^(CTU|CTD)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(texto);
		if (m) {
			agregar(etiqueta(`${m[2]}.Q`, 'BOOL'), i + 1);
			agregar(etiqueta(`${m[2]}.CV`, 'REAL'), i + 1);
			return;
		}
		m = /^SEQUENCE\s+([A-Za-z_][A-Za-z0-9_]*)\s+INITIAL\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(texto);
		if (m) agregar(etiqueta(`${m[1]}.${m[2]}`, 'BOOL'), i + 1);
		m = /^TRANS\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(texto);
		if (m) { agregar(etiqueta(`${m[1]}.${m[2]}`, 'BOOL'), i + 1); agregar(etiqueta(`${m[1]}.${m[3]}`, 'BOOL'), i + 1); }
		m = /^ALARM\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(texto);
		if (m) agregar(etiqueta(`ALARM.${m[1]}`, 'BOOL'), i + 1);
	});
	if (Object.keys(etiquetas).length > MAX_ETIQUETAS) error(-1, '', `el programa supera ${MAX_ETIQUETAS} etiquetas`);

	const escrituras = new Map<string, number>();
	const setPorDestino = new Map<string, Set<'set' | 'reset'>>();
	lineas.forEach((crudo, indice) => {
		const linea = indice + 1;
		const texto = sinComentario(crudo);
		if (!texto || /^VAR\s/i.test(texto)) return;
		try {
			let m: RegExpExecArray | null;
			m = /^(TON|TOF|TP)\s+([A-Za-z_][A-Za-z0-9_]*)\s+IN\s+(.+)\s+PT\s+([\d.,]+)\s*(MS|S)?$/i.exec(texto);
			if (m) {
				const pt = numero(m[4]) * (normalizar(m[5] ?? 'S') === 'MS' ? 1 : 1000);
				if (!(pt >= 0 && Number.isFinite(pt))) throw new Error('PT debe ser un tiempo no negativo');
				programa.temporizadores.push({ tipo: normalizar(m[1]) as TemporizadorPLC['tipo'], linea, nombre: normalizar(m[2]), entrada: expr(m[3], 'BOOL', linea), ptMs: pt });
				return;
			}
			m = /^(CTU|CTD)\s+([A-Za-z_][A-Za-z0-9_]*)\s+(CU|CD)\s+(.+)\s+(RESET|LOAD)\s+(.+)\s+PV\s+(-?[\d.,]+)$/i.exec(texto);
			if (m) {
				const pv = numero(m[7]);
				if (!Number.isFinite(pv)) throw new Error('PV debe ser numérico');
				programa.contadores.push({ tipo: normalizar(m[1]) as ContadorPLC['tipo'], linea, nombre: normalizar(m[2]), entrada: expr(m[4], 'BOOL', linea), control: expr(m[6], 'BOOL', linea), pv });
				return;
			}
			m = /^SEQUENCE\s+([A-Za-z_][A-Za-z0-9_]*)\s+INITIAL\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(texto);
			if (m) {
				const nombre = normalizar(m[1]); const inicial = normalizar(m[2]);
				if (programa.secuencias.some((s) => s.nombre === nombre)) throw new Error(`la secuencia ${nombre} está duplicada`);
				programa.secuencias.push({ nombre, inicial, estados: [inicial] });
				return;
			}
			m = /^TRANS\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s+WHEN\s+(.+?)(?:\s+PRIORITY\s+(-?\d+))?$/i.exec(texto);
			if (m) {
				const secuencia = normalizar(m[1]); const desde = normalizar(m[2]); const hacia = normalizar(m[3]);
				programa.transiciones.push({ linea, secuencia, desde, hacia, condicion: expr(m[4], 'BOOL', linea), prioridad: Number(m[5] ?? 0) });
				return;
			}
			m = /^ALARM\s+([A-Za-z_][A-Za-z0-9_]*)\s+WHEN\s+(.+?)\s+SEVERITY\s+(INFO|WARNING|ALARM|TRIP)(?:\s+(LATCHED))?(?:\s+MESSAGE\s+"([^"]*)")?$/i.exec(texto);
			if (m) {
				programa.alarmas.push({ linea, id: normalizar(m[1]), condicion: expr(m[2], 'BOOL', linea), severidad: normalizar(m[3]) as SeveridadAlarmaPLC, enclavada: !!m[4], mensaje: m[5] ?? normalizar(m[1]) });
				return;
			}
			m = /^INTERLOCK\s+([A-Za-z_][A-Za-z0-9_.]*)\s+REQUIRE\s+(.+?)(?:\s+MESSAGE\s+"([^"]*)")?$/i.exec(texto);
			if (m) {
				const salida = normalizar(m[1]); exigirDestino(salida, ['DO'], linea);
				programa.interlocks.push({ linea, salida, permiso: expr(m[2], 'BOOL', linea), mensaje: m[3] ?? `Permisivo ${salida} no cumplido` });
				return;
			}
			m = /^PID\s+([A-Za-z_][A-Za-z0-9_]*)\s+PV\s+(\S+)\s+SP\s+(\S+)\s+OUT\s+(\S+)\s+KP\s+(-?[\d.,]+)\s+TI\s+([\d.,]+)\s+TD\s+([\d.,]+)\s+MIN\s+(-?[\d.,]+)\s+MAX\s+(-?[\d.,]+)(?:\s+AUTO\s+(\S+)\s+MANUAL\s+(\S+))?(?:\s+BAD\s+(HOLD|SAFE|FAULT))?$/i.exec(texto);
			if (m) {
				const salida = normalizar(m[4]); exigirDestino(salida, ['AO'], linea); registrarEscritura(salida, linea);
				const valores = [m[5], m[6], m[7], m[8], m[9]].map(numero);
				if (valores.some((v) => !Number.isFinite(v)) || valores[1] < 0 || valores[2] < 0 || valores[3] >= valores[4]) throw new Error('parámetros PID inválidos');
				programa.pids.push({ linea, nombre: normalizar(m[1]), pv: expr(m[2], 'REAL', linea), sp: expr(m[3], 'REAL', linea), salida, kp: valores[0], tiS: valores[1], tdS: valores[2], minimo: valores[3], maximo: valores[4], auto: m[10] ? expr(m[10], 'BOOL', linea) : undefined, manual: m[11] ? expr(m[11], 'REAL', linea) : undefined, malaPV: normalizar(m[12] ?? 'SAFE') as PIDPLC['malaPV'] });
				return;
			}
			m = /^(SET|RESET)\s+([A-Za-z_][A-Za-z0-9_.]*)\s+WHEN\s+(.+)$/i.exec(texto);
			if (m) {
				const tipo = normalizar(m[1]).toLowerCase() as 'set' | 'reset'; const destino = normalizar(m[2]);
				exigirDestino(destino, ['DO'], linea, 'BOOL');
				const previas = setPorDestino.get(destino) ?? new Set();
				if (previas.has(tipo)) throw new Error(`${destino} tiene dos escrituras ${tipo.toUpperCase()}`);
				previas.add(tipo); setPorDestino.set(destino, previas);
				programa.setReset.push({ tipo, linea, destino, condicion: expr(m[3], 'BOOL', linea) });
				return;
			}
			m = /^([A-Za-z_][A-Za-z0-9_.]*)\s*:=\s*(.+)$/.exec(texto);
			if (m) {
				const destino = normalizar(m[1]); const tag = etiquetas[destino];
				if (!tag) throw new Error(`etiqueta desconocida ${destino}`);
				if (tag.io?.clase === 'DI' || tag.io?.clase === 'AI') throw new Error(`${destino} es una entrada y no se puede escribir`);
				registrarEscritura(destino, linea);
				programa.asignaciones.push({ tipo: 'asignacion', linea, destino, valor: expr(m[2], tag.tipo, linea) });
				return;
			}
			throw new Error('instrucción PLC V4 no reconocida');
		} catch (e) {
			error(indice, crudo, (e as Error).message);
		}
	});

	for (const t of programa.transiciones) {
		const s = programa.secuencias.find((x) => x.nombre === t.secuencia);
		if (!s) error(t.linea - 1, lineas[t.linea - 1], `secuencia desconocida ${t.secuencia}`);
		else for (const estado of [t.desde, t.hacia]) if (!s.estados.includes(estado)) s.estados.push(estado);
	}
	for (const [destino, tipos] of setPorDestino) {
		if (escrituras.has(destino)) error(escrituras.get(destino)! - 1, lineas[escrituras.get(destino)! - 1], `${destino} mezcla asignación y SET/RESET`);
		if (tipos.size > 2) error(0, '', `${destino} tiene escrituras incompatibles`);
	}
	return programa;

	function error(indice: number, texto: string, mensaje: string): void {
		programa.errores.push({ linea: Math.max(0, indice + 1), texto: texto.trim(), mensaje });
	}
	function registrarEscritura(destino: string, linea: number): void {
		const previa = escrituras.get(destino);
		if (previa !== undefined) throw new Error(`doble escritura de ${destino} (ya escrita en renglón ${previa})`);
		escrituras.set(destino, linea);
	}
	function exigirDestino(destino: string, clases: NonNullable<EtiquetaPLC['io']>['clase'][] | string[], linea: number, tipo?: TipoDatoPLC): void {
		const tag = etiquetas[destino];
		if (!tag) throw new Error(`etiqueta desconocida ${destino}`);
		if (tipo && tag.tipo !== tipo) throw new Error(`${destino} debe ser ${tipo}`);
		if (!tipo && tag.tipo !== (clases.includes('AO') ? 'REAL' : 'BOOL')) throw new Error(`tipo incompatible para ${destino}`);
		if (tag.io && !clases.includes(tag.io.clase)) throw new Error(`${destino} no es una salida compatible`);
		void linea;
	}
	function expr(fuente: string, esperado: TipoDatoPLC, linea: number): ExprPLC {
		const p = new ParserExpr(fuente, etiquetas, linea);
		const e = p.leer();
		if (e.tipo !== esperado) throw new Error(`se esperaba ${esperado} y la expresión es ${e.tipo}`);
		return e;
	}
}

function sinComentario(linea: string): string {
	let enCadena = false;
	for (let i = 0; i < linea.length; i++) {
		if (linea[i] === '"') enCadena = !enCadena;
		if (linea[i] === ';' && !enCadena) return linea.slice(0, i).trim();
	}
	return linea.trim();
}

function literalInicial(fuente: string, tipo: TipoDatoPLC): boolean | number | undefined {
	const f = normalizar(fuente);
	if (tipo === 'BOOL') return f === 'TRUE' || f === 'VERDADERO' ? true : f === 'FALSE' || f === 'FALSO' ? false : undefined;
	const n = numero(fuente);
	return Number.isFinite(n) ? n : undefined;
}

interface Token { tipo: 'nombre' | 'numero' | 'op' | 'paren' | 'coma'; texto: string }

class ParserExpr {
	private readonly tokens: Token[];
	private indice = 0;
	private secuenciaFlanco = 0;

	constructor(private readonly fuente: string, private readonly etiquetas: Record<string, EtiquetaPLC>, private readonly linea: number) {
		this.tokens = tokenizar(fuente);
	}

	leer(): ExprPLC {
		if (!this.tokens.length) throw new Error('expresión vacía');
		const e = this.o();
		if (this.actual()) throw new Error(`sobra «${this.actual()!.texto}» en la expresión`);
		return e;
	}

	private o(): ExprPLC {
		let e = this.y();
		while (this.es('OR', 'O')) { this.indice++; e = this.binaria('or', e, this.y(), 'BOOL', 'BOOL'); }
		return e;
	}
	private y(): ExprPLC {
		let e = this.comparacion();
		while (this.es('AND', 'Y')) { this.indice++; e = this.binaria('and', e, this.comparacion(), 'BOOL', 'BOOL'); }
		return e;
	}
	private comparacion(): ExprPLC {
		let e = this.suma();
		const t = this.actual()?.texto;
		const ops: Record<string, ExprPLC['op']> = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '=': 'eq', '==': 'eq', '<>': 'neq', '!=': 'neq' };
		if (t && ops[t]) { this.indice++; const d = this.suma(); if (e.tipo !== d.tipo) throw new Error('la comparación mezcla BOOL y REAL'); e = { op: ops[t] as 'gt', tipo: 'BOOL', izquierda: e, derecha: d }; }
		return e;
	}
	private suma(): ExprPLC {
		let e = this.producto();
		while (this.actual()?.texto === '+' || this.actual()?.texto === '-') { const op = this.actual()!.texto; this.indice++; e = this.binaria(op === '+' ? 'add' : 'sub', e, this.producto(), 'REAL', 'REAL'); }
		return e;
	}
	private producto(): ExprPLC {
		let e = this.unaria();
		while (this.actual()?.texto === '*' || this.actual()?.texto === '/') { const op = this.actual()!.texto; this.indice++; e = this.binaria(op === '*' ? 'mul' : 'div', e, this.unaria(), 'REAL', 'REAL'); }
		return e;
	}
	private unaria(): ExprPLC {
		if (this.es('NOT', 'NO')) { this.indice++; const valor = this.unaria(); this.exigir(valor, 'BOOL'); return { op: 'not', tipo: 'BOOL', valor }; }
		if (this.actual()?.texto === '-') { this.indice++; const valor = this.unaria(); this.exigir(valor, 'REAL'); return { op: 'neg', tipo: 'REAL', valor }; }
		return this.atomo();
	}
	private atomo(): ExprPLC {
		const t = this.actual();
		if (!t) throw new Error('la expresión termina antes de tiempo');
		if (t.texto === '(') { this.indice++; const e = this.o(); this.tomar(')'); return e; }
		if (t.tipo === 'numero') { this.indice++; return { op: 'literal', tipo: 'REAL', valor: numero(t.texto) }; }
		if (t.tipo !== 'nombre') throw new Error(`no se esperaba «${t.texto}»`);
		this.indice++;
		const nombre = normalizar(t.texto);
		if (nombre === 'TRUE' || nombre === 'VERDADERO') return { op: 'literal', tipo: 'BOOL', valor: true };
		if (nombre === 'FALSE' || nombre === 'FALSO') return { op: 'literal', tipo: 'BOOL', valor: false };
		if (this.actual()?.texto === '(') return this.funcion(nombre);
		const tag = this.etiquetas[nombre];
		if (!tag) throw new Error(`etiqueta desconocida ${nombre}`);
		return { op: 'ref', tipo: tag.tipo, nombre };
	}
	private funcion(nombre: string): ExprPLC {
		this.tomar('(');
		if (nombre === 'RISING' || nombre === 'FALLING') {
			const valor = this.o(); this.exigir(valor, 'BOOL'); this.tomar(')');
			return { op: nombre === 'RISING' ? 'rising' : 'falling', tipo: 'BOOL', valor, id: `L${this.linea}E${this.secuenciaFlanco++}` };
		}
		if (nombre === 'VALID' || nombre === 'BAD') {
			const ref = this.actual();
			if (!ref || ref.tipo !== 'nombre') throw new Error(`${nombre} requiere una entrada analógica`);
			this.indice++; this.tomar(')'); const n = normalizar(ref.texto);
			if (this.etiquetas[n]?.io?.clase !== 'AI') throw new Error(`${n} no es una AI`);
			return { op: nombre === 'VALID' ? 'valid' : 'bad', tipo: 'BOOL', nombre: n };
		}
		const valores: ExprPLC[] = [];
		if (this.actual()?.texto !== ')') {
			do { valores.push(this.o()); if (this.actual()?.texto !== ',') break; this.indice++; } while (true);
		}
		this.tomar(')');
		if (nombre === 'MIN' || nombre === 'MAX') {
			if (valores.length < 2) throw new Error(`${nombre} requiere al menos dos valores`);
			for (const v of valores) this.exigir(v, 'REAL');
			return { op: nombre === 'MIN' ? 'min' : 'max', tipo: 'REAL', valores };
		}
		if (nombre === 'CLAMP') {
			if (valores.length !== 3) throw new Error('CLAMP requiere valor, mínimo y máximo');
			for (const v of valores) this.exigir(v, 'REAL');
			return { op: 'clamp', tipo: 'REAL', valor: valores[0], minimo: valores[1], maximo: valores[2] };
		}
		throw new Error(`función desconocida ${nombre}`);
	}
	private binaria(op: 'and' | 'or' | 'add' | 'sub' | 'mul' | 'div', izquierda: ExprPLC, derecha: ExprPLC, operandos: TipoDatoPLC, tipo: TipoDatoPLC): ExprPLC {
		this.exigir(izquierda, operandos); this.exigir(derecha, operandos);
		return { op, tipo, izquierda, derecha };
	}
	private exigir(e: ExprPLC, tipo: TipoDatoPLC): void { if (e.tipo !== tipo) throw new Error(`se esperaba ${tipo} y se encontró ${e.tipo}`); }
	private actual(): Token | undefined { return this.tokens[this.indice]; }
	private es(...nombres: string[]): boolean { return this.actual()?.tipo === 'nombre' && nombres.includes(normalizar(this.actual()!.texto)); }
	private tomar(texto: string): void { if (this.actual()?.texto !== texto) throw new Error(`falta «${texto}»`); this.indice++; }
}

function tokenizar(fuente: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < fuente.length) {
		if (/\s/.test(fuente[i])) { i++; continue; }
		const resto = fuente.slice(i);
		let m = /^(>=|<=|<>|!=|==|[+\-*/=<>])/.exec(resto);
		if (m) { tokens.push({ tipo: 'op', texto: m[1] }); i += m[1].length; continue; }
		m = /^(\d+(?:[.,]\d+)?)/.exec(resto);
		if (m) { tokens.push({ tipo: 'numero', texto: m[1] }); i += m[1].length; continue; }
		m = /^([A-Za-z_][A-Za-z0-9_.]*)/.exec(resto);
		if (m) { tokens.push({ tipo: 'nombre', texto: m[1] }); i += m[1].length; continue; }
		if (fuente[i] === '(' || fuente[i] === ')') { tokens.push({ tipo: 'paren', texto: fuente[i++] }); continue; }
		if (fuente[i] === ',') { tokens.push({ tipo: 'coma', texto: fuente[i++] }); continue; }
		throw new Error(`carácter no permitido «${fuente[i]}»`);
	}
	return tokens;
}
