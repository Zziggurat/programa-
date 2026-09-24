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
	/** Motivo legible de la partida; procede de los mismos nominales que forman su clave. */
	varianteDeclarada: string;
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
type CampoVariante = readonly [etiqueta: string, valor: unknown, unidad?: string];

function camposVariante(d: Dispositivo): { placa: CampoVariante[]; fisica: (CampoVariante[] | null)[] } {
	const f = d.fisica;
	return {
		placa: [
			['Tensión nominal', d.tensionNominal, 'V'], ['Corriente nominal', d.corrienteNominal, 'A'],
			['Polos', d.polos], ['Tensión secundaria', d.tensionSecundariaV, 'V'],
			['Poder de corte', d.poderCorteKA, 'kA'], ['Curva', d.curvaDisparo],
			['Sensibilidad', d.sensibilidadMA, 'mA'], ['Clase diferencial', d.claseDiferencial],
			['Regulación', d.rangoRegulacionA, 'A'], ['Color señal', d.colorSenal],
		],
		fisica: [
			f?.fuente ? [['Sistema fuente', f.fuente.sistema], ['Tensión fuente', f.fuente.tensionNominalV, 'V'], ['Frecuencia fuente', f.fuente.frecuenciaHz, 'Hz']] : null,
			f?.carga ? [['Modelo carga', f.carga.modelo], ['Trifásica', f.carga.trifasica], ['P carga', f.carga.pW, 'W'], ['Q carga', f.carga.qVar, 'var'],
				['I carga', f.carga.corrienteA, 'A'], ['R carga', f.carga.rOhm, 'Ω'], ['X carga', f.carga.xOhm, 'Ω']] : null,
			f?.transformador ? [['Primario', f.transformador.primarioV, 'V'], ['Secundario', f.transformador.secundarioV, 'V'],
				['Potencia transformador', f.transformador.potenciaVA, 'VA'], ['Frecuencia transformador', f.transformador.frecuenciaHz, 'Hz']] : null,
			f?.proteccion ? [['In protección', f.proteccion.inA, 'A'], ['Curva protección', f.proteccion.curva],
				['Icn', f.proteccion.capacidadCorte?.icnKA, 'kA'], ['Icu', f.proteccion.capacidadCorte?.icuKA, 'kA'],
				['Ics', f.proteccion.capacidadCorte?.icsKA, 'kA']] : null,
			f?.diferencial ? [['IΔn', f.diferencial.corrienteResidualNominalA, 'A']] : null,
			f?.motor ? [['Potencia motor', f.motor.potenciaMecanicaNominalW, 'W'], ['Tensión motor', f.motor.tensionNominalV, 'V'],
				['Frecuencia motor', f.motor.frecuenciaHz, 'Hz'], ['Fases motor', f.motor.fases],
				['I motor', f.motor.corrienteNominalA, 'A'], ['Velocidad motor', f.motor.rpmNominal, 'rpm'], ['Polos motor', f.motor.polos]] : null,
			f?.vfd ? [['Entrada VFD', f.vfd.tensionEntradaNominalV, 'V'], ['Fases entrada VFD', f.vfd.fasesEntrada],
				['Potencia VFD', f.vfd.potenciaNominalW, 'W'], ['Frecuencia base VFD', f.vfd.frecuenciaBaseHz, 'Hz'],
				['Frecuencia máxima VFD', f.vfd.frecuenciaMaxHz, 'Hz'], ['Salida VFD', f.vfd.tensionSalidaMaxV, 'V'],
				['I VFD', f.vfd.corrienteNominalA, 'A']] : null,
		],
	};
}

function varianteProducto(d: Dispositivo): readonly unknown[] {
	const { placa, fisica } = camposVariante(d);
	return [d.tipo, d.fabricante?.trim() ?? '', d.referencia?.trim() ?? '', variantePerfil(d),
		placa.map((c) => c[1]), ...fisica.map((grupo) => grupo?.map((c) => c[1]) ?? null)];
}

function textoValor(valor: unknown): string {
	if (Array.isArray(valor)) return valor.map(textoValor).join('–');
	if (typeof valor === 'boolean') return valor ? 'sí' : 'no';
	return String(valor);
}

function resumenPerfil(d: Dispositivo): string | undefined {
	const perfil = variantePerfil(d);
	if (!perfil) return undefined;
	if (perfil[0] === 'proteccion') return `Perfil: protección${perfil[1] ? ` ${perfil[1]}` : ''}, ${perfil[3]} polos, ${perfil[2] ? 'rearmable' : 'no rearmable'}`;
	if (perfil[0] === 'mando') return `Perfil: mando ${perfil[1]}, ${perfil[2]} posiciones`;
	if (perfil[0] === 'carga') return `Perfil: carga ${perfil[1]}, ${perfil[2]} fases mínimas`;
	if (perfil[0] === 'sensor') return `Perfil: sensor, salida digital ${perfil[1] ? 'sí' : 'no'}, transmisor ${perfil[2] ? 'sí' : 'no'}`;
	if (perfil[0] === 'contactos-electromagneticos') return `Perfil: contactor, ${perfil[1]} polos y ${perfil[2]} contactos`;
	return `Perfil: ${perfil[0]}`;
}

function varianteDeclarada(d: Dispositivo, referencias: readonly string[]): string {
	const { placa, fisica } = camposVariante(d);
	const propio = d.componentePersonalizado;
	const identidad = propio ? `Componente propio ${propio.definicionId}, revisión ${propio.revision}`
		: d.fabricante?.trim() && d.referencia?.trim() ? `Artículo comercial ${d.fabricante.trim()} / ${d.referencia.trim()}`
		: referencias.length ? `Producto técnico congelado (${referencias.length} referencia${referencias.length === 1 ? '' : 's'})`
		: 'Instancia sin identidad de compra: partida no consolidada';
	const datos = [placa, ...fisica.filter((g): g is CampoVariante[] => g !== null)]
		.flat().filter((campo) => campo[1] !== undefined && campo[1] !== null)
		.map(([etiqueta, valor, unidad]) => `${etiqueta}: ${textoValor(valor)}${unidad ? ` ${unidad}` : ''}`);
	return [identidad, `Tipo: ${d.tipo}`, resumenPerfil(d), ...datos].filter(Boolean).join(' · ');
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
		const referencias = tecnicas.get(d.id) ?? [];
		const clave = JSON.stringify([identidad(d, referencias), varianteProducto(d)]);
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
			varianteDeclarada: varianteDeclarada(d, referencias),
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
