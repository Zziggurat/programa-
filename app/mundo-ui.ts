/**
 * Interfaz de la segunda herramienta: entrar, salir, cambiar de vista, buscar entre las máquinas,
 * colorearlas por lo que interesa, medir tiradas de cable y llevarse las elegidas al tablero.
 *
 * Va en su propio módulo y no en `main.ts` a propósito: es otra herramienta, con su propio bucle
 * de dibujado y su propio estado. Lo único que comparte con el editor de tableros es el botón que
 * la abre y el proyecto que le entrega cuando se pulsa «Llevar al tablero».
 */
import * as THREE from 'three';

import datosCubierta from '../datos/cubierta.json';
import {
	EquipoPlanta, FamiliaObra, Infraestructura, OBRA, SISTEMAS, SistemaTraza, resumenObra,
	resumenPlanta,
} from '../src/modelo/infraestructura.js';
import { Proyecto } from '../src/modelo/tipos.js';
import { nombreSeguroDeArchivo } from '../src/modelo/archivos.js';
import {
	ESTADOS_OBRA, EstadoObra, Levantamiento, NotaEquipo, Tirada, avanceObra, estadosPorTag,
	leerLevantamiento, levantamientoVacio, listaDePedido, parteDeObraCSV, tiradasCSV,
} from '../src/motores/levantamiento.js';
import {
	FiltroPlanta, MODOS_COLOR, ModoColor, buscarEquipos, leyendaColor,
} from '../src/motores/planta.js';
import { Senal, tableroDesdeEquipos } from '../src/motores/planta-tablero.js';
import {
	construirMundo, crearCinta, crearPaseo, enfocarEquipo, equipoEnPixel, filtrarEquipos,
	marcarElegidos, pintarPorModo, ponerVistaPaseo, ponerVistaSims, puntoEnPixel, resaltarEquipo,
} from './mundo.js';

const inf = datosCubierta as unknown as Infraestructura;
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const esc = (t: string): string =>
	t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

let mundo: ReturnType<typeof construirMundo> | undefined;
let render: THREE.WebGLRenderer | undefined;
let paseo: ReturnType<typeof crearPaseo> | undefined;
let cinta: ReturnType<typeof crearCinta> | undefined;
let animando = false;
let vista: 'sims' | 'paseo' = 'sims';
let seleccionado: string | undefined;

/* --------------------------- Estado de la consulta --------------------------- */

const filtro: FiltroPlanta = {};
let modoColor: ModoColor = 'tipo';
/** Máquinas marcadas para llevárselas al tablero. */
const elegidas = new Set<string>();
/** Resultado vivo de la búsqueda, para no recalcularlo en cada clic. */
let encontradas: EquipoPlanta[] = [];
let midiendo = false;

/** Quien recibe el tablero armado desde la planta. Lo pone el editor al abrir la herramienta. */
let alLlevarAlTablero: ((p: Proyecto, resumen: string) => void) | undefined;

/* --------------------------- El levantamiento de la obra --------------------------- */

/**
 * Lo que se apunta subiendo a la cubierta, y que TIENE que seguir ahí mañana.
 *
 * Se guarda en el navegador, no en el proyecto del tablero: el parte de obra es de la cubierta
 * entera y sobrevive a los tableros que se armen desde ella. Y se escribe en cada cambio, sin
 * botón de guardar: nadie apunta algo en una azotea con viento y luego se acuerda de guardarlo.
 */
const CLAVE_LEVANTAMIENTO = 'tablerostudio.levantamiento';
let levantamiento: Levantamiento = levantamientoVacio();

function cargarLevantamiento(): void {
	try {
		const crudo = localStorage.getItem(CLAVE_LEVANTAMIENTO);
		levantamiento = crudo ? leerLevantamiento(JSON.parse(crudo)) : levantamientoVacio();
	} catch {
		// Un parte ilegible no puede impedir abrir la herramienta: se empieza uno nuevo.
		levantamiento = levantamientoVacio();
	}
}

function guardarLevantamiento(): void {
	try {
		localStorage.setItem(CLAVE_LEVANTAMIENTO, JSON.stringify(levantamiento));
	} catch { /* sin sitio o en modo privado: se sigue trabajando, solo que sin memoria. */ }
}

/** Descarga un texto con nombre seguro (ASCII): con una tilde, Chromium tira el nombre entero. */
function descargar(nombre: string, texto: string, tipo = 'text/csv;charset=utf-8'): void {
	const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
	const a = document.createElement('a');
	a.href = url;
	a.download = nombreSeguroDeArchivo(nombre, 'levantamiento');
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------- Cabecera y ficha ------------------------------- */

function pintarResumen(): void {
	const r = resumenPlanta(inf);
	$('mundo-titulo').textContent = `${inf.nombre} · ${((inf.zona.x1 - inf.zona.x0) / 1000).toFixed(0)}`
		+ ` × ${((inf.zona.y1 - inf.zona.y0) / 1000).toFixed(0)} m · de ${inf.origen.archivo}`;
	const tarjetas: [string, string][] = [
		['UMAs', String(r.umas)],
		['Extractores', String(r.vex)],
		['Puntos de BMS', String(r.puntosTotales)],
		['Con controlador', String(r.conControlador)],
	];
	$('mundo-resumen').innerHTML = tarjetas
		.map(([rot, cif]) => `<div><div class="cifra">${cif}</div><div class="rotulo">${rot}</div></div>`)
		.join('');
	const fila = (color: number, nombre: string, cola: string): string =>
		`<div class="mundo-fila-sis"><span class="tira" style="background:${hex(color)}"></span>`
		+ `${esc(nombre)} · ${cola}</div>`;
	/*
	 * La misma clave, en pequeño, para el paseo: ahí el panel lateral no se ve y sin esto el color
	 * de cada conducto no significa nada. La forma de la muestra acompaña a la del 3D —tira plana
	 * para lo rectangular, punto para lo redondo— porque en la cubierta se distinguen por la forma
	 * antes que por el color.
	 */
	const REDONDOS = new Set(['agua', 'agua-fria', 'bus']);
	$('mundo-clave').innerHTML = r.metrosPorSistema
		.map((s) => {
			const sis = SISTEMAS[s.sistema as SistemaTraza];
			const redondo = REDONDOS.has(s.sistema) ? ' redondo' : '';
			return `<span><i class="${redondo}" style="background:${hex(sis.color)}"></i>${esc(sis.nombre)}</span>`;
		}).join('');
	$('mundo-leyenda').innerHTML = r.metrosPorSistema
		.map((s) => fila(SISTEMAS[s.sistema as SistemaTraza].color,
			SISTEMAS[s.sistema as SistemaTraza].nombre, `${s.metros} m`))
		.join('');
	// La obra de la cubierta: lo que hay alrededor de las máquinas, también sacado del plano.
	const obra = resumenObra(inf);
	const pilares = inf.columnas?.length ?? 0;
	$('mundo-leyenda-obra').innerHTML = obra.length || pilares
		? obra.map((o) => fila(OBRA[o.familia as FamiliaObra].color, OBRA[o.familia as FamiliaObra].nombre, `${o.metros} m`)).join('')
			+ (pilares ? fila(0x9aa4ae, 'Pilares de estructura', String(pilares)) : '')
		: '<div class="vacio">Este plano no trae la obra de la cubierta.</div>';
	// El aviso no se puede quitar: es la diferencia entre un modelo y una medida.
	$('mundo-aviso').innerHTML = inf.alturasSupuestas
		? '⚠️ <b>Las alturas son de proyecto, no del plano.</b> El DWG no trae ninguna cota Z, ni en '
			+ 'las capas de clima ni en las de obra, así que las cotas de conductos, máquinas, '
			+ 'barandas, muros y pilares se han asignado por reglas. <b>Lo que sí es del plano</b> es '
			+ 'todo el recorrido en planta y el diámetro de cada pilar. Un marcado con <b>?</b> es una '
			+ 'máquina situada por su posición, sin rótulo en el plano.'
		: '';
	pintarFicha(undefined);
}

function pintarFicha(e: EquipoPlanta | undefined): void {
	const cont = $('mundo-ficha');
	if (!e) {
		cont.innerHTML = '<div class="vacio">Haz clic en una máquina, o búscala por su marcado, para '
			+ 'ver su lista de puntos de control.</div>';
		return;
	}
	const medidas = e.ancho && e.fondo
		? `${(e.ancho / 1000).toFixed(2)} × ${(e.fondo / 1000).toFixed(2)} m`
		: 'sin situar en planta';
	const filas = e.puntos.map((p) => `<div class="punto-bms"><span class="sigla">${esc(p.sigla)}</span>`
		+ `<span><span class="que">${esc(p.que)}</span><br><span class="clase">${esc(p.clase)}</span></span></div>`).join('');
	cont.innerHTML = `<div class="tag">${esc(e.tag)}${e.tagSeguro ? '' : ' <span style="color:var(--texto-suave)">?</span>'}</div>`
		+ `<div class="meta">${e.tipo === 'uma' ? 'Unidad manejadora de aire' : 'Ventilador extractor'} · ${medidas}</div>`
		+ (e.controlador ? `<span class="ctrl">${esc(e.controlador)}</span>` : '')
		+ (e.enTablero ? '<span class="en-tablero">cableado en el tablero</span>' : '')
		+ (e.puntos.length
			? `<h3>Puntos de control (${e.puntos.length})</h3>${filas}`
			: '<h3>Puntos de control</h3><div class="vacio">El plano no dibuja el diagrama de control '
				+ 'de esta máquina.</div>')
		+ (e.tagSeguro ? '' : '<p style="font-size:11.5px;color:var(--aviso);margin-top:10px">Este marcado '
			+ 'se ha deducido de la posición: el plano no lo rotula aquí.</p>')
		+ parteDeMaquina(e);
	engancharParte(e.tag);
}

/**
 * El parte de obra de UNA máquina: en qué punto está y qué se ha encontrado en ella.
 *
 * Esto es lo que convierte el visor en una herramienta de campo. El plano dice cómo tendría que
 * ser la cubierta; el parte dice cómo está HOY, que es lo que hace falta para decidir a qué máquina
 * subir mañana y qué material llevarse.
 */
function parteDeMaquina(e: EquipoPlanta): string {
	const n = levantamiento.notas[e.tag];
	const estado = n?.estado ?? 'pendiente';
	const chips = ESTADOS_OBRA.map((x) =>
		`<button class="chip-estado${x.estado === estado ? ' activo' : ''}" data-estado="${x.estado}" `
		+ `style="--c:${hex(x.color)}">${esc(x.nombre)}</button>`).join('');
	return '<h3>Parte de obra</h3>'
		+ `<div class="estados-obra">${chips}</div>`
		+ `<textarea id="mundo-nota" rows="3" placeholder="Qué te has encontrado en esta máquina: `
		+ `«falta prensaestopas», «el sensor de retorno está suelto»…">${esc(n?.nota ?? '')}</textarea>`
		+ (n ? `<div class="pie-nota">Apuntado el ${n.fecha.slice(0, 10)}</div>` : '');
}

/** Engancha los mandos del parte. Se guarda solo: en una azotea nadie le da a «Guardar». */
function engancharParte(tag: string): void {
	const anotar = (cambio: Partial<Omit<NotaEquipo, 'tag'>>): void => {
		const previa = levantamiento.notas[tag];
		levantamiento.notas[tag] = {
			tag,
			estado: cambio.estado ?? previa?.estado ?? 'pendiente',
			nota: cambio.nota ?? previa?.nota ?? '',
			fecha: new Date().toISOString(),
		};
		guardarLevantamiento();
	};
	for (const b of $('mundo-ficha').querySelectorAll<HTMLButtonElement>('[data-estado]')) {
		b.onclick = () => {
			anotar({ estado: b.dataset.estado as EstadoObra });
			pintarFicha(inf.equipos.find((x) => x.tag === tag));
			if (modoColor === 'obra') aplicarColor();
			pintarAvance();
			pintarLista();
		};
	}
	const caja = document.getElementById('mundo-nota') as HTMLTextAreaElement | null;
	if (caja) {
		caja.onchange = () => { anotar({ nota: caja.value }); pintarAvance(); pintarLista(); };
		caja.onblur = caja.onchange;
	}
}

/** Cómo va la obra: la barra de reparto por estados y el porcentaje ya probado. */
function pintarAvance(): void {
	const avance = avanceObra(levantamiento, inf);
	const total = inf.equipos.length || 1;
	const hechas = avance.find((a) => a.estado === 'probado')?.cuantos ?? 0;
	$('mundo-avance').innerHTML =
		`<div class="barra-obra">${avance.filter((a) => a.cuantos > 0).map((a) =>
			`<span style="background:${hex(a.color)};flex:${a.cuantos}" title="${esc(a.nombre)}: ${a.cuantos}"></span>`)
			.join('')}</div>`
		+ `<div class="mundo-fila-sis" style="margin-top:6px"><b style="color:var(--texto)">`
		+ `${Math.round((hechas / total) * 100)} %</b> probado · ${hechas} de ${total} máquinas</div>`
		+ avance.filter((a) => a.cuantos > 0 && a.estado !== 'pendiente').map((a) =>
			`<div class="mundo-fila-sis"><span class="tira" style="background:${hex(a.color)}"></span>`
			+ `${esc(a.nombre)} · ${a.cuantos}</div>`).join('');
}

/* --------------------------- Buscar, filtrar y colorear --------------------------- */

/** Los filtros de una línea, que son los que se usan de verdad al subir a la cubierta. */
const CHIPS: { clave: keyof FiltroPlanta; valor: unknown; texto: string; ayuda: string }[] = [
	{ clave: 'tipo', valor: 'uma', texto: 'UMAs', ayuda: 'Solo unidades manejadoras de aire' },
	{ clave: 'tipo', valor: 'vex', texto: 'Extractores', ayuda: 'Solo ventiladores extractores' },
	{ clave: 'conPuntos', valor: true, texto: 'Con señales', ayuda: 'Las que traen su diagrama de control dibujado' },
	{ clave: 'conControlador', valor: true, texto: 'Con controlador', ayuda: 'Las que el plano rotula con su DDC' },
	{ clave: 'situados', valor: true, texto: 'En planta', ayuda: 'Las que se pueden ver en el 3D' },
];

function pintarChips(): void {
	$('mundo-chips').innerHTML = CHIPS.map((c, i) => {
		const activo = (filtro as Record<string, unknown>)[c.clave] === c.valor;
		return `<button class="chip-mundo${activo ? ' activo' : ''}" data-chip="${i}" `
			+ `title="${esc(c.ayuda)}">${esc(c.texto)}</button>`;
	}).join('');
	for (const b of $('mundo-chips').querySelectorAll<HTMLButtonElement>('[data-chip]')) {
		b.onclick = () => {
			const c = CHIPS[Number(b.dataset.chip)];
			const campo = filtro as Record<string, unknown>;
			campo[c.clave] = campo[c.clave] === c.valor ? undefined : c.valor;
			pintarChips();
			refrescarBusqueda();
		};
	}
}

function pintarSelectorColor(): void {
	const sel = $('mundo-color') as HTMLSelectElement;
	sel.innerHTML = MODOS_COLOR
		.map((m) => `<option value="${m.modo}" title="${esc(m.ayuda)}">${esc(m.nombre)}</option>`)
		.join('');
	sel.value = modoColor;
	sel.onchange = () => { modoColor = sel.value as ModoColor; aplicarColor(); };
}

function aplicarColor(): void {
	const estados = estadosPorTag(levantamiento);
	if (mundo) pintarPorModo(mundo, modoColor, estados);
	const situados = inf.equipos.filter((e) => e.x !== null).length;
	$('mundo-leyenda-color').innerHTML = leyendaColor(inf, modoColor, estados)
		.filter((l) => l.cuantos > 0)
		.map((l) => `<div class="mundo-fila-sis"><span class="tira" style="background:${hex(l.color)}">`
			+ `</span>${esc(l.nombre)} · ${l.cuantos}</div>`)
		.join('')
		// Sin esto, elegir «Controlador» y ver dos colores donde la leyenda dice seis canales
		// parece un fallo del programa, y no lo es: el plano solo sitúa en planta a una parte de
		// las máquinas. Las demás están en la lista, con sus datos, pero no en el 3D.
		+ (situados < inf.equipos.length
			? `<div class="mundo-fila-sis" style="margin-top:6px">El plano sitúa en planta `
				+ `<b style="color:var(--texto)">${situados}</b> de las ${inf.equipos.length}; las `
				+ `demás salen en la lista pero no en el 3D.</div>`
			: '');
}

/** Vuelve a buscar con lo que hay escrito y repinta la lista, el 3D y los contadores. */
function refrescarBusqueda(): void {
	filtro.texto = ($('mundo-q') as HTMLInputElement).value.trim() || undefined;
	encontradas = buscarEquipos(inf, filtro);
	const hayFiltro = !!filtro.texto || CHIPS.some((c) =>
		(filtro as Record<string, unknown>)[c.clave] === c.valor);
	if (mundo) filtrarEquipos(mundo, hayFiltro ? new Set(encontradas.map((e) => e.tag)) : undefined);
	$('mundo-cuenta-txt').textContent = hayFiltro
		? `${encontradas.length} de ${inf.equipos.length} máquinas`
		: `${inf.equipos.length} máquinas`;
	pintarLista();
}

function pintarLista(): void {
	const cont = $('mundo-lista');
	if (encontradas.length === 0) {
		cont.innerHTML = '<div id="mundo-vacio">Nada encaja con esa búsqueda. Prueba con el número '
			+ 'del marcado, con el controlador o con lo que hace la señal («válvula», «alarma»).</div>';
		return;
	}
	// Se listan como mucho 200: más no se leen, y pintar 129 filas por tecla se nota al escribir.
	cont.innerHTML = encontradas.slice(0, 200).map((e) => {
		const marcada = elegidas.has(e.tag) ? ' checked' : '';
		const sel = e.tag === seleccionado ? ' sel' : '';
		const nombre = e.tagSeguro ? esc(e.tag) : `${esc(e.tag)} <span class="sin">?</span>`;
		// El punto de color es el parte de obra en la lista: sin abrir la ficha ya se ve lo que
		// queda por hacer, que es la pregunta con la que uno sube a la cubierta.
		const n = levantamiento.notas[e.tag];
		const est = ESTADOS_OBRA.find((x) => x.estado === (n?.estado ?? 'pendiente'))!;
		// La nota la escribe el usuario en la azotea y viaja en el parte de obra, así que se
		// escapa ENTERA, tooltip incluido: iba cruda al `title` y una comilla lo truncaba.
		const punto = n
			? `<span class="punto-obra" style="background:${hex(est.color)}" `
				+ `title="${esc(est.nombre + (n.nota ? `: ${n.nota}` : ''))}"></span>`
			: '<span class="punto-obra vacio"></span>';
		return `<label class="fila-eq${sel}" data-tag="${esc(e.tag)}" title="${esc(e.controlador ?? 'sin controlador en el plano')}">`
			+ `<input type="checkbox"${marcada}>${punto}<span class="nom">${nombre}</span>`
			+ `<span class="np${e.puntos.length ? '' : ' cero'}">${e.puntos.length}</span></label>`;
	}).join('') + (encontradas.length > 200
		? `<div id="mundo-vacio">…y ${encontradas.length - 200} más. Afina la búsqueda.</div>` : '');

	for (const f of cont.querySelectorAll<HTMLElement>('.fila-eq')) {
		const tag = f.dataset.tag!;
		const casilla = f.querySelector('input')!;
		casilla.onclick = (ev) => {
			ev.stopPropagation();
			if (casilla.checked) elegidas.add(tag); else elegidas.delete(tag);
			pintarElegidas();
		};
		f.onclick = (ev) => {
			if (ev.target === casilla) return;
			ev.preventDefault();
			seleccionar(tag, true);
		};
	}
}

/** Selecciona una máquina: la enseña en la ficha, la resalta y, si se pide, encuadra la vista. */
function seleccionar(tag: string | undefined, enfocar = false): void {
	seleccionado = tag;
	const e = inf.equipos.find((x) => x.tag === tag);
	if (mundo) resaltarEquipo(mundo, tag);
	pintarFicha(e);
	if (enfocar && mundo && e && e.x !== null && vista === 'sims') enfocarEquipo(mundo, e.tag);
	pintarLista();
}

function pintarElegidas(): void {
	if (mundo) marcarElegidos(mundo, elegidas);
	const eq = inf.equipos.filter((e) => elegidas.has(e.tag));
	const senales = eq.reduce((s, e) => s + e.puntos.length, 0);
	$('mundo-elegidas-txt').innerHTML = eq.length === 0
		? 'Marca máquinas en la lista para armar con ellas el tablero que las gobierna.'
		: `<b>${eq.length}</b> máquina${eq.length === 1 ? '' : 's'} · <b>${senales}</b> señales`
			+ (eq.some((e) => e.puntos.length === 0)
				? ' · <span style="color:var(--aviso)">alguna sin diagrama en el plano</span>' : '');
	($('mundo-a-tablero') as HTMLButtonElement).disabled = senales === 0;
	pintarLista();
}

/* --------------------------------- La cinta métrica --------------------------------- */

function activarMedir(activo: boolean): void {
	midiendo = activo;
	$('mundo-medir').classList.toggle('activo', activo);
	($('mundo-cinta') as HTMLElement).hidden = !activo;
	cinta?.visible(activo);
	if (!activo) cinta?.reiniciar();
	pintarCinta();
}

function pintarCinta(): void {
	const med = cinta?.medida();
	const cuantos = cinta?.cuantos() ?? 0;
	const extremos = cinta?.extremos() ?? [];
	const cuerpo = $('mundo-cinta-cuerpo');
	const botones = '<div class="botones">'
		+ '<button class="boton" id="cinta-deshacer">↶ Quitar último</button>'
		+ '<button class="boton" id="cinta-limpiar">Empezar de nuevo</button></div>';
	/*
	 * La lista de puntos, con su aspa para quitar CUALQUIERA.
	 *
	 * Es lo que faltaba para que medir no fuera un incordio: en una tirada de doce puntos te
	 * equivocas en el tercero, y con solo «quitar el último» tenías que deshacer nueve buenos.
	 */
	const lista = (cinta?.listado() ?? []);
	const listaHtml = lista.length
		? '<div class="puntos-cinta">' + lista.map((p) => `<div class="punto-cinta">`
			+ `<span class="n">${p.indice + 1}</span>`
			+ `<span class="d">${p.nombre ? esc(p.nombre) : `${p.x.toFixed(1)} , ${p.z.toFixed(1)} m`}</span>`
			+ `<button class="quitar" data-punto="${p.indice}" title="Quitar este punto">✕</button>`
			+ `</div>`).join('') + '</div>'
		: '';
	cuerpo.innerHTML = !med
		? `<div class="ayuda">Haz clic en la cubierta para marcar por dónde va el cable, o `
			+ `<b>en una máquina</b> para medir hasta ella exactamente. Con dos puntos ya hay `
			+ `medida.${cuantos ? ' <b>1 punto marcado.</b>' : ''}</div>`
			+ listaHtml + (cuantos ? botones : '')
		: `<div class="cifras">`
			+ `<div><div class="cifra">${med.recorrido.toFixed(1)} m</div>`
			+ `<div class="rotulo">Recorrido</div></div>`
			+ `<div><div class="cifra">${med.recta.toFixed(1)} m</div>`
			+ `<div class="rotulo">En recta</div></div>`
			+ `<div><div class="cifra">${med.vertical.toFixed(1)} m</div>`
			+ `<div class="rotulo">Subida y bajada</div></div>`
			+ `<div><div class="cifra">${med.tramos}</div><div class="rotulo">Tramos</div></div>`
			+ `<div class="pedir"><div class="cifra">${med.cablePedido} m</div>`
			+ `<div class="rotulo">Cable a pedir (con ${Math.round(med.reserva * 100)} % de reserva)</div></div>`
			+ `</div>`
			+ (extremos.length
				? `<div class="ayuda">Pasa por <b>${extremos.map(esc).join('</b> → <b>')}</b>.</div>`
				: '')
			+ `<div class="ayuda">El recorrido va en ortogonal, como la bandeja; la recta es solo el `
			+ `mínimo teórico. La subida y la bajada suponen la bandeja a 3,2 m.</div>`
			+ listaHtml + botones;
	const deshacer = document.getElementById('cinta-deshacer');
	if (deshacer) deshacer.onclick = () => { cinta?.deshacer(); pintarCinta(); };
	const limpiar = document.getElementById('cinta-limpiar');
	if (limpiar) limpiar.onclick = () => { cinta?.reiniciar(); pintarCinta(); };
	for (const b of cuerpo.querySelectorAll<HTMLButtonElement>('[data-punto]')) {
		b.onclick = () => { cinta?.quitar(Number(b.dataset.punto)); pintarCinta(); };
	}
	pintarGuardarTirada(med ? extremos : []);
	pintarTiradas();
}

/* ------------------------ Guardar la tirada y pedir el cable ------------------------ */

/** Secciones que se usan de verdad en una cubierta, de la señal a la fuerza del ventilador. */
const SECCIONES = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16];

/**
 * El formulario de guardar la tirada: nombre, cable y a la lista.
 *
 * Medir sin guardar no sirve de nada. Quien sube a la cubierta mide seis u ocho tiradas seguidas y
 * lo que baja es UNA lista de metros por tipo de cable: eso es lo que se pide, y eso es lo que
 * hasta ahora había que apuntar en el móvil.
 */
function pintarGuardarTirada(extremos: string[]): void {
	const caja = $('mundo-guardar-tirada');
	const med = cinta?.medida();
	if (!med) { caja.innerHTML = ''; return; }
	const sugerido = extremos.length >= 2
		? `${extremos[0]} → ${extremos[extremos.length - 1]}`
		: `Tirada ${levantamiento.tiradas.length + 1}`;
	caja.innerHTML = '<div class="guardar-tirada">'
		+ `<input id="tirada-nombre" value="${esc(sugerido)}" placeholder="Nombre de la tirada">`
		+ '<div class="cable">'
		+ '<select id="tirada-hilos" title="Cuántos hilos van por el mismo recorrido">'
		+ [2, 3, 4, 5, 7, 12].map((h) => `<option value="${h}"${h === 4 ? ' selected' : ''}>${h} hilos</option>`).join('')
		+ '</select>'
		+ '<select id="tirada-seccion" title="Sección de cada hilo">'
		+ SECCIONES.map((s) => `<option value="${s}"${s === 2.5 ? ' selected' : ''}>`
			+ `${String(s).replace('.', ',')} mm²</option>`).join('')
		+ '</select>'
		+ `<button class="boton primario" id="tirada-guardar">Guardar ${med.cablePedido} m</button>`
		+ '</div></div>';
	$('tirada-guardar').onclick = () => {
		const m = cinta?.medida();
		if (!m) return;
		const nombre = ($('tirada-nombre') as HTMLInputElement).value.trim() || sugerido;
		const nueva: Tirada = {
			id: `t${Date.now().toString(36)}`,
			nombre,
			desde: extremos[0],
			hasta: extremos.length >= 2 ? extremos[extremos.length - 1] : undefined,
			metros: m.cablePedido,
			recorrido: Number((m.recorrido + m.vertical).toFixed(1)),
			seccion: Number(($('tirada-seccion') as HTMLSelectElement).value),
			conductores: Number(($('tirada-hilos') as HTMLSelectElement).value),
			fecha: new Date().toISOString(),
		};
		levantamiento.tiradas.push(nueva);
		guardarLevantamiento();
		cinta?.reiniciar();
		pintarCinta();
	};
}

/** Las tiradas ya guardadas y, debajo, lo que suman: la lista con la que se pide el cable. */
function pintarTiradas(): void {
	const caja = $('mundo-tiradas');
	if (levantamiento.tiradas.length === 0) {
		caja.innerHTML = '<div class="ayuda">Aún no has guardado ninguna tirada. Mide una y guárdala: '
			+ 'el programa te irá sumando los metros por tipo de cable.</div>';
		return;
	}
	const filas = levantamiento.tiradas.map((t) => `<div class="fila-tirada" data-tirada="${esc(t.id)}">`
		+ `<span class="nom">${esc(t.nombre)}</span>`
		+ `<span class="cable">${t.conductores}×${String(t.seccion).replace('.', ',')}</span>`
		+ `<span class="m">${t.metros} m</span>`
		+ '<button class="quitar" title="Quitar esta tirada">✕</button></div>').join('');
	const pedido = listaDePedido(levantamiento.tiradas);
	const total = pedido.reduce((s, f) => s + f.metros, 0);
	caja.innerHTML = `<h3>Tiradas guardadas (${levantamiento.tiradas.length})</h3>`
		+ `<div class="lista-tiradas">${filas}</div>`
		+ '<h3>Cable a pedir</h3>'
		+ pedido.map((f) => `<div class="fila-pedido"><span>${esc(f.cable)}</span>`
			+ `<b>${f.metros} m</b></div>`).join('')
		+ `<div class="fila-pedido total"><span>Total de manguera</span><b>${total} m</b></div>`
		+ '<div class="botones"><button class="boton" id="tiradas-csv">⬇️ Lista en CSV</button>'
		+ '<button class="boton" id="tiradas-vaciar">Vaciar</button></div>';
	for (const f of caja.querySelectorAll<HTMLElement>('.fila-tirada')) {
		f.querySelector<HTMLButtonElement>('.quitar')!.onclick = () => {
			levantamiento.tiradas = levantamiento.tiradas.filter((t) => t.id !== f.dataset.tirada);
			guardarLevantamiento();
			pintarTiradas();
		};
	}
	$('tiradas-csv').onclick = () => descargar(`Tiradas ${inf.nombre}.csv`, tiradasCSV(levantamiento));
	$('tiradas-vaciar').onclick = () => {
		if (!confirm('¿Borrar todas las tiradas medidas? Esto no se puede deshacer.')) return;
		levantamiento.tiradas = [];
		guardarLevantamiento();
		pintarTiradas();
	};
}

/* ------------------------------ Del mundo al tablero ------------------------------ */

let puenteListo: ReturnType<typeof tableroDesdeEquipos> | undefined;

function abrirPuente(): void {
	// Se respeta el orden en que se listan, que es el orden de marcado del proyecto.
	const tags = inf.equipos.filter((e) => elegidas.has(e.tag)).map((e) => e.tag);
	puenteListo = tableroDesdeEquipos(inf, tags);
	const r = puenteListo;
	$('puente-sub').textContent = `${r.proyecto.nombre}. Esto es lo que va a salir: revísalo antes `
		+ 'de armarlo.';
	$('puente-notas').innerHTML = r.notas.map((n) => `<li>${esc(n)}</li>`).join('');
	$('puente-tabla').innerHTML = r.senales.length === 0
		? '<div style="padding:16px;color:var(--texto-suave);font-size:12.5px">Ninguna de las '
			+ 'máquinas elegidas trae señales dibujadas en el plano.</div>'
		: tablaSenales(r.senales);
	($('modal-puente') as HTMLElement).hidden = false;
}

function tablaSenales(senales: Senal[]): string {
	const filas = senales.map((s) => `<tr><td class="mono">${esc(s.tag)}</td>`
		+ `<td class="mono">${esc(s.sigla)}</td><td class="que">${esc(s.que)}</td>`
		+ `<td>${esc(s.familia)}</td><td class="mono">${esc(s.terminal)}</td>`
		+ `<td class="mono">${esc(s.borna)}/${esc(s.bornaComun)}</td>`
		+ `<td>${s.seccion} mm²</td></tr>`).join('');
	return '<table><thead><tr><th>Máquina</th><th>Señal</th><th>Qué es</th><th>E/S</th>'
		+ '<th>Terminal</th><th>Bornas</th><th>Sección</th></tr></thead>'
		+ `<tbody>${filas}</tbody></table>`;
}

function armarTablero(): void {
	if (!puenteListo || !alLlevarAlTablero) return;
	const r = puenteListo;
	($('modal-puente') as HTMLElement).hidden = true;
	alLlevarAlTablero(r.proyecto, `${r.senales.length} señales y ${r.bornas} bornas desde el plano`);
	cerrarMundo();
}

/* ---------------------------------- Vistas y bucle ---------------------------------- */

/**
 * Esconder o mostrar los paneles laterales.
 *
 * Paseando ocupan media pantalla, y a pie lo que se quiere es ver la cubierta; pero la lista de
 * máquinas y el buscador hacen falta a cada rato, así que no se pueden quitar sin más. Con un
 * botón lo decide quien trabaja, según lo que esté haciendo en ese momento.
 */
let panelesVisibles = true;
function verPaneles(mostrar: boolean): void {
	panelesVisibles = mostrar;
	$('mundo').classList.toggle('sin-paneles', !mostrar);
	$('mundo-paneles').classList.toggle('activo', !mostrar);
	$('mundo-paneles').setAttribute('title', mostrar
		? 'Esconder los paneles laterales para ver la cubierta entera (tecla H)'
		: 'Volver a mostrar el buscador y la lista de máquinas (tecla H)');
}

function cambiarVista(nueva: 'sims' | 'paseo'): void {
	if (!mundo) return;
	vista = nueva;
	$('mundo-sims').classList.toggle('activo', nueva === 'sims');
	$('mundo-paseo').classList.toggle('activo', nueva === 'paseo');
	($('mundo-pie') as HTMLElement).hidden = nueva !== 'paseo';
	if (nueva === 'paseo') {
		ponerVistaPaseo(mundo);
		paseo?.activar();
		($('mundo-invertir') as HTMLInputElement).checked = paseo?.estaInvertido() ?? false;
	} else { paseo?.desactivar(); ponerVistaSims(mundo); }
}

function ajustar(): void {
	if (!render || !mundo) return;
	const l = render.domElement;
	const an = l.clientWidth || window.innerWidth;
	const al = l.clientHeight || window.innerHeight;
	render.setSize(an, al, false);
	mundo.camara.aspect = an / al;
	mundo.camara.updateProjectionMatrix();
}

/** Abre la herramienta. Se construye la escena la primera vez y se reutiliza después. */
export function abrirMundo(alTablero?: (p: Proyecto, resumen: string) => void): void {
	alLlevarAlTablero = alTablero ?? alLlevarAlTablero;
	($('mundo') as HTMLElement).hidden = false;
	const lienzo = $('mundo-lienzo') as HTMLCanvasElement;
	if (!mundo) {
		render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
		render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		render.shadowMap.enabled = true;
		render.shadowMap.type = THREE.PCFSoftShadowMap;
		mundo = construirMundo(inf, lienzo);
		paseo = crearPaseo(mundo, lienzo);
		cinta = crearCinta(mundo);
		cinta.visible(false);
		cargarLevantamiento();
		pintarResumen();
		lienzo.addEventListener('click', (ev) => {
			// Midiendo, el clic marca un punto de la tirada; si no, consulta la máquina.
			if (midiendo) {
				const p = puntoEnPixel(mundo!, lienzo, ev.clientX, ev.clientY);
				if (p) { cinta!.anadir(p); pintarCinta(); }
				return;
			}
			const e = equipoEnPixel(mundo!, lienzo, ev.clientX, ev.clientY);
			seleccionar(e?.tag, !!e && vista === 'sims' && ev.shiftKey);
		});
		window.addEventListener('resize', ajustar);
		$('mundo-sims').onclick = () => cambiarVista('sims');
		$('mundo-paseo').onclick = () => cambiarVista('paseo');
		$('mundo-medir').onclick = () => activarMedir(!midiendo);
		$('mundo-paneles').onclick = () => verPaneles(!panelesVisibles);
		/*
		 * Las cifras de la guía salen del DATO, no escritas a mano en el HTML.
		 *
		 * Estaban puestas a mano y se quedaron viejas en cuanto cambió el plano: decían 129 máquinas
		 * cuando ya eran 134. Una guía que miente sobre lo que el usuario tiene delante hace más daño
		 * que no decir nada, así que ahora se rellenan al abrirla.
		 */
		const cifrasDeLaGuia = (): void => {
			const cuantos: Record<string, number> = {
				equipos: inf.equipos.length,
				umas: inf.equipos.filter((e) => e.tipo === 'uma').length,
				vex: inf.equipos.filter((e) => e.tipo === 'vex').length,
				situados: inf.equipos.filter((e) => e.x !== null).length,
			};
			for (const el of document.querySelectorAll<HTMLElement>('[data-guia]')) {
				const n = cuantos[el.dataset.guia ?? ''];
				if (n !== undefined) el.textContent = String(n);
			}
		};
		const verGuia = (v: boolean) => {
			if (v) cifrasDeLaGuia();
			($('modal-guia-mundo') as HTMLElement).hidden = !v;
		};
		$('mundo-guia').onclick = () => verGuia(true);
		$('btn-cerrar-guia-mundo').onclick = () => verGuia(false);
		$('btn-cerrar-guia-mundo-x').onclick = () => verGuia(false);
		$('modal-guia-mundo').addEventListener('click', (ev) => {
			if (ev.target === $('modal-guia-mundo')) verGuia(false);
		});
		/*
		 * La primera vez que se abre la cubierta se enseña la guía sola: sin ella no se sabe para
		 * qué sirve esta vista, qué es «cómo va la obra» ni de dónde sale el CSV. Una sola vez.
		 */
		try {
			if (!localStorage.getItem('tablerostudio:guia-mundo-vista')) {
				verGuia(true);
				localStorage.setItem('tablerostudio:guia-mundo-vista', '1');
			}
		} catch { /* sin almacén */ }
		// La H los pliega sin soltar el teclado: paseando se anda con la izquierda y no apetece
		// ir al ratón para despejar la vista un momento. No se pisa con W A S D ni con Shift.
		window.addEventListener('keydown', (ev) => {
			if ($('mundo').hidden || ev.ctrlKey || ev.metaKey || ev.altKey) return;
			const foco = document.activeElement as HTMLElement | null;
			if (foco && /^(INPUT|SELECT|TEXTAREA)$/.test(foco.tagName)) return;
			if (ev.key === 'h' || ev.key === 'H') { ev.preventDefault(); verPaneles(!panelesVisibles); }
		});
		($('mundo-invertir') as HTMLInputElement).onchange = (ev) => {
			paseo?.invertirRaton((ev.target as HTMLInputElement).checked);
		};
		// Buscador
		const caja = $('mundo-q') as HTMLInputElement;
		caja.oninput = () => refrescarBusqueda();
		caja.onkeydown = (ev) => {
			if (ev.key !== 'Enter' || encontradas.length === 0) return;
			ev.preventDefault();
			seleccionar(encontradas[0].tag, true);   // Intro salta a la primera y la encuadra
		};
		$('mundo-todas').onclick = () => {
			const conSenales = encontradas.filter((e) => e.puntos.length > 0);
			const todasMarcadas = conSenales.length > 0 && conSenales.every((e) => elegidas.has(e.tag));
			for (const e of conSenales) {
				if (todasMarcadas) elegidas.delete(e.tag); else elegidas.add(e.tag);
			}
			pintarElegidas();
		};
		$('mundo-limpiar').onclick = () => { elegidas.clear(); pintarElegidas(); };
		$('mundo-a-tablero').onclick = () => abrirPuente();
		$('btn-cerrar-puente').onclick = () => { ($('modal-puente') as HTMLElement).hidden = true; };
		$('btn-puente-cancelar').onclick = () => { ($('modal-puente') as HTMLElement).hidden = true; };
		$('btn-puente-crear').onclick = () => armarTablero();
		$('mundo-csv-parte').onclick = () =>
			descargar(`Parte de obra ${inf.nombre}.csv`, parteDeObraCSV(levantamiento, inf));
		pintarChips();
		pintarSelectorColor();
		aplicarColor();
		refrescarBusqueda();
		pintarElegidas();
		pintarAvance();
		pintarTiradas();
	}
	ajustar();
	cambiarVista('sims');
	if (!animando) {
		animando = true;
		const reloj = new THREE.Clock();
		const bucle = (): void => {
			if (($('mundo') as HTMLElement).hidden) { animando = false; return; }
			requestAnimationFrame(bucle);
			const dt = Math.min(0.05, reloj.getDelta());
			if (vista === 'paseo') paseo?.paso(dt);
			else mundo!.orbita.update();
			render!.render(mundo!.escena, mundo!.camara);
		};
		bucle();
	}
}

export function cerrarMundo(): void {
	paseo?.desactivar();
	($('modal-puente') as HTMLElement).hidden = true;
	($('mundo') as HTMLElement).hidden = true;
}

/** Datos de la planta, para las pruebas y para quien quiera consultarlos sin abrir el visor. */
export const infraestructura = inf;

// Sonda de pruebas del visor. Igual que la del editor, solo existe en el build de QA: el
// empaquetador define `__QA__` a false y el minificador borra el bloque entero.
declare const __QA__: boolean;
if (__QA__) {
	(window as unknown as Record<string, unknown>).__plantaQA = {
		equipos: inf.equipos,
		zona: inf.zona,
		camara: () => ({
			x: mundo?.camara.position.x ?? 0,
			y: mundo?.camara.position.y ?? 0,
			z: mundo?.camara.position.z ?? 0,
		}),
		tamano: () => mundo?.tamano ?? { ancho: 0, fondo: 0 },
		/**
		 * El punto de la cubierta al que se está mirando (el centro de órbita).
		 *
		 * Es lo que separa un zoom que acerca AL CENTRO DE LA PLANTA de uno que acerca a donde
		 * apunta el ratón: en el primero este punto no se mueve nunca por mucho que se gire la
		 * rueda, y en el segundo se corre por la cubierta hacia lo que se está señalando. Sin
		 * esto una prueba solo vería que la cámara se acerca, que es verdad en los dos casos.
		 */
		puntoDeOrbita: () => ({
			x: mundo?.orbita.target.x ?? 0,
			y: mundo?.orbita.target.y ?? 0,
			z: mundo?.orbita.target.z ?? 0,
		}),
		vista: () => vista,
		/**
		 * Arrastra el ratón `dx`,`dy` píxeles y devuelve hacia dónde se mira después.
		 *
		 * Sirve para comprobar el sentido del giro sin depender de fotogramas: arrastrar hacia
		 * arriba tiene que subir la mirada (y creciente) y arrastrar a la derecha tiene que
		 * girarla a la derecha, no al revés.
		 */
		mirar: (dx: number, dy: number) => {
			paseo?.mirar(dx, dy);
			const d = paseo?.direccion();
			return { x: d?.x ?? 0, y: d?.y ?? 0, z: d?.z ?? 0 };
		},
		invertirRaton: (v: boolean) => paseo?.invertirRaton(v),
		/** ¿Hay alguna tecla de andar apretada ahora mismo? (para el bug del «no puedo parar»). */
		andando: () => paseo?.andando() ?? false,
		/** Selecciona una máquina por su marcado, como si se hubiera pinchado en ella. */
		seleccionar: (tag: string) => {
			const e = inf.equipos.find((x) => x.tag === tag);
			seleccionar(e?.tag);
			return !!e;
		},
		/* --- Buscar, filtrar y colorear --- */
		/** Escribe en la caja de búsqueda y devuelve cuántas quedan y cuáles se ven apagadas. */
		buscar: (texto: string) => {
			($('mundo-q') as HTMLInputElement).value = texto;
			refrescarBusqueda();
			const apagadas = (mundo?.equipos.children ?? []).filter((g) => {
				const cuerpo = g.userData.cuerpo as THREE.Mesh | undefined;
				return !!cuerpo && (cuerpo.material as THREE.Material & { opacity: number }).opacity < 1;
			}).length;
			return {
				encontradas: encontradas.length,
				tags: encontradas.slice(0, 10).map((e) => e.tag),
				apagadas,
				montadas: mundo?.equipos.children.length ?? 0,
			};
		},
		colorear: (modo: string) => {
			modoColor = modo as ModoColor;
			($('mundo-color') as HTMLSelectElement).value = modo;
			aplicarColor();
			const colores = new Set((mundo?.equipos.children ?? []).map((g) =>
				((g.userData.cuerpo as THREE.Mesh)?.material as THREE.MeshStandardMaterial)?.color.getHex()));
			return { distintos: colores.size, leyenda: leyendaColor(inf, modoColor).length };
		},
		/* --- Cinta métrica --- */
		medir: (activo: boolean) => { activarMedir(activo); return midiendo; },
		marcarPunto: (x: number, y: number, z: number) => {
			cinta?.anadir(new THREE.Vector3(x, y, z));
			pintarCinta();
			return cinta?.medida();
		},
		/** Marca un punto EN UNA MÁQUINA, como si se hubiera pinchado en ella midiendo. */
		medirEquipo: (tag: string) => {
			const g = mundo?.equipos.children.find((x) => x.userData.tag === tag);
			if (!g) return undefined;
			cinta?.anadir(g.position.clone(), tag);
			pintarCinta();
			return cinta?.medida();
		},
		/* --- Levantamiento: parte de obra y tiradas guardadas --- */
		anotar: (tag: string, estado: string, nota: string) => {
			const e = inf.equipos.find((x) => x.tag === tag);
			if (!e) return undefined;
			seleccionar(tag);
			const chip = $('mundo-ficha').querySelector<HTMLButtonElement>(`[data-estado="${estado}"]`);
			chip?.click();
			const caja = document.getElementById('mundo-nota') as HTMLTextAreaElement | null;
			if (caja) { caja.value = nota; caja.onchange!(new Event('change')); }
			return levantamiento.notas[tag];
		},
		avance: () => avanceObra(levantamiento, inf).map((a) => ({ estado: a.estado, cuantos: a.cuantos })),
		/** Guarda la tirada que hay medida ahora mismo, como si se pulsara el botón. */
		guardarTirada: (nombre: string, hilos: number, seccion: number) => {
			const boton = document.getElementById('tirada-guardar');
			if (!boton) return undefined;
			($('tirada-nombre') as HTMLInputElement).value = nombre;
			($('tirada-hilos') as HTMLSelectElement).value = String(hilos);
			($('tirada-seccion') as HTMLSelectElement).value = String(seccion);
			boton.click();
			return levantamiento.tiradas[levantamiento.tiradas.length - 1];
		},
		pedido: () => listaDePedido(levantamiento.tiradas),
		/** Vacía el parte para que una prueba no dependa de lo que dejó la anterior. */
		olvidarLevantamiento: () => {
			levantamiento = levantamientoVacio();
			guardarLevantamiento();
			pintarAvance();
			pintarTiradas();
			pintarLista();
			return true;
		},
		/* --- Del mundo al tablero --- */
		elegir: (tags: string[]) => {
			elegidas.clear();
			for (const t of tags) elegidas.add(t);
			pintarElegidas();
			return elegidas.size;
		},
		/** Arma el tablero de lo elegido SIN tocar la interfaz, para poder comprobarlo. */
		puente: () => {
			const tags = inf.equipos.filter((e) => elegidas.has(e.tag)).map((e) => e.tag);
			const r = tableroDesdeEquipos(inf, tags);
			return {
				senales: r.senales.length,
				bornas: r.bornas,
				notas: r.notas,
				dispositivos: r.proyecto.dispositivos.length,
				conductores: r.proyecto.conductores.length,
				nombre: r.proyecto.nombre,
			};
		},
		/** Nº de mallas de instalación, de equipos y de obra montados en la escena. */
		montado: () => ({
			trazas: mundo?.instalaciones.children.length ?? 0,
			equipos: mundo?.equipos.children.length ?? 0,
			obra: mundo?.obra.children.length ?? 0,
			tramosObra: (mundo?.obra.children ?? []).reduce(
				(s, m) => s + ((m.userData.tramos as number) ?? (m.userData.columnas as number) ?? 0), 0),
		}),
		/**
		 * Anda `segundos` de reloj simulado, sin depender de los fotogramas.
		 *
		 * Hace falta porque este contenedor renderiza por software y da 2-3 fps: una prueba que
		 * mida el paseo en tiempo real estaría midiendo la tarjeta gráfica del servidor, no si el
		 * movimiento está bien hecho. Aquí se llama al paso con un dt fijo, como haría un
		 * navegador con fotogramas de sobra.
		 */
		andar: (segundos: number, dt = 1 / 60) => {
			const antes = { ...(mundo?.camara.position ?? { x: 0, y: 0, z: 0 }) };
			for (let t = 0; t < segundos; t += dt) paseo?.paso(dt);
			const p = mundo!.camara.position;
			return { avanzado: Math.hypot(p.x - antes.x, p.z - antes.z), x: p.x, y: p.y, z: p.z };
		},
		/** Fotogramas por segundo reales (para saber si una medida de tiempo es fiable). */
		fps: () => new Promise<number>((res) => {
			let n = 0;
			const t0 = performance.now();
			const f = (): void => {
				n++;
				if (performance.now() - t0 < 600) requestAnimationFrame(f);
				else res(Math.round((n * 1000) / (performance.now() - t0)));
			};
			requestAnimationFrame(f);
		}),
	};
}
