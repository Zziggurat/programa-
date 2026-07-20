/**
 * Motor de numeración automática.
 *
 * - Dispositivos: designaciones IEC 81346 (=función +ubicación -clase número) mediante una
 *   plantilla configurable, con secuencias independientes por (función, ubicación, clase)
 *   y soporte de "congelado" (idea tomada de freezeLabel de QElectroTech).
 * - Conductores: un número por potencial (no por tramo dibujado), con etiquetas fijas para
 *   PE y N y secuencia para el resto.
 */
import { CLASE_POR_TIPO, Dispositivo, LetraClase, Proyecto } from '../modelo/tipos.js';
import { opcionesDe } from '../modelo/proyecto.js';
import { ResultadoPotenciales } from './potenciales.js';

export function claseDe(d: Dispositivo): LetraClase {
	return d.clase ?? CLASE_POR_TIPO[d.tipo];
}

/**
 * Aplica la plantilla de designación. Los bloques entre corchetes se omiten cuando su
 * variable está vacía: "[={funcion}][+{ubicacion}]-{clase}{n}" → "-K1" si no hay
 * función ni ubicación, "=ALIM+TAB1-K1" si las hay.
 */
export function aplicarPlantilla(
	plantilla: string,
	vars: { funcion?: string; ubicacion?: string; clase: string; n: number },
): string {
	const valores: Record<string, string> = {
		funcion: vars.funcion ?? '',
		ubicacion: vars.ubicacion ?? '',
		clase: vars.clase,
		n: String(vars.n),
	};
	// Bloques opcionales [ ... ]
	let salida = plantilla.replace(/\[([^\]]*)\]/g, (_, bloque: string) => {
		let vacio = false;
		const texto = bloque.replace(/\{(\w+)\}/g, (_m: string, v: string) => {
			const valor = valores[v] ?? '';
			if (valor === '') vacio = true;
			return valor;
		});
		return vacio ? '' : texto;
	});
	salida = salida.replace(/\{(\w+)\}/g, (_m, v: string) => valores[v] ?? '');
	return salida;
}

/**
 * Asigna numero y designacion a todos los dispositivos no congelados, con una secuencia
 * por combinación función/ubicación/clase. Devuelve el proyecto mutado (misma referencia).
 */
export function numerarDispositivos(proyecto: Proyecto): Proyecto {
	const plantilla = opcionesDe(proyecto).formatoDesignacion;
	const secuencias = new Map<string, number>();

	const claveSec = (d: Dispositivo) => `${d.funcion ?? ''}|${d.ubicacion ?? ''}|${claseDe(d)}`;

	// Primero reservar los números de los congelados para no duplicarlos.
	for (const d of proyecto.dispositivos) {
		if (d.congelado && d.numero !== undefined) {
			const k = claveSec(d);
			secuencias.set(k, Math.max(secuencias.get(k) ?? 0, d.numero));
		}
	}

	for (const d of proyecto.dispositivos) {
		if (d.congelado) continue;
		const k = claveSec(d);
		const n = (secuencias.get(k) ?? 0) + 1;
		secuencias.set(k, n);
		d.numero = n;
		d.designacion = aplicarPlantilla(plantilla, {
			funcion: d.funcion,
			ubicacion: d.ubicacion,
			clase: claseDe(d),
			n,
		});
	}
	return proyecto;
}

/**
 * Numera los conductores por potencial: todos los tramos de un mismo potencial reciben
 * el mismo número (así se rotulan los puentes y derivaciones de forma coherente).
 * PE → "PE", N → "N"; el resto recibe la secuencia 1, 2, 3… (configurable).
 */
export function numerarConductores(
	proyecto: Proyecto,
	potenciales: ResultadoPotenciales,
): Proyecto {
	let siguiente = opcionesDe(proyecto).inicioNumeracionConductores;
	const numeroDePotencial = new Map<string, string>();

	for (const p of potenciales.potenciales) {
		if (p.conductores.length === 0) continue;
		// Respetar números congelados ya presentes en el potencial.
		const congelado = proyecto.conductores.find(
			(c) => c.congelado && c.numero && potenciales.porConductor.get(c.id) === p,
		);
		let numero: string;
		if (congelado?.numero) {
			numero = congelado.numero;
		} else if (p.tipo === 'PE') {
			numero = 'PE';
		} else if (p.tipo === 'N') {
			numero = 'N';
		} else {
			numero = String(siguiente);
			siguiente += 1;
		}
		numeroDePotencial.set(p.id, numero);
	}

	for (const c of proyecto.conductores) {
		if (c.congelado) continue;
		const p = potenciales.porConductor.get(c.id);
		if (p) c.numero = numeroDePotencial.get(p.id);
	}
	return proyecto;
}
