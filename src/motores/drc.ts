/**
 * Motor DRC (Design Rule Check): detección automática de errores eléctricos.
 *
 * QElectroTech no tiene nada equivalente; estas reglas operan sobre el modelo puro
 * y el resultado del motor de potenciales.
 */
import { Proyecto } from '../modelo/tipos.js';
import { conductoresEn, dispositivo } from '../modelo/proyecto.js';
import { ResultadoPotenciales } from './potenciales.js';
import { ampacidad, caidaTensionPct, CAIDA_MAX_PCT, seccionMinima } from './electrico.js';

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

	// Protecciones del proyecto con su calibre. Es lo que permite comprobar de verdad si un
	// conductor está protegido, que es la diferencia entre un dibujo bonito y un tablero seguro.
	const ES_PROTECCION = new Set(['disyuntor', 'guardamotor', 'fusible', 'diferencial', 'seccionador']);
	const conductorDe = new Map(proyecto.conductores.map((c) => [c.id, c]));

	// R9 — Coordinación protección ↔ sección. Regla de oro: In ≤ Iz. Si el calibre supera la
	// intensidad admisible del cable, el cable puede arder sin que la protección salte nunca.
	// Se compara por POTENCIAL: los conductores que salen de una protección comparten su nodo.
	for (const p of potenciales.potenciales) {
		let mayorIn = 0;
		let proteccion: string | undefined;
		for (const clave of p.bornes) {
			const d = proyecto.dispositivos.find((x) => x.id === clave.split('::')[0]);
			if (!d || d.imagen || !ES_PROTECCION.has(d.tipo) || !d.corrienteNominal) continue;
			if (d.corrienteNominal > mayorIn) { mayorIn = d.corrienteNominal; proteccion = d.id; }
		}
		if (!mayorIn || !proteccion) continue;
		for (const cid of p.conductores) {
			const c = conductorDe.get(cid);
			if (!c?.seccion) continue;
			const iz = ampacidad(c.seccion);
			if (mayorIn > iz + 1e-9) {
				const minima = seccionMinima(mayorIn);
				hallazgos.push({
					regla: 'R9-proteccion-sobredimensionada',
					severidad: 'error',
					mensaje: `${etiqueta(proteccion)} es de ${mayorIn} A pero el conductor `
						+ `${c.numero ?? c.id} es de ${c.seccion} mm² (admite ${iz} A). `
						+ `Sube el conductor a ${minima ?? '—'} mm² o baja la protección.`,
					conductorId: c.id,
					dispositivoId: proteccion,
					potencialId: p.id,
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

	const orden: Severidad[] = ['error', 'aviso'];
	return hallazgos.sort(
		(a, b) => orden.indexOf(a.severidad) - orden.indexOf(b.severidad) || a.regla.localeCompare(b.regla),
	);
}
