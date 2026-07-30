/**
 * «¿Y esto cómo se conecta?»
 *
 * Nace de una frase literal de quien probó el programa: *«el sensor inductivo tampoco lo pude
 * probar y ni sé cómo se conecta»*. Y tiene razón: un detector PNP de tres hilos no se conecta de
 * forma obvia, y la numeración de los bornes de un contactor o de un relé térmico es un código
 * que se aprende en el taller, no mirando el aparato.
 *
 * Así que cada aparato explica su propio cableado. No se guarda en el proyecto —sería texto
 * estático repetido en cada archivo— sino que se deduce aquí del tipo y de los bornes que tiene,
 * de modo que también funciona con aparatos hechos a mano y no solo con los del catálogo.
 *
 * La numeración IEC 60947-5-1 que se usa abajo es la de cualquier esquema:
 *   A1 A2      bobina
 *   11 12      contacto NC (abre al activarse)
 *   13 14      contacto NA (cierra al activarse)
 *   21 22      segundo NC · 23 24 segundo NA…
 *   95 96      contacto NC de alarma de un relé térmico (por donde vuelve la bobina)
 *   97 98      contacto NA de alarma
 *   1/L1 2/T1  polo de potencia: entrada arriba, salida abajo
 */
import { Dispositivo } from '../src/modelo/tipos.js';

export interface AyudaCableado {
	/** Una línea: para qué sirve y por dónde se le da tensión. */
	resumen: string;
	/** Qué es cada borne y a dónde va. */
	bornes: { borne: string; papel: string }[];
	/** Aviso de lo que se hace mal la primera vez. */
	cuidado?: string;
}

const tiene = (d: Dispositivo, ...ids: string[]): boolean =>
	ids.every((i) => d.bornes.some((b) => b.id === i));

/** Bornes que siguen el patrón de contacto auxiliar IEC: 11/12, 13/14, 21/22, 23/24… */
function contactosAuxiliares(d: Dispositivo): { borne: string; papel: string }[] {
	const salida: { borne: string; papel: string }[] = [];
	for (const b of d.bornes) {
		const m = /^(\d)([1-8])$/.exec(b.id);
		if (!m) continue;
		const digito = m[2];
		if (digito === '1') salida.push({ borne: b.id, papel: `común del contacto ${m[1]}` });
		else if (digito === '2') salida.push({ borne: b.id, papel: 'salida NC — cerrado en reposo, abre al activarse' });
		else if (digito === '3') salida.push({ borne: b.id, papel: `común del contacto ${m[1]}` });
		else if (digito === '4') salida.push({ borne: b.id, papel: 'salida NA — abierto en reposo, cierra al activarse' });
	}
	return salida;
}

export function comoSeConecta(d: Dispositivo): AyudaCableado | undefined {
	switch (d.tipo) {
		case 'sensor': {
			// El caso que motivó todo esto.
			if (tiene(d, '+24', '0V') || tiene(d, '+', '-')) {
				const mas = tiene(d, '+24') ? '+24' : '+';
				const menos = tiene(d, '0V') ? '0V' : '-';
				const salida = d.bornes.find((b) => b.tipo === 'senal')?.id ?? 'OUT';
				return {
					resumen: 'Detector de TRES hilos: dos para alimentarlo y uno que da la señal. No es un '
						+ 'contacto seco — hay que darle 24 V para que funcione.',
					bornes: [
						{ borne: mas, papel: 'marrón · +24 V de la fuente (o de la borna donde tengas el +24)' },
						{ borne: menos, papel: 'azul · 0 V de la fuente' },
						{ borne: salida, papel: 'negro · la señal: va a una entrada digital del PLC o del controlador' },
					],
					cuidado: 'PNP significa que al detectar entrega +24 V por la señal, así que la entrada del '
						+ 'PLC tiene que estar configurada como PNP (común a 0 V). Si el sensor fuera NPN sería al '
						+ 'revés y no funcionaría con el mismo cableado.',
				};
			}
			return {
				resumen: 'Detector de contacto seco: se cablea como un pulsador, sin alimentación propia.',
				bornes: contactosAuxiliares(d),
			};
		}

		case 'contactor':
			return {
				resumen: 'Se manda por la BOBINA (A1-A2) y la corriente del motor pasa por los polos de '
					+ 'potencia. Al energizar la bobina, los polos cierran y los auxiliares cambian de estado.',
				bornes: [
					{ borne: 'A1', papel: `bobina · viene la fase del mando (a ${d.tensionNominal ?? 24} V)` },
					{ borne: 'A2', papel: 'bobina · el retorno (neutro, o el 95-96 del térmico si lo lleva)' },
					...['1/L1', '3/L2', '5/L3'].filter((i) => tiene(d, i))
						.map((i) => ({ borne: i, papel: 'entrada de potencia (arriba): viene de la protección' })),
					...['2/T1', '4/T2', '6/T3'].filter((i) => tiene(d, i))
						.map((i) => ({ borne: i, papel: 'salida de potencia (abajo): va al motor o al térmico' })),
					...contactosAuxiliares(d),
				],
				cuidado: 'La bobina va a la tensión de MANDO, que casi nunca es la de la potencia. Un contactor '
					+ 'de bobina 24 V conectado a 220 V se quema al instante.',
			};

		case 'rele':
			// El térmico se distingue por sus bornes 95/96: es su contacto de alarma.
			if (tiene(d, '95', '96')) {
				return {
					resumen: 'Relé térmico: vigila la corriente del motor y, si se pasa, abre su contacto 95-96 '
						+ 'para tirar la bobina del contactor. Va colgado debajo del contactor.',
					bornes: [
						{ borne: '1', papel: 'entradas: se enchufan directamente a las salidas del contactor' },
						{ borne: '2', papel: 'salidas: van al motor' },
						{ borne: '95', papel: 'contacto de alarma NC: por aquí VUELVE la bobina del contactor' },
						{ borne: '96', papel: 'el otro extremo del NC: al neutro del mando' },
						...(tiene(d, '97', '98') ? [{ borne: '97', papel: 'contacto NA: para una luz de «falla»' }] : []),
					],
					cuidado: 'Si la bobina no vuelve por el 95-96, el térmico salta pero el motor sigue en marcha: '
						+ 'protege el papel y no el motor. Es el error clásico.',
				};
			}
			return {
				resumen: 'Relé auxiliar: se manda por la bobina A1-A2 y multiplica contactos para el mando.',
				bornes: [
					{ borne: 'A1', papel: `bobina · la señal que lo activa (${d.tensionNominal ?? 24} V)` },
					{ borne: 'A2', papel: 'bobina · el retorno común' },
					...contactosAuxiliares(d),
				],
			};

		case 'pulsador':
		case 'selector':
			return {
				resumen: 'Contacto seco: no se alimenta, solo abre o cierra el paso de la corriente del mando. '
					+ 'Se pone EN SERIE en el circuito de mando.',
				bornes: contactosAuxiliares(d),
				cuidado: 'Un PARO se hace con contacto NC (11-12) y una MARCHA con NA (13-14). Si se cambian, el '
					+ 'tablero arranca solo al dar tensión y no para al pulsar.',
			};

		case 'piloto':
			return {
				resumen: 'Se conecta como cualquier lámpara: sus dos bornes, entre la señal y el retorno.',
				bornes: [
					{ borne: d.bornes[0]?.id ?? 'X1', papel: 'la señal que lo enciende (salida del PLC o un contacto)' },
					{ borne: d.bornes[1]?.id ?? 'X2', papel: 'el retorno común (0 V o neutro del mando)' },
				],
			};

		case 'disyuntor':
		case 'diferencial':
		case 'guardamotor':
		case 'seccionador':
			return {
				resumen: 'Protección: entra por ARRIBA (impares) y sale por ABAJO (pares). Un polo por cada '
					+ 'conductor activo que tenga que cortar.',
				bornes: [
					{ borne: 'impares (1, 3, 5)', papel: 'entrada: vienen de aguas arriba' },
					{ borne: 'pares (2, 4, 6)', papel: 'salida: van a la carga' },
					...(d.tipo === 'diferencial'
						? [{ borne: 'N', papel: 'el neutro TIENE que pasar por dentro del diferencial, o disparará solo' }]
						: []),
				],
				cuidado: d.tipo === 'diferencial'
					? 'El neutro de la carga tiene que salir del diferencial, no cogerse de otro sitio. Si se '
						+ 'coge de fuera, la corriente no cuadra y el diferencial dispara sin motivo.'
					: 'Respeta el sentido arriba→abajo: es lo que espera cualquiera que abra el tablero después.',
			};

		case 'fuente':
			return {
				resumen: 'Convierte los 220 V en los 24 V del mando. Primario a la izquierda, secundario a la derecha.',
				bornes: [
					{ borne: 'L', papel: 'fase 220 V, desde su protección' },
					{ borne: 'N', papel: 'neutro 220 V' },
					{ borne: 'PE', papel: 'tierra — no es opcional' },
					{ borne: '+V', papel: '+24 V: de aquí sale el positivo a todo el mando' },
					{ borne: '-V', papel: '0 V: el común de todo el mando' },
				],
				cuidado: 'Del +V y del -V salen MUCHOS cables. No los metas todos en el borne de la fuente: '
					+ 'lleva uno a un par de bornas y reparte desde ahí.',
			};

		case 'transformador':
			return {
				resumen: 'Transformador de mando: baja la tensión sin electrónica. P = primario, S = secundario.',
				bornes: [
					{ borne: 'P1', papel: 'primario: fase de entrada' },
					{ borne: 'P2', papel: 'primario: neutro de entrada' },
					{ borne: 'S1', papel: 'secundario: la fase del mando' },
					{ borne: 'S2', papel: 'secundario: el retorno del mando' },
				],
			};

		case 'plc':
			return {
				resumen: 'Controlador: se alimenta por sus bornes de 24 V, lee el mundo por las entradas y '
					+ 'lo mueve por las salidas.',
				bornes: [
					{ borne: '+24 / 0V', papel: 'alimentación del controlador, desde la fuente' },
					{ borne: 'entradas (I, DI, UI)', papel: 'vienen de sensores, pulsadores y contactos auxiliares' },
					{ borne: 'salidas (Q, DO, AO)', papel: 'van a bobinas de relé y contactores, pilotos o válvulas' },
				],
				cuidado: 'Una salida de controlador no mueve un motor: mueve la BOBINA de un contactor o de un '
					+ 'relé, y ese contactor es el que aguanta la corriente del motor.',
			};

		case 'variador':
			return {
				resumen: 'Variador: entra la red por L/N y sale al motor por U/V/W. Lo que gobierna la velocidad '
					+ 'son sus entradas de mando.',
				bornes: [
					{ borne: 'L1 / N', papel: 'entrada de red, desde su protección' },
					{ borne: 'U / V / W', papel: 'salida AL MOTOR — nunca a la red' },
					{ borne: 'PE', papel: 'tierra, obligatoria y con cable corto' },
					{ borne: 'DI1', papel: 'orden de marcha (un contacto o una salida del PLC)' },
					{ borne: 'AI1', papel: 'consigna de velocidad, 0–10 V o 4–20 mA' },
				],
				cuidado: 'No pongas nunca un contactor entre el variador y el motor abriéndolo en marcha, y no '
					+ 'confundas U/V/W con la entrada de red: el variador se destruye.',
			};

		case 'fusible':
			return {
				resumen: 'Protege el circuito de mando. Se pone en serie, justo después de la fuente o del '
					+ 'secundario del transformador.',
				bornes: [
					{ borne: '1', papel: 'entrada' },
					{ borne: '2', papel: 'salida al circuito que protege' },
				],
			};

		case 'bornero':
			return {
				resumen: 'Bornas de paso: no hacen nada eléctricamente, sirven para que todo cable que sale del '
					+ 'tablero se corte aquí y se pueda medir y desconectar sin tocar los aparatos.',
				bornes: [
					{ borne: 'lado interno', papel: 'los cables que vienen de los aparatos del tablero' },
					{ borne: 'lado externo', papel: 'los cables que se van al campo' },
				],
				cuidado: 'Dos conductores por borna como máximo. Si necesitas repartir a más sitios, usa puentes '
					+ 'entre bornas.',
			};

		case 'motor':
		case 'valvula':
		case 'resistencia':
			return {
				resumen: 'Consumo en campo: llega por el bornero, nunca directamente del aparato de maniobra.',
				bornes: d.bornes.map((b) => ({
					borne: b.id,
					papel: b.tipo === 'PE' ? 'tierra, obligatoria' : 'del bornero de salida del tablero',
				})),
			};

		default:
			return undefined;
	}
}
