/**
 * Motor DRC (Design Rule Check): detección automática de errores eléctricos.
 *
 * QElectroTech no tiene nada equivalente; estas reglas operan sobre el modelo puro
 * y el resultado del motor de potenciales.
 */
import { Conductor, Dispositivo, Proyecto } from '../modelo/tipos.js';
import { conductoresEn, dispositivo, opcionesDe } from '../modelo/proyecto.js';
import { ResultadoPotenciales } from './potenciales.js';
import {
	ampacidad, caidaTensionPct, CAIDA_MAX_PCT, factorTemperatura, seccionMinima,
	TEMPERATURA_MAX_PVC_C, TEMPERATURA_TABLA_C,
} from './electrico.js';
import { calcularBalanceTermico } from './termico.js';
import { contactosAuxiliaresIEC, polosDe } from './simulacion.js';

export type Severidad = 'error' | 'aviso';

export interface Hallazgo {
	regla: string;
	severidad: Severidad;
	mensaje: string;
	dispositivoId?: string;
	conductorId?: string;
	potencialId?: string;
}

/** Datos físicos que el DRC no puede deducir del modelo (los aporta quien dibuja). */
export interface ContextoFisico {
	/** Longitud real de cada conductor en mm, por id. Sin ella no se calcula la caída de tensión. */
	longitudesMm?: Map<string, number>;
	/**
	 * Ocupación real de cada canaleta (la calcula el motor de ruteo con la geometría del cable).
	 * Se pasa el DATO, no el texto del aviso: filtrar mensajes por palabras es frágil y ya
	 * coló una vez un aviso que no tenía nada que ver.
	 */
	canaletas?: { canaletaId: string; ocupacion: number; excedida: boolean }[];
	/**
	 * Por qué canaletas pasa cada conductor (id de conductor → ids de canaleta). También del motor
	 * de ruteo. Es lo que permite contar cuántos circuitos van juntos y corregir la intensidad
	 * admisible por agrupamiento: sin esto, la verificación supone un solo circuito, que dentro de
	 * un tablero no pasa nunca.
	 */
	canaletasPorConductor?: Map<string, string[]>;
}

export function verificarProyecto(
	proyecto: Proyecto,
	potenciales: ResultadoPotenciales,
	fisico: ContextoFisico = {},
): Hallazgo[] {
	const hallazgos: Hallazgo[] = [];
	const etiqueta = (id: string) => {
		const d = dispositivo(proyecto, id);
		return d.designacion ?? d.id;
	};
	// Las imágenes de referencia son puramente visuales: no se verifican eléctricamente.
	const aparatos = proyecto.dispositivos.filter((d) => !d.imagen);
	const conductorDe = new Map(proyecto.conductores.map((c) => [c.id, c]));

	// R1 — Designaciones duplicadas.
	const vistas = new Map<string, string>();
	for (const d of aparatos) {
		if (!d.designacion) continue;
		const otro = vistas.get(d.designacion);
		if (otro) {
			hallazgos.push({
				regla: 'R1-designacion-duplicada',
				severidad: 'error',
				mensaje: `Designación duplicada "${d.designacion}" en ${otro} y ${d.id}`,
				dispositivoId: d.id,
			});
		} else {
			vistas.set(d.designacion, d.id);
		}
	}

	// R2 — Bornes obligatorios sin conectar y dispositivos totalmente aislados.
	for (const d of aparatos) {
		let conexiones = 0;
		for (const b of d.bornes) {
			const n = conductoresEn(proyecto, { dispositivoId: d.id, borneId: b.id }).length;
			conexiones += n;
			// La tierra la cubre R11 con su propio mensaje: aquí se ignora para no dar dos
			// hallazgos por el mismo fallo y llenar la lista de duplicados.
			const obligatorio = !!b.obligatorio && b.tipo !== 'PE';
			if (obligatorio && n === 0) {
				hallazgos.push({
					regla: 'R2-borne-sin-conectar',
					severidad: 'error',
					mensaje: `${etiqueta(d.id)}: el borne obligatorio "${b.id}" no tiene conductor`,
					dispositivoId: d.id,
				});
			}
		}
		if (d.bornes.length > 0 && conexiones === 0) {
			hallazgos.push({
				regla: 'R2-dispositivo-aislado',
				severidad: 'aviso',
				mensaje: `${etiqueta(d.id)} no tiene ninguna conexión`,
				dispositivoId: d.id,
			});
		}
	}

	// R3 — Cortocircuito de naturalezas incompatibles en un mismo potencial.
	const incompatibles: ['L' | 'N' | 'PE', 'L' | 'N' | 'PE'][] = [['L', 'N'], ['L', 'PE'], ['N', 'PE']];
	for (const p of potenciales.potenciales) {
		const tipos = new Set(
			p.bornes.map((clave) => {
				const [dispId, borneId] = clave.split('::');
				const b = dispositivo(proyecto, dispId).bornes.find((x) => x.id === borneId);
				return b?.tipo ?? 'otro';
			}),
		);
		for (const [t1, t2] of incompatibles) {
			if (tipos.has(t1) && tipos.has(t2)) {
				hallazgos.push({
					regla: 'R3-cortocircuito',
					severidad: 'error',
					mensaje: `El potencial ${p.id} une bornes ${t1} y ${t2}: posible cortocircuito`,
					potencialId: p.id,
				});
			}
		}
	}

	// R4 — Coherencia maestro/esclavo (referencias cruzadas).
	const ids = new Set(proyecto.dispositivos.map((d) => d.id));
	for (const d of aparatos) {
		if (d.rol?.tipo === 'esclavo') {
			const m = d.rol.maestroId;
			if (!ids.has(m) || dispositivo(proyecto, m).rol?.tipo !== 'maestro') {
				hallazgos.push({
					regla: 'R4-esclavo-sin-maestro',
					severidad: 'error',
					mensaje: `${etiqueta(d.id)} referencia un maestro inexistente ("${m}")`,
					dispositivoId: d.id,
				});
			}
		}
		if (d.rol?.tipo === 'maestro') {
			const esclavos = proyecto.dispositivos.filter(
				(x) => x.rol?.tipo === 'esclavo' && x.rol.maestroId === d.id,
			);
			// Lo que esta regla quiere cazar de verdad es una bobina que NO MANDA NADA. Si el
			// propio aparato lleva sus contactos incorporados —los polos de potencia o los
			// auxiliares— y hay alguno cableado, la bobina sí manda algo y no falta ningún
			// esclavo: avisar ahí sería ruido sobre un tablero perfectamente dibujado.
			const esBobina = (id: string) => /^A[12]$/i.test(id);
			const mandaAlgo = d.bornes.some((b) => !esBobina(b.id)
				&& conductoresEn(proyecto, { dispositivoId: d.id, borneId: b.id }).length > 0);
			if (esclavos.length === 0 && !mandaAlgo) {
				hallazgos.push({
					regla: 'R4-maestro-sin-esclavos',
					severidad: 'aviso',
					mensaje: `${etiqueta(d.id)}: la bobina no manda ningún contacto `
						+ '(ni polos cableados ni contactos enlazados)',
					dispositivoId: d.id,
				});
			}
		}
	}

	// R5 — Exceso de conductores en un borne.
	for (const d of aparatos) {
		for (const b of d.bornes) {
			const n = conductoresEn(proyecto, { dispositivoId: d.id, borneId: b.id }).length;
			const max = b.maxConductores ?? 2;
			if (n > max) {
				hallazgos.push({
					regla: 'R5-exceso-conductores',
					severidad: 'error',
					mensaje: `${etiqueta(d.id)}:${b.id} tiene ${n} conductores (máximo ${max})`,
					dispositivoId: d.id,
				});
			}
		}
	}

	/*
	 * R15 — La sección tiene que CABER en la borna.
	 *
	 * R5 cuenta cuántos hilos entran en un punto, pero no si entran. Un 6 mm² no cabe en una UT 2,5
	 * por mucho que el cálculo pida un 6, y eso se descubre con el tablero montado, el cable
	 * cortado y el cliente esperando. Solo se comprueba donde el aparato declara su límite: no se
	 * supone ninguno.
	 */
	for (const d of aparatos) {
		for (const b of d.bornes) {
			if (!b.seccionMaxMm2) continue;
			for (const c of conductoresEn(proyecto, { dispositivoId: d.id, borneId: b.id })) {
				if (!c.seccion || c.seccion <= b.seccionMaxMm2 + 1e-9) continue;
				hallazgos.push({
					regla: 'R15-seccion-no-cabe',
					severidad: 'error',
					mensaje: `El conductor ${c.numero ?? c.id} es de ${c.seccion} mm² y `
						+ `${etiqueta(d.id)}:${b.id} admite hasta ${b.seccionMaxMm2} mm². `
						+ 'No entra en el tornillo: cambia la borna por una mayor o reparte el circuito.',
					conductorId: c.id,
					dispositivoId: d.id,
				});
			}
		}
	}

	/**
	 * ¿Estas dos tensiones son en realidad el MISMO sistema visto de otra forma? En una red de
	 * 380/220 (o 400/230) el circuito de mando cuelga entre fase y neutro, así que un aparato de
	 * 220 V compartiendo potencial con la acometida de 380 V es lo normal, no un error. La
	 * relación entre ambas es √3.
	 */
	const mismoSistema = (a: number, b: number): boolean => {
		const [menor, mayor] = a < b ? [a, b] : [b, a];
		if (menor <= 0) return false;
		return Math.abs(mayor / menor - Math.sqrt(3)) < 0.06;
	};

	// R6 — Tensiones nominales distintas compartiendo potencial.
	for (const p of potenciales.potenciales) {
		const distintas = p.tensiones.filter((v, i) =>
			p.tensiones.some((w, j) => i !== j && !mismoSistema(v, w) && v !== w));
		if (p.tensiones.length > 1 && distintas.length > 0) {
			hallazgos.push({
				regla: 'R6-conflicto-tension',
				severidad: 'aviso',
				mensaje: `El potencial ${p.id} conecta dispositivos de ${p.tensiones.join(' V y ')} V`,
				potencialId: p.id,
			});
		}
	}

	// R7 — Conductores sin sección definida.
	for (const c of proyecto.conductores) {
		if (c.seccion === undefined) {
			hallazgos.push({
				regla: 'R7-sin-seccion',
				severidad: 'aviso',
				mensaje: `El conductor ${c.numero ?? c.id} no tiene sección definida`,
				conductorId: c.id,
			});
		}
	}

	// (La antigua R8 «sin posición en el esquema» se retiró: desde que el motor de esquema
	// coloca solo a cada aparato en su hoja y su columna, un aparato sin posición guardada ya
	// no es un defecto, y avisar de ello solo generaba ruido que tapaba los errores de verdad.)

	/* ------------------------ Reglas ELÉCTRICAS (la física) ------------------------ */

	/**
	 * ¿Este aparato protege de verdad el conductor contra SOBREINTENSIDAD?
	 *
	 * No basta con que corte. Un seccionador abre en carga pero no dispara nunca solo, y un
	 * diferencial puro (IEC 61008) tampoco: su In es la corriente que aguanta pasando, no un
	 * umbral de disparo —vigila la fuga a tierra, no la sobrecarga—. Tomarlos por protecciones
	 * hacía que el programa exigiera 4 mm² detrás de un diferencial de 25 A que iba seguido de su
	 * automático de 10, o sea, mandaba engordar un cable que ya estaba bien protegido.
	 *
	 * Un diferencial que SÍ declara curva de disparo es un magnetotérmico-diferencial
	 * (IEC 61009, un RCBO): ese protege, y cuenta.
	 */
	const protegeContraSobreintensidad = (d: Dispositivo): boolean =>
		d.tipo === 'disyuntor' || d.tipo === 'guardamotor' || d.tipo === 'fusible'
		|| (d.tipo === 'diferencial' && !!d.curvaDisparo);
	// Para el poder de corte, en cambio, cuentan TODOS los aparatos de corte: un seccionador o un
	// diferencial puro también tienen que aguantar el cortocircuito del sitio donde se instalan,
	// aunque no sean ellos los que lo despejen.
	const ES_APARATO_DE_CORTE = new Set(['disyuntor', 'guardamotor', 'fusible', 'diferencial', 'seccionador']);

	/*
	 * LAS CONDICIONES REALES DEL TABLERO, que son las que mandan sobre la tabla.
	 *
	 * La tabla de intensidades admisibles es a 30 °C y con un solo circuito. Dentro de un armario
	 * nunca se dan las dos cosas: el aire de dentro está más caliente que el de fuera —lo calcula
	 * el balance térmico— y por la canaleta van varios circuitos juntos calentándose entre ellos.
	 * Verificar con la tabla a secas era aprobar sistemáticamente cables que en servicio van muy
	 * por encima de su límite, y en un tablero de cubierta la diferencia llega al 60 %.
	 */
	const balance = calcularBalanceTermico(proyecto);
	const opciones = opcionesDe(proyecto);
	const temperaturaConductores = balance?.temperaturaInteriorC
		?? opciones.temperaturaAmbienteC
		?? TEMPERATURA_TABLA_C;

	/*
	 * QUIÉN PROTEGE a cada conductor: la última protección que se cruza viniendo desde donde
	 * entra la tensión.
	 *
	 * Antes se resolvía mirando si la protección estaba en el mismo potencial, y funcionaba
	 * mientras un circuito entero era un solo potencial. Desde que el número de hilo cambia en
	 * cada aparato, el potencial de la salida del automático llega solo hasta el contactor: el
	 * cable del motor, que es el que de verdad lleva la corriente, se quedaba SIN VERIFICAR.
	 *
	 * Se recorre potencial a potencial, y se pasa de uno a otro únicamente por donde CONDUCE un
	 * aparato: sus polos y sus contactos. Por la bobina de un contactor no se pasa —A1-A2 no está
	 * unido a los polos—, y esa distinción es justo la que hace falta: si se recorriera por
	 * aparatos, el circuito de mando heredaría el calibre del automático de fuerza y el programa
	 * pediría 6 mm² para el hilo de una bobina.
	 *
	 * Un transformador o una fuente CORTAN la cadena: al otro lado hay otra tensión y otra
	 * corriente, y el automático del primario no protege el secundario. El secundario arranca de
	 * nuevo, sin protección, hasta que se cruza la suya.
	 */
	const proteccionDePotencial = new Map<string, { id: string; in: number }>();
	{
		const porId = new Map(aparatos.map((d) => [d.id, d]));
		const potDe = (dispositivoId: string, borneId: string) =>
			potenciales.porBorne.get(`${dispositivoId}::${borneId}`)?.id;
		/** Potenciales que un aparato une por donde pasa corriente, con el aparato que los une. */
		const aristas = new Map<string, { a: string; b: string; por: Dispositivo }[]>();
		const unir = (a: string, b: string, por: Dispositivo) => {
			for (const [x, y] of [[a, b], [b, a]]) {
				if (!aristas.has(x)) aristas.set(x, []);
				aristas.get(x)!.push({ a: x, b: y, por });
			}
		};
		for (const d of aparatos) {
			if (d.tipo === 'transformador' || d.tipo === 'fuente') continue;   // separan galvánicamente
			const pares: [string, string][] = [
				...polosDe(d),
				...contactosAuxiliaresIEC(d).map((c) => [c.comun, c.salida] as [string, string]),
			];
			for (const [x, y] of pares) {
				const px = potDe(d.id, x);
				const py = potDe(d.id, y);
				if (px && py && px !== py) unir(px, py, d);
			}
		}
		// De dónde arranca la corriente: la acometida y el secundario de cada fuente. Los dos
		// empiezan SIN protección conocida; la primera que se cruce es la que manda.
		const arranques: string[] = [];
		for (const d of aparatos) {
			const esAcometida = d.campo && d.bornes.some((b) => b.tipo === 'L')
				&& (d.clase === 'W' || /acometida|red|alimentaci/i.test(d.descripcion ?? ''));
			const esSecundario = d.tipo === 'fuente' || d.tipo === 'transformador';
			if (!esAcometida && !esSecundario) continue;
			for (const b of d.bornes) {
				if (esSecundario && !['S1', 'S2', '+V', '-V'].includes(b.id)) continue;
				const pot = potDe(d.id, b.id);
				if (pot) arranques.push(pot);
			}
		}
		const visto = new Set(arranques);
		const recorrer = (inicio: { pot: string; prot?: { id: string; in: number } }[]): void => {
			const cola = [...inicio];
			while (cola.length) {
				const { pot, prot } = cola.shift()!;
				if (prot) proteccionDePotencial.set(pot, prot);
				for (const arista of aristas.get(pot) ?? []) {
					if (visto.has(arista.b)) continue;
					visto.add(arista.b);
					const d = arista.por;
					const suya = protegeContraSobreintensidad(d) && d.corrienteNominal
						? { id: d.id, in: d.corrienteNominal } : undefined;
					cola.push({ pot: arista.b, prot: suya ?? prot });
				}
			}
		};
		recorrer(arranques.map((pot) => ({ pot })));

		/*
		 * TROZOS SUELTOS: lo que no cuelga de ninguna acometida dibujada.
		 *
		 * Un esquema a medias, o el trozo de un tablero que alguien está estudiando aparte, no
		 * tiene por qué traer la acometida. Ahí no se puede saber qué lado de la protección es la
		 * entrada, así que se le atribuye a los dos —que es lo prudente— y al menos se verifica.
		 * Con la acometida dibujada esto no se usa: el recorrido de arriba ya llegó a todo.
		 */
		for (const d of aparatos) {
			if (!protegeContraSobreintensidad(d) || !d.corrienteNominal) continue;
			const suyos = d.bornes
				.map((b) => potDe(d.id, b.id))
				.filter((pot): pot is string => !!pot && !visto.has(pot));
			if (suyos.length === 0) continue;
			for (const pot of suyos) visto.add(pot);
			recorrer(suyos.map((pot) => ({ pot, prot: { id: d.id, in: d.corrienteNominal! } })));
		}
	}
	const protegeA = (conductorId: string): { id: string; in: number } | undefined => {
		const pot = potenciales.porConductor.get(conductorId);
		return pot ? proteccionDePotencial.get(pot.id) : undefined;
	};

	/*
	 * CUÁNTOS CIRCUITOS comparten canaleta.
	 *
	 * Se cuentan CIRCUITOS, no hilos: las tres fases de un motor son UN circuito, no tres, y por
	 * eso se cuentan las PROTECCIONES distintas que pasan por la canaleta, que es como se cuentan
	 * las salidas de un tablero.
	 *
	 * Un tramo sin protección conocida no suma circuito. Es a propósito: contar cada uno por su
	 * lado daba diecisiete circuitos en un tablero que tiene tres —cada retorno de 0 V contaba
	 * como salida propia— y con eso el programa mandaba poner 16 mm² a un motor de 4 kW. Un
	 * número disparatado no protege a nadie: hace que se deje de mirar la pantalla.
	 */
	const circuitosEnCanaleta = new Map<string, Set<string>>();
	for (const [cid, canaletas] of fisico.canaletasPorConductor ?? []) {
		const circuito = protegeA(cid)?.id;
		if (!circuito) continue;
		for (const can of canaletas) {
			if (!circuitosEnCanaleta.has(can)) circuitosEnCanaleta.set(can, new Set());
			circuitosEnCanaleta.get(can)!.add(circuito);
		}
	}

	/** Circuitos agrupados que ve un conductor: los de la canaleta más llena por la que pasa. */
	const circuitosJuntoA = (cid: string): number => {
		let peor = 1;
		for (const can of fisico.canaletasPorConductor?.get(cid) ?? []) {
			peor = Math.max(peor, circuitosEnCanaleta.get(can)?.size ?? 1);
		}
		return peor;
	};

	// R9b — El PVC tiene un techo. Por encima de 60 °C dentro del armario no hay sección que
	// valga: hay que bajar la temperatura o cambiar de aislación. Se dice UNA vez y no por cada
	// conductor, que serían cincuenta mensajes diciendo lo mismo.
	if (factorTemperatura(temperaturaConductores) <= 0) {
		hallazgos.push({
			regla: 'R9-temperatura-imposible',
			severidad: 'error',
			mensaje: `El armario alcanzaría ${Math.round(temperaturaConductores)} °C dentro, y por `
				+ `encima de ${TEMPERATURA_MAX_PVC_C} °C un conductor de PVC no admite corriente: el `
				+ 'aislante ya trabaja a su límite. Subir la sección NO lo arregla — hay que ventilar o '
				+ 'climatizar el armario, o pasar a aislación XLPE (90 °C).',
		});
	} else {
		// R9 — Coordinación protección ↔ sección. Regla de oro: In ≤ Iz. Si el calibre supera la
		// intensidad admisible del cable, el cable puede arder sin que la protección salte nunca.
		// Se compara por POTENCIAL: los conductores que salen de una protección comparten su nodo.
		/*
		 * LA DERIVACIÓN CORTA (IEC 60364-4-43 §434.2).
		 *
		 * El hilo que va desde la salida del general hasta el fusible del mando NO tiene que
		 * aguantar el calibre del general: aguanta el del fusible que lleva en la punta. La norma
		 * lo permite si el tramo es corto (≤ 3 m) y está protegido contra cortocircuito, que es lo
		 * que comprueba R13. Sin esta excepción el programa mandaba poner 6 mm² en la toma del
		 * circuito de mando, y eso no lo hace nadie ni hay que hacerlo.
		 *
		 * Se exige saber la longitud: si el proyecto no está ruteado, no se exime nada.
		 */
		const LARGO_MAX_DERIVACION_MM = 3000;
		const acabaEnSuPropiaProteccion = (c: Conductor, inArriba: number): boolean => {
			const largo = fisico.longitudesMm?.get(c.id);
			if (largo === undefined || largo > LARGO_MAX_DERIVACION_MM) return false;
			return [c.de.dispositivoId, c.a.dispositivoId].some((id) => {
				const d = proyecto.dispositivos.find((x) => x.id === id);
				return !!d && !d.imagen && protegeContraSobreintensidad(d)
					&& !!d.corrienteNominal && d.corrienteNominal < inArriba;
			});
		};

		for (const c of proyecto.conductores) {
			if (!c.seccion) continue;
			const prot = protegeA(c.id);
			if (!prot) continue;
			if (acabaEnSuPropiaProteccion(c, prot.in)) continue;
			const circuitos = circuitosJuntoA(c.id);
			const iz = ampacidad(c.seccion, circuitos, temperaturaConductores);
			if (prot.in > iz + 1e-9) {
				const minima = seccionMinima(prot.in, circuitos, temperaturaConductores);
				const condiciones = `${Math.round(temperaturaConductores)} °C dentro del armario`
					+ (circuitos > 1 ? ` y ${circuitos} circuitos en la canaleta` : ', sin agrupar');
				hallazgos.push({
					regla: 'R9-proteccion-sobredimensionada',
					severidad: 'error',
					mensaje: `${etiqueta(prot.id)} es de ${prot.in} A pero el conductor `
						+ `${c.numero ?? c.id} es de ${c.seccion} mm² y ahí admite ${iz.toFixed(1)} A `
						+ `(${condiciones}). `
						+ (minima
							? `Sube el conductor a ${minima} mm² o baja la protección.`
							: 'Ninguna sección de la tabla aguanta ese calibre en estas condiciones: '
								+ 'baja la protección, reparte los circuitos en otra canaleta o ventila el armario.'),
					conductorId: c.id,
					dispositivoId: prot.id,
					potencialId: potenciales.porConductor.get(c.id)?.id,
				});
			}
		}
	}

	/*
	 * R16 — La TIERRA no puede ser más fina que la fase del aparato que protege.
	 *
	 * IEC 60364-5-54: hasta 16 mm² de cobre el conductor de protección va de la misma sección que
	 * la fase. Es un error que se comete queriendo ahorrar cable y que no se paga hasta que hay
	 * una falta a tierra y la protección no despeja a tiempo.
	 *
	 * Se compara dentro del aparato y solo si todas sus fases son del mismo circuito: en un
	 * bornero o en la acometida se juntan varios y ahí la comparación no dice nada.
	 *
	 * DEL NEUTRO NO HAY REGLA, y no es un olvido. La norma habla del neutro DEL CIRCUITO —el que
	 * lleva la corriente de la carga—, y en un tablero el mismo automático alimenta la fuerza de
	 * un motor por 2,5 mm² y el retorno de una bobina por 1,5: los dos cuelgan de la misma
	 * protección y el segundo lleva veinte miliamperios. Distinguirlos automáticamente no se puede
	 * sin más datos, y una regla que marca en rojo un tablero bien hecho hace que se deje de mirar
	 * la pantalla. Antes de ponerla hay que poder decir qué conductor es «el neutro del circuito».
	 */
	for (const d of aparatos) {
		if (d.tipo === 'bornero') continue;
		const fases = d.bornes
			.filter((b) => b.tipo === 'L')
			.flatMap((b) => conductoresEn(proyecto, { dispositivoId: d.id, borneId: b.id }));
		if (fases.length === 0) continue;
		const circuitos = new Set(fases.map((c) => protegeA(c.id)?.id ?? '—'));
		if (circuitos.size !== 1) continue;   // aquí se juntan varios circuitos: no se compara
		const mayorFase = Math.max(...fases.map((c) => c.seccion ?? 0));
		if (mayorFase <= 0 || mayorFase > 16) continue;
		for (const b of d.bornes) {
			if (b.tipo !== 'PE') continue;
			for (const c of conductoresEn(proyecto, { dispositivoId: d.id, borneId: b.id })) {
				if (!c.seccion || c.seccion >= mayorFase - 1e-9) continue;
				hallazgos.push({
					regla: 'R16-tierra-mas-fina-que-la-fase',
					severidad: 'error',
					mensaje: `En ${etiqueta(d.id)}, la tierra ${c.numero ?? c.id} es de ${c.seccion} mm² `
						+ `y su fase es de ${mayorFase} mm². Hasta 16 mm² van iguales `
						+ `(IEC 60364-5-54): súbela a ${mayorFase} mm².`,
					conductorId: c.id,
					dispositivoId: d.id,
				});
			}
		}
	}

	// R10 — Caída de tensión. Solo se puede calcular si quien dibuja aporta las longitudes
	// reales; sin ellas no se inventa un número (más vale callar que mentir en un cálculo).
	if (fisico.longitudesMm?.size) {
		for (const c of proyecto.conductores) {
			const largoMm = fisico.longitudesMm.get(c.id);
			if (!c.seccion || !largoMm) continue;
			// Corriente e información de fases: de la protección o del consumo del potencial.
			const pot = potenciales.porConductor.get(c.id);
			let corriente = 0;
			let tension = 0;
			let trifasico = false;
			for (const clave of pot?.bornes ?? []) {
				const d = proyecto.dispositivos.find((x) => x.id === clave.split('::')[0]);
				if (!d || d.imagen) continue;
				if (d.corrienteNominal && d.corrienteNominal > corriente) corriente = d.corrienteNominal;
				if (d.tensionNominal && d.tensionNominal > tension) tension = d.tensionNominal;
				if ((d.polos ?? 0) >= 3) trifasico = true;
			}
			if (!corriente || !tension) continue;
			const pct = caidaTensionPct({
				corrienteA: corriente, longitudM: largoMm / 1000, seccionMm2: c.seccion, tensionV: tension, trifasico,
			});
			const limite = tension <= 60 ? CAIDA_MAX_PCT.control : CAIDA_MAX_PCT.fuerza;
			if (pct > limite) {
				hallazgos.push({
					regla: 'R10-caida-tension',
					severidad: 'aviso',
					mensaje: `El conductor ${c.numero ?? c.id} cae ${pct.toFixed(1)} % `
						+ `(${corriente} A · ${(largoMm / 1000).toFixed(1)} m · ${c.seccion} mm²), `
						+ `por encima del ${limite} % admisible. Sube la sección.`,
					conductorId: c.id,
				});
			}
		}
	}

	// R11 — Puesta a tierra. Un borne PE sin conductor no es un descuido menor: es la
	// protección de las personas. Nunca es opcional, tenga o no la marca de obligatorio.
	for (const d of aparatos) {
		for (const b of d.bornes) {
			if (b.tipo !== 'PE') continue;
			if (conductoresEn(proyecto, { dispositivoId: d.id, borneId: b.id }).length === 0) {
				hallazgos.push({
					regla: 'R11-sin-tierra',
					severidad: 'error',
					mensaje: `${etiqueta(d.id)}: el borne de tierra "${b.id}" está sin conectar`,
					dispositivoId: d.id,
				});
			}
		}
	}

	// R12 — Llenado de canaletas. Una canaleta demasiado llena no cierra la tapa y calienta los
	// conductores; es de las primeras cosas que mira un inspector.
	for (const c of fisico.canaletas ?? []) {
		if (!c.excedida) continue;
		hallazgos.push({
			regla: 'R12-canaleta-llena',
			severidad: 'aviso',
			mensaje: `La canaleta ${c.canaletaId} va al ${Math.round(c.ocupacion * 100)} % del llenado `
				+ 'recomendado: usa una más ancha o reparte los conductores.',
		});
	}

	// R13 — Poder de corte contra la corriente de cortocircuito presunta.
	//
	// Es la comprobación que más pesa de todas: un automático cuyo poder de corte (Icu/Icn) no
	// llega a la Icc del punto donde está instalado NO interrumpe la falta, se destruye — con
	// arco, proyección de material y el circuito sin cortar. Un inspector lo mira antes que
	// nada, y ninguna otra regla de este motor sustituye a esta.
	// La Icc presunta es la de la ACOMETIDA. Un fusible del circuito de mando, detrás de un
	// transformador o de una fuente, no ve ni de lejos esa corriente: compararlo contra ella
	// daría una alarma falsa, y una alarma falsa es lo que hace que se dejen de mirar todas.
	// Se comprueban por tanto las protecciones que trabajan a la tensión más alta del tablero,
	// que son las que están del lado de la red.
	const icc = opcionesDe(proyecto).iccPresuntaKA;
	const tensiones = aparatos.map((d) => d.tensionNominal ?? 0);
	const tensionMaxima = tensiones.length ? Math.max(...tensiones) : 0;
	// Con holgura: 380, 400 y 415 V son la misma red y tienen que contar todas como lado de red.
	// Lo que se quiere dejar fuera es el salto de verdad (400 → 24 V), no el redondeo del catálogo.
	const umbralRed = tensionMaxima * 0.8;
	const protecciones = aparatos.filter((d) => ES_APARATO_DE_CORTE.has(d.tipo)
		&& (d.tensionNominal === undefined || d.tensionNominal >= umbralRed));
	if (icc > 0) {
		for (const d of protecciones) {
			if (d.poderCorteKA === undefined) {
				hallazgos.push({
					regla: 'R13-sin-poder-de-corte',
					severidad: 'aviso',
					mensaje: `${etiqueta(d.id)}: falta el poder de corte (Icu/Icn). Sin él no se puede `
						+ `comprobar que aguante los ${icc} kA de la acometida.`,
					dispositivoId: d.id,
				});
			} else if (d.poderCorteKA < icc) {
				// Si el Icu es el típico de la familia y no el de la hoja de datos, se dice. Se
				// rechaza igual —el valor de familia no suele errar del lado peligroso— pero quien
				// firma tiene que saber que el número que tumba su aparato no lo ha confirmado nadie.
				const origen = d.poderCorteEstimado
					? ' Ojo: ese poder de corte es el habitual de la familia, no el de la hoja de datos'
						+ ' de este aparato; confírmalo antes de cambiar de referencia.'
					: '';
				hallazgos.push({
					regla: 'R13-poder-de-corte-insuficiente',
					severidad: 'error',
					mensaje: `${etiqueta(d.id)}: poder de corte ${d.poderCorteKA} kA frente a `
						+ `${icc} kA presuntos. No cortaría la falta: hace falta un aparato de más `
						+ `poder de corte o una protección aguas arriba que lo respalde.${origen}`,
					dispositivoId: d.id,
				});
			}
		}
	} else if (protecciones.length > 0) {
		hallazgos.push({
			regla: 'R13-icc-sin-declarar',
			severidad: 'aviso',
			mensaje: 'Falta la corriente de cortocircuito presunta de la acometida (Archivo → Datos '
				+ 'del proyecto). Sin ella no se puede verificar el poder de corte de las protecciones.',
		});
	}

	// R14 — Calentamiento del armario. Un tablero que se pasa de temperatura dispara antes de
	// tiempo, limita los variadores y envejece la electrónica. Sale como AVISO y no como error
	// porque es una estimación de proyecto (IEC 60890), no un ensayo: la decisión de poner
	// rejilla, ventilador o climatizador es del proyectista, pero tiene que verla aquí.
	if (balance && (balance.veredicto === 'ventilacion' || balance.veredicto === 'climatizacion')) {
		const afinable = balance.fraccionDeclarada < 0.5
			? ' La mayor parte de la disipación es estimada: declara la de catálogo en la ficha de cada aparato para afinar el cálculo.'
			: '';
		hallazgos.push({
			regla: 'R14-calentamiento',
			severidad: 'aviso',
			mensaje: `El armario alcanzaría unos ${balance.temperaturaInteriorC} °C dentro `
				+ `(${balance.disipacionW} W sobre ${balance.superficieM2.toFixed(2)} m² con `
				+ `${balance.temperaturaAmbienteC} °C de ambiente). ${balance.recomendacion}${afinable}`,
		});
	}

	/*
	 * R17 — SELECTIVIDAD entre dos protecciones en serie.
	 *
	 * El caso de siempre: salta un magnetotérmico de un circuito y se va también el general, así
	 * que se queda a oscuras medio tablero por una avería que era de un solo aparato. Eso pasa
	 * cuando las dos protecciones son demasiado parecidas y no hay quién decida cuál actúa antes.
	 *
	 * Se buscan pares DIRECTOS: la salida de una da al mismo potencial que la entrada de la otra.
	 * Es lo que se puede afirmar con lo que hay dibujado, y además es donde vive el problema.
	 *
	 * QUÉ SE COMPRUEBA Y QUÉ NO. Se comprueba la selectividad en SOBRECARGA, que es la que sale de
	 * los calibres: la de arriba tiene que ser bastante mayor que la de abajo para que la de abajo
	 * llegue antes a su curva térmica. Con menos de 1,6 veces no hay nada que hacer, y esa cifra
	 * es la práctica corriente de fabricante.
	 *
	 * La selectividad en CORTOCIRCUITO no sale de aquí y el aviso lo dice: depende de las curvas
	 * reales y de las tablas de pareja del fabricante, que son datos que este programa no tiene.
	 * Callarlo sería peor que no comprobar nada, porque quien lo lea daría por sentado que su
	 * tablero es selectivo cuando solo se ha mirado la mitad del asunto.
	 */
	const RAZON_SELECTIVA = 1.6;
	const deCorte = aparatos.filter((d) => ES_APARATO_DE_CORTE.has(d.tipo) && d.tipo !== 'seccionador');

	/*
	 * Cuál es la ENTRADA de cada protección y cuál la salida.
	 *
	 * No basta con que dos protecciones compartan un potencial: dos automáticos colgados del mismo
	 * general también lo comparten —su entrada— y esos no van en serie, van en paralelo, que es un
	 * tablero perfectamente normal. Lo que distingue una cosa de la otra es por dónde entra la
	 * corriente, y eso se sabe caminando desde la acometida: se va de la fuente hacia fuera y el
	 * primer potencial por el que se llega a una protección es su entrada.
	 */
	const potencialesDe = (d: Dispositivo): string[] => [...new Set(d.bornes
		.map((b) => potenciales.porBorne.get(`${d.id}::${b.id}`)?.id)
		.filter((x): x is string => !!x))];
	const nivel = new Map<string, number>();
	{
		const cola: string[] = [];
		for (const d of aparatos) {
			if (d.tipo !== 'fuente' && d.tipo !== 'transformador') continue;
			for (const pid of potencialesDe(d)) {
				if (nivel.has(pid)) continue;
				nivel.set(pid, 0);
				cola.push(pid);
			}
		}
		// Cada protección es un paso: lleva la corriente de sus potenciales de entrada a los demás.
		for (let i = 0; i < cola.length; i++) {
			const pid = cola[i];
			const n = nivel.get(pid)!;
			for (const d of deCorte) {
				const suyos = potencialesDe(d);
				if (!suyos.includes(pid)) continue;
				for (const otro of suyos) {
					if (nivel.has(otro)) continue;
					nivel.set(otro, n + 1);
					cola.push(otro);
				}
			}
		}
	}
	/** El potencial por el que le entra la corriente: el más cercano a la acometida. */
	const entradaDe = (d: Dispositivo): string | undefined => {
		let mejor: string | undefined;
		let menor = Infinity;
		for (const pid of potencialesDe(d)) {
			const n = nivel.get(pid);
			if (n !== undefined && n < menor) { menor = n; mejor = pid; }
		}
		return mejor;
	};

	for (const arriba of deCorte) {
		const inArriba = arriba.corrienteNominal;
		if (!inArriba) continue;
		const entradaArriba = entradaDe(arriba);
		// Sus salidas son todos sus potenciales menos aquel por el que le entra la corriente.
		const salidas = new Set(potencialesDe(arriba).filter((pid) => pid !== entradaArriba));
		for (const abajo of deCorte) {
			if (abajo.id === arriba.id) continue;
			const inAbajo = abajo.corrienteNominal;
			if (!inAbajo) continue;
			// En serie de verdad: lo que sale de la de arriba es lo que entra en la de abajo.
			const entradaAbajo = entradaDe(abajo);
			if (!entradaAbajo || !salidas.has(entradaAbajo)) continue;
			// El de más calibre es el de aguas arriba: se mira cada pareja una sola vez.
			if (inArriba < inAbajo || (inArriba === inAbajo && arriba.id > abajo.id)) continue;

			if (inArriba === inAbajo) {
				hallazgos.push({
					regla: 'R17-sin-selectividad',
					severidad: 'error',
					mensaje: `${etiqueta(arriba.id)} y ${etiqueta(abajo.id)} van en serie y los dos son `
						+ `de ${inArriba} A. Ante una falta en el circuito de abajo saltarán los dos, y `
						+ `se quedará sin tensión todo lo que cuelgue del de arriba. Sube el de cabecera `
						+ `a ${Math.ceil(inAbajo * RAZON_SELECTIVA)} A o más.`,
					dispositivoId: arriba.id,
				});
			} else if (inArriba < inAbajo * RAZON_SELECTIVA) {
				hallazgos.push({
					regla: 'R17-selectividad-justa',
					severidad: 'aviso',
					mensaje: `${etiqueta(arriba.id)} (${inArriba} A) va justo por encima de `
						+ `${etiqueta(abajo.id)} (${inAbajo} A): con menos de ${RAZON_SELECTIVA} veces no hay `
						+ `selectividad en sobrecarga y pueden saltar los dos. Con `
						+ `${Math.ceil(inAbajo * RAZON_SELECTIVA)} A arriba se resuelve. `
						+ `(En cortocircuito la selectividad depende de la tabla de pareja del `
						+ `fabricante, que este programa no tiene: confírmala con su catálogo.)`,
					dispositivoId: arriba.id,
				});
			}
		}
	}

	const orden: Severidad[] = ['error', 'aviso'];
	return hallazgos.sort(
		(a, b) => orden.indexOf(a.severidad) - orden.indexOf(b.severidad) || a.regla.localeCompare(b.regla),
	);
}
