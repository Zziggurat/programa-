/**
 * Motor de cálculo ELÉCTRICO: lo que de verdad revisa un profesional antes de energizar
 * un tablero. A diferencia del resto de motores (que miran la topología del dibujo), este
 * mira la física: si el conductor aguanta la corriente, si la protección lo protege y si la
 * tensión llega al final del circuito.
 *
 * Todo son funciones puras sobre números: se puede probar sin dibujar nada.
 *
 * Referencias: IEC 60364-5-52 (intensidades admisibles) y la práctica habitual en Chile
 * (NCh Elec. 4/2003), que sigue la misma familia de tablas.
 */

/**
 * Intensidad admisible (A) de conductores de COBRE con aislación PVC 70 °C a 30 °C ambiente,
 * instalación B1 (conductores en tubo o canaleta sobre pared), que es el caso de un tablero.
 * Es la tabla conservadora: dentro de un tablero cerrado y con varios circuitos juntos,
 * quedarse corto es lo correcto.
 */
export const AMPACIDAD_COBRE_B1: ReadonlyArray<{ seccion: number; corriente: number }> = [
	{ seccion: 0.75, corriente: 9 },
	{ seccion: 1, corriente: 11 },
	{ seccion: 1.5, corriente: 14.5 },
	{ seccion: 2.5, corriente: 19.5 },
	{ seccion: 4, corriente: 26 },
	{ seccion: 6, corriente: 34 },
	{ seccion: 10, corriente: 46 },
	{ seccion: 16, corriente: 61 },
	{ seccion: 25, corriente: 80 },
	{ seccion: 35, corriente: 99 },
	{ seccion: 50, corriente: 119 },
	{ seccion: 70, corriente: 151 },
	{ seccion: 95, corriente: 182 },
];

/** Resistividad del cobre a 70 °C (Ω·mm²/m): la temperatura de servicio del aislante PVC. */
export const RHO_COBRE = 0.0225;

/**
 * Factor de agrupamiento: dentro de una canaleta los conductores se calientan entre ellos y
 * aguantan menos corriente (IEC 60364-5-52 tabla B.52.17). Sin agrupar (1 circuito) es 1.
 */
export function factorAgrupamiento(circuitos: number): number {
	if (!Number.isFinite(circuitos) || circuitos <= 1) return 1;
	if (circuitos === 2) return 0.8;
	if (circuitos === 3) return 0.7;
	if (circuitos === 4) return 0.65;
	if (circuitos <= 6) return 0.57;
	if (circuitos <= 9) return 0.5;
	return 0.45;
}

/**
 * Sanea un número que viene del modelo. Estos cálculos deciden si un conductor aguanta la
 * corriente que va a pasar por él: ante un dato imposible (vacío, negativo, NaN, infinito) se
 * devuelve 0 y quien llama decide, en vez de propagar un número sin sentido a un informe que
 * alguien va a usar para montar un tablero.
 */
function sano(v: number): number {
	return Number.isFinite(v) && v > 0 ? v : 0;
}

/** Máxima sección de la tabla; por encima se extrapola, pero nunca hasta el infinito. */
const SECCION_MAX = AMPACIDAD_COBRE_B1[AMPACIDAD_COBRE_B1.length - 1];

/** Intensidad admisible (A) de una sección, ya corregida por agrupamiento. */
export function ampacidad(seccionMm2: number, circuitosAgrupados = 1): number {
	const s = sano(seccionMm2);
	if (s === 0) return 0;
	const fila = AMPACIDAD_COBRE_B1.find((f) => f.seccion >= s - 1e-9);
	// Por encima de la tabla se extrapola con la última fila (proporcional a la sección).
	const base = fila ? fila.corriente : (SECCION_MAX.corriente * s) / SECCION_MAX.seccion;
	return base * factorAgrupamiento(circuitosAgrupados);
}

/** Sección normalizada (mm²) más pequeña que admite esa corriente. undefined si se sale de tabla. */
export function seccionMinima(corrienteA: number, circuitosAgrupados = 1): number | undefined {
	if (!Number.isFinite(corrienteA)) return undefined;
	const f = factorAgrupamiento(circuitosAgrupados);
	return AMPACIDAD_COBRE_B1.find((fila) => fila.corriente * f >= corrienteA)?.seccion;
}

/**
 * Caída de tensión en PORCENTAJE de la tensión nominal.
 * Monofásico: ΔU = 2·ρ·L·I/S. Trifásico: ΔU = √3·ρ·L·I/S (se desprecia la reactancia, que en
 * las secciones y longitudes de un tablero es despreciable frente a la resistencia).
 */
export function caidaTensionPct(datos: {
	corrienteA: number;
	longitudM: number;
	seccionMm2: number;
	tensionV: number;
	trifasico?: boolean;
}): number {
	const corrienteA = sano(datos.corrienteA);
	const longitudM = sano(datos.longitudM);
	const seccionMm2 = sano(datos.seccionMm2);
	const tensionV = sano(datos.tensionV);
	if (!seccionMm2 || !tensionV || !corrienteA || !longitudM) return 0;
	const k = datos.trifasico ? Math.sqrt(3) : 2;
	const pct = ((k * RHO_COBRE * longitudM * corrienteA) / seccionMm2 / tensionV) * 100;
	return Number.isFinite(pct) ? pct : 0;
}

/**
 * Límite de caída de tensión admisible (%). En instalaciones interiores se admite más en
 * fuerza (motores) que en alumbrado; el cableado interno de un tablero debe quedar muy por
 * debajo, así que el límite es el estricto.
 */
export const CAIDA_MAX_PCT = { fuerza: 5, alumbrado: 3, control: 3 } as const;

/**
 * ¿Protege esta protección a este conductor? La regla de oro de la coordinación:
 *
 *     Ib ≤ In ≤ Iz      (corriente de empleo ≤ nominal de la protección ≤ admisible del cable)
 *
 * Si In supera Iz, el cable puede calentarse indefinidamente sin que salte la protección: es
 * el clásico incendio por «le puse un automático más grande porque saltaba».
 */
export function coordinacionCorrecta(datos: {
	corrienteProteccionA: number;
	seccionMm2: number;
	circuitosAgrupados?: number;
}): boolean {
	const iz = ampacidad(datos.seccionMm2, datos.circuitosAgrupados ?? 1);
	// Sin sección conocida no se puede afirmar que esté protegido: se responde que NO, que es
	// el lado seguro (mejor un aviso de más que dar por bueno un circuito sin comprobar).
	if (iz <= 0) return false;
	return sano(datos.corrienteProteccionA) <= iz + 1e-9;
}

/** Sección de cobre (mm²) del conductor de protección (PE) que corresponde a una fase dada. */
export function seccionPE(seccionFaseMm2: number): number {
	const s = sano(seccionFaseMm2);
	if (s <= 16) return s;
	if (s <= 35) return 16;
	return Math.ceil(s / 2);
}

/**
 * Ocupación de una canaleta en TANTO POR UNO: qué fracción de su sección útil llenan los
 * conductores que van por dentro. Se cuenta el diámetro EXTERIOR del conductor aislado
 * (aprox. sección + aislante) y se admite el llenado máximo que fije el proyecto.
 */
export function ocupacionCanaleta(datos: {
	anchoMm: number;
	altoMm: number;
	secciones: number[];
}): number {
	const util = sano(datos.anchoMm) * sano(datos.altoMm);
	if (util <= 0) return 0;
	const ocupada = datos.secciones.reduce((s, mm2) => s + areaConductorAisladoMm2(mm2), 0);
	const fraccion = ocupada / util;
	return Number.isFinite(fraccion) ? fraccion : 0;
}

/**
 * Área (mm²) que ocupa de verdad un conductor aislado: el cobre más la aislación. Regla
 * práctica de taller: el diámetro exterior es del orden de 2,4× el diámetro del cobre.
 */
export function areaConductorAisladoMm2(seccionCobreMm2: number): number {
	const s = sano(seccionCobreMm2);
	if (s === 0) return 0;
	const dCobre = 2 * Math.sqrt(s / Math.PI);
	const dExterior = dCobre * 2.4;
	const area = (Math.PI * dExterior * dExterior) / 4;
	return Number.isFinite(area) ? area : 0;
}
