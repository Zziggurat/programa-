/**
 * Ventana autocontenida para crear y administrar «Mis Componentes».
 *
 * No depende de `main.ts` ni de nodos preexistentes: inyecta su DOM/CSS y expone un callback de
 * colocación. La persistencia pasa exclusivamente por `RepositorioProyectos`, incluidas imágenes
 * content-addressed y revisiones optimistas de la definición.
 */
import {
	FORMATO_COMPONENTE_PERSONALIZADO, VERSION_COMPONENTE_PERSONALIZADO,
	evaluarBloquesTerminales, sugerirRolesIEC, validarDefinicionComponente, validarFichaTecnicaComponente, validarLimitesTerminales,
	type DefinicionComponentePersonalizado, type ParametrosNominalesComponente,
	type TerminalComponentePersonalizado,
} from '../src/componentes/personalizados.js';
import { base64ABytes } from '../src/componentes/assets.js';
import { crearComponentePortatil, leerComponentePortatilDesdeArchivo } from '../src/componentes/portatil.js';
import { congelarSubconjunto } from '../src/datos-tecnicos/hash.js';
import { familiaDispositivo } from '../src/datos-tecnicos/resolver.js';
import { MAX_TERMINALES_BLOQUE } from '../src/motores/terminales.js';
import { claveRevision, referenciaTecnica, type FamiliaTecnica, type RevisionProductoTecnico,
	type RevisionTecnica } from '../src/datos-tecnicos/tipos.js';
import type { RepositorioDatosTecnicos } from '../src/datos-tecnicos/repositorio.js';
import {
	LISTA_PERFILES_BASE, PERFILES_BASE, construirComportamientoPerfil, rolesDesdeComportamiento,
	type ParametrosConstruccionPerfil, type RolTerminalPerfil, type TerminalPerfilComponente,
} from '../src/componentes/perfiles-base.js';
import type { BloqueTerminales, Dispositivo, LadoAparato, MontajeComponente, TipoBorne, TipoDispositivo } from '../src/modelo/tipos.js';
import { ComponentePersonalizadoDuplicado, type ContenidoComponentePersonalizado,
	type RepositorioProyectos } from '../src/persistencia/tipos.js';
import { abrirVentana, cerrarVentana, ventanaDeArriba } from './ventanas.js';

const ID_RAIZ = 'ui-componentes-personalizados';
const MIME_IMAGEN = new Set(['image/png', 'image/jpeg', 'image/webp']);
const NATURALEZAS: readonly (TipoBorne | '')[] = ['', 'L', 'N', 'PE', 'control', 'senal', 'otro'];
const ROLES: readonly RolTerminalPerfil[] = [
	'sin-asignar', 'bobina-entrada', 'bobina-retorno', 'polo-entrada', 'polo-salida',
	'contacto-comun', 'contacto-na', 'contacto-nc', 'contacto-posicion-1', 'contacto-posicion-2',
	'alimentacion-entrada', 'alimentacion-retorno', 'salida-fase', 'salida-retorno',
	'salida-digital', 'comun-digital', 'salida-analogica', 'referencia-analogica', 'comun-analogico',
	'mando-run', 'mando-enable', 'salida-u', 'salida-v', 'salida-w', 'carga-fase', 'carga-retorno',
	'senal-digital', 'pasivo-a', 'pasivo-b', 'proteccion',
];

/** Pasos de la misma edición, no seis formularios con copias divergentes de los datos. */
export const PASOS_ASISTENTE_COMPONENTE = [
	{ id: 'identidad', nombre: 'Identidad' },
	{ id: 'funcion', nombre: 'Función' },
	{ id: 'bornes', nombre: 'Bornes' },
	{ id: 'dimensiones', nombre: 'Dimensiones' },
	{ id: 'apariencia', nombre: 'Apariencia y datos' },
	{ id: 'revision', nombre: 'Revisión' },
] as const;
type PasoAsistenteComponente = typeof PASOS_ASISTENTE_COMPONENTE[number]['id'];

export function pasoAdyacenteComponente(actual: PasoAsistenteComponente, direccion: -1 | 1): PasoAsistenteComponente {
	const indice = PASOS_ASISTENTE_COMPONENTE.findIndex((p) => p.id === actual);
	return PASOS_ASISTENTE_COMPONENTE[Math.max(0, Math.min(PASOS_ASISTENTE_COMPONENTE.length - 1, indice + direccion))].id;
}

export interface ContextoUIComponentesPersonalizados {
	repositorio: RepositorioProyectos;
	/** Biblioteca V8 global; la ficha se congela en la definición, no se resuelve por latest. */
	datosTecnicos?: RepositorioDatosTecnicos;
	/** Recibe una fotografía profunda; editar después la biblioteca no altera lo colocado. */
	colocar(definicion: DefinicionComponentePersonalizado, imagenUrl: string): void | Promise<void>;
	confirmar?: (mensaje: string) => boolean | Promise<boolean>;
}

export interface PanelComponentesPersonalizados {
	abrir(): Promise<void>;
	nuevo(): void;
	refrescar(): Promise<void>;
	cerrar(): void;
	destruir(): void;
}

interface EstadoEditor {
	original?: DefinicionComponentePersonalizado;
	/** Estado de navegación del asistente; nunca entra a una definición persistida. */
	paso?: PasoAsistenteComponente;
	tipo: TipoDispositivo;
	datos: {
		nombre: string; fabricante: string; referencia: string; descripcion: string;
		anchoMm: number; altoMm: number; fondoMm: number;
	};
	terminales: TerminalEditor[];
	bloquesTerminales?: BloqueTerminales[];
	parametros: ParametrosConstruccionPerfil;
	montaje?: MontajeComponente;
	fichaTecnica?: DefinicionComponentePersonalizado['fichaTecnica'];
	/** Selección de UI no aplicada hasta pulsar «Fijar revisión exacta». */
	candidatoFichaClave?: string;
	/** Los anclajes se conservan si se compara temporalmente DIN y placa en el asistente. */
	anclajesPlacaBorrador?: NonNullable<MontajeComponente['anclajes']>;
	assetId?: string;
	assetBytes?: Uint8Array;
	assetMime?: string;
	previewUrl?: string;
}

type TerminalEditor = TerminalPerfilComponente & Pick<TerminalComponentePersonalizado,
	'rotulo' | 'maxConductores' | 'seccionMaxMm2' | 'lado' | 'obligatorio'>;

/** Misma validación en UI y en persistencia/paquetes, sin aceptar datos distintos por ruta. */
export const erroresLimitesTerminales = validarLimitesTerminales;

/** Reconstruir roles al editar no puede borrar metadatos eléctricos ya declarados. */
export function terminalesParaEditor(d: Pick<DefinicionComponentePersonalizado,
	'terminales' | 'comportamiento'>): TerminalEditor[] {
	return rolesDesdeComportamiento(d.terminales, d.comportamiento).map((terminal, i) => ({
		...terminal,
		rotulo: d.terminales[i].rotulo,
		maxConductores: d.terminales[i].maxConductores,
		seccionMaxMm2: d.terminales[i].seccionMaxMm2,
		lado: d.terminales[i].lado,
		obligatorio: d.terminales[i].obligatorio,
	}));
}

/** Lista blanca compartida por guardar una definición nueva y guardar una revisión. */
export function terminalesDesdeEditor(terminales: readonly TerminalEditor[]): TerminalComponentePersonalizado[] {
	return terminales.map(({ id, tipo, u, v, rotulo, maxConductores, seccionMaxMm2, lado, obligatorio }) => ({
		id: id.trim(), tipo, u, v,
		...(rotulo?.trim() ? { rotulo: rotulo.trim() } : {}),
		...(maxConductores !== undefined ? { maxConductores } : {}),
		...(seccionMaxMm2 !== undefined ? { seccionMaxMm2 } : {}),
		...(lado !== undefined ? { lado } : {}),
		...(obligatorio !== undefined ? { obligatorio } : {}),
	}));
}

const clonar = <T>(valor: T): T => structuredClone(valor);
const normalizarBusqueda = (valor: string): string => valor.normalize('NFD')
	.replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();

export function filtrarComponentesBiblioteca(
	componentes: readonly DefinicionComponentePersonalizado[], texto: string, perfil = '',
): DefinicionComponentePersonalizado[] {
	const palabras = normalizarBusqueda(texto).split(/\s+/).filter(Boolean);
	return componentes.filter((d) => {
		if (perfil && d.tipoDispositivo !== perfil) return false;
		if (!palabras.length) return true;
		const campos = [d.nombre, d.fabricante, d.referencia, d.descripcion, d.id,
			d.tipoDispositivo, PERFILES_BASE[d.tipoDispositivo]?.nombre]
			.filter((campo): campo is string => !!campo).map(normalizarBusqueda);
		return palabras.every((palabra) => campos.some((campo) => campo.includes(palabra)));
	});
}

/** Publica una carga asíncrona únicamente si la navegación que la solicitó sigue vigente. */
export async function prepararEditorVigente<T>(
	preparar: () => Promise<T>, vigente: () => boolean, publicar: (valor: T) => void,
): Promise<boolean> {
	const valor = await preparar();
	if (!vigente()) return false;
	publicar(valor);
	return true;
}

export function mensajeErrorGuardado(error: unknown, persistido: boolean): string {
	const detalle = error instanceof Error ? error.message : String(error);
	return persistido
		? `El componente se guardó, pero no se pudo actualizar la biblioteca: ${detalle}`
		: `No se pudo guardar: ${detalle}`;
}
const el = <T extends HTMLElement>(raiz: ParentNode, selector: string): T => {
	const encontrado = raiz.querySelector<T>(selector);
	if (!encontrado) throw new Error(`Falta el control ${selector} de Mis Componentes.`);
	return encontrado;
};
const opcion = (valor: string, etiqueta = valor): HTMLOptionElement => {
	const o = document.createElement('option'); o.value = valor; o.textContent = etiqueta; return o;
};
const nombreArchivo = (nombre: string): string => `${nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
	.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'componente'}.tscomp.json`;

function descargar(nombre: string, blob: Blob): void {
	const url = URL.createObjectURL(blob); const a = document.createElement('a');
	a.href = url; a.download = nombre; a.style.display = 'none'; document.body.appendChild(a); a.click();
	setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 20_000);
}

function contenidoDe(d: DefinicionComponentePersonalizado): ContenidoComponentePersonalizado {
	const { id: _id, revision: _revision, creadoEn: _creado, modificadoEn: _modificado,
		formato: _formato, version: _version, ...contenido } = clonar(d);
	return contenido;
}

function parametrosDesde(d: DefinicionComponentePersonalizado): ParametrosConstruccionPerfil {
	const p = d.parametros; const c = d.comportamiento;
	const salida: ParametrosConstruccionPerfil = {
		tensionV: p?.tensionV, corrienteA: p?.corrienteA, potenciaW: p?.potenciaW,
		frecuenciaHz: p?.frecuenciaHz, programa: p?.programa,
		rangoSondaMin: p?.rangoSonda?.[0], rangoSondaMax: p?.rangoSonda?.[1], unidadSonda: p?.unidadSonda,
		temporizacionTipo: p?.temporizacion?.tipo ?? 'ninguna', retardoSegundos: p?.temporizacion?.segundos,
	};
	if (c.clase === 'mando') Object.assign(salida, { modoMando: c.modo, posiciones: c.posiciones, reposo: c.reposo });
	if (c.clase === 'fuente') salida.tensionSalidaV = c.salidas[0]?.tensionV;
	if (c.clase === 'controlador') {
		const rango = c.salidasAnalogicas[0]?.rango ?? p?.rangoSalidaAnalogica;
		salida.referenciaMin = rango?.[0]; salida.referenciaMax = rango?.[1];
	}
	if (c.clase === 'variador') Object.assign(salida, {
		fasesMinimas: c.alimentacion.fasesMinimas, unidadReferencia: c.referencia.unidad,
		referenciaMin: c.referencia.rango[0], referenciaMax: c.referencia.rango[1],
		frecuenciaMinHz: c.frecuencia.minimaHz, frecuenciaMaxHz: c.frecuencia.maximaHz,
		rampaHzS: c.frecuencia.rampaHzS,
	});
	if (c.clase === 'carga') {
		salida.fasesMinimas = c.alimentacion.fasesMinimas;
		if (c.mandoAnalogico) Object.assign(salida, { unidadReferencia: c.mandoAnalogico.unidad,
			referenciaMin: c.mandoAnalogico.rango[0], referenciaMax: c.mandoAnalogico.rango[1] });
	}
	return salida;
}

export function instalarUIComponentesPersonalizados(ctx: ContextoUIComponentesPersonalizados): PanelComponentesPersonalizados {
	if (document.getElementById(ID_RAIZ)) throw new Error('La UI de Mis Componentes ya está instalada.');
	const raiz = document.createElement('div'); raiz.id = ID_RAIZ; raiz.hidden = true;
	raiz.setAttribute('aria-labelledby', 'cp-titulo');
	raiz.innerHTML = '<section class="cp-ventana">'
		+ '<header><h2 id="cp-titulo">Mis Componentes</h2><button type="button" data-cp="cerrar" aria-label="Cerrar">✕</button></header>'
		+ '<div class="cp-cuerpo"></div></section>';
	document.body.appendChild(raiz);
	const cuerpo = el<HTMLDivElement>(raiz, '.cp-cuerpo');
	const urls = new Map<string, string>();
	let editor: EstadoEditor | undefined;
	let borrador: EstadoEditor | undefined;
	let huellaInicial = '';
	let busquedaBiblioteca = '';
	let filtroPerfil = '';
	let filtroTurno = 0;
	let cargaImagen = 0;
	let imagenPendiente: EstadoEditor | undefined;
	let navegacionEditor = 0;
	let guardando = false;
	let urlTemporal: string | undefined;
	let pintado = 0;
	let generacionFicha = 0;
	const huellaEditor = (e: EstadoEditor): string => JSON.stringify({
		original: e.original && [e.original.id, e.original.revision], tipo: e.tipo,
		datos: e.datos, terminales: e.terminales, bloquesTerminales: e.bloquesTerminales,
		parametros: e.parametros, montaje: e.montaje,
		fichaTecnica: e.fichaTecnica,
		assetId: e.assetId, assetNuevo: e.assetBytes && [e.assetBytes.byteLength, e.assetMime, e.previewUrl],
	});
	const editorModificado = (): boolean => !!editor && (editor === imagenPendiente || huellaEditor(editor) !== huellaInicial);
	const confirmarReemplazo = async (): Promise<boolean> => {
		if (guardando) return false;
		if (editor) capturarFormulario();
		if (!borrador && !editorModificado()) return true;
		return confirmar('Hay un componente sin guardar. ¿Descartar ese borrador para abrir otro?');
	};

	const mensaje = (texto: string, error = false) => {
		const n = cuerpo.querySelector<HTMLElement>('[data-cp-estado]');
		if (n) { n.textContent = texto; n.style.color = error ? '#ffabb4' : '#acd4ee'; }
	};
	const confirmar = async (texto: string): Promise<boolean> => ctx.confirmar
		? await ctx.confirmar(texto) : window.confirm(texto);
	const urlAsset = async (id: string): Promise<string> => {
		const previa = urls.get(id); if (previa) return previa;
		const asset = await ctx.repositorio.abrirAsset(id);
		if (!asset) throw new Error(`No existe la imagen ${id}.`);
		const url = URL.createObjectURL(new Blob([Uint8Array.from(asset.bytes).buffer], { type: asset.mime }));
		urls.set(id, url); return url;
	};

	async function pintarBiblioteca(desdeGuardado = false): Promise<void> {
		if (guardando) return;
		++navegacionEditor;
		if (editor) {
			capturarFormulario();
			if (editorModificado()) borrador = editor;
			editor = undefined;
		}
		const turno = ++pintado;
		cuerpo.innerHTML = '<div class="cp-barra"><button class="primario" data-cp="nuevo">Nuevo componente</button>'
			+ '<button data-cp="importar">Importar</button><input data-cp="archivo-importar" type="file" accept=".json,.tscomp" hidden>'
			+ '<span class="estado" data-cp-estado role="status" aria-live="polite">Cargando…</span></div>'
			+ '<div class="cp-filtros"><label>Buscar componente<input type="search" data-cp="buscar" placeholder="Nombre, referencia o familia" autocomplete="off"></label>'
			+ '<label>Familia<select data-cp="perfil"></select></label></div>'
			+ '<div data-cp="borrador"></div><div class="cp-lista"></div>';
		el<HTMLButtonElement>(cuerpo, '[data-cp="nuevo"]').onclick = () => { void iniciarNuevo(); };
		el<HTMLButtonElement>(cuerpo, '[data-cp="importar"]').onclick = () => el<HTMLInputElement>(cuerpo, '[data-cp="archivo-importar"]').click();
		el<HTMLInputElement>(cuerpo, '[data-cp="archivo-importar"]').onchange = async (evento) => {
			const input = evento.currentTarget as HTMLInputElement; const archivo = input.files?.[0]; input.value = '';
			if (archivo) await importarComponente(archivo);
		};
		const buscar = el<HTMLInputElement>(cuerpo, '[data-cp="buscar"]'); buscar.value = busquedaBiblioteca;
		const perfil = el<HTMLSelectElement>(cuerpo, '[data-cp="perfil"]');
		perfil.appendChild(opcion('', 'Todas las familias'));
		for (const p of LISTA_PERFILES_BASE) perfil.appendChild(opcion(p.id, p.nombre));
		perfil.value = filtroPerfil;
		const zonaBorrador = el<HTMLDivElement>(cuerpo, '[data-cp="borrador"]');
		if (borrador) {
			const aviso = document.createElement('div'); aviso.className = 'cp-borrador';
			const nombre = document.createElement('span'); nombre.textContent = `Borrador sin guardar: ${borrador.datos.nombre.trim() || 'Componente nuevo'}`;
			const continuar = document.createElement('button'); continuar.textContent = 'Continuar edición';
			continuar.onclick = () => { ++navegacionEditor; editor = borrador; borrador = undefined; pintarEditor(); };
			const descartar = document.createElement('button'); descartar.textContent = 'Descartar borrador'; descartar.className = 'peligro';
			descartar.onclick = async () => {
				if (!await confirmar('¿Descartar el componente sin guardar?')) return;
				if (borrador?.previewUrl === urlTemporal && urlTemporal) {
					URL.revokeObjectURL(urlTemporal); urlTemporal = undefined;
				}
				borrador = undefined; zonaBorrador.replaceChildren();
			};
			aviso.append(nombre, continuar, descartar); zonaBorrador.appendChild(aviso);
		}
		try {
			const componentes = await ctx.repositorio.listarComponentes(); if (turno !== pintado) return;
			const lista = el<HTMLDivElement>(cuerpo, '.cp-lista');
			const filtrar = async () => {
				const filtroActual = ++filtroTurno;
				const visibles = filtrarComponentesBiblioteca(componentes, busquedaBiblioteca, filtroPerfil);
				lista.replaceChildren();
				if (!visibles.length) {
					const vacio = document.createElement('p'); vacio.className = 'cp-vacio';
					vacio.textContent = componentes.length ? 'No hay componentes que coincidan con la búsqueda.' : 'Aún no hay componentes personales.';
					lista.appendChild(vacio);
				}
				for (const d of visibles) {
					const tarjeta = await tarjetaComponente(d);
					if (turno !== pintado || filtroActual !== filtroTurno) return;
					lista.appendChild(tarjeta);
				}
				mensaje(busquedaBiblioteca.trim() || filtroPerfil
					? `${visibles.length} de ${componentes.length} componentes`
					: `${componentes.length} componente${componentes.length === 1 ? '' : 's'}`);
			};
			buscar.oninput = () => { busquedaBiblioteca = buscar.value; void filtrar(); };
			perfil.onchange = () => { filtroPerfil = perfil.value; void filtrar(); };
			await filtrar();
		} catch (e) {
			mensaje(desdeGuardado ? mensajeErrorGuardado(e, true)
				: `No se pudo abrir la biblioteca: ${(e as Error).message}`, true);
		}
	}

	async function tarjetaComponente(d: DefinicionComponentePersonalizado): Promise<HTMLElement> {
		const tarjeta = document.createElement('article'); tarjeta.className = 'cp-tarjeta'; tarjeta.dataset.id = d.id;
		const img = document.createElement('img'); img.alt = ''; try { img.src = await urlAsset(d.assetId); } catch { img.alt = 'Imagen no disponible'; }
		const info = document.createElement('div'); const h = document.createElement('h3'); h.textContent = d.nombre;
		const p = document.createElement('p'); p.textContent = `${PERFILES_BASE[d.tipoDispositivo].nombre} · revisión ${d.revision}`;
		const f = document.createElement('p'); f.textContent = `${d.fabricante ?? ''}${d.referencia ? ` ${d.referencia}` : ''}`.trim();
		info.append(h, p, f); const acciones = document.createElement('div'); acciones.className = 'cp-acciones';
		const boton = (texto: string, accion: () => Promise<void>) => {
			const b = document.createElement('button'); b.type = 'button'; b.textContent = texto;
			b.onclick = async () => { b.disabled = true; try { await accion(); } catch (e) { mensaje((e as Error).message, true); } finally { b.disabled = false; } };
			acciones.appendChild(b); return b;
		};
		boton('Colocar', async () => { const url = await urlAsset(d.assetId); await ctx.colocar(clonar(d), url); cerrar(); });
		boton('Editar', async () => abrirEdicion(d));
		boton('Duplicar', async () => { await ctx.repositorio.duplicarComponente(d.id); await pintarBiblioteca(); });
		boton('Exportar', async () => exportarComponente(d));
		const borrar = boton('Eliminar', async () => {
			if (!await confirmar(`¿Eliminar «${d.nombre}» de Mis Componentes?`)) return;
			await ctx.repositorio.eliminarComponente(d.id, d.revision); await pintarBiblioteca();
		}); borrar.classList.add('peligro');
		tarjeta.append(img, info, acciones); return tarjeta;
	}

	function abrirNuevo(): void {
		if (urlTemporal) { URL.revokeObjectURL(urlTemporal); urlTemporal = undefined; }
		editor = {
			paso: 'identidad',
			tipo: 'contactor', datos: { nombre: '', fabricante: '', referencia: '', descripcion: '', anchoMm: 45, altoMm: 80, fondoMm: 60 },
			terminales: [], parametros: {},
		}; huellaInicial = huellaEditor(editor); pintarEditor();
	}

	async function iniciarNuevo(): Promise<void> {
		const turno = ++navegacionEditor;
		if (!await confirmarReemplazo() || turno !== navegacionEditor) return;
		borrador = undefined; abrirNuevo();
	}

	async function abrirEdicion(d: DefinicionComponentePersonalizado): Promise<void> {
		const turno = ++navegacionEditor;
		if (!await confirmarReemplazo() || turno !== navegacionEditor) return;
		await prepararEditorVigente(() => urlAsset(d.assetId), () => turno === navegacionEditor, (previewUrl) => {
			// Nada que pueda fallar antes de aquí debe descartar el borrador anterior.
			const siguiente: EstadoEditor = {
				paso: 'identidad',
				original: clonar(d), tipo: d.tipoDispositivo, datos: {
					nombre: d.nombre, fabricante: d.fabricante ?? '', referencia: d.referencia ?? '', descripcion: d.descripcion ?? '',
					anchoMm: d.dimensiones.anchoMm, altoMm: d.dimensiones.altoMm, fondoMm: d.dimensiones.fondoMm,
				},
				terminales: terminalesParaEditor(d), bloquesTerminales: d.bloquesTerminales && clonar(d.bloquesTerminales),
				parametros: parametrosDesde(d), montaje: d.montaje && clonar(d.montaje),
				fichaTecnica: d.fichaTecnica && clonar(d.fichaTecnica),
				anclajesPlacaBorrador: d.montaje?.metodo === 'atornillado-placa' ? clonar(d.montaje.anclajes ?? []) : undefined,
				assetId: d.assetId, previewUrl,
			};
			if (urlTemporal) { URL.revokeObjectURL(urlTemporal); urlTemporal = undefined; }
			borrador = undefined;
			editor = siguiente;
			huellaInicial = huellaEditor(siguiente);
			pintarEditor();
		});
	}

	function pintarEditor(): void {
		if (!editor) return; ++pintado; ++generacionFicha;
		cuerpo.innerHTML = '<div class="cp-barra"><button data-cp="volver">← Biblioteca</button>'
			+ `<strong>${editor.original ? 'Editar componente' : 'Nuevo componente'}</strong><span class="estado" data-cp-estado role="status" aria-live="polite"></span></div>`
			+ '<nav class="cp-pasos" data-cp="pasos" aria-label="Pasos del asistente de componentes"></nav>'
			+ '<div class="cp-asistente"><section class="cp-panel cp-paso" data-cp-paso="identidad"><h3 tabindex="-1">1. Identidad</h3>'
			+ '<p>Nombre, referencia y procedencia visibles en la biblioteca y en el tablero. No certifican la ficha del fabricante.</p>'
			+ '<div class="cp-campos"><label>Nombre<input data-cp-campo="nombre"></label><label>Fabricante<input data-cp-campo="fabricante"></label>'
			+ '<label>Referencia<input data-cp-campo="referencia"></label></div><label>Descripción<textarea data-cp-campo="descripcion"></textarea></label></section>'
			+ '<section class="cp-panel cp-paso" data-cp-paso="funcion" hidden><h3 tabindex="-1">2. Familia y comportamiento</h3>'
			+ '<p>El perfil explícito, no la imagen ni los rótulos, determina la simulación eléctrica.</p>'
			+ '<div class="cp-campos"><label>Perfil<select data-cp-campo="tipo"></select></label></div>'
			+ '<div class="cp-fidelidad" data-cp="fidelidad"></div><div class="cp-campos" data-cp="parametros"></div></section>'
			+ '<section class="cp-panel cp-paso" data-cp-paso="bornes" hidden><h3 tabindex="-1">3. Bornes y ubicación sobre la imagen</h3>'
			+ '<p>Carga una imagen para marcar físicamente los bornes. Cada clic fija un ancla u/v en la imagen; el ID conecta el circuito y el rótulo visible se muestra sin sustituir ese ID. Confirma naturaleza, rol y límites abajo. Las sugerencias IEC no se aplican solas.</p>'
			+ '<label class="cp-carga-imagen">Imagen PNG/JPEG/WebP<input type="file" accept="image/png,image/jpeg,image/webp" data-cp="imagen"></label>'
			+ '<div class="cp-preview" data-cp="preview"><span style="position:absolute;inset:45% 10%;text-align:center;color:#516577">Carga una imagen y haz clic para marcar bornes</span></div>'
			+ '<div class="cp-scroll"><table><thead><tr><th>ID estable</th><th>Naturaleza</th><th>Rol</th><th>Grupo</th><th>Rótulo visible</th><th>Lado fuente</th><th>Conexión requerida</th><th>Máx. hilos</th><th>Sección máx. mm²</th><th></th></tr></thead><tbody data-cp="terminales"></tbody></table></div>'
			+ '<div class="cp-sugerencias" data-cp="sugerencias"></div>'
			+ '<section class="cp-bloques"><h4>Bloques físicos de terminales</h4><p>Opcional. Declara lado, orden de bornes y, si conoces su tramo real, inicio/fin porcentual sobre ese lado. En un componente con imagen, las anclas u/v siguen ubicando los contactos en 3D; estos bloques documentan la agrupación física y el esquema. Sin rangos suficientes, la ubicación de varios bloques en un mismo lado es NO EVALUABLE.</p><div data-cp="bloques-estado" role="status"></div><div data-cp="bloques"></div><button type="button" data-cp="agregar-bloque">Añadir bloque físico</button></section></section>'
			+ '<section class="cp-panel cp-paso" data-cp-paso="dimensiones" hidden><h3 tabindex="-1">4. Dimensiones y montaje</h3>'
			+ '<p>Estas medidas definen la envolvente física que se colocará en el tablero.</p>'
			+ '<div class="cp-campos"><label>Ancho (mm)<input type="number" min="1" data-cp-campo="ancho"></label>'
			+ '<label>Alto (mm)<input type="number" min="1" data-cp-campo="alto"></label>'
			+ '<label>Fondo (mm)<input type="number" min="1" data-cp-campo="fondo"></label></div>'
			+ '<label class="cp-montaje-metodo">Método de montaje declarado<select data-cp-campo="montaje-metodo"><option value="">No declarado</option><option value="riel-din">Riel DIN</option><option value="atornillado-placa">Placa atornillada</option></select></label>'
			+ '<div class="cp-sugerencias" data-cp="montaje-extension"></div></section>'
			+ '<section class="cp-panel cp-paso" data-cp-paso="apariencia" hidden><h3 tabindex="-1">5. Apariencia y datos técnicos</h3>'
			+ '<p>La imagen representa el componente; nunca define por sí sola su comportamiento. Si la reemplazas, revisa las posiciones de los bornes antes de guardar.</p>'
			+ '<label class="cp-carga-imagen">Reemplazar imagen<input type="file" accept="image/png,image/jpeg,image/webp" data-cp="imagen-apariencia"></label>'
			+ '<div class="cp-preview-apariencia" data-cp="preview-apariencia"></div>'
			+ '<section class="cp-ficha" data-cp="ficha-tecnica"><h4>Ficha técnica V8 exacta</h4><p>Selecciona una revisión PRODUCTO de la familia funcional y fija también su curva dependiente. El hash prueba integridad, no autenticidad, licencia ni certificación. La selección no modifica los parámetros eléctricos por sí sola.</p><div data-cp="ficha-estado" role="status" aria-live="polite"></div><div data-cp="ficha-contenido"></div></section></section>'
			+ '<section class="cp-panel cp-paso" data-cp-paso="revision" hidden><h3 tabindex="-1">6. Revisión antes de guardar</h3>'
			+ '<p>Confirma identidad, perfil, bornes, dimensiones y asset. Guardar crea una revisión de biblioteca; no actualiza automáticamente los aparatos colocados.</p>'
			+ '<dl class="cp-resumen" data-cp="resumen"></dl>'
			+ '<div class="cp-errores" data-cp="errores">Valida antes de guardar.</div></section></div>'
			+ '<div class="cp-navegacion"><button data-cp="anterior" type="button">← Anterior</button><span data-cp="progreso" role="status" aria-live="polite"></span>'
			+ '<div class="cp-pie" data-cp="acciones-revision" hidden><button data-cp="validar">Validar</button><button class="primario" data-cp="guardar">Guardar revisión</button></div>'
			+ '<button class="primario" data-cp="siguiente" type="button">Siguiente →</button></div>';
		el<HTMLButtonElement>(cuerpo, '[data-cp="volver"]').onclick = () => { void pintarBiblioteca(); };
		const pasos = el<HTMLElement>(cuerpo, '[data-cp="pasos"]');
		for (const [indice, paso] of PASOS_ASISTENTE_COMPONENTE.entries()) {
			const boton = document.createElement('button'); boton.type = 'button'; boton.dataset.cpIr = paso.id;
			boton.textContent = `${indice + 1}. ${paso.nombre}`;
			boton.onclick = () => mostrarPasoEditor(paso.id);
			pasos.appendChild(boton);
		}
		pasos.onkeydown = (evento) => {
			if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evento.key)) return;
			const actual = (document.activeElement as HTMLElement | null)?.dataset.cpIr as PasoAsistenteComponente | undefined;
			if (!actual) return;
			evento.preventDefault();
			const destino = evento.key === 'Home' ? PASOS_ASISTENTE_COMPONENTE[0].id
				: evento.key === 'End' ? PASOS_ASISTENTE_COMPONENTE.at(-1)!.id
					: pasoAdyacenteComponente(actual, evento.key === 'ArrowRight' ? 1 : -1);
			mostrarPasoEditor(destino, false);
			pasos.querySelector<HTMLButtonElement>(`[data-cp-ir="${destino}"]`)?.focus();
		};
		el<HTMLButtonElement>(cuerpo, '[data-cp="anterior"]').onclick = () => mostrarPasoEditor(
			pasoAdyacenteComponente(editor!.paso ?? 'identidad', -1), true);
		el<HTMLButtonElement>(cuerpo, '[data-cp="siguiente"]').onclick = () => mostrarPasoEditor(
			pasoAdyacenteComponente(editor!.paso ?? 'identidad', 1), true);
		const tipo = el<HTMLSelectElement>(cuerpo, '[data-cp-campo="tipo"]');
		for (const p of LISTA_PERFILES_BASE) tipo.appendChild(opcion(p.id, p.nombre)); tipo.value = editor.tipo;
		tipo.onchange = () => { if (!editor) return; capturarFormulario(); editor.tipo = tipo.value as TipoDispositivo; pintarEditor(); };
		el<HTMLInputElement>(cuerpo, '[data-cp-campo="nombre"]').value = editor.datos.nombre;
		el<HTMLInputElement>(cuerpo, '[data-cp-campo="fabricante"]').value = editor.datos.fabricante;
		el<HTMLInputElement>(cuerpo, '[data-cp-campo="referencia"]').value = editor.datos.referencia;
		el<HTMLTextAreaElement>(cuerpo, '[data-cp-campo="descripcion"]').value = editor.datos.descripcion;
		el<HTMLInputElement>(cuerpo, '[data-cp-campo="ancho"]').value = String(editor.datos.anchoMm);
		el<HTMLInputElement>(cuerpo, '[data-cp-campo="alto"]').value = String(editor.datos.altoMm);
		el<HTMLInputElement>(cuerpo, '[data-cp-campo="fondo"]').value = String(editor.datos.fondoMm);
		el<HTMLInputElement>(cuerpo, '[data-cp="imagen"]').onchange = (evento) => { void cargarImagen((evento.currentTarget as HTMLInputElement).files?.[0]); };
		el<HTMLInputElement>(cuerpo, '[data-cp="imagen-apariencia"]').onchange = (evento) => { void cargarImagen((evento.currentTarget as HTMLInputElement).files?.[0]); };
		pintarFidelidad(); pintarPreview(); pintarTerminales(); pintarBloques(); pintarParametros(); pintarMontaje(); pintarApariencia();
		el<HTMLButtonElement>(cuerpo, '[data-cp="validar"]').onclick = () => { validarDesdeFormulario(false); };
		el<HTMLButtonElement>(cuerpo, '[data-cp="guardar"]').onclick = () => { void guardarDesdeFormulario(); };
		mostrarPasoEditor(editor.paso ?? 'identidad', false);
	}

	function mostrarPasoEditor(paso: PasoAsistenteComponente, enfocar = true): void {
		if (!editor) return;
		editor.paso = paso;
		for (const seccion of cuerpo.querySelectorAll<HTMLElement>('[data-cp-paso]')) {
			seccion.hidden = seccion.dataset.cpPaso !== paso;
		}
		for (const boton of cuerpo.querySelectorAll<HTMLButtonElement>('[data-cp-ir]')) {
			if (boton.dataset.cpIr === paso) boton.setAttribute('aria-current', 'step');
			else boton.removeAttribute('aria-current');
		}
		const indice = PASOS_ASISTENTE_COMPONENTE.findIndex((p) => p.id === paso);
		el<HTMLButtonElement>(cuerpo, '[data-cp="anterior"]').disabled = indice === 0;
		el<HTMLButtonElement>(cuerpo, '[data-cp="siguiente"]').hidden = indice === PASOS_ASISTENTE_COMPONENTE.length - 1;
		el<HTMLElement>(cuerpo, '[data-cp="acciones-revision"]').hidden = paso !== 'revision';
		el<HTMLElement>(cuerpo, '[data-cp="progreso"]').textContent = `Paso ${indice + 1} de ${PASOS_ASISTENTE_COMPONENTE.length}`;
		cuerpo.scrollTop = 0;
		if (paso === 'apariencia') void actualizarFichaTecnica();
		if (paso === 'revision') {
			pintarResumenEditor();
			const errores = el<HTMLElement>(cuerpo, '[data-cp="errores"]');
			errores.classList.remove('cp-ok');
			errores.textContent = 'Valida antes de guardar.';
		}
		if (enfocar) {
			const encabezado = cuerpo.querySelector<HTMLElement>(`[data-cp-paso="${paso}"] h3`);
			encabezado?.focus({ preventScroll: true });
		}
	}

	function pintarResumenEditor(): void {
		if (!editor) return;
		capturarFormulario();
		const resumen = el<HTMLElement>(cuerpo, '[data-cp="resumen"]'); resumen.replaceChildren();
		const fila = (etiqueta: string, valor: string): void => {
			const dt = document.createElement('dt'); dt.textContent = etiqueta;
			const dd = document.createElement('dd'); dd.textContent = valor;
			resumen.append(dt, dd);
		};
		fila('Nombre / referencia', `${editor.datos.nombre.trim() || 'Sin nombre'} · ${editor.datos.referencia.trim() || 'sin referencia'}`);
		fila('Familia', PERFILES_BASE[editor.tipo].nombre);
		const parametros = PERFILES_BASE[editor.tipo].parametros.map((campo) => {
			const valor = editor!.parametros[campo.clave] ?? campo.valorInicial;
			return valor === undefined ? undefined : `${campo.etiqueta}: ${String(valor)}`;
		}).filter((valor): valor is string => valor !== undefined);
		fila('Parámetros del perfil', parametros.length ? parametros.join(' · ') : 'Sin parámetros adicionales');
		fila('Bornes', editor.terminales.length ? editor.terminales.map((t) =>
			`${t.id || 'sin ID'}${t.rotulo ? ` «${t.rotulo}»` : ''} (${t.tipo ?? 'sin naturaleza'}; ${t.rol})`).join(', ') : 'Sin bornes confirmados');
		const bloques = evaluarBloquesTerminales(editor.bloquesTerminales, terminalesDesdeEditor(editor.terminales),
			{ anchoMm: editor.datos.anchoMm, altoMm: editor.datos.altoMm });
		fila('Bloques físicos', editor.bloquesTerminales?.length
			? `${editor.bloquesTerminales.length} declarados · ${bloques.estado}${editor.bloquesTerminales.some((b) => b.desde === undefined || b.hasta === undefined)
				? ' · tramo sin cotas: posición medida NO EVALUABLE' : ''}${bloques.motivos.length ? ` · ${bloques.motivos.join(' ')}` : ''}`
			: 'Sin declarar; agrupación física NO EVALUABLE');
		fila('Envolvente', `${editor.datos.anchoMm} × ${editor.datos.altoMm} × ${editor.datos.fondoMm} mm`);
		fila('Imagen', editor.assetBytes ? 'Nueva imagen pendiente de guardar' : editor.assetId ? 'Asset ya guardado' : 'Falta imagen');
		fila('Montaje', editor.montaje?.metodo === 'riel-din' ? 'Riel DIN declarado; ajuste físico pendiente de evaluar'
			: editor.montaje?.metodo === 'atornillado-placa'
				? editor.montaje.anclajes?.length
					? `Placa atornillada; ${editor.montaje.anclajes.length} ${editor.montaje.anclajes.length === 1 ? 'anclaje declarado' : 'anclajes declarados'}; ajuste físico pendiente de evaluar`
					: 'Placa atornillada sin anclajes: fijación NO EVALUABLE'
				: 'No declarado: ajuste NO EVALUABLE');
		const producto = editor.fichaTecnica?.revisiones.find((r): r is RevisionProductoTecnico =>
			r.tipo === 'PRODUCTO' && r.hash === editor!.fichaTecnica?.producto.hash);
		fila('Datos técnicos', producto
			? `${producto.nombre} · r${producto.revision} · ${producto.hash} · ${editor.fichaTecnica!.revisiones.length} revisión(es) congeladas; fuente declarada, no certificada`
			: 'Sin revisión PRODUCTO V8 vinculada');
		fila('Publicación', editor.original ? `Nueva revisión después de r${editor.original.revision}` : 'Definición nueva r1');
	}

	function pintarApariencia(): void {
		if (!editor) return;
		const caja = el<HTMLElement>(cuerpo, '[data-cp="preview-apariencia"]'); caja.replaceChildren();
		if (!editor.previewUrl) { caja.textContent = 'Todavía no hay imagen. Cárgala aquí o en el paso Bornes.'; return; }
		const img = document.createElement('img'); img.src = editor.previewUrl; img.alt = 'Imagen actual del componente';
		caja.appendChild(img);
	}

	function familiaFuncionalEditor(): FamiliaTecnica | undefined {
		if (!editor) return undefined;
		capturarParametros();
		const perfil = construirComportamientoPerfil(editor.tipo, editor.terminales, editor.parametros);
		if (!perfil.comportamiento) return undefined;
		return familiaDispositivo({ id: 'previsualizacion-componente', tipo: editor.tipo,
			bornes: terminalesDesdeEditor(editor.terminales), comportamiento: perfil.comportamiento } as Dispositivo);
	}

	async function actualizarFichaTecnica(): Promise<void> {
		const destino = editor; if (!destino) return;
		const turno = ++generacionFicha;
		const estado = el<HTMLElement>(cuerpo, '[data-cp="ficha-estado"]');
		estado.textContent = ctx.datosTecnicos ? 'Consultando revisiones publicadas de la biblioteca V8…'
			: 'Biblioteca V8 no disponible en esta sesión. La ficha ya fijada se conserva, si existe.';
		if (!ctx.datosTecnicos) { pintarFichaTecnica([]); return; }
		try {
			const revisiones = await ctx.datosTecnicos.listar();
			if (turno !== generacionFicha || editor !== destino || editor.paso !== 'apariencia') return;
			pintarFichaTecnica(revisiones);
			const familia = familiaFuncionalEditor();
			estado.textContent = familia ? `Familia funcional explícita: ${familia}. Elige una revisión exacta; ninguna se vincula automáticamente.`
				: 'El perfil y los bornes actuales no declaran una familia V8 vinculable. Completa la función antes de elegir ficha.';
		} catch (error) {
			if (turno !== generacionFicha || editor !== destino || editor.paso !== 'apariencia') return;
			pintarFichaTecnica([], true);
			estado.textContent = `No se pudo consultar Datos técnicos: ${(error as Error).message}. La ficha ya fijada no se ha modificado.`;
		}
	}

	function pintarFichaTecnica(revisiones: readonly RevisionTecnica[], falloRepositorio = false): void {
		if (!editor) return;
		const caja = el<HTMLElement>(cuerpo, '[data-cp="ficha-contenido"]'); caja.replaceChildren();
		const familia = familiaFuncionalEditor();
		const vinculada = editor.fichaTecnica;
		const productoVinculado = vinculada?.revisiones.find((r): r is RevisionProductoTecnico =>
			r.tipo === 'PRODUCTO' && r.hash === vinculada.producto.hash);
		const estadoActual = document.createElement('p'); estadoActual.className = 'cp-ficha-actual';
		estadoActual.textContent = productoVinculado
			? `Fijada en esta definición: ${productoVinculado.nombre} · r${productoVinculado.revision} · ${productoVinculado.hash}. Origen declarado: ${productoVinculado.procedencia.origen}; ${productoVinculado.procedencia.referencia}. Cierre de ${vinculada!.revisiones.length} revisión(es).`
			: 'Sin ficha técnica vinculada. Los parámetros del perfil siguen siendo declaraciones de la persona usuaria.';
		caja.appendChild(estadoActual);
		if (vinculada) {
			const perfil = construirComportamientoPerfil(editor.tipo, editor.terminales, editor.parametros);
			const errores = validarFichaTecnicaComponente({ tipoDispositivo: editor.tipo,
				terminales: terminalesDesdeEditor(editor.terminales),
				comportamiento: perfil.comportamiento ?? { version: 1, clase: 'sin-comportamiento', motivo: 'perfil incompleto' },
				fichaTecnica: vinculada });
			if (errores.length) {
				const aviso = document.createElement('p'); aviso.className = 'cp-ficha-error';
				aviso.textContent = `La ficha fijada ya no corresponde al perfil actual: ${errores.join(' ')} Corrige el perfil o desvincúlala antes de guardar.`;
				caja.appendChild(aviso);
			}
			const desvincular = document.createElement('button'); desvincular.type = 'button';
			desvincular.dataset.cp = 'desvincular-ficha'; desvincular.textContent = 'Desvincular ficha del borrador';
			desvincular.onclick = () => {
				if (!editor) return; editor.fichaTecnica = undefined; pintarFichaTecnica(revisiones);
				el<HTMLElement>(cuerpo, '[data-cp="ficha-estado"]').textContent = 'Ficha desvinculada del borrador. Guarda para crear la nueva revisión.';
			};
			caja.appendChild(desvincular);
		}
		if (!ctx.datosTecnicos || !familia || falloRepositorio) return;
		const productos = revisiones.filter((r): r is RevisionProductoTecnico => r.tipo === 'PRODUCTO' && r.familia === familia)
			.sort((a, b) => {
				const ka = `${claveRevision(referenciaTecnica(a))}:${a.hash}`;
				const kb = `${claveRevision(referenciaTecnica(b))}:${b.hash}`;
				return ka < kb ? -1 : ka > kb ? 1 : 0;
			});
		if (!productos.length) {
			const vacio = document.createElement('p');
			vacio.textContent = `No hay revisiones PRODUCTO V8 de familia ${familia} en la biblioteca global. Puedes crearlas o importarlas desde «Datos técnicos».`;
			caja.appendChild(vacio); return;
		}
		const etiqueta = document.createElement('label'); etiqueta.textContent = `Revisión PRODUCTO compatible (${familia})`;
		const selector = document.createElement('select'); selector.dataset.cp = 'producto-tecnico';
		selector.appendChild(opcion('', 'Seleccionar revisión exacta…'));
		for (const producto of productos) {
			const ref = referenciaTecnica(producto);
			selector.appendChild(opcion(JSON.stringify(ref),
				`${producto.nombre} · ${producto.catalogo.nombre} · r${producto.revision} · ${producto.estado} · ${producto.hash.slice(0, 23)}…`));
		}
		if (editor.candidatoFichaClave && productos.some((p) => JSON.stringify(referenciaTecnica(p)) === editor!.candidatoFichaClave)) {
			selector.value = editor.candidatoFichaClave;
		}
		etiqueta.appendChild(selector); caja.appendChild(etiqueta);
		const detalle = document.createElement('p'); detalle.dataset.cp = 'detalle-ficha'; caja.appendChild(detalle);
		const fijar = document.createElement('button'); fijar.type = 'button'; fijar.dataset.cp = 'vincular-ficha';
		fijar.textContent = 'Fijar revisión exacta'; caja.appendChild(fijar);
		const pintarDetalle = () => {
			const producto = productos.find((p) => JSON.stringify(referenciaTecnica(p)) === selector.value);
			detalle.textContent = producto
				? `${producto.nombre} · r${producto.revision} · ${producto.hash}. Origen declarado: ${producto.procedencia.origen}; ${producto.procedencia.referencia}. ${producto.campos.length} campo(s); ${producto.curva ? `curva dependiente ${producto.curva.hash}` : 'sin curva'}. Estado ${producto.estado}. Hash = integridad, NO autenticidad.`
				: 'La selección todavía no modifica la definición.';
			fijar.disabled = !producto;
		};
		selector.onchange = () => { if (editor) editor.candidatoFichaClave = selector.value; pintarDetalle(); };
		fijar.onclick = () => {
			const producto = productos.find((p) => JSON.stringify(referenciaTecnica(p)) === selector.value);
			if (!editor || !producto) return;
			try {
				const candidata = { producto: referenciaTecnica(producto),
					revisiones: congelarSubconjunto([referenciaTecnica(producto)], revisiones) };
				const perfil = construirComportamientoPerfil(editor.tipo, editor.terminales, editor.parametros);
				const errores = validarFichaTecnicaComponente({ tipoDispositivo: editor.tipo,
					terminales: terminalesDesdeEditor(editor.terminales),
					comportamiento: perfil.comportamiento ?? { version: 1, clase: 'sin-comportamiento', motivo: 'perfil incompleto' },
					fichaTecnica: candidata });
				if (errores.length) throw new Error(errores.join(' '));
				editor.fichaTecnica = candidata;
				pintarFichaTecnica(revisiones);
				el<HTMLElement>(cuerpo, '[data-cp="ficha-estado"]').textContent = 'Revisión exacta y curva dependiente fijadas en el borrador. Guarda para publicarlas; no implican certificación.';
			} catch (error) {
				el<HTMLElement>(cuerpo, '[data-cp="ficha-estado"]').textContent = `No se fijó la ficha: ${(error as Error).message}`;
			}
		};
		pintarDetalle();
	}

	function leerAnclajesFormulario(): NonNullable<MontajeComponente['anclajes']> {
		const numero = (fila: HTMLElement, campo: string): number => {
			const valor = el<HTMLInputElement>(fila, `[data-cp-anclaje-campo="${campo}"]`).value.trim();
			return valor ? Number(valor) : NaN;
		};
		return [...cuerpo.querySelectorAll<HTMLElement>('[data-cp-anclaje]')].map((fila) => {
			const diametro = el<HTMLInputElement>(fila, '[data-cp-anclaje-campo="diametro"]').value.trim();
			return { xMm: numero(fila, 'x'), yMm: numero(fila, 'y'),
				...(diametro ? { diametroMm: Number(diametro) } : {}) };
		});
	}

	function capturarMontaje(): void {
		if (!editor) return;
		const metodo = el<HTMLSelectElement>(cuerpo, '[data-cp-campo="montaje-metodo"]').value;
		editor.montaje = metodo === 'riel-din' ? { metodo: 'riel-din' }
			: metodo === 'atornillado-placa' ? { metodo: 'atornillado-placa', anclajes: leerAnclajesFormulario() }
				: undefined;
		if (editor.montaje?.metodo === 'atornillado-placa') {
			editor.anclajesPlacaBorrador = clonar(editor.montaje.anclajes ?? []);
		}
	}

	function pintarMontaje(): void {
		if (!editor) return;
		const metodo = el<HTMLSelectElement>(cuerpo, '[data-cp-campo="montaje-metodo"]');
		metodo.value = editor.montaje?.metodo ?? '';
		const zona = el<HTMLElement>(cuerpo, '[data-cp="montaje-extension"]'); zona.replaceChildren();
		metodo.onchange = () => {
			if (editor?.montaje?.metodo === 'atornillado-placa') {
				editor.anclajesPlacaBorrador = leerAnclajesFormulario();
			}
			editor!.montaje = metodo.value === 'riel-din' ? { metodo: 'riel-din' }
				: metodo.value === 'atornillado-placa' ? { metodo: 'atornillado-placa',
					anclajes: clonar(editor!.anclajesPlacaBorrador ?? []) } : undefined;
			pintarMontaje();
		};
		const ayuda = document.createElement('p');
		if (!editor.montaje) {
			ayuda.textContent = 'Sin método declarado, la compatibilidad mecánica queda NO EVALUABLE. Las dimensiones por sí solas no prueban el montaje.';
			zona.appendChild(ayuda); return;
		}
		if (editor.montaje.metodo === 'riel-din') {
			ayuda.textContent = 'Declaración del autor: montaje en riel DIN. El ajuste real debe evaluarse contra el riel y el espacio del tablero; guardar no certifica el componente.';
			zona.appendChild(ayuda); return;
		}
		ayuda.textContent = 'Anclajes locales en mm desde la esquina superior izquierda. Sin centros declarados no se comprueba la fijación a la placa.';
		zona.appendChild(ayuda);
		const lista = document.createElement('div'); lista.className = 'cp-anclajes';
		for (const [indice, anclaje] of (editor.montaje.anclajes ?? []).entries()) {
			const fila = document.createElement('div'); fila.className = 'cp-anclaje'; fila.dataset.cpAnclaje = String(indice);
			const campo = (nombre: string, valor: number | undefined, obligatorio: boolean): void => {
				const label = document.createElement('label'); label.textContent = nombre;
				const input = document.createElement('input'); input.type = 'number'; input.min = obligatorio ? '0' : '0.001'; input.step = 'any';
				input.dataset.cpAnclajeCampo = nombre === 'X (mm)' ? 'x' : nombre === 'Y (mm)' ? 'y' : 'diametro';
				input.value = valor !== undefined && Number.isFinite(valor) ? String(valor) : '';
				input.oninput = () => capturarMontaje(); label.appendChild(input); fila.appendChild(label);
			};
			campo('X (mm)', anclaje.xMm, true); campo('Y (mm)', anclaje.yMm, true);
			campo('Ø (mm, opcional)', anclaje.diametroMm, false);
			const quitar = document.createElement('button'); quitar.type = 'button'; quitar.textContent = 'Quitar';
			quitar.setAttribute('aria-label', `Quitar anclaje ${indice + 1}`);
			quitar.onclick = () => {
				if (!editor?.montaje || editor.montaje.metodo !== 'atornillado-placa') return;
				const restantes = leerAnclajesFormulario(); restantes.splice(indice, 1);
				editor.montaje.anclajes = restantes; editor.anclajesPlacaBorrador = clonar(restantes); pintarMontaje();
			};
			fila.appendChild(quitar); lista.appendChild(fila);
		}
		zona.appendChild(lista);
		const agregar = document.createElement('button'); agregar.type = 'button'; agregar.textContent = 'Añadir anclaje';
		agregar.disabled = (editor.montaje.anclajes?.length ?? 0) >= 64;
		if (agregar.disabled) agregar.title = 'Máximo de 64 anclajes por componente.';
		agregar.onclick = () => {
			if (!editor?.montaje || editor.montaje.metodo !== 'atornillado-placa') return;
			editor.montaje.anclajes = [...leerAnclajesFormulario(), { xMm: NaN, yMm: NaN }];
			editor.anclajesPlacaBorrador = clonar(editor.montaje.anclajes);
			pintarMontaje();
		};
		zona.appendChild(agregar);
	}

	function pintarFidelidad(): void {
		if (!editor) return; const f = PERFILES_BASE[editor.tipo].fidelidad;
		el(cuerpo, '[data-cp="fidelidad"]').textContent = `${f.nivel.toUpperCase()}: ${f.participacion} Límite: ${f.limitacion}`;
	}

	function pintarPreview(): void {
		if (!editor) return; const preview = el<HTMLDivElement>(cuerpo, '[data-cp="preview"]'); preview.innerHTML = '';
		if (!editor.previewUrl) { preview.innerHTML = '<span style="position:absolute;inset:45% 10%;text-align:center;color:#516577">Carga una imagen y haz clic para marcar bornes</span>'; return; }
		const img = document.createElement('img'); img.src = editor.previewUrl; img.alt = 'Vista del componente'; preview.appendChild(img);
		for (const t of editor.terminales) {
			const marca = document.createElement('i'); marca.className = 'cp-marca'; marca.style.left = `${t.u * 100}%`; marca.style.top = `${t.v * 100}%`;
			marca.title = `${t.id}${t.rotulo ? ` · ${t.rotulo}` : ''} (ancla sobre imagen)`;
			const rotulo = document.createElement('span'); rotulo.textContent = t.rotulo || t.id; marca.appendChild(rotulo); preview.appendChild(marca);
		}
		img.onclick = (evento) => {
			if (!editor) return; const r = img.getBoundingClientRect();
			const u = Math.max(0, Math.min(1, (evento.clientX - r.left) / r.width));
			const v = Math.max(0, Math.min(1, (evento.clientY - r.top) / r.height));
			let n = editor.terminales.length + 1; while (editor.terminales.some((t) => t.id === `X${n}`)) n++;
			editor.terminales.push({ id: `X${n}`, tipo: 'otro', u: Math.round(u * 10_000) / 10_000,
				v: Math.round(v * 10_000) / 10_000, rol: 'sin-asignar' });
			pintarPreview(); pintarTerminales(); pintarBloques();
		};
	}

	function pintarTerminales(): void {
		if (!editor) return; const tbody = el<HTMLTableSectionElement>(cuerpo, '[data-cp="terminales"]'); tbody.innerHTML = '';
		editor.terminales.forEach((terminal, indice) => {
			const tr = document.createElement('tr'); const celda = () => { const td = document.createElement('td'); tr.appendChild(td); return td; };
			const id = document.createElement('input'); id.value = terminal.id; id.oninput = () => { terminal.id = id.value; pintarPreview(); pintarSugerencias(); pintarEstadoBloques(); };
			id.onchange = () => pintarBloques(); celda().appendChild(id);
			const naturaleza = document.createElement('select'); for (const n of NATURALEZAS) naturaleza.appendChild(opcion(n, n || '—'));
			naturaleza.value = terminal.tipo ?? ''; naturaleza.onchange = () => { terminal.tipo = (naturaleza.value || undefined) as TipoBorne | undefined; pintarSugerencias(); }; celda().appendChild(naturaleza);
			const rol = document.createElement('select'); const permitidos = new Set(PERFILES_BASE[editor!.tipo].roles);
			for (const r of ROLES) rol.appendChild(opcion(r, `${permitidos.has(r) ? '' : '⚠ '}${r}`)); rol.value = terminal.rol;
			rol.onchange = () => { terminal.rol = rol.value as RolTerminalPerfil; }; celda().appendChild(rol);
			const grupo = document.createElement('input'); grupo.value = terminal.grupo ?? ''; grupo.placeholder = 'ej. polo-1'; grupo.oninput = () => { terminal.grupo = grupo.value || undefined; }; celda().appendChild(grupo);
			const rotulo = document.createElement('input'); rotulo.value = terminal.rotulo ?? ''; rotulo.placeholder = 'Opcional';
			rotulo.setAttribute('aria-label', `Rótulo visible del terminal ${terminal.id}`);
			rotulo.oninput = () => { terminal.rotulo = rotulo.value || undefined; pintarPreview(); };
			celda().appendChild(rotulo);
			const lado = document.createElement('select');
			lado.setAttribute('aria-label', `Lado de fuente del terminal ${terminal.id}`);
			for (const [valor, etiqueta] of [['', 'No declarado'], ['primario', 'Primario'],
				['secundario+', 'Secundario +'], ['secundario-', 'Secundario −']]) lado.appendChild(opcion(valor, etiqueta));
			lado.value = terminal.lado ?? '';
			lado.onchange = () => { terminal.lado = (lado.value || undefined) as TerminalEditor['lado']; };
			celda().appendChild(lado);
			const requerido = document.createElement('select');
			requerido.setAttribute('aria-label', `Conexión requerida del terminal ${terminal.id}`);
			for (const [valor, etiqueta] of [['', 'No declarado'], ['si', 'Sí'], ['no', 'No']]) requerido.appendChild(opcion(valor, etiqueta));
			requerido.value = terminal.obligatorio === undefined ? '' : terminal.obligatorio ? 'si' : 'no';
			requerido.onchange = () => { terminal.obligatorio = requerido.value === '' ? undefined : requerido.value === 'si'; };
			celda().appendChild(requerido);
			const maxHilos = document.createElement('input'); maxHilos.type = 'number'; maxHilos.min = '1'; maxHilos.step = '1';
			maxHilos.placeholder = 'No declarado'; maxHilos.title = 'Máximo de conductores admitidos; vacío si se desconoce';
			maxHilos.setAttribute('aria-label', `Máximo de conductores del terminal ${terminal.id}`);
			maxHilos.value = terminal.maxConductores === undefined ? '' : String(terminal.maxConductores);
			maxHilos.oninput = () => { terminal.maxConductores = maxHilos.value === '' ? undefined : Number(maxHilos.value); };
			celda().appendChild(maxHilos);
			const seccion = document.createElement('input'); seccion.type = 'number'; seccion.min = '0'; seccion.step = 'any';
			seccion.placeholder = 'No declarada'; seccion.title = 'Sección máxima admitida en mm²; vacío si se desconoce';
			seccion.setAttribute('aria-label', `Sección máxima del terminal ${terminal.id} en mm²`);
			seccion.value = terminal.seccionMaxMm2 === undefined ? '' : String(terminal.seccionMaxMm2);
			seccion.oninput = () => { terminal.seccionMaxMm2 = seccion.value === '' ? undefined : Number(seccion.value); };
			celda().appendChild(seccion);
			const borrar = document.createElement('button'); borrar.textContent = '−'; borrar.title = 'Quitar terminal'; borrar.onclick = () => { editor!.terminales.splice(indice, 1); pintarPreview(); pintarTerminales(); pintarBloques(); }; celda().appendChild(borrar);
			tbody.appendChild(tr);
		});
		pintarSugerencias();
	}

	function pintarEstadoBloques(): void {
		if (!editor) return;
		const estado = el<HTMLElement>(cuerpo, '[data-cp="bloques-estado"]');
		const anchoMm = Number(el<HTMLInputElement>(cuerpo, '[data-cp-campo="ancho"]').value);
		const altoMm = Number(el<HTMLInputElement>(cuerpo, '[data-cp-campo="alto"]').value);
		const evaluacion = evaluarBloquesTerminales(editor.bloquesTerminales,
			terminalesDesdeEditor(editor.terminales), { anchoMm, altoMm });
		const sinTramo = editor.bloquesTerminales?.some((bloque) => bloque.desde === undefined || bloque.hasta === undefined);
		estado.textContent = evaluacion.estado === 'SIN_DECLARAR'
			? 'SIN DECLARAR: no hay agrupación física evaluable.'
			: `${evaluacion.estado}: ${[...evaluacion.errores, ...evaluacion.motivos].join(' ')
				|| 'IDs, lados y tramos declarados sin contradicciones detectadas.'}${sinTramo
				? ' Hay tramos sin cotas: no se afirma su posición medida sobre el lado.' : ''}`;
		estado.classList.toggle('cp-ficha-error', evaluacion.errores.length > 0);
	}

	function pintarBloques(): void {
		if (!editor) return;
		const zona = el<HTMLElement>(cuerpo, '[data-cp="bloques"]'); zona.replaceChildren();
		const lista = editor.bloquesTerminales ?? [];
		for (const [indice, bloque] of lista.entries()) {
			const tarjeta = document.createElement('fieldset'); tarjeta.className = 'cp-bloque'; tarjeta.dataset.cpBloque = String(indice);
			const titulo = document.createElement('legend'); titulo.textContent = `Bloque ${indice + 1}`; tarjeta.appendChild(titulo);
			const campos = document.createElement('div'); campos.className = 'cp-campos'; tarjeta.appendChild(campos);
			const texto = (titulo: string, valor: string, cambio: (valor: string) => void, placeholder = '') => {
				const label = document.createElement('label'); label.textContent = titulo;
				const input = document.createElement('input'); input.value = valor; input.placeholder = placeholder;
				input.oninput = () => { cambio(input.value); pintarEstadoBloques(); };
				label.appendChild(input); campos.appendChild(label); return input;
			};
			texto('Rótulo del bloque', bloque.rotulo ?? '', (valor) => { bloque.rotulo = valor || undefined; }, 'ej. Potencia L1–L3');
			const ladoLabel = document.createElement('label'); ladoLabel.textContent = 'Lado físico declarado';
			const lado = document.createElement('select'); lado.dataset.cpBloqueCampo = 'lado';
			for (const valor of ['arriba', 'abajo', 'izquierda', 'derecha'] as LadoAparato[]) lado.appendChild(opcion(valor));
			lado.value = bloque.lado; lado.onchange = () => { bloque.lado = lado.value as LadoAparato; pintarEstadoBloques(); };
			ladoLabel.appendChild(lado); campos.appendChild(ladoLabel);
			const rango = (nombre: string, clave: 'desde' | 'hasta') => {
				const label = document.createElement('label'); label.textContent = nombre;
				const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '100'; input.step = 'any';
				input.dataset.cpBloqueCampo = clave; input.placeholder = 'Sin cota';
				input.value = bloque[clave] === undefined ? '' : String(Math.round(bloque[clave]! * 10000) / 100);
				input.oninput = () => { bloque[clave] = input.value === '' ? undefined : Number(input.value) / 100; pintarEstadoBloques(); };
				label.appendChild(input); campos.appendChild(label);
			};
			rango('Inicio del lado (%)', 'desde'); rango('Fin del lado (%)', 'hasta');
			const margen = texto('Margen al borde (mm)', bloque.margen === undefined ? '' : String(bloque.margen),
				(valor) => { bloque.margen = valor === '' ? undefined : Number(valor); }, 'Sin declarar');
			margen.type = 'number'; margen.min = '0'; margen.step = 'any'; margen.dataset.cpBloqueCampo = 'margen';
			const color = texto('Color declarado (#rrggbb)', bloque.color ?? '',
				(valor) => { bloque.color = valor || undefined; }, 'Sin declarar'); color.dataset.cpBloqueCampo = 'color';
			const extraibleLabel = document.createElement('label'); extraibleLabel.textContent = 'Conector extraíble';
			const extraible = document.createElement('select'); extraible.dataset.cpBloqueCampo = 'extraible';
			for (const [valor, etiqueta] of [['', 'No declarado'], ['si', 'Sí'], ['no', 'No']]) extraible.appendChild(opcion(valor, etiqueta));
			extraible.value = bloque.extraible === undefined ? '' : bloque.extraible ? 'si' : 'no';
			extraible.onchange = () => { bloque.extraible = extraible.value === '' ? undefined : extraible.value === 'si'; pintarEstadoBloques(); };
			extraibleLabel.appendChild(extraible); campos.appendChild(extraibleLabel);
			const encabezado = document.createElement('strong'); encabezado.textContent = 'Bornes en orden físico declarado'; tarjeta.appendChild(encabezado);
			const bornes = document.createElement('div'); bornes.className = 'cp-bloque-bornes'; tarjeta.appendChild(bornes);
			for (const [posicion, id] of bloque.bornes.entries()) {
				const fila = document.createElement('div'); fila.className = 'cp-bloque-borne';
				const selector = document.createElement('select'); selector.dataset.cpBloqueBorne = String(posicion);
				const ids = new Set(editor.terminales.map((terminal) => terminal.id));
				if (!ids.has(id)) selector.appendChild(opcion(id, `${id} · ID ausente`));
				for (const terminal of editor.terminales) selector.appendChild(opcion(terminal.id,
					`${terminal.id}${terminal.rotulo ? ` · ${terminal.rotulo}` : ''}`));
				selector.value = id; selector.onchange = () => { bloque.bornes[posicion] = selector.value; pintarEstadoBloques(); };
				selector.setAttribute('aria-label', `Borne ${posicion + 1} del bloque ${indice + 1}`); fila.appendChild(selector);
				const accion = (texto: string, habilitada: boolean, aplicar: () => void) => {
					const boton = document.createElement('button'); boton.type = 'button'; boton.textContent = texto;
					boton.setAttribute('aria-label', `${texto === '↑' ? 'Subir' : texto === '↓' ? 'Bajar' : 'Quitar'} borne ${posicion + 1} del bloque ${indice + 1}`);
					boton.disabled = !habilitada; boton.onclick = () => { aplicar(); pintarBloques(); };
					fila.appendChild(boton);
				};
				accion('↑', posicion > 0, () => { [bloque.bornes[posicion - 1], bloque.bornes[posicion]] = [bloque.bornes[posicion], bloque.bornes[posicion - 1]]; });
				accion('↓', posicion < bloque.bornes.length - 1, () => { [bloque.bornes[posicion + 1], bloque.bornes[posicion]] = [bloque.bornes[posicion], bloque.bornes[posicion + 1]]; });
				accion('Quitar', true, () => { bloque.bornes.splice(posicion, 1); });
				bornes.appendChild(fila);
			}
			const disponibles = editor.terminales.map((terminal) => terminal.id).filter((id) =>
				!lista.some((otro) => otro.bornes.includes(id)));
			const agregar = document.createElement('button'); agregar.type = 'button'; agregar.textContent = 'Añadir borne al bloque';
			agregar.disabled = !disponibles.length || bloque.bornes.length >= MAX_TERMINALES_BLOQUE;
			agregar.onclick = () => { bloque.bornes.push(disponibles[0]); pintarBloques(); };
			tarjeta.appendChild(agregar);
			const quitar = document.createElement('button'); quitar.type = 'button'; quitar.textContent = 'Quitar bloque';
			quitar.setAttribute('aria-label', `Quitar bloque ${indice + 1}`);
			quitar.onclick = () => { lista.splice(indice, 1); editor!.bloquesTerminales = lista.length ? lista : undefined; pintarBloques(); };
			tarjeta.appendChild(quitar); zona.appendChild(tarjeta);
		}
		const sinAsignar = editor.terminales.map((terminal) => terminal.id).find((id) => !lista.some((bloque) => bloque.bornes.includes(id)));
		const agregarBloque = el<HTMLButtonElement>(cuerpo, '[data-cp="agregar-bloque"]');
		agregarBloque.disabled = !sinAsignar || lista.length >= 128;
		agregarBloque.onclick = () => { if (!editor || !sinAsignar) return;
			editor.bloquesTerminales = [...(editor.bloquesTerminales ?? []), { lado: 'arriba', bornes: [sinAsignar] }];
			pintarBloques();
		};
		pintarEstadoBloques();
	}

	function pintarSugerencias(): void {
		if (!editor) return; const caja = cuerpo.querySelector<HTMLElement>('[data-cp="sugerencias"]'); if (!caja) return;
		const sugerencias = sugerirRolesIEC(editor.terminales.map(({ id, tipo }) => ({ id, tipo })));
		caja.innerHTML = ''; const titulo = document.createElement('strong'); titulo.textContent = 'Sugerencias IEC (solo informativas)'; caja.appendChild(titulo);
		if (!sugerencias.length) { caja.append(' — ninguna para estos rótulos.'); return; }
		const ul = document.createElement('ul'); for (const s of sugerencias) {
			const li = document.createElement('li'); li.textContent = `${s.terminalId}: ${s.rol}${s.grupo ? `, grupo ${s.grupo}` : ''} — ${s.motivo}`; ul.appendChild(li);
		} caja.appendChild(ul);
	}

	function pintarParametros(): void {
		if (!editor) return; const caja = el<HTMLDivElement>(cuerpo, '[data-cp="parametros"]'); caja.innerHTML = '';
		for (const campo of PERFILES_BASE[editor.tipo].parametros) {
			const label = document.createElement('label'); label.textContent = campo.etiqueta;
			let control: HTMLInputElement | HTMLSelectElement;
			if (campo.tipo === 'seleccion') {
				const s = document.createElement('select'); for (const o of campo.opciones ?? []) s.appendChild(opcion(o.valor, o.etiqueta)); control = s;
			} else {
				const i = document.createElement('input'); i.type = campo.tipo === 'numero' ? 'number' : campo.tipo === 'booleano' ? 'checkbox' : 'text';
				if (campo.min !== undefined) i.min = String(campo.min); if (campo.max !== undefined) i.max = String(campo.max); if (campo.paso !== undefined) i.step = String(campo.paso); control = i;
			}
			control.dataset.parametro = campo.clave;
			const actual = editor.parametros[campo.clave]; const valor = actual ?? campo.valorInicial;
			if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = Boolean(valor);
			else if (valor !== undefined) control.value = String(valor);
			control.oninput = () => capturarParametros(); label.appendChild(control); caja.appendChild(label);
		}
	}

	function capturarParametros(): void {
		if (!editor) return; const siguientes: ParametrosConstruccionPerfil = { ...editor.parametros };
		for (const control of cuerpo.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-parametro]')) {
			const clave = control.dataset.parametro as keyof ParametrosConstruccionPerfil;
			const campo = PERFILES_BASE[editor.tipo].parametros.find((x) => x.clave === clave)!;
			let valor: string | number | boolean | undefined;
			if (control instanceof HTMLInputElement && control.type === 'checkbox') valor = control.checked;
			else if (campo.tipo === 'numero') valor = control.value === '' ? undefined : Number(control.value);
			else valor = control.value || undefined;
			(siguientes as Record<string, unknown>)[clave] = valor;
		}
		editor.parametros = siguientes;
	}

	function capturarFormulario(): void {
		capturarParametros(); capturarMontaje(); if (!editor) return;
		const valor = (selector: string) => cuerpo.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value;
		const numero = (selector: string) => Number(cuerpo.querySelector<HTMLInputElement>(selector)?.value);
		const nombre = valor('[data-cp-campo="nombre"]');
		if (nombre !== undefined) editor.datos = {
			nombre, fabricante: valor('[data-cp-campo="fabricante"]') ?? '',
			referencia: valor('[data-cp-campo="referencia"]') ?? '', descripcion: valor('[data-cp-campo="descripcion"]') ?? '',
			anchoMm: numero('[data-cp-campo="ancho"]'), altoMm: numero('[data-cp-campo="alto"]'), fondoMm: numero('[data-cp-campo="fondo"]'),
		};
	}

	function datosFormulario(assetId: string): { definicion: DefinicionComponentePersonalizado; errores: string[] } {
		if (!editor) throw new Error('No hay un componente en edición.'); capturarFormulario();
		const perfil = construirComportamientoPerfil(editor.tipo, editor.terminales, editor.parametros);
		const p: ParametrosNominalesComponente = {
			tensionV: editor.parametros.tensionV, corrienteA: editor.parametros.corrienteA,
			potenciaW: editor.parametros.potenciaW, frecuenciaHz: editor.parametros.frecuenciaHz,
			...perfil.propiedades,
		};
		const ahora = new Date().toISOString(); const original = editor.original;
		const definicion: DefinicionComponentePersonalizado = {
			formato: FORMATO_COMPONENTE_PERSONALIZADO, version: VERSION_COMPONENTE_PERSONALIZADO,
			id: original?.id ?? 'pendiente', revision: original?.revision ?? 1,
			creadoEn: original?.creadoEn ?? ahora, modificadoEn: ahora,
			nombre: editor.datos.nombre.trim(), fabricante: editor.datos.fabricante.trim() || undefined,
			referencia: editor.datos.referencia.trim() || undefined, descripcion: editor.datos.descripcion.trim() || undefined,
			tipoDispositivo: editor.tipo, dimensiones: { anchoMm: editor.datos.anchoMm, altoMm: editor.datos.altoMm, fondoMm: editor.datos.fondoMm },
			assetId, terminales: terminalesDesdeEditor(editor.terminales),
			...(editor.bloquesTerminales?.length ? { bloquesTerminales: clonar(editor.bloquesTerminales) } : {}),
			...(editor.montaje ? { montaje: clonar(editor.montaje) } : {}),
			...(editor.fichaTecnica ? { fichaTecnica: clonar(editor.fichaTecnica) } : {}),
			comportamiento: perfil.comportamiento ?? { version: 1, clase: 'sin-comportamiento', motivo: 'perfil incompleto' }, parametros: p,
		};
		return { definicion, errores: [...perfil.errores, ...validarDefinicionComponente(definicion)] };
	}

	function validarDesdeFormulario(guardar: boolean): DefinicionComponentePersonalizado | undefined {
		if (!editor) return undefined; const assetId = editor.assetId ?? (editor.assetBytes ? 'asset-pendiente' : '');
		const { definicion, errores } = datosFormulario(assetId);
		const caja = el<HTMLElement>(cuerpo, '[data-cp="errores"]');
		if (errores.length) { caja.classList.remove('cp-ok'); caja.textContent = errores.map((x) => `• ${x}`).join('\n'); return undefined; }
		caja.classList.add('cp-ok'); caja.textContent = guardar ? 'Validación correcta. Guardando…' : 'Configuración válida. No se ha guardado todavía.';
		return definicion;
	}

	async function cargarImagen(archivo: File | undefined): Promise<void> {
		if (!editor || !archivo || guardando) return;
		if (!MIME_IMAGEN.has(archivo.type)) { mensaje('Solo se admiten PNG, JPEG y WebP.', true); return; }
		if (archivo.size === 0) { mensaje('La imagen está vacía.', true); return; }
		const destino = editor; const turno = ++cargaImagen;
		imagenPendiente = destino;
		try {
			const bytes = new Uint8Array(await archivo.arrayBuffer());
			// Volver a la biblioteca conserva el mismo objeto como borrador. La lectura pendiente no
			// debe perderse ni publicarse sobre otra edición abierta mientras tanto.
			if (turno !== cargaImagen || (editor !== destino && borrador !== destino)) return;
			const preview = URL.createObjectURL(archivo);
			if (urlTemporal) URL.revokeObjectURL(urlTemporal);
			urlTemporal = preview; destino.assetBytes = bytes; destino.assetMime = archivo.type;
			destino.previewUrl = preview;
			if (editor === destino) { pintarPreview(); pintarApariencia(); }
		} catch (error) {
			if (turno === cargaImagen && (editor === destino || borrador === destino)) {
				mensaje(`No se pudo leer la imagen: ${(error as Error).message}`, true);
			}
		} finally {
			if (turno === cargaImagen && imagenPendiente === destino) imagenPendiente = undefined;
		}
	}

	async function guardarDesdeFormulario(): Promise<void> {
		if (!editor || guardando) return; const preliminar = validarDesdeFormulario(true); if (!preliminar) return;
		const destino = editor;
		let persistido = false;
		const controles = [...cuerpo.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input,select,textarea,button')]
			.map((control) => ({ control, disabled: control.disabled }));
		guardando = true;
		for (const { control } of controles) control.disabled = true;
		try {
			let assetId = editor.assetId;
			if (editor.assetBytes && editor.assetMime) assetId = (await ctx.repositorio.guardarAsset(editor.assetMime, editor.assetBytes)).id;
			if (editor !== destino) throw new Error('La edición cambió durante el guardado. Vuelve a intentarlo.');
			if (!assetId) throw new Error('Falta cargar una imagen.');
			const { definicion, errores } = datosFormulario(assetId); if (errores.length) throw new Error(errores.join('; '));
			if (editor.original) {
				await ctx.repositorio.actualizarComponente(editor.original.id, {
					revisionEsperada: editor.original.revision, definicion: contenidoDe(definicion),
				});
			} else await ctx.repositorio.crearComponente({ definicion: contenidoDe(definicion) });
			persistido = true;
			editor = undefined; borrador = undefined;
			if (urlTemporal) { URL.revokeObjectURL(urlTemporal); urlTemporal = undefined; }
			guardando = false;
			await pintarBiblioteca(true);
		} catch (e) {
			const caja = cuerpo.querySelector<HTMLElement>('[data-cp="errores"], [data-cp-estado]');
			const texto = mensajeErrorGuardado(e, persistido);
			if (caja) { caja.classList.remove('cp-ok'); caja.textContent = texto; }
			else cuerpo.textContent = texto;
		} finally {
			guardando = false;
			for (const { control, disabled } of controles) if (control.isConnected) control.disabled = disabled;
		}
	}

	async function exportarComponente(d: DefinicionComponentePersonalizado): Promise<void> {
		const asset = await ctx.repositorio.abrirAsset(d.assetId); if (!asset) throw new Error(`Falta el asset ${d.assetId}.`);
		const paquete = await crearComponentePortatil(d, asset);
		descargar(nombreArchivo(d.nombre), new Blob([JSON.stringify(paquete, null, 2)], { type: 'application/json' }));
	}

	async function importarComponente(archivo: File): Promise<void> {
		try {
			const p = await leerComponentePortatilDesdeArchivo(archivo);
			const asset = { id: p.asset.id, mime: p.asset.mime, bytes: base64ABytes(p.asset.base64) };
			let comoCopia = false;
			try { await ctx.repositorio.importarComponenteConAsset({
				id: p.definicion.id, definicion: contenidoDe(p.definicion), asset,
			}); }
			catch (e) {
				if (!(e instanceof ComponentePersonalizadoDuplicado)) throw e;
				if (!await confirmar('Esa identidad pertenece a una definición existente o archivada. ¿Importar una copia con identidad nueva?')) {
					mensaje('Importación cancelada; no se guardó la imagen.');
					return;
				}
				await ctx.repositorio.importarComponenteConAsset({
					definicion: { ...contenidoDe(p.definicion), nombre: `${p.definicion.nombre} (importado)` }, asset,
				});
				comoCopia = true;
			}
			await pintarBiblioteca();
			const procedencia = p.definicion.revision > 1
				? ` El archivo era r${p.definicion.revision}; se creó r1 local sin importar su historial anterior.` : '';
			mensaje(`Componente importado${comoCopia ? ' como copia de identidad nueva' : ''}.${procedencia}`);
		} catch (e) { mensaje(`No se pudo importar: ${(e as Error).message}`, true); }
	}

	// El gestor comparte inercia, foco y Escape con el resto de ventanas. Sin él, los atajos del
	// editor seguían actuando sobre el tablero invisible y la confirmación quedaba detrás del panel.
	const bloquearAtajosDelFondo = (evento: KeyboardEvent): void => {
		if (ventanaDeArriba() === ID_RAIZ) evento.stopPropagation();
	};
	document.addEventListener('keydown', bloquearAtajosDelFondo);
	const abrirPanel = (): void => abrirVentana(ID_RAIZ, {
		// Escape, botón y cierre programático comparten la misma captura: no se pierde el borrador.
		alCerrar: () => { if (editor) capturarFormulario(); },
	});
	function cerrar(): void { cerrarVentana(ID_RAIZ); }
	raiz.querySelector<HTMLButtonElement>('[data-cp="cerrar"]')!.onclick = cerrar;
	raiz.addEventListener('click', (e) => { if (e.target === raiz) cerrar(); });

	return {
		abrir: async () => { abrirPanel(); if (!editor) await pintarBiblioteca(); },
		nuevo: () => { abrirPanel(); void iniciarNuevo(); },
		refrescar: pintarBiblioteca, cerrar,
		destruir: () => {
			cerrar(); document.removeEventListener('keydown', bloquearAtajosDelFondo);
			if (urlTemporal) URL.revokeObjectURL(urlTemporal); for (const url of urls.values()) URL.revokeObjectURL(url);
			urls.clear(); raiz.remove();
		},
	};
}
