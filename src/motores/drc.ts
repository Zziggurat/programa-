/**
 * Motor DRC (Design Rule Check): detección automática de errores eléctricos.
 *
 * QElectroTech no tiene nada equivalente; estas reglas operan sobre el modelo puro
 * y el resultado del motor de potenciales.
 */
import { Proyecto } from '../modelo/tipos.js';
import { conductoresEn, dispositivo } from '../modelo/proyecto.js';
import { ResultadoPotenciales } from './potenciales.js';

export type Severidad = 'error' | 'aviso';

export interface Hallazgo {
	regla: string;
	severidad: Severidad;
	mensaje: string;
	dispositivoId?: string;
	conductorId?: string;
	potencialId?: string;
}

export function verificarProyecto(
	proyecto: Proyecto,
	potenciales: ResultadoPotenciales,
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
			const obligatorio = b.obligatorio ?? b.tipo === 'PE';
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
			if (esclavos.length === 0) {
				hallazgos.push({
					regla: 'R4-maestro-sin-esclavos',
					severidad: 'aviso',
					mensaje: `${etiqueta(d.id)} es maestro pero no tiene contactos enlazados`,
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

	// R6 — Tensiones nominales distintas compartiendo potencial.
	for (const p of potenciales.potenciales) {
		if (p.tensiones.length > 1) {
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

	// R8 — Dispositivos sin posición en el esquema.
	for (const d of aparatos) {
		if (!d.hojaId || !d.posicion) {
			hallazgos.push({
				regla: 'R8-sin-posicion',
				severidad: 'aviso',
				mensaje: `${etiqueta(d.id)} no está dibujado en ninguna hoja`,
				dispositivoId: d.id,
			});
		}
	}

	const orden: Severidad[] = ['error', 'aviso'];
	return hallazgos.sort(
		(a, b) => orden.indexOf(a.severidad) - orden.indexOf(b.severidad) || a.regla.localeCompare(b.regla),
	);
}
