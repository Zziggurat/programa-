/**
 * TableroStudio — Editor 3D del gabinete.
 *
 * Configurador completo: catálogo de aparatos, arrastre con anclaje a riel, cableado
 * desde el panel de propiedades, estructura editable (placa, rieles, canaletas),
 * guardar/abrir proyecto, exportación del dossier técnico y verificación eléctrica
 * en vivo. Todo apoyado en los motores del núcleo (src/motores).
 *
 * Lo que NO está aquí, porque salió a su propio módulo: la vista previa del dossier
 * (`ui-dossier.ts`), la ventana de inicio con los ejemplos y las plantillas propias
 * (`ui-inicio.ts`), el plano de mando y potencia (`ui-esquema.ts`) y el modo Energizar
 * (`ui-simulacion.ts`). Ninguno importa nada de este archivo: se les pasa lo que necesitan
 * al instalarlos, y siempre como función, para que no dependan del orden de arranque.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { BloqueTerminales, CLASE_POR_TIPO, Colocacion, Conductor, Dispositivo, OpcionesProyecto, Proyecto } from '../src/modelo/tipos.js';
import { crearProyecto, declarado, extremoTexto, opcionesDe } from '../src/modelo/proyecto.js';
import {
	AjustesDossier, BloqueDossier, FUENTES, SECCIONES_DOSSIER, TAMANOS, TrozoTexto, saleSeccion,
} from '../src/modelo/dossier.js';
import { leerPrograma } from '../src/motores/logica.js';
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
	Z_IMAGEN_FONDO, Z_IMAGEN_FRENTE,
} from './escena3d.js';
import { PLANTILLAS, PlantillaAparato, crearDesdePlantilla } from './catalogo.js';
import { CONTROLADORES, naturalezaTerminal } from './controladores.js';
import { huellaMinima, leerRotulos } from '../src/motores/terminales.js';
import { calcularBalanceTermico } from '../src/motores/termico.js';
import { comoSeConecta } from './como-se-conecta.js';
import {
	avisar, confirmar, descargar, escaparHtml, nombreSeguroDeArchivo, pedirTexto,
} from './dialogos.js';
import { instalarDossier } from './ui-dossier.js';
import { instalarInicio } from './ui-inicio.js';
import { instalarEsquema } from './ui-esquema.js';
import { instalarSimulacion } from './ui-simulacion.js';
import { montarEsquema, posicionesEnEsquema } from '../src/motores/esquema.js';
import { dxfDePlaca, exportarEtiquetasPDF } from './exportaciones.js';
import { distPuntoSegmento, longitudSolapada, orthogonalize, redondearEsquinas } from './geometria-cables.js';

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
		// Y por qué canaleta va cada uno: con eso la coordinación cuenta los circuitos que se
		// calientan entre ellos y corrige la intensidad admisible, que dentro de un armario nunca
		// es la de la tabla.
		canaletasPorConductor: new Map(ruteo.rutas.map((r) => [r.conductorId, r.canaletasUsadas])),
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
	// El texto del chip cambia de ancho, así que puede ser justo lo que haga que los rótulos de
	// los botones dejen de caber.
	ajustarRotulosBarra();
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

/**
 * Tira la última `capturar()` si la acción NO llegó a cambiar nada.
 *
 * Alinear lo que ya está alineado, o repartir lo que ya está repartido, dejaba igualmente su foto
 * en la pila, y el siguiente Ctrl+Z se la comía sin que se moviera nada en pantalla: parecía que
 * deshacer estaba roto. Se quita aquí, en el sitio donde se sabe si hubo cambio o no, y NO en
 * `deshacer()`: saltando fotos al deshacer se encadenarían varias acciones seguidas y una sola
 * pulsación podría llevarse por delante el proyecto entero.
 */
function descartarCapturaSiIgual(): void {
	if (pila.length === 0 || pila[pila.length - 1] !== JSON.stringify(proyecto)) return;
	pila.pop();
	actualizarBotonesHistorial();
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
const nieblaEscena = new THREE.Fog(0x171a1d, 2200, 4200);
escena.fog = nieblaEscena;

/*
 * El plano cercano NO es un detalle. La precisión del buffer de profundidad se reparte de forma
 * hiperbólica: con `near` a 1 mm y la cámara a 2 m —la distancia normal para ver un tablero
 * entero— apenas se distinguen 0,25 mm, y todo lo que va pegado a la cara de un aparato (rótulos,
 * mirillas, tapas) se turnaba fotograma a fotograma con la cara de detrás. De ahí el parpadeo.
 * Subiéndolo a 25 mm la precisión a esa misma distancia mejora unas 25 veces, y como la órbita
 * no deja acercarse a menos de 220 mm del tablero, nada queda cortado por delante.
 */
const camara = new THREE.PerspectiveCamera(42, 1, 25, 8000);

const controles = new OrbitControls(camara, renderer.domElement);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.minDistance = 220;
controles.maxDistance = 6000;
// La cámara se mantiene SIEMPRE por delante del tablero, como en un configurador profesional:
// se puede girar de lado a lado y mirar desde arriba o abajo, pero nunca pasar por detrás
// (donde todo se ve espejado, los cables quedan tapados por la caja y no hay forma de trabajar).
controles.minAzimuthAngle = -Math.PI * 0.42;
controles.maxAzimuthAngle = Math.PI * 0.42;
controles.minPolarAngle = Math.PI * 0.10;
controles.maxPolarAngle = Math.PI * 0.80;

/*
 * ------------------------------ VISTA 2D ------------------------------
 *
 * Petición del compañero: «si la caja se pudiera ver en 2D». No es un capricho — el alzado es
 * como se lee un tablero en papel: mirando la placa de frente, con las medidas a escala y sin
 * perspectiva. En 3D, un aparato que sobresale 120 mm sale más grande que su vecino y no se
 * puede comparar de un vistazo.
 *
 * Por eso es una cámara ORTOGRÁFICA de verdad y no la de siempre puesta de frente: en ortográfica
 * dos aparatos del mismo ancho se dibujan del mismo ancho, estén al fondo o en punta. Se le quita
 * el giro (un alzado que se puede inclinar deja de ser un alzado) y se dejan el desplazamiento y
 * el zoom, que sí hacen falta para mirar un rincón de cerca.
 */
const camaraOrto = new THREE.OrthographicCamera(-500, 500, 500, -500, 10, 9000);
camaraOrto.position.set(0, 0, 3000);
const controlesOrto = new OrbitControls(camaraOrto, renderer.domElement);
controlesOrto.enableRotate = false;
controlesOrto.enableDamping = true;
controlesOrto.dampingFactor = 0.08;
controlesOrto.enabled = false;
// Sin giro, el botón izquierdo tiene que servir para lo único que queda: desplazar la hoja.
controlesOrto.mouseButtons = {
	LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN,
};

let vista2D = false;
/** La cámara con la que se dibuja y se pincha ahora mismo. */
function camaraViva(): THREE.Camera { return vista2D ? camaraOrto : camara; }

/**
 * Suelta o bloquea la cámara QUE MANDA AHORA. Mientras se arrastra un cable, un aparato o una
 * cota, la cámara tiene que quedarse quieta.
 *
 * Va por función y no tocando `controles` directamente porque hay DOS juegos de controles. Al
 * añadir el alzado se seguía bloqueando solo el de la perspectiva, así que en 2D —donde el botón
 * izquierdo desplaza la hoja— arrastrar una unión de cable movía la vista entera en vez del punto.
 */
function permitirOrbita(permitir: boolean): void {
	(vista2D ? controlesOrto : controles).enabled = permitir;
}

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

/**
 * Deja el suelo justo debajo de LO MÁS BAJO QUE HAY DIBUJADO.
 *
 * Antes se calculaba con la altura de la placa (`g.alto`), que no es la del tablero: la caja
 * envolvente es una medida aparte —se puede pedir una envolvente de 2,40 m sobre una placa de
 * 0,58 m— y va centrada en la placa, así que sobresale por abajo la mitad de la diferencia. Al
 * agrandar la caja, el tablero atravesaba la rejilla.
 *
 * Y tampoco basta con la altura de la caja: por debajo de ella cuelgan cosas —el marco de la
 * puerta, los prensaestopas, los aparatos de campo— que ninguna fórmula recoge. Así que no se
 * calcula: se MIDE la escena montada. Cualquier pieza que se añada mañana queda cubierta sola.
 */
function asentarSuelo(): void {
	const bajo = new THREE.Box3().setFromObject(escenario.raiz).min.y;
	suelo.position.y = (Number.isFinite(bajo) ? bajo : -cajaDe(proyecto.gabinete!).alto / 2) - 40;
}

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

	// El alzado se encuadra por su cuenta: en ortográfica el tamaño no lo da la distancia
	// sino el ancho del marco, y hay que respetar la proporción del lienzo para no deformar
	// el tablero (un tablero deformado en un alzado es un plano que miente).
	const marcoAlto = Math.max(altoMundo, (anchoMundo * alto) / anchoVisible) / 2;
	const marcoAncho = (marcoAlto * lienzo.clientWidth) / alto;
	camaraOrto.left = -marcoAncho;
	camaraOrto.right = marcoAncho;
	camaraOrto.top = marcoAlto;
	camaraOrto.bottom = -marcoAlto;
	camaraOrto.position.set(-desvio, 0, 3000);
	camaraOrto.updateProjectionMatrix();
	controlesOrto.target.set(-desvio, 0, 0);
	controlesOrto.update();

	asentarSuelo();
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
	asentarSuelo();
}

/** Recalcula, reconstruye y repinta todo (tras un cambio estructural). */
function actualizarTodo(): void {
	recalcular();
	montarEscenario();
	pintarPaneles();
	pintarSeleccion();
	panelEsq.refrescar(); // si el esquema está abierto, se redibuja: es la misma verdad, otra vista
	panelSim.recalcular(); // rehacer la escena borra el brillo: se vuelve a pintar lo que está vivo
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
	panelEsq.refrescar();
	panelSim.recalcular();
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

/** Nombre de archivo seguro a partir del nombre del proyecto. */
function nombreArchivo(): string {
	// La limpieza de verdad la hace `descargar()`; aquí solo se compone el nombre visible.
	return nombreSeguroDeArchivo(proyecto.nombre);
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
		// La ficha eléctrica en el tooltip: así se elige el aparato correcto sin colocarlo antes.
		const ficha = [
			p.corrienteNominal !== undefined ? `In ${p.corrienteNominal} A` : '',
			p.curvaDisparo ? `curva ${p.curvaDisparo}` : '',
			p.rangoRegulacionA ? `regulable ${p.rangoRegulacionA[0]}–${p.rangoRegulacionA[1]} A` : '',
			p.sensibilidadMA ? `${p.sensibilidadMA} mA${p.claseDiferencial ? ` clase ${p.claseDiferencial}` : ''}` : '',
			p.poderCorteKA !== undefined ? `Icu ~${p.poderCorteKA} kA` : '',
			p.disipacionW !== undefined ? `disipa ~${p.disipacionW} W` : '',
		].filter(Boolean).join(' · ');
		btn.title = `${p.descripcion}\n${p.fabricante} ${p.referencia} · ${p.ancho}×${p.alto}${fondo} mm`
			+ (ficha ? `\n${ficha}` : '')
			+ (p.poderCorteKA !== undefined || p.disipacionW !== undefined
				? '\n(~ = valor corriente de la familia; corrígelo con la hoja de datos)' : '')
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
	/*
	 * Los aparatos de CAMPO (la red, el motor, la ampolleta) no van sobre la placa: viven fuera
	 * del tablero y lo que se ve de ellos es el prensaestopas por el que sale su cable. Así que
	 * no buscan hueco ni riel — solo entran al proyecto, y el dibujo los saca por el borde.
	 */
	if (plantilla.campo) {
		capturar();
		const dc = crearDesdePlantilla(plantilla, proyecto);
		dc.hojaId = proyecto.hojas[0]?.id;
		dc.posicion = { x: proyecto.dispositivos.length % 10, y: Math.floor(proyecto.dispositivos.length / 10) };
		proyecto.dispositivos.push(dc);
		actualizarTodo();          // cambian todos los prensaestopas: se reparten a lo ancho
		seleccionar(dc.id);
		avisar(`${dc.designacion ?? plantilla.nombre} entra por un prensaestopas del borde inferior. `
			+ 'Cablea sus bornes desde el panel de la derecha.', 'ok');
		return;
	}

	const hueco = buscarHueco(plantilla.ancho, plantilla.alto);
	if (!hueco) {
		avisar('Añade primero un riel DIN (panel «Gabinete y estructura» → + Riel)', 'error');
		return;
	}
	// Si ya había uno pegado al ratón, se suelta donde esté antes de sacar el siguiente.
	if (colocando) soltarColocacion();
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
	colocando = { id: d.id };
	renderer.domElement.style.cursor = 'copy';
	$('ayuda').textContent = `📦 ${d.designacion ?? plantilla.nombre} va pegado al ratón — `
		+ 'muévelo por la placa y haz clic para soltarlo · Esc lo cancela.';
}

/**
 * COLOCAR DONDE ESTÁ EL RATÓN, no siempre en el primer hueco del riel de arriba.
 *
 * Al pinchar en el catálogo el aparato nace pegado al puntero y va siguiéndolo por la placa,
 * pegándose al riel más cercano, hasta que un clic lo suelta. Antes todo caía en el mismo sitio
 * y había que arrastrarlo desde allí uno por uno.
 *
 * El aparato ya existe en el proyecto mientras se coloca —así se ve de verdad, con su tamaño y
 * su color, en vez de una silueta—; si se cancela con Esc, se quita.
 */
let colocando: { id: string } | undefined;

/** Lleva el aparato que se está colocando al punto del ratón, pegado al riel más cercano. */
function moverColocacionAlCursor(ev: MouseEvent): void {
	if (!colocando) return;
	const g = proyecto.gabinete!;
	const col = g.colocaciones.find((c) => c.dispositivoId === colocando!.id);
	const p = puntoModelo(ev);
	if (!col || !p) return;
	const snap = snapAriel(p.x, p.y, col.ancho, col.alto);
	const cx = snap ? snap.cx : p.x;
	const cy = snap ? snap.cy : p.y;
	col.rielId = snap?.rielId;
	col.x = Math.min(Math.max(Math.round(cx - col.ancho / 2), 0), g.ancho - col.ancho);
	col.y = Math.min(Math.max(Math.round(cy - col.alto / 2), 0), g.alto - col.alto);
	const c = escenario.aEscena(col.x + col.ancho / 2, col.y + col.alto / 2, 0);
	grupoDe(colocando.id)?.position.set(c.x, c.y, 0);
	// Rojo si cae encima de otro aparato: se ve antes de soltar, no después.
	const choca = solapaCon(col.x, col.y, col.ancho, col.alto, colocando.id);
	for (const m of resaltados) m.emissive.setHex(choca ? 0xff3b3b : 0x1d4ed8);
}

/** Suelta el aparato donde esté. Si choca con otro, no se suelta y se avisa. */
function soltarColocacion(): boolean {
	if (!colocando) return false;
	const col = proyecto.gabinete!.colocaciones.find((c) => c.dispositivoId === colocando!.id);
	if (col && solapaCon(col.x, col.y, col.ancho, col.alto, colocando.id)) {
		avisar('Ahí se encima con otro aparato: busca un hueco libre.', 'error');
		return true;   // sigue pegado al ratón
	}
	const id = colocando.id;
	colocando = undefined;
	renderer.domElement.style.cursor = '';
	const rielTocado = col ? extenderRielPara(col) : undefined;
	if (rielTocado) reconstruirEstructuraUno({ tipo: 'riel', id: rielTocado });
	actualizarConservandoAparatos();
	seleccionar(id);
	$('ayuda').textContent = '';
	return true;
}

/** Cancela la colocación en curso y quita el aparato recién sacado del catálogo. */
function cancelarColocacion(): void {
	if (!colocando) return;
	const id = colocando.id;
	colocando = undefined;
	renderer.domElement.style.cursor = '';
	proyecto.dispositivos = proyecto.dispositivos.filter((d) => d.id !== id);
	proyecto.gabinete!.colocaciones = proyecto.gabinete!.colocaciones.filter((c) => c.dispositivoId !== id);
	aplicarSeleccion(undefined);
	actualizarTodo();
	$('ayuda').textContent = '';
	avisar('Colocación cancelada.', 'info');
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
			${d.tipo === 'bornero' ? `<label>Nº de bornas<input id="dev-bornas" type="number" step="1" min="1" max="60" value="${d.bornes.length}"></label>` : ''}
			${col ? `<label>Ancho (mm)<input id="dev-ancho" type="number" step="1" min="5" value="${Math.round(col.ancho)}"></label>
			<label>Alto (mm)<input id="dev-alto" type="number" step="1" min="5" value="${Math.round(col.alto)}"></label>` : ''}
			<label>Fondo (mm)<input id="dev-fondo" type="number" step="1" min="5" value="${num(d.profundidad)}" placeholder="auto"></label>
			<label>Curva / clase
				<select id="dev-curva">
					${['', 'B', 'C', 'D', 'K', 'Z', 'gG', 'aM'].map((v) =>
						`<option value="${v}" ${(d.curvaDisparo ?? '') === v ? 'selected' : ''}>${v === '' ? '—' : v}</option>`).join('')}
				</select></label>
			<label>Regulación (A)<input id="dev-regulacion" type="text" value="${escaparHtml(d.rangoRegulacionA ? d.rangoRegulacionA.join('–') : '')}" placeholder="6–10"></label>
			<label>Poder de corte${d.poderCorteEstimado ? ' ~' : ''}<input id="dev-icu" type="number" step="0.5" min="0" value="${num(d.poderCorteKA)}" placeholder="kA"></label>
			<label>Disipación${d.disipacionEstimada ? ' ~' : ''}<input id="dev-disipacion" type="number" step="0.5" min="0" value="${num(d.disipacionW)}" placeholder="W"></label>
			${d.tipo === 'diferencial' ? `
			<label>Sensibilidad (mA)<input id="dev-sensibilidad" type="number" step="10" min="0" value="${num(d.sensibilidadMA)}" placeholder="30"></label>
			<label>Clase
				<select id="dev-clase-dif">
					${['', 'AC', 'A', 'F', 'B'].map((v) =>
						`<option value="${v}" ${(d.claseDiferencial ?? '') === v ? 'selected' : ''}>${v === '' ? '—' : v}</option>`).join('')}
				</select></label>` : ''}
			${d.tipo === 'rele' || d.tipo === 'contactor' ? `
			<label>Temporización
				<select id="dev-temp-tipo">
					<option value="" ${!d.temporizacion ? 'selected' : ''}>instantáneo</option>
					<option value="trabajo" ${d.temporizacion?.tipo === 'trabajo' ? 'selected' : ''}>a la conexión</option>
					<option value="reposo" ${d.temporizacion?.tipo === 'reposo' ? 'selected' : ''}>a la desconexión</option>
				</select></label>
			<label>Retardo (s)<input id="dev-temp-seg" type="number" step="0.5" min="0" max="3600"
				value="${num(d.temporizacion?.segundos)}" placeholder="5" ${d.temporizacion ? '' : 'disabled'}></label>` : ''}
			${d.tipo === 'sensor' ? `
			<label title="Deja el rango vacío si es un contacto seco: un presostato, una boya, un final de carrera">Rango de medida<input
				id="dev-rango-sonda" type="text" value="${escaparHtml(d.rangoSonda ? d.rangoSonda.join('–') : '')}" placeholder="-10–50"></label>
			<label>Unidad<input id="dev-unidad-sonda" type="text" maxlength="6"
				value="${escaparHtml(d.unidadSonda ?? '')}" placeholder="°C"></label>` : ''}
		</div>
		${d.tipo === 'sensor' ? `<p class="pista">Con RANGO es una <b>sonda</b>: entrega un número y la
		simulación le pone un mando para moverlo, que es con lo que se prueba un «UI1 &lt; 21» del
		controlador. Sin rango es un <b>contacto de campo</b> y se acciona con su interruptor.</p>` : ''}
		${d.tipo === 'plc' ? programaDeControlador(d) : ''}
		${d.temporizacion ? `<p class="pista">Con el tablero energizado se ve la cuenta atrás.
		${d.temporizacion.tipo === 'trabajo'
			? 'A la conexión: al meter la bobina espera y luego conmuta (el de una estrella-triángulo).'
			: 'A la desconexión: conmuta al instante y aguanta al soltar (el de una parada retardada).'}</p>` : ''}
		${d.poderCorteEstimado || d.disipacionEstimada ? `<p class="pista" style="color:var(--aviso)">
		Los campos con <b>~</b> son el valor corriente de esa familia de aparatos, no el de la hoja de
		datos de este modelo. Cópialos de la hoja del fabricante y el dossier dejará de marcarlos
		como estimación.</p>` : ''}
		<p class="pista">Los datos del catálogo son un punto de partida: corrígelos con la hoja del
		fabricante y el dossier saldrá con lo que de verdad lleva el tablero.</p>` : '';
	// «¿Y esto cómo se conecta?» — la duda literal de quien probó el programa. Va plegado para no
	// estorbar a quien ya lo sabe, y se abre de un clic para quien no.
	const ayuda = esImagen ? undefined : comoSeConecta(d);
	const bloqueComoSeConecta = ayuda ? `
		<details class="como-conectar">
			<summary>🔌 ¿Cómo se conecta?</summary>
			<p class="resumen-conexion">${escaparHtml(ayuda.resumen)}</p>
			<ul class="bornes-conexion">
				${ayuda.bornes.map((b) => `<li><b>${escaparHtml(b.borne)}</b> ${escaparHtml(b.papel)}</li>`).join('')}
			</ul>
			${ayuda.cuidado ? `<p class="cuidado-conexion">⚠️ ${escaparHtml(ayuda.cuidado)}</p>` : ''}
		</details>` : '';
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
		${bloqueComoSeConecta}
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
		// Al escribirlos a mano dejan de ser estimaciones: el dato ya lo puso una persona
		// mirando la hoja del fabricante, y el dossier tiene que reflejarlo.
		numero('dev-icu', (v) => { d.poderCorteKA = v; d.poderCorteEstimado = undefined; });
		numero('dev-disipacion', (v) => { d.disipacionW = v; d.disipacionEstimada = undefined; });
		numero('dev-sensibilidad', (v) => { d.sensibilidadMA = v; });
		// Nº de bornas de un bornero. Quitar bornas se lleva por delante los cables conectados a
		// ellas, así que se avisa y se borran de verdad: dejarlos apuntando a una borna que ya no
		// existe es exactamente el «cable huérfano» que el validador de archivos tiene que limpiar.
		numero('dev-bornas', (v) => {
			if (v === undefined || v < 1) return;
			const cuantas = Math.min(60, Math.round(v));
			const antes = d.bornes.length;
			if (cuantas === antes) return;
			if (cuantas > antes) {
				const esPE = d.bornes[0]?.tipo === 'PE';
				for (let i = antes; i < cuantas; i++) {
					d.bornes.push(esPE ? { id: `PE${i + 1}`, tipo: 'PE' } : { id: String(i + 1), tipo: 'control' });
				}
			} else {
				const quitadas = d.bornes.slice(cuantas).map((b) => b.id);
				d.bornes = d.bornes.slice(0, cuantas);
				const sueltos = proyecto.conductores.filter((c) =>
					(c.de.dispositivoId === d.id && quitadas.includes(c.de.borneId))
					|| (c.a.dispositivoId === d.id && quitadas.includes(c.a.borneId)));
				if (sueltos.length) {
					proyecto.conductores = proyecto.conductores.filter((c) => !sueltos.includes(c));
					avisar(`Se quitaron ${sueltos.length} cable(s) que iban a las bornas eliminadas.`, 'info');
				}
				d.puentes = d.puentes?.map((g) => g.filter((b) => !quitadas.includes(b))).filter((g) => g.length > 1);
				d.puentesInternos = d.puentesInternos?.filter(([a, b]) => !quitadas.includes(a) && !quitadas.includes(b));
			}
			// La huella crece o se encoge con las bornas: 7 mm por borna es el paso de una UT 4.
			if (col) {
				const ancho = Math.max(8, Math.round(cuantas * 7.2));
				if (!solapaCon(col.x, col.y, ancho, col.alto, d.id)) col.ancho = ancho;
				else avisar('Las bornas cambiaron, pero no cabía ensanchar el bloque sin encimarse.', 'info');
			}
		}, true);
		texto('dev-regulacion', (v) => {
			// Se acepta «6-10», «6–10» o «6 a 10»: el usuario escribe lo que ve en el aparato.
			const n = v.split(/[-–a]/).map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0);
			d.rangoRegulacionA = n.length === 2 ? [Math.min(...n), Math.max(...n)] : undefined;
		});
		texto('dev-rango-sonda', (v) => {
			// Un rango de sonda SÍ admite negativos (una de exterior mide desde −20 °C), así que el
			// signo no puede tomarse por el separador: se parte por el guion que va entre dígitos.
			const n = v.split(/(?<=\d)\s*[-–]\s*|\s+a\s+/).map((x) => Number(x.trim()))
				.filter((x) => Number.isFinite(x));
			d.rangoSonda = n.length === 2 && n[0] !== n[1] ? [Math.min(...n), Math.max(...n)] : undefined;
		});
		texto('dev-unidad-sonda', (v) => { d.unidadSonda = v.trim() || undefined; });

		(panel.querySelector('#dev-tension') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
			const v = (e.target as HTMLSelectElement).value;
			aplicar(() => { d.tensionNominal = v === '' ? undefined : Number(v); }, true);
		});
		(panel.querySelector('#dev-curva') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
			const v = (e.target as HTMLSelectElement).value;
			aplicar(() => { d.curvaDisparo = (v || undefined) as Dispositivo['curvaDisparo']; });
		});
		(panel.querySelector('#dev-clase-dif') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
			const v = (e.target as HTMLSelectElement).value;
			aplicar(() => { d.claseDiferencial = (v || undefined) as Dispositivo['claseDiferencial']; });
		});
		// Temporización: al elegir un tipo se estrena con 5 s, que es un retardo de los de siempre
		// y así el campo no se queda en blanco sin hacer nada.
		(panel.querySelector('#dev-temp-tipo') as HTMLSelectElement | null)?.addEventListener('change', (e) => {
			const v = (e.target as HTMLSelectElement).value as 'trabajo' | 'reposo' | '';
			aplicar(() => {
				d.temporizacion = v ? { tipo: v, segundos: d.temporizacion?.segundos || 5 } : undefined;
			});
		});
		(panel.querySelector('#dev-temp-seg') as HTMLInputElement | null)?.addEventListener('change', (e) => {
			const s = Math.max(0, Math.min(3600, Number((e.target as HTMLInputElement).value) || 0));
			aplicar(() => { if (d.temporizacion) d.temporizacion.segundos = s; });
		});
		// El programa del controlador: se guarda al salir del cuadro, no en cada tecla.
		const cajaPrograma = panel.querySelector('#dev-programa') as HTMLTextAreaElement | null;
		if (cajaPrograma) {
			cajaPrograma.onblur = () => {
				if (cajaPrograma.value === (d.programa ?? '')) return;
				aplicar(() => { d.programa = cajaPrograma.value.trim() || undefined; });
			};
		}
		(panel.querySelector('#dev-programa-ejemplo') as HTMLButtonElement | null)?.addEventListener('click', () => {
			aplicar(() => {
				d.programa = [
					'DO1 = DI1 Y NO DI2            ; ventilador: marcha pedida y sin alarma',
					'DO2 = DO1 retardo 5           ; compuerta, 5 s después',
					'DO3 = DO1 Y UI1 < 21          ; válvula de calor si el retorno baja de 21 °C',
				].join('\n');
			});
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
		/*
		 * Profundidad de la imagen. El primer clic SALTA al tope: «al frente» tiene que dejarla
		 * delante de verdad y «al fondo» detrás de verdad, no un poco más allá.
		 *
		 * Antes cada clic movía 15 mm desde cero, y como el riel sobresale 22 mm, pulsar «al
		 * frente» una vez dejaba la imagen todavía tapada —parecía que el programa la mandaba
		 * sola hacia atrás—. A partir del tope, los clics siguientes sí afinan de 20 en 20 para
		 * quien quiera ponerla por delante de los aparatos.
		 */
		const moverEnZ = (paso: number) => {
			if (!col) return;
			capturar();
			const z = col.z ?? 0;
			const destino = paso > 0
				? (z < Z_IMAGEN_FRENTE ? Z_IMAGEN_FRENTE : z + 20)
				: (z > Z_IMAGEN_FONDO ? Z_IMAGEN_FONDO : z - 10);
			col.z = Math.max(-40, Math.min(140, Math.round(destino)));
			reconstruirDispositivoUno(d.id);
			pintarSeleccion();
			avisar(col.z <= Z_IMAGEN_FONDO ? 'Imagen al fondo: la estructura queda por delante'
				: col.z >= 100 ? `Imagen por delante de todo (${col.z} mm)`
					: col.z >= Z_IMAGEN_FRENTE ? `Imagen delante del riel (${col.z} mm)`
						: `Profundidad de la imagen: ${col.z} mm`);
		};
		(panel.querySelector('#btn-img-fondo') as HTMLButtonElement).onclick = () => moverEnZ(-1);
		(panel.querySelector('#btn-img-frente') as HTMLButtonElement).onclick = () => moverEnZ(1);
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
	descartarCapturaSiIgual();
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
	raycaster.setFromCamera(puntero, camaraViva());
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
	raycaster.setFromCamera(puntero, camaraViva());
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
	raycaster.setFromCamera(puntero, camaraViva());
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
let gomaCable: THREE.Mesh | undefined;                 // el cable en vivo que sigue al cursor al tender
/** Botón apretado desde que empezó el cableado, para poder rematarlo soltando sobre el destino. */
let arrastreDeCableado: { movido: boolean; recorrido: number } | undefined;

/**
 * Borne (punto de conexión) bajo el puntero, con la distancia a la cámara: hace falta para
 * decidir quién se queda el clic cuando un cable pasa justo por delante del terminal.
 */
function borneBajoElPunteroCon(ev: MouseEvent): { borne: RefBorne; distancia: number } | undefined {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	raycaster.setFromCamera(puntero, camaraViva());
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
	raycaster.setFromCamera(puntero, camaraViva());
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
	// El cable aparece EN EL ACTO, pegado al borne, sin esperar a que el ratón se mueva. Antes
	// no se veía nada hasta el primer movimiento y parecía que el clic no había hecho nada.
	const a = anclajeBorne(proyecto, b.dispositivoId, b.borneId);
	if (a) actualizarGomaCable(a.x, a.y);
	avisar('Arrastra hasta el otro borne y suelta —o haz clic en él— para conectar · '
		+ 'clic en un punto libre marca un codo · Esc cancela.', 'info');
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
	arrastreDeCableado = undefined;
	permitirOrbita(true);   // se soltó el cable: la cámara vuelve a girar
	if (gomaCable) {
		escenario.raiz.remove(gomaCable);
		gomaCable.geometry.dispose();
		(gomaCable.material as THREE.Material).dispose();
		gomaCable = undefined;
	}
	resaltarHoverBorne(undefined);
}

/**
 * El CABLE EN VIVO mientras se tiende: borne de origen → codos marcados → cursor.
 *
 * No es una línea de un píxel como antes, es el mismo tubo con el que se va a dibujar el cable
 * de verdad: mismo grosor, mismos codos redondeados y misma altura de trabajo. Así lo que se
 * arrastra es exactamente lo que va a quedar, y se ve moverse mientras se lleva al otro borne
 * —que era la parte que faltaba—. Va en verde y con un punto de luz para distinguirlo de los
 * cables ya tendidos.
 */
function actualizarGomaCable(x: number, y: number): void {
	if (!cableandoDesde) return;
	const a = anclajeBorne(proyecto, cableandoDesde.dispositivoId, cableandoDesde.borneId);
	if (!a) return;
	const nodos = orthogonalize([{ x: a.x, y: a.y }, ...codosCableado, { x, y }]);
	const suave = redondearEsquinas(nodos, 16);
	const pts = [
		escenario.aEscena(a.x, a.y, a.z + 4),
		...suave.map((p) => escenario.aEscena(p.x, p.y, Z_FRENTE)),
	];
	// Con el cursor todavía encima del borne no hay recorrido: un tubo de largo cero revienta
	// la geometría, así que se separa un pelo hacia el frente para que siempre haya curva.
	if (pts.length < 2 || pts[0].distanceTo(pts[pts.length - 1]) < 0.5) {
		pts.push(escenario.aEscena(a.x, a.y, Z_FRENTE + 10));
	}
	const curva = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
	const geo = new THREE.TubeGeometry(curva, Math.max(24, pts.length * 6), 2.2, 7, false);
	if (!gomaCable) {
		gomaCable = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
			color: 0x35c46a, emissive: 0x1f7a44, emissiveIntensity: 0.85, roughness: 0.4,
			transparent: true, opacity: 0.92, depthTest: false,
		}));
		gomaCable.renderOrder = 999;
		escenario.raiz.add(gomaCable);
	} else {
		gomaCable.geometry.dispose();
		gomaCable.geometry = geo;
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
	raycaster.setFromCamera(puntero, camaraViva());
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
	raycaster.setFromCamera(puntero, camaraViva());
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
	raycaster.setFromCamera(puntero, camaraViva());
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
	// Aparato pegado al ratón: el clic lo suelta y no hace nada más.
	if (colocando && ev.button === 0) { soltarColocacion(); return; }
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

	// Con el tablero ENERGIZADO, un clic sobre un aparato lo acciona: pulsa el pulsador, abre la
	// protección, dispara el térmico. Tiene prioridad sobre todo lo demás porque en ese modo no se
	// está editando el tablero, se está probando.
	if (panelSim.energizado() && ev.button === 0) {
		const clic = elementoBajoElPuntero(ev);
		if (clic?.tipo === 'dispositivo' && panelSim.accionar(clic.id)) {
			seleccionar(clic.id);
			return;
		}
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
			else {
				iniciarCableado(golpe.borne);
				// Queda anotado que el botón está apretado: si se arrastra hasta el otro borne y
				// se suelta allí, el cable se remata sin necesidad de un segundo clic. Y la cámara
				// se queda quieta mientras tanto: tirando de un cable no se gira el tablero.
				arrastreDeCableado = { movido: false, recorrido: 0 };
				permitirOrbita(false);
			}
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
		permitirOrbita(false);
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
				permitirOrbita(false);
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
	permitirOrbita(false);
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
	// Aparato recién sacado del catálogo: va pegado al ratón hasta que un clic lo suelta.
	if (colocando) { moverColocacionAlCursor(ev); return; }
	// Resaltado al pasar el ratón (modo Trabajo): bornes (para cablear) y cables (para tocarlos).
	if (!arrastrando) {
		if (modo === 'trabajo') {
			const b = borneBajoElPuntero(ev);
			resaltarHoverBorne(b);
			mostrarTipBorne(b, ev);
			resaltarHoverCable(b ? undefined : cableBajoElPuntero(ev));
			if (cableandoDesde) {
				const p = puntoCable(ev);
				if (p) actualizarGomaCable(p.x, p.y);
				// Un temblor de la mano no es un arrastre: hasta 5 px recorridos sigue siendo clic.
				if (arrastreDeCableado) {
					arrastreDeCableado.recorrido += Math.hypot(ev.movementX || 0, ev.movementY || 0);
					if (arrastreDeCableado.recorrido > 5) arrastreDeCableado.movido = true;
				}
			}
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
			permitirOrbita(true);
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
	if (sel.tipo === 'cable') { arrastrando = false; permitirOrbita(true); return; }
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
		if (!riel) { arrastrando = false; permitirOrbita(true); return; }
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

renderer.domElement.addEventListener('pointerup', (ev) => {
	/*
	 * TENDER EL CABLE ARRASTRANDO, no solo a dos clics.
	 *
	 * Se pincha el borne, se lleva el cable hasta el otro sin soltar y se suelta allí — que es
	 * como lo hace todo el mundo la primera vez. Si el ratón NO se movió, no se remata nada: eso
	 * fue un clic, y el cableado sigue vivo esperando el segundo. Los dos modos conviven, porque
	 * el de clic a clic es el que permite ir marcando codos por el camino.
	 */
	if (cableandoDesde && arrastreDeCableado) {
		const movido = arrastreDeCableado.movido;
		arrastreDeCableado = undefined;
		permitirOrbita(true);
		if (movido) {
			const golpe = borneBajoElPunteroCon(ev);
			if (golpe) completarCableado(golpe.borne);
			else avisar('Suéltalo sobre un borne para conectar · o sigue a clics para marcar codos · Esc cancela.', 'info');
			return;
		}
	}
	if (!arrastrando) return;
	arrastrando = false;
	handleArrastrado = undefined;
	const eraCable = arrastrandoCable;
	arrastrandoCable = undefined;
	pendienteCable = undefined; // si no llegó a moverse, fue solo un clic de selección
	permitirOrbita(true);
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
	if (modo !== 'trabajo' || visualizacion || panelEsq.abierto()) return;
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
	if (modo !== 'trabajo' || visualizacion || panelEsq.abierto()) return;
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
	if (panelEsq.abierto() || visualizacion) {
		const conCtrl = ev.ctrlKey || ev.metaKey;
		if (ev.key === 'Escape') {
			ev.preventDefault();
			if (panelEsq.abierto()) panelEsq.abrir(false); else aplicarVisualizacion(false);
		} else if (panelEsq.abierto() && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
			ev.preventDefault();
			panelEsq.pasarHoja(ev.key === 'ArrowRight' ? 1 : -1);
		} else if (panelEsq.abierto() && conCtrl && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
			// En el esquema SÍ se edita —se colocan los símbolos a mano—, así que deshacer y
			// rehacer tienen que funcionar aquí. Lo que sigue vetado es borrar y pegar: eso
			// tocaría el tablero, que desde aquí no se ve.
			ev.preventDefault();
			deshacer();
			panelEsq.refrescar();
		} else if (panelEsq.abierto() && conCtrl
			&& (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) {
			ev.preventDefault();
			rehacer();
			panelEsq.refrescar();
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
		else if (colocando) cancelarColocacion();
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

/**
 * Dónde cae una imagen de referencia recién subida.
 *
 * En el centro de la placa si está libre —que es donde uno espera verla— y, si no, en el hueco
 * libre más cercano al centro. Antes caía SIEMPRE en el centro exacto, que es justo donde está el
 * aparato: la foto tapaba media placa y, peor, sus puntos de conexión quedaban por detrás de los
 * terminales de lo que hubiera debajo, o sea que no se podían pinchar para cablearlos.
 */
function huecoParaImagen(ancho: number, alto: number, id: string): { x: number; y: number } {
	const g = proyecto.gabinete!;
	const cx = Math.max(0, Math.round((g.ancho - ancho) / 2));
	const cy = Math.max(0, Math.round((g.alto - alto) / 2));
	if (!solapaCon(cx, cy, ancho, alto, id)) return { x: cx, y: cy };
	let mejor: { x: number; y: number; d: number } | undefined;
	for (let y = 0; y + alto <= g.alto; y += 10) {
		for (let x = 0; x + ancho <= g.ancho; x += 10) {
			if (solapaCon(x, y, ancho, alto, id)) continue;
			const d = Math.hypot(x - cx, y - cy);
			if (!mejor || d < mejor.d) mejor = { x, y, d };
		}
	}
	// Si la foto es más grande que cualquier hueco, al centro: es una decisión de quien la sube,
	// y siempre puede moverla o achicarla.
	return mejor ? { x: mejor.x, y: mejor.y } : { x: cx, y: cy };
}

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
				...huecoParaImagen(ancho, alto, id),
				ancho, alto,
				z: Z_IMAGEN_FRENTE,   // delante del riel desde el primer momento
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
	if (!(await panelInicio.puedoReemplazarElTablero('otro proyecto'))) {
		(e.target as HTMLInputElement).value = '';
		return;
	}
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
	descargar(`${proyecto.nombre} - dossier.html`, dossier, 'text/html');
};

/**
 * El cuadro donde se escribe el PROGRAMA de un controlador.
 *
 * Un renglón por salida, en castellano. Se enseña también lo que el motor entiende de él —cuántos
 * renglones ha leído y cuáles no— para que quien escribe no tenga que adivinar por qué su
 * maniobra no arranca.
 */
function programaDeControlador(d: Dispositivo): string {
	const leido = leerPrograma(d.programa ?? '');
	const errores = leido.errores.map((e) =>
		`<li>renglón ${e.linea}: ${escaparHtml(e.que)} <code>${escaparHtml(e.texto)}</code></li>`).join('');
	const bornes = d.bornes.map((b) => b.id);
	const entradas = bornes.filter((b) => /^(DI|UI|AI)\d/.test(b));
	const salidas = bornes.filter((b) => /^(DO|AO)\d/.test(b));
	return `<div class="bloque-programa">
		<h4>Programa del controlador</h4>
		<p class="pista">Un renglón por salida. <b>Y</b>, <b>O</b>, <b>NO</b>, paréntesis,
		<b>&gt;</b> y <b>&lt;</b> para comparar una sonda, y <b>retardo N</b> o <b>mínimo N</b> al
		final. Lo que va tras <b>;</b> es un comentario.</p>
		<textarea id="dev-programa" rows="5" spellcheck="false"
			placeholder="DO1 = DI1 Y NO DI2&#10;AO1 = UI1 &lt; 21 retardo 5">${escaparHtml(d.programa ?? '')}</textarea>
		<div class="bornes-programa">
			${entradas.length ? `<span><b>Entradas:</b> ${entradas.join(' · ')}</span>` : ''}
			${salidas.length ? `<span><b>Salidas:</b> ${salidas.join(' · ')}</span>` : ''}
		</div>
		${errores ? `<ul class="errores-programa">${errores}</ul>`
			: leido.reglas.length
				? `<p class="pista ok-programa">✓ ${leido.reglas.length} renglón(es) entendido(s). Energiza
					el tablero para verlo funcionar.</p>`
				: '<button class="boton" id="dev-programa-ejemplo">Ponme un ejemplo</button>'}
	</div>`;
}

/* ==================== Vista previa del dossier, con su editor ==================== */

/**
 * Una foto del tablero tal como se ve ahora, para meterla en el dossier.
 *
 * Se queda aquí y no en `ui-dossier.ts` porque es cosa de la ESCENA: hay que cambiar de vista,
 * renderizar y volver a dejarla como estaba. El editor del dossier solo pide la foto.
 */
function fotoDelTablero(en2D: boolean): string {
	const antes = vista2D;
	if (antes !== en2D) aplicarVista2D(en2D);
	renderer.render(escena, camaraViva());
    const datos = renderer.domElement.toDataURL('image/png');
	if (antes !== en2D) aplicarVista2D(antes);
	return datos;
}


/*
 * El editor del dossier vive en su propio archivo y no sabe nada de este: se le pasa lo que
 * necesita y devuelve la única puerta que hace falta desde fuera, abrir y cerrar el panel.
 */
const panelDossier = instalarDossier({
	proyecto: () => proyecto,
	avisar,
	marcarSucio,
	capturar,
	fotoDelTablero,
});
($('btn-pdf') as HTMLButtonElement).onclick = () => panelDossier.abrir(true);

/* ------------------------------- Modos ------------------------------- */

const AYUDA: Record<Modo, string> = {
	editor: '🔧 EDITOR (armar) — Añade aparatos del catálogo (van sobre un riel) · arrástralos · edita caja, placa, rieles y canaletas (botón «Girar H↔V») · Duplicar/Eliminar · Supr borra · Ctrl+Z deshace',
	trabajo: '🔌 TRABAJO (conexiones) — Cablea tocando un borne (punto naranja) y luego otro · doble clic sobre un cable crea una unión y el clic izquierdo la arrastra · Esc cancela · DRC en vivo. La estructura está bloqueada.',
};

/* ------------------------------- Modo Energizar ------------------------------- */

/*
 * Se instala AQUÍ, y no al final con el resto del arranque, porque el editor le pregunta cosas
 * (¿hay tensión?, ¿qué está funcionando?) desde funciones que corren mucho antes. Todo lo que
 * necesita de vuelta se le pasa como función, así que la escena y el proyecto pueden seguir
 * cambiando por debajo sin que este módulo se entere.
 */
const panelSim = instalarSimulacion({
	proyecto: () => proyecto,
	escenario: () => escenario,
	seleccionar,
});


/* La segunda herramienta se carga solo cuando se abre: son 240 KB de planta y un visor entero
   que quien solo diseña tableros no tiene por qué pagar al arrancar. */
async function irAPlanta(): Promise<void> {
	try {
		const { abrirMundo, cerrarMundo } = await import('./mundo-ui.js');
		($('mundo-salir') as HTMLButtonElement).onclick = () => cerrarMundo();
		($('mundo-inicio') as HTMLButtonElement).onclick = () => { cerrarMundo(); panelInicio.mostrar(); };
		abrirMundo(abrirTableroDesdeLaPlanta);
	} catch (e) {
		avisar(`No se pudo abrir el visor de la planta: ${(e as Error).message}`, 'error');
	}
}
($('btn-planta') as HTMLButtonElement).onclick = irAPlanta;

/**
 * Recibe el tablero armado con las máquinas que se han elegido en la cubierta.
 *
 * Se abre en modo EDITOR a propósito: lo que llega es un punto de partida sacado del plano —hay
 * que colocar los aparatos, cambiar el controlador genérico por el del proyecto y repasar las
 * secciones—, no un tablero terminado que se recorra tal cual.
 */
function abrirTableroDesdeLaPlanta(nuevo: Proyecto, resumen: string): void {
	// El puente desde el plano también reemplaza el tablero: se pregunta igual que en todo lo
	// demás que lo reemplaza. Se hace aquí dentro porque el visor ya se cerró al pulsar «Armar».
	if (hayCambiosSinExportar) {
		void (async () => {
			if (await panelInicio.puedoReemplazarElTablero('el tablero armado desde el plano')) {
				abrirTableroDesdeLaPlantaSinPreguntar(nuevo, resumen);
			} else {
				avisar('No se abrió el tablero del plano: el tuyo sigue como estaba.', 'info');
			}
		})();
		return;
	}
	abrirTableroDesdeLaPlantaSinPreguntar(nuevo, resumen);
}

function abrirTableroDesdeLaPlantaSinPreguntar(nuevo: Proyecto, resumen: string): void {
	capturar();
	proyecto = nuevo;
	numerarDispositivos(proyecto);
	panelInicio.olvidarEjemplo();
	aplicarSeleccion(undefined);
	aplicarModo('editor');
	trasCambiarProyecto();
	encuadrar();
	avisar(`Tablero armado desde el plano: ${resumen}. Revisa el controlador y las secciones.`, 'ok');
}

/* ------------------------------- Modo Visualización ------------------------------- */

/** True cuando se está viendo el tablero «como quedaría de verdad» (no se puede editar). */
let visualizacion = false;

/**
 * Entra o sale del modo Visualización: caja de chapa opaca con la puerta abierta, sin
 * transparencias ni ayudas de edición, paneles laterales ocultos y toda edición bloqueada.
 * Solo se puede girar y acercar la vista, como enseñando el tablero terminado.
 */
function aplicarVisualizacion(activo: boolean): void {
	if (activo && panelEsq.abierto()) panelEsq.abrir(false); // las dos capas no pueden convivir
	visualizacion = activo;
	document.body.classList.toggle('modo-visualizacion', activo);
	$('btn-ver').classList.toggle('activo', activo);
	($('btn-ver') as HTMLButtonElement).textContent = activo ? '👁️ Salir' : '👁️ Ver';
	if (activo) {
		cancelarCableado();
		mostrarTipBorne(undefined);
		aplicarSeleccion(undefined);
		arrastrando = false;
		permitirOrbita(true);
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
	// Cambiar de modo con un aparato pegado al ratón lo dejaría colgado para siempre: se suelta.
	if (colocando) soltarColocacion();
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
		permitirOrbita(true);
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

const panelEsq = instalarEsquema({
	proyecto: () => proyecto,
	potenciales: () => potenciales,
	dispositivoSeleccionado: () => (sel?.tipo === 'dispositivo' ? sel.id : undefined),
	seleccionar,
	capturar,
	marcarSucio,
	actualizarTodo,
	nombreArchivo,
	cerrarVisualizacion: () => { if (visualizacion) aplicarVisualizacion(false); },
});


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

/* ------------------------ Entregables: rótulos y DXF ------------------------ */

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
	// Los campos que el proyecto NO declara se enseñan VACÍOS, con el valor por defecto como
	// marca de agua: si se rellenaran con él, quien abre el diálogo creería que ya está declarado
	// y el dossier acabaría afirmando una temperatura o un montaje que nadie ha elegido.
	poner('pr-icc', o.iccPresuntaKA ? String(o.iccPresuntaKA) : '');
	poner('pr-ambiente', declarado(proyecto, 'temperaturaAmbienteC') ? String(o.temperaturaAmbienteC) : '');
	poner('pr-inominal', o.corrienteAsignadaA ? String(o.corrienteAsignadaA) : '');
	poner('pr-frecuencia', declarado(proyecto, 'frecuenciaHz') ? String(o.frecuenciaHz) : '');
	poner('pr-ip', o.gradoIP);
	($('pr-montaje') as HTMLSelectElement).value = declarado(proyecto, 'montajeGabinete') ? o.montajeGabinete : '';
	($('pr-neutro') as HTMLSelectElement).value = o.regimenNeutro;
	($('pr-uso') as HTMLSelectElement).value = o.usoPrevisto;
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
	// Lo que se deja en blanco queda SIN DECLARAR (undefined), no relleno con el valor por
	// defecto: es lo que permite que el dossier distinga «lo decidió el proyectista» de «lo
	// supuso el programa», y que la placa de características diga «a declarar» donde toca.
	const montaje = ($('pr-montaje') as HTMLSelectElement).value;
	proyecto.opciones = {
		...(proyecto.opciones ?? {}),
		iccPresuntaKA: numero('pr-icc') ?? 0,
		temperaturaAmbienteC: numero('pr-ambiente'),
		corrienteAsignadaA: numero('pr-inominal') ?? 0,
		frecuenciaHz: numero('pr-frecuencia'),
		gradoIP: ($('pr-ip') as HTMLInputElement).value.trim(),
		montajeGabinete: montaje ? (montaje as OpcionesProyecto['montajeGabinete']) : undefined,
		regimenNeutro: ($('pr-neutro') as HTMLSelectElement).value as OpcionesProyecto['regimenNeutro'],
		usoPrevisto: ($('pr-uso') as HTMLSelectElement).value as OpcionesProyecto['usoPrevisto'],
	};
	($('modal-proyecto') as HTMLElement).hidden = true;
	recalcular();      // la Icc cambia el DRC al instante
	pintarPaneles();
	panelEsq.refrescar();
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

/* --------------- Ventana de inicio, ejemplos y plantillas propias --------------- */

const panelInicio = instalarInicio({
	proyecto: () => proyecto,
	ponerProyecto: (p) => { proyecto = p; },
	capturar,
	limpiarSeleccion: () => aplicarSeleccion(undefined),
	descartarBienvenida: () => { bienvenidaDescartada = true; },
	aplicarModo,
	trasCambiarProyecto,
	encuadrar,
	hayCambiosSinExportar: () => hayCambiosSinExportar,
	ajustarTamano: () => ajustarTamano(),
	encuadrePendiente: () => encuadrePendiente,
	irAPlanta,
});

function ajustarTamano(): void {
	const r = contenedor.getBoundingClientRect();
	camara.aspect = r.width / r.height;
	camara.updateProjectionMatrix();
	// El alzado conserva la altura que tenía y recalcula el ancho con la nueva proporción: al
	// estrechar la ventana se ve menos a los lados, no un tablero achatado.
	const semiAlto = (camaraOrto.top - camaraOrto.bottom) / 2;
	camaraOrto.left = -(semiAlto * r.width) / r.height;
	camaraOrto.right = (semiAlto * r.width) / r.height;
	camaraOrto.updateProjectionMatrix();
	renderer.setSize(r.width, r.height);
}

/**
 * Cambia entre el 3D y el alzado 2D.
 *
 * La niebla se apaga en 2D: está puesta para dar profundidad al 3D y en un alzado solo sirve
 * para desteñir el tablero. La rejilla del suelo también sobra —en un alzado se ve de canto,
 * como una raya— así que se esconde.
 */
function aplicarVista2D(activar: boolean): void {
	vista2D = activar;
	controles.enabled = !activar;
	controlesOrto.enabled = activar;
	escena.fog = activar ? null : nieblaEscena;
	suelo.visible = !activar;
	document.body.classList.toggle('vista-2d', activar);
	$('btn-2d').classList.toggle('activo', activar);
	$('btn-2d').setAttribute('title', activar
		? 'Volver a la vista 3D (ahora estás en el alzado 2D)'
		: 'Ver el tablero en 2D: alzado de frente, a escala y sin perspectiva');
	($('btn-2d-texto') as HTMLElement).textContent = activar ? '3D' : '2D';
	encuadrar();
}
($('btn-2d') as HTMLButtonElement).onclick = () => aplicarVista2D(!vista2D);
/**
 * Aprieta la barra de herramientas hasta que quepa, MIDIENDO en cada paso.
 *
 * Historia de esto, que explica por qué está así: primero era un `@media (max-width: 1500px)`
 * puesto a ojo, y desbordaba entre 1501 y 1740. Lo cambié por un `1745px` medido a mano, y duró
 * hasta el siguiente botón. Lo cambié por una medición con un solo nivel —rótulos sí o no— y duró
 * hasta el botón de la planta: a 1366 px ya no caben ni los iconos.
 *
 * La lección es que el ancho necesario depende de cuántas herramientas haya, del nombre del
 * proyecto y del texto del chip de guardado, así que CUALQUIER constante aquí caduca. Lo que no
 * caduca es preguntarle al navegador. Se prueban los niveles de arriba abajo y se para en el
 * primero que quepa; si ninguno cabe, se queda el más apretado, que es lo mejor disponible.
 */
export function ajustarRotulosBarra(): void {
	// Los niveles van DENTRO de la función y no en una constante de módulo, y no es un capricho:
	// esta función se llama desde `pintarEstadoGuardado()`, que corre durante el arranque, y una
	// constante declarada más abajo en el archivo daría un «no se puede acceder a X antes de
	// inicializar» en tiempo de ejecución que TypeScript compila sin quejarse. Me pasó exactamente
	// eso al escribir esto.
	//
	// Ese riesgo es el que manda cómo se parte este archivo: los módulos que ya salieron
	// (ui-dossier, ui-inicio, ui-esquema, ui-simulacion) no leen NADA de aquí. Lo que necesitan se
	// les pasa al instalarlos, y siempre como función —`proyecto: () => proyecto`—, así que se
	// evalúa cuando se usa y no cuando se monta. Mientras el nivel superior de este archivo siga
	// siendo un guion de arranque, cualquier módulo nuevo tiene que salir por esa misma puerta.
	const NIVELES = ['compacta', 'apretada', 'minima', 'micro'];
	const barra = $('barra');
	barra.classList.remove(...NIVELES);
	if (barra.scrollWidth <= barra.clientWidth + 1) return;
	for (const nivel of NIVELES) {
		barra.classList.add(nivel);
		if (barra.scrollWidth <= barra.clientWidth + 1) return;
	}
}

/*
 * Y se vuelve a medir CADA VEZ QUE CAMBIA LO QUE PONE EN LA BARRA.
 *
 * Faltaba esto y por eso volvió a desbordar al añadir el botón 2D: se medía una sola vez al
 * arrancar, cuando el chip del DRC todavía no decía «DRC sin hallazgos» y el proyecto no tenía
 * nombre. Con el texto definitivo ya no cabía, pero nadie lo volvía a comprobar. En vez de
 * llamar a la función desde los seis sitios que escriben en la barra —y olvidarse del séptimo—,
 * se mira la barra entera: cualquier texto o botón que cambie dispara una nueva medida.
 *
 * No se observan atributos a propósito: esta función cambia las clases de la propia barra, y
 * observarlas la haría llamarse a sí misma sin parar.
 */
new MutationObserver(() => ajustarRotulosBarra())
	.observe($('barra'), { childList: true, subtree: true, characterData: true });

window.addEventListener('resize', () => {
	ajustarTamano();
	ajustarRotulosBarra();
	if (encuadrePendiente) encuadrar();
	if (panelEsq.abierto()) panelEsq.reajustarZoom(); // la hoja se reajusta al nuevo tamaño de ventana
});
ajustarTamano();
ajustarRotulosBarra();
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
	(vista2D ? controlesOrto : controles).update();
	renderer.render(escena, camaraViva());
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
		const p = v.clone().project(camaraViva());
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
				raycaster.setFromCamera(puntero, camaraViva());
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
			/**
			 * El cable EN VIVO que sigue al cursor: si está montado y cuánto mide. Con esto la
			 * prueba puede exigir que aparezca en el mismo clic —sin esperar a que el ratón se
			 * mueva— y que se estire de verdad al llevarlo hacia el otro borne.
			 */
			goma: gomaCable
				? {
					montado: true,
					largo: (() => {
						const pos = gomaCable.geometry.getAttribute('position');
						const caja = new THREE.Box3().setFromBufferAttribute(pos as THREE.BufferAttribute);
						return Math.round(caja.max.distanceTo(caja.min));
					})(),
					tubo: gomaCable.geometry.type === 'TubeGeometry',
				}
				: { montado: false, largo: 0, tubo: false },
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
				raycaster.setFromCamera(puntero, camaraViva());
				const golpe = raycaster.intersectObjects(escenario.raiz.children, true)
					.find((h) => h.object.userData[clave] || h.object.userData.dispositivoId);
				if (golpe?.object.userData[clave] === id) return p;
			}
			return undefined; // el perfil está totalmente cubierto de aparatos
		},
		/**
		 * Cuánto van MONTADOS unos cables sobre otros (mm de tramos paralelos que se pisan).
		 *
		 * Se dan DOS cifras, y la que importa es la segunda. `totalMm` mira el tablero de frente,
		 * en plano: ahí cuenta como montado cualquier cable que corra paralelo a otro, y en un
		 * mazo de verdad eso pasa continuamente sin que sea un defecto. `mismaCapaMm` cuenta solo
		 * los que además van a la MISMA PROFUNDIDAD, o sea uno dentro del otro: esos no se
		 * distinguen ni girando la vista, y son los que hay que dejar en cero.
		 */
		amontonamiento: () => {
			const rutas = rutasDeCables(proyecto);
			let total = 0;
			let pares = 0;
			let mismaCapa = 0;
			let paresMismaCapa = 0;
			for (let i = 0; i < rutas.length; i++) {
				for (let j = i + 1; j < rutas.length; j++) {
					const mm = longitudSolapada(rutas[i].nodos, rutas[j].nodos);
					if (mm <= 0) continue;
					total += mm; pares++;
					if (Math.abs(rutas[i].z - rutas[j].z) < 0.5) { mismaCapa += mm; paresMismaCapa++; }
				}
			}
			return {
				totalMm: Math.round(total), pares, cables: rutas.length,
				mismaCapaMm: Math.round(mismaCapa), paresMismaCapa,
			};
		},
		/** Recorrido resuelto de cada cable (mm de modelo), tal cual se dibuja. */
		rutas: () => rutasDeCables(proyecto).map((r) => ({ id: r.conductorId, nodos: r.nodos, z: r.z })),
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
				raycaster.setFromCamera(puntero, camaraViva());
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
			// Se prueba el centro y, si algo lo cruza, una corona de puntos alrededor. Con solo siete
			// muestras bastaba un cable cruzando en diagonal para que la sonda diera el terminal por
			// intocable cuando a ojo se pincha sin problema; con dos anillos de ocho se agota de
			// verdad el sitio disponible antes de decir que no.
			const alrededor: [number, number][] = [[0, 0]];
			for (const radio of [0.55, 0.85]) {
				for (let i = 0; i < 8; i++) {
					const a = (i * Math.PI) / 4;
					alrededor.push([Math.cos(a) * radio, Math.sin(a) * radio]);
				}
			}
			for (const [dx, dy] of alrededor) {
				const v = aPantalla(new THREE.Vector3(centro.x + dx * radio, centro.y + dy * radio, centro.z));
				const p = { x: Math.round(v.x), y: Math.round(v.y) };
				puntero.set(((p.x - r.left) / r.width) * 2 - 1, -((p.y - r.top) / r.height) * 2 + 1);
				raycaster.setFromCamera(puntero, camaraViva());
				const b = raycaster.intersectObjects(escenario.bornes.children, true).find((h) => h.object.userData.borneId);
				if (b?.object !== esfera) continue;
				const cable = raycaster.intersectObjects(escenario.cables.children, true)
					.find((h) => h.object.userData.tuboVisible);
				if (cable && cable.distance < b.distance) continue; // hay un cable por delante
				// Un aparato NO puede tapar su propio terminal: el terminal va dibujado sobre él, y
				// en una imagen de referencia además está justo en su plano, así que la lámina
				// salía «por delante» de sus propios puntos por unas centésimas y la prueba
				// concluía que no se podía pinchar ninguno. Lo que sí tapa es OTRO aparato.
				const aparato = raycaster.intersectObjects(escenario.dispositivos.children, true)
					.find((h) => h.object.userData.dispositivoId
						&& h.object.userData.dispositivoId !== dispositivoId);
				if (aparato && aparato.distance < b.distance) continue;
				return p;
			}
			return undefined;
		},
		/** Todo lo que hay bajo un píxel, en orden de cercanía (para diagnosticar un clic perdido). */
		diagnosticoPixel: (x: number, y: number) => {
			const r = renderer.domElement.getBoundingClientRect();
			puntero.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
			raycaster.setFromCamera(puntero, camaraViva());
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
			raycaster.setFromCamera(puntero, camaraViva());
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
		/** Resumen de la simulación en curso (modo Energizar). */
		simulacion: () => {
			const r = panelSim.resultado();
			return {
				energizado: panelSim.energizado(),
				conductoresVivos: r?.conductoresVivos.size ?? 0,
				bornesVivos: r?.vivos.size ?? 0,
				activos: [...(r?.activos ?? [])],
				funcionando: r?.funcionando ?? [],
				avisos: r?.avisos ?? [],
				oscila: r?.oscila ?? false,
			};
		},
		/** Recalcula si los rótulos de la barra caben (lo hace la app al cambiar tamaño o estado). */
		ajustarBarra: () => ajustarRotulosBarra(),
		/** Estado de los mandos que el usuario ha accionado. */
		estadoSim: () => Object.entries(panelSim.estadoDeLosMandos()).map(([id, st]) => ({ id, ...st })),
		/** Acciona un aparato como si se hubiera pinchado en él con el tablero energizado. */
		accionar: (id: string) => panelSim.accionar(id),
		/** Cuántos tubos de cable están de verdad ILUMINADOS en la escena (lo que se ve). */
		cablesEncendidos: () => {
			let n = 0;
			escenario.cables.traverse((o) => {
				const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
				if (m?.isMaterial && (o as THREE.Mesh).userData.tuboVisible && m.emissiveIntensity > 0.1) n++;
			});
			return n;
		},
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
		/** Estado de la vista 2D: si está puesta, y si la cámara viva es de verdad ortográfica. */
		vista2D: () => ({
			activa: vista2D,
			ortografica: (camaraViva() as THREE.OrthographicCamera).isOrthographicCamera === true,
			gira: (vista2D ? controlesOrto : controles).enableRotate,
			niebla: !!escena.fog,
			// Posición y zoom del alzado: con esto la prueba puede exigir que arrastrar una unión
			// de cable NO mueva la vista ni un milímetro.
			x: Math.round(camaraOrto.position.x * 100) / 100,
			y: Math.round(camaraOrto.position.y * 100) / 100,
			zoom: Math.round(camaraOrto.zoom * 10000) / 10000,
			suelta: controlesOrto.enabled,
		}),
		/**
		 * Píxeles de pantalla por milímetro de mundo A LA PROFUNDIDAD `z`.
		 *
		 * Es la medida que separa un alzado de una foto: en ortográfica sale la MISMA para
		 * cualquier `z` —100 mm miden lo mismo estén al fondo de la caja o sobresaliendo del
		 * aparato más gordo—, y en perspectiva crece al acercarse. Se mide sobre un segmento
		 * conocido en vez de sobre un aparato, porque el modelo 3D de un aparato lleva pinzas,
		 * palancas y rótulos que no entran en su medida de catálogo.
		 */
		escalaEnPantalla: (z = 0) => {
			const a = aPantalla(new THREE.Vector3(0, -100, z));
			const b = aPantalla(new THREE.Vector3(0, 100, z));
			return Math.abs(b.y - a.y) / 200;
		},
		/**
		 * Las piezas del FRENTE de un aparato, con su hueco en Z y si su material va sesgado
		 * hacia la cámara.
		 *
		 * Sirve para cazar el parpadeo de raíz en vez de a ojo: dos caras planas paralelas que se
		 * solapan en XY y quedan a menos de medio milímetro una de otra se turnan fotograma a
		 * fotograma, y eso es lo que hacía parpadear las letras y la tapa de los controladores.
		 * Con esto la prueba puede comprobar la geometría, que es determinista, en vez de comparar
		 * capturas de pantalla, que en un contenedor que renderiza por software no valen.
		 */
		capasDeFrente: (dispositivoId: string) => {
			const g = escenario.dispositivos.children.find((o) => o.userData.dispositivoId === dispositivoId);
			if (!g) return [];
			const piezas: {
				z0: number; z1: number; x0: number; x1: number; y0: number; y1: number; sesgo: boolean;
			}[] = [];
			g.traverse((o) => {
				if (!(o instanceof THREE.Mesh) || !o.geometry) return;
				o.geometry.computeBoundingBox();
				const c = o.geometry.boundingBox;
				if (!c) return;
				const mat = o.material as THREE.Material;
				piezas.push({
					z0: c.min.z + o.position.z, z1: c.max.z + o.position.z,
					x0: c.min.x + o.position.x, x1: c.max.x + o.position.x,
					y0: c.min.y + o.position.y, y1: c.max.y + o.position.y,
					sesgo: !!mat.polygonOffset,
				});
			});
			return piezas;
		},
		/** Altura del suelo y punto más bajo del tablero: el suelo nunca puede quedar por encima. */
		suelo: () => ({
			y: suelo.position.y,
			fondoDelTablero: new THREE.Box3().setFromObject(escenario.raiz).min.y,
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
		/** Hallazgos del DRC del proyecto abierto, tal como los ve el panel de verificación. */
		drc: () => hallazgos,
	};
}
