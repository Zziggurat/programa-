/**
 * La vista de esquema: el plano de mando y potencia.
 *
 * Es el documento con el que trabaja el electricista y el que se entrega al cliente. Se monta
 * desde el MISMO modelo que el 3D —no hay dos verdades— y se muestra como una capa por encima del
 * lienzo. Aquí está todo lo suyo: montar las hojas, pasarlas, el zoom, colocar los símbolos a mano
 * arrastrándolos y las tres exportaciones (PDF, SVG y DXF).
 *
 * No importa nada de `main.ts`: lo que necesita del editor entra por `ContextoEsquema`.
 */
import { Proyecto, RefBorne, type ClaseHojaEsquema } from '../src/modelo/tipos.js';
import type { ProcedenciaDocumento } from '../src/modelo/procedencia-documental.js';
import { resolverComportamiento } from '../src/modelo/comportamiento.js';
import { cerrarTodasLasVentanas } from './ventanas.js';
import { ResultadoPotenciales } from '../src/motores/potenciales.js';
import { calcularPotenciales } from '../src/motores/potenciales.js';
import {
	anchoColumna, alturaDeFila, FILAS_ESQ, filaDeAltura, HojaEsq, MARGEN, montarEsquema,
} from '../src/motores/esquema.js';
import { aplicarMovimientoRepresentacion, previsualizarMovimientoRepresentacion,
	type PlanMovimientoRepresentacion, type PosicionMovimientoRepresentacion,
} from '../src/motores/mover-representacion-esquema.js';
import { aplicarAlineacionRepresentaciones, previsualizarAlineacionRepresentaciones,
} from '../src/motores/alinear-representaciones-esquema.js';
import {
	planActivacionRepresentaciones, planDesdoblamientoRepresentacion,
	planPartesDesdoblamiento, planReponerRepresentacion, type DestinosDesdoblamiento,
} from '../src/motores/crear-representaciones-esquema.js';
import { aplicarRenumeracionEsquema, previsualizarRenumeracionEsquema } from '../src/motores/renumeracion-esquema.js';
import { aplicarGestionHojaEsquema, previsualizarGestionHojaEsquema,
	type SolicitudGestionHojaEsquema } from '../src/motores/gestion-hojas-esquema.js';
import { proyectarReferenciasEsquemaM2, type UbicacionTerminalEsquema } from '../src/motores/referencias-esquema-m2.js';
import { proyectarEstadoEsquema } from '../src/motores/estado-esquema-simulacion.js';
import type { ResultadoSimulacion } from '../src/motores/simulacion.js';
import { hojaASvg } from './esquema-svg.js';
import { exportarEsquemaPDF } from './esquema-pdf.js';
import { dxfDeEsquema } from './exportaciones.js';
import { avisar, confirmar, descargar, pedirTexto } from './dialogos.js';

/** Identidades del modelo compartido, nunca designaciones visibles susceptibles de duplicarse. */
export interface EntidadLocalizableEsquema {
	tipo: 'DEVICE' | 'CONDUCTOR' | 'CIRCUIT';
	id: string;
}

/** Lo que la vista de esquema necesita del editor. */
export interface ContextoEsquema {
	proyecto: () => Proyecto;
	potenciales: () => ResultadoPotenciales;
	/** Una lectura del runtime vigente; jamás se toma de potenciales estáticos ni del SVG exportable. */
	estadoSimulacion: () => { energizado: boolean; resultado?: ResultadoSimulacion };
	/** El aparato seleccionado ahora mismo, para resaltarlo en la hoja. */
	dispositivoSeleccionado: () => string | undefined;
	/** Selecciona un aparato en todo el programa (el esquema y el 3D son dos vistas del mismo). */
	seleccionar: (id: string) => void;
	seleccionarConductor: (id: string) => void;
	/** Cierra el plano y enfoca la identidad eléctrica/física en el tablero. */
	verEnTablero: (tipo: 'DEVICE' | 'CONDUCTOR', id: string) => void;
	/** Abre la ficha técnica del mismo aparato, sin buscarlo por su rótulo. */
	verDatosTecnicos?: (dispositivoId: string) => void;
	/** Consulta de solo lectura antes de ofrecer una eliminación; no crea entrada de deshacer. */
	puedeEditar: () => boolean;
	/** Crea un aparato nuevo sin conductores y su vista completa M2 con un solo Undo. */
	duplicarAparatoConVista: (vistaId: string, destino: PosicionMovimientoRepresentacion,
		proyectoEsperado: Proyecto) => string | undefined;
	/** El editor central elimina el conductor real y gestiona historial, recálculo y guardado. */
	desconectarConductor: (conductorId: string) => boolean;
	/** Elimina el aparato eléctrico real, sus conexiones y vistas tras mostrar el alcance. */
	eliminarDispositivo: (dispositivoId: string) => Promise<void>;
	/** Crea una sola conexión eléctrica pendiente; el editor central conserva undo y persistencia. */
	conectarPendiente: (de: RefBorne, a: RefBorne, proyectoEsperado: Proyecto) => string | undefined;
	/**
	 * Guarda un punto de deshacer antes de cambiar nada, y DICE SI SE PUEDE CAMBIAR: en un tablero
	 * de ejemplo dice que no. Quien la llama tiene que mirar el resultado y no tocar nada si es
	 * `false`; `test/solo-lectura.test.ts` comprueba que nadie se lo salte.
	 */
	capturar: () => boolean;
	/** Descarta la captura si una propuesta envejeció antes de la aplicación. */
	descartarCapturaSiIgual: () => void;
	marcarSucio: () => void;
	actualizarTodo: () => void;
	/** Nombre base de archivo del proyecto, ya saneado. */
	nombreArchivo: () => string;
	/** ID y revisión solo después del guardado confirmado; los ejemplos quedan efímeros. */
	obtenerProcedencia: () => Promise<ProcedenciaDocumento>;
	/** Cierra la capa de Visualización: las dos capas no pueden convivir. */
	cerrarVisualizacion: () => void;
}

/** Lo que el editor puede pedirle a la vista de esquema una vez instalada. */
export interface PanelEsquema {
	abierto: () => boolean;
	abrir: (abrir: boolean) => void;
	/** Vuelve a montar el esquema desde el modelo y lo pinta. No hace nada si está cerrado. */
	refrescar: () => void;
	/** Actualiza sólo indicadores DOM; el esquema no se remonta en cada scan. */
	refrescarEstado: () => void;
	/** Recalcula el tamaño de la hoja (al cambiar el tamaño de la ventana). */
	reajustarZoom: () => void;
	/** Pasa de hoja (+1 siguiente, -1 anterior). */
	pasarHoja: (delta: number) => void;
	/** Consume Escape si había un origen de conexión activo; no cierra el esquema. */
	cancelarConexionPendiente: () => boolean;
	/** Navega desde un issue por IDs; si hay varias vistas, exige elección visible. */
	localizarEntidades: (entidades: readonly EntidadLocalizableEsquema[], issueId: string) => void;
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;
type DestinoReferenciaEsquema = Pick<UbicacionTerminalEsquema, 'hojaId' | 'numeroHoja'>
	& Partial<Pick<UbicacionTerminalEsquema, 'columna' | 'representacionId'>>;

export type PropuestaConductorPendiente =
	| { ok: true; valor: { de: RefBorne; a: RefBorne; estadoRutaFisica: 'pendiente' } }
	| { ok: false; motivo: string };

/** Un único par de bornes visibles M2, sin materiales ni longitud física implícitos. */
export function proponerConductorPendiente(
	documento: Proyecto, hojas: readonly HojaEsq[], de: RefBorne, a: RefBorne,
): PropuestaConductorPendiente {
	if (documento.esquema?.representaciones === undefined) {
		return { ok: false, motivo: 'Activa las vistas M2 antes de conectar desde el esquema.' };
	}
	const existe = (ref: RefBorne): boolean => documento.dispositivos.some((d) => d.id === ref.dispositivoId
		&& d.bornes.some((b) => b.id === ref.borneId));
	if (!existe(de) || !existe(a)) {
		return { ok: false, motivo: 'Uno de los bornes ya no existe en el proyecto.' };
	}
	if (de.dispositivoId === a.dispositivoId && de.borneId === a.borneId) {
		return { ok: false, motivo: 'El origen y el destino son el mismo borne.' };
	}
	const anclas = (ref: RefBorne): number => hojas.reduce((n, hoja) => n + hoja.simbolos.filter((s) =>
		s.dispositivoId === ref.dispositivoId && !!s.representacionId && s.pines.has(ref.borneId)).length, 0);
	if (anclas(de) !== 1 || anclas(a) !== 1) {
		return { ok: false, motivo: 'Cada borne necesita una única vista visible en el esquema.' };
	}
	const igual = (x: RefBorne, y: RefBorne): boolean =>
		x.dispositivoId === y.dispositivoId && x.borneId === y.borneId;
	if (documento.conductores.some((c) => (igual(c.de, de) && igual(c.a, a))
		|| (igual(c.de, a) && igual(c.a, de)))) {
		return { ok: false, motivo: 'Esos dos bornes ya están conectados.' };
	}
	return { ok: true, valor: {
		de: { dispositivoId: de.dispositivoId, borneId: de.borneId },
		a: { dispositivoId: a.dispositivoId, borneId: a.borneId },
		estadoRutaFisica: 'pendiente',
	} };
}

/** Toma hoja y procedencia de la misma identidad, antes/después del flush asíncrono del repositorio. */
export async function prepararHojaDocumental(
	ctx: Pick<ContextoEsquema, 'proyecto' | 'nombreArchivo' | 'obtenerProcedencia'>,
	indice: number,
) {
	const actual = ctx.proyecto();
	const firma = JSON.stringify(actual);
	const copia = structuredClone(actual);
	const base = ctx.nombreArchivo();
	const procedencia = await ctx.obtenerProcedencia();
	if (ctx.proyecto() !== actual || JSON.stringify(ctx.proyecto()) !== firma) {
		throw new Error('El proyecto cambió mientras se preparaba el esquema. Vuelve a exportarlo.');
	}
	const hojas = montarEsquema(copia, calcularPotenciales(copia));
	const hoja = hojas[Math.min(indice, hojas.length - 1)];
	if (!hoja) throw new Error('Todavía no hay esquema que exportar.');
	return { hoja, copia, base, procedencia, totalHojas: hojas.length,
		rutasPendientes: copia.conductores.filter((c) => c.estadoRutaFisica === 'pendiente').length };
}

export function instalarEsquema(ctx: ContextoEsquema): PanelEsquema {
	const proyecto = ctx.proyecto;
	const { capturar, marcarSucio, actualizarTodo, seleccionar, nombreArchivo } = ctx;

	/** La capa está delante del lienzo (como el modo Visualización, con el que no puede convivir). */
	let esquemaAbierto = false;
	/** Las hojas montadas del esquema abierto: se rehacen enteras en cada refresco. */
	let hojasEsquema: HojaEsq[] = [];
	let hojaActual = 0;
	/** El índice solo sirve para pintar; la selección sobrevive reordenación/Undo por ID. */
	let hojaSeleccionadaId: string | undefined;
	let zoomEsquema = 1;
	/** Selección de vista: el conductor sigue identificado por su id del proyecto. */
	let conductorSeleccionado: string | undefined;
	/** Identidad gráfica M2, distinta de la identidad eléctrica del aparato. */
	let representacionSeleccionada: string | undefined;
	/** Portapapeles local del esquema: nunca serializado ni mezclado entre proyectos. */
	let vistaCopiada: { documento: Proyecto; vistaId: string } | undefined;
	function pintarAccionesCopia(): void {
		const documento = proyecto();
		const lista = documento.esquema?.representaciones;
		const explicito = esquemaAbierto && lista !== undefined;
		if (vistaCopiada && (vistaCopiada.documento !== documento
			|| !lista?.some((r) => r.id === vistaCopiada!.vistaId))) vistaCopiada = undefined;
		const seleccion = lista?.find((r) => r.id === representacionSeleccionada);
		const copiables = !!seleccion && seleccion.parte.tipo === 'completa'
			&& lista?.filter((r) => r.dispositivoId === seleccion.dispositivoId).length === 1
			&& documento.gabinete?.colocaciones.filter((c) => c.dispositivoId === seleccion.dispositivoId
				&& c.montaje !== 'puerta').length === 1;
		const copiar = $('esq-copiar-vista') as HTMLButtonElement;
		const pegar = $('esq-pegar-vista') as HTMLButtonElement;
		const estado = $('esq-copia-estado');
		copiar.hidden = pegar.hidden = !explicito;
		copiar.disabled = !copiables || !!documento.esEjemplo;
		pegar.disabled = !vistaCopiada || !!documento.esEjemplo;
		estado.hidden = !explicito || !vistaCopiada;
		estado.textContent = vistaCopiada ? `Copia preparada: ${vistaCopiada.vistaId} · sin cables` : '';
	}
	/** Selección editorial transitoria: jamás se serializa ni duplica dispositivos o conductores. */
	const grupoVistaIds = new Set<string>();
	let grupoAnclaId: string | undefined;
	let grupoDocumento: Proyecto | undefined;
	let grupoHojaId: string | undefined;
	function pintarGrupoRepresentaciones(): void {
		const explicito = esquemaAbierto && proyecto().esquema?.representaciones !== undefined;
		const info = $('esq-grupo-estado');
		const total = grupoVistaIds.size;
		info.hidden = !explicito;
		info.textContent = total ? `${total} vista(s) · ancla ${grupoAnclaId ?? '—'}`
			: 'Shift+clic o Shift+Enter: seleccionar vistas';
		if (explicito && proyecto().esEjemplo) info.textContent += ' · ejemplo de solo lectura';
		info.title = total ? `Grupo de ${total} vista(s) de esta hoja; ancla ${grupoAnclaId}` : '';
		for (const id of ['esq-alinear-fila', 'esq-alinear-columna', 'esq-grupo-limpiar']) {
			const boton = $(id) as HTMLButtonElement;
			boton.hidden = !explicito;
			boton.disabled = id === 'esq-grupo-limpiar' ? !total : total < 2 || !!proyecto().esEjemplo;
		}
		for (const g of $('esquema-hoja').querySelectorAll<SVGGElement>('.simbolo[data-representacion]')) {
			const id = g.dataset.representacion ?? '';
			g.dataset.multiseleccion = String(grupoVistaIds.has(id));
			g.dataset.grupoAncla = String(id === grupoAnclaId && grupoVistaIds.has(id));
			g.setAttribute('aria-pressed', String(grupoVistaIds.has(id)));
		}
	}
	function limpiarGrupoRepresentaciones(): void {
		grupoVistaIds.clear();
		grupoAnclaId = undefined;
		grupoDocumento = undefined;
		grupoHojaId = undefined;
		pintarGrupoRepresentaciones();
	}
	function alternarVistaEnGrupo(id: string, desdeTeclado: boolean): void {
		const documento = proyecto();
		const hoja = hojasEsquema[hojaActual];
		if (!hoja || documento.esquema?.representaciones === undefined
			|| !hoja.simbolos.some((s) => s.representacionId === id)) return;
		if (grupoDocumento !== documento || grupoHojaId !== hoja.id) {
			grupoVistaIds.clear();
			grupoAnclaId = undefined;
		}
		grupoDocumento = documento;
		grupoHojaId = hoja.id;
		if (!grupoVistaIds.has(id) && grupoVistaIds.size >= 64) {
			avisar('Puedes seleccionar hasta 64 vistas en un mismo grupo.', 'info');
			pintarGrupoRepresentaciones();
			return;
		}
		if (grupoVistaIds.has(id)) grupoVistaIds.delete(id);
		else grupoVistaIds.add(id);
		grupoAnclaId = [...grupoVistaIds].at(-1);
		if (!grupoVistaIds.size) { grupoDocumento = undefined; grupoHojaId = undefined; }
		const habiaInspector = !!(origenConexion || conductorSeleccionado || representacionSeleccionada);
		origenConexion = undefined;
		conductorSeleccionado = undefined;
		representacionSeleccionada = undefined;
		if (habiaInspector) {
			refrescarEsquema();
			if (desdeTeclado) [...$('esquema-hoja').querySelectorAll<SVGGElement>('.simbolo[data-representacion]')]
				.find((g) => g.dataset.representacion === id)?.focus();
		} else pintarGrupoRepresentaciones();
	}
	/** El índice se calcula al abrirse; el arrastre normal no hace análisis semántico adicional. */
	let referenciasAbiertas = false;
	let procedenciaAbierta = false;
	let arrastrandoVista = false;
	/** Un solo gesto M2 activo; cerrar el esquema también retira sus listeners globales. */
	let cancelarArrastreM2: (() => void) | undefined;
	type OpcionLocalizacion = {
		tipo: EntidadLocalizableEsquema['tipo']; id: string; hojaId: string;
		representacionId?: string; etiqueta: string;
	};
	let localizacion: { issueId: string; documento: Proyecto; opciones: OpcionLocalizacion[] } | undefined;
	/** El primer extremo se mantiene al cambiar de hoja; nunca es un segundo conductor. */
	let origenConexion: { ref: RefBorne; representacionId: string; hojaId: string;
		documento: Proyecto } | undefined;
	/** El formulario vive fuera del inspector, para conservar sus valores al navegar entre hojas. */
	let documentoFormulario: Proyecto | undefined;
	let refrescoEstadoPendiente = 0;
	let encuadrePendiente: number | undefined;
	let espacioPan = false;
	let cancelarPanEsquema: (() => void) | undefined;
	let residuoPan: { pointerId: number; button: number } | undefined;
	let relojResiduoPan: number | undefined;

	function limpiarResiduoPan(): void {
		if (relojResiduoPan !== undefined) window.clearTimeout(relojResiduoPan);
		relojResiduoPan = undefined;
		residuoPan = undefined;
	}

	/** El click sintético que sigue a pointerup pertenece al pan; un nuevo pointerdown lo descarta. */
	function reservarResiduoPan(pointerId: number, button: number): void {
		limpiarResiduoPan();
		residuoPan = { pointerId, button };
		relojResiduoPan = window.setTimeout(limpiarResiduoPan, 1200);
	}

	function instalarPanEsquema(): void {
		const lienzo = $('esquema-lienzo');
		const hayModal = (): boolean => [...document.querySelectorAll<HTMLElement>('[id^="modal-"]')]
			.some((el) => !el.hidden);
		lienzo.addEventListener('keydown', (ev) => {
			if (!esquemaAbierto || document.activeElement !== lienzo || hayModal()) return;
			if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight'
				|| ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
				// El navegador desplaza este region scrollable; el editor global no cambia de folio.
				ev.stopPropagation();
				return;
			}
			if (ev.code === 'Space' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
				espacioPan = true;
				ev.preventDefault();
				ev.stopPropagation();
			}
		});
		lienzo.addEventListener('blur', () => { espacioPan = false; cancelarPanEsquema?.(); });
		window.addEventListener('blur', () => { espacioPan = false; cancelarPanEsquema?.(); });
		window.addEventListener('keyup', (ev) => { if (ev.code === 'Space') espacioPan = false; }, true);
		const suprimirClickResidual = (ev: MouseEvent): void => {
			const residuo = residuoPan;
			if (!residuo || ev.button !== residuo.button || ev.detail === 0) return;
			if ('pointerId' in ev && (ev as PointerEvent).pointerId !== residuo.pointerId) return;
			ev.preventDefault();
			ev.stopImmediatePropagation();
			limpiarResiduoPan();
		};
		lienzo.addEventListener('click', suprimirClickResidual, true);
		lienzo.addEventListener('auxclick', suprimirClickResidual, true);
		lienzo.addEventListener('pointerdown', (ev) => {
			// Si no hubo click residual, el siguiente gesto normal nunca hereda su supresión.
			limpiarResiduoPan();
			if (ev.pointerType === 'touch') return; // el gesto táctil conserva su scroll nativo
			if (cancelarPanEsquema) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
			if (!esquemaAbierto || hayModal() || arrastrandoVista || cancelarArrastreM2) return;
			const objetivo = ev.target;
			if (objetivo instanceof Element && objetivo.closest(
				'button, input, select, textarea, [contenteditable="true"], [role="textbox"]')) return;
			const medio = ev.button === 1 && (ev.buttons & ~4) === 0;
			const primarioConEspacio = ev.button === 0 && (ev.buttons & ~1) === 0
				&& espacioPan && document.activeElement === lienzo;
			if (!medio && !primarioConEspacio) return;
			ev.preventDefault();
			ev.stopImmediatePropagation();
			const pointerId = ev.pointerId;
			const button = ev.button;
			const inicioX = ev.clientX;
			const inicioY = ev.clientY;
			const scrollX = lienzo.scrollLeft;
			const scrollY = lienzo.scrollTop;
			let activo = true;
			const desplazar = (actual: PointerEvent): void => {
				lienzo.scrollLeft = scrollX + inicioX - actual.clientX;
				lienzo.scrollTop = scrollY + inicioY - actual.clientY;
			};
			const terminar = (): void => {
				if (!activo) return;
				activo = false;
				window.removeEventListener('pointermove', alMover, true);
				window.removeEventListener('pointerup', alSoltar, true);
				window.removeEventListener('pointercancel', alCancelarPuntero, true);
				window.removeEventListener('keydown', alTecla, true);
				lienzo.removeEventListener('lostpointercapture', alPerderCaptura);
				lienzo.classList.remove('pan-esquema');
				cancelarPanEsquema = undefined;
				reservarResiduoPan(pointerId, button);
				if (lienzo.hasPointerCapture(pointerId)) lienzo.releasePointerCapture(pointerId);
			};
			const alMover = (actual: PointerEvent): void => {
				if (actual.pointerId !== pointerId) return;
				actual.preventDefault();
				actual.stopImmediatePropagation();
				desplazar(actual);
			};
			const alSoltar = (actual: PointerEvent): void => {
				if (actual.pointerId !== pointerId) return;
				actual.preventDefault();
				actual.stopImmediatePropagation();
				desplazar(actual);
				terminar();
			};
			const alCancelarPuntero = (actual: PointerEvent): void => {
				if (actual.pointerId !== pointerId) return;
				actual.preventDefault();
				actual.stopImmediatePropagation();
				terminar();
			};
			const alPerderCaptura = (actual: PointerEvent): void => {
				if (actual.pointerId === pointerId) terminar();
			};
			const alTecla = (tecla: KeyboardEvent): void => {
				if (tecla.key !== 'Escape') return;
				tecla.preventDefault();
				tecla.stopImmediatePropagation();
				espacioPan = false;
				terminar();
			};
			window.addEventListener('pointermove', alMover, true);
			window.addEventListener('pointerup', alSoltar, true);
			window.addEventListener('pointercancel', alCancelarPuntero, true);
			window.addEventListener('keydown', alTecla, true);
			lienzo.addEventListener('lostpointercapture', alPerderCaptura);
			lienzo.classList.add('pan-esquema');
			cancelarPanEsquema = terminar;
			try { lienzo.setPointerCapture(pointerId); } catch { /* window conserva el gesto si falla captura */ }
		}, true);
	}

	function pintarEstadoEsquema(): void {
		if (!esquemaAbierto) return;
		const hoja = hojasEsquema[hojaActual];
		const { energizado, resultado } = ctx.estadoSimulacion();
		const estado = proyectarEstadoEsquema({ proyecto: proyecto(),
			hoja: hoja ?? { hilos: [], simbolos: [] }, energizado, resultado });
		const etiqueta = estado.modo === 'diseno' ? 'Diseño · sin tensión'
			: estado.modo === 'simulacion-sin-snapshot' ? 'Simulación · sin resultado todavía'
			: estado.modo === 'simulacion-inestable' ? 'Simulación · resultado inestable'
			: `Simulación · ${estado.hilos.filter((h) => h.estado === 'vivo').length} hilo(s) con tensión`;
		const indicador = $('esq-sim-estado');
		indicador.dataset.modo = estado.modo;
		if (indicador.textContent !== etiqueta) indicador.textContent = etiqueta;
		if (!hoja) return;
		const hilos = new Map(estado.hilos.map((h) => [h.conductorId, h]));
		for (const g of $('esquema-hoja').querySelectorAll<SVGGElement>(
			'.hilo[data-conductor], .referencia-conductor[data-conductor]')) {
			const id = g.dataset.conductor ?? '';
			const hilo = hilos.get(id);
			const valor = hilo?.estado ?? 'desconocido';
			g.dataset.simEstado = valor;
			g.dataset.simSeleccionado = String(id === conductorSeleccionado);
			let titulo = g.querySelector<SVGTitleElement>('title.esq-sim-titulo');
			if (!titulo) {
				titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
				titulo.classList.add('esq-sim-titulo');
				g.append(titulo);
			}
			titulo.textContent = `Conductor ${id}: ${valor === 'vivo' ? 'con tensión' : valor === 'no-registrado-vivo'
				? 'sin tensión registrada' : valor === 'no-aplica' ? 'diseño sin simulación' : 'estado desconocido'}`;
		}
		const aparatos = new Map(estado.aparatos.map((a) => [JSON.stringify([a.dispositivoId, a.representacionId ?? '']), a]));
		for (const g of $('esquema-hoja').querySelectorAll<SVGGElement>('.simbolo[data-dispositivo]')) {
			const id = g.dataset.dispositivo ?? '';
			const aparato = aparatos.get(JSON.stringify([id, g.dataset.representacion ?? '']));
			g.dataset.simActividad = aparato?.actividad ?? 'desconocida';
			if (aparato?.funcion) g.dataset.simFuncion = aparato.funcion.estado;
			else delete g.dataset.simFuncion;
			let titulo = g.querySelector<SVGTitleElement>('title.esq-sim-titulo');
			if (!titulo) {
				titulo = document.createElementNS('http://www.w3.org/2000/svg', 'title');
				titulo.classList.add('esq-sim-titulo');
				g.append(titulo);
			}
			titulo.textContent = `Aparato ${id}: ${aparato?.funcion ? aparato.funcion.estado + ' · ' : ''}`
				+ (aparato?.actividad === 'activa' ? 'activo' : aparato?.actividad === 'no-registrada-activa'
					? 'sin actividad registrada' : aparato?.actividad === 'no-aplica' ? 'diseño sin simulación' : 'estado desconocido')
				+ (aparato?.bornesConTension.length ? ` · bornes con tensión: ${aparato.bornesConTension.join(', ')}` : '');
		}
	}

	function refrescarEstado(): void {
		if (!esquemaAbierto || refrescoEstadoPendiente) return;
		refrescoEstadoPendiente = window.requestAnimationFrame(() => {
			refrescoEstadoPendiente = 0;
			pintarEstadoEsquema();
		});
	}

	const describirBorne = (ref: RefBorne): string => {
		const d = proyecto().dispositivos.find((x) => x.id === ref.dispositivoId);
		return `${d?.designacion ?? ref.dispositivoId} [${ref.dispositivoId}] · ${ref.borneId}`;
	};

	function cancelarEncuadrePendiente(): void {
		if (encuadrePendiente !== undefined) window.cancelAnimationFrame(encuadrePendiente);
		encuadrePendiente = undefined;
	}

	/** Encuadra un ID gráfico único después de montar y dimensionar la hoja, nunca por designación. */
	function encuadrarRepresentacion(hojaId: string, representacionId: string, documento: Proyecto,
		desdeTeclado = false): void {
		cancelarEncuadrePendiente();
		encuadrePendiente = window.requestAnimationFrame(() => {
			encuadrePendiente = undefined;
			if (!esquemaAbierto || proyecto() !== documento || hojaSeleccionadaId !== hojaId
				|| representacionSeleccionada !== representacionId) return;
			const hoja = hojasEsquema[hojaActual];
			const simbolos = hoja?.simbolos.filter((s) => s.representacionId === representacionId) ?? [];
			const montados = hojasEsquema.reduce((n, h) => n + h.simbolos.filter((s) =>
				s.representacionId === representacionId).length, 0);
			const nodos = [...$('esquema-hoja').querySelectorAll<SVGGElement>('.simbolo[data-representacion]')]
				.filter((g) => g.dataset.representacion === representacionId);
			if (!hoja || hoja.id !== hojaId || simbolos.length !== 1 || montados !== 1 || nodos.length !== 1) {
				avisar('La representación ya no tiene un anclaje único; no se pudo centrar.', 'info');
				return;
			}
			const lienzo = $('esquema-lienzo');
			const svg = $('esquema-hoja').querySelector<SVGSVGElement>('svg');
			if (!svg) return;
			const viewport = lienzo.getBoundingClientRect();
			const papel = svg.getBoundingClientRect();
			if (papel.width < 1 || papel.height < 1 || lienzo.clientWidth < 1 || lienzo.clientHeight < 1) return;
			const simbolo = simbolos[0];
			const centroX = papel.left + (simbolo.x + simbolo.ancho / 2) / hoja.anchoMm * papel.width;
			const centroY = papel.top + (simbolo.y + simbolo.alto / 2) / hoja.altoMm * papel.height;
			lienzo.scrollLeft += centroX - (viewport.left + lienzo.clientLeft + lienzo.clientWidth / 2);
			lienzo.scrollTop += centroY - (viewport.top + lienzo.clientTop + lienzo.clientHeight / 2);
			if (desdeTeclado && nodos[0].hasAttribute('tabindex')
				&& Number(nodos[0].getAttribute('tabindex')) >= 0
				&& (document.activeElement === document.body || !document.activeElement?.isConnected)) {
				nodos[0].focus({ preventScroll: true });
			}
		});
	}

	function volverAlOrigenDeHoja(): void {
		const lienzo = $('esquema-lienzo');
		lienzo.scrollLeft = 0;
		lienzo.scrollTop = 0;
	}

	/** Navegación por identidad persistente, nunca por rótulo o número de hoja mutable. */
	function irAReferencia(ubicacion: DestinoReferenciaEsquema,
		dispositivoId?: string, desdeTeclado = false): void {
		cancelarEncuadrePendiente();
		const indice = hojasEsquema.findIndex((h) => h.id === ubicacion.hojaId);
		if (indice < 0) { avisar('La hoja de esta referencia ya no existe. Actualiza el esquema.', 'info'); return; }
		const hojaAnterior = hojaSeleccionadaId;
		hojaActual = indice;
		hojaSeleccionadaId = ubicacion.hojaId;
		conductorSeleccionado = undefined;
		representacionSeleccionada = ubicacion.representacionId;
		if (dispositivoId && proyecto().dispositivos.some((d) => d.id === dispositivoId)) seleccionar(dispositivoId);
		refrescarEsquema();
		if (ubicacion.representacionId) encuadrarRepresentacion(ubicacion.hojaId, ubicacion.representacionId,
			proyecto(), desdeTeclado);
		else if (hojaAnterior !== ubicacion.hojaId) volverAlOrigenDeHoja();
	}

	const claveOpcion = (o: OpcionLocalizacion): string =>
		JSON.stringify([o.tipo, o.id, o.hojaId, o.representacionId ?? '']);

	/** Una identidad puede tener varias vistas; nunca inferimos una por nombre ni por orden del array. */
	function opcionesParaEntidades(entidades: readonly EntidadLocalizableEsquema[]): OpcionLocalizacion[] {
		const opciones: OpcionLocalizacion[] = [];
		for (const entidad of entidades) {
			if (entidad.tipo === 'DEVICE' && proyecto().dispositivos.some((d) => d.id === entidad.id)) {
				for (const hoja of hojasEsquema) {
					for (const simbolo of hoja.simbolos.filter((s) => s.dispositivoId === entidad.id)) {
						opciones.push({ tipo: 'DEVICE', id: entidad.id, hojaId: hoja.id,
							...(simbolo.representacionId ? { representacionId: simbolo.representacionId } : {}),
							etiqueta: `${simbolo.designacion} [${entidad.id}] · hoja ${hoja.numero}`
								+ (simbolo.representacionId ? ` · vista ${simbolo.representacionId}` : '') });
					}
					if (!hoja.simbolos.some((s) => s.dispositivoId === entidad.id)
						&& hoja.problemas?.some((p) => p.dispositivoId === entidad.id)) {
						opciones.push({ tipo: 'DEVICE', id: entidad.id, hojaId: hoja.id,
							etiqueta: `${entidad.id} · hoja ${hoja.numero} · sin vista válida` });
					}
				}
			} else if (entidad.tipo === 'CONDUCTOR'
				&& proyecto().conductores.some((c) => c.id === entidad.id)) {
				for (const hoja of hojasEsquema) {
					if (hoja.hilos.some((h) => h.conductorId === entidad.id)
						|| hoja.referencias.some((r) => r.conductorId === entidad.id)
						|| hoja.problemas?.some((p) => p.conductorId === entidad.id)) {
						opciones.push({ tipo: 'CONDUCTOR', id: entidad.id, hojaId: hoja.id,
							etiqueta: `Conductor ${entidad.id} · hoja ${hoja.numero}` });
					}
				}
			} else if (entidad.tipo === 'CIRCUIT') {
				const referencia = proyectarReferenciasEsquemaM2(proyecto(), hojasEsquema)
					.circuitos.find((c) => c.circuitoId === entidad.id);
				for (const hoja of referencia?.hojas ?? []) {
					opciones.push({ tipo: 'CIRCUIT', id: entidad.id, hojaId: hoja.id,
						etiqueta: `Circuito ${entidad.id} · hoja ${hoja.numero}` });
				}
			}
		}
		const unicas = [...new Map(opciones.map((o) => [claveOpcion(o), o])).values()];
		return unicas.sort((a, b) => {
			const na = hojasEsquema.find((h) => h.id === a.hojaId)?.numero ?? Infinity;
			const nb = hojasEsquema.find((h) => h.id === b.hojaId)?.numero ?? Infinity;
			return na - nb || claveOpcion(a).localeCompare(claveOpcion(b));
		});
	}

	function aplicarOpcionLocalizacion(opcion: OpcionLocalizacion, desdeTeclado = false): void {
		cancelarEncuadrePendiente();
		const indice = hojasEsquema.findIndex((h) => h.id === opcion.hojaId);
		if (indice < 0) { avisar('La hoja de ese issue ya no existe.', 'info'); return; }
		const hojaAnterior = hojaSeleccionadaId;
		hojaActual = indice;
		hojaSeleccionadaId = opcion.hojaId;
		representacionSeleccionada = opcion.representacionId;
		conductorSeleccionado = opcion.tipo === 'CONDUCTOR' ? opcion.id : undefined;
		if (opcion.tipo === 'DEVICE') seleccionar(opcion.id);
		else if (opcion.tipo === 'CONDUCTOR') ctx.seleccionarConductor(opcion.id);
		localizacion = undefined;
		refrescarEsquema();
		if (opcion.representacionId) encuadrarRepresentacion(opcion.hojaId, opcion.representacionId,
			proyecto(), desdeTeclado);
		else if (hojaAnterior !== opcion.hojaId) volverAlOrigenDeHoja();
	}

	function localizarEntidades(entidades: readonly EntidadLocalizableEsquema[], issueId: string): void {
		if (!entidades.length) { avisar('Este issue no identifica una entidad localizable en el esquema.', 'info'); return; }
		abrirEsquema(true);
		const opciones = opcionesParaEntidades(entidades);
		if (opciones.length === 1) { aplicarOpcionLocalizacion(opciones[0]); return; }
		localizacion = { issueId, documento: proyecto(), opciones };
		pintarConductorSeleccionado();
	}

	function pintarLocalizador(ayuda: HTMLElement): void {
		if (!localizacion) return;
		const panel = document.createElement('div');
		panel.id = 'esq-localizador-issue';
		const cabecera = document.createElement('strong');
		cabecera.textContent = `Issue ${localizacion.issueId}: ${localizacion.opciones.length
			? 'elige la vista o entidad exacta' : 'sin hoja o ancla verificable; no se eligió una ubicación'}`;
		panel.append(cabecera);
		for (const opcion of localizacion.opciones) {
			const boton = document.createElement('button');
			boton.type = 'button';
			boton.className = 'boton';
			boton.dataset.localizarTipo = opcion.tipo;
			boton.dataset.localizarId = opcion.id;
			boton.dataset.hojaId = opcion.hojaId;
			if (opcion.representacionId) boton.dataset.representacionId = opcion.representacionId;
			boton.textContent = opcion.etiqueta;
			boton.onclick = (ev) => {
				if (localizacion?.documento !== proyecto()) {
					avisar('El proyecto cambió; vuelve al issue para localizarlo.', 'info');
					localizacion = undefined;
					refrescarEsquema();
					return;
				}
				const actual = opcionesParaEntidades([{ tipo: opcion.tipo, id: opcion.id }])
					.find((o) => claveOpcion(o) === claveOpcion(opcion));
				if (!actual) { avisar('La ubicación cambió; vuelve a localizar el issue.', 'info'); return; }
				aplicarOpcionLocalizacion(actual, ev.detail === 0);
			};
			panel.append(boton);
		}
		ayuda.append(panel);
	}

	/** Índice de navegación ESQ-08. No adjudica páginas a retornos no descubiertos. */
	function pintarReferencias(ayuda: HTMLElement): void {
		const panel = document.createElement('details');
		panel.id = 'esq-referencias';
		panel.open = referenciasAbiertas;
		panel.style.textAlign = 'left';
		panel.style.marginTop = '5px';
		const titulo = document.createElement('summary');
		titulo.textContent = 'Referencias de E/S y circuitos por hoja';
		const contenido = document.createElement('div');
		contenido.id = 'esq-referencias-contenido';
		contenido.style.maxHeight = 'min(30vh, 260px)';
		contenido.style.overflowY = 'auto';
		contenido.style.padding = '4px 8px';
		const enlace = (texto: string, ubicacion: DestinoReferenciaEsquema, dispositivoId?: string) => {
			const boton = document.createElement('button');
			boton.type = 'button';
			boton.className = 'boton';
			boton.textContent = `${texto} · hoja ${ubicacion.numeroHoja}`
				+ (ubicacion.columna === undefined ? '' : `, col. ${ubicacion.columna}`);
			boton.dataset.hojaId = ubicacion.hojaId;
			if (ubicacion.representacionId) boton.dataset.representacionId = ubicacion.representacionId;
			boton.onclick = (ev) => irAReferencia(ubicacion, dispositivoId, ev.detail === 0);
			return boton;
		};
		const render = () => {
			if (!panel.open || !panel.isConnected) return;
			// Cada casilla atravesada repinta el SVG. Ni la proyección semántica ni el DOM
			// de todas las referencias se regeneran por pointermove: se actualizan al soltar.
			if (arrastrandoVista) {
				contenido.textContent = 'Las referencias se actualizarán al soltar la vista.';
				return;
			}
			const referencias = proyectarReferenciasEsquemaM2(proyecto(), hojasEsquema);
			contenido.replaceChildren();
			titulo.textContent = `Referencias de E/S y circuitos por hoja · ${referencias.canales.length} canal(es), `
				+ `${referencias.circuitos.length} circuito(s), ${referencias.diagnosticos.length} diagnóstico(s)`;
			const alcance = document.createElement('p');
			alcance.textContent = 'Circuitos: solo trayectos de alimentación identificados; no es un mapa exhaustivo de retornos.';
			contenido.append(alcance);
			const encabezadoIO = document.createElement('strong');
			encabezadoIO.textContent = 'Canal ↔ terminal';
			contenido.append(encabezadoIO);
			const listaIO = document.createElement('ul');
			for (const ref of referencias.canales) {
				const fila = document.createElement('li');
				fila.dataset.referenciaConductor = ref.conductorId;
				fila.textContent = `${ref.controladorId}:${ref.canalBorneId} (${ref.clase}, ${ref.calidad}) ↔ `
					+ `${ref.terminal.dispositivoId}:${ref.terminal.borneId} · cable ${ref.conductorId} · `;
				fila.append(enlace('Ver canal', ref.canal, ref.controladorId),
					document.createTextNode(' '),
					enlace('Ver terminal', ref.terminal.ubicacion, ref.terminal.dispositivoId));
				listaIO.append(fila);
			}
			if (!referencias.canales.length) {
				const vacio = document.createElement('li');
				vacio.textContent = 'No hay vínculos de E/S con dos anclajes únicos verificables.';
				listaIO.append(vacio);
			}
			contenido.append(listaIO);
			const encabezadoCircuitos = document.createElement('strong');
			encabezadoCircuitos.textContent = 'Circuito ↔ hojas';
			contenido.append(encabezadoCircuitos);
			const listaCircuitos = document.createElement('ul');
			for (const ref of referencias.circuitos) {
				const fila = document.createElement('li');
				fila.dataset.referenciaCircuito = ref.circuitoId;
				fila.textContent = `${ref.nombre} [${ref.circuitoId}] · topología ${ref.estadoTopologia} `
					+ `· ${ref.conductores.length} trayecto(s) identificado(s), ${ref.conductoresSinAncla.length} sin ancla · `;
				for (const hoja of ref.hojas) fila.append(enlace('Ver hoja', { hojaId: hoja.id, numeroHoja: hoja.numero }));
				listaCircuitos.append(fila);
			}
			if (!referencias.circuitos.length) {
				const vacio = document.createElement('li');
				vacio.textContent = 'No hay circuitos de alimentación identificados.';
				listaCircuitos.append(vacio);
			}
			contenido.append(listaCircuitos);
			if (referencias.diagnosticos.length) {
				const encabezado = document.createElement('strong');
				encabezado.textContent = 'Referencias no concluyentes';
				const lista = document.createElement('ul');
				for (const d of referencias.diagnosticos) {
					const fila = document.createElement('li');
					fila.dataset.referenciaDiagnostico = d.codigo;
					fila.textContent = `${d.codigo} · ${d.entidadId}${d.conductorId ? ` · ${d.conductorId}` : ''}: ${d.detalle}`;
					lista.append(fila);
				}
				contenido.append(encabezado, lista);
			}
		};
		panel.addEventListener('toggle', () => {
			if (!panel.isConnected) return;
			referenciasAbiertas = panel.open;
			if (panel.open) render();
		});
		panel.append(titulo, contenido);
		ayuda.append(panel);
		if (panel.open) render();
	}

	/** Una vista repuesta apunta al MISMO aparato; nunca crea un segundo circuito. */
	async function reponerVista(dispositivoId: string): Promise<void> {
		if (!ctx.puedeEditar()) return;
		const documento = proyecto();
		const firma = JSON.stringify(documento);
		const d = documento.dispositivos.find((x) => x.id === dispositivoId);
		const hoja = hojasEsquema[hojaActual];
		if (!d || !hoja || documento.esquema?.representaciones === undefined) return;
		const ocupadas = new Set(documento.esquema.representaciones
			.filter((r) => r.hojaId === hoja.id)
			.map((r) => `${r.posicion.columna}.${r.posicion.fila}`));
		let sugerencia = `${hoja.numero}.1.1`;
		buscarCasilla: for (let fila = 1; fila <= FILAS_ESQ; fila++) {
			for (let columna = 1; columna <= hoja.columnas; columna++) {
				if (!ocupadas.has(`${columna}.${fila}`)) {
					sugerencia = `${hoja.numero}.${columna}.${fila}`;
					break buscarCasilla;
				}
			}
		}
		const paginas = documento.hojas.map((h) => `${h.numero} ${h.titulo}`).join(' · ');
		const texto = await pedirTexto(
			`Reponer vista de ${d.designacion ?? d.id} [${d.id}] sin cambiar el aparato ni sus conexiones. `
			+ `Indica hoja.columna.fila (p. ej. ${sugerencia}). Hojas: ${paginas}`,
			sugerencia,
		);
		if (texto === null) return;
		if (proyecto() !== documento || JSON.stringify(documento) !== firma) {
			avisar('El proyecto cambió mientras elegías la casilla. Vuelve a intentarlo.', 'info');
			refrescarEsquema();
			return;
		}
		const partes = /^(\d+)\.(\d+)\.(\d+)$/.exec(texto.trim());
		const folios = partes ? documento.hojas.filter((h) => h.numero === Number(partes[1])) : [];
		if (!partes || folios.length !== 1) {
			avisar('Indica una hoja única y una casilla válida con formato hoja.columna.fila.', 'error');
			return;
		}
		const plan = planReponerRepresentacion(documento, dispositivoId, {
			hojaId: folios[0].id, columna: Number(partes[2]), fila: Number(partes[3]),
		});
		if (!plan.ok) { avisar(plan.motivo, 'error'); return; }
		if (!capturar()) return;
		documento.esquema!.representaciones!.push(plan.valor);
		representacionSeleccionada = plan.valor.id;
		conductorSeleccionado = undefined;
		marcarSucio();
		actualizarTodo();
		const indice = hojasEsquema.findIndex((h) => h.id === plan.valor.hojaId);
		if (indice >= 0) { hojaActual = indice; hojaSeleccionadaId = plan.valor.hojaId; }
		refrescarEsquema();
		avisar(`Vista ${plan.valor.id} repuesta; ${d.designacion ?? d.id} y sus conexiones conservan su identidad.`, 'ok');
	}

	/** Inspector de conexiones, vistas y problemas. Todo dato del proyecto entra como texto. */
	function pintarConductorSeleccionado(): void {
		pintarAccionesCopia();
		const ayuda = $('esq-ayuda');
		ayuda.replaceChildren();
		const c = proyecto().conductores.find((x) => x.id === conductorSeleccionado);
		const representaciones = proyecto().esquema?.representaciones;
		const vista = representaciones?.find((x) => x.id === representacionSeleccionada);
		if (origenConexion) {
			const detalle = document.createElement('span');
			detalle.textContent = `Origen: ${describirBorne(origenConexion.ref)} · Elige un borne destino, también en otra hoja. La ruta física quedará pendiente, sin metros ni material declarados.`;
			const cancelar = document.createElement('button');
			cancelar.id = 'esq-cancelar-conexion';
			cancelar.className = 'boton';
			cancelar.type = 'button';
			cancelar.textContent = 'Cancelar conexión';
			cancelar.onclick = () => { origenConexion = undefined; refrescarEsquema(); };
			ayuda.append(detalle, document.createTextNode(' · '), cancelar);
		} else if (c) {
			const detalle = document.createElement('span');
			detalle.textContent = `Conductor ${c.id}: ${describirBorne(c.de)} ↔ ${describirBorne(c.a)}`
				+ (c.estadoRutaFisica === 'pendiente' ? ' · ruta física pendiente, sin longitud declarada' : '');
			const boton = document.createElement('button');
			boton.id = 'esq-desconectar';
			boton.className = 'boton';
			boton.type = 'button';
			boton.textContent = 'Desconectar';
			boton.setAttribute('aria-label', `Desconectar conductor ${c.id}`);
			boton.onclick = async () => {
				// Los ejemplos se pueden inspeccionar, pero no debe preguntarse por una mutación vetada.
				if (!ctx.puedeEditar()) return;
				const documento = proyecto();
				const actual = documento.conductores.find((x) => x.id === c.id);
				if (actual !== c) { refrescarEsquema(); return; }
				const ruta = c.estadoRutaFisica === 'pendiente'
					? ' Su ruta física aún no se ha definido.'
					: c.trazado?.length ? ` Tiene ${c.trazado.length} puntos de ruta manual.` : '';
				const confirmado = await confirmar(
					`¿Desconectar ${c.id} entre ${describirBorne(c.de)} y ${describirBorne(c.a)}? `
					+ `Se quitará del esquema, tablero, simulación y listas.${ruta} Ctrl+Z permite deshacer.`,
					{ ok: 'Desconectar', peligro: true },
				);
				if (!confirmado) return;
				// Un diálogo es asíncrono: no se aplica su respuesta a otro proyecto o conductor.
				if (proyecto() !== documento || documento.conductores.find((x) => x.id === c.id) !== c) {
					avisar('La conexión cambió mientras confirmabas. Selecciónala de nuevo.', 'info');
					refrescarEsquema();
					return;
				}
				if (!ctx.desconectarConductor(c.id)) return;
				conductorSeleccionado = undefined;
				refrescarEsquema();
			};
			ayuda.append(detalle, document.createTextNode(' · '), boton);
		} else if (vista) {
			const d = proyecto().dispositivos.find((x) => x.id === vista.dispositivoId);
			const descripcion = vista.parte.tipo === 'contactos'
				? `${vista.parte.pares.length} contacto(s)` : vista.parte.tipo;
			const detalle = document.createElement('span');
			detalle.textContent = `Vista ${vista.id} · ${d?.designacion ?? vista.dispositivoId} [${vista.dispositivoId}] · ${descripcion} · hoja ${vista.hojaId}, casilla ${vista.posicion.columna}.${vista.posicion.fila}`;
			const referencias = hojasEsquema.flatMap((h) => h.referencias
				.filter((ref) => ref.representacionId === vista.id)
				.map((ref) => ref.texto));
			if (referencias.length) detalle.textContent += ` · Referencias: ${referencias.join(' · ')}`;
			const simbolosDeVista = hojasEsquema.flatMap((h) => h.simbolos
				.filter((s) => s.representacionId === vista.id)
				.map((s) => ({ hojaId: h.id, plantilla: s.plantilla })));
			// La ficha pertenece al símbolo montado que ve el usuario; no recalcular su geometría
			// ni atribuir una plantilla si el ID aparece dos veces o en otra hoja.
			const plantilla = d && simbolosDeVista.length === 1 && simbolosDeVista[0].hojaId === vista.hojaId
				? simbolosDeVista[0].plantilla : undefined;
			const procedencia = document.createElement('details');
			procedencia.id = 'esq-plantilla-procedencia';
			procedencia.open = procedenciaAbierta;
			const cabecera = document.createElement('summary');
			const nombreFamilia = plantilla ? ({ dedicado: 'símbolo dedicado',
				'bloque-funcional': 'bloque funcional', generico: 'símbolo genérico',
				parte: 'parte funcional' } as const)[plantilla.familia] : undefined;
			cabecera.textContent = plantilla
				? `Simbología: ${nombreFamilia} [${plantilla.id}] · CONFORMIDAD NO VERIFICADA`
				: 'Simbología: sin plantilla representable · NO VERIFICADO';
			procedencia.append(cabecera);
			if (plantilla) {
				procedencia.dataset.plantillaId = plantilla.id;
				procedencia.dataset.familia = plantilla.familia;
				procedencia.dataset.conformidad = plantilla.conformidadNormativa;
				const origen = document.createElement('p');
				origen.textContent = `Origen gráfico: trazos generados en el editor (${plantilla.archivo}). No es una biblioteca IEC certificada.`;
				const licencia = document.createElement('p');
				licencia.textContent = `Licencia del proyecto declarada: ${plantilla.licenciaDeclarada}. `
					+ 'La autoría y licencia individual de este símbolo no están verificadas.';
				const norma = document.createElement('p');
				norma.textContent = 'Conformidad normativa: NO VERIFICADA; esta vista no certifica el plano ni la fabricación.';
				procedencia.append(origen, licencia, norma);
			} else {
				const pendiente = document.createElement('p');
				pendiente.textContent = 'No hay una proyección gráfica única y válida para atribuirle una plantilla. Revisa los pendientes del esquema.';
				procedencia.append(pendiente);
			}
			procedencia.addEventListener('toggle', () => {
				if (procedencia.isConnected) procedenciaAbierta = procedencia.open;
			});
			ayuda.append(detalle, procedencia);
			const boton = document.createElement('button');
			boton.id = 'esq-borrar-representacion';
			boton.className = 'boton';
			boton.type = 'button';
			boton.textContent = 'Borrar vista';
			boton.setAttribute('aria-label', `Borrar representación ${vista.id} sin borrar aparato`);
			boton.onclick = async () => {
				if (!ctx.puedeEditar()) return;
				const documento = proyecto();
				if (documento.esquema?.representaciones?.find((x) => x.id === vista.id) !== vista) return;
				const confirmado = await confirmar(
					`¿Borrar solo la vista ${vista.id} de ${d?.designacion ?? vista.dispositivoId}? `
					+ 'El aparato y sus conductores seguirán en el proyecto; las conexiones sin vista quedarán pendientes. Ctrl+Z permite deshacer.',
					{ ok: 'Borrar vista', peligro: true },
				);
				if (!confirmado) return;
				const lista = documento.esquema?.representaciones;
				if (proyecto() !== documento || !lista || lista.find((x) => x.id === vista.id) !== vista) {
					avisar('La vista cambió mientras confirmabas. Selecciónala de nuevo.', 'info');
					refrescarEsquema();
					return;
				}
				if (!capturar()) return;
				lista.splice(lista.indexOf(vista), 1);
				representacionSeleccionada = undefined;
				marcarSucio();
				actualizarTodo();
				refrescarEsquema();
				avisar(`Vista ${vista.id} borrada; ${d?.designacion ?? vista.dispositivoId} permanece en el proyecto.`, 'ok');
			};
			ayuda.append(document.createTextNode(' · '), boton);
			if (d) {
				const borrarAparato = document.createElement('button');
				borrarAparato.id = 'esq-eliminar-dispositivo';
				borrarAparato.className = 'boton peligro';
				borrarAparato.type = 'button';
				borrarAparato.textContent = 'Eliminar aparato…';
				borrarAparato.setAttribute('aria-label', `Eliminar aparato eléctrico ${d.designacion ?? d.id} y sus dependencias`);
				borrarAparato.onclick = async () => {
					if (!ctx.puedeEditar()) return;
					const documento = proyecto();
					if (documento.esquema?.representaciones?.find((x) => x.id === vista.id) !== vista
						|| !documento.dispositivos.some((x) => x.id === d.id)) {
						refrescarEsquema();
						return;
					}
					await ctx.eliminarDispositivo(d.id);
					if (proyecto() === documento && !documento.dispositivos.some((x) => x.id === d.id)) {
						representacionSeleccionada = undefined;
						conductorSeleccionado = undefined;
					}
					refrescarEsquema();
				};
				ayuda.append(document.createTextNode(' · '), borrarAparato);
			}
			if (vista.parte.tipo === 'completa' && d && resolverComportamiento(d)?.clase === 'contactos-electromagneticos') {
				const desdoblar = document.createElement('button');
				desdoblar.id = 'esq-desdoblar';
				desdoblar.className = 'boton';
				desdoblar.type = 'button';
				desdoblar.textContent = 'Desdoblar funciones';
				desdoblar.onclick = () => abrirFormularioDesdoblamiento(vista.id);
				ayuda.append(document.createTextNode(' · '), desdoblar);
			}
		} else {
			conductorSeleccionado = undefined;
			representacionSeleccionada = undefined;
			ayuda.textContent = representaciones !== undefined
				? 'Selecciona una vista o un conductor para inspeccionarlo. Arrastra una vista para moverla; el circuito no cambia.'
				: 'Arrastra cualquier símbolo para colocarlo donde quieras · los hilos lo siguen · selecciona un hilo para ver sus bornes';
		}
		const problemas = hojasEsquema[hojaActual]?.problemas ?? [];
		if (problemas.length) {
			const panel = document.createElement('details');
			panel.id = 'esq-problemas';
			panel.open = true;
			const titulo = document.createElement('summary');
			titulo.textContent = `${problemas.length} pendiente(s) en esta hoja`;
			const lista = document.createElement('ul');
			for (const problema of problemas) {
				const fila = document.createElement('li');
				fila.textContent = problema.mensaje;
				if (problema.codigo === 'aparato-sin-representacion' && problema.dispositivoId) {
					const boton = document.createElement('button');
					boton.className = 'boton';
					boton.type = 'button';
					boton.dataset.reponerDispositivo = problema.dispositivoId;
					boton.textContent = 'Reponer vista…';
					boton.onclick = () => { void reponerVista(problema.dispositivoId!); };
					fila.append(document.createTextNode(' · '), boton);
				}
				lista.append(fila);
			}
			panel.append(titulo, lista);
			ayuda.append(panel);
		}
		if (representaciones === undefined) {
			const activar = document.createElement('button');
			activar.id = 'esq-activar-vistas';
			activar.className = 'boton';
			activar.type = 'button';
			activar.textContent = 'Activar vistas editables';
			activar.onclick = () => { void activarRepresentacionesLegacy(); };
			ayuda.append(document.createTextNode(' · '), activar);
		}
		const dispositivo = !c && (vista?.dispositivoId ?? ctx.dispositivoSeleccionado());
		const idVisible = dispositivo && hojasEsquema[hojaActual]?.simbolos.some((s) => s.dispositivoId === dispositivo)
			? dispositivo : undefined;
		if (c || idVisible) {
			const tipo = c ? 'CONDUCTOR' as const : 'DEVICE' as const;
			const id = c?.id ?? idVisible!;
			const tablero = document.createElement('button');
			tablero.id = 'esq-ver-en-tablero';
			tablero.className = 'boton';
			tablero.type = 'button';
			tablero.textContent = c ? 'Ver cable en tablero' : 'Ver en tablero';
			tablero.onclick = () => ctx.verEnTablero(tipo, id);
			ayuda.append(document.createTextNode(' · '), tablero);
			if (idVisible && ctx.verDatosTecnicos) {
				const datos = document.createElement('button');
				datos.id = 'esq-ver-datos-tecnicos';
				datos.className = 'boton';
				datos.type = 'button';
				datos.textContent = 'Datos técnicos';
				datos.onclick = () => ctx.verDatosTecnicos!(idVisible);
				ayuda.append(document.createTextNode(' · '), datos);
			}
		}
		pintarLocalizador(ayuda);
		pintarReferencias(ayuda);
	}

	async function activarRepresentacionesLegacy(): Promise<void> {
		if (!ctx.puedeEditar()) return;
		const documento = proyecto();
		const plan = planActivacionRepresentaciones(documento, ctx.potenciales());
		if (!plan.ok) { avisar(plan.motivo, 'info'); return; }
		const antes = JSON.stringify(documento);
		const folios = plan.valor.foliosVisibles.map((h) => {
			const cambioVisible = !h.nueva && (h.titulo !== h.tituloLegacy || h.columnas !== h.columnasLegacy)
				? ` (dibujo anterior: «${h.tituloLegacy}», ${h.columnasLegacy} columnas)` : '';
			return `Hoja ${h.numero} «${h.titulo}» [${h.id}], ${h.columnas} columnas: ${h.simbolos} vista(s)`
				+ `${h.nueva ? ', folio nuevo' : ', folio existente'}${cambioVisible}`;
		});
		const confirmado = await confirmar(
			`¿Activar vistas M2 en este esquema? Se conservarán ${plan.valor.representaciones.length} aparatos como vistas completas `
			+ `en ${plan.valor.foliosVisibles.length} hoja(s):\n${folios.join('\n')}`
			+ (plan.valor.hojasConservadasSinDibujo
				? `\n${plan.valor.hojasConservadasSinDibujo} hoja(s) adicionales seguirán en el proyecto.` : '')
			+ `\nLos ${documento.conductores.length} conductores y todos los aparatos permanecen intactos. Ctrl+Z deshace la activación.`,
			{ ok: 'Activar vistas' },
		);
		if (!confirmado) return;
		if (proyecto() !== documento || JSON.stringify(documento) !== antes) {
			avisar('El proyecto cambió mientras confirmabas; vuelve a revisar la conversión.', 'info');
			return;
		}
		if (!capturar()) return;
		documento.hojas = plan.valor.hojas;
		documento.esquema = { ...documento.esquema, representaciones: plan.valor.representaciones };
		const idHojaActual = plan.valor.foliosVisibles[hojaActual]?.id;
		marcarSucio();
		actualizarTodo();
		hojaActual = Math.max(0, hojasEsquema.findIndex((h) => h.id === idHojaActual));
		hojaSeleccionadaId = idHojaActual;
		refrescarEsquema();
		avisar(`${plan.valor.representaciones.length} vistas activadas sin cambiar el circuito.`, 'ok');
	}

	function abrirFormularioDesdoblamiento(vistaId: string): void {
		const documento = proyecto();
		const plan = planPartesDesdoblamiento(documento, vistaId);
		if (!plan.ok) { avisar(plan.motivo, 'info'); return; }
		const anterior = $('esq-desdoblar-formulario');
		if (anterior) {
			const mismo = anterior.dataset.vistaId === vistaId;
			anterior.remove();
			documentoFormulario = undefined;
			if (mismo) return;
		}
		const caja = document.createElement('div');
		caja.id = 'esq-desdoblar-formulario';
		caja.dataset.vistaId = vistaId;
		caja.style.padding = '8px 12px';
		caja.style.background = 'var(--panel)';
		const instrucciones = document.createElement('p');
		instrucciones.textContent = `Desdoblar ${vistaId}: elige hoja y casilla para cada función; puedes recorrer las hojas sin perder estos valores.`;
		caja.append(instrucciones);
		const ordenadas = [...documento.hojas].sort((a, b) => a.numero - b.numero || a.id.localeCompare(b.id));
		const casillas = new Set((documento.esquema?.representaciones ?? [])
			.filter((r) => r.id !== vistaId)
			.map((r) => JSON.stringify([r.hojaId, r.posicion.columna, r.posicion.fila])));
		const elegirCasilla = (hojaId: string, columna: number, fila: number): { columna: number; fila: number } => {
			const h = documento.hojas.find((item) => item.id === hojaId)!;
			const max = Math.max(4, Math.min(20, h.columnas ?? documento.esquema?.columnasPorHoja ?? 10));
			for (let desplazamiento = 0; desplazamiento < max * FILAS_ESQ; desplazamiento++) {
				const indice = ((fila - 1) * max + columna - 1 + desplazamiento) % (max * FILAS_ESQ);
				const col = (indice % max) + 1;
				const fil = Math.floor(indice / max) + 1;
				const clave = JSON.stringify([hojaId, col, fil]);
				if (!casillas.has(clave)) { casillas.add(clave); return { columna: col, fila: fil }; }
			}
			return { columna, fila };
		};
		const filas: { funcion: 'bobina' | 'polos' | 'auxiliares'; hoja: HTMLSelectElement;
			columna: HTMLInputElement; fila: HTMLInputElement }[] = [];
		for (const parte of plan.valor.partes) {
			const fila = document.createElement('div');
			const etiqueta = document.createElement('label');
			etiqueta.textContent = `${parte.funcion} (${parte.bornes.join(', ')}) · `;
			const hoja = document.createElement('select');
			hoja.id = `esq-desdoblar-hoja-${parte.funcion}`;
			for (const h of ordenadas) {
				const opcion = document.createElement('option');
				opcion.value = h.id;
				opcion.textContent = `${h.numero} · ${h.titulo}`;
				hoja.append(opcion);
			}
			hoja.value = plan.valor.origen.hojaId;
			const sugerida = elegirCasilla(hoja.value,
				plan.valor.origen.posicion.columna, plan.valor.origen.posicion.fila);
			const columna = document.createElement('input');
			columna.id = `esq-desdoblar-columna-${parte.funcion}`;
			columna.type = 'number'; columna.min = '1'; columna.max = '20';
			columna.style.width = '4em';
			columna.value = String(sugerida.columna);
			const numeroFila = document.createElement('input');
			numeroFila.id = `esq-desdoblar-fila-${parte.funcion}`;
			numeroFila.type = 'number'; numeroFila.min = '1'; numeroFila.max = String(FILAS_ESQ);
			numeroFila.style.width = '4em';
			numeroFila.value = String(sugerida.fila);
			etiqueta.append(hoja, document.createTextNode(' col. '), columna,
				document.createTextNode(' fila '), numeroFila);
			fila.append(etiqueta);
			caja.append(fila);
			filas.push({ funcion: parte.funcion, hoja, columna, fila: numeroFila });
		}
		const aplicar = document.createElement('button');
		aplicar.id = 'esq-desdoblar-aplicar';
		aplicar.className = 'boton primario';
		aplicar.type = 'button';
		aplicar.textContent = 'Previsualizar y desdoblar';
		aplicar.onclick = async () => {
			if (!ctx.puedeEditar()) return;
			const destinos: DestinosDesdoblamiento = {};
			for (const f of filas) destinos[f.funcion] = { hojaId: f.hoja.value,
				columna: Number(f.columna.value), fila: Number(f.fila.value) };
			const reemplazo = planDesdoblamientoRepresentacion(documento, vistaId, destinos);
			if (!reemplazo.ok) { avisar(reemplazo.motivo, 'info'); return; }
			const antes = JSON.stringify(documento);
			const ubicaciones = reemplazo.valor.map((r, i) => {
				const h = documento.hojas.find((item) => item.id === r.hojaId)!;
				return `${plan.valor.partes[i].funcion}: ${h.numero} «${h.titulo}», ${r.posicion.columna}.${r.posicion.fila}`;
			});
			const confirmado = await confirmar(
				`¿Reemplazar la vista completa ${vistaId} por ${reemplazo.valor.length} vistas funcionales?\n`
				+ ubicaciones.join('\n')
				+ `\nEl aparato y los ${documento.conductores.length} conductores no se duplican ni se borran. Ctrl+Z deshace todo.`,
				{ ok: 'Desdoblar' },
			);
			if (!confirmado) return;
			if (proyecto() !== documento || JSON.stringify(documento) !== antes) {
				avisar('El proyecto cambió mientras confirmabas; revisa las posiciones otra vez.', 'info');
				return;
			}
			const lista = documento.esquema?.representaciones;
			const indice = lista?.findIndex((r) => r.id === vistaId) ?? -1;
			if (!lista || indice < 0 || !capturar()) return;
			lista.splice(indice, 1, ...reemplazo.valor);
			caja.remove();
			documentoFormulario = undefined;
			representacionSeleccionada = reemplazo.valor[0]?.id;
			hojaActual = Math.max(0, hojasEsquema.findIndex((h) => h.id === reemplazo.valor[0]?.hojaId));
			hojaSeleccionadaId = reemplazo.valor[0]?.hojaId;
			marcarSucio();
			actualizarTodo();
			refrescarEsquema();
			avisar(`${reemplazo.valor.length} vistas funcionales creadas para el mismo aparato.`, 'ok');
		};
		caja.append(aplicar);
		documentoFormulario = documento;
		$('panel-esquema').append(caja);
	}

	/**
	 * Cuántas hojas hay para donde arrastrar. Se cuenta UNA MÁS que las montadas: cuando una hoja
	 * se llena, lo que se hace es llevar un aparato a la siguiente, y esa todavía no existe.
	 */
	const totalHojas = (): number => Math.max(1, hojasEsquema.length) + 1;

	/** El borne ha de seguir perteneciendo a exactamente una vista, incluso tras navegar o deshacer. */
	function anclaVigente(ref: RefBorne, representacionId: string, hojaId: string): boolean {
		const vistas = hojasEsquema.flatMap((hoja) => hoja.simbolos
			.filter((s) => s.dispositivoId === ref.dispositivoId && s.pines.has(ref.borneId))
			.map((s) => ({ hojaId: hoja.id, representacionId: s.representacionId })));
		return vistas.length === 1 && vistas[0].hojaId === hojaId
			&& vistas[0].representacionId === representacionId;
	}

	async function elegirBorne(ref: RefBorne, representacionId: string, hojaId: string): Promise<void> {
		const documento = proyecto();
		limpiarGrupoRepresentaciones();
		if (!anclaVigente(ref, representacionId, hojaId)) {
			avisar('Ese borne ya no tiene una vista única. Actualiza el esquema antes de conectar.', 'info');
			refrescarEsquema();
			return;
		}
		if (!ctx.puedeEditar()) return;
		const origen = origenConexion;
		if (!origen || origen.documento !== documento) {
			origenConexion = { ref: { ...ref }, representacionId, hojaId, documento };
			conductorSeleccionado = undefined;
			representacionSeleccionada = undefined;
			refrescarEsquema();
			return;
		}
		if (origen.ref.dispositivoId === ref.dispositivoId && origen.ref.borneId === ref.borneId) {
			origenConexion = undefined;
			refrescarEsquema();
			return;
		}
		const propuesta = proponerConductorPendiente(documento, hojasEsquema, origen.ref, ref);
		if (!propuesta.ok) { avisar(propuesta.motivo, 'info'); return; }
		const antes = JSON.stringify(documento);
		const confirmado = await confirmar(
			`¿Conectar eléctricamente ${describirBorne(origen.ref)} con ${describirBorne(ref)}? `
			+ 'Se creará un solo conductor con ruta física pendiente: no se declararán metros, sección, color ni material de cable. Ctrl+Z permite deshacer.',
			{ ok: 'Conectar' },
		);
		if (!confirmado) {
			if (origenConexion === origen) origenConexion = undefined;
			refrescarEsquema();
			return;
		}
		if (proyecto() !== documento || JSON.stringify(documento) !== antes || origenConexion !== origen
			|| !anclaVigente(origen.ref, origen.representacionId, origen.hojaId)
			|| !anclaVigente(ref, representacionId, hojaId)) {
			origenConexion = undefined;
			avisar('El esquema cambió mientras confirmabas. Elige los bornes de nuevo.', 'info');
			refrescarEsquema();
			return;
		}
		origenConexion = undefined;
		const id = ctx.conectarPendiente(origen.ref, ref, documento);
		if (id) {
			conductorSeleccionado = id;
			representacionSeleccionada = undefined;
		}
		refrescarEsquema();
	}

	/** Vuelve a montar el esquema desde el modelo actual y lo pinta. */
	function refrescarEsquema(): void {
		if (!esquemaAbierto) return;
		if (proyecto().esquema?.representaciones === undefined) {
			limpiarGrupoRepresentaciones();
			$('esq-folios-panel').hidden = true;
			$('esq-folios').hidden = true;
		}
		const formulario = document.getElementById('esq-desdoblar-formulario');
		if (formulario && (documentoFormulario !== proyecto()
			|| !proyecto().esquema?.representaciones?.some((r) => r.id === formulario.dataset.vistaId))) {
			formulario.remove();
			documentoFormulario = undefined;
		}
		hojasEsquema = montarEsquema(proyecto(), ctx.potenciales());
		if (origenConexion && (origenConexion.documento !== proyecto()
			|| !anclaVigente(origenConexion.ref, origenConexion.representacionId, origenConexion.hojaId))) {
			origenConexion = undefined;
		}
		if (hojasEsquema.length === 0) {
			limpiarGrupoRepresentaciones();
			hojaSeleccionadaId = undefined;
			$('esq-folios').hidden = proyecto().esquema?.representaciones === undefined;
			conductorSeleccionado = undefined;
			representacionSeleccionada = undefined;
			$('esquema-hoja').innerHTML = '<div id="esquema-vacio">Todavía no hay nada que dibujar.<br>'
				+ 'Coloca aparatos y conéctalos, y el esquema se dibuja solo.</div>';
			$('esq-indicador').textContent = 'Sin hojas';
			$('esq-titulo').textContent = '';
			$('esq-formato-actual').textContent = '';
			pintarConductorSeleccionado();
			pintarEstadoEsquema();
			pintarPanelFolios();
			return;
		}
		const indicePorId = hojasEsquema.findIndex((h) => h.id === hojaSeleccionadaId);
		hojaActual = indicePorId >= 0 ? indicePorId : Math.max(0, Math.min(hojaActual, hojasEsquema.length - 1));
		const hoja = hojasEsquema[hojaActual];
		hojaSeleccionadaId = hoja.id;
		if (grupoVistaIds.size && (grupoDocumento !== proyecto() || grupoHojaId !== hoja.id
			|| [...grupoVistaIds].some((id) => !hoja.simbolos.some((s) => s.representacionId === id)
				|| !proyecto().esquema?.representaciones?.some((r) => r.id === id && r.hojaId === hoja.id)))) {
			limpiarGrupoRepresentaciones();
		}
		if (!hoja.hilos.some((h) => h.conductorId === conductorSeleccionado)
			&& !hoja.referencias.some((r) => r.tipo === 'enlace' && r.conductorId === conductorSeleccionado)) {
			conductorSeleccionado = undefined;
		}
		const explicito = proyecto().esquema?.representaciones !== undefined;
		$('esq-folios').hidden = !explicito;
		$('esquema-hoja').innerHTML = hojaASvg(hoja, {
			proyecto: proyecto().nombre,
			datos: proyecto().datos,
			totalHojas: hojasEsquema.length,
			resaltado: conductorSeleccionado ? undefined : ctx.dispositivoSeleccionado(),
			resaltadoConductor: conductorSeleccionado,
			resaltadoRepresentacion: conductorSeleccionado ? undefined : representacionSeleccionada,
			resaltadoBorne: origenConexion?.ref,
			interactivo: true,
			bornesInteractivos: explicito,
		});
		$('esq-indicador').textContent = `Hoja ${hoja.numero} / ${hojasEsquema.length}`;
		$('esq-titulo').textContent = hoja.titulo;
		$('esq-formato-actual').textContent = `${proyecto().hojas.find((h) => h.id === hoja.id)?.formatoPapel ?? 'A3'} apaisado`;
		($('esq-columnas') as HTMLInputElement).value = String(hoja.columnas);
		// Se dice cuántos aparatos están colocados a mano: si no, «Ordenar solo» parece que no hace
		// nada cuando no hay nada que soltar, y sorprende cuando sí lo hay.
		const aMano = proyecto().dispositivos.filter((d) => d.esquema).length;
		const auto = $('esq-auto') as HTMLButtonElement;
		auto.disabled = explicito;
		auto.textContent = explicito ? 'Ordenar solo (no disponible para vistas M2)'
			: aMano ? `⟲ Ordenar solo (${aMano})` : '⟲ Ordenar solo';
		pintarConductorSeleccionado();
		aplicarZoomEsquema();
		pintarEstadoEsquema();
		pintarGrupoRepresentaciones();
		pintarPanelFolios();

		for (const g of $('esquema-hoja').querySelectorAll<SVGGElement>('.hilo[data-conductor], .referencia-conductor[data-conductor]')) {
			const seleccionarConductor = (): void => {
				const id = g.getAttribute('data-conductor');
				if (!id || !proyecto().conductores.some((c) => c.id === id)) return;
				limpiarGrupoRepresentaciones();
				origenConexion = undefined;
				conductorSeleccionado = id;
				representacionSeleccionada = undefined;
				refrescarEsquema();
			};
			g.addEventListener('click', (ev) => { ev.stopPropagation(); seleccionarConductor(); });
			g.addEventListener('keydown', (ev) => {
				if (ev.key !== 'Enter' && ev.key !== ' ') return;
				ev.preventDefault();
				seleccionarConductor();
			});
		}

		for (const g of $('esquema-hoja').querySelectorAll<SVGGElement>('.borne-esq[data-borne]')) {
			g.addEventListener('pointerdown', (ev) => ev.stopPropagation());
			const elegir = (): void => {
				const dispositivoId = g.getAttribute('data-dispositivo');
				const borneId = g.getAttribute('data-borne');
				const representacionId = g.getAttribute('data-representacion');
				if (dispositivoId && borneId && representacionId) {
					void elegirBorne({ dispositivoId, borneId }, representacionId, hoja.id);
				}
			};
			g.addEventListener('click', (ev) => { ev.stopPropagation(); elegir(); });
			g.addEventListener('keydown', (ev) => {
				if (ev.key !== 'Enter' && ev.key !== ' ') return;
				ev.preventDefault();
				ev.stopPropagation();
				elegir();
			});
		}

		// Pinchar un símbolo selecciona ese aparato en todo el programa —el esquema y el 3D son dos
		// vistas del mismo tablero— y arrastrarlo lo COLOCA donde se suelte.
		for (const g of $('esquema-hoja').querySelectorAll<SVGGElement>('.simbolo[data-dispositivo]')) {
			g.addEventListener('pointerdown', (ev) => empezarArrastreEsquema(ev, g));
			g.addEventListener('keydown', (ev) => {
				if (ev.key !== 'Enter' && ev.key !== ' ') return;
				const id = g.getAttribute('data-representacion');
				if (!id || !proyecto().esquema?.representaciones?.some((r) => r.id === id)) return;
				ev.preventDefault();
				ev.stopPropagation();
				if (ev.shiftKey && ev.key === 'Enter') { alternarVistaEnGrupo(id, true); return; }
				limpiarGrupoRepresentaciones();
				origenConexion = undefined;
				representacionSeleccionada = id;
				conductorSeleccionado = undefined;
				const aparato = g.getAttribute('data-dispositivo');
				if (aparato) seleccionar(aparato);
				refrescarEsquema();
			});
		}
	}

	/* ------------------- Colocar los símbolos del esquema a mano ------------------- */

	/** Mueve la vista M2 por su ID gráfico; ni el aparato ni sus cables cambian. */
	function empezarArrastreRepresentacion(ev: PointerEvent, g: SVGGElement): void {
		if (cancelarArrastreM2) { ev.preventDefault(); return; }
		const id = g.getAttribute('data-representacion');
		const hoja = hojasEsquema[hojaActual];
		const documento = proyecto();
		const lista = documento.esquema?.representaciones;
		const vista = lista?.find((r) => r.id === id);
		if (!id || !hoja || !vista || vista.hojaId !== hoja.id || ev.button !== 0) return;
		const d = documento.dispositivos.find((x) => x.id === vista.dispositivoId);
		const simbolo = hoja.simbolos.find((s) => s.representacionId === id);
		if (!d || !simbolo) return;
		ev.preventDefault();
		origenConexion = undefined;
		conductorSeleccionado = undefined;
		representacionSeleccionada = id;
		seleccionar(d.id);
		pintarConductorSeleccionado();
		if (!ctx.puedeEditar()) return;

		let svg = $('esquema-hoja').querySelector<SVGSVGElement>('svg');
		if (!svg) return;
		const svgVigente = (): SVGSVGElement | null => {
			// Una selección externa puede remontar la hoja durante el gesto; no medir un SVG desacoplado.
			if (!svg?.isConnected) svg = $('esquema-hoja').querySelector<SVGSVGElement>('svg');
			return svg;
		};
		const punteroId = ev.pointerId;
		const aviso = $('esq-movimiento-aviso');
		const papel = { ancho: hoja.anchoMm, alto: hoja.altoMm };
		const inicial: PosicionMovimientoRepresentacion = {
			hojaId: hoja.id, columna: simbolo.columna,
			fila: filaDeAltura(simbolo.y + simbolo.alto / 2, papel),
		};
		const indiceHoja = hojaActual;
		let movido = false;
		let claveAnterior = '';
		let planPendiente: PlanMovimientoRepresentacion | undefined;
		let guia: SVGRectElement | undefined;
		const mismoOrigen = (r: PosicionMovimientoRepresentacion): boolean =>
			r.hojaId === inicial.hojaId && r.columna === inicial.columna && r.fila === inicial.fila;
		const limpiar = (): void => {
			window.removeEventListener('pointermove', alMover);
			window.removeEventListener('pointerup', alSoltar);
			window.removeEventListener('pointercancel', alCancelarPuntero);
			window.removeEventListener('keydown', alTecla, true);
			window.removeEventListener('blur', alCancelar);
			$('esquema-hoja').classList.remove('arrastrando');
			arrastrandoVista = false;
			cancelarArrastreM2 = undefined;
			aviso.hidden = true;
			guia?.remove();
		};
		const vigente = (): boolean => proyecto() === documento && !!esquemaAbierto
			&& documento.esquema?.representaciones === lista;
		const rejillaEn = (cx: number, cy: number): PosicionMovimientoRepresentacion | undefined => {
			const actual = svgVigente();
			if (!actual) return undefined;
			const caja = actual.getBoundingClientRect();
			if (caja.width < 1 || caja.height < 1 || cx < caja.left || cx > caja.right
				|| cy < caja.top || cy > caja.bottom) return undefined;
			const xmm = ((cx - caja.left) / caja.width) * hoja.anchoMm;
			const ymm = ((cy - caja.top) / caja.height) * hoja.altoMm;
			const mediaFila = (alturaDeFila(2, papel) - alturaDeFila(1, papel)) / 2;
			if (ymm < alturaDeFila(1, papel) - mediaFila || ymm > alturaDeFila(FILAS_ESQ, papel) + mediaFila) return undefined;
			const enHoja = Math.floor((xmm - MARGEN.izq) / anchoColumna(papel, hoja.columnas));
			let indice = indiceHoja;
			let columna = enHoja + 1;
			if (columna < 1) {
				indice--;
				if (indice < 0) return undefined;
				columna = hojasEsquema[indice].columnas;
			} else if (columna > hoja.columnas) {
				indice++;
				if (indice >= hojasEsquema.length) return undefined;
				columna = 1;
			}
			return { hojaId: hojasEsquema[indice].id, columna, fila: filaDeAltura(ymm, papel) };
		};
		const pintarDestino = (destino: PosicionMovimientoRepresentacion | undefined): void => {
			if (!destino || !planPendiente?.ok || destino.hojaId !== hoja.id) {
				guia?.remove();
				guia = undefined;
				return;
			}
			const actual = svgVigente();
			if (!actual) return;
			if (guia && guia.ownerSVGElement !== actual) { guia.remove(); guia = undefined; }
			if (!guia) {
				guia = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				guia.classList.add('guia-suelta');
				guia.setAttribute('fill', '#268cd022');
				guia.setAttribute('stroke', '#1679bd');
				guia.setAttribute('stroke-width', '0.9');
				guia.setAttribute('stroke-dasharray', '2 1.5');
				actual.append(guia);
			}
			const paso = anchoColumna(papel, hoja.columnas);
			guia.setAttribute('x', String(MARGEN.izq + (destino.columna - 0.5) * paso - Math.min(paso - 2, simbolo.ancho + 4) / 2));
			guia.setAttribute('y', String(alturaDeFila(destino.fila, papel) - (simbolo.alto + 4) / 2));
			guia.setAttribute('width', String(Math.min(paso - 2, simbolo.ancho + 4)));
			guia.setAttribute('height', String(simbolo.alto + 4));
		};
		const proponer = (cx: number, cy: number): void => {
			// Un clic con leve temblor no es un traslado, incluso si el rótulo del símbolo
			// sobresale del centro de la casilla y sus píxeles caen fuera de la rejilla.
			if (!movido && Math.hypot(cx - ev.clientX, cy - ev.clientY) < 4) return;
			const destino = rejillaEn(cx, cy);
			const clave = destino ? `${destino.hojaId}:${destino.columna}:${destino.fila}` : 'fuera';
			if (clave === claveAnterior) return;
			claveAnterior = clave;
			if (destino && mismoOrigen(destino) && !movido) return;
			movido = true;
			arrastrandoVista = true;
			$('esquema-hoja').classList.add('arrastrando');
			planPendiente = destino
				? previsualizarMovimientoRepresentacion(documento, id!, destino)
				: { ok: false, motivo: 'Suelta la vista dentro de una casilla de hoja.' };
			aviso.hidden = false;
			if (!planPendiente.ok) {
				aviso.dataset.estado = 'invalido';
				aviso.textContent = `Destino no disponible: ${planPendiente.motivo}`;
			} else if (planPendiente.noOp) {
				aviso.dataset.estado = 'sin-cambio';
				aviso.textContent = 'Casilla de origen: soltar aquí no modifica el esquema.';
			} else {
				aviso.dataset.estado = 'valido';
				const folio = hojasEsquema.find((h) => h.id === destino!.hojaId);
				aviso.textContent = `Destino libre: hoja ${folio?.numero ?? destino!.hojaId}, casilla ${destino!.columna}.${destino!.fila}. Suelta para colocar.`;
			}
			pintarDestino(destino);
		};
		const alMover = (e: PointerEvent): void => {
			if (e.pointerId !== punteroId) return;
			if (!vigente()) { limpiar(); return; }
			proponer(e.clientX, e.clientY);
		};
		const alCancelar = (): void => { limpiar(); if (esquemaAbierto) refrescarEsquema(); };
		const alCancelarPuntero = (e: PointerEvent): void => {
			if (e.pointerId === punteroId) alCancelar();
		};
		const alTecla = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopImmediatePropagation();
			alCancelar();
		};
		const alSoltar = (e: PointerEvent): void => {
			if (e.pointerId !== punteroId) return;
			if (!vigente()) { limpiar(); return; }
			// El último pointermove no está garantizado: se valida la casilla de las coordenadas del soltar.
			proponer(e.clientX, e.clientY);
			const plan = planPendiente;
			limpiar();
			if (!movido || !plan?.ok || plan.noOp) {
				refrescarEsquema();
				if (movido && plan && !plan.ok) avisar(plan.motivo, 'info');
				return;
			}
			if (!capturar()) { refrescarEsquema(); return; }
			try { aplicarMovimientoRepresentacion(documento, plan); }
			catch (error) {
				ctx.descartarCapturaSiIgual();
				refrescarEsquema();
				avisar(error instanceof Error ? error.message : 'La casilla cambió; vuelve a mover la vista.', 'error');
				return;
			}
			hojaSeleccionadaId = plan.destino.hojaId;
			marcarSucio();
			actualizarTodo();
			refrescarEsquema();
			avisar(`Vista ${id} colocada en hoja ${plan.destino.hojaId}, casilla ${plan.destino.columna}.${plan.destino.fila}`, 'ok');
		};
		window.addEventListener('pointermove', alMover);
		window.addEventListener('pointerup', alSoltar);
		window.addEventListener('pointercancel', alCancelarPuntero);
		window.addEventListener('keydown', alTecla, true);
		window.addEventListener('blur', alCancelar);
		cancelarArrastreM2 = alCancelar;
	}

	/**
	 * Arrastrar un símbolo del esquema para ponerlo donde uno quiere.
	 *
	 * El motor propone un orden automático que está bien para empezar, pero el esquema que se
	 * entrega lo ordena una persona: agrupa la maniobra, separa lo que va a campo y deja hueco donde
	 * hará falta. Lo que se suelta se queda ahí (se guarda en el proyecto y entra en el historial de
	 * deshacer), y lo que no se toca se sigue ordenando solo.
	 *
	 * Se SUELTA EN REJILLA —columna entera y una de las ocho filas— y no en cualquier punto: un
	 * esquema que se entrega tiene los aparatos alineados, no puestos a ojo.
	 */
	function empezarArrastreEsquema(ev: PointerEvent, g: SVGGElement): void {
		if (ev.button === 0 && ev.shiftKey && proyecto().esquema?.representaciones !== undefined) {
			const id = g.getAttribute('data-representacion');
			if (id) {
				ev.preventDefault();
				ev.stopPropagation();
				alternarVistaEnGrupo(id, false);
			}
			return;
		}
		if (ev.button === 0) limpiarGrupoRepresentaciones();
		if (proyecto().esquema?.representaciones !== undefined) {
			empezarArrastreRepresentacion(ev, g);
			return;
		}
		const id = g.getAttribute('data-dispositivo');
		const hoja = hojasEsquema[hojaActual];
		if (!id || !hoja || ev.button !== 0) return;
		const d = proyecto().dispositivos.find((x) => x.id === id);
		if (!d) return;
		ev.preventDefault();
		conductorSeleccionado = undefined;
		representacionSeleccionada = undefined;
		pintarConductorSeleccionado();
		seleccionar(id);

		const antes = d.esquema ? { ...d.esquema } : undefined;
		let movido = false;
		let destino = antes;
		const papel = { ancho: hoja.anchoMm, alto: hoja.altoMm };

		/** Píxeles de pantalla → columna y fila de la rejilla del esquema. */
		const rejillaEn = (cx: number, cy: number): { columna: number; fila: number } | undefined => {
			// Se busca el <svg> CADA VEZ: cada repintado rehace el innerHTML de la hoja, y una
			// referencia guardada de antes se queda huérfana devolviendo un rectángulo a cero —con lo
			// que el símbolo se quedaba clavado donde se agarró.
			const svg = $('esquema-hoja').querySelector('svg');
			if (!svg) return undefined;
			const caja = svg.getBoundingClientRect();
			if (caja.width < 1 || caja.height < 1) return undefined;
			const xmm = ((cx - caja.left) / caja.width) * hoja.anchoMm;
			const ymm = ((cy - caja.top) / caja.height) * hoja.altoMm;
			const paso = anchoColumna(papel, hoja.columnas);
			const enHoja = Math.floor((xmm - MARGEN.izq) / paso);
			/*
			 * La columna es GLOBAL: la hoja 2 empieza donde acaba la 1, y por eso arrastrar más
			 * allá del borde derecho pasa el aparato a la hoja siguiente.
			 *
			 * Eso decía el comentario y no lo hacía el cálculo. Segunda auditoría, TS2-P2-03: el
			 * `Math.min(hoja.columnas - 1, …)` recortaba la columna DENTRO de la hoja actual antes
			 * de sumarle la base, así que pasarse del borde derecho dejaba el aparato pegado a la
			 * última columna de la misma hoja, y del izquierdo, en la primera. Cruzar de hoja era
			 * imposible por la única vía que el propio comentario anunciaba.
			 *
			 * Ahora se recorta CONTRA EL PLANO ENTERO: al pasarse por la derecha se cae en la
			 * primera columna de la hoja siguiente, y por la izquierda, en la última de la
			 * anterior. El tope sigue estando en la primera y la última columna del esquema, que
			 * es donde tiene que estar.
			 */
			const base = (hoja.numero - 1) * hoja.columnas;
			const global = base + enHoja + 1;
			const ultima = totalHojas() * hoja.columnas;
			return {
				columna: Math.max(1, Math.min(ultima, global)),
				fila: filaDeAltura(ymm, papel),
			};
		};

		const alMover = (e: PointerEvent): void => {
			const r = rejillaEn(e.clientX, e.clientY);
			if (!r) return;
			if (!movido) {
				// Solo se considera arrastre cuando de verdad cambia de casilla: así un clic simple
				// sigue siendo un clic y no mueve nada sin querer.
				if (r.columna === (antes?.columna ?? -1) && r.fila === (antes?.fila ?? -1)) return;
				if (!capturar()) return;
				movido = true;
				arrastrandoVista = true;
				$('esquema-hoja').classList.add('arrastrando');
			}
			if (r.columna === destino?.columna && r.fila === destino?.fila) return;
			destino = r;
			d.esquema = r;
			refrescarEsquema();
		};

		const alSoltar = (): void => {
			window.removeEventListener('pointermove', alMover);
			window.removeEventListener('pointerup', alSoltar);
			window.removeEventListener('pointercancel', alSoltar);
			$('esquema-hoja').classList.remove('arrastrando');
			arrastrandoVista = false;
			if (!movido) { refrescarEsquema(); return; }   // fue un clic: solo seleccionar
			marcarSucio();
			actualizarTodo();
			refrescarEsquema();
			avisar(`${d.designacion ?? d.id} colocado en la columna ${d.esquema?.columna}`, 'ok');
		};

		window.addEventListener('pointermove', alMover);
		window.addEventListener('pointerup', alSoltar);
		window.addEventListener('pointercancel', alSoltar);
	}

	function aplicarZoomEsquema(): void {
		const hoja = hojasEsquema[hojaActual];
		if (!hoja) return;
		const caja = $('esquema-lienzo').getBoundingClientRect();
		// «Ajustar» = zoom 1: la hoja entra entera con un margen cómodo.
		const base = Math.max(0.05, Math.min((caja.width - 40) / hoja.anchoMm, (caja.height - 40) / hoja.altoMm));
		const escala = base * zoomEsquema;
		const el = $('esquema-hoja');
		el.style.width = `${hoja.anchoMm * escala}px`;
		el.style.height = `${hoja.altoMm * escala}px`;
	}

	function abrirEsquema(abrir: boolean): void {
		// Igual que el dossier: una ventana abierta dejaría el esquema debajo e inerte.
		if (abrir) cerrarTodasLasVentanas();
		esquemaAbierto = abrir;
		if (!abrir) {
			cancelarPanEsquema?.();
			espacioPan = false;
			cancelarEncuadrePendiente();
			cancelarArrastreM2?.();
			limpiarGrupoRepresentaciones();
			$('esq-folios-panel').hidden = true;
			if (refrescoEstadoPendiente) window.cancelAnimationFrame(refrescoEstadoPendiente);
			refrescoEstadoPendiente = 0;
			origenConexion = undefined;
			conductorSeleccionado = undefined;
			representacionSeleccionada = undefined;
			vistaCopiada = undefined;
			localizacion = undefined;
			arrastrandoVista = false;
			document.getElementById('esq-desdoblar-formulario')?.remove();
			documentoFormulario = undefined;
		}
		($('panel-esquema') as HTMLElement).hidden = !abrir;
		$('btn-esquema').classList.toggle('activo', abrir);
		if (abrir) {
			ctx.cerrarVisualizacion(); // las dos capas no pueden convivir
			zoomEsquema = 1;
			refrescarEsquema();
		}
	}

	/* ------------------------ Botones de la vista de esquema ------------------------ */
	instalarPanEsquema();

	async function alinearGrupo(eje: 'fila' | 'columna'): Promise<void> {
		if (!esquemaAbierto || !ctx.puedeEditar()) return;
		const documento = proyecto();
		const ids = [...grupoVistaIds];
		const anclaId = grupoAnclaId;
		const hojaId = hojasEsquema[hojaActual]?.id;
		if (ids.length < 2 || !anclaId || !hojaId || grupoDocumento !== documento || grupoHojaId !== hojaId) {
			avisar('Selecciona al menos dos vistas de la misma hoja con Shift+clic o Shift+Enter.', 'info');
			return;
		}
		const plan = previsualizarAlineacionRepresentaciones(documento, ids, anclaId, eje);
		if (!plan.ok) { avisar(plan.motivo, 'info'); return; }
		if (plan.noOp) { avisar('Las vistas ya están alineadas; no se creó una entrada de deshacer.', 'info'); return; }
		const firmaInicial = JSON.stringify(documento);
		const cambios = plan.cambios.filter((c) => c.antes.columna !== c.despues.columna
			|| c.antes.fila !== c.despues.fila || c.antes.hojaId !== c.despues.hojaId);
		const resumen = [
			`Alinear ${ids.length} vistas por ${eje} en la hoja ${hojaId}, usando ${anclaId} como ancla.`,
			...cambios.map((c) => `${c.vistaId}: ${c.antes.columna}.${c.antes.fila} → ${c.despues.columna}.${c.despues.fila}`),
			'Las identidades eléctricas, bornes y conductores no cambian. Cancelar no modifica el proyecto; aplicar crea un solo paso de Undo.',
		].join('\n');
		if (!(await confirmar(resumen, { ok: `Alinear ${eje}` }))) return;
		if (!esquemaAbierto || proyecto() !== documento || JSON.stringify(documento) !== firmaInicial
			|| hojasEsquema[hojaActual]?.id !== hojaId || grupoDocumento !== documento || grupoHojaId !== hojaId
			|| grupoAnclaId !== anclaId || JSON.stringify([...grupoVistaIds]) !== JSON.stringify(ids)
			|| !ctx.puedeEditar()) {
			avisar('El proyecto o la selección cambiaron durante la confirmación. Previsualiza de nuevo.', 'info');
			return;
		}
		if (!capturar()) return;
		try { aplicarAlineacionRepresentaciones(documento, plan); }
		catch (error) {
			ctx.descartarCapturaSiIgual();
			avisar(error instanceof Error ? error.message : 'La alineación no se aplicó.', 'error');
			return;
		}
		marcarSucio();
		actualizarTodo();
		refrescarEsquema();
		avisar(`${cambios.length} vista(s) alineadas por ${eje}; Ctrl+Z permite deshacer.`, 'ok');
	}

	($('btn-esquema') as HTMLButtonElement).onclick = () => abrirEsquema(!esquemaAbierto);
	($('esq-cerrar') as HTMLButtonElement).onclick = () => abrirEsquema(false);
	($('esq-anterior') as HTMLButtonElement).onclick = () => pasarHoja(-1);
	($('esq-siguiente') as HTMLButtonElement).onclick = () => pasarHoja(1);
	($('esq-acercar') as HTMLButtonElement).onclick = () => { zoomEsquema = Math.min(6, zoomEsquema * 1.3); aplicarZoomEsquema(); };
	($('esq-alejar') as HTMLButtonElement).onclick = () => { zoomEsquema = Math.max(0.4, zoomEsquema / 1.3); aplicarZoomEsquema(); };
	($('esq-ajustar') as HTMLButtonElement).onclick = () => { zoomEsquema = 1; aplicarZoomEsquema(); };
	($('esq-alinear-fila') as HTMLButtonElement).onclick = () => { void alinearGrupo('fila'); };
	($('esq-alinear-columna') as HTMLButtonElement).onclick = () => { void alinearGrupo('columna'); };
	($('esq-grupo-limpiar') as HTMLButtonElement).onclick = limpiarGrupoRepresentaciones;
	($('esq-copiar-vista') as HTMLButtonElement).onclick = () => {
		if (!esquemaAbierto || !ctx.puedeEditar()) return;
		const lista = proyecto().esquema?.representaciones;
		const vista = lista?.find((r) => r.id === representacionSeleccionada);
		if (!vista || vista.parte.tipo !== 'completa'
			|| lista?.filter((r) => r.dispositivoId === vista.dispositivoId).length !== 1) {
			avisar('Selecciona una vista completa y única; las vistas funcionales desdobladas no se copian por separado.', 'info');
			return;
		}
		vistaCopiada = { documento: proyecto(), vistaId: vista.id };
		pintarAccionesCopia();
		avisar('Aparato preparado para copiar. El pegado crea otro aparato sin conexiones.', 'info');
	};
	($('esq-pegar-vista') as HTMLButtonElement).onclick = async () => {
		if (!esquemaAbierto || !ctx.puedeEditar()) return;
		const documento = proyecto();
		const copia = vistaCopiada;
		if (!copia || copia.documento !== documento
			|| !documento.esquema?.representaciones?.some((r) => r.id === copia.vistaId)) {
			vistaCopiada = undefined;
			pintarAccionesCopia();
			avisar('La vista preparada ya no existe en este proyecto; vuelve a copiarla.', 'info');
			return;
		}
		const hoja = hojasEsquema[hojaActual];
		if (!hoja) return;
		const ocupadas = new Set(documento.esquema.representaciones
			.filter((r) => r.hojaId === hoja.id)
			.map((r) => `${r.posicion.columna}.${r.posicion.fila}`));
		let sugerencia = `${hoja.numero}.1.1`;
		buscarCasilla: for (let fila = 1; fila <= FILAS_ESQ; fila++) {
			for (let columna = 1; columna <= hoja.columnas; columna++) {
				if (!ocupadas.has(`${columna}.${fila}`)) {
					sugerencia = `${hoja.numero}.${columna}.${fila}`;
					break buscarCasilla;
				}
			}
		}
		const firma = JSON.stringify(documento);
		const texto = await pedirTexto(
			`Pegar un aparato eléctrico nuevo, sin cables. Indica hoja.columna.fila (p. ej. ${sugerencia}). `
			+ `Folios: ${documento.hojas.map((h) => `${h.numero} ${h.titulo}`).join(' · ')}`,
			sugerencia,
		);
		if (texto === null) return;
		if (proyecto() !== documento || JSON.stringify(documento) !== firma || vistaCopiada !== copia) {
			avisar('El proyecto cambió mientras elegías el destino. Vuelve a intentarlo.', 'info');
			refrescarEsquema();
			return;
		}
		const partes = /^(\d+)\.(\d+)\.(\d+)$/.exec(texto.trim());
		const folios = partes ? documento.hojas.filter((h) => h.numero === Number(partes[1])) : [];
		if (!partes || folios.length !== 1) {
			avisar('Indica una hoja única y una casilla válida con formato hoja.columna.fila.', 'error');
			return;
		}
		const destino = { hojaId: folios[0].id, columna: Number(partes[2]), fila: Number(partes[3]) };
		const nuevoId = ctx.duplicarAparatoConVista(copia.vistaId, destino, documento);
		if (!nuevoId) return;
		const nuevaVista = documento.esquema?.representaciones?.find((r) => r.dispositivoId === nuevoId);
		if (nuevaVista) {
			representacionSeleccionada = nuevaVista.id;
			conductorSeleccionado = undefined;
			hojaSeleccionadaId = nuevaVista.hojaId;
		}
		refrescarEsquema();
	};
	($('esq-renumerar') as HTMLButtonElement).onclick = async () => {
		if (!ctx.puedeEditar()) return;
		const documento = proyecto();
		let plan;
		try { plan = previsualizarRenumeracionEsquema(documento); }
		catch (error) { avisar(error instanceof Error ? error.message : 'No se pudo preparar la numeración.', 'error'); return; }
		if (!plan.filas.length) { avisar('No hay aparatos eléctricos que renumerar.', 'info'); return; }
		const firmaInicial = JSON.stringify(documento);
		const filas = plan.filas.map((fila) => {
			const ubicacion = fila.ubicacion.hojaId
				? `hoja ${fila.ubicacion.numeroHoja} [${fila.ubicacion.hojaId}], ${fila.ubicacion.columna ?? '—'}.${fila.ubicacion.fila ?? '—'}`
				: 'sin vista';
			return `${fila.dispositivoId} (${ubicacion}): ${fila.designacionAnterior ?? '(sin designación)'} → `
				+ `${fila.designacionPropuesta ?? '(sin propuesta)'}${fila.congelado ? ' · CONGELADA' : ''}`;
		});
		const conflicto = plan.conflictos.length > 0;
		const mensaje = [
			`Renumeración propuesta: ${plan.cambios} cambio(s) en ${plan.filas.length} aparato(s). Los IDs, bornes, conductores, vistas y hojas no cambian.`,
			...filas,
			conflicto ? `CONFLICTOS (${plan.conflictos.length}):\n${plan.conflictos.map((x) => `${x.codigo}: ${x.detalle}`).join('\n')}\nNo se aplicará ningún cambio.` : '',
			'Cancelar deja el proyecto idéntico. Aplicar permite Ctrl+Z/Redo y guarda las designaciones.',
		].filter(Boolean).join('\n\n');
		if (conflicto) { await confirmar(mensaje, { ok: 'Entendido', peligro: true }); return; }
		if (!plan.cambios) { avisar('Las designaciones ya coinciden con la propuesta; no hay cambios.', 'info'); return; }
		if (!(await confirmar(mensaje, { ok: 'Aplicar numeración' }))) return;
		if (proyecto() !== documento || JSON.stringify(documento) !== firmaInicial || !ctx.puedeEditar()) {
			avisar('El proyecto cambió mientras confirmabas. Previsualiza de nuevo.', 'info');
			return;
		}
		if (!capturar()) return;
		try { aplicarRenumeracionEsquema(documento, plan); }
		catch (error) {
			ctx.descartarCapturaSiIgual();
			avisar(error instanceof Error ? error.message : 'La numeración no se aplicó.', 'error');
			return;
		}
		marcarSucio();
		actualizarTodo();
		refrescarEsquema();
		avisar(`${plan.cambios} designación(es) actualizadas; Ctrl+Z permite deshacer.`, 'ok');
	};

	function cancelarConexionPendiente(): boolean {
		if (!esquemaAbierto || !origenConexion) return false;
		origenConexion = undefined;
		refrescarEsquema();
		return true;
	}

	function pasarHoja(delta: number): void {
		limpiarGrupoRepresentaciones();
		hojaActual += delta;
		hojaSeleccionadaId = hojasEsquema[hojaActual]?.id;
		conductorSeleccionado = undefined;
		representacionSeleccionada = undefined;
		refrescarEsquema();
	}

	/** Registro visible M2: las identidades son IDs de hoja, nunca el número o la posición del array. */
	function pintarPanelFolios(): void {
		if ($('esq-folios-panel').hidden) return;
		const documento = proyecto();
		const folios = [...documento.hojas].sort((a, b) => a.numero - b.numero || a.id.localeCompare(b.id));
		const idActual = hojasEsquema[hojaActual]?.id;
		const folio = folios.find((h) => h.id === idActual);
		const lista = $('esq-folios-lista');
		lista.replaceChildren();
		for (const h of folios) {
			const fila = document.createElement('div');
			fila.className = `esq-folios-fila${h.id === idActual ? ' actual' : ''}`;
			const ir = document.createElement('button');
			ir.type = 'button';
			ir.className = 'boton';
			ir.dataset.hojaId = h.id;
			ir.textContent = `Hoja ${h.numero}: ${h.titulo} · ${h.clase ?? 'sin clase'} · ${h.formatoPapel ?? 'A3'} ${h.formatoPapel === undefined ? '(heredado)' : '(fijado)'} · ${h.columnas ?? documento.esquema?.columnasPorHoja ?? 10} col. [${h.id}]`;
			ir.onclick = () => {
				const teniaFoco = document.activeElement === ir;
				const indice = hojasEsquema.findIndex((hoja) => hoja.id === h.id);
				if (indice < 0) { avisar('Esa hoja ya no está montada; actualiza el esquema.', 'info'); return; }
				hojaActual = indice;
				hojaSeleccionadaId = h.id;
				refrescarEsquema();
				// El refresco sustituye los botones de la lista: Enter/Tab no deben perder foco al body.
				if (teniaFoco) [...lista.querySelectorAll<HTMLButtonElement>('button[data-hoja-id]')]
					.find((b) => b.dataset.hojaId === h.id)?.focus();
			};
			fila.append(ir);
			lista.append(fila);
		}
		($('esq-folio-titulo') as HTMLInputElement).value = folio?.titulo ?? '';
		($('esq-folio-clase') as HTMLSelectElement).value = folio?.clase ?? '';
		($('esq-folio-formato') as HTMLSelectElement).value = folio?.formatoPapel ?? '';
		const columnas = $('esq-folio-columnas') as HTMLInputElement;
		columnas.value = folio?.columnas === undefined ? '' : String(folio.columnas);
		columnas.placeholder = `Heredar (${documento.esquema?.columnasPorHoja ?? 10})`;
		for (const id of ['esq-folio-guardar', 'esq-folio-subir', 'esq-folio-bajar', 'esq-folio-eliminar']) {
			($(id) as HTMLButtonElement).disabled = !folio;
		}
		const indice = folios.findIndex((h) => h.id === idActual);
		($('esq-folio-subir') as HTMLButtonElement).disabled = indice <= 0;
		($('esq-folio-bajar') as HTMLButtonElement).disabled = indice < 0 || indice === folios.length - 1;
		const ocupada = !!folio && (documento.esquema?.representaciones?.some((r) => r.hojaId === folio.id)
			|| documento.dispositivos.some((d) => d.hojaId === folio.id));
		($('esq-folio-eliminar') as HTMLButtonElement).disabled = !folio || folios.length < 2 || ocupada;
		$('esq-folios-borrar-motivo').textContent = ocupada
			? 'Esta hoja contiene vistas o referencias; reubícalas antes de eliminar.'
			: folios.length < 2 ? 'Debe quedar al menos una hoja.' : '';
	}

	function abrirPanelFolios(): void {
		if (proyecto().esquema?.representaciones === undefined) {
			avisar('Activa las vistas M2 antes de gestionar folios explícitos.', 'info');
			return;
		}
		$('esq-folios-panel').hidden = false;
		pintarPanelFolios();
	}

	async function gestionarHoja(solicitud: SolicitudGestionHojaEsquema): Promise<void> {
		if (!ctx.puedeEditar()) return;
		const documento = proyecto();
		let plan;
		try { plan = previsualizarGestionHojaEsquema(documento, solicitud); }
		catch (error) { avisar(error instanceof Error ? error.message : 'No se pudo preparar el folio.', 'error'); return; }
		if (!plan.cambios) { avisar('La hoja ya tiene esos datos; no hay cambios que guardar.', 'info'); return; }
		const firma = JSON.stringify(documento);
		const antesPorId = new Map(plan.hojasAntes.map((h) => [h.id, h]));
		const despuesPorId = new Map(plan.hojasDespues.map((h) => [h.id, h]));
		const resumir = (h: (typeof plan.hojasAntes)[number] | undefined) => !h ? '—'
			: `#${h.numero} «${h.titulo}» · ${h.clase ?? 'sin clase'} · ${h.formatoPapel} ${h.formatoPapelDeclarado === undefined ? '(heredado)' : '(fijado)'} · ${h.columnas} col. ${h.columnasDeclaradas === undefined ? '(heredadas)' : '(fijadas)'}`;
		const idsCambiados = [...new Set([...antesPorId.keys(), ...despuesPorId.keys()])]
			.filter((id) => JSON.stringify(antesPorId.get(id)) !== JSON.stringify(despuesPorId.get(id)))
			.sort((a, b) => (despuesPorId.get(a)?.numero ?? antesPorId.get(a)?.numero ?? 0)
				- (despuesPorId.get(b)?.numero ?? antesPorId.get(b)?.numero ?? 0) || a.localeCompare(b));
		const filas = idsCambiados.slice(0, 12)
			.map((id) => `[${id}] ${resumir(antesPorId.get(id))} → ${resumir(despuesPorId.get(id))}`);
		const vistas = plan.vistasAfectadas.slice(0, 8)
			.map((v) => `${v.id} (${v.dispositivoId}, hoja ${v.hojaId})`);
		const mensaje = [
			`Gestión de folio: ${solicitud.tipo}. ${plan.hojasAntes.length} → ${plan.hojasDespues.length} hojas; ${plan.cambios} identidad(es) editoriales afectadas.`,
			`Folios que cambian:\n${filas.join('\n')}${idsCambiados.length > filas.length ? `\n… y ${idsCambiados.length - filas.length} folio(s) más renumerados.` : ''}`,
			`${plan.vistasAfectadas.length} vista(s) afectadas: ${vistas.join(', ') || 'ninguna'}${plan.vistasAfectadas.length > vistas.length ? ` y ${plan.vistasAfectadas.length - vistas.length} más` : ''}. No se duplican aparatos, conductores ni la red eléctrica.`,
			'Cancelar no modifica el proyecto. Aplicar crea una sola entrada de deshacer (Ctrl+Z).',
		].join('\n\n');
		if (!(await confirmar(mensaje, { ok: solicitud.tipo === 'eliminar' ? 'Eliminar hoja vacía' : 'Aplicar folio',
			peligro: solicitud.tipo === 'eliminar' }))) return;
		if (proyecto() !== documento || JSON.stringify(documento) !== firma || !ctx.puedeEditar()) {
			avisar('El proyecto cambió durante la confirmación; previsualiza de nuevo.', 'info');
			return;
		}
		const indiceAntes = plan.hojasAntes.findIndex((h) => h.id === solicitud.id);
		const idDestino = solicitud.tipo === 'eliminar'
			? plan.hojasDespues[Math.min(indiceAntes, plan.hojasDespues.length - 1)]?.id : solicitud.id;
		if (!capturar()) return;
		try { aplicarGestionHojaEsquema(documento, plan); }
		catch (error) {
			ctx.descartarCapturaSiIgual();
			avisar(error instanceof Error ? error.message : 'La previsualización del folio envejeció.', 'error');
			return;
		}
		marcarSucio();
		actualizarTodo();
		// El índice de la vista anterior puede estar obsoleto tras crear/borrar/reordenar.
		hojaSeleccionadaId = idDestino;
		refrescarEsquema();
		if (solicitud.tipo === 'crear') ($('esq-folio-nuevo-titulo') as HTMLInputElement).value = '';
		avisar(`Folio ${solicitud.tipo === 'crear' ? 'creado' : solicitud.tipo === 'editar' ? 'actualizado'
			: solicitud.tipo === 'mover' ? 'reordenado' : 'eliminado'}; Ctrl+Z permite deshacer.`, 'ok');
	}

	($('esq-folios') as HTMLButtonElement).onclick = abrirPanelFolios;
	($('esq-folios-cerrar') as HTMLButtonElement).onclick = () => {
		$('esq-folios-panel').hidden = true;
		// El alto útil del lienzo vuelve a crecer: la hoja debe recuperar su ajuste visible.
		aplicarZoomEsquema();
	};
	($('esq-folio-crear') as HTMLButtonElement).onclick = () => {
		const titulo = ($('esq-folio-nuevo-titulo') as HTMLInputElement).value;
		const clase = ($('esq-folio-nueva-clase') as HTMLSelectElement).value as ClaseHojaEsquema | '';
		const formatoPapel = ($('esq-folio-nuevo-formato') as HTMLSelectElement).value as '' | 'A3' | 'A2';
		const valor = ($('esq-folio-nuevas-columnas') as HTMLInputElement).value;
		void gestionarHoja({ tipo: 'crear', id: `hoja-${crypto.randomUUID()}`, titulo,
			...(clase ? { clase } : {}), ...(formatoPapel ? { formatoPapel } : {}),
			...(valor ? { columnas: Number(valor) } : {}) });
	};
	($('esq-folio-guardar') as HTMLButtonElement).onclick = () => {
		const id = hojasEsquema[hojaActual]?.id;
		if (!id) return;
		const titulo = ($('esq-folio-titulo') as HTMLInputElement).value;
		const clase = ($('esq-folio-clase') as HTMLSelectElement).value as ClaseHojaEsquema | '';
		const formatoPapel = ($('esq-folio-formato') as HTMLSelectElement).value as '' | 'A3' | 'A2';
		const valor = ($('esq-folio-columnas') as HTMLInputElement).value;
		const actual = proyecto().hojas.find((h) => h.id === id);
		const declaradas = actual?.columnas;
		const cambioColumnas = valor ? Number(valor) : declaradas === undefined ? undefined : null;
		const cambioFormato = formatoPapel || (actual?.formatoPapel === undefined ? undefined : null);
		void gestionarHoja({ tipo: 'editar', id, titulo, clase: clase || null,
			...(cambioFormato === undefined ? {} : { formatoPapel: cambioFormato }),
			...(cambioColumnas === undefined ? {} : { columnas: cambioColumnas }) });
	};
	for (const [id, direccion] of [['esq-folio-subir', 'subir'], ['esq-folio-bajar', 'bajar']] as const) {
		($(id) as HTMLButtonElement).onclick = () => {
			const hojaId = hojasEsquema[hojaActual]?.id;
			if (hojaId) void gestionarHoja({ tipo: 'mover', id: hojaId, direccion });
		};
	}
	($('esq-folio-eliminar') as HTMLButtonElement).onclick = () => {
		const id = hojasEsquema[hojaActual]?.id;
		if (id) void gestionarHoja({ tipo: 'eliminar', id });
	};

	// Columnas por hoja: menos columnas = símbolos más separados y más hojas. Es la palanca que
	// convierte un esquema apretado e ilegible en uno que se lee, sin tocar el circuito.
	($('esq-columnas') as HTMLInputElement).onchange = (ev) => {
		const entrada = ev.target as HTMLInputElement;
		if (proyecto().esquema?.representaciones !== undefined) {
			const valorPropuesto = entrada.value;
			entrada.value = String(hojasEsquema[hojaActual]?.columnas ?? 10);
			abrirPanelFolios();
			($('esq-folio-columnas') as HTMLInputElement).value = valorPropuesto;
			($('esq-folio-columnas') as HTMLInputElement).focus();
			return;
		}
		const n = Math.max(4, Math.min(20, Number(entrada.value) || 10));
		entrada.value = String(n);
		if (n === (proyecto().esquema?.columnasPorHoja ?? 10)) return;
		if (!capturar()) return;
		proyecto().esquema = { ...proyecto().esquema, columnasPorHoja: n };
		marcarSucio();
		actualizarTodo();
		refrescarEsquema();
	};

	($('esq-titulo-editar') as HTMLButtonElement).onclick = async () => {
		const hoja = hojasEsquema[hojaActual];
		if (!hoja) { avisar('Todavía no hay ninguna hoja.', 'info'); return; }
		if (proyecto().esquema?.representaciones !== undefined) {
			abrirPanelFolios();
			($('esq-folio-titulo') as HTMLInputElement).focus();
			return;
		}
		const documento = proyecto();
		const nuevo = await pedirTexto(`Título de la hoja ${hoja.numero}:`, hoja.titulo);
		if (nuevo === null) return;
		if (proyecto() !== documento) { avisar('El proyecto cambió mientras editabas el título.', 'info'); return; }
		if (!capturar()) return;
		const titulos = { ...(proyecto().esquema?.titulos ?? {}) };
		// Vaciarlo devuelve el título automático, que es lo que espera quien borra el texto.
		if (nuevo.trim()) titulos[String(hoja.numero)] = nuevo.trim();
		else delete titulos[String(hoja.numero)];
		proyecto().esquema = { ...proyecto().esquema, titulos };
		marcarSucio();
		actualizarTodo();
		refrescarEsquema();
	};

	($('esq-auto') as HTMLButtonElement).onclick = async () => {
		if (proyecto().esquema?.representaciones !== undefined) {
			avisar('Las vistas M2 mantienen su colocación manual; ordenar automáticamente no está disponible.', 'info');
			return;
		}
		const aMano = proyecto().dispositivos.filter((d) => d.esquema);
		if (aMano.length === 0) { avisar('El esquema ya está ordenado solo: no has movido nada.', 'info'); return; }
		if (!(await confirmar(
			`Se van a soltar las ${aMano.length} colocaciones hechas a mano y el esquema volverá a `
			+ 'ordenarse solo. Ctrl+Z lo deshace.',
			{ ok: 'Ordenar solo' },
		))) return;
		if (!capturar()) return;
		for (const d of aMano) delete d.esquema;
		marcarSucio();
		actualizarTodo();
		refrescarEsquema();
		avisar('Esquema reordenado automáticamente', 'ok');
	};

	/* ---------------------- Lo que sale de aquí: PDF, SVG y DXF ---------------------- */
	($('esq-pdf') as HTMLButtonElement).onclick = async () => {
		if (hojasEsquema.length === 0) { avisar('No hay esquema que exportar todavía.', 'info'); return; }
		const btn = $('esq-pdf') as HTMLButtonElement;
		btn.disabled = true;
		const antes = btn.textContent;
		btn.textContent = 'Generando…';
	try {
			const actual = proyecto();
			const firma = JSON.stringify(actual);
			const copia = structuredClone(actual);
			const procedencia = await ctx.obtenerProcedencia();
			if (proyecto() !== actual || firma !== JSON.stringify(proyecto()))
				throw new Error('El proyecto cambió mientras se preparaba el esquema. Vuelve a exportarlo.');
			const hojas = montarEsquema(copia, calcularPotenciales(copia));
			await exportarEsquemaPDF(hojas, copia.nombre, `${nombreArchivo()}-esquema.pdf`, copia.datos ?? {},
				procedencia, copia.conductores.filter((c) => c.estadoRutaFisica === 'pendiente').length);
			avisar(`Esquema exportado (${hojas.length} hoja${hojas.length > 1 ? 's' : ''})`, 'ok');
		} catch (e) {
			avisar(`No se pudo exportar el esquema: ${(e as Error).message}`, 'error');
		} finally {
			btn.disabled = false;
			btn.textContent = antes;
		}
	};

	($('esq-svg') as HTMLButtonElement).onclick = async () => {
		const btn = $('esq-svg') as HTMLButtonElement;
		btn.disabled = true;
		try {
			const { hoja, copia, base, procedencia, totalHojas, rutasPendientes } = await prepararHojaDocumental(ctx, hojaActual);
			// SVG vectorial de la copia ya confirmada, nunca de las hojas montadas antes del flush.
			descargar(`${base}-esquema-${hoja.numero}.svg`, hojaASvg(hoja, {
				proyecto: copia.nombre, datos: copia.datos, totalHojas, procedencia, rutasPendientes,
			}), 'image/svg+xml');
			avisar(`Hoja ${hoja.numero} descargada en SVG`, 'ok');
		} catch (e) {
			avisar(`No se pudo exportar el SVG: ${(e as Error).message}`, 'error');
		} finally { btn.disabled = false; }
	};

	($('btn-dxf-esquema') as HTMLButtonElement).onclick = async () => {
		/*
		 * SIEMPRE DESDE LA COPIA CONFIRMADA, no desde lo que quedó montado.
		 *
		 * Segunda auditoría, TS2-P2-02. Ponía `hojasEsquema.length ? hojasEsquema : montar…`, o
		 * sea: si el esquema se había abierto ALGUNA VEZ se reutilizaban aquellas hojas, aunque
		 * el tablero hubiera cambiado desde entonces. Reproducción: abrir el esquema, cerrarlo,
		 * mover aparatos o cablear, y exportar el DXF sin volver a abrirlo → sale el esquema de
		 * antes. `refrescarEsquema()` no ayuda porque empieza con `if (!esquemaAbierto) return`.
		 *
		 * Montarlo cuesta un instante y el usuario acaba de pedir un archivo: el precio de
		 * hacerlo siempre es nada, y el de no hacerlo es entregar un plano que no es el tablero.
		 */
		const btn = $('btn-dxf-esquema') as HTMLButtonElement;
		btn.disabled = true;
		try {
			const { hoja, copia, base, procedencia, totalHojas, rutasPendientes } = await prepararHojaDocumental(ctx, hojaActual);
			descargar(`${base}-esquema-${hoja.numero}.dxf`, dxfDeEsquema(hoja, {
				proyecto: copia.nombre, datos: copia.datos, totalHojas, procedencia, rutasPendientes,
			}), 'image/vnd.dxf');
			avisar(`Hoja ${hoja.numero} del esquema exportada a DXF`, 'ok');
		} catch (e) {
			avisar(`No se pudo exportar el DXF: ${(e as Error).message}`, 'error');
		} finally { btn.disabled = false; }
	};

	return {
		abierto: () => esquemaAbierto,
		abrir: abrirEsquema,
		refrescar: refrescarEsquema,
		refrescarEstado,
		reajustarZoom: aplicarZoomEsquema,
		pasarHoja,
		cancelarConexionPendiente,
		localizarEntidades,
	};
}
