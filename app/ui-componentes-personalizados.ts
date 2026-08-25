/**
 * Ventana autocontenida para crear y administrar «Mis Componentes».
 *
 * No depende de `main.ts` ni de nodos preexistentes: inyecta su DOM/CSS y expone un callback de
 * colocación. La persistencia pasa exclusivamente por `RepositorioProyectos`, incluidas imágenes
 * content-addressed y revisiones optimistas de la definición.
 */
import {
	FORMATO_COMPONENTE_PERSONALIZADO, VERSION_COMPONENTE_PERSONALIZADO,
	sugerirRolesIEC, validarDefinicionComponente,
	type DefinicionComponentePersonalizado, type ParametrosNominalesComponente,
} from '../src/componentes/personalizados.js';
import { base64ABytes, bytesABase64 } from '../src/componentes/assets.js';
import {
	LISTA_PERFILES_BASE, PERFILES_BASE, construirComportamientoPerfil, rolesDesdeComportamiento,
	type ParametrosConstruccionPerfil, type RolTerminalPerfil, type TerminalPerfilComponente,
} from '../src/componentes/perfiles-base.js';
import type { TipoBorne, TipoDispositivo } from '../src/modelo/tipos.js';
import { leerComportamientoSimulacion } from '../src/modelo/comportamiento.js';
import type { ContenidoComponentePersonalizado, RepositorioProyectos } from '../src/persistencia/tipos.js';

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

export interface ContextoUIComponentesPersonalizados {
	repositorio: RepositorioProyectos;
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

interface ArchivoComponentePortatil {
	formato: 'tablero-studio-componente-portatil';
	version: 1;
	definicion: DefinicionComponentePersonalizado;
	asset: { id: string; mime: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };
}

interface EstadoEditor {
	original?: DefinicionComponentePersonalizado;
	tipo: TipoDispositivo;
	datos: {
		nombre: string; fabricante: string; referencia: string; descripcion: string;
		anchoMm: number; altoMm: number; fondoMm: number;
	};
	terminales: TerminalPerfilComponente[];
	parametros: ParametrosConstruccionPerfil;
	assetId?: string;
	assetBytes?: Uint8Array;
	assetMime?: string;
	previewUrl?: string;
}

const clonar = <T>(valor: T): T => structuredClone(valor);
const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
	typeof valor === 'object' && valor !== null && !Array.isArray(valor);
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

/** Lista blanca del archivo individual. No deja campos JSON desconocidos dentro de IndexedDB. */
export function leerArchivoComponentePortatil(bruto: unknown): ArchivoComponentePortatil {
	if (!esObjeto(bruto) || bruto.formato !== 'tablero-studio-componente-portatil' || bruto.version !== 1
		|| !esObjeto(bruto.definicion) || !esObjeto(bruto.asset)) throw new Error('Formato de componente no compatible.');
	const d = bruto.definicion; const a = bruto.asset;
	const requerido = (valor: unknown, campo: string): string => {
		if (typeof valor !== 'string' || !valor.trim()) throw new Error(`Falta ${campo}.`); return valor.trim();
	};
	const opcional = (valor: unknown): string | undefined => typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
	if (d.formato !== FORMATO_COMPONENTE_PERSONALIZADO || d.version !== VERSION_COMPONENTE_PERSONALIZADO
		|| !Number.isInteger(d.revision) || !esObjeto(d.dimensiones) || !Array.isArray(d.terminales)) {
		throw new Error('La definición no es compatible.');
	}
	const tipo = requerido(d.tipoDispositivo, 'el perfil') as TipoDispositivo;
	if (!(tipo in PERFILES_BASE)) throw new Error(`Perfil no reconocido: ${tipo}.`);
	const comportamiento = leerComportamientoSimulacion(d.comportamiento);
	if (!comportamiento) throw new Error('El comportamiento del componente no es válido.');
	const terminales = d.terminales.map((terminal, i) => {
		if (!esObjeto(terminal) || typeof terminal.id !== 'string' || typeof terminal.u !== 'number' || typeof terminal.v !== 'number') {
			throw new Error(`Terminal ${i + 1} no válido.`);
		}
		const tipoBorne = typeof terminal.tipo === 'string' ? terminal.tipo as TipoBorne : undefined;
		return { id: terminal.id, ...(tipoBorne ? { tipo: tipoBorne } : {}), u: terminal.u, v: terminal.v };
	});
	let parametros: ParametrosNominalesComponente | undefined;
	if (d.parametros !== undefined) {
		if (!esObjeto(d.parametros)) throw new Error('Los parámetros no son un objeto.');
		const p = d.parametros; parametros = {};
		for (const clave of ['tensionV', 'corrienteA', 'potenciaW', 'frecuenciaHz'] as const) {
			if (typeof p[clave] === 'number') parametros[clave] = p[clave];
		}
		if (esObjeto(p.temporizacion) && (p.temporizacion.tipo === 'trabajo' || p.temporizacion.tipo === 'reposo')
			&& typeof p.temporizacion.segundos === 'number') parametros.temporizacion = { tipo: p.temporizacion.tipo, segundos: p.temporizacion.segundos };
		parametros.programa = opcional(p.programa); parametros.unidadSonda = opcional(p.unidadSonda);
		const rango = (v: unknown): [number, number] | undefined => Array.isArray(v) && v.length === 2
			&& typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : undefined;
		parametros.rangoSonda = rango(p.rangoSonda); parametros.rangoSalidaAnalogica = rango(p.rangoSalidaAnalogica);
	}
	const definicion: DefinicionComponentePersonalizado = {
		formato: FORMATO_COMPONENTE_PERSONALIZADO, version: VERSION_COMPONENTE_PERSONALIZADO,
		id: requerido(d.id, 'la identidad'), revision: d.revision as number,
		nombre: requerido(d.nombre, 'el nombre'), fabricante: opcional(d.fabricante), referencia: opcional(d.referencia),
		descripcion: opcional(d.descripcion), creadoEn: requerido(d.creadoEn, 'la fecha de creación'),
		modificadoEn: requerido(d.modificadoEn, 'la fecha de modificación'), tipoDispositivo: tipo,
		dimensiones: {
			anchoMm: Number(d.dimensiones.anchoMm), altoMm: Number(d.dimensiones.altoMm), fondoMm: Number(d.dimensiones.fondoMm),
		}, assetId: requerido(d.assetId, 'el asset'), terminales, comportamiento, ...(parametros ? { parametros } : {}),
	};
	const mime = requerido(a.mime, 'el MIME');
	if (!MIME_IMAGEN.has(mime)) throw new Error(`MIME no admitido: ${mime}.`);
	const archivo: ArchivoComponentePortatil = {
		formato: 'tablero-studio-componente-portatil', version: 1, definicion,
		asset: { id: requerido(a.id, 'la identidad del asset'), mime: mime as ArchivoComponentePortatil['asset']['mime'], base64: requerido(a.base64, 'el contenido del asset') },
	};
	const errores = validarDefinicionComponente(definicion); if (errores.length) throw new Error(errores.join('; '));
	return archivo;
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
	raiz.innerHTML = '<section class="cp-ventana" role="dialog" aria-modal="true" aria-labelledby="cp-titulo">'
		+ '<header><h2 id="cp-titulo">Mis Componentes</h2><button type="button" data-cp="cerrar" aria-label="Cerrar">✕</button></header>'
		+ '<div class="cp-cuerpo"></div></section>';
	document.body.appendChild(raiz);
	const cuerpo = el<HTMLDivElement>(raiz, '.cp-cuerpo');
	const urls = new Map<string, string>();
	let editor: EstadoEditor | undefined;
	let urlTemporal: string | undefined;
	let pintado = 0;

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

	async function pintarBiblioteca(): Promise<void> {
		editor = undefined; const turno = ++pintado;
		cuerpo.innerHTML = '<div class="cp-barra"><button class="primario" data-cp="nuevo">Nuevo componente</button>'
			+ '<button data-cp="importar">Importar</button><input data-cp="archivo-importar" type="file" accept=".json,.tscomp" hidden>'
			+ '<span class="estado" data-cp-estado>Cargando…</span></div><div class="cp-lista"></div>';
		el<HTMLButtonElement>(cuerpo, '[data-cp="nuevo"]').onclick = () => abrirNuevo();
		el<HTMLButtonElement>(cuerpo, '[data-cp="importar"]').onclick = () => el<HTMLInputElement>(cuerpo, '[data-cp="archivo-importar"]').click();
		el<HTMLInputElement>(cuerpo, '[data-cp="archivo-importar"]').onchange = async (evento) => {
			const input = evento.currentTarget as HTMLInputElement; const archivo = input.files?.[0]; input.value = '';
			if (archivo) await importarComponente(archivo);
		};
		try {
			const componentes = await ctx.repositorio.listarComponentes(); if (turno !== pintado) return;
			const lista = el<HTMLDivElement>(cuerpo, '.cp-lista'); lista.innerHTML = '';
			if (!componentes.length) { lista.innerHTML = '<p class="cp-vacio">Aún no hay componentes personales.</p>'; mensaje('0 componentes'); return; }
			for (const d of componentes) lista.appendChild(await tarjetaComponente(d));
			mensaje(`${componentes.length} componente${componentes.length === 1 ? '' : 's'}`);
		} catch (e) { mensaje(`No se pudo abrir la biblioteca: ${(e as Error).message}`, true); }
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
			tipo: 'contactor', datos: { nombre: '', fabricante: '', referencia: '', descripcion: '', anchoMm: 45, altoMm: 80, fondoMm: 60 },
			terminales: [], parametros: {},
		}; pintarEditor();
	}

	async function abrirEdicion(d: DefinicionComponentePersonalizado): Promise<void> {
		editor = {
			original: clonar(d), tipo: d.tipoDispositivo, datos: {
				nombre: d.nombre, fabricante: d.fabricante ?? '', referencia: d.referencia ?? '', descripcion: d.descripcion ?? '',
				anchoMm: d.dimensiones.anchoMm, altoMm: d.dimensiones.altoMm, fondoMm: d.dimensiones.fondoMm,
			},
			terminales: rolesDesdeComportamiento(d.terminales, d.comportamiento), parametros: parametrosDesde(d),
			assetId: d.assetId, previewUrl: await urlAsset(d.assetId),
		};
		pintarEditor();
	}

	function pintarEditor(): void {
		if (!editor) return; ++pintado;
		cuerpo.innerHTML = '<div class="cp-barra"><button data-cp="volver">← Biblioteca</button>'
			+ `<strong>${editor.original ? 'Editar componente' : 'Nuevo componente'}</strong><span class="estado" data-cp-estado></span></div>`
			+ '<div class="cp-editor"><div><section class="cp-panel"><h3>Identidad e imagen</h3><div class="cp-campos">'
			+ '<label>Nombre<input data-cp-campo="nombre"></label><label>Perfil<select data-cp-campo="tipo"></select></label>'
			+ '<label>Fabricante<input data-cp-campo="fabricante"></label><label>Referencia<input data-cp-campo="referencia"></label>'
			+ '<label>Ancho (mm)<input type="number" min="1" data-cp-campo="ancho"></label><label>Alto (mm)<input type="number" min="1" data-cp-campo="alto"></label>'
			+ '<label>Fondo (mm)<input type="number" min="1" data-cp-campo="fondo"></label><label>Imagen PNG/JPEG/WebP<input type="file" accept="image/png,image/jpeg,image/webp" data-cp="imagen"></label></div>'
			+ '<label>Descripción<textarea data-cp-campo="descripcion"></textarea></label><div class="cp-fidelidad" data-cp="fidelidad"></div>'
			+ '<div class="cp-preview" data-cp="preview"><span style="position:absolute;inset:45% 10%;text-align:center;color:#516577">Carga una imagen y haz clic para marcar bornes</span></div></section></div>'
			+ '<div><section class="cp-panel"><h3>Terminales confirmados</h3><p>Haz clic en la imagen para agregar un terminal. Las sugerencias IEC no se aplican solas.</p>'
			+ '<div class="cp-scroll"><table><thead><tr><th>ID</th><th>Naturaleza</th><th>Rol</th><th>Grupo</th><th></th></tr></thead><tbody data-cp="terminales"></tbody></table></div>'
			+ '<div class="cp-sugerencias" data-cp="sugerencias"></div></section><section class="cp-panel" style="margin-top:12px"><h3>Parámetros del perfil</h3><div class="cp-campos" data-cp="parametros"></div>'
			+ '<div class="cp-errores" data-cp="errores">Valida antes de guardar.</div><div class="cp-pie"><button data-cp="validar">Validar</button><button class="primario" data-cp="guardar">Guardar revisión</button></div></section></div></div>';
		el<HTMLButtonElement>(cuerpo, '[data-cp="volver"]').onclick = () => { void pintarBiblioteca(); };
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
		pintarFidelidad(); pintarPreview(); pintarTerminales(); pintarParametros();
		el<HTMLButtonElement>(cuerpo, '[data-cp="validar"]').onclick = () => { validarDesdeFormulario(false); };
		el<HTMLButtonElement>(cuerpo, '[data-cp="guardar"]').onclick = () => { void guardarDesdeFormulario(); };
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
			const rotulo = document.createElement('span'); rotulo.textContent = t.id; marca.appendChild(rotulo); preview.appendChild(marca);
		}
		img.onclick = (evento) => {
			if (!editor) return; const r = img.getBoundingClientRect();
			const u = Math.max(0, Math.min(1, (evento.clientX - r.left) / r.width));
			const v = Math.max(0, Math.min(1, (evento.clientY - r.top) / r.height));
			let n = editor.terminales.length + 1; while (editor.terminales.some((t) => t.id === `X${n}`)) n++;
			editor.terminales.push({ id: `X${n}`, tipo: 'otro', u: Math.round(u * 10_000) / 10_000,
				v: Math.round(v * 10_000) / 10_000, rol: 'sin-asignar' });
			pintarPreview(); pintarTerminales();
		};
	}

	function pintarTerminales(): void {
		if (!editor) return; const tbody = el<HTMLTableSectionElement>(cuerpo, '[data-cp="terminales"]'); tbody.innerHTML = '';
		editor.terminales.forEach((terminal, indice) => {
			const tr = document.createElement('tr'); const celda = () => { const td = document.createElement('td'); tr.appendChild(td); return td; };
			const id = document.createElement('input'); id.value = terminal.id; id.oninput = () => { terminal.id = id.value; pintarPreview(); pintarSugerencias(); }; celda().appendChild(id);
			const naturaleza = document.createElement('select'); for (const n of NATURALEZAS) naturaleza.appendChild(opcion(n, n || '—'));
			naturaleza.value = terminal.tipo ?? ''; naturaleza.onchange = () => { terminal.tipo = (naturaleza.value || undefined) as TipoBorne | undefined; pintarSugerencias(); }; celda().appendChild(naturaleza);
			const rol = document.createElement('select'); const permitidos = new Set(PERFILES_BASE[editor!.tipo].roles);
			for (const r of ROLES) rol.appendChild(opcion(r, `${permitidos.has(r) ? '' : '⚠ '}${r}`)); rol.value = terminal.rol;
			rol.onchange = () => { terminal.rol = rol.value as RolTerminalPerfil; }; celda().appendChild(rol);
			const grupo = document.createElement('input'); grupo.value = terminal.grupo ?? ''; grupo.placeholder = 'ej. polo-1'; grupo.oninput = () => { terminal.grupo = grupo.value || undefined; }; celda().appendChild(grupo);
			const borrar = document.createElement('button'); borrar.textContent = '−'; borrar.title = 'Quitar terminal'; borrar.onclick = () => { editor!.terminales.splice(indice, 1); pintarPreview(); pintarTerminales(); }; celda().appendChild(borrar);
			tbody.appendChild(tr);
		});
		pintarSugerencias();
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
		capturarParametros(); if (!editor) return;
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
			assetId, terminales: editor.terminales.map(({ id, tipo, u, v }) => ({ id: id.trim(), tipo, u, v })),
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
		if (!editor || !archivo) return;
		if (!MIME_IMAGEN.has(archivo.type)) { mensaje('Solo se admiten PNG, JPEG y WebP.', true); return; }
		if (archivo.size === 0) { mensaje('La imagen está vacía.', true); return; }
		if (urlTemporal) URL.revokeObjectURL(urlTemporal);
		editor.assetBytes = new Uint8Array(await archivo.arrayBuffer()); editor.assetMime = archivo.type;
		urlTemporal = URL.createObjectURL(archivo); editor.previewUrl = urlTemporal; pintarPreview();
	}

	async function guardarDesdeFormulario(): Promise<void> {
		if (!editor) return; const preliminar = validarDesdeFormulario(true); if (!preliminar) return;
		const boton = el<HTMLButtonElement>(cuerpo, '[data-cp="guardar"]'); boton.disabled = true;
		try {
			let assetId = editor.assetId;
			if (editor.assetBytes && editor.assetMime) assetId = (await ctx.repositorio.guardarAsset(editor.assetMime, editor.assetBytes)).id;
			if (!assetId) throw new Error('Falta cargar una imagen.');
			const { definicion, errores } = datosFormulario(assetId); if (errores.length) throw new Error(errores.join('; '));
			const guardado = editor.original
				? await ctx.repositorio.actualizarComponente(editor.original.id, { revisionEsperada: editor.original.revision, definicion: contenidoDe(definicion) })
				: await ctx.repositorio.crearComponente({ definicion: contenidoDe(definicion) });
			editor.original = clonar(guardado); editor.assetId = guardado.assetId; editor.assetBytes = undefined; editor.assetMime = undefined;
			await pintarBiblioteca();
		} catch (e) {
			const caja = el<HTMLElement>(cuerpo, '[data-cp="errores"]'); caja.classList.remove('cp-ok'); caja.textContent = `No se pudo guardar: ${(e as Error).message}`;
		} finally { if (boton.isConnected) boton.disabled = false; }
	}

	async function exportarComponente(d: DefinicionComponentePersonalizado): Promise<void> {
		const asset = await ctx.repositorio.abrirAsset(d.assetId); if (!asset) throw new Error(`Falta el asset ${d.assetId}.`);
		if (!MIME_IMAGEN.has(asset.mime)) throw new Error(`El MIME ${asset.mime} no es exportable.`);
		const paquete: ArchivoComponentePortatil = {
			formato: 'tablero-studio-componente-portatil', version: 1, definicion: clonar(d),
			asset: { id: asset.id, mime: asset.mime as ArchivoComponentePortatil['asset']['mime'], base64: bytesABase64(asset.bytes) },
		};
		descargar(nombreArchivo(d.nombre), new Blob([JSON.stringify(paquete, null, 2)], { type: 'application/json' }));
	}

	async function importarComponente(archivo: File): Promise<void> {
		try {
			const p = leerArchivoComponentePortatil(JSON.parse(await archivo.text()));
			if (!MIME_IMAGEN.has(p.asset.mime) || p.asset.id !== p.definicion.assetId) throw new Error('El asset no corresponde a la definición.');
			const guardado = await ctx.repositorio.guardarAsset(p.asset.mime, base64ABytes(p.asset.base64));
			if (guardado.id !== p.asset.id) throw new Error('La huella SHA-256 del asset no coincide.');
			try { await ctx.repositorio.crearComponente({ id: p.definicion.id, definicion: contenidoDe(p.definicion) }); }
			catch (e) {
				if (!await confirmar('Ya existe esa identidad o no puede importarse. ¿Crear una copia con identidad nueva?')) throw e;
				await ctx.repositorio.crearComponente({ definicion: { ...contenidoDe(p.definicion), nombre: `${p.definicion.nombre} (importado)` } });
			}
			await pintarBiblioteca(); mensaje('Componente importado.');
		} catch (e) { mensaje(`No se pudo importar: ${(e as Error).message}`, true); }
	}

	function cerrar(): void { raiz.hidden = true; }
	raiz.querySelector<HTMLButtonElement>('[data-cp="cerrar"]')!.onclick = cerrar;
	raiz.addEventListener('click', (e) => { if (e.target === raiz) cerrar(); });

	return {
		abrir: async () => { raiz.hidden = false; await pintarBiblioteca(); },
		nuevo: () => { raiz.hidden = false; abrirNuevo(); },
		refrescar: pintarBiblioteca, cerrar,
		destruir: () => {
			if (urlTemporal) URL.revokeObjectURL(urlTemporal); for (const url of urls.values()) URL.revokeObjectURL(url);
			urls.clear(); raiz.remove();
		},
	};
}
