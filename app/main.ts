/**
 * TableroStudio — Editor 3D del gabinete.
 *
 * Configurador completo: catálogo de aparatos, arrastre con anclaje a riel, cableado
 * desde el panel de propiedades, estructura editable (placa, rieles, canaletas),
 * guardar/abrir proyecto, exportación del dossier técnico y verificación eléctrica
 * en vivo. Todo apoyado en los motores del núcleo (src/motores).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { EJEMPLOS, EjemploTablero } from '../ejemplo/biblioteca.js';
import { BloqueTerminales, CLASE_POR_TIPO, Colocacion, Conductor, Dispositivo, OpcionesProyecto, Proyecto } from '../src/modelo/tipos.js';
import { crearProyecto, extremoTexto, opcionesDe } from '../src/modelo/proyecto.js';
import { ArchivoInvalido, cargarProyecto } from '../src/modelo/cargar.js';
import { calcularPotenciales, ResultadoPotenciales } from '../src/motores/potenciales.js';
import { numerarConductores, numerarDispositivos } from '../src/motores/numeracion.js';
import { verificarProyecto, Hallazgo } from '../src/motores/drc.js';
import { rutearConductores, ResultadoRuteo } from '../src/motores/ruteo.js';
import { sincronizarEsquemaGabinete } from '../src/motores/sincronizacion.js';
import { generarReferencias } from '../src/motores/referencias.js';
import { generarPlanBorneros } from '../src/motores/bornes.js';
import { generarInformeHTML } from '../src/motores/documentacion.js';
import {
	anclajeBorne, cajaDe, colorVoltaje, COLOR_CABLE, construirBornes, construirCables, construirCanaleta,
	construirCotas, construirDispositivo, construirEscenario, construirRiel, DatosCota, Escenario,
	liberar, rutasDeCables, salidasDeCable, vaciar, VOLTAJE_COLOR, Z_FRENTE,
} from './escena3d.js';
import { PLANTILLAS, PlantillaAparato, crearDesdePlantilla } from './catalogo.js';
import { CONTROLADORES, naturalezaTerminal } from './controladores.js';
import { huellaMinima, leerRotulos } from '../src/motores/terminales.js';
import { calcularBalanceTermico } from '../src/motores/termico.js';
import { avisar, confirmar, descargar, pedirTexto, responderDialogo } from './dialogos.js';
import { HojaEsq, montarEsquema, posicionesEnEsquema } from '../src/motores/esquema.js';
import { hojaASvg } from './esquema-svg.js';
import { exportarEsquemaPDF } from './esquema-pdf.js';
import { dxfDeEsquema, dxfDePlaca, exportarEtiquetasPDF } from './exportaciones.js';
import { distPuntoSegmento, longitudSolapada, orthogonalize } from './geometria-cables.js';

/** Bandera que inyecta el empaquetador: true solo en el build para las pruebas (QA=1). */
declare const __QA__: boolean;

type Modo = 'editor' | 'trabajo';
let modo: Modo = 'editor';

type Seleccion =
	| { tipo: 'dispositivo'; id: string }
	| { tipo: 'canaleta'; id: string }
	| { tipo: 'riel'; id: string }
	| { tipo: 'cable'; id: string };

/* ------------------------------ Estado ------------------------------ */

const CLAVE_AUTOSAVE = 'tablerostudio-proyecto';
const SNAP_RIEL = 0;       // el aparato queda CENTRADO en el eje del riel (el perfil va detrás)
const UMBRAL_SNAP = 45;    // distancia máxima para anclarse a un riel
const Z_HANDLE_CABLE = 55; // profundidad de los tiradores de cable (justo delante del cable a mano)
const SNAP_ORTO = 14;      // mm para alinear un punto de cable en vertical/horizontal con su vecino

function gabineteVacio(anchoMm = 600, altoMm = 800) {
	return {
		ancho: anchoMm,
		alto: altoMm,
		rieles: [
			{ id: 'riel1', x: 30, y: 80, largo: anchoMm - 60 },
			{ id: 'riel2', x: 30, y: Math.round(altoMm * 0.45) + 20, largo: anchoMm - 60 },
			{ id: 'riel3', x: 30, y: altoMm - 160, largo: anchoMm - 60 },
		],
		canaletas: [
			{ id: 'ch1', x: 20, y: 140, largo: anchoMm - 40, orientacion: 'h' as const, ancho: 40, alto: 60 },
			{ id: 'ch2', x: 20, y: Math.round(altoMm * 0.45) + 80, largo: anchoMm - 40, orientacion: 'h' as const, ancho: 40, alto: 60 },
			{ id: 'ch3', x: 20, y: altoMm - 100, largo: anchoMm - 40, orientacion: 'h' as const, ancho: 40, alto: 60 },
			{ id: 'cv1', x: 20, y: 140, largo: altoMm - 240, orientacion: 'v' as const, ancho: 40, alto: 60 },
		],
		colocaciones: [],
	};
}

function proyectoNuevo(): Proyecto {
	const p = crearProyecto('Tablero nuevo');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	p.gabinete = gabineteVacio();
	return p;
}

function cargarInicial(): Proyecto {
	try {
		const guardado = localStorage.getItem(CLAVE_AUTOSAVE);
		if (guardado) return cargarProyecto(guardado).proyecto;
	} catch { /* sin localStorage (p. ej. artifact con storage bloqueado) */ }
	// Primera vez (sin proyecto guardado): placa vacía con la tarjeta de bienvenida.
	// El tablero de ejemplo se carga a demanda con el botón «Ver un tablero de ejemplo».
	return proyectoNuevo();
}

let proyecto: Proyecto = cargarInicial();

let hallazgos: Hallazgo[] = [];
let ruteo: ResultadoRuteo;
let potenciales: ResultadoPotenciales;
/** Posición «hoja.columna» de cada aparato en el esquema montado (la que se cita en el plano). */
let posicionesEsquema = new Map<string, string>();
let coloreaVoltaje = false; // "Colorear por voltaje" en el panel Vista

function recalcular(): void {
	potenciales = calcularPotenciales(proyecto);
	numerarConductores(proyecto, potenciales);
	ruteo = rutearConductores(proyecto);
	// El DRC recibe las longitudes REALES del recorrido dibujado (no una estimación): con ellas
	// puede calcular la caída de tensión de cada circuito, y los avisos de llenado de canaleta.
	hallazgos = verificarProyecto(proyecto, potenciales, {
		longitudesMm: new Map(proyecto.conductores.map((c) => [c.id, longitudCableMm(c)])),
		canaletas: ruteo.ocupaciones,
	});
	// Dónde cae cada aparato en el esquema montado. Se calcula aquí, con el resto de la verdad
	// del proyecto, para que el panel, el índice y el dossier citen SIEMPRE la posición real
	// del plano y no una numeración de cortesía.
	posicionesEsquema = posicionesEnEsquema(montarEsquema(proyecto, potenciales));
	const sync = sincronizarEsquemaGabinete(proyecto);
	for (const [a, b] of sync.solapes) {
		hallazgos.push({ regla: 'S1-solape', severidad: 'error', mensaje: `${a} y ${b} se solapan en la placa` });
	}
	for (const id of sync.faltanEnGabinete) {
		hallazgos.push({ regla: 'S2-falta-colocar', severidad: 'aviso', mensaje: `${id} no está colocado en el gabinete` });
	}
	autoguardar();
}

/* --------------------------- Guardado automático --------------------------- */

/**
 * Estado del guardado. Antes el fallo se tragaba en silencio: si `localStorage` se llenaba
 * —un tablero grande más las plantillas propias caben de sobra en los ~5 MB de cupo— el
 * usuario seguía trabajando convencido de que estaba a salvo, y al cerrar lo perdía todo.
 * Ahora se dice, y además queda constancia de si hay cambios sin volcar a un archivo.
 */
type EstadoGuardado = 'guardado' | 'sucio' | 'fallo';
let estadoGuardado: EstadoGuardado = 'guardado';
/** True desde el primer cambio hasta que se descarga el proyecto como archivo. */
let hayCambiosSinExportar = false;

function pintarEstadoGuardado(motivo?: string): void {
	const e = $('estado-guardado');
	e.classList.toggle('sucio', estadoGuardado === 'sucio');
	e.classList.toggle('fallo', estadoGuardado === 'fallo');
	// Textos cortos y de largo parecido: este chip vive en la barra de herramientas y si crece
	// al cambiar de estado empuja a los botones fuera de la pantalla. El detalle va en el tooltip.
	e.textContent = estadoGuardado === 'fallo' ? 'Sin guardar'
		: estadoGuardado === 'sucio' ? 'Sin descargar' : 'Guardado';
	e.title = estadoGuardado === 'fallo'
		? `No se pudo guardar en el navegador${motivo ? ` (${motivo})` : ''}. `
			+ 'Descarga el proyecto con Archivo → Guardar para no perderlo.'
		: estadoGuardado === 'sucio'
			? 'Guardado en este navegador. Descárgalo con Archivo → Guardar para tener copia.'
			: 'El trabajo está guardado en este navegador.';
}

function autoguardar(): void {
	try {
		localStorage.setItem(CLAVE_AUTOSAVE, JSON.stringify(proyecto));
		if (estadoGuardado === 'fallo') avisar('El guardado automático volvió a funcionar.', 'ok');
		estadoGuardado = hayCambiosSinExportar ? 'sucio' : 'guardado';
		pintarEstadoGuardado();
	} catch (e) {
		const yaAvisado = estadoGuardado === 'fallo';
		estadoGuardado = 'fallo';
		pintarEstadoGuardado((e as Error)?.name);
		// Se avisa una sola vez por racha: repetirlo en cada cambio sería insoportable.
		if (!yaAvisado) {
			avisar('No se puede guardar en este navegador. Descarga el proyecto con Archivo → Guardar.', 'error');
		}
	}
}

/** Marca que hay trabajo que todavía no se ha descargado como archivo. */
function marcarSucio(): void {
	hayCambiosSinExportar = true;
	if (estadoGuardado !== 'fallo') { estadoGuardado = 'sucio'; pintarEstadoGuardado(); }
}

// Cerrar la pestaña con trabajo sin descargar pide confirmación al navegador.
window.addEventListener('beforeunload', (ev) => {
	if (!hayCambiosSinExportar && estadoGuardado !== 'fallo') return;
	ev.preventDefault();
	ev.returnValue = '';
});

recalcular();

/* ------------------------- Historial (deshacer/rehacer) ------------------------- */

const pila: string[] = [];      // estados anteriores (JSON)
const rehacerPila: string[] = [];

/** Guarda el estado ACTUAL antes de una mutación, para poder deshacerla. */
function capturar(): void {
	marcarSucio(); // hay trabajo nuevo que todavía no está en ningún archivo
	pila.push(JSON.stringify(proyecto));
	if (pila.length > 60) pila.shift();
	rehacerPila.length = 0;
	actualizarBotonesHistorial();
}

/**
 * Deshace la última `capturar()` SIN dejar rastro en el historial: se usa cuando el propio
 * programa rechaza una operación (p. ej. una alineación que dejaría aparatos encimados). Con
 * `deshacer()` normal quedaría un «Rehacer» que volvería a aplicar justo lo que se rechazó.
 */
function revertirCaptura(): void {
	const anterior = pila.pop();
	if (anterior === undefined) return;
	proyecto = JSON.parse(anterior) as Proyecto;
	trasCambiarProyecto();
}

function deshacer(): void {
	if (pila.length === 0) return;
	rehacerPila.push(JSON.stringify(proyecto));
	proyecto = JSON.parse(pila.pop()!) as Proyecto;
	trasCambiarProyecto();
}

function rehacer(): void {
	if (rehacerPila.length === 0) return;
	pila.push(JSON.stringify(proyecto));
	proyecto = JSON.parse(rehacerPila.pop()!) as Proyecto;
	trasCambiarProyecto();
}

function actualizarBotonesHistorial(): void {
	($('btn-deshacer') as HTMLButtonElement).disabled = pila.length === 0;
	($('btn-rehacer') as HTMLButtonElement).disabled = rehacerPila.length === 0;
}

/* ------------------------------ Escena ------------------------------ */

const contenedor = document.getElementById('escena')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
contenedor.appendChild(renderer.domElement);

const escena = new THREE.Scene();
escena.background = new THREE.Color(0x171a1d);
escena.fog = new THREE.Fog(0x171a1d, 2200, 4200);

const camara = new THREE.PerspectiveCamera(42, 1, 1, 8000);

const controles = new OrbitControls(camara, renderer.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
// La cámara se mantiene SIEMPRE por delante del tablero, como en un configurador profesional:
// se puede girar de lado a lado y mirar desde arriba o abajo, pero nunca pasar por detrás
// (donde todo se ve espejado, los cables quedan tapados por la caja y no hay forma de trabajar).
controles.minAzimuthAngle = -Math.PI * 0.42;
controles.maxAzimuthAngle = Math.PI * 0.42;
controles.minPolarAngle = Math.PI * 0.10;
controles.maxPolarAngle = Math.PI * 0.80;

const pmrem = new THREE.PMREMGenerator(renderer);
escena.environment = pmrem.fromScene(new RoomEnvironment(), 0.045).texture;
escena.environmentIntensity = 0.55;

escena.add(new THREE.HemisphereLight(0xf2f5f8, 0x33383e, 0.55));
const sol = new THREE.DirectionalLight(0xffffff, 1.9);
sol.position.set(500, 750, 900);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.camera.near = 10;
sol.shadow.camera.far = 4000;
sol.shadow.camera.left = -1000;
sol.shadow.camera.right = 1000;
sol.shadow.camera.top = 1200;
sol.shadow.camera.bottom = -1200;
sol.shadow.bias = -0.0004;
escena.add(sol);
const contraluz = new THREE.DirectionalLight(0x88aaff, 0.3);
contraluz.position.set(-600, 200, -400);
escena.add(contraluz);

const suelo = new THREE.GridHelper(4000, 80, 0x2c3238, 0x22272c);
escena.add(suelo);

let escenario: Escenario = construirEscenario(proyecto);
escena.add(escenario.raiz);

/** Queda por encuadrar porque cuando se pidió el lienzo aún no tenía tamaño. */
let encuadrePendiente = false;

/**
 * Encuadra el tablero entero, centrado en lo que el usuario VE de verdad.
 *
 * Dos cosas que antes no se tenían en cuenta y dejaban el tablero descuadrado nada más
 * abrirlo: la distancia se sacaba de una fórmula a ojo en vez del campo de visión de la
 * cámara (con una caja alta se salía por arriba), y los paneles laterales tapan el lienzo
 * —que ocupa todo el ancho y va por debajo—, así que el centro de la pantalla no es el
 * centro de lo que se ve. Se corrige apuntando a un punto desplazado.
 */
function encuadrar(): void {
	const g = proyecto.gabinete!;
	const caja = cajaDe(g);
	const anchoMundo = Math.max(caja.ancho, g.ancho) * 1.14;   // 14 % de aire alrededor
	const altoMundo = Math.max(caja.alto, g.alto) * 1.14;

	const lienzo = renderer.domElement;
	// Al arrancar, el lienzo puede no tener tamaño todavía. Encuadrar con una altura de 1 px
	// mandaba la cámara a tomar viento; se deja para cuando el lienzo ya mide algo.
	if (lienzo.clientHeight < 40 || lienzo.clientWidth < 40) { encuadrePendiente = true; return; }
	const alto = lienzo.clientHeight;
	const tapaIzq = $('panel-izq').getBoundingClientRect().width;
	const panelDer = $('panel-der');
	const tapaDer = panelDer.style.display === 'none' ? 0 : panelDer.getBoundingClientRect().width;
	const anchoVisible = Math.max(260, lienzo.clientWidth - tapaIzq - tapaDer);

	const fovV = (camara.fov * Math.PI) / 180;
	const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (anchoVisible / alto));
	const distancia = Math.max(
		altoMundo / 2 / Math.tan(fovV / 2),
		anchoMundo / 2 / Math.tan(fovH / 2),
		420,
	);

	// Cuánto hay que correr la mirada para que el tablero caiga en el hueco libre.
	const mundoPorPixel = (2 * distancia * Math.tan(fovV / 2)) / alto;
	const desvio = ((tapaIzq - tapaDer) / 2) * mundoPorPixel;

	controles.target.set(-desvio, 0, 0);
	camara.position.set(-desvio, 0, distancia);
	controles.update();
	suelo.position.y = -(g.alto / 2 + 42);
	encuadrePendiente = false;
}

function reconstruirCables(): void {
	vaciar(escenario.cables);
	// Coloreado por voltaje: cada cable toma el color del nivel de tensión de su potencial.
	let voltajeMap: Map<string, number | undefined> | undefined;
	if (coloreaVoltaje && potenciales) {
		voltajeMap = new Map();
		for (const c of proyecto.conductores) {
			const p = potenciales.porConductor.get(c.id);
			voltajeMap.set(c.id, p?.tensiones[p.tensiones.length - 1]);
		}
	}
	escenario.cables.add(construirCables(proyecto, escenario.aEscena, voltajeMap));
	escenario.cables.visible = ($('ver-cables') as HTMLInputElement).checked;
	// Reaplicar el resaltado/atenuado del cable seleccionado tras reconstruir.
	cableHover = undefined;
	if (sel?.tipo === 'cable') { resaltarCable(sel.id); atenuarCables(sel.id); }
}

function reconstruirCotas(): void {
	vaciar(escenario.cotas);
	escenario.cotas.add(construirCotas(proyecto, escenario.aEscena));
	escenario.cotas.visible = ($('ver-cotas') as HTMLInputElement).checked;
}

/** Reconstruye los puntos de conexión clicables (bornes); solo visibles en modo Trabajo.
 *  Las esferas se cuelgan DIRECTAMENTE del grupo (sin envolverlas en otro) para poder
 *  recorrerlas de forma plana al resaltarlas. */
function reconstruirBornes(): void {
	vaciar(escenario.bornes);
	const esferas = [...construirBornes(proyecto, escenario.aEscena).children];
	if (esferas.length) escenario.bornes.add(...esferas); // add() sin argumentos da error en three
	escenario.bornes.visible = modo === 'trabajo';
}

/** Desmonta y vuelve a construir todo el gabinete. */
function montarEscenario(): void {
	escena.remove(escenario.raiz);
	liberar(escenario.raiz); // sin esto, cada reconstrucción deja el tablero entero en la GPU
	escenario = construirEscenario(proyecto, visualizacion);
	escena.add(escenario.raiz);
	reconstruirCables();
	reconstruirBornes();
	reconstruirCotas();
	// En Visualización se ve el tablero terminado: tapas de canaleta puestas y sin rótulos
	// flotantes ni cotas (en la vida real no existen), para que se vea tal cual quedaría.
	const verTapas = visualizacion || ($('ver-tapas') as HTMLInputElement).checked;
	for (const t of escenario.tapas) t.visible = verTapas;
	const verEtiquetas = !visualizacion && ($('ver-etiquetas') as HTMLInputElement).checked;
	for (const t of escenario.etiquetas) t.visible = verEtiquetas;
	suelo.position.y = -(proyecto.gabinete!.alto / 2 + 42);
}

/** Recalcula, reconstruye y repinta todo (tras un cambio estructural). */
function actualizarTodo(): void {
	recalcular();
	montarEscenario();
	pintarPaneles();
	pintarSeleccion();
	refrescarEsquema(); // si el esquema está abierto, se redibuja: es la misma verdad, otra vista
}

/**
 * Actualiza tras un cambio que NO toca la geometría de los aparatos ya montados: añadir uno,
 * borrarlo o cablear. Se rehacen cables, bornes y cotas —baratos y sí cambian— y los demás
 * aparatos se quedan donde están.
 *
 * Importa de verdad: rehacer el tablero entero cuesta ~1,2 ms por aparato, así que en un
 * tablero de 150 cada clic se llevaba casi dos décimas de segundo antes siquiera de dibujar.
 * Quien mueva la ESTRUCTURA (caja, placa, rieles, canaletas) sigue usando `actualizarTodo()`.
 */
function actualizarConservandoAparatos(): void {
	recalcular();
	reconstruirCables();
	reconstruirBornes();
	reconstruirCotas();
	pintarPaneles();
	pintarSeleccion();
	refrescarEsquema();
}

/** Tras reemplazar el objeto `proyecto` (deshacer/rehacer/abrir/nuevo). */
function trasCambiarProyecto(): void {
	const existe = sel && (sel.tipo === 'dispositivo'
		? proyecto.dispositivos.some((d) => d.id === sel!.id)
		: sel.tipo === 'canaleta'
			? proyecto.gabinete!.canaletas.some((c) => c.id === sel!.id)
			: sel.tipo === 'riel'
				? proyecto.gabinete!.rieles.some((r) => r.id === sel!.id)
				: proyecto.conductores.some((c) => c.id === sel!.id));
	if (!existe) { sel = undefined; resaltados = []; }
	// La selección múltiple también tiene que sanearse: al deshacer, abrir otro proyecto o
	// empezar de cero, sus ids pueden apuntar a aparatos que ya no existen.
	seleccionExtra = seleccionExtra.filter((id) => proyecto.dispositivos.some((d) => d.id === id));
	recalcular();
	montarEscenario();
	construirHandles();
	pintarCatalogo();
	pintarPaneles();
	pintarEstructura();
	pintarSeleccion();
	actualizarBotonesHistorial();
}

/* --------------------------- Utilidades UI --------------------------- */

function $(id: string): HTMLElement {
	return document.getElementById(id)!;
}

const hexColor = (c: number): string => '#' + c.toString(16).padStart(6, '0');

/** Escapa texto para meterlo en HTML sin que un nombre con < o & rompa la página. */
function escaparHtml(t: string): string {
	return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Nombre de archivo seguro a partir del nombre del proyecto. */
function nombreArchivo(): string {
	return proyecto.nombre.replaceAll(/[^\wáéíóúñ -]/gi, '').trim() || 'tablero';
}

const etiquetaDe = (id: string): string => {
	const d = proyecto.dispositivos.find((x) => x.id === id);
	return d ? (d.designacion ?? d.id) : id;
};

/* ------------------------------ Catálogo ------------------------------ */

/**
 * ¿Coincide la plantilla con lo que se está buscando? Se busca por todas las palabras sueltas
 * y contra todo lo que identifica al aparato (nombre, tipo, grupo, marca y referencia), para
 * poder escribir «contactor 3p» o «phoenix» y encontrarlo sin saber cómo se llama en el menú.
 */
function coincideCatalogo(p: (typeof PLANTILLAS)[number], busqueda: string): boolean {
	const texto = `${p.nombre} ${p.tipo} ${p.grupo} ${p.descripcion} ${p.fabricante} ${p.referencia}`.toLowerCase();
	return busqueda.toLowerCase().split(/\s+/).filter(Boolean).every((t) => texto.includes(t));
}

function pintarCatalogo(): void {
	const cont = $('catalogo');
	const busqueda = (document.getElementById('buscar-catalogo') as HTMLInputElement | null)?.value ?? '';
	cont.innerHTML = '';
	let grupoActual = '';
	let encontrados = 0;
	for (const p of PLANTILLAS) {
		if (busqueda && !coincideCatalogo(p, busqueda)) continue;
		encontrados++;
		if (p.grupo !== grupoActual) {
			grupoActual = p.grupo;
			cont.insertAdjacentHTML('beforeend', `<div class="grupo-catalogo">${p.grupo}</div>`);
		}
		const btn = document.createElement('button');
		btn.className = 'item-catalogo';
		const fondo = p.profundidad ? `×${p.profundidad}` : '';
		btn.title = `${p.descripcion}\n${p.fabricante} ${p.referencia} · ${p.ancho}×${p.alto}${fondo} mm`
			+ (p.nota ? `\n${p.nota}` : '');
		btn.innerHTML = `<span class="chip-color" style="background:${p.color}"></span><span class="nombre">${p.nombre}</span><span class="mas">＋</span>`;
		btn.onclick = () => anadirDesdeCatalogo(p.id);
		cont.appendChild(btn);
	}
	if (!encontrados) cont.innerHTML = `<div class="catalogo-vacio">Ningún aparato coincide con «${busqueda}».</div>`;
}

/** Busca el primer hueco libre sobre un riel para una huella ancho×alto. */
/** Primer hueco libre sobre un riel para una huella ancho×alto. undefined si no hay rieles. */
function buscarHueco(ancho: number, alto: number): { x: number; y: number; rielId: string } | undefined {
	const g = proyecto.gabinete!;
	if (g.rieles.length === 0) return undefined;
	const MARGEN = 8;
	for (const riel of g.rieles) {
		if (riel.orientacion === 'v') {
			const x = riel.x + SNAP_RIEL - ancho / 2;
			if (x < 0 || x + ancho > g.ancho) continue;
			const enRiel = g.colocaciones
				.filter((c) => Math.abs(c.x + c.ancho / 2 - (riel.x + SNAP_RIEL)) < UMBRAL_SNAP)
				.sort((a, b) => a.y - b.y);
			let y = Math.max(riel.y, 10);
			const limite = riel.y + riel.largo - alto;
			for (const c of enRiel) {
				if (c.y - y >= alto + MARGEN) break;
				y = Math.max(y, c.y + c.alto + MARGEN);
			}
			if (y <= limite) return { x, y, rielId: riel.id };
		} else {
			const y = riel.y + SNAP_RIEL - alto / 2;
			if (y < 0 || y + alto > g.alto) continue;
			const enRiel = g.colocaciones
				.filter((c) => Math.abs(c.y + c.alto / 2 - (riel.y + SNAP_RIEL)) < UMBRAL_SNAP)
				.sort((a, b) => a.x - b.x);
			let x = Math.max(riel.x, 10);
			const limite = riel.x + riel.largo - ancho;
			for (const c of enRiel) {
				if (c.x - x >= ancho + MARGEN) break;
				x = Math.max(x, c.x + c.ancho + MARGEN);
			}
			if (x <= limite) return { x, y, rielId: riel.id };
		}
	}
	// Ningún riel tiene hueco interno: se añade al final del riel con más sitio libre a la
	// derecha (o abajo), aunque sobresalga un poco de la placa. Así nunca queda solapado.
	let mejorRiel = g.rieles[0];
	let mejorFin = Infinity;
	for (const riel of g.rieles) {
		const vertical = riel.orientacion === 'v';
		const eje = vertical ? riel.x + SNAP_RIEL : riel.y + SNAP_RIEL;
		const enRiel = g.colocaciones.filter((c) =>
			vertical ? Math.abs(c.x + c.ancho / 2 - eje) < UMBRAL_SNAP : Math.abs(c.y + c.alto / 2 - eje) < UMBRAL_SNAP);
		const fin = enRiel.length === 0
			? (vertical ? riel.y : riel.x)
			: Math.max(...enRiel.map((c) => (vertical ? c.y + c.alto : c.x + c.ancho)));
		if (fin < mejorFin) { mejorFin = fin; mejorRiel = riel; }
	}
	return mejorRiel.orientacion === 'v'
		? { x: mejorRiel.x + SNAP_RIEL - ancho / 2, y: mejorFin + MARGEN, rielId: mejorRiel.id }
		: { x: mejorFin + MARGEN, y: mejorRiel.y + SNAP_RIEL - alto / 2, rielId: mejorRiel.id };
}

/**
 * Pega el centro (cx,cy) al riel más cercano y devuelve el centro corregido y el riel.
 * Garantiza que un aparato SIEMPRE quede sobre un riel (nunca flotando).
 */
function snapAriel(cx: number, cy: number, ancho: number, alto: number):
	{ cx: number; cy: number; rielId: string } | undefined {
	const g = proyecto.gabinete!;
	let mejor: { d: number; cx: number; cy: number; id: string } | undefined;
	for (const riel of g.rieles) {
		if (riel.orientacion === 'v') {
			const eje = riel.x + SNAP_RIEL;
			const yc = Math.min(Math.max(cy, riel.y + alto / 2), riel.y + riel.largo - alto / 2);
			const d = Math.abs(cx - eje) + Math.abs(cy - yc) * 0.02;
			if (!mejor || d < mejor.d) mejor = { d, cx: eje, cy: yc, id: riel.id };
		} else {
			const eje = riel.y + SNAP_RIEL;
			const xc = Math.min(Math.max(cx, riel.x + ancho / 2), riel.x + riel.largo - ancho / 2);
			const d = Math.abs(cy - eje) + Math.abs(cx - xc) * 0.02;
			if (!mejor || d < mejor.d) mejor = { d, cx: xc, cy: eje, id: riel.id };
		}
	}
	return mejor ? { cx: mejor.cx, cy: mejor.cy, rielId: mejor.id } : undefined;
}

function anadirDesdeCatalogo(plantillaId: string): void {
	const plantilla = PLANTILLAS.find((p) => p.id === plantillaId);
	if (plantilla) colocarPlantilla(plantilla);
}

/** Crea el aparato de una plantilla y lo coloca en el primer hueco libre de un riel. */
function colocarPlantilla(plantilla: PlantillaAparato): void {
	const hueco = buscarHueco(plantilla.ancho, plantilla.alto);
	if (!hueco) {
		avisar('Añade primero un riel DIN (panel «Gabinete y estructura» → + Riel)', 'error');
		return;
	}
	capturar();
	const d = crearDesdePlantilla(plantilla, proyecto);
	d.hojaId = proyecto.hojas[0]?.id;
	d.posicion = { x: proyecto.dispositivos.length % 10, y: Math.floor(proyecto.dispositivos.length / 10) };
	proyecto.dispositivos.push(d);
	// Resolver posible solape en el hueco de reserva.
	let x = hueco.x;
	if (solapaCon(x, hueco.y, plantilla.ancho, plantilla.alto, d.id)) {
		x = xLibreCercano(x, hueco.y, plantilla.ancho, plantilla.alto, d.id) ?? x;
	}
	// Queda ANCLADO a su riel: así lo acompaña si después se mueve o se gira el riel.
	const col = {
		dispositivoId: d.id, x, y: hueco.y, ancho: plantilla.ancho, alto: plantilla.alto,
		rielId: hueco.rielId as string | undefined,
	};
	proyecto.gabinete!.colocaciones.push(col);
	const rielTocado = extenderRielPara(col); // si quedó más allá del riel, se alarga el riel
	// Solo se monta el aparato NUEVO (y el riel si hubo que alargarlo): los que ya estaban
	// puestos no se tocan. Antes se rehacía el tablero entero por cada aparato añadido.
	reconstruirDispositivoUno(d.id);
	if (rielTocado) reconstruirEstructuraUno({ tipo: 'riel', id: rielTocado });
	actualizarConservandoAparatos();
	seleccionar(d.id);
}

/**
 * Duplica el aparato seleccionado (Ctrl+D). En un tablero real la mitad de los aparatos se
 * repiten —seis relés iguales, cuatro guardamotores—, y volver al catálogo cada vez es perder
 * el tiempo. La copia va justo a la derecha del original, sobre su mismo riel, con la siguiente
 * designación libre de su clase. NO se copian los cables: la copia nace sin conectar, que es lo
 * que se espera de un aparato nuevo.
 */
function duplicarDispositivo(id: string): void {
	const g = proyecto.gabinete;
	const original = proyecto.dispositivos.find((d) => d.id === id);
	const col = g?.colocaciones.find((c) => c.dispositivoId === id);
	if (!g || !original || !col) { avisar('Selecciona un aparato colocado para duplicarlo.', 'info'); return; }
	if (original.imagen) { avisar('Las imágenes de referencia no se duplican.', 'info'); return; }
	capturar();

	const clase = original.clase ?? CLASE_POR_TIPO[original.tipo];
	let maximo = 0;
	for (const d of proyecto.dispositivos) {
		if ((d.clase ?? CLASE_POR_TIPO[d.tipo]) === clase && d.numero) maximo = Math.max(maximo, d.numero);
	}
	const numero = maximo + 1;
	const copia: Dispositivo = {
		...structuredClone(original),
		id: `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
		numero,
		designacion: (original.designacion ?? '').replace(/\d+$/, '') + numero,
	};
	proyecto.dispositivos.push(copia);

	// A la derecha del original si cabe; si no, al primer hueco libre del tablero.
	let x = col.x + col.ancho + 2;
	let y = col.y;
	let rielId = col.rielId;
	if (x + col.ancho > g.ancho || solapaCon(x, y, col.ancho, col.alto, copia.id)) {
		const libre = xLibreCercano(x, y, col.ancho, col.alto, copia.id);
		if (libre !== undefined && libre + col.ancho <= g.ancho) x = libre;
		else {
			const hueco = buscarHueco(col.ancho, col.alto);
			if (!hueco) { avisar('No queda sitio libre en la placa para la copia.', 'error'); return; }
			x = hueco.x; y = hueco.y; rielId = hueco.rielId;
		}
	}
	const nueva = { dispositivoId: copia.id, x, y, ancho: col.ancho, alto: col.alto, rielId, z: col.z };
	g.colocaciones.push(nueva);
	const rielCopia = extenderRielPara(nueva);
	reconstruirDispositivoUno(copia.id);
	if (rielCopia) reconstruirEstructuraUno({ tipo: 'riel', id: rielCopia });
	actualizarConservandoAparatos();
	seleccionar(copia.id);
	avisar(`Duplicado: ${copia.designacion ?? copia.id}`, 'ok');
}

/** Alarga (si hace falta) el riel bajo un aparato para que quede totalmente apoyado sobre él. */
/** Alarga el riel bajo el aparato si hace falta. Devuelve el id del riel tocado, o undefined. */
function extenderRielPara(col: { x: number; y: number; ancho: number; alto: number }): string | undefined {
	const g = proyecto.gabinete!;
	const cx = col.x + col.ancho / 2;
	const cy = col.y + col.alto / 2;
	// Riel horizontal cuyo eje coincide con el centro Y del aparato (o vertical con el centro X).
	const riel = g.rieles.find((r) => r.orientacion === 'v'
		? Math.abs(cx - (r.x + SNAP_RIEL)) < UMBRAL_SNAP
		: Math.abs(cy - (r.y + SNAP_RIEL)) < UMBRAL_SNAP);
	if (!riel) return undefined;
	if (riel.orientacion === 'v') {
		if (col.y < riel.y) { riel.largo += riel.y - col.y; riel.y = col.y; }
		riel.largo = Math.max(riel.largo, col.y + col.alto - riel.y + 5);
	} else {
		if (col.x < riel.x) { riel.largo += riel.x - col.x; riel.x = col.x; }
		riel.largo = Math.max(riel.largo, col.x + col.ancho - riel.x + 5);
	}
	return riel.id;
}

async function eliminarDispositivo(id: string): Promise<void> {
	const nombre = etiquetaDe(id);
	if (!(await confirmar(`¿Eliminar ${nombre} y sus cables?`, { ok: 'Eliminar', peligro: true }))) return;
	capturar();
	proyecto.dispositivos = proyecto.dispositivos.filter((d) => d.id !== id);
	proyecto.conductores = proyecto.conductores.filter(
		(c) => c.de.dispositivoId !== id && c.a.dispositivoId !== id,
	);
	const g = proyecto.gabinete!;
	g.colocaciones = g.colocaciones.filter((c) => c.dispositivoId !== id);
	const grupo = grupoDe(id);
	if (grupo) { escenario.dispositivos.remove(grupo); liberar(grupo); }
	seleccionar(undefined);
	actualizarConservandoAparatos();
	avisar(`${nombre} eliminado · Ctrl+Z para deshacer`);
}

/* --------------------------- Paneles laterales --------------------------- */

function pintarPaneles(): void {
	($('nombre-proyecto') as HTMLInputElement).value = proyecto.nombre;

	const lista = $('lista-dispositivos');
	lista.innerHTML = '';
	const internos = proyecto.dispositivos.filter((x) => !x.campo);
	$('contador-dispositivos').textContent = `(${internos.length})`;
	for (const d of internos) {
		const li = document.createElement('li');
		li.className = d.id === idDispositivoSel() ? 'seleccionado' : '';
		li.innerHTML = `<span class="des">${d.designacion ?? d.id}</span><span class="desc">${d.descripcion ?? ''}</span>`;
		li.onclick = () => seleccionar(d.id);
		lista.appendChild(li);
	}

	const drc = $('lista-drc');
	drc.innerHTML = '';
	if (hallazgos.length === 0) drc.innerHTML = '<li class="hallazgo ok">Sin errores ni avisos</li>';
	for (const h of hallazgos) {
		const li = document.createElement('li');
		li.className = `hallazgo ${h.severidad}`;
		li.textContent = h.mensaje;
		if (h.dispositivoId) {
			li.style.cursor = 'pointer';
			li.onclick = () => seleccionar(h.dispositivoId);
		}
		drc.appendChild(li);
	}
	const errores = hallazgos.filter((h) => h.severidad === 'error').length;
	const avisos = hallazgos.length - errores;
	const chip = $('chip-drc');
	chip.className = errores ? 'con-errores' : avisos ? 'con-avisos' : '';
	chip.id = 'chip-drc';
	const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
	$('chip-drc-texto').textContent = errores || avisos
		? [errores ? plural(errores, 'error', 'errores') : '', avisos ? plural(avisos, 'aviso', 'avisos') : '']
			.filter(Boolean).join(' · ')
		: 'DRC sin hallazgos';

	const total = proyecto.conductores.reduce((s, c) => s + longitudCableMm(c), 0);
	const nc = proyecto.conductores.length;
	$('resumen-cables').textContent = nc === 0
		? 'Todavía no hay cables.'
		: `${nc} ${nc === 1 ? 'conductor' : 'conductores'} · ~${(total / 1000).toFixed(1)} m de cable`;

	pintarListaCables();
	pintarBalanceTermico();

	// Estado vacío de bienvenida (solo si la placa no tiene aparatos y no se ha descartado).
	const aparatos = proyecto.dispositivos.filter((d) => !d.campo && !d.imagen).length;
	($('bienvenida') as HTMLElement).hidden = aparatos > 0 || bienvenidaDescartada;
}
let bienvenidaDescartada = false;

/**
 * Balance térmico en el panel: la temperatura interior estimada y qué hay que hacer con ella.
 *
 * Verlo mientras se diseña —y no al exportar el dossier— es lo que evita descubrir que el
 * armario necesita climatizador cuando ya está pedido.
 */
const TITULO_TERMICO: Record<string, string> = {
	holgado: 'Refrigeración natural suficiente',
	justo: 'Al límite de la refrigeración natural',
	ventilacion: 'Necesita ventilación forzada',
	climatizacion: 'Necesita climatización',
};

function pintarBalanceTermico(): void {
	const b = calcularBalanceTermico(proyecto);
	const veredicto = $('termico-veredicto');
	const detalle = $('termico-detalle');
	if (!b) {
		veredicto.className = 'veredicto-termico';
		veredicto.innerHTML = '<b>Sin gabinete</b><span class="porque">Define la caja para calcular el balance.</span>';
		detalle.textContent = '';
		return;
	}
	veredicto.className = `veredicto-termico ${b.veredicto}`;
	veredicto.innerHTML = `<b>${b.temperaturaInteriorC} °C — ${TITULO_TERMICO[b.veredicto]}</b>`
		+ `<span class="porque">${b.recomendacion}</span>`;
	const pctDeclarada = Math.round(b.fraccionDeclarada * 100);
	const filas = [
		`Disipación dentro del armario: <b>${b.disipacionW} W</b> (${pctDeclarada} % de datos de fabricante)`,
		`Superficie efectiva: <b>${b.superficieM2.toFixed(2)} m²</b> · montaje ${b.montaje}`,
		`Ambiente ${b.temperaturaAmbienteC} °C + salto <b>${b.saltoTermicoK} K</b>`,
	];
	if (b.principales.length > 0) {
		// El marcado lo escribe el usuario: se escapa antes de meterlo en el HTML del panel.
		filas.push(`Lo que más calienta: ${b.principales
			.map((p) => `${escaparHtml(p.designacion)} (${p.watts} W)`).join(', ')}`);
	}
	detalle.innerHTML = filas.join('<br>');
}

/** Lista de todos los cables del panel (modo Trabajo): clic para seleccionar/ordenar. */
function pintarListaCables(): void {
	const cont = $('lista-cables');
	$('contador-cables').textContent = `(${proyecto.conductores.length})`;
	cont.innerHTML = '';
	if (proyecto.conductores.length === 0) {
		cont.innerHTML = '<div class="sub" style="color:var(--texto-suave)">Aún no hay cables. Selecciona un aparato y conéctalo.</div>';
		return;
	}
	const idSel = sel?.tipo === 'cable' ? sel.id : undefined;
	for (const c of proyecto.conductores) {
		const li = document.createElement('li');
		li.className = c.id === idSel ? 'seleccionado' : '';
		const estado = c.trazado?.length ? `a mano (${c.trazado.length})` : 'directo';
		const colorCss = c.color ? hexColor(COLOR_CABLE[c.color] ?? 0x888888) : '#888';
		li.innerHTML = `<span class="via" style="background:${colorCss}"></span>
			<span class="num">${c.numero ?? '—'}</span>
			<span class="ruta">${extremoTexto(proyecto, c.de)} → ${extremoTexto(proyecto, c.a)}</span>
			<span class="estado">${estado}</span>`;
		li.onmouseenter = () => resaltarHoverCable(c.id);
		li.onmouseleave = () => resaltarHoverCable(undefined);
		li.onclick = () => { aplicarSeleccion({ tipo: 'cable', id: c.id }); enfocarCamaraEnCable(c.id); };
		cont.appendChild(li);
	}
}

const SECCIONES = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10];
const COLORES = ['negro', 'azul', 'rojo', 'blanco', 'gris', 'marrón', 'verde/amarillo'];

/** Panel de un GRUPO de aparatos (Shift+clic): alinear, repartir y borrar de una vez. */
function pintarPanelGrupo(): void {
	const panel = $('panel-der');
	const ids = aparatosSeleccionados();
	const g = proyecto.gabinete!;
	const nombres = ids.map(etiquetaDe).join(', ');
	panel.style.display = 'block';
	panel.innerHTML = `
		<h2>${ids.length} aparatos seleccionados</h2>
		<p class="pista">${nombres}</p>
		<p class="pista">Shift + clic añade o quita aparatos. Arrastra uno y se mueven todos.</p>
		<h3>Alinear</h3>
		<div class="rejilla-botones">
			<button class="boton" data-alinear="izquierda" title="Alinear por el borde izquierdo">⬅ Izquierda</button>
			<button class="boton" data-alinear="centrar-h" title="Centrar en horizontal">↔ Centrar</button>
			<button class="boton" data-alinear="derecha" title="Alinear por el borde derecho">Derecha ➡</button>
			<button class="boton" data-alinear="arriba" title="Alinear por el borde superior">⬆ Arriba</button>
			<button class="boton" data-alinear="centrar-v" title="Centrar en vertical">↕ Centrar</button>
			<button class="boton" data-alinear="abajo" title="Alinear por el borde inferior">⬇ Abajo</button>
		</div>
		<h3>Repartir</h3>
		<button class="boton ancho-total" data-alinear="repartir-h" title="Dejar la misma separación entre todos">⇹ Repartir a la misma distancia</button>
		<h3>Acciones</h3>
		<button class="boton peligro ancho-total" id="grupo-borrar">🗑️ Eliminar los ${ids.length} aparatos</button>
	`;
	for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-alinear]')) {
		b.onclick = () => alinearSeleccionados(b.dataset.alinear as Alineacion);
	}
	(panel.querySelector('#grupo-borrar') as HTMLButtonElement).onclick = () => { void eliminarSeleccionados(); };
	// Aviso si el grupo no cabe: mejor decirlo antes de que el usuario intente alinearlo.
	if (ids.some((id) => !g.colocaciones.some((c) => c.dispositivoId === id))) {
		panel.insertAdjacentHTML('beforeend', '<p class="pista">Algún aparato del grupo no está colocado en la placa.</p>');
	}
}

function pintarSeleccion(): void {
	const panel = $('panel-der');
	if (!sel) {
		panel.style.display = 'none';
		return;
	}
	if (sel.tipo === 'canaleta' || sel.tipo === 'riel') {
		pintarPanelEstructura(sel);
		return;
	}
	if (sel.tipo === 'cable') {
		pintarPanelCable(sel.id);
		return;
	}
	// Con varios aparatos seleccionados, el panel pasa a ser el de GRUPO: alinear, repartir y
	// borrar en bloque. Mostrar la ficha de uno solo cuando hay ocho marcados sería mentir.
	if (seleccionExtra.length > 0) {
		pintarPanelGrupo();
		return;
	}
	const d = proyecto.dispositivos.find((x) => x.id === sel!.id);
	if (!d) {
		panel.style.display = 'none';
		return;
	}
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === d.id);
	const cablesDelAparato = proyecto.conductores.filter(
		(c) => c.de.dispositivoId === d.id || c.a.dispositivoId === d.id,
	);
	const propios = hallazgos.filter((h) => h.dispositivoId === d.id);
	const metros = cablesDelAparato.reduce((s, c) => s + longitudCableMm(c), 0);

	const otrosAparatos = proyecto.dispositivos.filter((x) => x.id !== d.id);

	const esImagen = !!d.imagen;
	const esEditor = modo === 'editor';
	// División de modos:  Editor = colocar/mover/duplicar/eliminar y (en imágenes) marcar puntos.
	//                     Trabajo = cablear y revisar.
	const bloquePines = esImagen && esEditor
		? `<h2>Profundidad</h2>
			<div class="sub">Para que el riel o la canaleta no te tapen la imagen.</div>
			<div class="botonera" style="margin-top:6px">
				<button class="boton" id="btn-img-fondo" title="Mandar la imagen detrás de rieles y canaletas">⬇️ Al fondo</button>
				<button class="boton" id="btn-img-frente" title="Traer la imagen delante de la estructura">⬆️ Al frente</button>
			</div>
			<div class="sub" style="margin-top:4px">Ahora: ${Math.round(col?.z ?? 0)} mm</div>
			<h2>Puntos de conexión (${d.bornes.length})</h2>
			<button class="boton ${modoPin ? 'primario' : ''} ancho-total" id="btn-pin" style="width:100%">${modoPin ? '✓ Haz clic en la imagen…' : '➕ Añadir punto de conexión'}</button>
			<div id="lista-pines" style="margin-top:6px"></div>`
		: '';
	const bloqueDRC = propios.length
		? `<h2>Hallazgos DRC</h2><ul>${propios.map((h) => `<li class="hallazgo ${h.severidad}">${h.mensaje}</li>`).join('')}</ul>`
		: '';
	const bloqueCableado = esEditor ? '' : `
		<h2>Cables conectados ${metros ? `· ${(metros / 1000).toFixed(2)} m` : ''}</h2>
		<div id="cables-aparato">${cablesDelAparato.length === 0 ? '<div class="sub">Sin cables todavía</div>' : ''}</div>
		<div class="sub" style="margin:8px 0;padding:8px;background:var(--panel-2);border-radius:8px">💡 <b>Lo más fácil:</b> toca un <b>borne</b> (punto naranja) de un aparato y luego otro en el tablero, y el cable se conecta solo. O usa el formulario de abajo.</div>
		<h2>Conectar cable nuevo</h2>
		<div class="form-cable">
			<select id="cable-borne-origen" title="Borne de este aparato">
				${d.bornes.map((b) => `<option value="${b.id}">${d.designacion ?? d.id}:${b.id}${b.tipo && b.tipo !== 'otro' ? ` · ${b.tipo}` : ''}</option>`).join('')}
			</select>
			<select id="cable-destino" title="Aparato de destino">
				<option value="">— destino —</option>
				${otrosAparatos.map((o) => `<option value="${o.id}">${o.designacion ?? o.id} ${o.descripcion ? `· ${o.descripcion.slice(0, 22)}` : ''}</option>`).join('')}
			</select>
			<select id="cable-borne-destino" title="Borne del destino" disabled><option>borne…</option></select>
			<button class="boton ${eligiendoDestino ? 'primario' : ''} ancho-total" id="btn-elegir-destino" title="Elige el aparato de destino haciendo clic sobre él en el tablero 3D">${eligiendoDestino ? '👆 Haz clic en el aparato de destino…' : '🎯 Elegir destino en el tablero'}</button>
			<select id="cable-seccion" title="Sección">${SECCIONES.map((s) => `<option value="${s}" ${s === 1 ? 'selected' : ''}>${s} mm²</option>`).join('')}</select>
			<select id="cable-color" class="ancho-total" title="Color del conductor">${COLORES.map((c) => `<option ${c === 'negro' ? 'selected' : ''}>${c}</option>`).join('')}</select>
			<button class="boton primario ancho-total" id="btn-conectar" disabled>Conectar</button>
		</div>`;
	// Ficha del aparato: TODO editable. El catálogo es un punto de partida, no una verdad:
	// en cuanto se usa un aparato «parecido» porque el propio no está, los datos que van al
	// PDF del cliente son falsos si no se pueden corregir aquí.
	const num = (v: number | undefined) => (v === undefined ? '' : String(v));
	const bloqueTension = esEditor && !esImagen ? `
		<h2>⚡ Ficha del aparato</h2>
		<div class="ficha-aparato">
			<label>Marcado<input id="dev-designacion" type="text" value="${escaparHtml(d.designacion ?? '')}" placeholder="-K1"></label>
			<label>Tensión
				<select id="dev-tension">
					${['', '12', '24', '110', '220', '380', '400'].map((v) =>
						`<option value="${v}" ${String(d.tensionNominal ?? '') === v ? 'selected' : ''}>${v === '' ? '—' : v + ' V'}</option>`).join('')}
				</select></label>
			<label class="ancho-2">Descripción<input id="dev-descripcion" type="text" value="${escaparHtml(d.descripcion ?? '')}" placeholder="Contactor tripolar 9 A"></label>
			<label>Fabricante<input id="dev-fabricante" type="text" value="${escaparHtml(d.fabricante ?? '')}" placeholder="Schneider"></label>
			<label>Referencia<input id="dev-referencia" type="text" value="${escaparHtml(d.referencia ?? '')}" placeholder="LC1D09B7"></label>
			<label>In / Ib (A)<input id="dev-corriente" type="number" step="0.1" min="0" value="${num(d.corrienteNominal)}" placeholder="9"></label>
			<label>Polos<input id="dev-polos" type="number" step="1" min="1" max="4" value="${num(d.polos)}" placeholder="3"></label>
			${col ? `<label>Ancho (mm)<input id="dev-ancho" type="number" step="1" min="5" value="${Math.round(col.ancho)}"></label>
			<label>Alto (mm)<input id="dev-alto" type="number" step="1" min="5" value="${Math.round(col.alto)}"></label>` : ''}
			<label>Fondo (mm)<input id="dev-fondo" type="number" step="1" min="5" value="${num(d.profundidad)}" placeholder="auto"></label>
			<label>Poder de corte<input id="dev-icu" type="number" step="0.5" min="0" value="${num(d.poderCorteKA)}" placeholder="kA"></label>
			<label>Disipación<input id="dev-disipacion" type="number" step="0.5" min="0" value="${num(d.disipacionW)}" placeholder="W"></label>
		</div>
		<p class="pista">Los datos del catálogo son un punto de partida: corrígelos con la hoja del
		fabricante y el dossier saldrá con lo que de verdad lleva el tablero.</p>` : '';
	const bloqueAcciones = esEditor ? `
		<h2>Acciones</h2>
		<div class="botonera">
			<button class="boton" id="btn-duplicar">Duplicar</button>
			<button class="boton peligro" id="btn-eliminar">Eliminar</button>
		</div>` : '';

	panel.style.display = 'block';
	panel.innerHTML = `
		<h1>${d.designacion ?? d.id}</h1>
		<div class="sub">${esImagen ? '🖼️ Imagen de referencia' : (d.descripcion ?? '')}
			<span style="opacity:.7">· ${esEditor ? '🔧 editor' : '🔌 trabajo'}</span></div>
		<dl>
			${esImagen ? '' : `<dt>Referencia</dt><dd>${d.fabricante ?? '—'} ${d.referencia ?? ''}</dd>`}
			${col ? `<dt>Posición en placa</dt><dd>x ${Math.round(col.x)} mm · y ${Math.round(col.y)} mm · ${col.ancho}×${col.alto} mm</dd>` : ''}
			${d.tensionNominal !== undefined ? `<dt>Tensión</dt><dd><span class="chip-volt" style="background:${hexColor(colorVoltaje(d.tensionNominal))}">${d.tensionNominal} V</span></dd>` : ''}
			${esImagen ? '' : `<dt>Posición en esquema</dt><dd>${posicionesEsquema.get(d.id) ?? '—'}</dd>`}
		</dl>
		${bloqueTension}
		${bloquePines}
		${bloqueDRC}
		${bloqueCableado}
		${bloqueAcciones}
	`;

	// Lista de cables existentes con botón de quitar (solo en modo Trabajo).
	const contCables = panel.querySelector('#cables-aparato');
	if (contCables) {
		for (const c of cablesDelAparato) {
			const otro = c.de.dispositivoId === d.id ? c.a : c.de;
			const propio = c.de.dispositivoId === d.id ? c.de : c.a;
			const fila = document.createElement('div');
			fila.className = 'fila-cable';
			fila.innerHTML = `<span class="num">${c.numero ?? '—'}</span>
				<span>${propio.borneId} → ${etiquetaDe(otro.dispositivoId)}:${otro.borneId}${c.seccion ? ` · ${c.seccion} mm²` : ''}</span>
				<button class="quitar" title="Quitar cable">✕</button>`;
			(fila.querySelector('.quitar') as HTMLButtonElement).onclick = () => {
				capturar();
				proyecto.conductores = proyecto.conductores.filter((x) => x.id !== c.id);
				recalcular();
				reconstruirCables();
				pintarPaneles();
				pintarSeleccion();
			};
			contCables.appendChild(fila);
		}
	}

	// Formulario de conexión (solo en modo Trabajo).
	const selDestino = panel.querySelector('#cable-destino') as HTMLSelectElement | null;
	const selBorneDestino = panel.querySelector('#cable-borne-destino') as HTMLSelectElement | null;
	const btnConectar = panel.querySelector('#btn-conectar') as HTMLButtonElement | null;
	if (selDestino && selBorneDestino && btnConectar) {
		selDestino.onchange = () => {
			const destino = proyecto.dispositivos.find((x) => x.id === selDestino.value);
			selBorneDestino.disabled = !destino;
			btnConectar.disabled = !destino;
			selBorneDestino.innerHTML = destino
				? destino.bornes.map((b) => `<option value="${b.id}">${b.id}${b.tipo && b.tipo !== 'otro' ? ` · ${b.tipo}` : ''}</option>`).join('')
				: '<option>borne…</option>';
		};
		btnConectar.onclick = () => {
			const destino = selDestino.value;
			if (!destino) return;
			capturar();
			proyecto.conductores.push({
				id: `c${Date.now().toString(36)}`,
				de: { dispositivoId: d.id, borneId: (panel.querySelector('#cable-borne-origen') as HTMLSelectElement).value },
				a: { dispositivoId: destino, borneId: selBorneDestino.value },
				seccion: Number((panel.querySelector('#cable-seccion') as HTMLSelectElement).value),
				color: (panel.querySelector('#cable-color') as HTMLSelectElement).value,
			});
			recalcular();
			reconstruirCables();
			pintarPaneles();
			pintarSeleccion();
		};
		(panel.querySelector('#btn-elegir-destino') as HTMLButtonElement).onclick = () => {
			eligiendoDestino = !eligiendoDestino;
			$('ayuda').textContent = eligiendoDestino
				? '🎯 Haz clic sobre el aparato de destino en el tablero…'
				: AYUDA[modo];
			pintarSeleccion();
		};
	}

	/* --- Ficha del aparato: cada campo se guarda al salir de él (solo Editor) --- */
	{
		const numeroDe = (v: string): number | undefined => {
			const n = Number(v);
			return v.trim() === '' || !Number.isFinite(n) || n < 0 ? undefined : n;
		};
		/**
		 * Aplica un cambio de la ficha: captura para deshacer y rehace lo justo.
		 *
		 * `pintarSeleccion()` reescribe el panel entero, así que se lleva por delante el campo
		 * que el usuario acaba de enfocar al tabular. Se anota cuál era y se le devuelve el
		 * foco: rellenar la ficha campo a campo con el tabulador tiene que funcionar.
		 */
		const aplicar = (cambio: () => void, rehacerModelo = false) => {
			const enfocado = (document.activeElement as HTMLElement | null)?.id;
			capturar();
			cambio();
			recalcular();
			if (rehacerModelo) reconstruirDispositivoUno(d.id);
			reconstruirCables();
			reconstruirBornes();
			pintarPaneles();
			pintarSeleccion();
			if (enfocado) {
				const vuelto = document.getElementById(enfocado) as HTMLInputElement | null;
				// El cursor al final, para poder seguir escribiendo donde se estaba.
				vuelto?.focus();
				if (vuelto instanceof HTMLInputElement && vuelto.type === 'text') {
					vuelto.setSelectionRange(vuelto.value.length, vuelto.value.length);
				}
			}
		};
		const texto = (id: string, poner: (v: string) => void, rehacer = false) => {
			const campo = panel.querySelector(`#${id}`) as HTMLInputElement | null;
			if (campo) campo.onchange = () => aplicar(() => poner(campo.value.trim()), rehacer);
		};
		const numero = (id: string, poner: (v: number | undefined) => void, rehacer = false) => {
			const campo = panel.querySelector(`#${id}`) as HTMLInputElement | null;
			if (campo) campo.onchange = () => aplicar(() => poner(numeroDe(campo.value)), rehacer);
		};

		texto('dev-designacion', (v) => {
			// Marcado a mano: se congela para que una renumeración masiva no lo pise.
			d.designacion = v || undefined;
			d.congelado = !!v;
		}, true);
		texto('dev-descripcion', (v) => { d.descripcion = v || undefined; });
		texto('dev-fabricante', (v) => { d.fabricante = v || undefined; });
		texto('dev-referencia', (v) => { d.referencia = v || undefined; }, true);
		numero('dev-corriente', (v) => { d.corrienteNominal = v; });
		numero('dev-polos', (v) => { d.polos = v === undefined ? undefined : Math.min(4, Math.max(1, Math.round(v))); });
		numero('dev-fondo', (v) => { d.profundidad = v; }, true);
		numero('dev-icu', (v) => { d.poderCorteKA = v; });
		numero('dev-disipacion', (v) => { d.disipacionW = v; });

		(panel.querySelector('#dev-tension') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
			const v = (e.target as HTMLSelectElement).value;
			aplicar(() => { d.tensionNominal = v === '' ? undefined : Number(v); }, true);
		});

		// Medidas de la huella: se rechaza el cambio si dejaría el aparato encima de otro.
		for (const [id, dim] of [['dev-ancho', 'ancho'], ['dev-alto', 'alto']] as const) {
			const campo = panel.querySelector(`#${id}`) as HTMLInputElement | null;
			if (!campo || !col) continue;
			campo.onchange = () => {
				const v = numeroDe(campo.value);
				if (v === undefined || v < 5) { pintarSeleccion(); return; }
				const antes = col[dim];
				capturar();
				col[dim] = Math.round(v);
				if (solapaCon(col.x, col.y, col.ancho, col.alto, d.id)) {
					col[dim] = antes;
					revertirCaptura();
					avisar('Con esa medida se encimaría con otro aparato.', 'error');
					return;
				}
				recalcular();
				reconstruirDispositivoUno(d.id);
				reconstruirCables();
				reconstruirBornes();
				reconstruirCotas();
				pintarPaneles();
				pintarSeleccion();
			};
		}
	}

	// Acciones de edición (solo en modo Editor).
	(panel.querySelector('#btn-eliminar') as HTMLButtonElement | null)?.addEventListener('click', () => eliminarDispositivo(d.id));
	(panel.querySelector('#btn-duplicar') as HTMLButtonElement | null)?.addEventListener('click', () => {
		const plantilla = PLANTILLAS.find((p) => p.referencia === d.referencia);
		if (plantilla) anadirDesdeCatalogo(plantilla.id);
	});

	// Imagen de referencia: botón de modo pin y lista de puntos (solo modo Editor).
	if (esImagen && esEditor && panel.querySelector('#btn-pin')) {
		(panel.querySelector('#btn-pin') as HTMLButtonElement).onclick = () => {
			modoPin = !modoPin;
			pintarSeleccion();
		};
		// Profundidad de la imagen: al fondo (detrás del riel) o al frente.
		const moverEnZ = (paso: number) => {
			if (!col) return;
			capturar();
			col.z = Math.max(-40, Math.min(60, Math.round((col.z ?? 0) + paso)));
			reconstruirDispositivoUno(d.id);
			pintarSeleccion();
			avisar(col.z <= -10 ? 'Imagen al fondo: la estructura queda por delante'
				: col.z >= 20 ? 'Imagen al frente: por delante de rieles y canaletas'
					: `Profundidad de la imagen: ${col.z} mm`);
		};
		(panel.querySelector('#btn-img-fondo') as HTMLButtonElement).onclick = () => moverEnZ(-15);
		(panel.querySelector('#btn-img-frente') as HTMLButtonElement).onclick = () => moverEnZ(15);
		const lista = panel.querySelector('#lista-pines')!;
		for (const b of d.bornes) {
			const fila = document.createElement('div');
			fila.className = 'fila-cable';
			fila.innerHTML = `<span class="num">◉</span><span>${b.id}</span>
				<button class="quitar" title="Quitar punto">✕</button>`;
			(fila.querySelector('.quitar') as HTMLButtonElement).onclick = () => {
				capturar();
				d.bornes = d.bornes.filter((x) => x.id !== b.id);
				proyecto.conductores = proyecto.conductores.filter(
					(c) => !(c.de.dispositivoId === d.id && c.de.borneId === b.id) &&
						!(c.a.dispositivoId === d.id && c.a.borneId === b.id),
				);
				actualizarTodo();
			};
			lista.appendChild(fila);
		}
	}
}

/** Panel de propiedades de una canaleta o un riel seleccionado. */
function pintarPanelEstructura(s: Seleccion): void {
	const panel = $('panel-der');
	const g = proyecto.gabinete!;
	const esCanaleta = s.tipo === 'canaleta';
	const obj = esCanaleta ? g.canaletas.find((c) => c.id === s.id) : g.rieles.find((r) => r.id === s.id);
	if (!obj) { panel.style.display = 'none'; return; }
	const can = esCanaleta ? (obj as typeof g.canaletas[number]) : undefined;

	const orientActual = esCanaleta ? can!.orientacion : (obj as typeof g.rieles[number]).orientacion ?? 'h';
	const esV = orientActual === 'v';

	panel.style.display = 'block';
	panel.innerHTML = `
		<h1>${esCanaleta ? '📦 Canaleta' : '➖ Riel DIN'} ${obj.id}</h1>
		<div class="sub">${esCanaleta ? `Ranurada · ${can!.ancho}×${can!.alto} mm` : 'Perfil sombrero 35 mm'} · ${esV ? 'vertical' : 'horizontal'}</div>

		<button class="boton primario" id="e-girar" style="width:100%;margin:10px 0 4px">🔄 Girar a ${esV ? 'horizontal' : 'vertical'}</button>

		<div class="sub" style="margin-top:8px">Arrástrala para moverla, o tira de las esferas de los extremos para alargarla. También puedes ajustar los cm:</div>
		<dl>
			<dt>Posición X</dt><dd><input type="number" id="e-x" value="${(obj.x / 10).toFixed(1)}" step="0.5"> cm</dd>
			<dt>Posición Y</dt><dd><input type="number" id="e-y" value="${(obj.y / 10).toFixed(1)}" step="0.5"> cm</dd>
			<dt>Largo</dt><dd><input type="number" id="e-largo" value="${(obj.largo / 10).toFixed(1)}" step="0.5"> cm</dd>
			${esCanaleta ? `<dt>Ancho del canal</dt><dd><input type="number" id="e-ancho" value="${can!.ancho}" step="5"> mm</dd>` : ''}
		</dl>
		<div class="botonera">
			<button class="boton primario" id="e-aplicar">Aplicar medidas</button>
			<button class="boton peligro" id="e-eliminar">Eliminar</button>
		</div>
	`;
	// Girar (H↔V) al instante.
	(panel.querySelector('#e-girar') as HTMLButtonElement).onclick = () => {
		capturar();
		const nueva: 'h' | 'v' = esV ? 'h' : 'v';
		if (can) can.orientacion = nueva;
		else (obj as typeof g.rieles[number]).orientacion = nueva;
		actualizarTodo();
		pintarEstructura();
		pintarPanelEstructura(s); // refrescar el propio panel (texto del botón)
	};
	(panel.querySelector('#e-aplicar') as HTMLButtonElement).onclick = () => {
		capturar();
		obj.x = Math.round(Number((panel.querySelector('#e-x') as HTMLInputElement).value) * 10);
		obj.y = Math.round(Number((panel.querySelector('#e-y') as HTMLInputElement).value) * 10);
		obj.largo = Math.max(60, Math.round(Number((panel.querySelector('#e-largo') as HTMLInputElement).value) * 10));
		if (can) {
			can.ancho = Math.max(15, Number((panel.querySelector('#e-ancho') as HTMLInputElement).value));
			can.alto = can.ancho >= 60 ? 80 : 60;
		}
		actualizarTodo();
		pintarEstructura();
	};
	(panel.querySelector('#e-eliminar') as HTMLButtonElement).onclick = () => eliminarEstructura(s);
}

/** Panel de un cable seleccionado (modo Trabajo): editar sección/color, ordenar o quitar. */
function pintarPanelCable(id: string): void {
	const panel = $('panel-der');
	const c = proyecto.conductores.find((x) => x.id === id);
	if (!c) { panel.style.display = 'none'; return; }
	const manual = !!c.trazado?.length;

	panel.style.display = 'block';
	panel.innerHTML = `
		<h1>Cable ${c.numero ?? ''}</h1>
		<div class="sub">${extremoTexto(proyecto, c.de)} → ${extremoTexto(proyecto, c.a)}</div>
		<dl>
			<dt>Recorrido</dt><dd>${manual ? `✋ a mano (${c.trazado!.length} ${c.trazado!.length === 1 ? 'punto' : 'puntos'})` : '↳ directo (en L, automático)'}</dd>
		</dl>
		<div class="sub" style="margin-top:6px"><b>Doble clic</b> sobre el cable (botón izquierdo o derecho) crea una <b>unión</b> · <b>arrastra</b> las esferas azules con el clic izquierdo para mover cada unión · <b>doble clic</b> en una esfera la quita.</div>
		<div class="form-cable" style="margin-top:10px">
			<select id="cbl-seccion">${SECCIONES.map((s) => `<option value="${s}" ${s === c.seccion ? 'selected' : ''}>${s} mm²</option>`).join('')}</select>
			<select id="cbl-color">${COLORES.map((col) => `<option ${col === c.color ? 'selected' : ''}>${col}</option>`).join('')}</select>
		</div>
		<div class="botonera">
			${manual ? '<button class="boton" id="cbl-auto">Trazado automático</button>' : ''}
			<button class="boton peligro" id="cbl-quitar">Quitar cable</button>
		</div>
	`;
	(panel.querySelector('#cbl-seccion') as HTMLSelectElement).onchange = (e) => {
		capturar();
		c.seccion = Number((e.target as HTMLSelectElement).value);
		recalcular(); reconstruirCables(); pintarPaneles();
	};
	(panel.querySelector('#cbl-color') as HTMLSelectElement).onchange = (e) => {
		capturar();
		c.color = (e.target as HTMLSelectElement).value;
		reconstruirCables();
	};
	(panel.querySelector('#cbl-auto') as HTMLButtonElement | null)?.addEventListener('click', () => {
		capturar();
		delete c.trazado;
		recalcular(); reconstruirCables(); construirHandles(); pintarSeleccion();
	});
	(panel.querySelector('#cbl-quitar') as HTMLButtonElement).onclick = () => quitarCable(id);
}

/* ------------------------ Estructura del gabinete ------------------------ */

function pintarEstructura(): void {
	const g = proyecto.gabinete!;
	const caja = cajaDe(g);
	($('caja-ancho') as HTMLInputElement).value = String(Math.round(caja.ancho / 10));
	($('caja-alto') as HTMLInputElement).value = String(Math.round(caja.alto / 10));
	($('caja-prof') as HTMLInputElement).value = String(Math.round(caja.profundidad / 10));
	($('dim-ancho') as HTMLInputElement).value = String(Math.round(g.ancho / 10));
	($('dim-alto') as HTMLInputElement).value = String(Math.round(g.alto / 10));

	const filas = (
		items: { id: string; x: number; y: number; largo: number }[],
		tipo: 'riel' | 'canaleta',
	) => items.map((r) => `
		<div class="fila-estructura" data-tipo="${tipo}" data-id="${r.id}">
			<span class="id">${r.id}</span>
			<input type="number" data-campo="x" value="${Math.round(r.x)}">
			<input type="number" data-campo="y" value="${Math.round(r.y)}">
			<input type="number" data-campo="largo" value="${Math.round(r.largo)}">
			<button title="Quitar" data-quitar>✕</button>
		</div>`).join('');

	$('lista-rieles').innerHTML = filas(g.rieles, 'riel');
	$('lista-canaletas').innerHTML = filas(g.canaletas, 'canaleta');

	for (const btn of document.querySelectorAll('[data-quitar]')) {
		(btn as HTMLButtonElement).onclick = (ev) => {
			capturar();
			const fila = (ev.target as HTMLElement).closest('.fila-estructura') as HTMLElement;
			const id = fila.dataset.id!;
			if (fila.dataset.tipo === 'riel') g.rieles = g.rieles.filter((r) => r.id !== id);
			else g.canaletas = g.canaletas.filter((c) => c.id !== id);
			actualizarTodo();
			pintarEstructura();
		};
	}
}

function siguienteId(prefijo: string, existentes: { id: string }[]): string {
	let n = 1;
	while (existentes.some((e) => e.id === `${prefijo}${n}`)) n += 1;
	return `${prefijo}${n}`;
}

function aplicarEstructura(): void {
	capturar();
	const g = proyecto.gabinete!;
	// 0. Caja envolvente (dimensiones propias, independientes de la placa).
	g.caja = {
		ancho: Math.min(Math.max(Number(($('caja-ancho') as HTMLInputElement).value) || 66, 20), 200) * 10,
		alto: Math.min(Math.max(Number(($('caja-alto') as HTMLInputElement).value) || 86, 30), 240) * 10,
		profundidad: Math.min(Math.max(Number(($('caja-prof') as HTMLInputElement).value) || 16, 10), 60) * 10,
	};
	// 1. Leer las filas editadas.
	for (const fila of document.querySelectorAll('.fila-estructura')) {
		const el = fila as HTMLElement;
		const leer = (campo: string) =>
			Number((el.querySelector(`[data-campo="${campo}"]`) as HTMLInputElement).value) || 0;
		const destino = el.dataset.tipo === 'riel'
			? g.rieles.find((r) => r.id === el.dataset.id)
			: g.canaletas.find((c) => c.id === el.dataset.id);
		if (destino) {
			destino.x = leer('x');
			destino.y = leer('y');
			destino.largo = Math.max(60, leer('largo'));
		}
	}
	// 2. Dimensiones de placa (se estira la estructura con el cambio de tamaño).
	const anchoMm = Math.min(Math.max(Number(($('dim-ancho') as HTMLInputElement).value) || 38, 20), 150) * 10;
	const altoMm = Math.min(Math.max(Number(($('dim-alto') as HTMLInputElement).value) || 58, 30), 220) * 10;
	const dAncho = anchoMm - g.ancho;
	const dAlto = altoMm - g.alto;
	g.ancho = anchoMm;
	g.alto = altoMm;
	if (dAncho !== 0 || dAlto !== 0) {
		for (const riel of g.rieles) riel.largo = Math.max(120, riel.largo + dAncho);
		for (const can of g.canaletas) {
			can.largo = Math.max(120, can.largo + (can.orientacion === 'h' ? dAncho : dAlto));
		}
	}
	// 3. Perfil de canaleta.
	const anchoCanaleta = Number(($('dim-canaleta') as HTMLSelectElement).value);
	const altoCanaleta = anchoCanaleta >= 60 ? 80 : 60;
	for (const can of g.canaletas) {
		can.ancho = anchoCanaleta;
		can.alto = altoCanaleta;
	}
	// 4. Mantener los aparatos dentro de la placa.
	for (const col of g.colocaciones) {
		col.x = Math.min(Math.max(col.x, 0), Math.max(0, g.ancho - col.ancho));
		col.y = Math.min(Math.max(col.y, 0), Math.max(0, g.alto - col.alto));
	}
	actualizarTodo();
	pintarEstructura();
	encuadrar();
}

($('aplicar-dim') as HTMLButtonElement).onclick = aplicarEstructura;
($('btn-add-riel') as HTMLButtonElement).onclick = () => {
	capturar();
	const g = proyecto.gabinete!;
	g.rieles.push({ id: siguienteId('riel', g.rieles), x: 30, y: Math.round(g.alto / 2), largo: g.ancho - 60 });
	actualizarTodo();
	pintarEstructura();
};
($('btn-add-can-h') as HTMLButtonElement).onclick = () => {
	capturar();
	const g = proyecto.gabinete!;
	g.canaletas.push({
		id: siguienteId('ch', g.canaletas), x: 20, y: Math.round(g.alto / 2) + 80,
		largo: g.ancho - 40, orientacion: 'h', ancho: g.canaletas[0]?.ancho ?? 40, alto: g.canaletas[0]?.alto ?? 60,
	});
	actualizarTodo();
	pintarEstructura();
};
($('btn-add-can-v') as HTMLButtonElement).onclick = () => {
	capturar();
	const g = proyecto.gabinete!;
	g.canaletas.push({
		id: siguienteId('cv', g.canaletas), x: g.ancho - 60, y: 140,
		largo: g.alto - 260, orientacion: 'v', ancho: g.canaletas[0]?.ancho ?? 40, alto: g.canaletas[0]?.alto ?? 60,
	});
	actualizarTodo();
	pintarEstructura();
};

/* ----------------------- Selección y arrastre ----------------------- */

const raycaster = new THREE.Raycaster();
const puntero = new THREE.Vector2();
let sel: Seleccion | undefined;
let resaltados: THREE.MeshStandardMaterial[] = [];
let modoPin = false; // añadiendo un punto de conexión sobre una imagen de referencia
let eligiendoDestino = false; // esperando un clic en 3D para elegir el aparato de destino del cable

function idDispositivoSel(): string | undefined {
	return sel?.tipo === 'dispositivo' ? sel.id : undefined;
}

function grupoDe(id: string): THREE.Group | undefined {
	return escenario.dispositivos.children.find((g) => g.userData.dispositivoId === id) as THREE.Group | undefined;
}

function limpiarResaltado(): void {
	for (const m of resaltados) m.emissive.setHex(0x000000);
	resaltados = [];
}

function resaltarObjeto(raiz: THREE.Object3D | undefined, color = 0x1d4ed8, intensidad = 0.4): void {
	raiz?.traverse((o) => {
		if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
			o.material = o.material.clone();
			o.material.emissive.setHex(color);
			o.material.emissiveIntensity = intensidad;
			resaltados.push(o.material);
		}
	});
}

function resaltarPorUserData(clave: 'canaletaId' | 'rielId', id: string): void {
	escenario.raiz.traverse((o) => {
		if (o.userData[clave] === id && o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
			o.material = o.material.clone();
			o.material.emissive.setHex(0x1d4ed8);
			o.material.emissiveIntensity = 0.55;
			resaltados.push(o.material);
		}
	});
}

/** Aplica una selección de cualquier tipo (o la limpia) y refresca resaltado, handles y paneles. */
/**
 * Selección múltiple de aparatos.
 *
 * `sel` sigue siendo la selección principal (todo el programa trabaja con ella); aquí solo se
 * guardan los aparatos AÑADIDOS con Shift. Se hace así a propósito: el resto del código no se
 * entera de que existe la multi-selección y no hay dos caminos que puedan desincronizarse.
 */
let seleccionExtra: string[] = [];
/** true mientras se está añadiendo con Shift, para que `aplicarSeleccion` no borre lo añadido. */
let construyendoSeleccion = false;

/** Todos los aparatos seleccionados ahora mismo (el principal primero). */
function aparatosSeleccionados(): string[] {
	if (sel?.tipo !== 'dispositivo') return [];
	return [sel.id, ...seleccionExtra.filter((id) => id !== sel!.id)];
}

/** Añade o quita un aparato de la selección (Shift+clic). */
function alternarEnSeleccion(id: string): void {
	if (sel?.tipo !== 'dispositivo') { seleccionar(id); return; }
	if (id === sel.id) {
		// Se quita el principal: pasa a mandar el primero de los añadidos, si queda alguno.
		const siguiente = seleccionExtra.shift();
		if (siguiente) { const resto = seleccionExtra.slice(); aplicarSeleccion({ tipo: 'dispositivo', id: siguiente }); seleccionExtra = resto; }
		else aplicarSeleccion(undefined);
	} else if (seleccionExtra.includes(id)) {
		seleccionExtra = seleccionExtra.filter((x) => x !== id);
	} else {
		seleccionExtra.push(id);
	}
	resaltarSeleccionExtra();
	pintarSeleccion();
}

/** Desplaza los aparatos acompañantes el mismo (dx, dy) que el principal, sin salirse de la placa. */
function moverAcompanantes(dx: number, dy: number): void {
	const g = proyecto.gabinete!;
	for (const id of seleccionExtra) {
		const col = g.colocaciones.find((c) => c.dispositivoId === id);
		if (!col) continue;
		col.x = Math.min(Math.max(col.x + dx, 0), Math.max(0, g.ancho - col.ancho));
		col.y = Math.min(Math.max(col.y + dy, 0), Math.max(0, g.alto - col.alto));
		// Se re-ancla al riel al que lo ha llevado el movimiento —y se apoya en él— igual que
		// hace el aparato principal: si no, quedaría diciendo que pertenece a un riel del que ya
		// se ha bajado, y ese riel se lo llevaría consigo la próxima vez que se moviera.
		const enganche = snapAriel(col.x + col.ancho / 2, col.y + col.alto / 2, col.ancho, col.alto);
		if (enganche) {
			col.x = Math.min(Math.max(enganche.cx - col.ancho / 2, 0), Math.max(0, g.ancho - col.ancho));
			col.y = Math.min(Math.max(enganche.cy - col.alto / 2, 0), Math.max(0, g.alto - col.alto));
		}
		col.rielId = enganche?.rielId;
		const grupo = grupoDe(id);
		if (grupo) {
			const c = escenario.aEscena(col.x + col.ancho / 2, col.y + col.alto / 2, 0);
			grupo.position.set(c.x, c.y, grupo.position.z);
		}
	}
}

/** Borra de una vez todos los aparatos seleccionados, con una sola confirmación. */
async function eliminarSeleccionados(): Promise<void> {
	const ids = aparatosSeleccionados();
	if (ids.length <= 1) { if (ids[0]) await eliminarDispositivo(ids[0]); return; }
	const cables = proyecto.conductores.filter(
		(c) => ids.includes(c.de.dispositivoId) || ids.includes(c.a.dispositivoId),
	).length;
	const detalle = cables ? ` y sus ${cables} cables` : '';
	if (!(await confirmar(`¿Eliminar ${ids.length} aparatos${detalle}?`, { ok: 'Eliminar', peligro: true }))) return;
	capturar();
	const fuera = new Set(ids);
	proyecto.dispositivos = proyecto.dispositivos.filter((d) => !fuera.has(d.id));
	proyecto.conductores = proyecto.conductores.filter(
		(c) => !fuera.has(c.de.dispositivoId) && !fuera.has(c.a.dispositivoId),
	);
	const g = proyecto.gabinete!;
	g.colocaciones = g.colocaciones.filter((c) => !fuera.has(c.dispositivoId));
	seleccionExtra = [];
	aplicarSeleccion(undefined);
	actualizarTodo();
	avisar(`${ids.length} aparatos eliminados`, 'ok');
}

/** Cómo se puede ordenar un grupo de aparatos, igual que en cualquier programa de dibujo. */
type Alineacion = 'izquierda' | 'derecha' | 'arriba' | 'abajo' | 'centrar-h' | 'centrar-v' | 'repartir-h';

/**
 * Alinea o reparte los aparatos seleccionados. Es lo que convierte un montaje «a ojo» en uno
 * presentable: en un tablero real los aparatos van a escuadra, no cada uno a su altura.
 */
function alinearSeleccionados(como: Alineacion): void {
	const g = proyecto.gabinete;
	const ids = aparatosSeleccionados();
	if (!g || ids.length < 2) { avisar('Selecciona dos o más aparatos con Shift para alinearlos.', 'info'); return; }
	const cols = ids.map((id) => g.colocaciones.find((c) => c.dispositivoId === id)).filter((c): c is NonNullable<typeof c> => !!c);
	if (cols.length < 2) return;
	capturar();

	const izq = Math.min(...cols.map((c) => c.x));
	const der = Math.max(...cols.map((c) => c.x + c.ancho));
	const arr = Math.min(...cols.map((c) => c.y));
	const aba = Math.max(...cols.map((c) => c.y + c.alto));
	for (const c of cols) {
		if (como === 'izquierda') c.x = izq;
		else if (como === 'derecha') c.x = der - c.ancho;
		else if (como === 'arriba') c.y = arr;
		else if (como === 'abajo') c.y = aba - c.alto;
		else if (como === 'centrar-h') c.x = Math.round((izq + der) / 2 - c.ancho / 2);
		else if (como === 'centrar-v') c.y = Math.round((arr + aba) / 2 - c.alto / 2);
	}
	if (como === 'repartir-h') {
		// Reparte con la misma separación entre aparatos, respetando los dos extremos.
		const orden = [...cols].sort((a, b) => a.x - b.x);
		const anchoTotal = orden.reduce((s, c) => s + c.ancho, 0);
		const hueco = (der - izq - anchoTotal) / (orden.length - 1);
		let x = izq;
		for (const c of orden) { c.x = Math.round(x); x += c.ancho + hueco; }
	}
	// Alinear no puede dejar aparatos encimados: si pasa, se deshace y se avisa.
	const choque = cols.find((c) => solapaCon(c.x, c.y, c.ancho, c.alto, c.dispositivoId));
	if (choque) {
		revertirCaptura();
		avisar('Así quedarían aparatos encimados: no se ha alineado.', 'error');
		return;
	}
	actualizarTodo();
	avisar(`${cols.length} aparatos alineados`, 'ok');
}

/** Marca en la escena los aparatos añadidos a la selección (el principal ya lo marca el resto). */
function resaltarSeleccionExtra(): void {
	for (const id of seleccionExtra) {
		const g = grupoDe(id);
		if (!g) continue;
		g.traverse((o) => {
			if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
				o.material = o.material.clone();
				o.material.emissive.setHex(0x1d4ed8);
				o.material.emissiveIntensity = 0.45;
				resaltados.push(o.material);
			}
		});
	}
}

function aplicarSeleccion(nueva: Seleccion | undefined): void {
	// Cambiar de selección principal deshace la múltiple, salvo que se esté construyendo con Shift.
	if (!construyendoSeleccion) seleccionExtra = [];
	limpiarResaltado();
	modoPin = false;
	sel = nueva;
	if (sel?.tipo === 'dispositivo') resaltarObjeto(grupoDe(sel.id));
	else if (sel?.tipo === 'canaleta') resaltarPorUserData('canaletaId', sel.id);
	else if (sel?.tipo === 'riel') resaltarPorUserData('rielId', sel.id);
	else if (sel?.tipo === 'cable') resaltarCable(sel.id);
	// Al seleccionar un cable, se atenúan los demás para que se vea cuál estás tocando.
	atenuarCables(sel?.tipo === 'cable' ? sel.id : undefined);
	resaltarSeleccionExtra();
	construirHandles();
	pintarPaneles();
	pintarSeleccion();
}

function resaltarCable(id: string): void {
	escenario.cables.traverse((o) => {
		if (o.userData.conductorId === id && o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
			o.material = o.material.clone();
			o.material.emissive.setHex(0x2ea3ff);
			o.material.emissiveIntensity = 0.7;
			resaltados.push(o.material);
		}
	});
}

/** Atenúa (baja opacidad) todos los cables salvo el resaltado; sin argumento, los devuelve a opacos. */
function atenuarCables(exceptoId: string | undefined): void {
	escenario.cables.traverse((o) => {
		if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
		if (!o.userData.conductorId) return;
		const atenuar = exceptoId !== undefined && o.userData.conductorId !== exceptoId;
		o.material.transparent = atenuar;
		o.material.opacity = atenuar ? 0.25 : 1;
	});
}

let cableHover: string | undefined;
/** Resalta suavemente el cable bajo el ratón (o desde la lista) y pone el cursor de agarre. */
function resaltarHoverCable(id: string | undefined): void {
	if (id === cableHover) return;
	escenario.cables.traverse((o) => {
		if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
		const cid = o.userData.conductorId;
		if (!cid) return;
		const esSel = sel?.tipo === 'cable' && sel.id === cid;
		if (cid === cableHover && !esSel) o.material.emissiveIntensity = 0;   // quitar hover anterior
		if (cid === id && !esSel) { o.material.emissive.setHex(0x8fd0ff); o.material.emissiveIntensity = 0.5; }
	});
	cableHover = id;
	renderer.domElement.style.cursor = id ? 'grab' : '';
}

/** Centra suavemente la vista sobre un cable (para encontrarlo tras clic en la lista). */
function enfocarCamaraEnCable(id: string): void {
	const c = proyecto.conductores.find((x) => x.id === id);
	if (!c) return;
	const a = anclajeBorne(proyecto, c.de.dispositivoId, c.de.borneId);
	const b = anclajeBorne(proyecto, c.a.dispositivoId, c.a.borneId);
	if (!a || !b) return;
	const medio = c.trazado?.[0] ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
	const destino = escenario.aEscena(medio.x, medio.y, 0);
	controles.target.copy(destino);
	controles.update();
}

/** Selección por id de dispositivo (compatibilidad con el resto del código). */
function seleccionar(id: string | undefined): void {
	aplicarSeleccion(id ? { tipo: 'dispositivo', id } : undefined);
}

/** Primer elemento bajo el puntero. Prioriza aparatos > canaletas/rieles > cables. */
function elementoBajoElPuntero(ev: PointerEvent): Seleccion | undefined {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impactos = raycaster.intersectObjects(escenario.raiz.children, true);
	// De los cables se guardan dos candidatos: el tubo que de VERDAD se ve bajo el puntero y el
	// tubo grueso de agarre (invisible, para poder pinchar sin puntería). Gana siempre el visible;
	// si no, el agarre del vecino robaría el clic y se seleccionaría un cable distinto del señalado.
	let cableVisible: string | undefined;
	let cableAgarre: string | undefined;
	for (const i of impactos) {
		const u = i.object.userData;
		if (u.dispositivoId) return { tipo: 'dispositivo', id: u.dispositivoId };
		if (u.canaletaId) return { tipo: 'canaleta', id: u.canaletaId };
		if (u.rielId) return { tipo: 'riel', id: u.rielId };
		if (u.conductorId) {
			if (u.tuboVisible && !cableVisible) cableVisible = u.conductorId as string;
			else if (!cableAgarre) cableAgarre = u.conductorId as string;
		}
	}
	const cable = cableVisible ?? cableAgarre;
	return cable ? { tipo: 'cable', id: cable } : undefined; // los cables tienen la prioridad más baja
}

/** Conductor cuyo tubo está bajo el puntero (para el resaltado al pasar el ratón). */
function cableBajoElPuntero(ev: MouseEvent): string | undefined {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	// Recursivo: los tubos cuelgan dentro de un grupo hijo de escenario.cables.
	const impactos = raycaster.intersectObjects(escenario.cables.children, true);
	// PRIMERO el cable que de verdad se ve bajo el puntero; el tubo grueso de agarre (invisible)
	// solo entra en juego si no hay ninguno, para no seleccionar un vecino que no estás señalando.
	const visible = impactos.find((i) => i.object.userData.tuboVisible)?.object.userData.conductorId;
	if (visible) return visible as string;
	return impactos.find((i) => i.object.userData.conductorId)?.object.userData.conductorId as string | undefined;
}

/** ¿El cable bajo el puntero está MÁS CERCA de la cámara que el aparato que hay detrás?
 *  Sirve para poder agarrar un cable que cruza por delante de un aparato. */
function cableEstaDelante(ev: MouseEvent): boolean {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const dCable = raycaster.intersectObjects(escenario.cables.children, true)
		.find((i) => i.object.userData.conductorId)?.distance ?? Infinity;
	const dAparato = raycaster.intersectObjects(escenario.dispositivos.children, true)
		.find((i) => i.object.userData.dispositivoId)?.distance ?? Infinity;
	return dCable <= dAparato;
}

/* --------------- Cableado por clic en los bornes (como un tablero real) --------------- */

type RefBorne = { dispositivoId: string; borneId: string };
let cableandoDesde: RefBorne | undefined;              // borne de origen mientras se tiende un cable
let codosCableado: { x: number; y: number }[] = [];    // codos marcados con clic durante el tendido
let gomaCable: THREE.Line | undefined;                 // «goma elástica» del cable que sigue al cursor

/**
 * Borne (punto de conexión) bajo el puntero, con la distancia a la cámara: hace falta para
 * decidir quién se queda el clic cuando un cable pasa justo por delante del terminal.
 */
function borneBajoElPunteroCon(ev: MouseEvent): { borne: RefBorne; distancia: number } | undefined {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const h = raycaster.intersectObjects(escenario.bornes.children, true).find((i) => i.object.userData.borneId);
	if (!h) return undefined;
	return {
		borne: { dispositivoId: h.object.userData.borneDispositivoId, borneId: h.object.userData.borneId },
		distancia: h.distance,
	};
}

/** Borne (punto de conexión) bajo el puntero, si lo hay. */
function borneBajoElPuntero(ev: MouseEvent): RefBorne | undefined {
	return borneBajoElPunteroCon(ev)?.borne;
}

/**
 * ¿Hay un cable pasando POR DELANTE del borne que hay bajo el puntero?
 * Los cables corren al frente del tablero y muchas veces cruzan justo por encima de un terminal.
 * Si en ese píxel lo que se ve es el cable, el clic tiene que ser para el cable —agarrarlo— y no
 * para empezar un cableado desde un borne que en realidad está tapado. Era una de las causas de
 * «a veces no puedo agarrar los cables».
 */
function cableTapaAlBorne(ev: MouseEvent, distanciaBorne: number): boolean {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const d = raycaster.intersectObjects(escenario.cables.children, true)
		.find((i) => i.object.userData.tuboVisible)?.distance;
	return d !== undefined && d < distanciaBorne;
}

/** Resalta el borne bajo el ratón (y el de origen si se está cableando); pone el cursor de mira. */
function resaltarHoverBorne(b: RefBorne | undefined): void {
	for (const m of escenario.bornes.children) {
		if (!(m instanceof THREE.Mesh) || !(m.material instanceof THREE.MeshStandardMaterial)) continue;
		const esOrigen = cableandoDesde
			&& m.userData.borneDispositivoId === cableandoDesde.dispositivoId && m.userData.borneId === cableandoDesde.borneId;
		const esHover = b && m.userData.borneDispositivoId === b.dispositivoId && m.userData.borneId === b.borneId;
		const base = m.userData.conectado ? 0x6f7c89 : 0xffb63a; // color de reposo según esté cableado
		// El hover NO cambia el tamaño, y esto no es un capricho estético.
		//
		// El terminal crecía a 1,5 al pasarle el ratón por encima (0,78 → 1,5 si ya estaba
		// cableado: casi el doble de radio). Esa esfera hinchada adelantaba al cable que en reposo
		// pasaba por delante de ella, y entonces el clic conectaba en vez de agarrar el cable. Y se
		// realimentaba: al crecer, el borne quedaba bajo el puntero y ya no soltaba el foco.
		//
		// Lo que hay bajo el cursor no puede cambiar por el hecho de que el cursor esté ahí. El
		// realce se hace con color y brillo, que ya se ven de sobra y no tocan la geometría. El
		// borne de ORIGEN sí crece: mientras se tiende un cable el borne manda siempre sobre el
		// cable (así se puede rematar el tendido donde sea), así que ahí no hay ambigüedad ninguna.
		m.scale.setScalar(esOrigen ? 1.7 : (m.userData.conectado ? 0.78 : 1));
		m.material.color.setHex(esOrigen ? 0x35c46a : esHover ? 0xffe08a : base);
		m.material.emissiveIntensity = esOrigen || esHover ? 2 : 1;
	}
}

/** Muestra junto al cursor qué terminal se está tocando (p. ej. «-Q1:2 · libre»). */
function mostrarTipBorne(b: RefBorne | undefined, ev?: MouseEvent): void {
	const tip = $('tip-borne') as HTMLElement;
	if (!b || !ev) { tip.hidden = true; return; }
	const d = proyecto.dispositivos.find((x) => x.id === b.dispositivoId);
	const n = proyecto.conductores.filter((c) =>
		(c.de.dispositivoId === b.dispositivoId && c.de.borneId === b.borneId)
		|| (c.a.dispositivoId === b.dispositivoId && c.a.borneId === b.borneId)).length;
	const estado = n === 0 ? 'libre' : `${n} ${n === 1 ? 'cable' : 'cables'}`;
	tip.innerHTML = `${d?.designacion ?? b.dispositivoId}:${b.borneId} <span class="estado">· ${estado}</span>`;
	tip.style.left = `${ev.clientX + 14}px`;
	tip.style.top = `${ev.clientY - 30}px`;
	tip.hidden = false;
}

/** Empieza a tender un cable desde un borne. */
function iniciarCableado(b: RefBorne): void {
	cableandoDesde = b;
	codosCableado = [];
	resaltarHoverBorne(b);
	avisar('Haz clic en el otro borne para conectar · clic en un punto libre marca un codo · Esc cancela.', 'info');
}

/** Marca un codo del cable que se está tendiendo (como en Tinkercad, clic a clic). */
function anadirCodoCableado(x: number, y: number): void {
	if (!cableandoDesde) return;
	codosCableado.push({ x: Math.round(x), y: Math.round(y) });
	actualizarGomaCable(x, y);
}

/** Cancela el cableado en curso y quita la goma elástica. */
function cancelarCableado(): void {
	cableandoDesde = undefined;
	codosCableado = [];
	if (gomaCable) {
		escenario.raiz.remove(gomaCable);
		gomaCable.geometry.dispose();
		(gomaCable.material as THREE.Material).dispose();
		gomaCable = undefined;
	}
	resaltarHoverBorne(undefined);
}

/** Actualiza la goma elástica: borne de origen → codos marcados → cursor, en tramos rectos. */
function actualizarGomaCable(x: number, y: number): void {
	if (!cableandoDesde) return;
	const a = anclajeBorne(proyecto, cableandoDesde.dispositivoId, cableandoDesde.borneId);
	if (!a) return;
	const nodos = orthogonalize([{ x: a.x, y: a.y }, ...codosCableado, { x, y }]);
	const pts = nodos.map((p) => escenario.aEscena(p.x, p.y, 50));
	pts[0] = escenario.aEscena(a.x, a.y, a.z + 4);
	if (!gomaCable) {
		gomaCable = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineBasicMaterial({ color: 0x35c46a, depthTest: false, transparent: true, opacity: 0.9 }),
		);
		gomaCable.renderOrder = 999;
		escenario.raiz.add(gomaCable);
	} else {
		gomaCable.geometry.setFromPoints(pts);
	}
}

/** Quita un cable del proyecto (botón del panel o tecla Supr). Se deshace con Ctrl+Z. */
function quitarCable(id: string): void {
	if (!proyecto.conductores.some((x) => x.id === id)) return;
	capturar();
	proyecto.conductores = proyecto.conductores.filter((x) => x.id !== id);
	aplicarSeleccion(undefined);
	recalcular();
	reconstruirCables();
	reconstruirBornes(); // el borne que queda libre vuelve a naranja
	pintarPaneles();
	avisar('Cable quitado · Ctrl+Z para deshacer');
}

/** Conecta el borne de origen con `destino` creando un cable nuevo (evita duplicados y bucles). */
function completarCableado(destino: RefBorne): void {
	const origen = cableandoDesde;
	if (!origen) return;
	if (origen.dispositivoId === destino.dispositivoId && origen.borneId === destino.borneId) { cancelarCableado(); return; }
	const yaExiste = proyecto.conductores.some((c) =>
		(c.de.dispositivoId === origen.dispositivoId && c.de.borneId === origen.borneId
			&& c.a.dispositivoId === destino.dispositivoId && c.a.borneId === destino.borneId)
		|| (c.a.dispositivoId === origen.dispositivoId && c.a.borneId === origen.borneId
			&& c.de.dispositivoId === destino.dispositivoId && c.de.borneId === destino.borneId));
	if (yaExiste) { avisar('Esos dos bornes ya están conectados.', 'info'); cancelarCableado(); return; }
	capturar();
	const codos = codosCableado.slice(); // los codos marcados al tender el cable quedan fijados
	proyecto.conductores.push({
		id: `c${Date.now().toString(36)}`,
		de: { dispositivoId: origen.dispositivoId, borneId: origen.borneId },
		a: { dispositivoId: destino.dispositivoId, borneId: destino.borneId },
		seccion: 1.5,
		color: 'negro',
		...(codos.length ? { trazado: codos } : {}),
	});
	cancelarCableado();
	recalcular();
	reconstruirCables();
	reconstruirBornes();
	pintarPaneles();
	pintarSeleccion();
	avisar('Cable conectado', 'ok');
}

/* ------------------------ Tiradores (handles) ------------------------ */

interface DatosHandle {
	rol: 'inicio' | 'fin' | 'esquina';
	sel: Seleccion;
	/** Para cables: índice del punto de quiebre (waypoint) que mueve este tirador; -1 = crear uno nuevo. */
	indice?: number;
}

/** Etiqueta flotante (sprite) con fondo de color; para rotular los extremos de un cable. */
function etiquetaSprite(texto: string, posicion: THREE.Vector3, colorFondo: string): THREE.Sprite {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 64;
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = colorFondo;
	ctx.beginPath();
	ctx.roundRect(2, 2, 252, 60, 14);
	ctx.fill();
	ctx.fillStyle = '#0d1520';
	ctx.font = 'bold 34px system-ui, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(texto, 128, 34);
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
	sprite.scale.set(46, 11.5, 1);
	sprite.position.copy(posicion);
	sprite.renderOrder = 1000;
	return sprite;
}

/** Construye los tiradores del elemento seleccionado (estructura en Editor, cable en Trabajo). */
function construirHandles(): void {
	vaciar(escenario.handles);
	if (!sel) return;
	const g = proyecto.gabinete!;
	const esfera = (p: THREE.Vector3, datos: DatosHandle, color = 0x4da3ff): void => {
		const m = new THREE.Mesh(
			new THREE.SphereGeometry(9, 16, 16),
			new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false }),
		);
		m.position.copy(p);
		m.renderOrder = 999;
		m.userData.handle = datos;
		escenario.handles.add(m);
	};

	// Cable: marca de dónde sale (verde) y a dónde llega (naranja) con etiquetas del borne,
	// más un tirador azul en el medio para ordenarlo a mano.
	if (sel.tipo === 'cable') {
		const c = proyecto.conductores.find((x) => x.id === sel!.id);
		if (!c) return;
		const a = anclajeBorne(proyecto, c.de.dispositivoId, c.de.borneId);
		const b = anclajeBorne(proyecto, c.a.dispositivoId, c.a.borneId);
		if (!a || !b) return;
		// Marcadores de extremos (no arrastrables).
		const marca = (p: THREE.Vector3, color: number): void => {
			const m = new THREE.Mesh(
				new THREE.SphereGeometry(6, 14, 14),
				new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false }),
			);
			m.position.copy(p);
			m.renderOrder = 998;
			escenario.handles.add(m);
		};
		const pa = escenario.aEscena(a.x, a.y, a.z + 6);
		const pb = escenario.aEscena(b.x, b.y, b.z + 6);
		marca(pa, 0x35c46a); // origen verde
		marca(pb, 0xff8c1a); // destino naranja
		escenario.handles.add(etiquetaSprite(`◍ ${etiquetaDe(c.de.dispositivoId)}:${c.de.borneId}`, pa.clone().add(new THREE.Vector3(0, 14, 0)), '#35c46a'));
		escenario.handles.add(etiquetaSprite(`◍ ${etiquetaDe(c.a.dispositivoId)}:${c.a.borneId}`, pb.clone().add(new THREE.Vector3(0, 14, 0)), '#ff8c1a'));
		// Un tirador azul por cada punto de quiebre (waypoint): arrástralo para mover ese punto.
		// Si el cable aún no tiene puntos, se ofrece uno en el medio para empezar a darle forma.
		const wps = c.trazado ?? [];
		if (wps.length === 0) {
			const dist = Math.hypot(a.x - b.x, a.y - b.y);
			const comba = Math.min(dist * 0.28, 150);
			const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2 + comba) };
			esfera(escenario.aEscena(mid.x, mid.y, Z_HANDLE_CABLE), { rol: 'esquina', sel, indice: -1 }, 0x2ea3ff);
		} else {
			for (let i = 0; i < wps.length; i++) {
				esfera(escenario.aEscena(wps[i].x, wps[i].y, Z_HANDLE_CABLE), { rol: 'esquina', sel, indice: i }, 0x2ea3ff);
			}
		}
		return;
	}

	if (modo !== 'editor') return;

	if (sel.tipo === 'canaleta') {
		const can = g.canaletas.find((c) => c.id === sel!.id);
		if (!can) return;
		const esH = can.orientacion === 'h';
		const ini = escenario.aEscena(can.x, can.y, can.alto + 12);
		const fin = esH
			? escenario.aEscena(can.x + can.largo, can.y, can.alto + 12)
			: escenario.aEscena(can.x, can.y + can.largo, can.alto + 12);
		esfera(ini, { rol: 'inicio', sel }, 0x35c46a);
		esfera(fin, { rol: 'fin', sel }, 0x35c46a);
	} else if (sel.tipo === 'riel') {
		const riel = g.rieles.find((r) => r.id === sel!.id);
		if (!riel) return;
		esfera(escenario.aEscena(riel.x, riel.y, 22), { rol: 'inicio', sel }, 0xffcf40);
		esfera(escenario.aEscena(riel.x + riel.largo, riel.y, 22), { rol: 'fin', sel }, 0xffcf40);
	} else {
		const d = proyecto.dispositivos.find((x) => x.id === sel!.id);
		const col = g.colocaciones.find((c) => c.dispositivoId === sel!.id);
		if (d?.imagen && col) {
			esfera(escenario.aEscena(col.x + col.ancho, col.y + col.alto, 12), { rol: 'esquina', sel }, 0xff8c1a);
		}
	}
}

let arrastrando = false;
let capturadoEsteArrastre = false;
let handleArrastrado: DatosHandle | undefined;
let arrastrandoCable: { id: string; indice: number } | undefined; // conductor y punto de quiebre que se arrastra
/** Cable agarrado a la espera de que el ratón se mueva para empezar a arrastrarlo de verdad. */
let pendienteCable: { id: string; indice: number; x: number; y: number } | undefined;
let arrastreInicio: { x: number; y: number } | undefined; // posición del aparato al empezar a arrastrarlo
const desfase = new THREE.Vector2();

/**
 * Punto del ratón proyectado sobre un plano a la profundidad `z`, en coordenadas de modelo (mm).
 * La profundidad IMPORTA: los cables se dibujan al frente (Z_FRENTE) y, con la cámara
 * inclinada, proyectar su clic sobre el plano de la placa (z=0) lo desplazaba varios
 * centímetros — por eso a veces «no se podía agarrar» un cable.
 */
function puntoModeloEnZ(ev: MouseEvent, z: number): { x: number; y: number } | undefined {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impacto = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), impacto)) return undefined;
	const g = proyecto.gabinete!;
	return { x: impacto.x + g.ancho / 2, y: g.alto / 2 - impacto.y };
}

/** Punto del ratón sobre el plano de la placa (para mover aparatos y estructura). */
function puntoModelo(ev: MouseEvent): { x: number; y: number } | undefined {
	return puntoModeloEnZ(ev, 0);
}

/** Punto del ratón a la altura a la que corren los cables (para cablear y mover uniones). */
function puntoCable(ev: MouseEvent): { x: number; y: number } | undefined {
	return puntoModeloEnZ(ev, Z_FRENTE);
}

/* --------------------- Puntos de quiebre de los cables (estilo Tinkercad) --------------------- */

/**
 * Nodos completos del recorrido de un cable en coordenadas de modelo: borne → puntos → borne.
 * Usa las MISMAS puntas en abanico que el dibujo 3D; si no, el cable que se ve y el cable con
 * el que trabaja el ratón no coincidirían y la selección quedaría descalibrada.
 */
function nodosCable(c: Conductor): { x: number; y: number }[] {
	const p = salidasDeCable(proyecto, c);
	if (!p) return [];
	return [p.salidaA, ...(c.trazado ?? []), p.salidaB];
}

/** Longitud aproximada del cable (mm) según su recorrido ortogonal real (Manhattan). */
function longitudCableMm(c: Conductor): number {
	const nodos = nodosCable(c);
	if (nodos.length < 2) return 0;
	const orto = orthogonalize(nodos);
	let largo = 0;
	for (let i = 0; i < orto.length - 1; i++) {
		largo += Math.abs(orto[i].x - orto[i + 1].x) + Math.abs(orto[i].y - orto[i + 1].y);
	}
	return largo;
}

/** Inserta un punto de quiebre en el tramo del cable más cercano a (x,y). Devuelve su índice. */
function insertarWaypoint(c: Conductor, x: number, y: number): number {
	const wps = c.trazado ? c.trazado.slice() : [];
	const nodos = nodosCable(c);
	let mejor = 0;
	let md = Infinity;
	for (let i = 0; i < nodos.length - 1; i++) {
		const d = distPuntoSegmento(x, y, nodos[i], nodos[i + 1]);
		if (d < md) { md = d; mejor = i; }
	}
	const idx = Math.min(mejor, wps.length);
	wps.splice(idx, 0, { x: Math.round(x), y: Math.round(y) });
	c.trazado = wps;
	return idx;
}

/** Mueve el punto de quiebre `idx` a (x,y), alineándolo en vertical/horizontal con sus vecinos
 *  (para que los tramos queden rectos, como en Tinkercad). */
function moverWaypoint(c: Conductor, idx: number, x: number, y: number): void {
	const wps = c.trazado;
	if (!wps || !wps[idx]) return;
	const p = salidasDeCable(proyecto, c);
	const prev = idx > 0 ? wps[idx - 1] : p?.salidaA;
	const next = idx < wps.length - 1 ? wps[idx + 1] : p?.salidaB;
	let nx = Math.round(x);
	let ny = Math.round(y);
	// Alinear en vertical/horizontal con el vecino más cercano en cada eje.
	if (prev && Math.abs(nx - prev.x) < SNAP_ORTO) nx = prev.x;
	else if (next && Math.abs(nx - next.x) < SNAP_ORTO) nx = next.x;
	if (prev && Math.abs(ny - prev.y) < SNAP_ORTO) ny = prev.y;
	else if (next && Math.abs(ny - next.y) < SNAP_ORTO) ny = next.y;
	wps[idx] = { x: nx, y: ny };
}

/* ------------- Riel y sus aparatos: se mueven juntos y se revierte si chocan ------------- */

/** Foto del riel y de los aparatos anclados a él, para poder deshacer un movimiento inválido. */
interface EstadoRiel {
	riel: { x: number; y: number; largo: number };
	aparatos: { dispositivoId: string; x: number; y: number }[];
}
let estadoRielArrastre: EstadoRiel | undefined;

function capturarEstadoRiel(rielId: string): EstadoRiel | undefined {
	const g = proyecto.gabinete;
	const riel = g?.rieles.find((r) => r.id === rielId);
	if (!g || !riel) return undefined;
	return {
		riel: { x: riel.x, y: riel.y, largo: riel.largo },
		aparatos: g.colocaciones
			.filter((c) => c.rielId === rielId)
			.map((c) => ({ dispositivoId: c.dispositivoId, x: c.x, y: c.y })),
	};
}

function restaurarEstadoRiel(rielId: string, e: EstadoRiel): void {
	const g = proyecto.gabinete!;
	const riel = g.rieles.find((r) => r.id === rielId);
	if (riel) { riel.x = e.riel.x; riel.y = e.riel.y; riel.largo = e.riel.largo; }
	for (const a of e.aparatos) {
		const col = g.colocaciones.find((c) => c.dispositivoId === a.dispositivoId);
		if (col) { col.x = a.x; col.y = a.y; }
	}
}

/** Aparatos anclados a un riel (los que se mueven con él). */
function aparatosDelRiel(rielId: string): Colocacion[] {
	return proyecto.gabinete?.colocaciones.filter((c) => c.rielId === rielId) ?? [];
}

/** Coloca en la escena los aparatos del riel en su posición actual (arrastre fluido). */
function refrescarAparatosDelRiel(rielId: string): void {
	for (const c of aparatosDelRiel(rielId)) {
		const centro = escenario.aEscena(c.x + c.ancho / 2, c.y + c.alto / 2, 0);
		grupoDe(c.dispositivoId)?.position.set(centro.x, centro.y, 0);
	}
}

/** ¿Los aparatos del riel caben donde están, sin chocar con otros ni salirse de la placa? */
function rielValido(rielId: string): boolean {
	const g = proyecto.gabinete;
	if (!g) return true;
	for (const c of aparatosDelRiel(rielId)) {
		if (c.x < 0 || c.y < 0 || c.x + c.ancho > g.ancho || c.y + c.alto > g.alto) return false;
		if (solapaCon(c.x, c.y, c.ancho, c.alto, c.dispositivoId)) return false;
	}
	return true;
}

/* --------------------- Prevención de superposición --------------------- */

const HOLGURA = 3; // mm de separación mínima entre aparatos

/** ¿La huella (x,y,ancho,alto) se solapa con otro aparato real (las imágenes no cuentan)? */
function solapaCon(x: number, y: number, ancho: number, alto: number, exceptoId: string): boolean {
	const g = proyecto.gabinete!;
	for (const c of g.colocaciones) {
		if (c.dispositivoId === exceptoId) continue;
		if (proyecto.dispositivos.find((z) => z.id === c.dispositivoId)?.imagen) continue;
		const separados =
			x + ancho + HOLGURA <= c.x || c.x + c.ancho + HOLGURA <= x ||
			y + alto + HOLGURA <= c.y || c.y + c.alto + HOLGURA <= y;
		if (!separados) return true;
	}
	return false;
}

/** X libre más cercano a `xDeseado` en la misma fila (misma y), sin solapar; undefined si no cabe. */
function xLibreCercano(xDeseado: number, y: number, ancho: number, alto: number, id: string): number | undefined {
	const g = proyecto.gabinete!;
	const maxX = g.ancho - ancho;
	for (let off = 0; off <= g.ancho; off += 5) {
		for (const cand of off === 0 ? [xDeseado] : [xDeseado - off, xDeseado + off]) {
			const x = Math.min(Math.max(cand, 0), maxX);
			if (!solapaCon(x, y, ancho, alto, id)) return x;
		}
	}
	return undefined;
}

/** Handle bajo el puntero (tiene prioridad sobre cualquier otra cosa). */
function handleBajoElPuntero(ev: MouseEvent): DatosHandle | undefined {
	if (escenario.handles.children.length === 0) return undefined;
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impactos = raycaster.intersectObjects(escenario.handles.children, false);
	// Los marcadores/etiquetas de extremo no tienen `handle`; se ignoran para no bloquear el tirador.
	return impactos.find((i) => i.object.userData.handle)?.object.userData.handle as DatosHandle | undefined;
}

/** Reconstruye en la escena solo el riel o canaleta indicado (para arrastre fluido). */
function reconstruirEstructuraUno(s: Seleccion): void {
	const g = proyecto.gabinete!;
	const clave = s.tipo === 'canaleta' ? 'canaletaId' : 'rielId';
	for (const hijo of [...escenario.raiz.children]) {
		if (hijo.userData[clave] === s.id) { escenario.raiz.remove(hijo); liberar(hijo); }
	}
	if (s.tipo === 'canaleta') {
		const can = g.canaletas.find((c) => c.id === s.id);
		if (can) escenario.raiz.add(construirCanaleta(can, escenario.aEscena, escenario.tapas));
	} else {
		const riel = g.rieles.find((r) => r.id === s.id);
		if (riel) escenario.raiz.add(construirRiel(riel, escenario.aEscena));
	}
}

/** Cota bajo el puntero (etiqueta clicable), solo si "Ver tamaños" está activo. */
function cotaBajoElPuntero(ev: PointerEvent): DatosCota | undefined {
	if (!escenario.cotas.visible) return undefined;
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camara);
	const impactos = raycaster.intersectObjects(escenario.cotas.children, true);
	return impactos.find((i) => i.object.userData.cota)?.object.userData.cota as DatosCota | undefined;
}

/**
 * En modo pin, añade un punto de conexión a la imagen seleccionada donde se hizo clic.
 * Devuelve true si el clic cayó sobre la imagen (y se consume); el nombre se pide después.
 */
function anadirPin(ev: PointerEvent): boolean {
	const id = idDispositivoSel();
	if (!id) return false;
	const d = proyecto.dispositivos.find((x) => x.id === id);
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === id);
	if (!d?.imagen || !col) return false;
	// Se proyecta sobre el plano de LA IMAGEN, no sobre la placa: si la imagen se ha mandado al
	// fondo o traído al frente, proyectar a z=0 dejaba el punto desplazado respecto de donde se
	// pinchó, y más cuanto más girada estuviera la cámara.
	const p = puntoModeloEnZ(ev, (col.z ?? 0) + 10);
	if (!p) return false;
	const u = (p.x - col.x) / col.ancho;
	const v = (p.y - col.y) / col.alto;
	if (u < 0 || u > 1 || v < 0 || v > 1) return false; // clic fuera de la imagen
	void (async () => {
		const etiqueta = await pedirTexto('Nombre del punto de conexión (p. ej. L1, GND, +24):', `P${d.bornes.length + 1}`);
		if (etiqueta === null) return;
		capturar();
		d.bornes.push({ id: etiqueta.trim() || `P${d.bornes.length + 1}`, u, v });
		actualizarTodo();
	})();
	return true;
}

/** Edita la dimensión que representa una cota (solo modo editor). */
async function editarCota(datos: DatosCota): Promise<void> {
	const g = proyecto.gabinete!;
	const actual = datos.valorMm / 10;
	const entrada = await pedirTexto(`Nuevo valor en cm (actual ${actual} cm):`, String(actual));
	if (entrada === null) return;
	const cm = Number(entrada.replace(',', '.'));
	if (!isFinite(cm) || cm <= 0) { avisar('Introduce un número válido en cm', 'error'); return; }
	capturar();
	const mm = Math.round(cm * 10);
	const o = datos.objetivo;
	if (o.tipo === 'caja') {
		g.caja = g.caja ?? cajaDe(g);
		g.caja[o.dim] = mm;
	} else if (o.tipo === 'placa') {
		const anterior = g[o.dim];
		g[o.dim] = mm;
		// Estirar rieles/canaletas con el cambio de placa, como en aplicarEstructura.
		const delta = mm - anterior;
		if (o.dim === 'ancho') {
			for (const riel of g.rieles) riel.largo = Math.max(120, riel.largo + delta);
			for (const can of g.canaletas) if (can.orientacion === 'h') can.largo = Math.max(120, can.largo + delta);
		} else {
			for (const can of g.canaletas) if (can.orientacion === 'v') can.largo = Math.max(120, can.largo + delta);
		}
		for (const col of g.colocaciones) {
			col.x = Math.min(Math.max(col.x, 0), Math.max(0, g.ancho - col.ancho));
			col.y = Math.min(Math.max(col.y, 0), Math.max(0, g.alto - col.alto));
		}
	} else if (o.tipo === 'riel') {
		const riel = g.rieles.find((r) => r.id === o.id);
		if (riel) riel.largo = mm;
	} else {
		const can = g.canaletas.find((c) => c.id === o.id);
		if (can) can.largo = mm;
	}
	actualizarTodo();
	pintarEstructura();
}

renderer.domElement.addEventListener('pointerdown', (ev) => {
	// Al volver al tablero, el teclado vuelve con él: si el foco se había quedado en un campo
	// (el buscador del catálogo, una medida…), los atajos dejaban de responder sin avisar.
	const foco = document.activeElement as HTMLElement | null;
	if (foco && /^(INPUT|SELECT|TEXTAREA)$/.test(foco.tagName)) foco.blur();
	if (visualizacion) return; // en Visualización solo se mira: nada se selecciona ni se mueve
	// Cablear por clic: si estamos eligiendo destino, el próximo clic sobre otro aparato
	// lo fija como destino en el formulario (funciona en cualquier modo). Se actualiza el
	// DOM en el sitio para no perder la selección de destino al re-renderizar.
	if (eligiendoDestino) {
		eligiendoDestino = false;
		$('ayuda').textContent = AYUDA[modo];
		const origenId = idDispositivoSel();
		const clic = elementoBajoElPuntero(ev);
		const selDestino = document.getElementById('cable-destino') as HTMLSelectElement | null;
		if (selDestino && clic && clic.tipo === 'dispositivo' && clic.id !== origenId) {
			selDestino.value = clic.id;
			selDestino.dispatchEvent(new Event('change'));
		}
		const btn = document.getElementById('btn-elegir-destino') as HTMLButtonElement | null;
		if (btn) { btn.classList.remove('primario'); btn.textContent = '🎯 Elegir destino en el tablero'; }
		return;
	}

	// Cableado por clic en los bornes (modo Trabajo, clic izquierdo): clic en un borne y luego
	// en otro crea el cable, como en un tablero real. Tiene prioridad para poder conectar.
	if (modo === 'trabajo' && ev.button === 0) {
		const golpe = borneBajoElPunteroCon(ev);
		// Regla única cuando un cable pasa justo por delante de un terminal: MANDA LO QUE SE VE
		// ENCIMA. El punto del borne queda por detrás del plano de los cables, así que si en ese
		// píxel se ve el cable, el clic es para agarrar el cable; en el resto del punto (que sigue
		// siendo la mayor parte) el clic es para conectar. Antes la esfera se comía el clic en todo
		// su contorno, y de ahí venía el «a veces no puedo agarrar los cables».
		// Tendiendo un cable el borne manda siempre: hay que poder rematarlo donde sea.
		if (golpe && (cableandoDesde || !cableTapaAlBorne(ev, golpe.distancia))) {
			if (cableandoDesde) completarCableado(golpe.borne);
			else iniciarCableado(golpe.borne);
			return;
		}
		// Tendiendo un cable: cada clic en un punto libre marca un CODO (como en Tinkercad).
		if (cableandoDesde) {
			const p = puntoCable(ev);
			if (p) anadirCodoCableado(p.x, p.y);
			return;
		}
	}

	// Tiradores (redimensionar estructura en Editor, ordenar cable en Trabajo): máxima prioridad.
	const handle = handleBajoElPuntero(ev);
	if (handle) {
		handleArrastrado = handle;
		arrastrando = true;
		capturadoEsteArrastre = false;
		controles.enabled = false;
		return;
	}

	if (modo === 'editor') {
		// Modo pin: clic sobre la imagen añade un punto de conexión.
		if (modoPin && anadirPin(ev)) return;
		// Cota clicable → editar medida.
		const cota = cotaBajoElPuntero(ev);
		if (cota) { editarCota(cota); return; }
	}

	// Shift+clic sobre un aparato: lo añade o lo quita de la selección múltiple. En un tablero
	// se mueven y se borran grupos de aparatos constantemente; de uno en uno es inviable.
	if (modo === 'editor' && ev.shiftKey) {
		const bajo = elementoBajoElPuntero(ev);
		if (bajo?.tipo === 'dispositivo') {
			construyendoSeleccion = true;
			alternarEnSeleccion(bajo.id);
			construyendoSeleccion = false;
			return;
		}
	}

	let elem = elementoBajoElPuntero(ev);

	// Modo Trabajo (CLIC IZQUIERDO = agarrar y mover el cable): se puede agarrar CUALQUIER
	// cable por cualquier punto de su recorrido, esté o no seleccionado. Si el punto de agarre
	// cae sobre una unión existente se mueve esa; si no, al empezar a arrastrar se crea una
	// unión ahí (si solo se hace clic sin arrastrar, únicamente se selecciona: no deja uniones
	// sueltas). Los aparatos solo tienen prioridad si están DELANTE del cable.
	if (modo === 'trabajo') {
		const cid = cableBajoElPuntero(ev);
		if (cid && (elem?.tipo !== 'dispositivo' || cableEstaDelante(ev))) {
			if (!(sel?.tipo === 'cable' && sel.id === cid)) aplicarSeleccion({ tipo: 'cable', id: cid });
			const c = proyecto.conductores.find((x) => x.id === cid);
			const p = puntoCable(ev);
			if (c && p) {
				const idx = (c.trazado ?? []).findIndex((w) => Math.hypot(w.x - p.x, w.y - p.y) < 26);
				// Se anota la intención de arrastre; el punto no se crea hasta que el ratón se mueve.
				pendienteCable = { id: cid, indice: idx, x: p.x, y: p.y };
				arrastrando = true;
				handleArrastrado = undefined;
				capturadoEsteArrastre = false;
				controles.enabled = false;
				renderer.domElement.style.cursor = 'grabbing';
			}
			return;
		}
	}

	// En modo Trabajo solo se seleccionan aparatos (para cablear); la estructura no, y los
	// cables ya se gestionaron arriba. En modo Editor no se seleccionan cables.
	if (modo === 'trabajo' && elem && elem.tipo !== 'dispositivo') elem = undefined;
	if (modo === 'editor' && elem && elem.tipo === 'cable') elem = undefined;
	const mismo = elem && sel && elem.tipo === sel.tipo && elem.id === sel.id;
	if (!mismo) aplicarSeleccion(elem);
	if (!elem || modo !== 'editor') return;

	// Preparar arrastre (mover). Los aparatos normales y las imágenes/canaletas/rieles
	// se pueden mover; los aparatos sin colocación no.
	const g = proyecto.gabinete!;
	if (elem.tipo === 'dispositivo' && !g.colocaciones.some((c) => c.dispositivoId === elem.id)) return;
	arrastrando = true;
	handleArrastrado = undefined;
	capturadoEsteArrastre = false;
	controles.enabled = false;
	const p = puntoModelo(ev);
	if (!p) return;
	if (elem.tipo === 'dispositivo') {
		const col = g.colocaciones.find((c) => c.dispositivoId === elem.id)!;
		desfase.set(p.x - (col.x + col.ancho / 2), p.y - (col.y + col.alto / 2));
		arrastreInicio = { x: col.x, y: col.y };
	} else if (elem.tipo === 'canaleta') {
		const can = g.canaletas.find((c) => c.id === elem.id)!;
		desfase.set(p.x - can.x, p.y - can.y);
	} else {
		const riel = g.rieles.find((r) => r.id === elem.id)!;
		desfase.set(p.x - riel.x, p.y - riel.y);
	}
});

renderer.domElement.addEventListener('pointermove', (ev) => {
	if (visualizacion) return;
	// Resaltado al pasar el ratón (modo Trabajo): bornes (para cablear) y cables (para tocarlos).
	if (!arrastrando) {
		if (modo === 'trabajo') {
			const b = borneBajoElPuntero(ev);
			resaltarHoverBorne(b);
			mostrarTipBorne(b, ev);
			resaltarHoverCable(b ? undefined : cableBajoElPuntero(ev));
			if (cableandoDesde) { const p = puntoCable(ev); if (p) actualizarGomaCable(p.x, p.y); }
			renderer.domElement.style.cursor = b || cableandoDesde ? 'crosshair' : (cableBajoElPuntero(ev) ? 'grab' : '');
		}
		return;
	}
	// --- Cable agarrado: al primer movimiento real empieza el arrastre de verdad ---
	// Arrastrar MUEVE una unión existente; no crea ninguna. Las uniones se crean solo con doble
	// clic, para que mover un cable un poco no llene el tablero de puntos sin querer.
	if (pendienteCable) {
		const pc = puntoCable(ev);
		if (!pc) return;
		if (Math.hypot(pc.x - pendienteCable.x, pc.y - pendienteCable.y) < 6) return; // aún es un clic
		if (pendienteCable.indice >= 0) {
			capturar();
			arrastrandoCable = { id: pendienteCable.id, indice: pendienteCable.indice };
			capturadoEsteArrastre = true;
		} else {
			// Sin unión donde se pinchó no hay nada que mover: se avisa una sola vez.
			avisar('Haz doble clic sobre el cable para crear una unión y poder moverlo ahí.', 'info');
			controles.enabled = true;
			arrastrando = false;
			renderer.domElement.style.cursor = '';
		}
		pendienteCable = undefined;
	}

	// --- Mover el punto de quiebre que se agarró directo por el tubo ---
	if (arrastrandoCable) {
		const pc = puntoCable(ev);
		const c = proyecto.conductores.find((x) => x.id === arrastrandoCable!.id);
		if (c && pc) {
			moverWaypoint(c, arrastrandoCable.indice, pc.x, pc.y);
			reconstruirCables();
			construirHandles();
		}
		return;
	}

	if (!sel) return;
	const p = puntoModelo(ev);
	if (!p) return;
	if (!capturadoEsteArrastre) { capturar(); capturadoEsteArrastre = true; }
	// Antes de tocar nada: foto del riel y de sus aparatos, por si hay que devolverlos.
	if (!estadoRielArrastre && sel.tipo === 'riel') estadoRielArrastre = capturarEstadoRiel(sel.id);
	const g = proyecto.gabinete!;

	// --- Redimensionar / ordenar con un tirador ---
	if (handleArrastrado) {
		if (sel.tipo === 'cable') {
			// Mover el punto de quiebre del tirador (o crear el primero si el cable no tenía).
			const c = proyecto.conductores.find((x) => x.id === sel!.id)!;
			if (handleArrastrado.indice === undefined || handleArrastrado.indice < 0) {
				c.trazado = [{ x: Math.round(p.x), y: Math.round(p.y) }];
			} else {
				moverWaypoint(c, handleArrastrado.indice, p.x, p.y);
			}
			reconstruirCables();
			construirHandles();
			return;
		}
		if (sel.tipo === 'canaleta') {
			const can = g.canaletas.find((c) => c.id === sel!.id)!;
			const esH = can.orientacion === 'h';
			if (handleArrastrado.rol === 'fin') {
				can.largo = Math.max(60, Math.round((esH ? p.x - can.x : p.y - can.y) / 5) * 5);
			} else {
				const fin = esH ? can.x + can.largo : can.y + can.largo;
				const nuevoIni = Math.min(esH ? p.x : p.y, fin - 60);
				if (esH) { can.x = Math.round(nuevoIni / 5) * 5; can.largo = fin - can.x; }
				else { can.y = Math.round(nuevoIni / 5) * 5; can.largo = fin - can.y; }
			}
			reconstruirEstructuraUno(sel);
		} else if (sel.tipo === 'riel') {
			const riel = g.rieles.find((r) => r.id === sel!.id)!;
			if (handleArrastrado.rol === 'fin') {
				riel.largo = Math.max(60, Math.round((p.x - riel.x) / 5) * 5);
			} else {
				const fin = riel.x + riel.largo;
				riel.x = Math.round(Math.min(p.x, fin - 60) / 5) * 5;
				riel.largo = fin - riel.x;
			}
			reconstruirEstructuraUno(sel);
		} else {
			const d = proyecto.dispositivos.find((x) => x.id === sel!.id)!;
			const col = g.colocaciones.find((c) => c.dispositivoId === sel!.id)!;
			if (d.imagen) {
				col.ancho = Math.max(40, Math.round((p.x - col.x) / 5) * 5);
				col.alto = Math.max(40, Math.round((p.y - col.y) / 5) * 5);
				reconstruirDispositivoUno(sel.id);
			}
		}
		construirHandles();
		return;
	}

	// --- Mover ---
	// Un CABLE no se mueve por aquí: sus uniones las lleva `arrastrandoCable`. Si se llegara a
	// esta parte con un cable seleccionado (pasaba al pinchar un cable sin uniones y arrastrar),
	// se buscaría un riel con el id del cable y se rompía la escena.
	if (sel.tipo === 'cable') { arrastrando = false; controles.enabled = true; return; }
	if (sel.tipo === 'dispositivo') {
		const col = g.colocaciones.find((c) => c.dispositivoId === sel!.id)!;
		const antesX = col.x;
		const antesY = col.y;
		// El aparato SIEMPRE se pega al riel más cercano (nunca queda flotando).
		const snap = snapAriel(p.x - desfase.x, p.y - desfase.y, col.ancho, col.alto);
		const cx = snap ? snap.cx : p.x - desfase.x;
		const cy = snap ? snap.cy : p.y - desfase.y;
		col.rielId = snap?.rielId;
		col.x = Math.min(Math.max(cx - col.ancho / 2, 0), g.ancho - col.ancho);
		col.y = Math.min(Math.max(cy - col.alto / 2, 0), g.alto - col.alto);
		const c = escenario.aEscena(col.x + col.ancho / 2, col.y + col.alto / 2, 0);
		grupoDe(sel.id)!.position.set(c.x, c.y, 0);
		// Si hay más aparatos seleccionados, se mueven TODOS lo mismo: el grupo viaja junto.
		const dx = col.x - antesX;
		const dy = col.y - antesY;
		if ((dx || dy) && seleccionExtra.length) moverAcompanantes(dx, dy);
		// Aviso en vivo: rojo si se solapa con otro aparato, azul si está libre.
		const solapa = aparatosSeleccionados().some((id) => {
			const o = g.colocaciones.find((x) => x.dispositivoId === id);
			return o && solapaCon(o.x, o.y, o.ancho, o.alto, id);
		});
		for (const m of resaltados) m.emissive.setHex(solapa ? 0xff3b3b : 0x1d4ed8);
	} else if (sel.tipo === 'canaleta') {
		const can = g.canaletas.find((c) => c.id === sel!.id)!;
		can.x = Math.round((p.x - desfase.x) / 5) * 5;
		can.y = Math.round((p.y - desfase.y) / 5) * 5;
		reconstruirEstructuraUno(sel);
	} else if (sel.tipo === 'riel') {
		// Mover un riel ARRASTRA CONSIGO los aparatos anclados a él (como al soltar el perfil
		// DIN en un tablero real). Si algo choca o se sale, se avisa en rojo en el momento.
		const riel = g.rieles.find((r) => r.id === sel!.id);
		if (!riel) { arrastrando = false; controles.enabled = true; return; }
		const nx = Math.round((p.x - desfase.x) / 5) * 5;
		const ny = Math.round((p.y - desfase.y) / 5) * 5;
		const dx = nx - riel.x;
		const dy = ny - riel.y;
		riel.x = nx;
		riel.y = ny;
		for (const c of aparatosDelRiel(riel.id)) { c.x += dx; c.y += dy; }
		reconstruirEstructuraUno(sel);
		refrescarAparatosDelRiel(riel.id);
		const ok = rielValido(riel.id);
		for (const m of resaltados) m.emissive.setHex(ok ? 0x1d4ed8 : 0xff3b3b);
	}
	construirHandles();
});

renderer.domElement.addEventListener('pointerleave', () => mostrarTipBorne(undefined));

renderer.domElement.addEventListener('pointerup', () => {
	if (!arrastrando) return;
	arrastrando = false;
	handleArrastrado = undefined;
	const eraCable = arrastrandoCable;
	arrastrandoCable = undefined;
	pendienteCable = undefined; // si no llegó a moverse, fue solo un clic de selección
	controles.enabled = true;
	renderer.domElement.style.cursor = '';
	if (!capturadoEsteArrastre) { arrastreInicio = undefined; estadoRielArrastre = undefined; return; } // fue un clic
	// Riel soltado: si sus aparatos chocaron con otros o se salieron de la placa, se devuelve
	// TODO (riel y aparatos) a donde estaba. Nada queda encimado ni fuera del tablero.
	if (sel?.tipo === 'riel' && estadoRielArrastre) {
		if (!rielValido(sel.id)) {
			restaurarEstadoRiel(sel.id, estadoRielArrastre);
			avisar('Ahí no cabe: chocaba con otro aparato, así que el riel volvió a su sitio', 'error');
		}
		estadoRielArrastre = undefined;
		for (const m of resaltados) m.emissive.setHex(0x1d4ed8);
		actualizarTodo();
		pintarEstructura();
		return;
	}
	if (eraCable) {
		// Mover un cable a mano no cambia la estructura ni el ruteo eléctrico: refresco ligero.
		// (La adaptación a la canaleta ya ocurre durante el arrastre, pegando el punto a su eje,
		// así que no hay ningún «salto» sorpresa al soltar.)
		reconstruirCables();
		construirHandles();
		pintarPaneles();
		pintarSeleccion();
		return;
	}

	// Resolver superposición al soltar un aparato: se corre al hueco libre más cercano;
	// si no cabe en ninguna parte de su fila, vuelve a su sitio original.
	if (sel?.tipo === 'dispositivo' && !handleArrastrado) {
		const g = proyecto.gabinete!;
		const col = g.colocaciones.find((c) => c.dispositivoId === sel!.id);
		if (col && solapaCon(col.x, col.y, col.ancho, col.alto, sel.id)) {
			const libre = xLibreCercano(col.x, col.y, col.ancho, col.alto, sel.id);
			if (libre !== undefined) {
				col.x = libre;
				avisar('Se movió para no encimarse con otro aparato');
			} else if (arrastreInicio) {
				col.x = arrastreInicio.x;
				col.y = arrastreInicio.y;
				avisar('No cabe ahí sin encimarse: se devolvió a su sitio', 'error');
			}
			const c = escenario.aEscena(col.x + col.ancho / 2, col.y + col.alto / 2, 0);
			grupoDe(sel.id)?.position.set(c.x, c.y, 0);
		}
		for (const m of resaltados) m.emissive.setHex(0x1d4ed8); // restaurar color de selección
	}
	arrastreInicio = undefined;

	recalcular();
	reconstruirCables();
	reconstruirBornes(); // si se movió un aparato, sus bornes clicables van con él
	reconstruirCotas();
	construirHandles();
	pintarPaneles();
	pintarSeleccion();
	pintarEstructura();
});

// Doble clic sobre un punto de quiebre de un cable → se quita ese punto.
/**
 * Crea una unión (punto de quiebre) en el cable que hay bajo el puntero. Es la única forma de
 * crear uniones: con DOBLE CLIC, izquierdo o derecho. Antes bastaba con arrastrar el cable, y
 * eso llenaba el tablero de puntos sin querer al intentar solo moverlo.
 */
function crearUnionBajoElPuntero(ev: MouseEvent): boolean {
	const cid = cableBajoElPuntero(ev);
	const p = puntoCable(ev);
	const c = cid ? proyecto.conductores.find((x) => x.id === cid) : undefined;
	if (!c || !p) return false;
	if (!(sel?.tipo === 'cable' && sel.id === cid)) aplicarSeleccion({ tipo: 'cable', id: c.id });
	capturar();
	insertarWaypoint(c, p.x, p.y);
	reconstruirCables();
	construirHandles();
	pintarPaneles();
	pintarSeleccion();
	avisar('Unión creada — arrástrala para llevar el cable por donde quieras', 'ok');
	return true;
}

// DOBLE CLIC IZQUIERDO: sobre una unión existente la quita; sobre el cable, crea una nueva.
renderer.domElement.addEventListener('dblclick', (ev) => {
	if (modo !== 'trabajo' || visualizacion || esquemaAbierto) return;
	const handle = handleBajoElPuntero(ev);
	if (handle?.sel.tipo === 'cable' && handle.indice !== undefined && handle.indice >= 0) {
		const c = proyecto.conductores.find((x) => x.id === handle.sel.id);
		if (c?.trazado && handle.indice < c.trazado.length) {
			capturar();
			c.trazado.splice(handle.indice, 1);
			if (c.trazado.length === 0) delete c.trazado;
			reconstruirCables();
			construirHandles();
			pintarPaneles();
			pintarSeleccion();
			avisar('Unión quitada');
			return;
		}
	}
	crearUnionBajoElPuntero(ev);
});

/**
 * DOBLE CLIC DERECHO sobre un cable = crear una unión ahí. El navegador no manda un «dblclick»
 * para el botón derecho, así que se cuentan a mano dos clics seguidos en el mismo sitio.
 * Un solo clic derecho no hace nada: era demasiado fácil dejar puntos sin querer.
 */
let ultimoDerecho: { x: number; y: number; t: number } | undefined;
const MS_DOBLE_CLIC = 600; // el umbral habitual de doble clic del sistema

renderer.domElement.addEventListener('contextmenu', (ev) => {
	ev.preventDefault(); // sin menú del navegador
	if (modo !== 'trabajo' || visualizacion || esquemaAbierto) return;
	if (cableandoDesde) { cancelarCableado(); avisar('Cableado cancelado.', 'info'); return; }

	const ahora = Date.now();
	const seguido = ultimoDerecho
		&& ahora - ultimoDerecho.t < MS_DOBLE_CLIC
		&& Math.hypot(ev.clientX - ultimoDerecho.x, ev.clientY - ultimoDerecho.y) < 8;
	ultimoDerecho = { x: ev.clientX, y: ev.clientY, t: ahora };
	if (!seguido) return;
	ultimoDerecho = undefined; // el par ya se ha consumido: tres clics no crean dos uniones
	crearUnionBajoElPuntero(ev);
});

window.addEventListener('keydown', (ev) => {
	const activo = document.activeElement?.tagName;
	if (activo === 'INPUT' || activo === 'SELECT' || activo === 'TEXTAREA') return;
	// Con el esquema o la Visualización delante, el tablero 3D NO se ve: dejar que Supr borrase
	// un aparato o Ctrl+V pegase otro sería editar a ciegas. Solo pasan navegar y salir.
	if (esquemaAbierto || visualizacion) {
		if (ev.key === 'Escape') {
			ev.preventDefault();
			if (esquemaAbierto) abrirEsquema(false); else aplicarVisualizacion(false);
		} else if (esquemaAbierto && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
			ev.preventDefault();
			hojaActual += ev.key === 'ArrowRight' ? 1 : -1;
			refrescarEsquema();
		}
		return;
	}
	const ctrl = ev.ctrlKey || ev.metaKey;
	if (ctrl && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); deshacer(); return; }
	if (ctrl && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) {
		ev.preventDefault();
		rehacer();
		return;
	}
	if (ev.key === 'Delete' || ev.key === 'Backspace') {
		// En Trabajo, Supr quita el CABLE seleccionado (lo natural al estar cableando).
		if (modo === 'trabajo' && sel?.tipo === 'cable') { quitarCable(sel.id); return; }
		if (modo === 'editor' && sel) {
			if (sel.tipo === 'dispositivo') eliminarSeleccionados();
			else eliminarEstructura(sel);
		}
	}
	if (ctrl && ev.key.toLowerCase() === 'c' && modo === 'editor' && sel?.tipo === 'dispositivo') {
		ev.preventDefault();
		copiarSeleccionados();
		return;
	}
	if (ctrl && ev.key.toLowerCase() === 'v' && modo === 'editor') {
		ev.preventDefault();
		pegarAparatos();
		return;
	}
	if (ctrl && ev.key.toLowerCase() === 'd') {
		ev.preventDefault();
		if (modo === 'editor' && sel?.tipo === 'dispositivo') duplicarDispositivo(sel.id);
		else avisar('Ctrl+D duplica el aparato seleccionado (en modo Editor).', 'info');
		return;
	}
	if (ev.key === 'Escape') {
		// Escape cierra primero lo que esté abierto encima: es lo que espera cualquiera.
		const abiertos = ['modal-proyecto', 'modal-controlador', 'modal-drc'].filter((id) => !($(id) as HTMLElement).hidden);
		if (abiertos.length) { for (const id of abiertos) ($(id) as HTMLElement).hidden = true; }
		else if (cableandoDesde) { cancelarCableado(); avisar('Cableado cancelado.', 'info'); }
		else aplicarSeleccion(undefined);
	}
});

/** Reconstruye en la escena solo el aparato indicado (para arrastre/resize fluido). */
function reconstruirDispositivoUno(id: string): void {
	const viejo = grupoDe(id);
	if (viejo) { escenario.dispositivos.remove(viejo); liberar(viejo); }
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === id);
	const d = proyecto.dispositivos.find((x) => x.id === id);
	if (col && d) {
		const etq: THREE.Object3D[] = [];
		escenario.dispositivos.add(construirDispositivo(d, col, escenario.aEscena, etq));
	}
}

async function eliminarEstructura(s: Seleccion): Promise<void> {
	const g = proyecto.gabinete!;
	const nombre = s.tipo === 'canaleta' ? 'la canaleta' : 'el riel';
	if (!(await confirmar(`¿Eliminar ${nombre} «${s.id}»?`, { ok: 'Eliminar', peligro: true }))) return;
	capturar();
	if (s.tipo === 'canaleta') g.canaletas = g.canaletas.filter((c) => c.id !== s.id);
	else g.rieles = g.rieles.filter((r) => r.id !== s.id);
	aplicarSeleccion(undefined);
	actualizarTodo();
	pintarEstructura();
	avisar(`Se eliminó ${nombre} «${s.id}» · Ctrl+Z para deshacer`);
}

/* ------------------------------ Barra superior ------------------------------ */

($('nombre-proyecto') as HTMLInputElement).onchange = (e) => {
	proyecto.nombre = (e.target as HTMLInputElement).value || 'Tablero sin nombre';
	recalcular();
};

($('btn-nuevo') as HTMLButtonElement).onclick = async () => {
	if (!(await confirmar('¿Empezar un tablero nuevo? Se vacía la placa (Ctrl+Z lo deshace).', { ok: 'Empezar de cero' }))) return;
	capturar();
	proyecto = proyectoNuevo();
	seleccionar(undefined);
	aplicarModo('editor'); // que se vea el catálogo para poder empezar a añadir aparatos
	actualizarTodo();
	pintarEstructura();
	encuadrar();
};

($('btn-guardar') as HTMLButtonElement).onclick = () => {
	descargar(
		`${nombreArchivo()}.tablero.json`,
		JSON.stringify(proyecto, null, '\t'),
		'application/json',
	);
	// Ya hay copia en un archivo del usuario: se puede cerrar la pestaña sin miedo.
	hayCambiosSinExportar = false;
	if (estadoGuardado !== 'fallo') { estadoGuardado = 'guardado'; pintarEstadoGuardado(); }
	avisar('Proyecto descargado', 'ok');
};

// Imagen de referencia: se importa como dispositivo con imagen (data URL) y colocación.
($('btn-imagen') as HTMLButtonElement).onclick = () => ($('archivo-imagen') as HTMLInputElement).click();
($('archivo-imagen') as HTMLInputElement).onchange = (e) => {
	const archivo = (e.target as HTMLInputElement).files?.[0];
	if (!archivo) return;
	const lector = new FileReader();
	lector.onload = () => {
		const url = lector.result as string;
		const img = new Image();
		img.onload = () => {
			if (modo !== 'editor') aplicarModo('editor');
			capturar();
			const g = proyecto.gabinete!;
			// Tamaño inicial ~1/3 del ancho de placa, conservando proporción de la imagen.
			const ancho = Math.round(g.ancho * 0.35);
			const alto = Math.round(ancho * (img.height / img.width));
			const id = `img${Date.now().toString(36)}`;
			proyecto.dispositivos.push({
				id, tipo: 'otro', imagen: url, campo: true,
				descripcion: archivo.name, bornes: [],
			});
			g.colocaciones.push({
				dispositivoId: id,
				x: Math.max(0, Math.round((g.ancho - ancho) / 2)),
				y: Math.max(0, Math.round((g.alto - alto) / 2)),
				ancho, alto,
			});
			actualizarTodo();
			seleccionar(id);
			$('ayuda').textContent = '🖼️ Imagen añadida — con ella seleccionada, pulsa «➕ Añadir punto de conexión» y haz clic sobre la imagen para marcar cada punto; luego cámbiate a modo Trabajo para cablearlos.';
		};
		img.src = url;
	};
	lector.readAsDataURL(archivo);
	(e.target as HTMLInputElement).value = '';
};

($('btn-abrir') as HTMLButtonElement).onclick = () => ($('archivo-abrir') as HTMLInputElement).click();
($('archivo-abrir') as HTMLInputElement).onchange = async (e) => {
	const archivo = (e.target as HTMLInputElement).files?.[0];
	if (!archivo) return;
	try {
		const { proyecto: abierto, arreglos } = cargarProyecto(await archivo.text());
		capturar();
		proyecto = abierto;
		seleccionar(undefined);
		actualizarTodo();
		pintarEstructura();
		encuadrar();
		// Si hubo que sanear algo, se dice: callarlo es dejar que el usuario descubra
		// más tarde que le faltan cables sin saber por qué.
		avisar(arreglos.length
			? `Proyecto abierto. Se corrigió: ${arreglos.join(', ')}.`
			: 'Proyecto abierto correctamente', arreglos.length ? 'info' : 'ok');
	} catch (e) {
		avisar(e instanceof ArchivoInvalido ? e.message
			: 'No se pudo leer el archivo de proyecto.', 'error');
	}
	(e.target as HTMLInputElement).value = '';
};

($('btn-dossier') as HTMLButtonElement).onclick = () => {
	const potenciales = calcularPotenciales(proyecto);
	const dossier = generarInformeHTML({
		proyecto,
		potenciales,
		hallazgos,
		referencias: generarReferencias(proyecto, posicionesEsquema),
		planesBorneros: generarPlanBorneros(proyecto, potenciales),
		ruteo,
		sincronizacion: sincronizarEsquemaGabinete(proyecto),
	});
	descargar(`${proyecto.nombre.replaceAll(/[^\wáéíóúñ -]/gi, '')} - dossier.html`, dossier, 'text/html');
};

($('btn-pdf') as HTMLButtonElement).onclick = async () => {
	try {
		const { exportarPDF } = await import('./pdf.js');
		exportarPDF(proyecto);
		avisar('PDF exportado con la lista de materiales', 'ok');
	} catch (e) {
		avisar('No se pudo generar el PDF: ' + (e as Error).message, 'error');
	}
};

/* ------------------------------- Modos ------------------------------- */

const AYUDA: Record<Modo, string> = {
	editor: '🔧 EDITOR (armar) — Añade aparatos del catálogo (van sobre un riel) · arrástralos · edita caja, placa, rieles y canaletas (botón «Girar H↔V») · Duplicar/Eliminar · Supr borra · Ctrl+Z deshace',
	trabajo: '🔌 TRABAJO (conexiones) — Cablea tocando un borne (punto naranja) y luego otro · doble clic sobre un cable crea una unión y el clic izquierdo la arrastra · Esc cancela · DRC en vivo. La estructura está bloqueada.',
};

/* ------------------------------- Modo Visualización ------------------------------- */

/** True cuando se está viendo el tablero «como quedaría de verdad» (no se puede editar). */
let visualizacion = false;

/**
 * Entra o sale del modo Visualización: caja de chapa opaca con la puerta abierta, sin
 * transparencias ni ayudas de edición, paneles laterales ocultos y toda edición bloqueada.
 * Solo se puede girar y acercar la vista, como enseñando el tablero terminado.
 */
function aplicarVisualizacion(activo: boolean): void {
	if (activo && esquemaAbierto) abrirEsquema(false); // las dos capas no pueden convivir
	visualizacion = activo;
	document.body.classList.toggle('modo-visualizacion', activo);
	$('btn-ver').classList.toggle('activo', activo);
	($('btn-ver') as HTMLButtonElement).textContent = activo ? '👁️ Salir' : '👁️ Ver';
	if (activo) {
		cancelarCableado();
		mostrarTipBorne(undefined);
		aplicarSeleccion(undefined);
		arrastrando = false;
		controles.enabled = true;
	}
	// Aquí no se trabaja, así que la cámara va SUELTA: se puede dar toda la vuelta al tablero
	// y mirarlo desde donde se quiera. Al volver a editar se recuperan los topes de trabajo
	// (que evitan quedar detrás del tablero, donde no se puede cablear).
	controles.minAzimuthAngle = activo ? -Infinity : -Math.PI * 0.42;
	controles.maxAzimuthAngle = activo ? Infinity : Math.PI * 0.42;
	controles.minPolarAngle = activo ? 0.01 : Math.PI * 0.10;
	controles.maxPolarAngle = activo ? Math.PI - 0.01 : Math.PI * 0.80;
	montarEscenario();
	escenario.bornes.visible = !activo && modo === 'trabajo';
	$('ayuda').textContent = activo
		? '👁️ VISUALIZACIÓN — Así queda el tablero montado, con la puerta abierta. Gira y acerca la vista; para editar, pulsa «Salir».'
		: AYUDA[modo];
	pintarSeleccion();
	encuadrar();
}

function aplicarModo(nuevo: Modo): void {
	modo = nuevo;
	document.body.classList.toggle('modo-trabajo', modo === 'trabajo');
	$('modo-editor').classList.toggle('activo', modo === 'editor');
	$('modo-trabajo').classList.toggle('activo', modo === 'trabajo');
	$('ayuda').textContent = AYUDA[modo];
	eligiendoDestino = false;
	cancelarCableado();
	mostrarTipBorne(undefined);
	// Los bornes clicables solo se ven en Trabajo, y se reconstruyen al entrar para que estén
	// donde de verdad quedaron los aparatos si se movieron en el Editor.
	if (modo === 'trabajo') reconstruirBornes();
	escenario.bornes.visible = modo === 'trabajo';
	// Al pasar a trabajo se cancela cualquier arrastre en curso y se quitan los tiradores.
	if (modo === 'trabajo') {
		arrastrando = false;
		modoPin = false;
		controles.enabled = true;
		// Si había una canaleta/riel seleccionado, se deselecciona (no se editan en Trabajo).
		if (sel && sel.tipo !== 'dispositivo') aplicarSeleccion(undefined);
	}
	construirHandles();
	pintarSeleccion();
}

$('modo-editor').onclick = () => { if (!visualizacion) aplicarModo('editor'); };
$('modo-trabajo').onclick = () => { if (!visualizacion) aplicarModo('trabajo'); };
($('btn-ver') as HTMLButtonElement).onclick = () => aplicarVisualizacion(!visualizacion);

($('btn-deshacer') as HTMLButtonElement).onclick = deshacer;
($('btn-rehacer') as HTMLButtonElement).onclick = rehacer;

/* ----------------------------- Vista de esquema ----------------------------- */

/**
 * El esquema eléctrico: el plano de mando y potencia que se entrega al cliente y con el que
 * trabaja el electricista. Se monta desde el mismo modelo que el 3D —no hay dos verdades— y
 * se muestra como una capa por encima del lienzo, igual que el modo Visualización.
 */
let esquemaAbierto = false;
let hojasEsquema: HojaEsq[] = [];
let hojaActual = 0;
let zoomEsquema = 1;

/** Vuelve a montar el esquema desde el modelo actual y lo pinta. */
function refrescarEsquema(): void {
	if (!esquemaAbierto) return;
	hojasEsquema = montarEsquema(proyecto, potenciales);
	if (hojasEsquema.length === 0) {
		$('esquema-hoja').innerHTML = '<div id="esquema-vacio">Todavía no hay nada que dibujar.<br>'
			+ 'Coloca aparatos y conéctalos, y el esquema se dibuja solo.</div>';
		$('esq-indicador').textContent = 'Sin hojas';
		$('esq-titulo').textContent = '';
		return;
	}
	hojaActual = Math.max(0, Math.min(hojaActual, hojasEsquema.length - 1));
	const hoja = hojasEsquema[hojaActual];
	$('esquema-hoja').innerHTML = hojaASvg(hoja, {
		proyecto: proyecto.nombre,
		datos: proyecto.datos,
		totalHojas: hojasEsquema.length,
		resaltado: sel?.tipo === 'dispositivo' ? sel.id : undefined,
	});
	$('esq-indicador').textContent = `Hoja ${hoja.numero} / ${hojasEsquema.length}`;
	$('esq-titulo').textContent = hoja.titulo;
	aplicarZoomEsquema();

	// Pinchar un símbolo selecciona ese aparato en todo el programa: el esquema y el 3D son
	// dos vistas del mismo tablero, no dos programas distintos.
	for (const g of $('esquema-hoja').querySelectorAll<SVGGElement>('[data-dispositivo]')) {
		g.addEventListener('click', () => {
			const id = g.getAttribute('data-dispositivo');
			if (id) { seleccionar(id); refrescarEsquema(); }
		});
	}
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
	esquemaAbierto = abrir;
	($('panel-esquema') as HTMLElement).hidden = !abrir;
	$('btn-esquema').classList.toggle('activo', abrir);
	if (abrir) {
		if (visualizacion) aplicarVisualizacion(false); // las dos capas no pueden convivir
		zoomEsquema = 1;
		refrescarEsquema();
	}
}

/* ------------------ Copiar / pegar aparatos y plantillas propias ------------------ */

/** Lo que viaja en el portapapeles interno: aparatos con su huella, sin cables. */
interface Portapapeles {
	aparatos: { dispositivo: Dispositivo; ancho: number; alto: number; dx: number; dy: number }[];
}
const CLAVE_PORTAPAPELES = 'tablerostudio-portapapeles';
const CLAVE_PLANTILLAS = 'tablerostudio-plantillas';

/**
 * Copia los aparatos seleccionados. Se guarda en `localStorage` a propósito: así se pueden
 * pegar en OTRO proyecto (o tras recargar), que es justo el caso que interesa —reutilizar el
 * arranque que ya montaste en el tablero anterior—.
 */
function copiarSeleccionados(): void {
	const g = proyecto.gabinete;
	const ids = aparatosSeleccionados();
	if (!g || ids.length === 0) { avisar('Selecciona uno o más aparatos para copiarlos.', 'info'); return; }
	const cols = ids
		.map((id) => ({ col: g.colocaciones.find((c) => c.dispositivoId === id), d: proyecto.dispositivos.find((x) => x.id === id) }))
		.filter((x): x is { col: NonNullable<typeof x.col>; d: Dispositivo } => !!x.col && !!x.d && !x.d.imagen);
	if (cols.length === 0) { avisar('Las imágenes de referencia no se copian.', 'info'); return; }
	// Las posiciones se guardan RELATIVAS a la esquina del grupo, para pegarlo entero donde quepa.
	const x0 = Math.min(...cols.map((c) => c.col.x));
	const y0 = Math.min(...cols.map((c) => c.col.y));
	const datos: Portapapeles = {
		aparatos: cols.map(({ col, d }) => ({
			dispositivo: structuredClone(d), ancho: col.ancho, alto: col.alto, dx: col.x - x0, dy: col.y - y0,
		})),
	};
	try {
		localStorage.setItem(CLAVE_PORTAPAPELES, JSON.stringify(datos));
		avisar(`${cols.length} aparato${cols.length > 1 ? 's' : ''} copiado${cols.length > 1 ? 's' : ''}`, 'ok');
	} catch {
		avisar('No se pudo copiar (el navegador no deja guardar datos).', 'error');
	}
}

/** Pega lo copiado en el primer hueco libre, renumerando para no repetir designaciones. */
function pegarAparatos(): void {
	const g = proyecto.gabinete;
	if (!g) return;
	let datos: Portapapeles | undefined;
	try {
		const bruto = localStorage.getItem(CLAVE_PORTAPAPELES);
		if (bruto) datos = JSON.parse(bruto) as Portapapeles;
	} catch { /* portapapeles ilegible */ }
	if (!datos?.aparatos?.length) { avisar('No hay nada copiado todavía (Ctrl+C sobre un aparato).', 'info'); return; }

	const primero = datos.aparatos[0];
	const hueco = buscarHueco(primero.ancho, primero.alto);
	if (!hueco) { avisar('Añade un riel antes de pegar.', 'error'); return; }
	capturar();

	const nuevos: string[] = [];
	for (const a of datos.aparatos) {
		const copia = renumerar(structuredClone(a.dispositivo));
		proyecto.dispositivos.push(copia);
		const x = Math.min(Math.max(hueco.x + a.dx, 0), Math.max(0, g.ancho - a.ancho));
		const y = Math.min(Math.max(hueco.y + a.dy, 0), Math.max(0, g.alto - a.alto));
		// Cada copia se apoya en el riel que le toque por su posición, no en el del primero del
		// grupo: si el grupo abarca dos rieles, cada aparato tiene que quedar anclado al suyo.
		const enganche = snapAriel(x + a.ancho / 2, y + a.alto / 2, a.ancho, a.alto);
		const col = {
			dispositivoId: copia.id,
			x: enganche ? Math.min(Math.max(enganche.cx - a.ancho / 2, 0), Math.max(0, g.ancho - a.ancho)) : x,
			y: enganche ? Math.min(Math.max(enganche.cy - a.alto / 2, 0), Math.max(0, g.alto - a.alto)) : y,
			ancho: a.ancho, alto: a.alto,
			rielId: enganche?.rielId ?? hueco.rielId,
		};
		// Si cae encima de algo, se busca el hueco libre más cercano en su fila.
		if (solapaCon(col.x, col.y, col.ancho, col.alto, copia.id)) {
			col.x = xLibreCercano(col.x, col.y, col.ancho, col.alto, copia.id) ?? col.x;
		}
		g.colocaciones.push(col);
		extenderRielPara(col);
		nuevos.push(copia.id);
	}
	seleccionExtra = nuevos.slice(1);
	aplicarSeleccion(nuevos[0] ? { tipo: 'dispositivo', id: nuevos[0] } : undefined);
	actualizarTodo();
	avisar(`${nuevos.length} aparato${nuevos.length > 1 ? 's' : ''} pegado${nuevos.length > 1 ? 's' : ''}`, 'ok');
}

/** Da id nuevo y la siguiente designación libre de su clase a un aparato copiado. */
function renumerar(d: Dispositivo): Dispositivo {
	const clase = d.clase ?? CLASE_POR_TIPO[d.tipo];
	let maximo = 0;
	for (const x of proyecto.dispositivos) {
		if ((x.clase ?? CLASE_POR_TIPO[x.tipo]) === clase && x.numero) maximo = Math.max(maximo, x.numero);
	}
	const numero = maximo + 1;
	return {
		...d,
		id: `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
		numero,
		designacion: (d.designacion ?? '').replace(/\d+$/, '') + numero,
	};
}

/* ---------------------------- Plantillas de tablero ---------------------------- */

interface PlantillaTablero { nombre: string; fecha: string; proyecto: Proyecto }

function plantillasGuardadas(): PlantillaTablero[] {
	try {
		return JSON.parse(localStorage.getItem(CLAVE_PLANTILLAS) ?? '[]') as PlantillaTablero[];
	} catch { return []; }
}

/**
 * Guarda el tablero entero como plantilla reutilizable. En una empresa el 80 % de los tableros
 * se parecen entre sí: partir de «mi arranque estrella-triángulo» ahorra media jornada.
 */
async function guardarComoPlantilla(): Promise<void> {
	const nombre = (await pedirTexto('¿Cómo se llama esta plantilla?', proyecto.nombre))?.trim();
	if (!nombre) return;
	const lista = plantillasGuardadas().filter((p) => p.nombre !== nombre);
	lista.push({ nombre, fecha: new Date().toISOString(), proyecto: structuredClone(proyecto) });
	try {
		localStorage.setItem(CLAVE_PLANTILLAS, JSON.stringify(lista));
		avisar(`Plantilla «${nombre}» guardada`, 'ok');
	} catch {
		avisar('No se pudo guardar la plantilla (falta espacio en el navegador).', 'error');
	}
}

/** Lista las plantillas propias dentro de la biblioteca de ejemplos. */
function pintarPlantillasPropias(): string {
	const lista = plantillasGuardadas();
	if (lista.length === 0) return '';
	return `<h3 class="titulo-biblioteca">Tus plantillas</h3><div class="rejilla-ejemplos">`
		+ lista.map((p, i) => `
			<article class="tarjeta-ejemplo">
				<h4>${p.nombre}</h4>
				<p>Guardada el ${new Date(p.fecha).toLocaleDateString('es-CL')} · `
				+ `${p.proyecto.dispositivos.length} aparatos, ${p.proyecto.conductores.length} cables</p>
				<div class="acciones-ejemplo">
					<button class="boton primario" data-plantilla="${i}">Abrir</button>
					<button class="boton peligro" data-borrar-plantilla="${i}" title="Eliminar esta plantilla">🗑️</button>
				</div>
			</article>`).join('')
		+ `</div>`;
}

/* ------------------------ Entregables: rótulos y DXF ------------------------ */

($('btn-plantilla') as HTMLButtonElement).onclick = () => { void guardarComoPlantilla(); };

($('btn-etiquetas') as HTMLButtonElement).onclick = () => {
	try {
		exportarEtiquetasPDF(proyecto, potenciales, `${nombreArchivo()}-rotulos.pdf`);
		avisar('Rótulos exportados — imprímelos al 100 %, sin ajustar a la página', 'ok');
	} catch (e) {
		avisar(`No se pudieron generar los rótulos: ${(e as Error).message}`, 'error');
	}
};

($('btn-dxf-placa') as HTMLButtonElement).onclick = () => {
	try {
		descargar(`${nombreArchivo()}-placa.dxf`, dxfDePlaca(proyecto), 'image/vnd.dxf');
		avisar('Placa de montaje exportada a DXF', 'ok');
	} catch (e) {
		avisar(`No se pudo exportar el DXF: ${(e as Error).message}`, 'error');
	}
};

($('btn-dxf-esquema') as HTMLButtonElement).onclick = () => {
	// Si el esquema no está abierto se monta al vuelo: el usuario no tiene por qué abrirlo antes.
	const hojas = hojasEsquema.length ? hojasEsquema : montarEsquema(proyecto, potenciales);
	const hoja = hojas[Math.min(hojaActual, hojas.length - 1)];
	if (!hoja) { avisar('Todavía no hay esquema que exportar.', 'info'); return; }
	descargar(`${nombreArchivo()}-esquema-${hoja.numero}.dxf`, dxfDeEsquema(hoja), 'image/vnd.dxf');
	avisar(`Hoja ${hoja.numero} del esquema exportada a DXF`, 'ok');
};

/**
 * Menús desplegables de la barra. Agrupar en menús es lo que permite que los botones
 * quepan con su rótulo en un portátil en vez de quedarse en «N…», «G…».
 */
for (const [idMenu, idBoton] of [
	['menu-archivo', 'btn-archivo'],
	['menu-aprender', 'btn-aprender'],
	['menu-exportar', 'btn-exportar'],
] as const) {
	const menu = $(idMenu);
	($(idBoton) as HTMLButtonElement).onclick = (ev) => {
		ev.stopPropagation();
		const abierto = menu.classList.contains('abierto');
		// Abrir uno cierra los demás: nunca hay dos listas tapando el tablero a la vez.
		for (const m of document.querySelectorAll('#barra .menu')) m.classList.remove('abierto');
		menu.classList.toggle('abierto', !abierto);
	};
	// Un clic fuera, o elegir una opción, lo cierra.
	document.addEventListener('click', () => menu.classList.remove('abierto'));
	for (const b of menu.querySelectorAll('.lista button')) {
		b.addEventListener('click', () => menu.classList.remove('abierto'));
	}
}

($('btn-esquema') as HTMLButtonElement).onclick = () => abrirEsquema(!esquemaAbierto);
($('esq-cerrar') as HTMLButtonElement).onclick = () => abrirEsquema(false);
($('esq-anterior') as HTMLButtonElement).onclick = () => { hojaActual--; refrescarEsquema(); };
($('esq-siguiente') as HTMLButtonElement).onclick = () => { hojaActual++; refrescarEsquema(); };
($('esq-acercar') as HTMLButtonElement).onclick = () => { zoomEsquema = Math.min(6, zoomEsquema * 1.3); aplicarZoomEsquema(); };
($('esq-alejar') as HTMLButtonElement).onclick = () => { zoomEsquema = Math.max(0.4, zoomEsquema / 1.3); aplicarZoomEsquema(); };
($('esq-ajustar') as HTMLButtonElement).onclick = () => { zoomEsquema = 1; aplicarZoomEsquema(); };

($('esq-pdf') as HTMLButtonElement).onclick = async () => {
	if (hojasEsquema.length === 0) { avisar('No hay esquema que exportar todavía.', 'info'); return; }
	const btn = $('esq-pdf') as HTMLButtonElement;
	btn.disabled = true;
	const antes = btn.textContent;
	btn.textContent = 'Generando…';
	try {
		await exportarEsquemaPDF(hojasEsquema, proyecto.nombre, `${nombreArchivo()}-esquema.pdf`, proyecto.datos ?? {});
		avisar(`Esquema exportado (${hojasEsquema.length} hoja${hojasEsquema.length > 1 ? 's' : ''})`, 'ok');
	} catch (e) {
		avisar(`No se pudo exportar el esquema: ${(e as Error).message}`, 'error');
	} finally {
		btn.disabled = false;
		btn.textContent = antes;
	}
};

($('esq-svg') as HTMLButtonElement).onclick = () => {
	const hoja = hojasEsquema[hojaActual];
	if (!hoja) { avisar('No hay ninguna hoja que descargar.', 'info'); return; }
	// Se descarga en tinta negra sobre papel blanco: es lo que se imprime y se archiva.
	descargar(
		`${nombreArchivo()}-esquema-${hoja.numero}.svg`,
		hojaASvg(hoja, { proyecto: proyecto.nombre, datos: proyecto.datos, totalHojas: hojasEsquema.length }),
		'image/svg+xml',
	);
	avisar(`Hoja ${hoja.numero} descargada en SVG`, 'ok');
};

/* ------------------------------- Vista ------------------------------- */

($('ver-cotas') as HTMLInputElement).onchange = (e) => {
	escenario.cotas.visible = (e.target as HTMLInputElement).checked;
};
($('ver-voltaje') as HTMLInputElement).onchange = (e) => {
	coloreaVoltaje = (e.target as HTMLInputElement).checked;
	($('leyenda-voltaje') as HTMLElement).hidden = !coloreaVoltaje;
	reconstruirCables();
};
// Leyenda de colores por voltaje.
$('leyenda-voltaje').innerHTML =
	Object.entries(VOLTAJE_COLOR).map(([v, c]) =>
		`<span><i style="background:${hexColor(c as number)}"></i>${v} V</span>`).join('') +
	'<span><i style="background:#8a929a"></i>otro</span>';
($('ver-cables') as HTMLInputElement).onchange = (e) => {
	escenario.cables.visible = (e.target as HTMLInputElement).checked;
};
($('ver-tapas') as HTMLInputElement).onchange = (e) => {
	const v = (e.target as HTMLInputElement).checked;
	for (const t of escenario.tapas) t.visible = v;
};
($('ver-etiquetas') as HTMLInputElement).onchange = (e) => {
	const v = (e.target as HTMLInputElement).checked;
	for (const t of escenario.etiquetas) t.visible = v;
};

/* ----------------- Detalle de la verificación eléctrica (chip DRC) ----------------- */

/**
 * Abre el detalle de la verificación. El chip de la barra dice CUÁNTOS hallazgos hay; aquí se
 * ve CUÁLES son y se salta al aparato o al cable que los provoca. Antes el chip no hacía nada
 * y la lista solo estaba en un panel lateral que en modo Trabajo casi no se mira.
 */
function abrirDetalleDRC(): void {
	const cont = $('drc-detalle');
	const errores = hallazgos.filter((h) => h.severidad === 'error').length;
	const avisos = hallazgos.length - errores;
	$('drc-resumen').textContent = hallazgos.length === 0
		? 'El tablero pasa todas las reglas.'
		: `${errores} ${errores === 1 ? 'error' : 'errores'} y ${avisos} ${avisos === 1 ? 'aviso' : 'avisos'} `
			+ 'sobre el tablero tal como está ahora.';
	cont.innerHTML = '';
	if (hallazgos.length === 0) {
		cont.innerHTML = '<li class="vacio">✔ Sin errores ni avisos</li>';
	}
	for (const h of hallazgos) {
		const li = document.createElement('li');
		const marca = document.createElement('span');
		marca.className = 'marca';
		marca.textContent = h.severidad === 'error' ? '⛔' : '⚠️';
		const texto = document.createElement('div');
		texto.innerHTML = `${escaparHtml(h.mensaje)}<span class="regla">${escaparHtml(h.regla)}</span>`;
		li.append(marca, texto);
		// Saltar al elemento culpable: es lo que se quiere hacer nada más leer el hallazgo.
		const destino: Seleccion | undefined = h.dispositivoId
			? { tipo: 'dispositivo', id: h.dispositivoId }
			: h.conductorId ? { tipo: 'cable', id: h.conductorId } : undefined;
		if (destino) {
			li.className = 'clicable';
			li.onclick = () => {
				($('modal-drc') as HTMLElement).hidden = true;
				if (destino.tipo === 'cable') { aplicarModo('trabajo'); enfocarCamaraEnCable(destino.id); }
				aplicarSeleccion(destino);
			};
		}
		cont.appendChild(li);
	}
	($('modal-drc') as HTMLElement).hidden = false;
}

($('chip-drc') as HTMLButtonElement).onclick = () => abrirDetalleDRC();
($('btn-cerrar-drc') as HTMLButtonElement).onclick = () => { ($('modal-drc') as HTMLElement).hidden = true; };
$('modal-drc').addEventListener('click', (e) => {
	if (e.target === $('modal-drc')) ($('modal-drc') as HTMLElement).hidden = true;
});

/* ------------------------- Datos del proyecto ------------------------- */

/**
 * Cliente, obra, proyectista y revisión — más los dos datos de instalación de los que
 * depende que el programa pueda verificar el tablero: la Icc presunta (poder de corte) y
 * la temperatura ambiente (balance térmico).
 */
function abrirDatosProyecto(): void {
	const d = proyecto.datos ?? {};
	const o = opcionesDe(proyecto);
	const poner = (id: string, v: string) => { ($(id) as HTMLInputElement).value = v; };
	poner('pr-cliente', d.cliente ?? '');
	poner('pr-obra', d.obra ?? '');
	poner('pr-proyectista', d.proyectista ?? '');
	poner('pr-revision', d.revision ?? '');
	poner('pr-fecha', d.fecha ?? new Date().toISOString().slice(0, 10));
	poner('pr-fabricante', d.fabricante ?? '');
	poner('pr-icc', o.iccPresuntaKA ? String(o.iccPresuntaKA) : '');
	poner('pr-ambiente', String(o.temperaturaAmbienteC));
	poner('pr-inominal', o.corrienteAsignadaA ? String(o.corrienteAsignadaA) : '');
	poner('pr-frecuencia', String(o.frecuenciaHz));
	poner('pr-ip', o.gradoIP);
	($('pr-montaje') as HTMLSelectElement).value = o.montajeGabinete;
	($('pr-neutro') as HTMLSelectElement).value = o.regimenNeutro;
	($('pr-notas') as HTMLTextAreaElement).value = d.notas ?? '';
	($('modal-proyecto') as HTMLElement).hidden = false;
	setTimeout(() => ($('pr-cliente') as HTMLInputElement).focus(), 0);
}

function guardarDatosProyecto(): void {
	const texto = (id: string) => ($(id) as HTMLInputElement).value.trim() || undefined;
	const numero = (id: string) => {
		const v = Number(($(id) as HTMLInputElement).value);
		return Number.isFinite(v) && v >= 0 ? v : undefined;
	};
	capturar();
	proyecto.datos = {
		cliente: texto('pr-cliente'),
		obra: texto('pr-obra'),
		proyectista: texto('pr-proyectista'),
		revision: texto('pr-revision'),
		fecha: texto('pr-fecha'),
		fabricante: texto('pr-fabricante'),
		notas: ($('pr-notas') as HTMLTextAreaElement).value.trim() || undefined,
	};
	proyecto.opciones = {
		...(proyecto.opciones ?? {}),
		iccPresuntaKA: numero('pr-icc') ?? 0,
		temperaturaAmbienteC: numero('pr-ambiente') ?? 35,
		corrienteAsignadaA: numero('pr-inominal') ?? 0,
		frecuenciaHz: numero('pr-frecuencia') || 50,
		gradoIP: ($('pr-ip') as HTMLInputElement).value.trim(),
		montajeGabinete: ($('pr-montaje') as HTMLSelectElement).value as OpcionesProyecto['montajeGabinete'],
		regimenNeutro: ($('pr-neutro') as HTMLSelectElement).value as OpcionesProyecto['regimenNeutro'],
	};
	($('modal-proyecto') as HTMLElement).hidden = true;
	recalcular();      // la Icc cambia el DRC al instante
	pintarPaneles();
	refrescarEsquema();
	avisar('Datos del proyecto guardados', 'ok');
}

($('btn-datos-proyecto') as HTMLButtonElement).onclick = () => abrirDatosProyecto();
($('btn-cerrar-proyecto') as HTMLButtonElement).onclick = () => { ($('modal-proyecto') as HTMLElement).hidden = true; };
($('btn-cancelar-proyecto') as HTMLButtonElement).onclick = () => { ($('modal-proyecto') as HTMLElement).hidden = true; };
($('btn-guardar-proyecto') as HTMLButtonElement).onclick = () => guardarDatosProyecto();
$('modal-proyecto').addEventListener('click', (e) => {
	if (e.target === $('modal-proyecto')) ($('modal-proyecto') as HTMLElement).hidden = true;
});

/* ------------------------- Controlador a medida ------------------------- */

/**
 * Ningún catálogo tiene todos los controladores del mercado. Aquí se describe uno
 * cualquiera con los datos de su hoja: huella, fondo y qué bornera va en cada borde.
 * Con eso el mismo constructor 3D que dibuja los equipos del catálogo lo dibuja también,
 * con sus terminales en su sitio y listos para cablear.
 */
function abrirControladorAMedida(): void {
	($('ctrl-aviso') as HTMLElement).hidden = true;
	($('modal-controlador') as HTMLElement).hidden = false;
	setTimeout(() => ($('ctrl-fabricante') as HTMLInputElement).focus(), 0);
}

function cerrarControladorAMedida(): void {
	($('modal-controlador') as HTMLElement).hidden = true;
}

function crearControladorAMedida(): void {
	const texto = (id: string): string => ($(id) as HTMLInputElement).value.trim();
	const numero = (id: string, min: number): number => {
		const v = Math.round(Number(($(id) as HTMLInputElement).value));
		return Number.isFinite(v) && v >= min ? v : min;
	};
	const fallar = (mensaje: string): void => {
		const aviso = $('ctrl-aviso') as HTMLElement;
		aviso.textContent = mensaje;
		aviso.hidden = false;
	};

	const referencia = texto('ctrl-referencia');
	if (!referencia) { fallar('Escribe al menos el modelo o la referencia del equipo.'); return; }

	const LADOS: { id: string; lado: BloqueTerminales['lado']; rotulo: string; color: string }[] = [
		{ id: 'ctrl-arriba', lado: 'arriba', rotulo: 'Borde superior', color: '#3f8f4f' },
		{ id: 'ctrl-abajo', lado: 'abajo', rotulo: 'Borde inferior', color: '#c98b18' },
		{ id: 'ctrl-izquierda', lado: 'izquierda', rotulo: 'Borde izquierdo', color: '#c0392b' },
		{ id: 'ctrl-derecha', lado: 'derecha', rotulo: 'Borde derecho', color: '#2f7fb8' },
	];
	const bloques: BloqueTerminales[] = [];
	const usados = new Set<string>();
	for (const l of LADOS) {
		const rotulos = leerRotulos(texto(l.id)).filter((r) => !usados.has(r));
		if (rotulos.length === 0) continue;
		for (const r of rotulos) usados.add(r);
		bloques.push({ rotulo: l.rotulo, lado: l.lado, bornes: rotulos, color: l.color, extraible: true });
	}
	if (bloques.length === 0) { fallar('Escribe los terminales de al menos un borde.'); return; }

	const ancho = numero('ctrl-ancho', 10);
	const alto = numero('ctrl-alto', 10);
	// Si la huella no da para los terminales quedarían montados unos sobre otros: se agranda
	// lo justo y se avisa, en vez de dibujar algo que no se puede cablear.
	const minimo = huellaMinima({ id: '', tipo: 'plc', bornes: [], terminales: bloques }, 5);
	const anchoFinal = Math.max(ancho, minimo.ancho);
	const altoFinal = Math.max(alto, minimo.alto);

	const plantilla: PlantillaAparato = {
		id: `ctrl-medida-${Date.now().toString(36)}`,
		nombre: `${texto('ctrl-fabricante')} ${referencia}`.trim(),
		tipo: 'plc',
		grupo: 'Control',
		descripcion: texto('ctrl-descripcion') || `Controlador ${referencia}`,
		fabricante: texto('ctrl-fabricante') || 'Sin marca',
		referencia,
		tensionNominal: numero('ctrl-tension', 0) || undefined,
		ancho: anchoFinal,
		alto: altoFinal,
		profundidad: numero('ctrl-fondo', 5),
		color: '#3a4247',
		bornes: bloques.flatMap((b) => b.bornes.map((id: string) => ({ id, tipo: naturalezaTerminal(id) }))),
		terminales: bloques,
		rasgosFrente: { leds: 4, puertosIP: 1 },
	};

	cerrarControladorAMedida();
	colocarPlantilla(plantilla);
	const agrandado = anchoFinal !== ancho || altoFinal !== alto;
	avisar(agrandado
		? `${referencia} colocado · la huella se agrandó a ${anchoFinal}×${altoFinal} mm para que quepan sus ${plantilla.bornes.length} terminales`
		: `${referencia} colocado con sus ${plantilla.bornes.length} terminales`, 'ok');
}

($('btn-controlador-medida') as HTMLButtonElement).onclick = () => abrirControladorAMedida();
($('btn-cerrar-controlador') as HTMLButtonElement).onclick = () => cerrarControladorAMedida();
($('btn-cancelar-controlador') as HTMLButtonElement).onclick = () => cerrarControladorAMedida();
($('btn-crear-controlador') as HTMLButtonElement).onclick = () => crearControladorAMedida();
$('modal-controlador').addEventListener('click', (e) => {
	if (e.target === $('modal-controlador')) cerrarControladorAMedida();
});

/* --------------------- Ayuda, centrar vista y ejemplo --------------------- */

($('btn-centrar') as HTMLButtonElement).onclick = () => encuadrar();


($('btn-ayuda') as HTMLButtonElement).onclick = () => { ($('modal-ayuda') as HTMLElement).hidden = false; };
($('btn-cerrar-ayuda') as HTMLButtonElement).onclick = () => { ($('modal-ayuda') as HTMLElement).hidden = true; };
$('modal-ayuda').addEventListener('click', (e) => {
	if (e.target === $('modal-ayuda')) ($('modal-ayuda') as HTMLElement).hidden = true;
});

// Botones del diálogo in-app.
($('dialogo-ok') as HTMLButtonElement).onclick = () => {
	const input = $('dialogo-input') as HTMLInputElement;
	responderDialogo(input.hidden ? 'ok' : input.value);
};
($('dialogo-cancelar') as HTMLButtonElement).onclick = () => responderDialogo(null);
$('modal-dialogo').addEventListener('keydown', (e) => {
	const ev = e as KeyboardEvent;
	if (ev.key === 'Enter') { e.preventDefault(); ($('dialogo-ok') as HTMLButtonElement).click(); }
	if (ev.key === 'Escape') { e.preventDefault(); responderDialogo(null); }
});

/* ------------------- Biblioteca de tableros de ejemplo (para estudiar) ------------------- */

/** Abre un tablero de ejemplo y ofrece su explicación. */
function abrirEjemplo(ej: EjemploTablero): void {
	capturar();
	proyecto = ej.crear();
	numerarDispositivos(proyecto);
	aplicarSeleccion(undefined);
	bienvenidaDescartada = true;
	aplicarModo('trabajo'); // se abre listo para recorrer el cableado
	trasCambiarProyecto();
	encuadrar();
	($('modal-ejemplos') as HTMLElement).hidden = true;
	ejemploAbierto = ej;
	($('btn-explicacion') as HTMLElement).hidden = false; // queda a mano para releerla
	mostrarExplicacion(ej);
}

let ejemploAbierto: EjemploTablero | undefined;

/** Ventana con qué hace el tablero, cómo funciona y en qué fijarse. */
function mostrarExplicacion(ej: EjemploTablero): void {
	$('texto-explicacion').innerHTML = `
		<h2>${ej.titulo}</h2>
		<p><b>${ej.resumen}</b></p>
		<h3>Qué hace</h3>
		<p>${ej.queHace}</p>
		<h3>Cómo funciona, paso a paso</h3>
		<ol>${ej.comoFunciona.map((x) => `<li>${x}</li>`).join('')}</ol>
		<h3>Para estudiarlo en el 3D</h3>
		<ul>${ej.aprender.map((x) => `<li>${x}</li>`).join('')}</ul>
	`;
	($('modal-explicacion') as HTMLElement).hidden = false;
}

/** Pinta la biblioteca de ejemplos y la abre. */
function abrirBibliotecaEjemplos(): void {
	const cont = $('lista-ejemplos');
	cont.innerHTML = '';
	for (const ej of EJEMPLOS) {
		const div = document.createElement('div');
		div.className = 'tarjeta-ejemplo';
		div.innerHTML = `<h3>${ej.titulo}</h3><p>${ej.resumen}</p>`;
		const b = document.createElement('button');
		b.className = 'boton primario';
		b.textContent = 'Abrir y estudiar';
		b.onclick = () => abrirEjemplo(ej);
		div.appendChild(b);
		cont.appendChild(div);
	}
	// Tras los ejemplos, las plantillas que ha guardado el propio usuario.
	cont.insertAdjacentHTML('beforeend', pintarPlantillasPropias());
	for (const b of cont.querySelectorAll<HTMLButtonElement>('[data-plantilla]')) {
		b.onclick = () => abrirPlantilla(Number(b.dataset.plantilla));
	}
	for (const b of cont.querySelectorAll<HTMLButtonElement>('[data-borrar-plantilla]')) {
		b.onclick = () => { void borrarPlantilla(Number(b.dataset.borrarPlantilla)); };
	}
	($('modal-ejemplos') as HTMLElement).hidden = false;
}

/** Abre una plantilla guardada como si fuera un proyecto nuevo. */
function abrirPlantilla(indice: number): void {
	const p = plantillasGuardadas()[indice];
	if (!p) return;
	capturar();
	proyecto = structuredClone(p.proyecto);
	proyecto.nombre = p.nombre;
	ejemploAbierto = undefined;
	($('btn-explicacion') as HTMLElement).hidden = true;
	($('modal-ejemplos') as HTMLElement).hidden = true;
	seleccionExtra = [];
	aplicarSeleccion(undefined);
	trasCambiarProyecto();
	avisar(`Plantilla «${p.nombre}» abierta`, 'ok');
}

async function borrarPlantilla(indice: number): Promise<void> {
	const lista = plantillasGuardadas();
	const p = lista[indice];
	if (!p) return;
	if (!(await confirmar(`¿Eliminar la plantilla «${p.nombre}»?`, { ok: 'Eliminar', peligro: true }))) return;
	lista.splice(indice, 1);
	try { localStorage.setItem(CLAVE_PLANTILLAS, JSON.stringify(lista)); } catch { /* sin storage */ }
	abrirBibliotecaEjemplos();
	avisar('Plantilla eliminada', 'ok');
}

($('btn-empezar-ejemplo') as HTMLButtonElement).onclick = () => abrirBibliotecaEjemplos();
($('btn-ejemplos') as HTMLButtonElement).onclick = () => abrirBibliotecaEjemplos();
($('btn-explicacion') as HTMLButtonElement).onclick = () => { if (ejemploAbierto) mostrarExplicacion(ejemploAbierto); };
($('btn-cerrar-ejemplos') as HTMLButtonElement).onclick = () => { ($('modal-ejemplos') as HTMLElement).hidden = true; };
($('btn-cerrar-explicacion') as HTMLButtonElement).onclick = () => { ($('modal-explicacion') as HTMLElement).hidden = true; };
for (const id of ['modal-ejemplos', 'modal-explicacion']) {
	$(id).addEventListener('click', (e) => { if (e.target === $(id)) ($(id) as HTMLElement).hidden = true; });
}

// «Empezar en blanco»: cierra la tarjeta y deja el modo Editor listo para añadir aparatos.
($('btn-empezar-blanco') as HTMLButtonElement).onclick = () => {
	bienvenidaDescartada = true;
	aplicarModo('editor');
	($('bienvenida') as HTMLElement).hidden = true;
	encuadrar();
	avisar('Placa en blanco. Haz clic en un aparato del catálogo (izquierda) para colocarlo.', 'ok');
};

// Primera visita: abrir la guía automáticamente una sola vez.
try {
	if (!localStorage.getItem('tablerostudio-visto')) {
		($('modal-ayuda') as HTMLElement).hidden = false;
		localStorage.setItem('tablerostudio-visto', '1');
	}
} catch { /* sin localStorage */ }

function ajustarTamano(): void {
	const r = contenedor.getBoundingClientRect();
	camara.aspect = r.width / r.height;
	camara.updateProjectionMatrix();
	renderer.setSize(r.width, r.height);
}
window.addEventListener('resize', () => {
	ajustarTamano();
	if (encuadrePendiente) encuadrar();
	if (esquemaAbierto) aplicarZoomEsquema(); // la hoja se reajusta al nuevo tamaño de ventana
});
ajustarTamano();
encuadrar(); // ahora que el lienzo ya mide, el encuadre sale bien

/* ------------------------------- Arranque ------------------------------- */

// Buscador del catálogo: filtra según se escribe; Esc limpia y devuelve la lista completa.
{
	const buscador = $('buscar-catalogo') as HTMLInputElement;
	buscador.oninput = () => pintarCatalogo();
	buscador.onkeydown = (ev) => {
		ev.stopPropagation(); // que Supr/flechas no lleguen a los atajos del tablero mientras se escribe
		if (ev.key === 'Escape') { buscador.value = ''; pintarCatalogo(); buscador.blur(); }
	};
}

pintarCatalogo();
pintarPaneles();
pintarEstructura();
reconstruirCables();
reconstruirCotas();
aplicarModo('editor');
actualizarBotonesHistorial();

renderer.setAnimationLoop(() => {
	controles.update();
	renderer.render(escena, camara);
});

/*
 * Sonda de pruebas automáticas: solo se activa abriendo la página con «?qa=1», así las
 * pruebas de regresión pueden localizar bornes y cables en pantalla sin barrer píxeles.
 * No existe para el usuario final (sin el parámetro, no se define nada).
 */
// __QA__ lo sustituye el empaquetador: es `true` solo cuando se construye para las pruebas
// (QA=1). En el build que se entrega vale `false`, el minificador borra TODO este bloque y la
// aplicación no lleva dentro el andamiaje ni lo expone en `window`.
if (__QA__ && new URLSearchParams(location.search).has('qa')) {
	const aPantalla = (v: THREE.Vector3): { x: number; y: number } => {
		const r = renderer.domElement.getBoundingClientRect();
		const p = v.clone().project(camara);
		return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
	};
	(window as unknown as Record<string, unknown>).qa = {
		/** Bornes clicables con su posición en pantalla. */
		bornes: () => escenario.bornes.children.map((m) => ({
			dispositivo: m.userData.borneDispositivoId as string,
			borne: m.userData.borneId as string,
			...aPantalla(m.getWorldPosition(new THREE.Vector3())),
		})),
		/** Nº de cables realmente dibujados en 3D (para detectar «cables fantasma»). */
		cablesDibujados: () => new Set(
			escenario.cables.children.flatMap((g) => g.children.map((m) => m.userData.conductorId as string)).filter(Boolean),
		).size,
		/**
		 * Puntos del cable que el usuario VE de verdad: aquellos en los que, al disparar un rayo
		 * desde la cámara, lo primero que se encuentra es el propio cable (no un aparato delante).
		 * Es la definición honesta de «se puede pinchar aquí».
		 */
		puntosVisiblesDeCable: (id: string, muestras = 15) => {
			const malla = escenario.cables.children
				.flatMap((g) => g.children)
				.find((m) => m.userData.conductorId === id) as THREE.Mesh | undefined;
			if (!malla) return [];
			const r = renderer.domElement.getBoundingClientRect();
			const pos = malla.geometry.getAttribute('position');
			const out: { x: number; y: number }[] = [];
			for (let k = 1; k < muestras; k++) {
				const i = Math.round((k * (pos.count - 1)) / muestras);
				const mundo = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(malla.matrixWorld);
				const p = aPantalla(mundo);
				puntero.set(((p.x - r.left) / r.width) * 2 - 1, -((p.y - r.top) / r.height) * 2 + 1);
				raycaster.setFromCamera(puntero, camara);
				const impactos = raycaster.intersectObjects(
					[...escenario.cables.children, ...escenario.dispositivos.children], true,
				).filter((h) => h.object.userData.tuboVisible || h.object.userData.dispositivoId);
				// Solo cuenta si lo primero que se ve es el TUBO VISIBLE de este cable: el tubo
				// grueso de agarre es invisible y no sirve para decir «aquí se ve el cable».
				if (impactos[0]?.object.userData.conductorId === id) out.push(p);
			}
			return out;
		},
		/** Puntos en pantalla repartidos A LO LARGO del tubo de un cable, para poder pincharlo. */
		puntosDeCable: (id: string, muestras = 9) => {
			const malla = escenario.cables.children
				.flatMap((g) => g.children)
				.find((m) => m.userData.conductorId === id) as THREE.Mesh | undefined;
			if (!malla) return [];
			const pos = malla.geometry.getAttribute('position');
			const out: { x: number; y: number }[] = [];
			for (let k = 1; k < muestras; k++) {
				const i = Math.round((k * (pos.count - 1)) / muestras);
				const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(malla.matrixWorld);
				out.push(aPantalla(v));
			}
			return out;
		},
		/** Qué hay seleccionado ahora mismo (para distinguir a quién agarró un clic). */
		seleccion: () => (sel ? { tipo: sel.tipo, id: sel.id } : undefined),
		/** Selecciona un aparato por id, como si se hubiera pinchado en él. */
		seleccionarPorId: (id: string) => seleccionar(id),
		/** Añade un aparato a la selección múltiple, como haría un Shift+clic. */
		anadirASeleccion: (id: string) => { construyendoSeleccion = true; alternarEnSeleccion(id); construyendoSeleccion = false; },
		/** Resumen del esquema montado ahora mismo (para comprobar que no pierde aparatos). */
		esquema: () => montarEsquema(proyecto, potenciales).map((h) => ({
			numero: h.numero,
			aparatos: h.simbolos.map((s) => s.dispositivoId),
			fuera: h.simbolos.filter((s) => s.x < 0 || s.y < 0
				|| s.x + s.ancho > h.anchoMm || s.y + s.alto > h.altoMm).length,
		})),
		/** Punto en pantalla del tirador de una unión del cable (para poder arrastrarla). */
		puntoDeUnion: (conductorId: string, indice = 0) => {
			const c = proyecto.conductores.find((x) => x.id === conductorId);
			const w = c?.trazado?.[indice];
			if (!w) return undefined;
			const v = aPantalla(escenario.aEscena(w.x, w.y, Z_HANDLE_CABLE));
			return { x: Math.round(v.x), y: Math.round(v.y) };
		},
		/** Estado de las tapas de canaleta (para comprobar que en Visualización son opacas). */
		tapas: () => escenario.tapas.map((t) => {
			const m = (t as THREE.Mesh).material as THREE.MeshStandardMaterial;
			return { transparente: !!m.transparent, opacidad: m.opacity };
		}),
		/** Punto de pantalla dentro de una imagen de referencia, en coordenadas relativas (-0.5..0.5). */
		puntoDeImagen: (dispositivoId: string, dx: number, dy: number) => {
			const col = proyecto.gabinete?.colocaciones.find((c) => c.dispositivoId === dispositivoId);
			if (!col) return undefined;
			const v = aPantalla(escenario.aEscena(col.x + col.ancho * (0.5 + dx), col.y + col.alto * (0.5 + dy), 12));
			return { x: Math.round(v.x), y: Math.round(v.y) };
		},
		/** Hallazgos del DRC en vivo (para comprobar las reglas eléctricas). */
		hallazgos: () => hallazgos,
		/** Fuerza un recálculo completo (tras tocar el proyecto desde la prueba). */
		recalcular: () => actualizarTodo(),
		/** Estado de la interacción (para diagnosticar un clic que se fue por otro camino). */
		estadoInteraccion: () => ({
			modo,
			modoPin,
			cableando: cableandoDesde ? `${cableandoDesde.dispositivoId}.${cableandoDesde.borneId}` : undefined,
			arrastrando,
			tirador: !!handleArrastrado,
			bornesVisibles: escenario.bornes.visible,
		}),
		/** Cuántos píxeles de pantalla equivale un milímetro del modelo en la vista actual. */
		escalaPantalla: () => {
			const a = aPantalla(escenario.aEscena(0, 0, 30));
			const b = aPantalla(escenario.aEscena(100, 100, 30));
			return { porMmX: (b.x - a.x) / 100, porMmY: (b.y - a.y) / 100 };
		},
		/**
		 * Punto en pantalla de un tramo LIBRE de un riel o canaleta (sin aparatos encima), que es
		 * por donde se agarra de verdad para moverlo.
		 */
		puntoDeEstructura: (tipo: 'riel' | 'canaleta', id: string) => {
			const g = proyecto.gabinete;
			const e = tipo === 'riel' ? g?.rieles.find((r) => r.id === id) : g?.canaletas.find((c) => c.id === id);
			if (!g || !e) return undefined;
			const vertical = e.orientacion === 'v';
			const clave = tipo === 'riel' ? 'rielId' : 'canaletaId';
			const r = renderer.domElement.getBoundingClientRect();
			for (let t = 6; t <= e.largo - 6; t += 4) {
				const x = vertical ? e.x + 20 : e.x + t;
				const y = vertical ? e.y + t : e.y + 20;
				const p = aPantalla(escenario.aEscena(x, y, 30));
				// Solo vale si en ese píxel lo primero que se ve es el propio perfil (no un aparato).
				puntero.set(((p.x - r.left) / r.width) * 2 - 1, -((p.y - r.top) / r.height) * 2 + 1);
				raycaster.setFromCamera(puntero, camara);
				const golpe = raycaster.intersectObjects(escenario.raiz.children, true)
					.find((h) => h.object.userData[clave] || h.object.userData.dispositivoId);
				if (golpe?.object.userData[clave] === id) return p;
			}
			return undefined; // el perfil está totalmente cubierto de aparatos
		},
		/**
		 * Cuánto van MONTADOS unos cables sobre otros (mm de tramos paralelos que se pisan).
		 * Es la medida de «cables amontonados»: en un tablero bien ruteado ronda cero.
		 */
		amontonamiento: () => {
			const rutas = rutasDeCables(proyecto);
			let total = 0;
			let pares = 0;
			for (let i = 0; i < rutas.length; i++) {
				for (let j = i + 1; j < rutas.length; j++) {
					const mm = longitudSolapada(rutas[i].nodos, rutas[j].nodos);
					if (mm > 0) { total += mm; pares++; }
				}
			}
			return { totalMm: Math.round(total), pares, cables: rutas.length };
		},
		/** Recorrido resuelto de cada cable (mm de modelo), tal cual se dibuja. */
		rutas: () => rutasDeCables(proyecto).map((r) => ({ id: r.conductorId, nodos: r.nodos })),
		/**
		 * Punto de pantalla donde el propio programa agarraría ESE cable: se comprueba en la misma
		 * pasada que el rayo cae en su tubo visible y que ningún borne se le pone delante. Así la
		 * prueba pincha donde el usuario lo haría, sin depender del instante en que se calculó.
		 */
		// Se muestrea generoso: descartar los cruces deja fuera bastantes puntos, y hace falta
		// recorrer el cable entero para encontrar un tramo suyo y solo suyo.
		puntoParaAgarrar: (id: string, muestras = 31, zona?: { x0: number; x1: number; y0: number; y1: number }) => {
			const malla = escenario.cables.children
				.flatMap((g) => g.children)
				.find((m) => m.userData.tuboVisible && m.userData.conductorId === id) as THREE.Mesh | undefined;
			if (!malla) return undefined;
			const r = renderer.domElement.getBoundingClientRect();
			const pos = malla.geometry.getAttribute('position');
			for (let k = 1; k < muestras; k++) {
				const i = Math.round((k * (pos.count - 1)) / muestras);
				const mundo = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(malla.matrixWorld);
				// El navegador entrega los clics en píxeles ENTEROS: se comprueba el punto ya
				// redondeado, para no dar por bueno un píxel que en realidad cae en el borde del tubo.
				const v = aPantalla(mundo);
				const p = { x: Math.round(v.x), y: Math.round(v.y) };
				// Si se pide una zona (p. ej. el lienzo sin los paneles), solo valen puntos de dentro.
				if (zona && (p.x < zona.x0 || p.x > zona.x1 || p.y < zona.y0 || p.y > zona.y1)) continue;
				puntero.set(((p.x - r.left) / r.width) * 2 - 1, -((p.y - r.top) / r.height) * 2 + 1);
				raycaster.setFromCamera(puntero, camara);
				const impactosCable = raycaster.intersectObjects(escenario.cables.children, true);
				const cable = impactosCable.find((h) => h.object.userData.tuboVisible);
				if (cable?.object.userData.conductorId !== id) continue;
				// Y que no sea un CRUCE: si otro cable pasa prácticamente a la misma profundidad,
				// ese píxel no pertenece a ninguno de los dos en particular. Ahí ni el programa ni
				// el usuario pueden decir cuál se está señalando, así que no vale como punto de
				// agarre y se prueba el siguiente. Un electricista tampoco pincha en el cruce.
				const otroPegado = impactosCable.some((h) => h.object.userData.conductorId !== id
					&& Math.abs(h.distance - cable.distance) < 8);
				if (otroPegado) continue;
				const aparato = raycaster.intersectObjects(escenario.dispositivos.children, true)
					.find((h) => h.object.userData.dispositivoId);
				if (aparato && aparato.distance < cable.distance) continue; // tapado por un aparato
				// Tampoco vale si encima hay un tirador de otra unión: ahí lo que se ve es el tirador.
				if (raycaster.intersectObjects(escenario.handles.children, true).some((h) => h.distance < cable.distance)) continue;
				// Ni si delante hay un BORNE: ahí el programa entiende —bien— que quieres conectar,
				// no agarrar el cable, y así lo dice `cableTapaAlBorne`. Es la comprobación simétrica
				// de la que hace `puntoParaBorne` con los cables; faltaba aquí, y por eso la prueba
				// pinchaba en un terminal creyendo que pinchaba en un cable.
				if (raycaster.intersectObjects(escenario.bornes.children, true)
					.some((h) => h.object.userData.borneId && h.distance < cable.distance)) continue;
				return p;
			}
			return undefined;
		},
		/**
		 * Píxel donde ESE borne es lo primero que se ve (ni cable ni aparato delante): el sitio
		 * donde pincharía quien quiere conectar ahí. Devuelve undefined si está totalmente tapado.
		 */
		puntoParaBorne: (dispositivoId: string, borneId: string) => {
			const esfera = escenario.bornes.children.find(
				(m) => m.userData.borneDispositivoId === dispositivoId && m.userData.borneId === borneId,
			);
			if (!esfera) return undefined;
			const r = renderer.domElement.getBoundingClientRect();
			const centro = new THREE.Vector3().setFromMatrixPosition(esfera.matrixWorld);
			const radio = 4.2 * (esfera.scale.x || 1);
			// Se prueba el centro y, si un cable lo cruza, unos puntos alrededor del propio punto.
			const alrededor: [number, number][] = [[0, 0], [0, -0.7], [0, 0.7], [-0.7, 0], [0.7, 0], [-0.5, -0.5], [0.5, 0.5]];
			for (const [dx, dy] of alrededor) {
				const v = aPantalla(new THREE.Vector3(centro.x + dx * radio, centro.y + dy * radio, centro.z));
				const p = { x: Math.round(v.x), y: Math.round(v.y) };
				puntero.set(((p.x - r.left) / r.width) * 2 - 1, -((p.y - r.top) / r.height) * 2 + 1);
				raycaster.setFromCamera(puntero, camara);
				const b = raycaster.intersectObjects(escenario.bornes.children, true).find((h) => h.object.userData.borneId);
				if (b?.object !== esfera) continue;
				const cable = raycaster.intersectObjects(escenario.cables.children, true)
					.find((h) => h.object.userData.tuboVisible);
				if (cable && cable.distance < b.distance) continue; // hay un cable por delante
				const aparato = raycaster.intersectObjects(escenario.dispositivos.children, true)
					.find((h) => h.object.userData.dispositivoId);
				if (aparato && aparato.distance < b.distance) continue;
				return p;
			}
			return undefined;
		},
		/** Todo lo que hay bajo un píxel, en orden de cercanía (para diagnosticar un clic perdido). */
		diagnosticoPixel: (x: number, y: number) => {
			const r = renderer.domElement.getBoundingClientRect();
			puntero.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
			raycaster.setFromCamera(puntero, camara);
			const tirador = raycaster.intersectObjects(escenario.handles.children, true)[0];
			const borne = raycaster.intersectObjects(escenario.bornes.children, true).find((h) => h.object.userData.borneId);
			const marca = [
				...(tirador ? [`TIRADOR@${tirador.distance.toFixed(1)}`] : []),
				...(borne ? [`BORNE:${borne.object.userData.borneDispositivoId}.${borne.object.userData.borneId}@${borne.distance.toFixed(1)}`] : []),
			];
			return marca.concat(raycaster.intersectObjects(escenario.raiz.children, true).slice(0, 8).map((h) => {
				const u = h.object.userData;
				const que = u.tuboVisible ? 'cable' : u.tuboAgarre ? 'agarre' : u.borneId ? 'borne'
					: u.dispositivoId ? 'aparato' : u.canaletaId ? 'canaleta' : u.rielId ? 'riel'
					: u.handle ? 'tirador' : 'otro';
				return `${que}:${u.conductorId ?? u.borneId ?? u.dispositivoId ?? u.canaletaId ?? u.rielId ?? ''}@${h.distance.toFixed(1)}`;
			}));
		},
		/** Qué cable elegiría un clic en ese píxel de pantalla (misma lógica que la selección real). */
		cableEnPixel: (x: number, y: number) => {
			const r = renderer.domElement.getBoundingClientRect();
			puntero.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
			raycaster.setFromCamera(puntero, camara);
			const impactos = raycaster.intersectObjects(escenario.cables.children, true);
			const visto = impactos.find((i) => i.object.userData.tuboVisible)?.object.userData.conductorId;
			return (visto ?? impactos.find((i) => i.object.userData.conductorId)?.object.userData.conductorId) as string | undefined;
		},
		/** Coste en ms de añadir N aparatos del catálogo (solo JS, sin dibujado). */
		medirAnadir: (plantillaId: string, veces: number) => {
			const t = performance.now();
			for (let i = 0; i < veces; i++) anadirDesdeCatalogo(plantillaId);
			return Math.round((performance.now() - t) / veces);
		},
		/** Dónde cae en pantalla un punto del modelo (para comprobar el encuadre). */
		puntoEnPantalla: (x: number, y: number, z = 0) => aPantalla(escenario.aEscena(x, y, z)),
		/**
		 * Posición y objetivo de la cámara. Los controles llevan amortiguación, así que después
		 * de soltar el ratón la cámara SIGUE moviéndose sola unos cuantos fotogramas. Una prueba
		 * que calcule un píxel y pinche ahí sin esperar a que se pare estaría apuntando a una
		 * escena y pinchando en otra: con esto puede esperar a que se quede quieta.
		 */
		camara: () => ({
			x: camara.position.x, y: camara.position.y, z: camara.position.z,
			tx: controles.target.x, ty: controles.target.y, tz: controles.target.z,
		}),
		/** Punto de anclaje (mm de modelo) de un borne, tal cual lo usa el cableado. */
		anclaje: (dispositivoId: string, borneId: string) => anclajeBorne(proyecto, dispositivoId, borneId),
		/** Referencias de los controladores del catálogo (equipos reales con ficha de datos). */
		controladores: () => CONTROLADORES.map((c) => c.referencia),
		/** Tiende un cable entre dos bornes sin pasar por el ratón (para probar el cableado). */
		conectar: (deId: string, deBorne: string, aId: string, aBorne: string) => {
			iniciarCableado({ dispositivoId: deId, borneId: deBorne });
			completarCableado({ dispositivoId: aId, borneId: aBorne });
		},
		proyecto: () => proyecto,
	};
}
