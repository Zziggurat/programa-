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
			+ 'se ha deducido de la posición: el plano no lo rotula aquí.</p>');
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
	if (mundo) pintarPorModo(mundo, modoColor);
	const situados = inf.equipos.filter((e) => e.x !== null).length;
	$('mundo-leyenda-color').innerHTML = leyendaColor(inf, modoColor)
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
		return `<label class="fila-eq${sel}" data-tag="${esc(e.tag)}" title="${esc(e.controlador ?? 'sin controlador en el plano')}">`
			+ `<input type="checkbox"${marcada}><span class="nom">${nombre}</span>`
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
	const cuerpo = $('mundo-cinta-cuerpo');
	const botones = '<div class="botones">'
		+ '<button class="boton" id="cinta-deshacer">↶ Quitar último</button>'
		+ '<button class="boton" id="cinta-limpiar">Empezar de nuevo</button></div>';
	cuerpo.innerHTML = !med
		? `<div class="ayuda">Haz clic en la cubierta para marcar por dónde va el cable. Con dos `
			+ `puntos ya hay medida.${cuantos ? ' <b>1 punto marcado.</b>' : ''}</div>`
			+ (cuantos ? botones : '')
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
			+ `<div class="ayuda">El recorrido va en ortogonal, como la bandeja; la recta es solo el `
			+ `mínimo teórico. La subida y la bajada suponen la bandeja a 3,2 m.</div>`
			+ botones;
	const deshacer = document.getElementById('cinta-deshacer');
	if (deshacer) deshacer.onclick = () => { cinta?.deshacer(); pintarCinta(); };
	const limpiar = document.getElementById('cinta-limpiar');
	if (limpiar) limpiar.onclick = () => { cinta?.reiniciar(); pintarCinta(); };
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

function cambiarVista(nueva: 'sims' | 'paseo'): void {
	if (!mundo) return;
	vista = nueva;
	$('mundo-sims').classList.toggle('activo', nueva === 'sims');
	$('mundo-paseo').classList.toggle('activo', nueva === 'paseo');
	($('mundo-ayuda-paseo') as HTMLElement).hidden = nueva !== 'paseo';
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
		pintarChips();
		pintarSelectorColor();
		aplicarColor();
		refrescarBusqueda();
		pintarElegidas();
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
