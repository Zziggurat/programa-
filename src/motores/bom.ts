/**
 * Proyección única de materiales desde las instancias persistentes del Proyecto.
 * Las representaciones de esquema, colocaciones 3D, imágenes y estados runtime no son aparatos.
 *
 * Una referencia comercial completa, una revisión propia o un producto técnico congelado
 * permiten agrupar. Si falta esa identidad no se presume que dos descripciones iguales sean
 * el mismo artículo: se conservan como partidas separadas.
 */
import type { Dispositivo, Proyecto, TipoDispositivo } from '../modelo/tipos.js';

export interface GrupoBomCanonico {
	/** Clave interna estructurada; nunca se usa como número de pedido. */
	clave: string;
	tipo: TipoDispositivo;
	descripcion: string;
	fabricante?: string;
	referencia?: string;
	perfil?: string;
	modeloFisico?: string[];
	cantidad: number;
	designaciones: string[];
}

const comparar = (a: string, b: string) => a.localeCompare(b);

function variantePerfil(d: Dispositivo): readonly unknown[] | null {
	const perfil = d.comportamiento;
	if (!perfil) return null;
	switch (perfil.clase) {
		case 'proteccion': return [perfil.clase, perfil.funcion, perfil.rearmable, perfil.polos.length];
		case 'mando': return [perfil.clase, perfil.modo, perfil.posiciones];
		case 'carga': return [perfil.clase, perfil.efecto, perfil.alimentacion.fasesMinimas];
		case 'sensor': return [perfil.clase, perfil.salidaDigital !== undefined,
			perfil.transmisor !== undefined];
		case 'contactos-electromagneticos': return [perfil.clase, perfil.polos.length, perfil.contactos.length];
		default: return [perfil.clase];
	}
}

/** Solo magnitudes declaradas como características del equipo; no bornes, consignas ni impedancias del circuito. */
function varianteProducto(d: Dispositivo): readonly unknown[] {
	const f = d.fisica;
	return [
		d.tipo, d.fabricante?.trim() ?? '', d.referencia?.trim() ?? '', variantePerfil(d),
		[d.tensionNominal, d.corrienteNominal, d.polos, d.tensionSecundariaV,
			d.poderCorteKA, d.curvaDisparo, d.sensibilidadMA, d.claseDiferencial,
			d.rangoRegulacionA, d.colorSenal],
		f?.fuente ? [f.fuente.sistema, f.fuente.tensionNominalV, f.fuente.frecuenciaHz] : null,
		f?.carga ? [f.carga.modelo, f.carga.trifasica, f.carga.pW, f.carga.qVar,
			f.carga.corrienteA, f.carga.rOhm, f.carga.xOhm] : null,
		f?.transformador ? [f.transformador.primarioV, f.transformador.secundarioV,
			f.transformador.potenciaVA, f.transformador.frecuenciaHz] : null,
		f?.proteccion ? [f.proteccion.inA, f.proteccion.curva,
			f.proteccion.capacidadCorte?.icnKA, f.proteccion.capacidadCorte?.icuKA,
			f.proteccion.capacidadCorte?.icsKA] : null,
		f?.diferencial ? [f.diferencial.corrienteResidualNominalA] : null,
		f?.motor ? [f.motor.potenciaMecanicaNominalW, f.motor.tensionNominalV,
			f.motor.frecuenciaHz, f.motor.fases, f.motor.corrienteNominalA,
			f.motor.rpmNominal, f.motor.polos] : null,
		f?.vfd ? [f.vfd.tensionEntradaNominalV, f.vfd.fasesEntrada, f.vfd.potenciaNominalW,
			f.vfd.frecuenciaBaseHz, f.vfd.frecuenciaMaxHz, f.vfd.tensionSalidaMaxV,
			f.vfd.corrienteNominalA] : null,
	];
}

function referenciasTecnicas(proyecto: Proyecto): Map<string, string[]> {
	const porDispositivo = new Map<string, string[]>();
	for (const vinculo of proyecto.datosTecnicos?.vinculos ?? []) {
		if (vinculo.entidad !== 'DEVICE' || vinculo.producto.tipo !== 'PRODUCTO') continue;
		const r = vinculo.producto;
		const clave = JSON.stringify([r.catalogoId, r.id, r.revision, r.hash]);
		const lista = porDispositivo.get(vinculo.entidadId) ?? [];
		lista.push(clave);
		porDispositivo.set(vinculo.entidadId, lista);
	}
	for (const [id, referencias] of porDispositivo) {
		porDispositivo.set(id, [...new Set(referencias)].sort(comparar));
	}
	return porDispositivo;
}

function identidad(d: Dispositivo, referencias: readonly string[]): readonly unknown[] {
	const propio = d.componentePersonalizado;
	if (propio) return ['PROPIO', propio.definicionId, propio.revision, referencias];
	// Marca sola, referencia sola y descripción nunca son identidad de compra suficiente.
	if (d.fabricante?.trim() && d.referencia?.trim()) {
		return ['COMERCIAL', d.fabricante.trim(), d.referencia.trim(), referencias];
	}
	if (referencias.length) return ['PRODUCTO_TECNICO', referencias];
	return ['INSTANCIA_SIN_IDENTIDAD', d.id];
}

export function proyectarBomCanonica(proyecto: Proyecto): GrupoBomCanonico[] {
	const tecnicas = referenciasTecnicas(proyecto);
	const grupos = new Map<string, GrupoBomCanonico>();
	for (const d of [...proyecto.dispositivos].sort((a, b) => comparar(a.id, b.id))) {
		if (d.tipo === 'cable') continue;
		const clave = JSON.stringify([identidad(d, tecnicas.get(d.id) ?? []), varianteProducto(d)]);
		const existente = grupos.get(clave);
		if (existente) {
			existente.cantidad++;
			existente.designaciones.push(d.designacion ?? d.id);
			if (d.descripcion && (!existente.descripcion || comparar(d.descripcion, existente.descripcion) < 0)) {
				existente.descripcion = d.descripcion;
			}
			if (d.fisica) existente.modeloFisico = [...new Set([
				...(existente.modeloFisico ?? []), ...Object.entries(d.fisica)
					.filter(([k, v]) => k !== 'version' && v !== undefined).map(([k]) => k),
			])].sort(comparar);
			continue;
		}
		const modeloFisico = d.fisica
			? Object.entries(d.fisica).filter(([k, v]) => k !== 'version' && v !== undefined)
				.map(([k]) => k).sort(comparar) : [];
		grupos.set(clave, {
			clave, tipo: d.tipo, descripcion: d.descripcion ?? '',
			...(d.fabricante ? { fabricante: d.fabricante } : {}),
			...(d.referencia ? { referencia: d.referencia } : {}),
			...(d.comportamiento?.clase ? { perfil: d.comportamiento.clase } : {}),
			...(modeloFisico.length ? { modeloFisico } : {}),
			cantidad: 1, designaciones: [d.designacion ?? d.id],
		});
	}
	return [...grupos.values()].map((grupo) => ({
		...grupo, designaciones: grupo.designaciones.sort(comparar),
	})).sort((a, b) => comparar(a.tipo, b.tipo)
		|| comparar(a.fabricante ?? '', b.fabricante ?? '')
		|| comparar(a.referencia ?? '', b.referencia ?? '')
		|| comparar(a.descripcion, b.descripcion) || comparar(a.clave, b.clave));
}
