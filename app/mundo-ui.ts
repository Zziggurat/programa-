/**
 * Interfaz de la segunda herramienta: entrar, salir, cambiar de vista y enseñar la ficha de una
 * máquina con su lista de puntos del BMS.
 *
 * Va en su propio módulo y no en `main.ts` a propósito: es otra herramienta, con su propio bucle
 * de dibujado y su propio estado. Lo único que comparte con el editor de tableros es el botón que
 * la abre.
 */
import * as THREE from 'three';

import datosCubierta from '../datos/cubierta.json';
import {
	EquipoPlanta, Infraestructura, SISTEMAS, SistemaTraza, resumenPlanta,
} from '../src/modelo/infraestructura.js';
import {
	construirMundo, crearPaseo, enfocarEquipo, equipoEnPixel, ponerVistaPaseo, ponerVistaSims,
	resaltarEquipo,
} from './mundo.js';

const inf = datosCubierta as unknown as Infraestructura;
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const esc = (t: string): string =>
	t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let mundo: ReturnType<typeof construirMundo> | undefined;
let render: THREE.WebGLRenderer | undefined;
let paseo: ReturnType<typeof crearPaseo> | undefined;
let animando = false;
let vista: 'sims' | 'paseo' = 'sims';
let seleccionado: string | undefined;

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
	$('mundo-leyenda').innerHTML = r.metrosPorSistema.map((s) => {
		const info = SISTEMAS[s.sistema as SistemaTraza];
		const col = `#${info.color.toString(16).padStart(6, '0')}`;
		return `<div class="mundo-fila-sis"><span class="tira" style="background:${col}"></span>`
			+ `${esc(info.nombre)} · ${s.metros} m</div>`;
	}).join('');
	// El aviso no se puede quitar: es la diferencia entre un modelo y una medida.
	$('mundo-aviso').innerHTML = inf.alturasSupuestas
		? '⚠️ <b>Las alturas son de proyecto, no del plano.</b> El DWG no trae ninguna cota Z en las '
			+ 'capas de clima, así que las cotas de conductos y máquinas se han asignado por reglas. '
			+ 'El recorrido en planta sí es el del plano. Un marcado con <b>?</b> es una máquina '
			+ 'situada por su posición, sin rótulo en el plano.'
		: '';
	$('mundo-ficha').innerHTML = '<div class="vacio">Haz clic en una máquina para ver su lista de '
		+ 'puntos de control.</div>';
}

function pintarFicha(e: EquipoPlanta | undefined): void {
	const cont = $('mundo-ficha');
	if (!e) {
		cont.innerHTML = '<div class="vacio">Haz clic en una máquina para ver su lista de puntos de control.</div>';
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

function cambiarVista(nueva: 'sims' | 'paseo'): void {
	if (!mundo) return;
	vista = nueva;
	$('mundo-sims').classList.toggle('activo', nueva === 'sims');
	$('mundo-paseo').classList.toggle('activo', nueva === 'paseo');
	($('mundo-ayuda-paseo') as HTMLElement).hidden = nueva !== 'paseo';
	if (nueva === 'paseo') { ponerVistaPaseo(mundo); paseo?.activar(); }
	else { paseo?.desactivar(); ponerVistaSims(mundo); }
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
export function abrirMundo(): void {
	($('mundo') as HTMLElement).hidden = false;
	const lienzo = $('mundo-lienzo') as HTMLCanvasElement;
	if (!mundo) {
		render = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
		render.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		render.shadowMap.enabled = true;
		render.shadowMap.type = THREE.PCFSoftShadowMap;
		mundo = construirMundo(inf, lienzo);
		paseo = crearPaseo(mundo, lienzo);
		pintarResumen();
		lienzo.addEventListener('click', (ev) => {
			const e = equipoEnPixel(mundo!, lienzo, ev.clientX, ev.clientY);
			seleccionado = e?.tag;
			resaltarEquipo(mundo!, seleccionado);
			pintarFicha(e);
			if (e && vista === 'sims' && ev.shiftKey) enfocarEquipo(mundo!, e.tag);
		});
		window.addEventListener('resize', ajustar);
		$('mundo-sims').onclick = () => cambiarVista('sims');
		$('mundo-paseo').onclick = () => cambiarVista('paseo');
		$('mundo-centrar').onclick = () => { cambiarVista('sims'); };
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
		/** Selecciona una máquina por su marcado, como si se hubiera pinchado en ella. */
		seleccionar: (tag: string) => {
			const e = inf.equipos.find((x) => x.tag === tag);
			seleccionado = e?.tag;
			if (mundo) resaltarEquipo(mundo, seleccionado);
			pintarFicha(e);
			return !!e;
		},
		/** Nº de mallas de instalación y de equipos montados en la escena. */
		montado: () => ({
			trazas: mundo?.instalaciones.children.length ?? 0,
			equipos: mundo?.equipos.children.length ?? 0,
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
