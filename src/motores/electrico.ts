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
 * TEMPERATURA DE REFERENCIA de la tabla de arriba. Todo lo que se aparte de aquí hay que
 * corregirlo, y dentro de un tablero uno SIEMPRE se aparta.
 */
export const TEMPERATURA_TABLA_C = 30;

/**
 * Corrección por temperatura ambiente para aislación de PVC (70 °C), IEC 60364-5-52 tabla
 * B.52.14. Entre dos filas se interpola.
 *
 * Por qué importa tanto aquí: un tablero de cubierta a pleno sol tiene 45 o 50 °C DENTRO del
 * armario, no 30. A 50 °C el mismo conductor admite el 71 % de lo que dice la tabla, y a 55 °C
 * el 61 %. Verificar un tablero de azotea con la tabla de 30 °C es aprobar un cable que en
 * enero va a trabajar muy por encima de su límite.
 */
const CORRECCION_TEMPERATURA_PVC: ReadonlyArray<{ ambienteC: number; factor: number }> = [
	{ ambienteC: 10, factor: 1.22 },
	{ ambienteC: 15, factor: 1.17 },
	{ ambienteC: 20, factor: 1.12 },
	{ ambienteC: 25, factor: 1.06 },
	{ ambienteC: 30, factor: 1 },
	{ ambienteC: 35, factor: 0.94 },
	{ ambienteC: 40, factor: 0.87 },
	{ ambienteC: 45, factor: 0.79 },
	{ ambienteC: 50, factor: 0.71 },
	{ ambienteC: 55, factor: 0.61 },
	{ ambienteC: 60, factor: 0.5 },
];

/** Por encima de esta temperatura el PVC ya no sirve: el conductor mismo trabaja a 70 °C. */
export const TEMPERATURA_MAX_PVC_C = 60;

/**
 * Factor de corrección por temperatura ambiente.
 *
 * Devuelve 0 por encima de 60 °C, y no es un número pequeño cualquiera: ahí ya no queda salto
 * térmico que aprovechar. No es que el cable aguante poco, es que a esa temperatura NO se pone
 * PVC —se pone XLPE, o se baja la temperatura del armario—. Quien llame tiene que decirlo así
 * y no como «sube la sección», porque subir la sección ahí no arregla nada.
 */
export function factorTemperatura(ambienteC: number): number {
	if (!Number.isFinite(ambienteC)) return 1;
	const t = CORRECCION_TEMPERATURA_PVC;
	if (ambienteC <= t[0].ambienteC) return t[0].factor;
	if (ambienteC > TEMPERATURA_MAX_PVC_C) return 0;
	for (let i = 1; i < t.length; i++) {
		if (ambienteC > t[i].ambienteC) continue;
		const a = t[i - 1];
		const b = t[i];
		const k = (ambienteC - a.ambienteC) / (b.ambienteC - a.ambienteC);
		return a.factor + (b.factor - a.factor) * k;
	}
	return t[t.length - 1].factor;
}

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

/**
 * Intensidad admisible (A) de una sección EN LAS CONDICIONES DE ESTE TABLERO: la tabla base
 * corregida por agrupamiento y por temperatura.
 *
 * Los dos factores por defecto son los de la tabla (1 circuito, 30 °C) para que quien solo
 * quiera el valor de catálogo lo tenga; pero el que verifica un tablero de verdad TIENE que
 * pasar los suyos. Sin ellos, un 2,5 mm² «admite 19,5 A» cuando dentro de un armario a 50 °C
 * con nueve circuitos en la canaleta admite 6,9 A.
 */
export function ampacidad(seccionMm2: number, circuitosAgrupados = 1, ambienteC = TEMPERATURA_TABLA_C): number {
	const s = sano(seccionMm2);
	if (s === 0) return 0;
	const fila = AMPACIDAD_COBRE_B1.find((f) => f.seccion >= s - 1e-9);
	// Por encima de la tabla se extrapola con la última fila (proporcional a la sección).
	const base = fila ? fila.corriente : (SECCION_MAX.corriente * s) / SECCION_MAX.seccion;
	return base * factorAgrupamiento(circuitosAgrupados) * factorTemperatura(ambienteC);
}

/** Sección normalizada (mm²) más pequeña que admite esa corriente. undefined si se sale de tabla. */
export function seccionMinima(
	corrienteA: number, circuitosAgrupados = 1, ambienteC = TEMPERATURA_TABLA_C,
): number | undefined {
	if (!Number.isFinite(corrienteA)) return undefined;
	const f = factorAgrupamiento(circuitosAgrupados) * factorTemperatura(ambienteC);
	if (f <= 0) return undefined;   // a esa temperatura no hay sección de PVC que valga
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
