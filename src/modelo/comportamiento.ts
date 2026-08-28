/**
 * Contrato serializable entre el modelo de un aparato y el motor de simulación.
 *
 * `tipo` sigue describiendo qué es el aparato para catálogo, esquema y documentación. Este perfil
 * describe qué hace eléctricamente. Separarlos permite que un componente genérico o importado se
 * comporte igual que uno nativo sin deducir su función de la imagen, la marca o el texto visible.
 *
 * La versión 1 es deliberadamente pequeña: formaliza los roles que el motor ya sabe ejecutar,
 * incluido un variador funcional conceptual. No promete PWM, diferencial residual ni una red
 * analógica de proceso completa.
 */
import type { Borne, Dispositivo, TipoDispositivo } from './tipos.js';
import type { VariableFisicaAnalogica } from './senal-analogica.js';

export interface ParBornesSimulacion {
	entrada: string;
	salida: string;
}

export interface ContactoSimulacion extends ParBornesSimulacion {
	reposo: 'abierto' | 'cerrado';
	funcion: 'potencia' | 'auxiliar';
	/** Posiciones en las que conduce un selector; si falta se usa NA/NC respecto de `reposo`. */
	cerradoEn?: number[];
}

export interface ReferenciaAnalogicaSimulacion {
	borne: string;
	comun: string;
	unidad: 'V' | 'mA' | 'porcentaje';
	rango: [number, number];
	/** Respuesta segura si la señal cableada deja de ser válida. */
	perdidaSenal?: 'detener' | 'mantener' | 'fallo';
}

export interface EntradaAnalogicaSimulacion extends ReferenciaAnalogicaSimulacion {
	unidad: 'V' | 'mA';
	variable: VariableFisicaAnalogica;
	/** Una AI activa alimenta el lazo; una pasiva espera una fuente externa. */
	modoEntrada: 'pasiva' | 'activa';
}

export interface TransmisorAnalogicoSimulacion {
	modoConexion: '2-hilos' | '3-hilos';
	salida: ReferenciaAnalogicaSimulacion & { unidad: 'V' | 'mA' };
	variable: VariableFisicaAnalogica;
	/** Fuente eléctrica propia o salida que necesita excitación externa. */
	modoSalida: 'activa' | 'pasiva';
}

export type ComportamientoSimulacion =
	| {
		version: 1;
		clase: 'contactos-electromagneticos';
		bobina: { entrada: string; retorno: string };
		polos: ParBornesSimulacion[];
		contactos: ContactoSimulacion[];
	}
	| {
		version: 1;
		clase: 'controlador';
		alimentacion: { entradas: string[]; retornos: string[] };
		salidasDigitales: { borne: string; comun: string }[];
		entradasAnalogicas?: EntradaAnalogicaSimulacion[];
		salidasAnalogicas: {
			borne: string;
			referencia: string;
			rango: [number, number];
			unidad: 'V' | 'mA';
		}[];
	}
	| {
		version: 1;
		clase: 'fuente';
		primario?: { entradas: string[]; retornos: string[] };
		salidas: { borne: string; papel: 'fase' | 'retorno'; tensionV: number }[];
	}
	| {
		version: 1;
		clase: 'proteccion';
		polos: ParBornesSimulacion[];
		contactos: ContactoSimulacion[];
		rearmable: boolean;
		/** Capacidad física explícita. Ausente solo en perfiles V1 antiguos. */
		funcion?: 'termico' | 'termomagnetico' | 'fusible' | 'diferencial' | 'seccionamiento';
	}
	| {
		version: 1;
		clase: 'mando';
		modo: 'momentaneo' | 'mantenido';
		posiciones: 2 | 3;
		reposo: number;
		contactos: ContactoSimulacion[];
	}
	| {
		version: 1;
		clase: 'sensor';
		contactos: ContactoSimulacion[];
		alimentacion?: { entrada: string; retorno: string };
		salidaDigital?: { borne: string; tomaDe: string };
		transmisor?: TransmisorAnalogicoSimulacion;
	}
	| {
		version: 1;
		clase: 'variador';
		alimentacion: { fases: string[]; retornos: string[]; fasesMinimas: 1 | 3 };
		mando: { run: string; habilitacion?: string };
		referencia: ReferenciaAnalogicaSimulacion;
		salida: { u: string; v: string; w: string; tensionV: number };
		frecuencia: { minimaHz: number; maximaHz: number; rampaHzS: number };
		/** Contacto opcional que cambia cuando el runtime entra en FAULT. */
		contactoFallo?: ContactoSimulacion;
	}
	| {
		version: 1;
		clase: 'carga';
		alimentacion: { fases: string[]; retornos: string[]; fasesMinimas: 1 | 3 };
		efecto: 'giro' | 'luz' | 'movimiento' | 'calor' | 'reactivo' | 'generico';
		mandoAnalogico?: ReferenciaAnalogicaSimulacion & { invertido?: boolean };
		dinamicaActuador?: {
			tipo: 'on-off' | 'modulante';
			tiempoAperturaS: number;
			tiempoCierreS: number;
			failSafe: 'mantener' | 'cerrar' | 'abrir' | 'posicion-segura';
			posicionSegura?: number;
			feedback?: ReferenciaAnalogicaSimulacion & { unidad: 'V' | 'mA' };
		};
		/** Parámetros mecánicos opcionales; la ausencia se publica como estimación, nunca como placa. */
		dinamicaMotor?: {
			polos?: number;
			tiempoArranqueS?: number;
			tiempoParadaS?: number;
			deslizamiento?: number;
		};
	}
	| {
		version: 1;
		clase: 'pasivo';
		conexiones: ParBornesSimulacion[];
	}
	| {
		version: 1;
		clase: 'sin-comportamiento';
		motivo: string;
	};

export type NivelFidelidadSimulacion = 'completa-v5' | 'completa-v4' | 'completa-v3' | 'completa-v2' | 'completa-v1' | 'parcial' | 'sin-comportamiento';

export interface FilaFidelidadSimulacion {
	nivel: NivelFidelidadSimulacion;
	participacion: string;
	limitacion: string;
}

/**
 * Matriz contractual, no texto de marketing. Al estar tipada como `Record<TipoDispositivo, ...>`,
 * añadir una familia al modelo obliga a declarar qué sabe hacer el motor con ella.
 */
export const MATRIZ_FIDELIDAD_SIMULACION = {
	version: 5,
	tipos: {
		plc: {
			nivel: 'completa-v4',
			participacion: 'Scan determinista, imágenes DI/DO/AI/AO, IR tipada, timers/counters, secuencias, alarmas, interlocks, fuerzas y PID V1.',
			limitacion: 'DSL propia, no IEC 61131-3; PID sin modelo físico de planta ni módulos/protocolos industriales específicos.',
		},
		fuente: { nivel: 'completa-v5', participacion: 'Con perfil físico explícito publica fasores DC/AC, frecuencia e impedancia interna para V, I, potencia e Icc.', limitacion: 'Sin perfil V5 conserva la fuente funcional ideal; no modela regulación ni límite dinámico de potencia.' },
		transformador: { nivel: 'parcial', participacion: 'Secundario monofásico aislado con relación y Z porcentual configurables.', limitacion: 'Equivalente desacoplado estimado: no refleja carga al primario, saturación, inrush ni grupos vectoriales.' },
		contactor: { nivel: 'completa-v1', participacion: 'Bobina, polos y auxiliares NA/NC.', limitacion: 'Sin tiempos mecánicos ni desgaste.' },
		rele: { nivel: 'completa-v2', participacion: 'Relé auxiliar/temporizado y térmico con acumulación, enfriamiento, 95-96 y 97-98.', limitacion: 'Curva térmica funcional estimada; sin modelo de bimetal certificado.' },
		disyuntor: { nivel: 'completa-v5', participacion: 'Estado V2 alimentado por corriente V5, curva genérica térmica/instantánea, Icc y ventana de disparo.', limitacion: 'Modelo de ingeniería; sin selectividad, poder de corte ni curva certificada de fabricante.' },
		guardamotor: { nivel: 'completa-v5', participacion: 'Corte V2 y memoria térmica/magnética consumen corriente física V5 cuando está disponible.', limitacion: 'Pérdida de fase y curva son aproximaciones; sin coordinación certificada.' },
		diferencial: { nivel: 'completa-v2', participacion: 'CERRADO/ABIERTO/DISPARADO por fuga inyectada; V5 publica suma vectorial si hay polos resueltos.', limitacion: 'El disparo residual calculado aún no sustituye el ensayo inyectado; no modela red de tierra externa.' },
		fusible: { nivel: 'completa-v5', participacion: 'OK/FUNDIDO no rearmable, curva/I²t genéricos y apertura real de la rama física.', limitacion: 'Sin energía pasante o curva certificada de fabricante.' },
		seccionador: { nivel: 'parcial', participacion: 'Apertura y cierre de polos.', limitacion: 'Sin enclavamientos ni poder de corte.' },
		variador: { nivel: 'completa-v3', participacion: 'V2 más referencia cableada 0-10 V/4-20 mA, calidad y pérdida configurable.', limitacion: 'Salida trifásica conceptual; sin PWM, par ni frenado regenerativo.' },
		motor: {
			nivel: 'completa-v2',
			participacion: 'DETENIDO/ARRANCANDO/MARCHA/DESACELERANDO/FALLO, fases, Hz, velocidad y RPM opcionales.',
			limitacion: 'Dinámica, corriente de arranque y RPM son estimadas; sin par electromagnético ni modelo térmico interno certificado.',
		},
		pulsador: { nivel: 'parcial', participacion: 'Conmuta contactos NA/NC con modo momentáneo explícito.', limitacion: 'La duración física depende del cliente que entrega el estado.' },
		selector: { nivel: 'parcial', participacion: 'Selector mantenido de dos o tres posiciones y contactos por posición.', limitacion: 'Sin llave, retorno por resorte ni secuencias de leva.' },
		piloto: { nivel: 'completa-v1', participacion: 'Carga binaria e indicación luminosa.', limitacion: 'No modela vida útil o destrucción por sobretensión.' },
		sensor: { nivel: 'completa-v3', participacion: 'PNP alimentado y transmisor 0-10 V/4-20 mA de 2/3 hilos con calidad.', limitacion: 'Topología funcional sin impedancias ni protocolo HART.' },
		valvula: { nivel: 'completa-v3', participacion: 'ON/OFF o modulante, carrera temporal, fail-safe y feedback opcional.', limitacion: 'Sin presión, caudal, fuerzas ni dinámica hidráulica.' },
		resistencia: { nivel: 'completa-v5', participacion: 'Carga física Z explícita con V, I, P, Q, S y PF calculados por la red.', limitacion: 'No deriva temperatura ni variación térmica de la carga.' },
		condensador: { nivel: 'parcial', participacion: 'Carga genérica.', limitacion: 'Sin carga, descarga, reactancia ni transitorio.' },
		bornero: { nivel: 'parcial', participacion: 'Conectividad pasiva, puentes y continuidad de señales analógicas.', limitacion: 'Sin resistencia de contacto ni accesorios de desconexión o prueba.' },
		cable: { nivel: 'sin-comportamiento', participacion: 'El tipo de dispositivo no participa.', limitacion: 'Los conductores del proyecto son otra entidad y sí participan.' },
		otro: { nivel: 'parcial', participacion: 'Ejecuta cualquier perfil explícito válido; una acometida legacy puede actuar como fuente.', limitacion: 'Sin perfil explícito queda inerte salvo una acometida legacy reconocible.' },
	},
} as const satisfies { version: 5; tipos: Record<TipoDispositivo, FilaFidelidadSimulacion> };

export type NivelCapacidadFisicaV5 = 'completa-v5' | 'parcial' | 'no-modelado';

/** Segunda matriz: separa la capacidad cuantitativa V5 del comportamiento funcional por carcasa. */
export const MATRIZ_CAPACIDADES_FISICAS_V5 = {
	version: 1,
	capacidades: {
		conductor: { nivel: 'completa-v5', alcance: 'Cu/Al/personalizado, R20, R(T), X declarada, longitud y pérdidas I²R.', limite: 'Sin ampacidad ni modelo térmico del cable.' },
		fuente: { nivel: 'completa-v5', alcance: 'DC, AC monofásica y trifásica balanceada, frecuencia y Z interna.', limite: 'Paralelo complejo de fuentes incompatibles no modelado.' },
		transformador: { nivel: 'parcial', alcance: 'Secundario monofásico, relación y Z porcentual.', limite: 'No refleja carga al primario ni modela magnetización.' },
		cargaZ: { nivel: 'completa-v5', alcance: 'Impedancia compleja lineal.', limite: 'Sin dependencia térmica automática.' },
		cargaI: { nivel: 'completa-v5', alcance: 'Corriente constante con factor de potencia.', limite: 'Modelo fasorial estático.' },
		cargaPQ: { nivel: 'completa-v5', alcance: 'P/Q constante con iteración acotada y diagnóstico.', limite: 'No representa estabilidad dinámica de potencia.' },
		motor: { nivel: 'parcial', alcance: 'Puede declarar carga Z/I/PQ y coexistir con estados/RPM V2.', limite: 'No deriva aún toda la carga desde placa ni modela FEM/par.' },
		vfd: { nivel: 'parcial', alcance: 'Conserva V2/V3 y puede incorporar cargas físicas explícitas.', limite: 'Sin PWM, armónicos, DC link ni balance físico entrada/salida.' },
		proteccion: { nivel: 'completa-v5', alcance: 'Corriente, Icc, curvas, ventanas, thermal/I²t y selectividad de modelo.', limite: 'No certifica coordinación ni cascading de fabricante.' },
		diferencial: { nivel: 'parcial', alcance: 'Publica corriente residual vectorial cuando la topología la permite.', limite: 'La actuación calculada queda pendiente; fuga V2 sigue inyectada.' },
		lazo420: { nivel: 'completa-v5', alcance: 'Cable, burden, caída, tensión disponible y compliance.', limite: 'Sin HART ni electrónica interna del transmisor.' },
		senal010: { nivel: 'completa-v5', alcance: 'Resistencia de salida, cable y carga de entrada.', limite: 'Sin dinámica electrónica ni ruido.' },
	},
} as const satisfies { version: 1; capacidades: Record<string, { nivel: NivelCapacidadFisicaV5; alcance: string; limite: string }> };

const esObjeto = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;
const listaTextos = (v: unknown): string[] | undefined => {
	if (!Array.isArray(v)) return undefined;
	const r = v.map(texto);
	return r.every((x): x is string => x !== undefined) ? r : undefined;
};
const par = (v: unknown): ParBornesSimulacion | undefined => {
	if (!esObjeto(v)) return undefined;
	const entrada = texto(v.entrada);
	const salida = texto(v.salida);
	return entrada && salida ? { entrada, salida } : undefined;
};
const pares = (v: unknown): ParBornesSimulacion[] | undefined => {
	if (!Array.isArray(v)) return undefined;
	const r = v.map(par);
	return r.every((x): x is ParBornesSimulacion => x !== undefined) ? r : undefined;
};
const contacto = (v: unknown): ContactoSimulacion | undefined => {
	const p = par(v);
	if (!p || !esObjeto(v)) return undefined;
	const reposo = v.reposo === 'abierto' || v.reposo === 'cerrado' ? v.reposo : undefined;
	const funcion = v.funcion === 'potencia' || v.funcion === 'auxiliar' ? v.funcion : undefined;
	const cerradoEn = v.cerradoEn === undefined ? undefined
		: Array.isArray(v.cerradoEn) && v.cerradoEn.every((x) => Number.isInteger(x) && (x as number) >= 0)
			? [...new Set(v.cerradoEn as number[])] : null;
	return reposo && funcion && cerradoEn !== null
		? { ...p, reposo, funcion, ...(cerradoEn === undefined ? {} : { cerradoEn }) } : undefined;
};
const contactos = (v: unknown): ContactoSimulacion[] | undefined => {
	if (!Array.isArray(v)) return undefined;
	const r = v.map(contacto);
	return r.every((x): x is ContactoSimulacion => x !== undefined) ? r : undefined;
};
const alimentacion = (v: unknown): { entradas: string[]; retornos: string[] } | undefined => {
	if (!esObjeto(v)) return undefined;
	const entradas = listaTextos(v.entradas);
	const retornos = listaTextos(v.retornos);
	return entradas && retornos ? { entradas, retornos } : undefined;
};
const rango = (v: unknown): [number, number] | undefined =>
	Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && Number.isFinite(v[0])
		&& typeof v[1] === 'number' && Number.isFinite(v[1]) && v[0] <= v[1]
		? [v[0], v[1]] : undefined;

const referenciaAnalogica = (v: unknown): ReferenciaAnalogicaSimulacion | undefined => {
	if (!esObjeto(v)) return undefined;
	const borne = texto(v.borne); const comun = texto(v.comun); const r = rango(v.rango);
	const unidad = v.unidad === 'V' || v.unidad === 'mA' || v.unidad === 'porcentaje' ? v.unidad : undefined;
	const perdidaSenal = v.perdidaSenal === undefined ? undefined
		: v.perdidaSenal === 'detener' || v.perdidaSenal === 'mantener' || v.perdidaSenal === 'fallo'
			? v.perdidaSenal : null;
	return borne && comun && r && unidad && perdidaSenal !== null
		? { borne, comun, rango: r, unidad, ...(perdidaSenal ? { perdidaSenal } : {}) } : undefined;
};

const variableFisica = (v: unknown): VariableFisicaAnalogica | undefined => {
	if (!esObjeto(v)) return undefined;
	const magnitud = texto(v.magnitud); const unidad = texto(v.unidad);
	const minimo = typeof v.minimo === 'number' && Number.isFinite(v.minimo) ? v.minimo : undefined;
	const maximo = typeof v.maximo === 'number' && Number.isFinite(v.maximo) ? v.maximo : undefined;
	return magnitud && unidad && minimo !== undefined && maximo !== undefined && minimo !== maximo
		? { magnitud, unidad, minimo, maximo } : undefined;
};

/** Reconstruye un perfil externo desde una lista blanca. Nunca devuelve referencias al JSON bruto. */
export function leerComportamientoSimulacion(bruto: unknown): ComportamientoSimulacion | undefined {
	if (!esObjeto(bruto) || bruto.version !== 1 || typeof bruto.clase !== 'string') return undefined;
	switch (bruto.clase) {
		case 'contactos-electromagneticos': {
			if (!esObjeto(bruto.bobina)) return undefined;
			const entrada = texto(bruto.bobina.entrada);
			const retorno = texto(bruto.bobina.retorno);
			const ps = pares(bruto.polos);
			const cs = contactos(bruto.contactos);
			return entrada && retorno && ps && cs
				? { version: 1, clase: bruto.clase, bobina: { entrada, retorno }, polos: ps, contactos: cs }
				: undefined;
		}
		case 'controlador': {
			const alim = alimentacion(bruto.alimentacion);
			if (!alim || !Array.isArray(bruto.salidasDigitales) || !Array.isArray(bruto.salidasAnalogicas)) return undefined;
			const digitales = bruto.salidasDigitales.map((x) => esObjeto(x) && texto(x.borne) && texto(x.comun)
				? { borne: texto(x.borne)!, comun: texto(x.comun)! } : undefined);
			const analogas = bruto.salidasAnalogicas.map((x) => {
				if (!esObjeto(x)) return undefined;
				const borne = texto(x.borne); const referencia = texto(x.referencia); const r = rango(x.rango);
				const unidad = x.unidad === 'V' || x.unidad === 'mA' ? x.unidad : undefined;
				return borne && referencia && r && unidad
					? { borne, referencia, rango: r, unidad } : undefined;
			});
			const entradas = bruto.entradasAnalogicas === undefined ? []
				: Array.isArray(bruto.entradasAnalogicas) ? bruto.entradasAnalogicas.map((x) => {
					const referencia = referenciaAnalogica(x);
					const variable = esObjeto(x) ? variableFisica(x.variable) : undefined;
					const modoEntrada = esObjeto(x) && (x.modoEntrada === 'pasiva' || x.modoEntrada === 'activa')
						? x.modoEntrada : undefined;
					return referencia && referencia.unidad !== 'porcentaje' && variable && modoEntrada
						? { ...referencia, unidad: referencia.unidad, variable, modoEntrada } as EntradaAnalogicaSimulacion
						: undefined;
				}) : [undefined];
			return digitales.every((x): x is { borne: string; comun: string } => !!x)
				&& analogas.every((x): x is { borne: string; referencia: string; rango: [number, number]; unidad: 'V' | 'mA' } => !!x)
				&& entradas.every((x): x is EntradaAnalogicaSimulacion => !!x)
				? { version: 1, clase: bruto.clase, alimentacion: alim, salidasDigitales: digitales,
					salidasAnalogicas: analogas,
					...(bruto.entradasAnalogicas === undefined ? {} : { entradasAnalogicas: entradas }) }
				: undefined;
		}
		case 'fuente': {
			const primario = bruto.primario === undefined ? undefined : alimentacion(bruto.primario);
			if (bruto.primario !== undefined && !primario || !Array.isArray(bruto.salidas)) return undefined;
			const salidas = bruto.salidas.map((x) => {
				if (!esObjeto(x)) return undefined;
				const borne = texto(x.borne);
				return borne && (x.papel === 'fase' || x.papel === 'retorno')
					&& typeof x.tensionV === 'number' && Number.isFinite(x.tensionV) && x.tensionV >= 0
					? { borne, papel: x.papel, tensionV: x.tensionV } : undefined;
			});
			return salidas.every((x): x is { borne: string; papel: 'fase' | 'retorno'; tensionV: number } => !!x)
				? { version: 1, clase: bruto.clase, primario, salidas } : undefined;
		}
		case 'proteccion': {
			const ps = pares(bruto.polos); const cs = contactos(bruto.contactos);
			const funciones = ['termico', 'termomagnetico', 'fusible', 'diferencial', 'seccionamiento'];
			const funcion = bruto.funcion === undefined ? undefined
				: typeof bruto.funcion === 'string' && funciones.includes(bruto.funcion)
					? bruto.funcion as Extract<ComportamientoSimulacion, { clase: 'proteccion' }>['funcion'] : null;
			return ps && cs && typeof bruto.rearmable === 'boolean'
				&& funcion !== null
				? { version: 1, clase: bruto.clase, polos: ps, contactos: cs, rearmable: bruto.rearmable,
					...(funcion === undefined ? {} : { funcion }) }
				: undefined;
		}
		case 'mando': {
			const cs = contactos(bruto.contactos);
			const modo = bruto.modo === 'momentaneo' || bruto.modo === 'mantenido' ? bruto.modo : 'momentaneo';
			const posiciones = bruto.posiciones === 3 ? 3 : 2;
			const reposo = typeof bruto.reposo === 'number' && Number.isInteger(bruto.reposo) ? bruto.reposo : 0;
			return cs && reposo >= 0 && reposo < posiciones
				? { version: 1, clase: bruto.clase, modo, posiciones, reposo, contactos: cs } : undefined;
		}
		case 'sensor': {
			const cs = contactos(bruto.contactos);
			if (!cs) return undefined;
			let alim: { entrada: string; retorno: string } | undefined;
			if (bruto.alimentacion !== undefined) {
				if (!esObjeto(bruto.alimentacion)) return undefined;
				const entrada = texto(bruto.alimentacion.entrada); const retorno = texto(bruto.alimentacion.retorno);
				if (!entrada || !retorno) return undefined;
				alim = { entrada, retorno };
			}
			let salidaDigital: { borne: string; tomaDe: string } | undefined;
			if (bruto.salidaDigital !== undefined) {
				if (!esObjeto(bruto.salidaDigital)) return undefined;
				const borne = texto(bruto.salidaDigital.borne); const tomaDe = texto(bruto.salidaDigital.tomaDe);
				if (!borne || !tomaDe) return undefined;
				salidaDigital = { borne, tomaDe };
			}
			let transmisor: TransmisorAnalogicoSimulacion | undefined;
			if (bruto.transmisor !== undefined) {
				if (!esObjeto(bruto.transmisor)) return undefined;
				const salida = referenciaAnalogica(bruto.transmisor.salida);
				const variable = variableFisica(bruto.transmisor.variable);
				const modoConexion = bruto.transmisor.modoConexion === '2-hilos' || bruto.transmisor.modoConexion === '3-hilos'
					? bruto.transmisor.modoConexion : undefined;
				const modoSalida = bruto.transmisor.modoSalida === 'activa' || bruto.transmisor.modoSalida === 'pasiva'
					? bruto.transmisor.modoSalida : undefined;
				if (!salida || salida.unidad === 'porcentaje' || !variable || !modoConexion || !modoSalida) return undefined;
				transmisor = { modoConexion, salida: { ...salida, unidad: salida.unidad }, variable, modoSalida };
			}
			return { version: 1, clase: bruto.clase, contactos: cs, alimentacion: alim, salidaDigital,
				...(transmisor ? { transmisor } : {}) };
		}
		case 'variador': {
			if (!esObjeto(bruto.alimentacion) || !esObjeto(bruto.mando) || !esObjeto(bruto.salida)
				|| !esObjeto(bruto.frecuencia)) return undefined;
			const fases = listaTextos(bruto.alimentacion.fases);
			const retornos = listaTextos(bruto.alimentacion.retornos);
			const fasesMinimas = bruto.alimentacion.fasesMinimas === 1 || bruto.alimentacion.fasesMinimas === 3
				? bruto.alimentacion.fasesMinimas : undefined;
			const run = texto(bruto.mando.run);
			const habilitacion = bruto.mando.habilitacion === undefined ? undefined : texto(bruto.mando.habilitacion);
			if (bruto.mando.habilitacion !== undefined && !habilitacion) return undefined;
			const referencia = referenciaAnalogica(bruto.referencia);
			const u = texto(bruto.salida.u); const v = texto(bruto.salida.v); const w = texto(bruto.salida.w);
			const tensionV = typeof bruto.salida.tensionV === 'number' && Number.isFinite(bruto.salida.tensionV)
				&& bruto.salida.tensionV > 0 ? bruto.salida.tensionV : undefined;
			const minimaHz = typeof bruto.frecuencia.minimaHz === 'number' && Number.isFinite(bruto.frecuencia.minimaHz)
				&& bruto.frecuencia.minimaHz >= 0 ? bruto.frecuencia.minimaHz : undefined;
			const maximaHz = typeof bruto.frecuencia.maximaHz === 'number' && Number.isFinite(bruto.frecuencia.maximaHz)
				&& bruto.frecuencia.maximaHz > 0 ? bruto.frecuencia.maximaHz : undefined;
			const rampaHzS = typeof bruto.frecuencia.rampaHzS === 'number' && Number.isFinite(bruto.frecuencia.rampaHzS)
				&& bruto.frecuencia.rampaHzS > 0 ? bruto.frecuencia.rampaHzS : undefined;
			const contactoFallo = bruto.contactoFallo === undefined ? undefined : contacto(bruto.contactoFallo);
			if (bruto.contactoFallo !== undefined && !contactoFallo) return undefined;
			return fases && retornos && fasesMinimas && run && referencia && u && v && w && tensionV
				&& minimaHz !== undefined && maximaHz !== undefined && maximaHz >= minimaHz && rampaHzS
				? { version: 1, clase: bruto.clase, alimentacion: { fases, retornos, fasesMinimas },
					mando: { run, habilitacion }, referencia, salida: { u, v, w, tensionV },
					frecuencia: { minimaHz, maximaHz, rampaHzS },
					...(contactoFallo === undefined ? {} : { contactoFallo }) }
				: undefined;
		}
		case 'carga': {
			if (!esObjeto(bruto.alimentacion)) return undefined;
			const fases = listaTextos(bruto.alimentacion.fases);
			const retornos = listaTextos(bruto.alimentacion.retornos);
			const fasesMinimas = bruto.alimentacion.fasesMinimas === 1 || bruto.alimentacion.fasesMinimas === 3
				? bruto.alimentacion.fasesMinimas : undefined;
			const efectos = ['giro', 'luz', 'movimiento', 'calor', 'reactivo', 'generico'];
			const mando = bruto.mandoAnalogico === undefined ? undefined : referenciaAnalogica(bruto.mandoAnalogico);
			if (bruto.mandoAnalogico !== undefined && !mando) return undefined;
			const invertidoBruto = esObjeto(bruto.mandoAnalogico) ? bruto.mandoAnalogico.invertido : undefined;
			if (invertidoBruto !== undefined && typeof invertidoBruto !== 'boolean') return undefined;
			const invertido = typeof invertidoBruto === 'boolean' ? invertidoBruto : undefined;
			let dinamicaMotor: Extract<ComportamientoSimulacion, { clase: 'carga' }>['dinamicaMotor'];
			if (bruto.dinamicaMotor !== undefined) {
				if (!esObjeto(bruto.dinamicaMotor)) return undefined;
				const dm = bruto.dinamicaMotor;
				const opcionalPositivo = (v: unknown, entero = false): number | undefined | null =>
					v === undefined ? undefined : typeof v === 'number' && Number.isFinite(v) && v > 0
						&& (!entero || Number.isInteger(v)) ? v : null;
				const polos = opcionalPositivo(dm.polos, true);
				const tiempoArranqueS = opcionalPositivo(dm.tiempoArranqueS);
				const tiempoParadaS = opcionalPositivo(dm.tiempoParadaS);
				const deslizamiento = dm.deslizamiento === undefined ? undefined
					: typeof dm.deslizamiento === 'number' && Number.isFinite(dm.deslizamiento)
						&& dm.deslizamiento >= 0 && dm.deslizamiento < 0.2 ? dm.deslizamiento : null;
				if ([polos, tiempoArranqueS, tiempoParadaS, deslizamiento].includes(null)) return undefined;
				dinamicaMotor = {};
				if (typeof polos === 'number') dinamicaMotor.polos = polos;
				if (typeof tiempoArranqueS === 'number') dinamicaMotor.tiempoArranqueS = tiempoArranqueS;
				if (typeof tiempoParadaS === 'number') dinamicaMotor.tiempoParadaS = tiempoParadaS;
				if (typeof deslizamiento === 'number') dinamicaMotor.deslizamiento = deslizamiento;
			}
			let dinamicaActuador: Extract<ComportamientoSimulacion, { clase: 'carga' }>['dinamicaActuador'];
			if (bruto.dinamicaActuador !== undefined) {
				if (!esObjeto(bruto.dinamicaActuador)) return undefined;
				const da = bruto.dinamicaActuador;
				const tipo = da.tipo === 'on-off' || da.tipo === 'modulante' ? da.tipo : undefined;
				const tiempoAperturaS = typeof da.tiempoAperturaS === 'number' && Number.isFinite(da.tiempoAperturaS)
					&& da.tiempoAperturaS >= 0 ? da.tiempoAperturaS : undefined;
				const tiempoCierreS = typeof da.tiempoCierreS === 'number' && Number.isFinite(da.tiempoCierreS)
					&& da.tiempoCierreS >= 0 ? da.tiempoCierreS : undefined;
				const failSafe = da.failSafe === 'mantener' || da.failSafe === 'cerrar' || da.failSafe === 'abrir'
					|| da.failSafe === 'posicion-segura' ? da.failSafe : undefined;
				const posicionSegura = da.posicionSegura === undefined ? undefined
					: typeof da.posicionSegura === 'number' && Number.isFinite(da.posicionSegura)
						&& da.posicionSegura >= 0 && da.posicionSegura <= 100 ? da.posicionSegura : null;
				const feedback = da.feedback === undefined ? undefined : referenciaAnalogica(da.feedback);
				if (!tipo || tiempoAperturaS === undefined || tiempoCierreS === undefined || !failSafe
					|| posicionSegura === null || da.feedback !== undefined && (!feedback || feedback.unidad === 'porcentaje')
					|| failSafe === 'posicion-segura' && posicionSegura === undefined) return undefined;
				dinamicaActuador = { tipo, tiempoAperturaS, tiempoCierreS, failSafe,
					...(posicionSegura === undefined ? {} : { posicionSegura }),
					...(feedback && feedback.unidad !== 'porcentaje'
						? { feedback: { ...feedback, unidad: feedback.unidad } } : {}) };
			}
			return fases && retornos && fasesMinimas && typeof bruto.efecto === 'string' && efectos.includes(bruto.efecto)
				? { version: 1, clase: bruto.clase, alimentacion: { fases, retornos, fasesMinimas },
					efecto: bruto.efecto as Extract<ComportamientoSimulacion, { clase: 'carga' }>['efecto'],
					mandoAnalogico: mando ? { ...mando, invertido } : undefined,
					...(dinamicaMotor === undefined ? {} : { dinamicaMotor }),
					...(dinamicaActuador === undefined ? {} : { dinamicaActuador }) }
				: undefined;
		}
		case 'pasivo': {
			const conexiones = pares(bruto.conexiones);
			return conexiones ? { version: 1, clase: bruto.clase, conexiones } : undefined;
		}
		case 'sin-comportamiento': {
			const motivo = texto(bruto.motivo);
			return motivo ? { version: 1, clase: bruto.clase, motivo } : undefined;
		}
		default: return undefined;
	}
}

const contactosIEC = (d: Pick<Dispositivo, 'bornes'>): ContactoSimulacion[] => {
	const ids = new Set(d.bornes.map((b) => b.id));
	const salida: ContactoSimulacion[] = [];
	for (let g = 1; g <= 9; g++) {
		const comun = `${g}1`; const nc = `${g}2`; const comunNA = `${g}3`; const na = `${g}4`;
		if (ids.has(comun) && ids.has(nc)) salida.push({ entrada: comun, salida: nc, reposo: 'cerrado', funcion: 'auxiliar' });
		if (ids.has(comunNA) && ids.has(na)) salida.push({ entrada: comunNA, salida: na, reposo: 'abierto', funcion: 'auxiliar' });
		else if (ids.has(comun) && ids.has(na)) salida.push({ entrada: comun, salida: na, reposo: 'abierto', funcion: 'auxiliar' });
	}
	// Contactos de señalización normalizados de relés térmicos/protecciones. No siguen el patrón
	// x1-x2 / x3-x4 de los auxiliares ordinarios, pero sí tienen semántica explícita IEC.
	if (ids.has('95') && ids.has('96')) {
		salida.push({ entrada: '95', salida: '96', reposo: 'cerrado', funcion: 'auxiliar' });
	}
	if (ids.has('97') && ids.has('98')) {
		salida.push({ entrada: '97', salida: '98', reposo: 'abierto', funcion: 'auxiliar' });
	}
	return salida;
};

const polosIEC = (d: Pick<Dispositivo, 'bornes' | 'puentesInternos'>): ParBornesSimulacion[] => {
	if (d.puentesInternos?.length) return d.puentesInternos.map(([entrada, salida]) => ({ entrada, salida }));
	const ids = new Set(d.bornes.map((b) => b.id));
	const aux = new Set(contactosIEC(d).flatMap((c) => [c.entrada, c.salida]));
	const salida: ParBornesSimulacion[] = [];
	for (let i = 1; i <= 7; i += 2) {
		const entrada = String(i); const fin = String(i + 1);
		if (ids.has(entrada) && ids.has(fin) && !aux.has(entrada) && !aux.has(fin)) salida.push({ entrada, salida: fin });
	}
	for (let i = 1; i <= 3; i++) {
		const entrada = `${i * 2 - 1}/L${i}`; const fin = `${i * 2}/T${i}`;
		if (ids.has(entrada) && ids.has(fin)) salida.push({ entrada, salida: fin });
	}
	if (ids.has('N1') && ids.has('N2')) salida.push({ entrada: 'N1', salida: 'N2' });
	return salida;
};

const primerBorne = (bornes: readonly Borne[], ids: readonly string[]): string | undefined =>
	ids.find((id) => bornes.some((b) => b.id === id));

const comunLegacy = (d: Pick<Dispositivo, 'bornes'>, salida: string): string | undefined => {
	const ids = new Set(d.bornes.map((b) => b.id));
	const familia = `${salida.replace(/\d+$/, '')}C`;
	if (familia !== salida && ids.has(familia)) return familia;
	return primerBorne(d.bornes, ['+24', '+V']);
};

function funcionProteccionLegacy(
	tipo: TipoDispositivo,
	ids: ReadonlySet<string>,
): Extract<ComportamientoSimulacion, { clase: 'proteccion' }>['funcion'] | undefined {
	if (tipo === 'fusible') return 'fusible';
	if (tipo === 'diferencial') return 'diferencial';
	if (tipo === 'seccionador') return 'seccionamiento';
	if (tipo === 'rele' && ids.has('95') && !ids.has('A1')) return 'termico';
	if (tipo === 'disyuntor' || tipo === 'guardamotor') return 'termomagnetico';
	return undefined;
}

/**
 * Valida referencias y coherencia interna. Una lista vacía significa perfil apto para ejecutar.
 * Un perfil explícito inválido nunca cae silenciosamente al comportamiento legacy.
 */
export function validarComportamiento(
	d: Pick<Dispositivo, 'bornes' | 'comportamiento'>,
): string[] {
	const c = d.comportamiento;
	if (!c) return [];
	const errores: string[] = [];
	const ids = new Set(d.bornes.map((b) => b.id));
	const borne = (id: string, ruta: string) => {
		if (!ids.has(id)) errores.push(`${ruta} refiere al borne inexistente «${id}»`);
	};
	const revisarPar = (p: ParBornesSimulacion, ruta: string) => {
		borne(p.entrada, `${ruta}.entrada`); borne(p.salida, `${ruta}.salida`);
		if (p.entrada === p.salida) errores.push(`${ruta} une un borne consigo mismo`);
	};
	const revisarReferencia = (r: ReferenciaAnalogicaSimulacion, ruta: string) => {
		borne(r.borne, `${ruta}.borne`); borne(r.comun, `${ruta}.comun`);
		if (r.borne === r.comun) errores.push(`${ruta} usa el mismo borne como señal y común`);
		if (!Number.isFinite(r.rango[0]) || !Number.isFinite(r.rango[1]) || r.rango[1] <= r.rango[0]) {
			errores.push(`${ruta}.rango debe crecer de mínimo a máximo`);
		}
	};
	if (c.version !== 1) errores.push(`versión de comportamiento no soportada: ${String((c as { version: unknown }).version)}`);
	switch (c.clase) {
		case 'contactos-electromagneticos':
			borne(c.bobina.entrada, 'bobina.entrada'); borne(c.bobina.retorno, 'bobina.retorno');
			if (c.bobina.entrada === c.bobina.retorno) errores.push('la bobina usa el mismo borne en ambos extremos');
			c.polos.forEach((p, i) => revisarPar(p, `polos[${i}]`));
			c.contactos.forEach((p, i) => revisarPar(p, `contactos[${i}]`));
			break;
		case 'controlador':
			c.alimentacion.entradas.forEach((x, i) => borne(x, `alimentacion.entradas[${i}]`));
			c.alimentacion.retornos.forEach((x, i) => borne(x, `alimentacion.retornos[${i}]`));
			c.salidasDigitales.forEach((x, i) => { borne(x.borne, `salidasDigitales[${i}].borne`); borne(x.comun, `salidasDigitales[${i}].comun`); });
			c.salidasAnalogicas.forEach((x, i) => { borne(x.borne, `salidasAnalogicas[${i}].borne`); borne(x.referencia, `salidasAnalogicas[${i}].referencia`); });
			c.entradasAnalogicas?.forEach((x, i) => revisarReferencia(x, `entradasAnalogicas[${i}]`));
			if (!c.alimentacion.entradas.length || !c.alimentacion.retornos.length) errores.push('el controlador no declara un par de alimentación');
			break;
		case 'fuente':
			c.primario?.entradas.forEach((x, i) => borne(x, `primario.entradas[${i}]`));
			c.primario?.retornos.forEach((x, i) => borne(x, `primario.retornos[${i}]`));
			c.salidas.forEach((x, i) => borne(x.borne, `salidas[${i}].borne`));
			break;
		case 'proteccion':
			c.polos.forEach((p, i) => revisarPar(p, `polos[${i}]`));
			c.contactos.forEach((p, i) => revisarPar(p, `contactos[${i}]`));
			break;
		case 'mando':
			if (c.reposo < 0 || c.reposo >= c.posiciones) errores.push('la posición de reposo está fuera del mando');
			c.contactos.forEach((p, i) => {
				revisarPar(p, `contactos[${i}]`);
				for (const posicion of p.cerradoEn ?? []) {
					if (posicion < 0 || posicion >= c.posiciones) errores.push(`contactos[${i}].cerradoEn contiene la posición inexistente ${posicion}`);
				}
			});
			break;
		case 'sensor':
			c.contactos.forEach((p, i) => revisarPar(p, `contactos[${i}]`));
			if (c.alimentacion) { borne(c.alimentacion.entrada, 'alimentacion.entrada'); borne(c.alimentacion.retorno, 'alimentacion.retorno'); }
			if (c.salidaDigital) { borne(c.salidaDigital.borne, 'salidaDigital.borne'); borne(c.salidaDigital.tomaDe, 'salidaDigital.tomaDe'); }
			if (c.transmisor) {
				revisarReferencia(c.transmisor.salida, 'transmisor.salida');
				if (c.transmisor.modoConexion === '3-hilos' && !c.alimentacion) {
					errores.push('un transmisor de 3 hilos necesita alimentación explícita');
				}
				if (c.transmisor.salida.unidad === 'V' && c.transmisor.modoSalida === 'pasiva') {
					errores.push('una salida de tensión pasiva no tiene una fuente declarada');
				}
			}
			break;
		case 'variador':
			c.alimentacion.fases.forEach((x, i) => borne(x, `alimentacion.fases[${i}]`));
			c.alimentacion.retornos.forEach((x, i) => borne(x, `alimentacion.retornos[${i}]`));
			if (c.alimentacion.fases.length < c.alimentacion.fasesMinimas) errores.push('faltan entradas de fase para alimentar el variador');
			if (c.alimentacion.fasesMinimas === 1 && !c.alimentacion.retornos.length) errores.push('la alimentación monofásica no declara retorno');
			borne(c.mando.run, 'mando.run');
			if (c.mando.habilitacion) borne(c.mando.habilitacion, 'mando.habilitacion');
			revisarReferencia(c.referencia, 'referencia');
			borne(c.salida.u, 'salida.u'); borne(c.salida.v, 'salida.v'); borne(c.salida.w, 'salida.w');
			if (c.contactoFallo) revisarPar(c.contactoFallo, 'contactoFallo');
			if (new Set([c.salida.u, c.salida.v, c.salida.w]).size !== 3) errores.push('U, V y W deben ser tres bornes distintos');
			if (c.frecuencia.maximaHz < c.frecuencia.minimaHz || c.frecuencia.rampaHzS <= 0) errores.push('la frecuencia o su rampa no son válidas');
			break;
		case 'carga':
			c.alimentacion.fases.forEach((x, i) => borne(x, `alimentacion.fases[${i}]`));
			c.alimentacion.retornos.forEach((x, i) => borne(x, `alimentacion.retornos[${i}]`));
			if (new Set(c.alimentacion.fases).size < c.alimentacion.fasesMinimas) {
				errores.push('faltan entradas de fase distintas para alimentar la carga');
			}
			if (c.alimentacion.fasesMinimas === 1 && !c.alimentacion.retornos.length) {
				errores.push('la alimentación monofásica no declara retorno');
			}
			if (c.mandoAnalogico) revisarReferencia(c.mandoAnalogico, 'mandoAnalogico');
			if (c.dinamicaMotor?.polos !== undefined && (!Number.isInteger(c.dinamicaMotor.polos)
				|| c.dinamicaMotor.polos < 2)) errores.push('dinamicaMotor.polos debe ser un entero de al menos 2');
			if (c.dinamicaActuador) {
				if (c.efecto !== 'movimiento') errores.push('dinamicaActuador solo es válida para una carga de movimiento');
				if (c.dinamicaActuador.tiempoAperturaS < 0 || c.dinamicaActuador.tiempoCierreS < 0) {
					errores.push('los tiempos del actuador no pueden ser negativos');
				}
				if (c.dinamicaActuador.feedback) revisarReferencia(c.dinamicaActuador.feedback, 'dinamicaActuador.feedback');
			}
			break;
		case 'pasivo': c.conexiones.forEach((p, i) => revisarPar(p, `conexiones[${i}]`)); break;
		case 'sin-comportamiento': break;
	}
	return errores;
}

/**
 * Resuelve el contrato ejecutable. El perfil persistente manda; sin él se conserva el adaptador
 * IEC actual. Una referencia con imagen y sin perfil queda inerte: la imagen no prueba función.
 */
export function resolverComportamiento(d: Dispositivo): ComportamientoSimulacion | undefined {
	if (d.comportamiento) {
		if (validarComportamiento(d).length) return undefined;
		if (d.comportamiento.clase === 'proteccion' && !d.comportamiento.funcion) {
			const funcion = funcionProteccionLegacy(d.tipo, new Set(d.bornes.map((b) => b.id)));
			return funcion ? { ...d.comportamiento, funcion } : d.comportamiento;
		}
		return d.comportamiento;
	}
	if (d.imagen) return undefined;
	const bornes = d.bornes;
	const ids = new Set(bornes.map((b) => b.id));
	if ((d.tipo === 'contactor' || d.tipo === 'rele') && ids.has('A1') && ids.has('A2')) {
		return {
			version: 1, clase: 'contactos-electromagneticos', bobina: { entrada: 'A1', retorno: 'A2' },
			polos: polosIEC(d), contactos: contactosIEC(d),
		};
	}
	if ((d.tipo === 'contactor' || d.tipo === 'rele') && d.rol?.tipo === 'esclavo') {
		return { version: 1, clase: 'mando', modo: 'mantenido', posiciones: 2, reposo: 0, contactos: contactosIEC(d) };
	}
	if (['disyuntor', 'guardamotor', 'diferencial', 'fusible', 'seccionador'].includes(d.tipo)
		|| d.tipo === 'rele' && ids.has('95')) {
		return {
			version: 1, clase: 'proteccion', polos: polosIEC(d), contactos: contactosIEC(d),
			rearmable: d.tipo !== 'fusible', funcion: funcionProteccionLegacy(d.tipo, ids),
		};
	}
	if (d.tipo === 'pulsador' || d.tipo === 'selector') {
		return {
			version: 1, clase: 'mando', modo: d.tipo === 'pulsador' ? 'momentaneo' : 'mantenido',
			posiciones: 2, reposo: 0, contactos: contactosIEC(d),
		};
	}
	if (d.tipo === 'sensor') {
		const entrada = primerBorne(bornes, ['+24', '+']);
		const retorno = primerBorne(bornes, ['0V', '-']);
		const senal = bornes.find((b) => b.tipo === 'senal')?.id;
		const salidaDigital = entrada && senal ? { borne: senal, tomaDe: entrada } : undefined;
		let contactos = contactosIEC(d);
		// Compatibilidad para contactos de campo legacy rotulados simplemente 1/2. Antes el motor
		// los tomaba como NA por `tipo === sensor`; el adaptador preserva esa regla dentro del perfil.
		if (!contactos.length && !salidaDigital) {
			contactos = polosIEC(d).map((p) => ({
				entrada: p.entrada, salida: p.salida, reposo: 'abierto' as const, funcion: 'auxiliar' as const,
			}));
		}
		return {
			version: 1, clase: 'sensor', contactos,
			alimentacion: entrada && retorno ? { entrada, retorno } : undefined,
			salidaDigital,
		};
	}
	if (d.tipo === 'plc') {
		const entradas = bornes.filter((b) => ['+24', '+V', '+', '24V', '24V~', 'L'].includes(b.id)).map((b) => b.id);
		const retornos = bornes.filter((b) => ['0V', '-V', '-', 'GND', 'N', '24V COM'].includes(b.id)).map((b) => b.id);
		const salidasDigitales = bornes.filter((b) => /^(DO|Q|BO|CO)\d+$/.test(b.id))
			.map((b) => ({ borne: b.id, comun: comunLegacy(d, b.id) })).filter((x): x is { borne: string; comun: string } => !!x.comun);
		const rangoAO = d.rangoSalidaAnalogica ?? [0, 10] as [number, number];
		const salidasAnalogicas = bornes.filter((b) => /^(AO|Y)\d+$/.test(b.id))
			.map((b) => ({ borne: b.id, referencia: comunLegacy(d, b.id), rango: rangoAO, unidad: 'V' as const }))
			.filter((x): x is { borne: string; referencia: string; rango: [number, number]; unidad: 'V' } => !!x.referencia);
		return { version: 1, clase: 'controlador', alimentacion: { entradas, retornos }, salidasDigitales, salidasAnalogicas };
	}
	if (d.tipo === 'fuente' || d.tipo === 'transformador') {
		const tensionV = d.tensionSecundariaV ?? 24;
		const salidas = bornes.filter((b) => b.lado === 'secundario+' || b.lado === 'secundario-')
			.map((b) => ({ borne: b.id, papel: b.lado === 'secundario+' ? 'fase' as const : 'retorno' as const, tensionV }));
		const entradas = bornes.filter((b) => b.tipo === 'L' || b.id === 'P1' || b.id === 'L').map((b) => b.id);
		const retornos = bornes.filter((b) => b.tipo === 'N' || b.id === 'P2').map((b) => b.id);
		return { version: 1, clase: 'fuente', primario: { entradas, retornos }, salidas };
	}
	if (d.tipo === 'variador') {
		// Adaptador legacy por designaciones eléctricas habituales; un perfil explícito puede usar
		// cualquier rótulo y siempre tiene prioridad sobre estas convenciones.
		const salidaU = primerBorne(bornes, ['U']); const salidaV = primerBorne(bornes, ['V']);
		const salidaW = primerBorne(bornes, ['W']);
		const run = primerBorne(bornes, ['RUN', 'DI1']);
		const habilitacion = primerBorne(bornes, ['ENABLE', 'ENA', 'EN']);
		const referencia = primerBorne(bornes, ['AI1', 'REF']);
		const comun = primerBorne(bornes, ['0V', 'COM', 'GND']);
		const fases = bornes.filter((b) => b.tipo === 'L' && !['U', 'V', 'W'].includes(b.id)).map((b) => b.id);
		const retornos = bornes.filter((b) => b.tipo === 'N').map((b) => b.id);
		if (salidaU && salidaV && salidaW && run && referencia && comun && fases.length) {
			return {
				version: 1, clase: 'variador', alimentacion: { fases, retornos, fasesMinimas: fases.length >= 3 ? 3 : 1 },
				mando: { run, habilitacion }, referencia: { borne: referencia, comun, unidad: 'V', rango: [0, 10] },
				salida: { u: salidaU, v: salidaV, w: salidaW, tensionV: d.tensionNominal ?? 220 },
				frecuencia: { minimaHz: 0, maximaHz: 50, rampaHzS: 10 },
			};
		}
		return { version: 1, clase: 'sin-comportamiento', motivo: 'variador legacy sin terminales funcionales suficientes' };
	}
	if (['motor', 'valvula', 'resistencia', 'piloto', 'condensador'].includes(d.tipo)) {
		const fases = bornes.filter((b) => b.tipo !== 'PE' && b.tipo !== 'N').map((b) => b.id);
		const retornos = bornes.filter((b) => b.tipo === 'N' || /^(N|0V|X2|A2)$/.test(b.id)).map((b) => b.id);
		const efecto = d.tipo === 'motor' ? 'giro' : d.tipo === 'piloto' ? 'luz' : d.tipo === 'valvula'
			? 'movimiento' : d.tipo === 'resistencia' ? 'calor' : 'reactivo';
		// Los motores legacy de tres hilos no siempre guardaban `polos: 3`. Tres entradas de fase y
		// ningún retorno son evidencia estructural suficiente; exigir un neutro los dejaba parados y
		// hacía que el mismo motor cambiara de lógica al importarlo con un perfil explícito.
		const fasesMinimas = d.tipo === 'motor'
			&& ((d.polos ?? 0) >= 3 || retornos.length === 0 && new Set(fases).size >= 3) ? 3 : 1;
		return { version: 1, clase: 'carga', alimentacion: { fases, retornos, fasesMinimas }, efecto };
	}
	if (d.tipo === 'bornero') {
		// La numeración 1, 2, 3... no implica continuidad eléctrica. Los puentes
		// de proyecto se procesan desde `puentes`; el adaptador solo conserva las
		// conexiones internas que el dispositivo declara de forma persistente.
		return {
			version: 1,
			clase: 'pasivo',
			conexiones: (d.puentesInternos ?? []).map(([entrada, salida]) => ({ entrada, salida })),
		};
	}
	const esAcometida = d.campo && bornes.some((b) => b.tipo === 'L')
		&& (d.clase === 'W' || /acometida|red|alimentaci/i.test(d.descripcion ?? ''));
	if (esAcometida) {
		const tensionV = d.tensionNominal ?? 220;
		return { version: 1, clase: 'fuente', salidas: bornes.filter((b) => b.tipo === 'L' || b.tipo === 'N')
			.map((b) => ({ borne: b.id, papel: b.tipo === 'L' ? 'fase' as const : 'retorno' as const, tensionV })) };
	}
	return { version: 1, clase: 'sin-comportamiento', motivo: `sin adaptador legacy para ${d.tipo}` };
}
