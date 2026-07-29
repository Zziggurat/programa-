/**
 * Balance térmico del gabinete (método simplificado de IEC 60890).
 *
 * Un tablero cerrado se calienta con lo que disipan sus propios aparatos. Si la temperatura
 * interior se pasa, los automáticos disparan antes de tiempo, los variadores se limitan y la
 * electrónica envejece. Antes de pedir el armario hay que saber si necesita rejillas,
 * ventilador o climatizador — y es un cálculo que el cliente espera ver en el dossier.
 *
 * El método real de IEC 60890 usa tablas de constantes según la forma y el montaje. Aquí se
 * aplica su forma simplificada: superficie efectiva de disipación según cómo esté instalado
 * el armario, y salto térmico proporcional a la potencia disipada por unidad de superficie.
 * Es una estimación de proyecto, no un ensayo, y el resultado lo dice.
 */
import { Dispositivo, Proyecto, TipoDispositivo } from '../modelo/tipos.js';
import { cajaDeGabinete, opcionesDe } from '../modelo/proyecto.js';

/**
 * Disipación típica en servicio (W) cuando el aparato no la declara. Son órdenes de magnitud
 * de catálogo para un aparato cargado a su corriente nominal; sirven para no dejar el cálculo
 * en cero, pero cualquier dato real del fabricante manda sobre esto.
 */
const DISIPACION_TIPICA: Partial<Record<TipoDispositivo, number>> = {
	disyuntor: 3.5,
	diferencial: 2.5,
	guardamotor: 5,
	fusible: 3,
	seccionador: 4,
	contactor: 5,
	rele: 1.2,
	variador: 45,
	fuente: 12,
	transformador: 20,
	plc: 6,
	piloto: 0.5,
	pulsador: 0,
	selector: 0,
	sensor: 0.5,
	bornero: 0.5,
};

/** Cómo está instalado el armario: decide cuánta superficie disipa de verdad. */
export type Montaje = 'mural' | 'exento' | 'empotrado';

export interface BalanceTermico {
	/** Potencia total disipada dentro del gabinete (W). */
	disipacionW: number;
	/** Cuánto de esa potencia sale de datos del fabricante y no de una estimación (0..1). */
	fraccionDeclarada: number;
	/** Superficie efectiva de disipación del armario (m²). */
	superficieM2: number;
	/** Salto térmico estimado sobre el ambiente (K). */
	saltoTermicoK: number;
	/** Temperatura interior estimada (°C). */
	temperaturaInteriorC: number;
	temperaturaAmbienteC: number;
	/** Cómo se supuso instalado el armario para el cálculo. */
	montaje: Montaje;
	/** Qué hay que hacer con esa temperatura. */
	veredicto: 'holgado' | 'justo' | 'ventilacion' | 'climatizacion';
	recomendacion: string;
	/** Los tres aparatos que más calientan, para saber dónde mirar. */
	principales: { designacion: string; watts: number; estimado: boolean }[];
}

/** Disipación de un aparato: la suya si la declara, o la típica de su tipo. */
export function disipacionDe(d: Dispositivo): { watts: number; estimado: boolean } {
	if (d.disipacionW !== undefined) return { watts: d.disipacionW, estimado: false };
	return { watts: DISIPACION_TIPICA[d.tipo] ?? 1, estimado: true };
}

/**
 * Superficie efectiva de disipación (m²) según IEC 60890: no todas las caras cuentan igual.
 * Una cara pegada a la pared no disipa; la tapa superior disipa más que las laterales porque
 * el aire caliente sube.
 */
function superficieEfectiva(
	anchoMm: number,
	altoMm: number,
	fondoMm: number,
	montaje: Montaje,
): number {
	const a = anchoMm / 1000;
	const h = altoMm / 1000;
	const p = fondoMm / 1000;
	const frente = a * h;
	const lateral = h * p;
	const techo = a * p;
	switch (montaje) {
		// Adosado a la pared: se pierde la cara trasera.
		case 'mural': return 1.4 * frente + 2 * lateral + 1.4 * techo;
		// Empotrado entre otros armarios: solo frente y techo.
		case 'empotrado': return 1.4 * frente + 0.7 * techo;
		// Exento: disipa por todas las caras.
		default: return 2 * frente + 2 * lateral + 1.4 * techo;
	}
}

export function calcularBalanceTermico(proyecto: Proyecto, montajeForzado?: Montaje): BalanceTermico | undefined {
	const g = proyecto.gabinete;
	if (!g) return undefined;
	const montaje = montajeForzado ?? opcionesDe(proyecto).montajeGabinete;
	const caja = cajaDeGabinete(g);
	const colocados = new Set(g.colocaciones.map((c) => c.dispositivoId));

	let disipacionW = 0;
	let declaradaW = 0;
	const porAparato: { designacion: string; watts: number; estimado: boolean }[] = [];
	for (const d of proyecto.dispositivos) {
		// Solo calienta lo que está DENTRO del armario.
		if (!colocados.has(d.id) || d.imagen) continue;
		const { watts, estimado } = disipacionDe(d);
		disipacionW += watts;
		if (!estimado) declaradaW += watts;
		if (watts > 0) porAparato.push({ designacion: d.designacion ?? d.id, watts, estimado });
	}
	porAparato.sort((a, b) => b.watts - a.watts);

	const superficieM2 = superficieEfectiva(caja.ancho, caja.alto, caja.profundidad, montaje);
	// Forma simplificada de IEC 60890: el salto térmico crece con la potencia por m² elevada
	// a ~0,8. La constante sale de ajustar el método a armarios de chapa habituales.
	const densidad = superficieM2 > 0 ? disipacionW / superficieM2 : 0;
	const saltoTermicoK = disipacionW > 0 ? 0.62 * Math.pow(densidad, 0.8) : 0;
	const temperaturaAmbienteC = opcionesDe(proyecto).temperaturaAmbienteC;
	const temperaturaInteriorC = temperaturaAmbienteC + saltoTermicoK;

	// Los escalones salen del límite real de la aparamenta modular, no de un número redondo:
	// hasta 55 °C dentro los automáticos, contactores y fuentes trabajan dentro de su rango sin
	// derrateo; por encima empiezan a disparar antes de tiempo y a acortar su vida. Se deja un
	// escalón de aviso a 45 °C para que quede margen frente a un día caluroso.
	const veredicto: BalanceTermico['veredicto'] =
		temperaturaInteriorC <= 45 ? 'holgado'
			: temperaturaInteriorC <= 55 ? 'justo'
				: temperaturaInteriorC <= 65 ? 'ventilacion' : 'climatizacion';
	const recomendacion = {
		holgado: 'El armario cerrado disipa de sobra: no hace falta ventilación.',
		justo: 'Va justo. Conviene dejar respiración (rejilla de entrada y salida) si el ambiente puede subir.',
		ventilacion: 'Necesita ventilación forzada: rejilla filtrante con ventilador dimensionado al caudal.',
		climatizacion: 'No basta con ventilar: hace falta climatizador o intercambiador, o repartir la carga en dos armarios.',
	}[veredicto];

	return {
		disipacionW: Math.round(disipacionW * 10) / 10,
		fraccionDeclarada: disipacionW > 0 ? declaradaW / disipacionW : 1,
		superficieM2: Math.round(superficieM2 * 1000) / 1000,
		saltoTermicoK: Math.round(saltoTermicoK * 10) / 10,
		temperaturaInteriorC: Math.round(temperaturaInteriorC * 10) / 10,
		temperaturaAmbienteC,
		montaje,
		veredicto,
		recomendacion,
		principales: porAparato.slice(0, 3),
	};
}
