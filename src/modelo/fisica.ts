/**
 * Configuracion persistente de la capa fisica V5.
 *
 * Los resultados (V, I, potencia, fallas e integradores) nunca viven aqui: pertenecen al runtime.
 * Los campos opcionales permiten abrir proyectos V4 sin inventar una precision que no tienen.
 */
export type OrigenDatoFisico = 'CALCULADO' | 'CONFIGURADO' | 'ESTIMADO' | 'INYECTADO' | 'NO_MODELADO';

export type MaterialConductor = 'COBRE' | 'ALUMINIO' | 'PERSONALIZADO';

export interface ConfiguracionFisicaConductor {
	material?: MaterialConductor;
	/** Longitud electrica decidida por el usuario. Tiene prioridad sobre una ruta estimada. */
	longitudManualM?: number;
	/** Temperatura a la que se calcula la resistencia. */
	temperaturaC?: number;
	/** Reactancia serie declarada, en ohm/km. Si falta no se inventa. */
	xOhmPorKm?: number;
	/** Solo para material PERSONALIZADO. */
	materialPersonalizado?: { nombre: string; rho20OhmM: number; alphaPorC: number };
}

export interface ConfiguracionFuenteFisica {
	sistema: 'DC' | 'AC_MONOFASICA' | 'AC_TRIFASICA';
	/** DC o fase-neutro en monofasica; fase-fase en trifasica. */
	tensionNominalV: number;
	frecuenciaHz?: number;
	referencia: string;
	/** Unión local explícita de la referencia con un borne PE; nunca se presume globalmente. */
	referenciaPe?: string;
	fases: { borne: string; fase: 'POSITIVO' | 'L' | 'L1' | 'L2' | 'L3'; anguloDeg?: number }[];
	rOhm?: number;
	xOhm?: number;
	/** Umbral de ingeniería para la métrica MAX_DESVIACION_MEDIA; no implica conformidad normativa. */
	umbralDesequilibrioPct?: number;
}

export interface ConfiguracionCargaFisica {
	modelo: 'CONSTANT_Z' | 'CONSTANT_I' | 'CONSTANT_PQ';
	/** Carga de dos hilos. */
	terminales?: [string, string];
	/** Carga trifasica balanceada; se crea un punto estrella interno flotante. */
	fases?: [string, string, string];
	rOhm?: number;
	xOhm?: number;
	corrienteA?: number;
	factorPotencia?: number;
	pW?: number;
	qVar?: number;
	/** Una carga trifasica balanceada se representa mediante tres ramas fase-referencia. */
	trifasica?: boolean;
}

export interface ConfiguracionTransformadorFisico {
	primarioV: number;
	secundarioV: number;
	/** Terminales explícitos habilitan el modelo acoplado V6; sin ellos se conserva V5. */
	primarioTerminales?: [string, string];
	secundarioTerminales?: [string, string];
	potenciaVA?: number;
	impedanciaPct?: number;
	xSobreR?: number;
	frecuenciaHz?: number;
	perdidasVacioW?: number;
}

export interface PuntoCurvaProteccionFisica {
	multiploIn: number;
	tMinS: number;
	tMaxS: number;
}

export interface ConfiguracionProteccionFisica {
	inA?: number;
	curva?: string;
	puntos?: PuntoCurvaProteccionFisica[];
	instantaneoDesdeIn?: number;
	i2tA2s?: number;
}

/**
 * Perfil RMS del toroide de un diferencial. No distingue tipos AC/A/F/B porque el solver
 * fasorial no modela sus formas de onda ni componentes continuas.
 */
export interface ConfiguracionDiferencialFisico {
	corrienteResidualNominalA: number;
	retardoS?: number;
	/** Pares orientados entrada -> salida que atraviesan el toroide. PE nunca debe incluirse. */
	conductoresMedidos?: { entrada: string; salida: string }[];
}

export interface ConfiguracionMotorFisico {
	potenciaMecanicaNominalW: number;
	tensionNominalV: number;
	frecuenciaHz: number;
	fases: 1 | 3;
	eficiencia: number;
	factorPotencia: number;
	corrienteNominalA?: number;
	rpmNominal?: number;
	polos?: number;
	corrienteArranqueMultiplo?: number;
	tiempoArranqueS?: number;
	factorServicio?: number;
	/** Umbral relativo para diagnosticar subtensión; p. ej. 0,9. */
	umbralSubtension?: number;
}

export interface ConfiguracionVfdFisico {
	tensionEntradaNominalV: number;
	fasesEntrada: 1 | 3;
	potenciaNominalW: number;
	eficiencia: number;
	frecuenciaBaseHz: number;
	frecuenciaMaxHz: number;
	tensionSalidaMaxV: number;
	corrienteNominalA?: number;
	limiteCorrienteA?: number;
	umbralSubtension?: number;
	rSalidaOhm?: number;
	perfil: 'V_F_LINEAL';
}

export interface ConfiguracionAnalogicaFisica {
	burdenOhm?: number;
	resistenciaSalidaOhm?: number;
	tensionMinimaTransmisorV?: number;
	tensionComplianceV?: number;
}

export interface ConfiguracionFisicaDispositivo {
	version: 1;
	fuente?: ConfiguracionFuenteFisica;
	carga?: ConfiguracionCargaFisica;
	transformador?: ConfiguracionTransformadorFisico;
	proteccion?: ConfiguracionProteccionFisica;
	diferencial?: ConfiguracionDiferencialFisico;
	motor?: ConfiguracionMotorFisico;
	vfd?: ConfiguracionVfdFisico;
	analogica?: ConfiguracionAnalogicaFisica;
}

const objeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numero = (v: unknown, admiteCero = true): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && (admiteCero ? v >= 0 : v > 0) ? v : undefined;
const texto = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim() : undefined;

export function leerFisicaConductor(v: unknown): ConfiguracionFisicaConductor | undefined {
	if (!objeto(v)) return undefined;
	const material = ['COBRE', 'ALUMINIO', 'PERSONALIZADO'].includes(String(v.material))
		? v.material as MaterialConductor : undefined;
	let materialPersonalizado: ConfiguracionFisicaConductor['materialPersonalizado'];
	if (objeto(v.materialPersonalizado)) {
		const nombre = texto(v.materialPersonalizado.nombre);
		const rho20OhmM = numero(v.materialPersonalizado.rho20OhmM, false);
		const alphaPorC = typeof v.materialPersonalizado.alphaPorC === 'number'
			&& Number.isFinite(v.materialPersonalizado.alphaPorC) ? v.materialPersonalizado.alphaPorC : undefined;
		if (nombre && rho20OhmM !== undefined && alphaPorC !== undefined) materialPersonalizado = { nombre, rho20OhmM, alphaPorC };
	}
	if (material === 'PERSONALIZADO' && !materialPersonalizado) return undefined;
	const salida: ConfiguracionFisicaConductor = {
		material,
		longitudManualM: numero(v.longitudManualM, false),
		temperaturaC: typeof v.temperaturaC === 'number' && Number.isFinite(v.temperaturaC) ? v.temperaturaC : undefined,
		xOhmPorKm: numero(v.xOhmPorKm), materialPersonalizado,
	};
	return Object.values(salida).some((x) => x !== undefined) ? salida : undefined;
}

export function leerFisicaDispositivo(v: unknown): ConfiguracionFisicaDispositivo | undefined {
	if (!objeto(v) || v.version !== 1) return undefined;
	let fuente: ConfiguracionFuenteFisica | undefined;
	if (objeto(v.fuente)) {
		const sistema = ['DC', 'AC_MONOFASICA', 'AC_TRIFASICA'].includes(String(v.fuente.sistema))
			? v.fuente.sistema as ConfiguracionFuenteFisica['sistema'] : undefined;
		const tensionNominalV = numero(v.fuente.tensionNominalV, false);
		const referencia = texto(v.fuente.referencia);
		const fases = Array.isArray(v.fuente.fases) ? v.fuente.fases.flatMap((f) => {
			if (!objeto(f)) return [];
			const borne = texto(f.borne);
			const fase = ['POSITIVO', 'L', 'L1', 'L2', 'L3'].includes(String(f.fase))
				? f.fase as ConfiguracionFuenteFisica['fases'][number]['fase'] : undefined;
			const anguloDeg = typeof f.anguloDeg === 'number' && Number.isFinite(f.anguloDeg) ? f.anguloDeg : undefined;
			return borne && fase ? [{ borne, fase, anguloDeg }] : [];
		}) : [];
		if (sistema && tensionNominalV !== undefined && referencia && fases.length) fuente = {
			sistema, tensionNominalV, referencia, referenciaPe: texto(v.fuente.referenciaPe), fases,
			frecuenciaHz: numero(v.fuente.frecuenciaHz, false), rOhm: numero(v.fuente.rOhm), xOhm: numero(v.fuente.xOhm),
			umbralDesequilibrioPct: numero(v.fuente.umbralDesequilibrioPct, false),
		};
	}
	let carga: ConfiguracionCargaFisica | undefined;
	if (objeto(v.carga)) {
		const modelo = ['CONSTANT_Z', 'CONSTANT_I', 'CONSTANT_PQ'].includes(String(v.carga.modelo))
			? v.carga.modelo as ConfiguracionCargaFisica['modelo'] : undefined;
		const terminales = Array.isArray(v.carga.terminales) && v.carga.terminales.length === 2
			? v.carga.terminales.map(texto) : [];
		const fases = Array.isArray(v.carga.fases) && v.carga.fases.length === 3 ? v.carga.fases.map(texto) : [];
		if (modelo && ((terminales[0] && terminales[1]) || (fases[0] && fases[1] && fases[2]))) carga = {
			modelo, terminales: terminales[0] && terminales[1] ? [terminales[0], terminales[1]] : undefined,
			fases: fases[0] && fases[1] && fases[2] ? [fases[0], fases[1], fases[2]] : undefined,
			rOhm: numero(v.carga.rOhm, false),
			xOhm: typeof v.carga.xOhm === 'number' && Number.isFinite(v.carga.xOhm) ? v.carga.xOhm : undefined,
			corrienteA: numero(v.carga.corrienteA), factorPotencia: numero(v.carga.factorPotencia),
			pW: typeof v.carga.pW === 'number' && Number.isFinite(v.carga.pW) ? v.carga.pW : undefined,
			qVar: typeof v.carga.qVar === 'number' && Number.isFinite(v.carga.qVar) ? v.carga.qVar : undefined,
			trifasica: typeof v.carga.trifasica === 'boolean' ? v.carga.trifasica : undefined,
		};
	}
	const sencillo = <T extends object>(bruto: unknown, campos: Record<string, { positivo?: boolean; texto?: boolean }>): T | undefined => {
		if (!objeto(bruto)) return undefined;
		const salida: Record<string, unknown> = {};
		for (const [campo, regla] of Object.entries(campos)) {
			const valor = regla.texto ? texto(bruto[campo]) : numero(bruto[campo], regla.positivo !== true);
			if (valor !== undefined) salida[campo] = valor;
		}
		return Object.keys(salida).length ? salida as T : undefined;
	};
	let transformador = sencillo<ConfiguracionTransformadorFisico>(v.transformador, {
		primarioV: { positivo: true }, secundarioV: { positivo: true }, potenciaVA: { positivo: true },
		impedanciaPct: {}, xSobreR: {}, frecuenciaHz: { positivo: true }, perdidasVacioW: {},
	});
	if (transformador && objeto(v.transformador)) {
		const par = (valor: unknown): [string, string] | undefined => {
			if (!Array.isArray(valor) || valor.length !== 2) return undefined;
			const a = texto(valor[0]); const b = texto(valor[1]);
			return a && b && a !== b ? [a, b] : undefined;
		};
		transformador = { ...transformador, primarioTerminales: par(v.transformador.primarioTerminales),
			secundarioTerminales: par(v.transformador.secundarioTerminales) };
	}
	let proteccion = sencillo<ConfiguracionProteccionFisica>(v.proteccion, {
		inA: { positivo: true }, curva: { texto: true }, instantaneoDesdeIn: { positivo: true }, i2tA2s: { positivo: true },
	});
	if (objeto(v.proteccion) && Array.isArray(v.proteccion.puntos)) {
		const puntos = v.proteccion.puntos.flatMap((p) => objeto(p)
			&& numero(p.multiploIn, false) !== undefined && numero(p.tMinS) !== undefined && numero(p.tMaxS) !== undefined
			? [{ multiploIn: p.multiploIn as number, tMinS: p.tMinS as number, tMaxS: p.tMaxS as number }] : []);
		if (puntos.length) proteccion = { ...(proteccion ?? {}), puntos };
	}
	let diferencial: ConfiguracionDiferencialFisico | undefined;
	if (objeto(v.diferencial)) {
		const corrienteResidualNominalA = numero(v.diferencial.corrienteResidualNominalA, false);
		const conductoresMedidos = Array.isArray(v.diferencial.conductoresMedidos)
			? v.diferencial.conductoresMedidos.flatMap((p) => {
				if (!objeto(p)) return [];
				const entrada = texto(p.entrada); const salida = texto(p.salida);
				return entrada && salida && entrada !== salida ? [{ entrada, salida }] : [];
			}) : [];
		if (corrienteResidualNominalA !== undefined) diferencial = {
			corrienteResidualNominalA, retardoS: numero(v.diferencial.retardoS),
			conductoresMedidos: conductoresMedidos.length ? conductoresMedidos : undefined,
		};
	}
	let motor: ConfiguracionMotorFisico | undefined;
	if (objeto(v.motor)) {
		const potenciaMecanicaNominalW = numero(v.motor.potenciaMecanicaNominalW, false);
		const tensionNominalV = numero(v.motor.tensionNominalV, false);
		const frecuenciaHz = numero(v.motor.frecuenciaHz, false);
		const fases = v.motor.fases === 1 || v.motor.fases === 3 ? v.motor.fases : undefined;
		const eficiencia = numero(v.motor.eficiencia, false);
		const factorPotencia = numero(v.motor.factorPotencia, false);
		if (potenciaMecanicaNominalW && tensionNominalV && frecuenciaHz && fases && eficiencia && eficiencia <= 1
			&& factorPotencia && factorPotencia <= 1) motor = {
			potenciaMecanicaNominalW, tensionNominalV, frecuenciaHz, fases, eficiencia, factorPotencia,
			corrienteNominalA: numero(v.motor.corrienteNominalA, false), rpmNominal: numero(v.motor.rpmNominal, false),
			polos: numero(v.motor.polos, false), corrienteArranqueMultiplo: numero(v.motor.corrienteArranqueMultiplo, false),
			tiempoArranqueS: numero(v.motor.tiempoArranqueS, false), factorServicio: numero(v.motor.factorServicio, false),
			umbralSubtension: numero(v.motor.umbralSubtension, false),
		};
	}
	let vfd: ConfiguracionVfdFisico | undefined;
	if (objeto(v.vfd)) {
		const tensionEntradaNominalV = numero(v.vfd.tensionEntradaNominalV, false);
		const fasesEntrada = v.vfd.fasesEntrada === 1 || v.vfd.fasesEntrada === 3 ? v.vfd.fasesEntrada : undefined;
		const potenciaNominalW = numero(v.vfd.potenciaNominalW, false);
		const eficiencia = numero(v.vfd.eficiencia, false);
		const frecuenciaBaseHz = numero(v.vfd.frecuenciaBaseHz, false);
		const frecuenciaMaxHz = numero(v.vfd.frecuenciaMaxHz, false);
		const tensionSalidaMaxV = numero(v.vfd.tensionSalidaMaxV, false);
		if (tensionEntradaNominalV && fasesEntrada && potenciaNominalW && eficiencia && eficiencia <= 1
			&& frecuenciaBaseHz && frecuenciaMaxHz && tensionSalidaMaxV && v.vfd.perfil === 'V_F_LINEAL') vfd = {
			tensionEntradaNominalV, fasesEntrada, potenciaNominalW, eficiencia, frecuenciaBaseHz,
			frecuenciaMaxHz, tensionSalidaMaxV, perfil: 'V_F_LINEAL',
			corrienteNominalA: numero(v.vfd.corrienteNominalA, false), limiteCorrienteA: numero(v.vfd.limiteCorrienteA, false),
			umbralSubtension: numero(v.vfd.umbralSubtension, false), rSalidaOhm: numero(v.vfd.rSalidaOhm),
		};
	}
	const analogica = sencillo<ConfiguracionAnalogicaFisica>(v.analogica, {
		burdenOhm: {}, resistenciaSalidaOhm: {}, tensionMinimaTransmisorV: {}, tensionComplianceV: {},
	});
	const salida = { version: 1 as const, fuente, carga, transformador, proteccion, diferencial, motor, vfd, analogica };
	return fuente || carga || transformador || proteccion || diferencial || motor || vfd || analogica ? salida : undefined;
}
