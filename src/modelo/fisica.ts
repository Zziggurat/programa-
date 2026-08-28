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
	fases: { borne: string; fase: 'POSITIVO' | 'L' | 'L1' | 'L2' | 'L3'; anguloDeg?: number }[];
	rOhm?: number;
	xOhm?: number;
}

export interface ConfiguracionCargaFisica {
	modelo: 'CONSTANT_Z' | 'CONSTANT_I' | 'CONSTANT_PQ';
	terminales: [string, string];
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
	potenciaVA?: number;
	impedanciaPct?: number;
	xSobreR?: number;
	frecuenciaHz?: number;
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
			sistema, tensionNominalV, referencia, fases,
			frecuenciaHz: numero(v.fuente.frecuenciaHz, false), rOhm: numero(v.fuente.rOhm), xOhm: numero(v.fuente.xOhm),
		};
	}
	let carga: ConfiguracionCargaFisica | undefined;
	if (objeto(v.carga)) {
		const modelo = ['CONSTANT_Z', 'CONSTANT_I', 'CONSTANT_PQ'].includes(String(v.carga.modelo))
			? v.carga.modelo as ConfiguracionCargaFisica['modelo'] : undefined;
		const terminales = Array.isArray(v.carga.terminales) && v.carga.terminales.length === 2
			? v.carga.terminales.map(texto) : [];
		if (modelo && terminales[0] && terminales[1]) carga = {
			modelo, terminales: [terminales[0], terminales[1]], rOhm: numero(v.carga.rOhm, false),
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
	const transformador = sencillo<ConfiguracionTransformadorFisico>(v.transformador, {
		primarioV: { positivo: true }, secundarioV: { positivo: true }, potenciaVA: { positivo: true },
		impedanciaPct: {}, xSobreR: {}, frecuenciaHz: { positivo: true },
	});
	let proteccion = sencillo<ConfiguracionProteccionFisica>(v.proteccion, {
		inA: { positivo: true }, curva: { texto: true }, instantaneoDesdeIn: { positivo: true }, i2tA2s: { positivo: true },
	});
	if (objeto(v.proteccion) && Array.isArray(v.proteccion.puntos)) {
		const puntos = v.proteccion.puntos.flatMap((p) => objeto(p)
			&& numero(p.multiploIn, false) !== undefined && numero(p.tMinS) !== undefined && numero(p.tMaxS) !== undefined
			? [{ multiploIn: p.multiploIn as number, tMinS: p.tMinS as number, tMaxS: p.tMaxS as number }] : []);
		if (puntos.length) proteccion = { ...(proteccion ?? {}), puntos };
	}
	const analogica = sencillo<ConfiguracionAnalogicaFisica>(v.analogica, {
		burdenOhm: {}, resistenciaSalidaOhm: {}, tensionMinimaTransmisorV: {}, tensionComplianceV: {},
	});
	const salida = { version: 1 as const, fuente, carga, transformador, proteccion, analogica };
	return fuente || carga || transformador || proteccion || analogica ? salida : undefined;
}
