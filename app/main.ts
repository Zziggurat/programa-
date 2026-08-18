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
import { ArchivoInvalido, cargarProyecto, imagenAdmisible } from '../src/modelo/cargar.js';
import { abrirVentana, cerrarVentana, cerrarVentanaDeArriba } from './ventanas.js';
import { numerarDispositivos } from '../src/motores/numeracion.js';
import { revisarTablero, RevisionTablero } from '../src/motores/revision.js';
import { generarInformeHTML } from '../src/motores/documentacion.js';
import {
	anclajeBorne, cajaDe, colorDeCable, colorVoltaje, COLOR_CABLE, construirBornes, construirCables, construirCanaleta,
	construirCotas, construirDispositivo, construirEscenario, construirRiel, DatosCota, Escenario,
	diagnosticoCables, largoDibujadoMm, liberar, longitudesDibujadasMm, rutasDeCables, salidasDeCable,
	vaciar, VOLTAJE_COLOR,
	yEntradasCampo, Z_FRENTE, Z_IMAGEN_FONDO, Z_IMAGEN_FRENTE,
} from './escena3d.js';
import { colorDeTipo } from './dispositivos3d.js';
import { PLANTILLAS, PlantillaAparato, crearDesdePlantilla } from './catalogo.js';
import { CONTROLADORES, naturalezaTerminal } from './controladores.js';
import { huellaMinima, leerRotulos } from '../src/motores/terminales.js';
import { calcularBalanceTermico } from '../src/motores/termico.js';
import { comoSeConecta } from './como-se-conecta.js';
import { avisarSiNoSePuede } from './requisitos.js';
import {
	avisar, confirmar, descargar, escaparHtml, nombreSeguroDeArchivo, pedirTexto,
} from './dialogos.js';
import { instalarDossier } from './ui-dossier.js';
import { instalarInicio } from './ui-inicio.js';
import { instalarEsquema } from './ui-esquema.js';
import { instalarSimulacion } from './ui-simulacion.js';
import { animarSimulacion } from './animacion-sim.js';
import { dxfDePlaca, exportarEtiquetasPDF } from './exportaciones.js';
import { idUnico } from '../src/modelo/ids.js';
import {
	dentroDelArea, distPuntoSegmento, fueraDeLaHuella, Huella, longitudSolapada, orthogonalize,
	redondearEsquinas,
} from './geometria-cables.js';

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

/**
 * EL AUTOGUARDADO NO SE PISA NUNCA SIN QUE EL USUARIO LO DECIDA.
 *
 * Esto era un `try { … } catch { return proyectoNuevo(); }`. Daba igual el motivo —almacén
 * bloqueado, JSON a medias, o un proyecto guardado con una versión MÁS NUEVA del programa—:
 * siempre se abría un tablero vacío, y el primer `recalcular()` llamaba a `autoguardar()` y
 * escribía encima. Comprobado: un autosave de versión 999 llamado «MI TABLERO IMPORTANTE»
 * quedaba convertido en «Tablero nuevo» al recargar, sin copia de ninguna clase.
 *
 * Es lo contrario de lo que hace falta, porque el caso típico es abrir el trabajo con otra
 * versión del programa: el momento en que uno MÁS quiere recuperarlo era justo el momento en que
 * se lo borrábamos.
 *
 * Ahora se distingue por qué falló, el texto original se queda intacto donde está, y el
 * autoguardado queda CONGELADO hasta que el usuario decida. Mientras esté congelado no se escribe
 * ni una vez en la clave del proyecto.
 */
interface CargaInicial {
	proyecto: Proyecto;
	/** Qué salió mal, si salió algo mal. Con esto se decide si se congela el guardado. */
	problema?: { motivo: string; crudo?: string; sinAlmacen?: boolean; reparado?: boolean };
}

function cargarInicial(): CargaInicial {
	let guardado: string | null = null;
	try {
		guardado = localStorage.getItem(CLAVE_AUTOSAVE);
	} catch (e) {
		// Sin almacén (artifact con storage bloqueado, modo privado): no hay nada guardado que
		// perder, pero tampoco se va a poder guardar. El chip de la barra ya lo dice.
		return { proyecto: proyectoNuevo(), problema: { motivo: nombreDeError(e), sinAlmacen: true } };
	}
	// Primera vez: placa vacía con la tarjeta de bienvenida. El tablero de ejemplo se carga a
	// demanda con el botón «Ver un tablero de ejemplo».
	if (!guardado) return { proyecto: proyectoNuevo() };

	try {
		const { proyecto: leido, arreglos } = cargarProyecto(guardado);
		/*
		 * UN ARCHIVO REPARADO TAMPOCO SE PISA.
		 *
		 * Segunda auditoría, TS2-P0-01. Aquí se cogía solo `.proyecto` y se tiraba el informe de
		 * reparaciones. El caso que se cubría era el del archivo que NO SE PUEDE LEER —ese lanza,
		 * y entonces sí se congelaba el guardado—; pero el cargador tiene un segundo camino, que
		 * es el que se usa a diario: leerlo y ARREGLARLO por el camino. Medido:
		 *
		 *   entrada: 29 cables · salida: 28 · arreglos: ["1 cable(s) sueltos sin aparato…"]
		 *   no lanza → el `recalcular()` de arranque llama a `autoguardar()`
		 *   → el autosave queda reemplazado por la versión saneada, y el cable, perdido
		 *
		 * Y ese cable podía ser lo único que quedaba de un aparato que se borró por error tres
		 * días antes. Un archivo del que hubo que quitar algo es exactamente el que hay que
		 * conservar entero hasta que su dueño diga que sí.
		 */
		if (arreglos.length > 0) {
			return { proyecto: leido, problema: { motivo: arreglos.join(', '), crudo: guardado, reparado: true } };
		}
		return { proyecto: leido };
	} catch (e) {
		return { proyecto: proyectoNuevo(), problema: { motivo: nombreDeError(e), crudo: guardado } };
	}
}

function nombreDeError(e: unknown): string {
	return (e as Error)?.message || (e as Error)?.name || 'no se pudo leer';
}

const cargaInicial = cargarInicial();
let proyecto: Proyecto = cargaInicial.proyecto;
/** Congelado = hay algo guardado que no se ha podido leer y que NO se puede pisar todavía. */
let guardadoCongelado = !!cargaInicial.problema?.crudo;

/**
 * Todo lo que el programa sabe del tablero que hay en pantalla. Lo calcula `revisarTablero()`, que
 * es el único sitio que conoce el orden en que se encadenan los motores: aquí solo se guarda el
 * resultado para que lo lean los paneles.
 */
let revision: RevisionTablero;
let coloreaVoltaje = false; // "Colorear por voltaje" en el panel Vista

function recalcular(): void {
	// El DRC recibe las longitudes REALES del recorrido dibujado (no una estimación): con ellas
	// puede calcular la caída de tensión de cada circuito. Se las pasa el PDF también, desde la
	// misma función, para que el papel y la pantalla no digan cosas distintas.
	revision = revisarTablero(proyecto, { longitudesMm: longitudesDibujadasMm(proyecto) });
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

/**
 * Enseña u oculta el aviso de «esto es un ejemplo», según lo que haya abierto.
 *
 * Va junto al estado del guardado porque es lo mismo que está diciendo: en un ejemplo no hay nada
 * que guardar, y conviene que las dos cosas se lean de un vistazo y en el mismo sitio.
 */
function pintarChipEjemplo(): void {
	const chip = $('chip-ejemplo');
	chip.hidden = !proyecto.esEjemplo;
	// En un ejemplo el estado del guardado no significa nada: no se guarda, y decir «Guardado»
	// haría creer que el tablero de uno está a salvo cuando lo que está en pantalla es otro.
	($('estado-guardado') as HTMLElement).hidden = !!proyecto.esEjemplo;
}

/**
 * Convierte el ejemplo abierto en un tablero DEL USUARIO: quita la marca, le cambia el nombre y a
 * partir de ahí se puede editar y se guarda como cualquier otro.
 *
 * Es la salida para quien quiera trastear —los propios ejemplos lo piden: «cámbiale el retardo o
 * los 21 °C y vuelve a simular»—, sin que el ejemplo original se pueda estropear.
 */
function copiarEjemploParaTrabajar(): void {
	if (!proyecto.esEjemplo) return;
	delete proyecto.esEjemplo;
	proyecto.nombre = `Copia de ${proyecto.nombre}`;
	($('nombre-proyecto') as HTMLInputElement).value = proyecto.nombre;
	pintarChipEjemplo();
	// Ahora sí es trabajo suyo: se marca y se guarda, como cualquier cambio.
	marcarSucio();
	actualizarBotonesHistorial();
	avisar('Ya es tuyo: puedes modificarlo y se guarda con tu trabajo. '
		+ 'El ejemplo original sigue intacto en la biblioteca.', 'ok');
}

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
	// Hay un proyecto guardado que no se ha podido leer. Hasta que el usuario diga qué hacer con
	// él, no se escribe: sobrescribirlo sería destruir justo lo que está intentando recuperar.
	if (guardadoCongelado) return;
	/*
	 * UN EJEMPLO NO ES TRABAJO TUYO Y NO SE GUARDA ENCIMA DEL TUYO.
	 *
	 * Esto es lo que de verdad se perdía. El aviso de «se reemplaza lo que hay» hablaba de la
	 * pantalla, pero al abrir un ejemplo se escribía TAMBIÉN en `localStorage`, que es donde vive
	 * el tablero de quien nunca descarga el archivo —o sea, casi todo el mundo—. Medido: con «MI
	 * TABLERO DEL AEROPUERTO» a medias, abrir el estrella-triángulo dejaba el autoguardado con el
	 * estrella-triángulo. Cerrabas la pestaña y tu tablero no existía en ninguna parte.
	 *
	 * Ahora abrir un ejemplo no toca el guardado: se mira, se energiza, se cierra, y al volver
	 * sigue estando lo tuyo. Y si el ejemplo gusta, «Hacer una copia para trabajar» lo convierte en
	 * tuyo —quita la marca— y desde ese momento sí se guarda.
	 */
	if (proyecto.esEjemplo) return;
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

/**
 * Cierra las ventanas que estén abiertas encima. Devuelve si cerró alguna.
 *
 * Se BUSCAN en vez de llevar una lista escrita a mano: la lista se quedó corta —cerraba tres de
 * las nueve, así que la ayuda, los ejemplos y la explicación de un aparato no se cerraban con
 * Escape— y volvería a quedarse corta con la siguiente ventana que se añadiera.
 *
 * `modal-dialogo` se queda fuera porque tiene su propio Escape, que además le devuelve
 * «cancelado» a quien esté esperando la respuesta.
 */
function cerrarVentanasDeArriba(): boolean {
	/*
	 * Primero, la que lleve el gestor: cerrarla por él devuelve el foco a donde estaba y quita el
	 * `inert` del fondo. Poner `hidden = true` a pelo dejaría el fondo apagado para siempre y el
	 * foco perdido, que es peor que no cerrarla. TS3-P2-02.
	 */
	if (cerrarVentanaDeArriba()) return true;
	// Y si queda alguna que todavía no pase por el gestor, se cierra como antes.
	const abiertas = [...document.querySelectorAll<HTMLElement>('[id^="modal-"]')]
		.filter((el) => el.id !== 'modal-dialogo' && !el.hidden);
	for (const el of abiertas) el.hidden = true;
	return abiertas.length > 0;
}

/** Solo la señal: hay trabajo que todavía no se ha descargado como archivo. */
function senalarTrabajoSinExportar(): void {
	hayCambiosSinExportar = true;
	if (estadoGuardado !== 'fallo') { estadoGuardado = 'sucio'; pintarEstadoGuardado(); }
}

/**
 * Lo mismo que lo de arriba Y ADEMÁS GUARDA. Es lo que se les pasa a los paneles que viven en
 * otro archivo —el dossier, el esquema— para decir «acabo de cambiar el proyecto».
 *
 * Antes esto solo ponía la bandera. El panel del esquema no lo notaba porque después llama a
 * `actualizarTodo()`, que sí guarda; pero el del dossier no llama a nadie más, así que el nombre
 * de la empresa que firma, el color, el papel y los apartados elegidos NO SE GUARDABAN NUNCA.
 * Y encima el indicador se ponía en «sin exportar», que es el mismo aspecto que tiene un proyecto
 * bien guardado pendiente de descargar: uno cerraba la pestaña convencido de que estaba a salvo.
 * Comprobado recargando la página: la empresa desaparecía.
 *
 * Es el fallo que la auditoría (TS-P1-08) predijo de forma general —hay muchos sitios que tocan
 * el proyecto y cada uno tiene que acordarse de guardar—, encontrado en un sitio concreto.
 * `capturar()` NO pasa por aquí a propósito: se llama ANTES de cambiar nada, así que guardaría el
 * estado de antes y doblaría el coste en cada edición.
 */
function marcarSucio(): void {
	senalarTrabajoSinExportar();
	autoguardar();
}

// Cerrar la pestaña con trabajo sin descargar pide confirmación al navegador.
window.addEventListener('beforeunload', (ev) => {
	if (!hayCambiosSinExportar && estadoGuardado !== 'fallo') return;
	ev.preventDefault();
	ev.returnValue = '';
});

recalcular();

/**
 * Hay un proyecto guardado que no se pudo leer: se le da salida al usuario ANTES de dejarle
 * trabajar, porque cualquier cosa que haga a partir de aquí querría guardarse encima.
 *
 * Se le ofrecen las dos únicas salidas honestas: bajarse el archivo tal cual está —para abrirlo
 * con la versión que lo escribió, o para mandarlo— o descartarlo a sabiendas. No hay una tercera:
 * «reparar» un proyecto que no entendemos sería inventarse su contenido.
 */
async function resolverAutoguardadoIlegible(): Promise<void> {
	const p = cargaInicial.problema;
	if (!p?.crudo) return;
	if (p.reparado) { await resolverAutoguardadoReparado(p.motivo, p.crudo); return; }
	const kb = Math.max(1, Math.round(p.crudo.length / 1024));
	const quiereBajarlo = await confirmar(
		`Hay un tablero guardado en este navegador que este programa no puede abrir.\n\n`
		+ `Motivo: ${p.motivo}\n`
		+ `Tamaño: ${kb} KB\n\n`
		+ 'No se ha tocado y no se va a guardar nada encima mientras decides. '
		+ 'Puedes descargarlo tal cual está y abrirlo con la versión del programa que lo escribió.',
		{ ok: 'Descargar la copia' },
	);
	if (quiereBajarlo) {
		descargar('tablero-recuperado.tablero.json', p.crudo, 'application/json');
		avisar('Copia descargada. El guardado automático sigue detenido hasta que empieces de cero.', 'ok');
		// Se ofrece una vez más la decisión: bajar el archivo no implica querer borrarlo.
	}
	const descartar = await confirmar(
		quiereBajarlo
			? '¿Empezar de cero? El tablero que no se pudo abrir se borrará de este navegador.'
			: 'No has descargado la copia. ¿Empezar de cero de todas formas? Se borrará de este navegador.',
		{ ok: 'Empezar de cero', peligro: true },
	);
	if (descartar) {
		guardadoCongelado = false;
		autoguardar();
		avisar('Se empieza de cero. El guardado automático vuelve a funcionar.', 'info');
	} else {
		avisar('El guardado automático sigue DETENIDO para no pisar el tablero anterior. '
			+ 'Descarga tu trabajo con Archivo → Guardar.', 'error');
		estadoGuardado = 'fallo';
		pintarEstadoGuardado('hay un tablero anterior sin recuperar');
	}
}
/**
 * El tablero guardado SÍ se pudo abrir, pero hubo que quitarle algo.
 *
 * Segunda auditoría, TS2-P0-01. Este caso no existía: el arranque cogía el proyecto saneado, tiraba
 * el informe de reparaciones y el primer `autoguardar()` reemplazaba el original. Lo que se
 * quitaba desaparecía sin que nadie lo hubiera visto pasar.
 *
 * Es distinto del ilegible y se trata distinto: aquí el tablero está en pantalla y se puede
 * trabajar. Lo único que no se puede hacer es pisar el original a espaldas de su dueño, así que el
 * guardado se queda quieto hasta que él diga. Y como el original entero sigue ahí, la opción de
 * bajárselo es real: dentro está lo que se quitó.
 */
async function resolverAutoguardadoReparado(motivo: string, crudo: string): Promise<void> {
	const quiereBajarlo = await confirmar(
		'El tablero guardado se abrió, pero hubo que corregirlo para poder abrirlo.\n\n'
		+ `Se quitó: ${motivo}\n\n`
		+ 'La copia original está intacta y NO se va a guardar nada encima mientras decides. '
		+ 'Si lo que se quitó te hace falta, descárgala ahora: dentro está tal cual estaba.',
		{ ok: 'Descargar el original' },
	);
	if (quiereBajarlo) {
		descargar('tablero-original.tablero.json', crudo, 'application/json');
		avisar('Original descargado, sin tocar.', 'ok');
	}
	const aceptar = await confirmar(
		'¿Seguir con el tablero corregido? A partir de ahora el guardado automático '
		+ 'reemplaza la copia original.',
		{ ok: 'Seguir con el corregido' },
	);
	if (aceptar) {
		guardadoCongelado = false;
		autoguardar();
		avisar(`Se sigue con el tablero corregido. Se quitó: ${motivo}.`, 'info');
	} else {
		avisar('El guardado automático sigue DETENIDO para no pisar la copia original. '
			+ 'Descarga tu trabajo con Archivo → Guardar.', 'error');
		estadoGuardado = 'fallo';
		pintarEstadoGuardado('el tablero guardado necesitaba correcciones sin aceptar');
	}
}

void resolverAutoguardadoIlegible();

/* ------------------------- Historial (deshacer/rehacer) ------------------------- */

const pila: string[] = [];      // estados anteriores (JSON)
const rehacerPila: string[] = [];

/**
 * Guarda el estado ACTUAL antes de una mutación, para poder deshacerla.
 *
 * DEVUELVE SI SE PUEDE CAMBIAR EL TABLERO, y quien la llama tiene que mirarlo: en un tablero de
 * ejemplo dice que no y no hay que tocar nada.
 *
 * Que el veto viva aquí no es casualidad. Los ejemplos son para estudiar, y si se pudieran editar
 * bastaría un Supr sin querer para que el que enseña el estrella-triángulo dejara de enseñarlo, sin
 * forma de recuperarlo. Poner la comprobación en cada botón sería olvidarse de uno; ponerla aquí la
 * hereda TODA mutación, porque toda mutación que se pueda deshacer pasa por este punto —es lo que
 * significa poder deshacerla—. Y `test/solo-lectura.test.ts` comprueba que ninguna llamada se salte
 * el resultado.
 *
 * Lo que NO bloquea, a propósito: energizar, accionar los mandos, mirar el esquema, el dossier y la
 * Planta. Eso es USAR el tablero, que es justo para lo que está el ejemplo.
 */
function capturar(): boolean {
	if (!sePuedeEditar()) return false;
	// Solo la señal: aquí todavía no ha cambiado nada, así que guardar ahora escribiría el estado
	// de ANTES. Lo guarda quien haga el cambio, justo después.
	senalarTrabajoSinExportar();
	pila.push(JSON.stringify(proyecto));
	if (pila.length > 60) pila.shift();
	rehacerPila.length = 0;
	actualizarBotonesHistorial();
	return true;
}

/**
 * ¿Se puede cambiar este tablero? En un ejemplo, no, y lo dice.
 *
 * Se puede preguntar SUELTA, y hay que hacerlo antes de cualquier diálogo de confirmación. Si no,
 * pasa lo que pasaba: pulsabas Supr sobre un ejemplo, el programa preguntaba «¿Eliminar -KM1 y sus
 * cables?» —con su botón rojo y todo— y solo después de decir que sí te enterabas de que no se
 * puede. Preguntar por algo que no vas a hacer es una forma rara de decir que no.
 */
function sePuedeEditar(): boolean {
	if (!proyecto.esEjemplo) return true;
	avisarQueEsEjemplo();
	return false;
}

/** Lo dice UNA vez cada pocos segundos: repetirlo en cada clic sería insoportable. */
let ultimoAvisoEjemplo = 0;
function avisarQueEsEjemplo(): void {
	if (Date.now() - ultimoAvisoEjemplo < 4000) return;
	ultimoAvisoEjemplo = Date.now();
	avisar('Este es un tablero de EJEMPLO: se mira y se energiza, pero no se modifica. '
		+ 'Pulsa «Hacer una copia para trabajar» y tendrás el mismo tablero para ti.', 'info');
}

/**
 * REEMPLAZAR EL PROYECTO ENTERO ES TODO O NADA: proyecto, historial Y guardado.
 *
 * Tercera auditoría, TS3-P2-03. Abrir un archivo hacía esto:
 *
 *     capturar();            // apila el estado actual y VACÍA la pila de rehacer
 *     proyecto = abierto;
 *     try { actualizarTodo(); … } catch { proyecto = anterior; … }
 *
 * El `catch` devolvía `proyecto` a su sitio —eso ya se arregló en la segunda auditoría— pero las
 * pilas se quedaban como las había dejado `capturar()`. Medido con el montaje roto a propósito:
 * la pila de deshacer pasaba de 2 a 3 —un paso que no deshace nada— y la de REHACER, de 2 a 0.
 * Perdida del todo, sin decir nada. El caso real no tiene nada de raro: llevas un rato trabajando,
 * deshaces un par de cosas porque te lo estás pensando, pruebas a abrir un archivo que resulta
 * estar mal, y te quedas sin poder rehacer lo tuyo.
 *
 * Además `actualizarTodo()` autoguarda por el camino —`recalcular()` llama a `autoguardar()`—, así
 * que el navegador llegaba a quedarse con el proyecto a medio montar.
 *
 * Aquí se prueba primero y se apunta después: el historial no se toca hasta que el proyecto nuevo
 * está montado y pintado, y mientras se prueba el guardado está congelado. Si algo revienta, las
 * tres cosas se quedan exactamente como estaban.
 */
function reemplazarProyecto(nuevo: Proyecto, ajustes?: () => void): void {
	const anterior = proyecto;
	const instantanea = JSON.stringify(proyecto);
	const pilaAntes = [...pila];
	const rehacerAntes = [...rehacerPila];
	const congeladoAntes = guardadoCongelado;
	guardadoCongelado = true;   // nada se escribe en el navegador mientras esto sea un intento
	/** Deja la pantalla contando lo que hay en `proyecto`, sea el nuevo o el que se recupera. */
	const pintarloTodo = (): void => {
		seleccionar(undefined);
		/*
		 * LA SIMULACIÓN OLVIDA EL TABLERO ANTERIOR.
		 *
		 * La memoria de la maniobra —qué mandos están pulsados, qué bobinas estaban metidas, por
		 * dónde va el reloj— está indexada por el id del aparato, y los ejemplos reparten los mismos
		 * ids: los cinco tienen un `km1`, cuatro tienen un `s1`. Sin esto, quien energiza el arranque
		 * directo, aprieta MARCHA y se va a mirar el estrella-triángulo se lo encuentra ya arrancado
		 * y con el temporizador vencido, o sea enseñando el triángulo sin pasar por la estrella, que
		 * es justo lo único que ese ejemplo tiene que enseñar.
		 */
		panelSim.reiniciar();
		ajustes?.();          // el modo de trabajo, por ejemplo: va DENTRO, para pintar ya con él
		actualizarTodo();
		construirHandles();   // los tiradores son de los aparatos de antes: hay que rehacerlos
		pintarCatalogo();
		pintarEstructura();
	};
	try {
		proyecto = nuevo;
		pintarloTodo();
		encuadrar();
	} catch (fallo) {
		proyecto = anterior;
		pila.length = 0; pila.push(...pilaAntes);
		rehacerPila.length = 0; rehacerPila.push(...rehacerAntes);
		actualizarBotonesHistorial();
		pintarloTodo();
		throw fallo;
	} finally {
		guardadoCongelado = congeladoAntes;
	}
	/*
	 * Salió bien: ahora sí entra en el historial y se escribe, las dos cosas juntas.
	 *
	 * Un ejemplo no marca «trabajo sin descargar»: no es trabajo tuyo. Si lo marcara, al cerrar la
	 * pestaña el navegador preguntaría por un tablero que no es del usuario.
	 */
	if (!proyecto.esEjemplo) senalarTrabajoSinExportar();
	pila.push(instantanea);
	if (pila.length > 60) pila.shift();
	rehacerPila.length = 0;
	actualizarBotonesHistorial();
	autoguardar();
}

/**
 * UN CAMBIO SOBRE EL TABLERO DE AHORA, TAMBIÉN TODO O NADA.
 *
 * Lo mismo que `reemplazarProyecto()`, pero para lo que EDITA el tablero abierto en vez de
 * cambiarlo por otro: la cámara no se toca y la selección la deja quien haga el cambio, porque
 * después de pegar lo pegado tiene que quedar seleccionado.
 *
 * Es el segundo paso de la ruta que propone la tercera auditoría en TS3-P3-01: «No hace falta
 * reescribir el programa entero. Empezar por importación/clipboard y las cinco mutaciones ya
 * cubiertas; mover una familia de operaciones por vez y conservar pruebas de comportamiento».
 * Importar ya pasa por `reemplazarProyecto()`; esto es el portapapeles.
 *
 * El cambio se hace SOBRE `proyecto`, como está escrito todo lo demás —`snapAriel`, `solapaCon`,
 * `xLibreCercano` y `buscarHueco` leen el proyecto global, y hacerlos trabajar sobre un borrador
 * sería reescribir media placa—; lo que se guarda es la foto de antes, para poder volver.
 */
function mutarProyecto(cambiar: () => void): void {
	/*
	 * El veto del ejemplo también aquí, y no por precaución: `mutarProyecto` lleva su propio
	 * historial y NO pasa por `capturar()`, así que se quedaba fuera del bloqueo. Lo cazó la
	 * prueba: en un ejemplo, Ctrl+V pegaba. `reemplazarProyecto` sí puede seguir —cambiar el
	 * tablero entero es justo lo que hace abrir un ejemplo—.
	 */
	if (!sePuedeEditar()) return;
	const instantanea = JSON.stringify(proyecto);
	const pilaAntes = [...pila];
	const rehacerAntes = [...rehacerPila];
	const congeladoAntes = guardadoCongelado;
	guardadoCongelado = true;
	try {
		cambiar();
		actualizarTodo();
	} catch (fallo) {
		proyecto = JSON.parse(instantanea) as Proyecto;
		pila.length = 0; pila.push(...pilaAntes);
		rehacerPila.length = 0; rehacerPila.push(...rehacerAntes);
		actualizarBotonesHistorial();
		aplicarSeleccion(undefined);
		actualizarTodo();
		throw fallo;
	} finally {
		guardadoCongelado = congeladoAntes;
	}
	senalarTrabajoSinExportar();
	pila.push(instantanea);
	if (pila.length > 60) pila.shift();
	rehacerPila.length = 0;
	actualizarBotonesHistorial();
	autoguardar();
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

/*
 * Antes de tocar el 3D se comprueba que el navegador pueda. Si no puede, se explica y se para
 * aquí: seguir sería reventar por dentro y dejar al usuario mirando una pantalla que no responde
 * sin saber por qué (era exactamente lo que pasaba).
 */
if (avisarSiNoSePuede()) throw new Error('El navegador no reúne lo que hace falta para el 3D.');

const contenedor = document.getElementById('escena')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
/*
 * EXPOSICIÓN. Medida, no a ojo: con 1,12 los encuadres cercanos daban una mediana de 196 sobre
 * 255 en el macro de un borne y 173 en la regleta. Eso no es «claro», es TODO amontonado contra
 * el blanco: una cara así no tiene superficie, tiene papel, y ningún bisel de medio milímetro
 * puede leerse sobre ella porque no queda recorrido hacia arriba para que la luz lo marque.
 */
renderer.toneMappingExposure = 1.02;
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
/*
 * 130 mm en vez de 220. El plano cercano está a 25 mm, así que no era él quien impedía acercarse:
 * era este tope. Con 220 mm no se puede poner la vista donde de verdad hace falta para leer la
 * numeración de un borne o ver un tornillo dentro de su pocillo —justo el detalle que las fases
 * anteriores se dedicaron a construir—. A 130 sigue habiendo cinco veces el plano cercano de
 * margen, así que ningún aparato se corta al aproximarse.
 */
controles.minDistance = 130;
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
/*
 * EL ENTORNO ERA EL PRINCIPAL CULPABLE DE LA PLANITUD.
 *
 * `RoomEnvironment` reparte luz desde TODAS las direcciones a la vez. A 0,55 era la fuente
 * dominante de la escena, y una fuente omnidireccional no puede producir sombra ni marcar un
 * canto: da color y quita relieve. Sigue haciendo falta —es lo que hace que un metal refleje
 * algo en vez de un vacío negro— pero como acompañamiento, no como luz principal.
 */
escena.environmentIntensity = 0.34;

// El hemisférico hace lo mismo que el entorno: rellenar desde todas partes. Con los dos a la vez
// no quedaba una sola cara del tablero en penumbra, y sin penumbra no hay volumen.
escena.add(new THREE.HemisphereLight(0xeef3f8, 0x2b3036, 0.3));
/*
 * LA LUZ PRINCIPAL, ahora RASANTE en vez de frontal.
 *
 * Estaba en (500, 750, 900): la componente que más pesaba era la Z, o sea que venía casi de
 * frente, desde detrás de la cámara. Una luz frontal ilumina por igual el fondo de un pocillo y
 * el borde que lo rodea, así que aplasta exactamente lo que la Fase 1 se dedicó a construir:
 * biseles, hombros, rehundidos y tabiques. Es la razón de que un frontal con seis planos
 * distintos se viera como una mancha de color.
 *
 * Ahora domina la altura y el lado, y la componente frontal es la menor de las tres: la luz
 * CRUZA las caras en vez de mirarlas de frente, y cada escalón devuelve su línea de sombra.
 */
const sol = new THREE.DirectionalLight(0xfff6ea, 2.7);
sol.position.set(700, 940, 620);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.camera.near = 10;
sol.shadow.camera.far = 4000;
sol.shadow.camera.left = -1000;
sol.shadow.camera.right = 1000;
sol.shadow.camera.top = 1200;
sol.shadow.camera.bottom = -1200;
/*
 * `bias` mueve la PROFUNDIDAD de la muestra, así que corregirlo con un número grande despega la
 * sombra del objeto (el aparato parece flotar sobre su propia sombra). `normalBias` separa la
 * muestra a lo largo de la normal de la superficie: quita el rayado sin abrir hueco en el
 * contacto. Con las cotas de este modelo —milímetros— 0,7 es lo justo.
 */
sol.shadow.bias = -0.00004;
/*
 * `normalBias` a 0,7 mm era demasiado para lo que hay que resolver ahora. Separa la muestra a lo
 * largo de la normal, así que se come los contactos MÁS PEQUEÑOS que ese desplazamiento: el
 * escalón de un tornillo dentro de su pocillo, el diente de una canaleta contra su pared, la
 * pinza de un aparato apoyada en el labio del carril. Con el tronco de sombras ajustado al
 * gabinete el rayado no vuelve, y a 0,22 mm esos contactos existen.
 */
sol.shadow.normalBias = 0.22;
escena.add(sol);
escena.add(sol.target);
const contraluz = new THREE.DirectionalLight(0x88aaff, 0.3);
contraluz.position.set(-600, 200, -400);
escena.add(contraluz);
/*
 * Relleno frontal muy flojo: los huecos que acaban de aparecer —el pocillo de cada borne, el
 * canal del carril, las ranuras de ventilación— quedaban en negro cerrado, y un agujero negro no
 * se lee como un hueco, se lee como una mancha. Con esto tienen fondo.
 */
const relleno = new THREE.DirectionalLight(0xd6e2f0, 0.42);
relleno.position.set(-260, -340, 900);
escena.add(relleno);

/*
 * ------------------- POR QUÉ AQUÍ NO HAY OCLUSIÓN AMBIENTAL -------------------
 *
 * Se probó GTAO con compositor completo y se descartó MIDIENDO, no por impresión. Dos hallazgos,
 * y el segundo es el que decide:
 *
 * 1. El compositor rompía el color por su cuenta. Con el pase de oclusión QUITADO —solo
 *    RenderPass y OutputPass— la imagen salía exactamente igual de estropeada que con él: el
 *    fondo aplastado a negro puro (41 % del lienzo por debajo de 12/255, contra 0 % sin
 *    compositor) y toda la escena lavada. Es la firma de una conversión de espacio de color
 *    aplicada dos veces, y arreglarla obliga a tocar cómo se pinta TODO —incluida la foto del
 *    dossier y el alzado 2D—.
 *
 * 2. Y aun así no habría servido, porque la oclusión no aportaba nada medible. Compositor sin
 *    GTAO daba mediana 62 y contraste 81,5; con GTAO, 61 y 81,2. Eso es ruido. La razón es de
 *    escala: el radio de oclusión útil aquí son unos milímetros —el pocillo de un tornillo, la
 *    junta entre dos bornas—, y a la distancia a la que se mira un tablero entero esos
 *    milímetros ocupan una fracción de píxel, así que GTAO muestrea dentro de sí mismo y no
 *    encuentra nada que ocluir. Subir el radio hasta que se note produce el halo oscuro
 *    alrededor de cada aparato, que es el defecto que había que evitar.
 *
 * Lo que esta fase quería de la oclusión —que el tornillo se vea DENTRO de su pocillo— se ha
 * conseguido por otro camino y sin coste: quitando el negro pintado de los alojamientos, para
 * que la penumbra la ponga la luz, y bajando `normalBias` para que el mapa de sombras resuelva
 * contactos de un milímetro.
 */

/**
 * EL ÚNICO SITIO DESDE EL QUE SE PINTA.
 *
 * Había tres llamadas sueltas a `renderer.render`: el bucle, la foto del dossier y el calentado
 * de las pruebas. Se dejan centralizadas aquí, que es lo que hizo falta al probar el compositor:
 * cualquier cosa que se ponga entre la escena y el lienzo tiene que valer para las tres, y con
 * llamadas sueltas la foto del dossier salía por un camino distinto del de la pantalla.
 */
function pintar(): void {
	renderer.render(escena, camaraViva());
}

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
	if (coloreaVoltaje) {
		voltajeMap = new Map();
		for (const c of proyecto.conductores) {
			const p = revision.potenciales.porConductor.get(c.id);
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

/**
 * Rompe el próximo montaje de la escena. SOLO en la construcción de pruebas.
 *
 * Tercera auditoría, TS3-P2-03: «No se reprodujo una excepción natural postvalidación en el
 * recorrido normal; es un defecto condicional de atomicidad. Debe probarse inyectando un fallo
 * después de `capturar` y antes del commit». Esto es ese inyector: `montarEscenario()` corre
 * justo ahí, dentro de `actualizarTodo()`, después de que el proyecto ya se haya sustituido.
 */
let romperMontaje = false;

/** Desmonta y vuelve a construir todo el gabinete. */
function montarEscenario(): void {
	if (__QA__ && romperMontaje) { romperMontaje = false; throw new Error('QA: montaje roto a propósito'); }
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
	ajustarSombras();
}

/**
 * LA SOMBRA TIENE QUE PEGARSE AL APARATO, y para eso hay que apretar la cámara de sombras.
 *
 * Estaba clavada en ±1000 × ±1200 mm con un `bias` de −0,0004. Para un tablero de 600 × 800 eso
 * significa que el mapa de 2048 píxeles se reparte sobre 2400 mm: cada píxel de sombra mide más de
 * un milímetro, y el desplazamiento del `bias` sobre esa escala DESPEGA la sombra del objeto que
 * la hace. Un aparato con la sombra corrida cuatro milímetros no se lee apoyado: se lee flotando,
 * que es exactamente la queja de «se ven en el aire las cosas».
 *
 * Ajustando el tronco al gabinete de verdad, el mismo mapa cae sobre 800 mm en vez de 2400: la
 * sombra de contacto sale tres veces más fina y nace donde el aparato toca. Y el desplazamiento se
 * hace con `normalBias`, que separa la muestra a lo largo de la normal en vez de mover el objeto
 * entero: quita el rayado sin despegar el contacto.
 */
function ajustarSombras(): void {
	const g = proyecto.gabinete;
	if (!g) return;
	const caja = cajaDe(g);
	/*
	 * EL TRONCO ERA CUADRADO Y EL TABLERO NO LO ES.
	 *
	 * Se cogía `max(ancho, alto)` para los cuatro lados, así que en un tablero de 600 × 850 el mapa
	 * cubría 850 × 850: la quinta parte de sus píxeles caía sobre aire a los dos costados. Cada
	 * píxel de sombra desperdiciado ahí es un píxel que le falta al contacto de un tornillo.
	 *
	 * Con los dos semiejes por separado el mismo mapa se reparte solo sobre lo que hay, y el
	 * contacto sale más fino sin costar un milisegundo más —medido—. El margen es para que la
	 * sombra de lo que sobresale del gabinete no se corte de golpe en el borde.
	 */
	const mx = caja.ancho / 2 + 60;
	const my = caja.alto / 2 + 60;
	sol.shadow.camera.left = -mx;
	sol.shadow.camera.right = mx;
	sol.shadow.camera.top = my;
	sol.shadow.camera.bottom = -my;
	sol.shadow.camera.near = 100;
	sol.shadow.camera.far = 3000;
	sol.shadow.camera.updateProjectionMatrix();
	// El sol apunta al centro del tablero: si mira al origen del mundo, con el tablero desplazado
	// el tronco de sombras se queda a un lado y media placa se dibuja sin sombra ninguna.
	sol.target.position.set(0, 0, caja.profundidad / 2);
	sol.target.updateMatrixWorld();
}

/** Recalcula, reconstruye y repinta todo (tras un cambio estructural). */
function actualizarTodo(): void {
	pintarChipEjemplo();   // el aviso de «esto es un ejemplo» sigue al tablero que haya abierto
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
	pintarChipEjemplo();
}

/* --------------------------- Utilidades UI --------------------------- */

/**
 * El color con el que se dibujaría un aparato si nadie lo ha elegido.
 *
 * Hace falta para que el selector de color arranque enseñando el color REAL del aparato y no un
 * negro genérico: si el cuadrito no coincide con lo que se ve en el tablero, el usuario cree que
 * ya lo ha cambiado cuando todavía no ha tocado nada.
 */
function colorPorDefectoDe(d: Dispositivo): string {
	if (d.colorCuerpo) return d.colorCuerpo;
	return '#' + colorDeTipo(d.tipo).toString(16).padStart(6, '0');
}


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
			cont.insertAdjacentHTML('beforeend', `<div class="grupo-catalogo">${escaparHtml(p.grupo)}</div>`);
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
		btn.innerHTML = `<span class="chip-color" style="background:${escaparHtml(p.color)}"></span>`
			+ `<span class="nombre">${escaparHtml(p.nombre)}</span><span class="mas">＋</span>`;
		btn.onclick = () => anadirDesdeCatalogo(p.id);
		cont.appendChild(btn);
	}
	/*
	 * Segunda auditoría, TS2-P1-05. Esto era `«${busqueda}»` a pelo dentro de `innerHTML`, y lo que
	 * hay ahí es LO QUE ACABA DE TECLEAR EL USUARIO. Comprobado por la auditoría: buscando
	 * `<em data-audit-marker="codex">sin-coincidencia</em>` aparecía un `<em>` de verdad dentro de
	 * `.catalogo-vacio`, o sea que el texto se estaba interpretando como marcado.
	 *
	 * Aquí no hay nada que dibujar con etiquetas: es un mensaje con el término buscado dentro. Así
	 * que se construye con nodos y `textContent`, que no puede interpretar nada por definición.
	 */
	if (!encontrados) {
		cont.textContent = '';
		const caja = document.createElement('div');
		caja.className = 'catalogo-vacio';
		caja.textContent = `Ningún aparato coincide con «${busqueda}».`;
		cont.appendChild(caja);
	}
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
		if (!capturar()) return;
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
	if (!capturar()) return;
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

	const clase = original.clase ?? CLASE_POR_TIPO[original.tipo];
	let maximo = 0;
	for (const d of proyecto.dispositivos) {
		if ((d.clase ?? CLASE_POR_TIPO[d.tipo]) === clase && d.numero) maximo = Math.max(maximo, d.numero);
	}
	const numero = maximo + 1;
	const copia: Dispositivo = {
		...structuredClone(original),
		id: idUnico('d'),
		numero,
		designacion: (original.designacion ?? '').replace(/\d+$/, '') + numero,
	};

	/*
	 * PRIMERO se busca sitio, y solo si lo hay se toca el proyecto.
	 *
	 * La copia entraba en `proyecto.dispositivos` ANTES de saber si cabía, y cuando no había hueco
	 * la función hacía `return` dejándola dentro. Ese aparato no se veía —no tenía colocación—
	 * pero contaba en la lista de materiales, en el DRC y en el archivo guardado: un fantasma que
	 * acababa en el presupuesto del cliente. Y `capturar()` metía además un paso de historial por
	 * una operación que no llegó a hacer nada, así que el primer Ctrl+Z no deshacía nada visible.
	 *
	 * Se llega ahí cuando `buscarHueco` falla, y eso solo pasa si el gabinete se ha quedado SIN
	 * NINGÚN RIEL —quitar un riel no se lleva por delante los aparatos que tenía encima, así que
	 * un tablero con aparatos y cero rieles es un estado normal— y además la fila del original
	 * está ocupada de lado a lado.
	 */
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
	if (!capturar()) return;
	proyecto.dispositivos.push(copia);
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
	if (!sePuedeEditar()) return;   // antes de preguntar: ver `sePuedeEditar`
	const nombre = etiquetaDe(id);
	if (!(await confirmar(`¿Eliminar ${nombre} y sus cables?`, { ok: 'Eliminar', peligro: true }))) return;
	if (!capturar()) return;
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
		li.innerHTML = `<span class="des">${escaparHtml(d.designacion ?? d.id)}</span>`
			+ `<span class="desc">${escaparHtml(d.descripcion ?? '')}</span>`;
		li.onclick = () => seleccionar(d.id);
		lista.appendChild(li);
	}

	const drc = $('lista-drc');
	drc.innerHTML = '';
	if (revision.hallazgos.length === 0) drc.innerHTML = '<li class="hallazgo ok">Sin errores ni avisos</li>';
	for (const h of revision.hallazgos) {
		const li = document.createElement('li');
		li.className = `hallazgo ${h.severidad}`;
		li.textContent = h.mensaje;
		if (h.dispositivoId) {
			li.style.cursor = 'pointer';
			li.onclick = () => seleccionar(h.dispositivoId);
		}
		drc.appendChild(li);
	}
	const errores = revision.hallazgos.filter((h) => h.severidad === 'error').length;
	const avisos = revision.hallazgos.length - errores;
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
		const colorCss = c.color ? hexColor(colorDeCable(c.color, 0x888888)) : '#888';
		li.innerHTML = `<span class="via" style="background:${colorCss}"></span>
			<span class="num">${escaparHtml(String(c.numero ?? '—'))}</span>
			<span class="ruta">${escaparHtml(`${extremoTexto(proyecto, c.de)} → ${extremoTexto(proyecto, c.a)}`)}</span>
			<span class="estado">${escaparHtml(estado)}</span>`;
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
		<!-- Las designaciones salen del archivo: escapadas. Tercera auditoría, TS3-P1-04: dos
		     marcados con markup creaban DOS NODOS de verdad aquí, aunque el texto se leyera bien. -->
		<p class="pista">${escaparHtml(nombres)}</p>
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
	const propios = revision.hallazgos.filter((h) => h.dispositivoId === d.id);
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
		// El mensaje del DRC lleva dentro la designación del aparato, o sea, texto del archivo.
		// La lista general de abajo ya usaba `textContent`; esta se había quedado atrás.
		? `<h2>Hallazgos DRC</h2><ul>${propios.map((h) => `<li class="hallazgo ${escaparHtml(h.severidad)}">${escaparHtml(h.mensaje)}</li>`).join('')}</ul>`
		: '';
	const bloqueCableado = esEditor ? '' : `
		<h2>Cables conectados ${metros ? `· ${(metros / 1000).toFixed(2)} m` : ''}</h2>
		<div id="cables-aparato">${cablesDelAparato.length === 0 ? '<div class="sub">Sin cables todavía</div>' : ''}</div>
		<div class="sub" style="margin:8px 0;padding:8px;background:var(--panel-2);border-radius:8px">💡 <b>Lo más fácil:</b> toca un <b>borne</b> (punto naranja) de un aparato y luego otro en el tablero, y el cable se conecta solo. O usa el formulario de abajo.</div>
		<h2>Conectar cable nuevo</h2>
		<div class="form-cable">
			<select id="cable-borne-origen" title="Borne de este aparato">
				${d.bornes.map((b) => `<option value="${escaparHtml(b.id)}">${escaparHtml(`${d.designacion ?? d.id}:${b.id}`)}${b.tipo && b.tipo !== 'otro' ? ` · ${escaparHtml(b.tipo)}` : ''}</option>`).join('')}
			</select>
			<select id="cable-destino" title="Aparato de destino">
				<option value="">— destino —</option>
				${otrosAparatos.map((o) => `<option value="${escaparHtml(o.id)}">${escaparHtml(o.designacion ?? o.id)} ${o.descripcion ? `· ${escaparHtml(o.descripcion.slice(0, 22))}` : ''}</option>`).join('')}
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
			<!-- El COLOR del aparato. Lo ponía el catálogo y no había forma de cambiarlo, así que
			     dos contactores de marcas distintas salían idénticos y un piloto rojo de defecto
			     no se podía distinguir de uno verde de marcha. Ahora se elige, y vale también
			     para los aparatos de campo (la lámpara alumbra con ESE color). -->
			<label>Color<span class="fila-color">
				<input id="dev-color" type="color" value="${escaparHtml(d.colorCuerpo ?? colorPorDefectoDe(d))}">
				<button type="button" id="dev-color-reset" title="Volver al color del catálogo">↺</button>
			</span></label>
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
		<h1>${escaparHtml(d.designacion ?? d.id)}</h1>
		<div class="sub">${esImagen ? '🖼️ Imagen de referencia' : escaparHtml(d.descripcion ?? '')}
			<span style="opacity:.7">· ${esEditor ? '🔧 editor' : '🔌 trabajo'}</span></div>
		<dl>
			${esImagen ? '' : `<dt>Referencia</dt><dd>${escaparHtml(d.fabricante ?? '—')} ${escaparHtml(d.referencia ?? '')}</dd>`}
			${col ? `<dt>Posición en placa</dt><dd>x ${Math.round(col.x)} mm · y ${Math.round(col.y)} mm · ${col.ancho}×${col.alto} mm</dd>` : ''}
			${d.tensionNominal !== undefined ? `<dt>Tensión</dt><dd><span class="chip-volt" style="background:${hexColor(colorVoltaje(d.tensionNominal))}">${d.tensionNominal} V</span></dd>` : ''}
			${esImagen ? '' : `<dt>Posición en esquema</dt><dd>${revision.posicionesEsquema.get(d.id) ?? '—'}</dd>`}
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
			// El número del hilo, los ids de borne y la designación salen del ARCHIVO, y un archivo
			// se toca a mano y llega por correo. Van escapados, como todo lo que no escribimos aquí.
			fila.innerHTML = `<span class="num">${escaparHtml(String(c.numero ?? '—'))}</span>
				<span>${escaparHtml(propio.borneId)} → ${escaparHtml(etiquetaDe(otro.dispositivoId))}`
				+ `:${escaparHtml(otro.borneId)}${c.seccion ? ` · ${escaparHtml(String(c.seccion))} mm²` : ''}</span>
				<button class="quitar" title="Quitar cable">✕</button>`;
			(fila.querySelector('.quitar') as HTMLButtonElement).onclick = () => {
				if (!capturar()) return;
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
				? destino.bornes.map((b) => `<option value="${escaparHtml(b.id)}">${escaparHtml(b.id)}${b.tipo && b.tipo !== 'otro' ? ` · ${escaparHtml(b.tipo)}` : ''}</option>`).join('')
				: '<option>borne…</option>';
		};
		btnConectar.onclick = () => {
			const destino = selDestino.value;
			if (!destino) return;
			if (!capturar()) return;
			proyecto.conductores.push({
				id: idUnico('c'),
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
			if (!capturar()) return;
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
		// El color se aplica al soltar (`change`) y rehace la escena: el aparato se repinta.
		texto('dev-color', (v) => { d.colorCuerpo = v || undefined; }, true);
		const btnColor = panel.querySelector('#dev-color-reset') as HTMLButtonElement | null;
		if (btnColor) btnColor.onclick = () => aplicar(() => { d.colorCuerpo = undefined; }, true);
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
					'DO1 = DI1 Y NO DI2               ; ventilador: marcha pedida y sin alarma',
					'DO2 = DO1 retardo 5              ; compuerta, 5 s después',
					'AO1 = 0 a 10 según UI1 de 18 a 22 ; válvula de calor, abre a medida que enfría',
					'AO2 = 10 a 0 según UI1 de 23 a 27 ; compuerta de free-cooling, al revés',
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
				if (!capturar()) return;
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
			if (!capturar()) return;
			const z = col.z ?? 0;
			const destino = paso > 0
				? (z < Z_IMAGEN_FRENTE ? Z_IMAGEN_FRENTE : z + 20)
				: (z > Z_IMAGEN_FONDO ? Z_IMAGEN_FONDO : z - 10);
			col.z = Math.max(-40, Math.min(140, Math.round(destino)));
			reconstruirDispositivoUno(d.id);
			pintarSeleccion();
			marcarSucio();
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
			fila.innerHTML = `<span class="num">◉</span><span>${escaparHtml(b.id)}</span>
				<button class="quitar" title="Quitar punto">✕</button>`;
			(fila.querySelector('.quitar') as HTMLButtonElement).onclick = () => {
				if (!capturar()) return;
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
		<h1>${esCanaleta ? '📦 Canaleta' : '➖ Riel DIN'} ${escaparHtml(obj.id)}</h1>
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
		if (!capturar()) return;
		const nueva: 'h' | 'v' = esV ? 'h' : 'v';
		if (can) can.orientacion = nueva;
		else (obj as typeof g.rieles[number]).orientacion = nueva;
		actualizarTodo();
		pintarEstructura();
		pintarPanelEstructura(s); // refrescar el propio panel (texto del botón)
	};
	(panel.querySelector('#e-aplicar') as HTMLButtonElement).onclick = () => {
		if (!capturar()) return;
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
		<div class="sub">${escaparHtml(`${extremoTexto(proyecto, c.de)} → ${extremoTexto(proyecto, c.a)}`)}</div>
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
		if (!capturar()) return;
		c.seccion = Number((e.target as HTMLSelectElement).value);
		recalcular(); reconstruirCables(); pintarPaneles();
	};
	(panel.querySelector('#cbl-color') as HTMLSelectElement).onchange = (e) => {
		if (!capturar()) return;
		c.color = (e.target as HTMLSelectElement).value;
		reconstruirCables();
		marcarSucio();   // cambiar el color no recalcula nada, pero SÍ hay que guardarlo
	};
	(panel.querySelector('#cbl-auto') as HTMLButtonElement | null)?.addEventListener('click', () => {
		if (!capturar()) return;
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
		<div class="fila-estructura" data-tipo="${tipo}" data-id="${escaparHtml(r.id)}">
			<span class="id">${escaparHtml(r.id)}</span>
			<input type="number" data-campo="x" value="${Math.round(r.x)}">
			<input type="number" data-campo="y" value="${Math.round(r.y)}">
			<input type="number" data-campo="largo" value="${Math.round(r.largo)}">
			<button title="Quitar" data-quitar>✕</button>
		</div>`).join('');

	$('lista-rieles').innerHTML = filas(g.rieles, 'riel');
	$('lista-canaletas').innerHTML = filas(g.canaletas, 'canaleta');

	for (const btn of document.querySelectorAll('[data-quitar]')) {
		(btn as HTMLButtonElement).onclick = (ev) => {
			if (!capturar()) return;
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
	if (!capturar()) return;
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
	if (!capturar()) return;
	const g = proyecto.gabinete!;
	g.rieles.push({ id: siguienteId('riel', g.rieles), x: 30, y: Math.round(g.alto / 2), largo: g.ancho - 60 });
	actualizarTodo();
	pintarEstructura();
};
($('btn-add-can-h') as HTMLButtonElement).onclick = () => {
	if (!capturar()) return;
	const g = proyecto.gabinete!;
	g.canaletas.push({
		id: siguienteId('ch', g.canaletas), x: 20, y: Math.round(g.alto / 2) + 80,
		largo: g.ancho - 40, orientacion: 'h', ancho: g.canaletas[0]?.ancho ?? 40, alto: g.canaletas[0]?.alto ?? 60,
	});
	actualizarTodo();
	pintarEstructura();
};
($('btn-add-can-v') as HTMLButtonElement).onclick = () => {
	if (!capturar()) return;
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

/*
 * ------------------------------ CÓMO SE MARCA LO SELECCIONADO ------------------------------
 *
 * Se bañaba el aparato ENTERO en emisión azul a 0,4. El resultado es que un contactor negro con
 * su serigrafía, sus tornillos y sus bornes se convertía en una mancha azul uniforme: al
 * seleccionarlo se perdía de vista exactamente la pieza que se acababa de elegir, que es lo
 * contrario de lo que tiene que hacer una selección. Y en un programa técnico eso además no se
 * lee como «seleccionado», se lee como «recoloreado».
 *
 * Ahora hay dos señales, y ninguna tapa el objeto: un realce de emisión MUY leve —lo justo para
 * que la pieza se despegue del fondo— y un MARCO de aristas alrededor de su volumen, que es como
 * marca la selección cualquier programa de CAD. El marco dice dónde empieza y acaba el aparato
 * sin taparle ni un tornillo.
 */
let marcoSeleccion: THREE.LineSegments | undefined;
let marcoHover: THREE.LineSegments | undefined;
let hoverDispositivo: string | undefined;

function limpiarResaltado(): void {
	for (const m of resaltados) m.emissive.setHex(0x000000);
	resaltados = [];
	if (marcoSeleccion) {
		escena.remove(marcoSeleccion);
		marcoSeleccion.geometry.dispose();
		marcoSeleccion = undefined;
	}
	// Y el del hover, que si no se queda flotando sobre un aparato que ya no existe al reconstruir.
	hoverDispositivo = undefined;
	if (marcoHover) {
		escena.remove(marcoHover);
		marcoHover.geometry.dispose();
		marcoHover = undefined;
	}
}

/**
 * Un marco de aristas alrededor del volumen de un objeto. No intercepta el ratón NUNCA: un helper
 * visual que se cuela en el raycast convierte «marcar dónde está el aparato» en «no poder pinchar
 * lo que hay detrás», que es peor que no marcarlo.
 */
function marcoDe(raiz: THREE.Object3D, color: number, opacidad: number, holgura: number): THREE.LineSegments | undefined {
	const caja = new THREE.Box3().setFromObject(raiz);
	if (caja.isEmpty()) return undefined;
	const tam = caja.getSize(new THREE.Vector3());
	const centro = caja.getCenter(new THREE.Vector3());
	// Un pelo más grande que el objeto: pegado al milímetro, el marco se metería dentro de las
	// caras y aparecería a trozos según el ángulo.
	const geo = new THREE.EdgesGeometry(
		new THREE.BoxGeometry(tam.x + holgura, tam.y + holgura, tam.z + holgura),
	);
	const m = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
		color, transparent: true, opacity: opacidad, depthTest: false,
	}));
	m.position.copy(centro);
	m.renderOrder = 998;
	m.raycast = () => {};
	escena.add(m);
	return m;
}

function marcarVolumen(raiz: THREE.Object3D, color: number): void {
	marcoSeleccion = marcoDe(raiz, color, 0.95, 3);
}

/**
 * HOVER DE APARATO: solo el marco, y más tenue que el de selección.
 *
 * Los cables y los bornes ya respondían al puntero; los aparatos no, así que al pasar por encima
 * de un contactor no había forma de saber que era clicable hasta pulsarlo. Se resuelve con el
 * mismo lenguaje que la selección —marco de aristas, como en un CAD— y sin tocar ni un material:
 * el hover no puede alterar el aspecto del aparato, porque es una respuesta al puntero, no un
 * estado del tablero. Así los cuatro estados no se pisan: el hover pone un contorno tenue, la
 * selección uno firme más un realce mínimo, y la energización enciende los conductores.
 */
function resaltarHoverDispositivo(id: string | undefined): void {
	if (id === hoverDispositivo) return;
	hoverDispositivo = id;
	if (marcoHover) {
		escena.remove(marcoHover);
		marcoHover.geometry.dispose();
		marcoHover = undefined;
	}
	// El que ya está seleccionado no necesita hover: tiene su propio marco, y dos marcos
	// superpuestos solo dicen que hay dos marcos.
	if (!id || (sel?.tipo === 'dispositivo' && sel.id === id)) return;
	const g = grupoDe(id);
	if (g) marcoHover = marcoDe(g, 0xbcd8ee, 0.5, 2);
}

/*
 * 0,03, elegido comparando 0 / 0,03 / 0,06 en el mismo encuadre.
 *
 * A 0,06 el contactor salía visiblemente azul frente a sus vecinos: se localizaba, pero dejaba de
 * ser el mismo material. A 0 el aparato queda idéntico a KM2 y KM3 y solo lo marca el contorno,
 * que en una escena cargada obliga a buscarlo. A 0,03 el material se mantiene —sigue leyéndose
 * como el mismo plástico negro— y aun así el ojo va solo hasta él.
 */
let realceSel = 0.03;

function resaltarObjeto(raiz: THREE.Object3D | undefined, color = 0x1d4ed8, intensidad = realceSel): void {
	/*
	 * La emisión se queda en 0,06 y no más. Sobre un contactor casi negro no hay color base con el
	 * que competir, así que CUALQUIER emisión manda: a 0,14 el aparato seguía saliendo azul entero.
	 * Quien marca la selección es el marco; la emisión solo despega la pieza del fondo lo justo
	 * para que se vea que está viva.
	 */
	if (!raiz) return;
	raiz.traverse((o) => {
		// La serigrafía no se realza: es tinta impresa, y encenderla convierte los números en
		// manchas de color justo cuando el usuario se ha acercado a leerlos.
		if (o.userData.esMarca) return;
		if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
			o.material = o.material.clone();
			o.material.emissive.setHex(color);
			o.material.emissiveIntensity = intensidad;
			resaltados.push(o.material);
		}
	});
	marcarVolumen(raiz, color === 0xff3b3b ? 0xff7a7a : 0x8fd4ff);
}

function resaltarPorUserData(clave: 'canaletaId' | 'rielId', id: string): void {
	escenario.raiz.traverse((o) => {
		if (o.userData[clave] === id && o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) {
			o.material = o.material.clone();
			o.material.emissive.setHex(0x1d4ed8);
			o.material.emissiveIntensity = 0.2;
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
	if (!sePuedeEditar()) return;
	const ids = aparatosSeleccionados();
	if (ids.length <= 1) { if (ids[0]) await eliminarDispositivo(ids[0]); return; }
	const cables = proyecto.conductores.filter(
		(c) => ids.includes(c.de.dispositivoId) || ids.includes(c.a.dispositivoId),
	).length;
	const detalle = cables ? ` y sus ${cables} cables` : '';
	if (!(await confirmar(`¿Eliminar ${ids.length} aparatos${detalle}?`, { ok: 'Eliminar', peligro: true }))) return;
	if (!capturar()) return;
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
	if (!capturar()) return;

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
	tip.innerHTML = `${escaparHtml(`${d?.designacion ?? b.dispositivoId}:${b.borneId}`)} `
		+ `<span class="estado">· ${escaparHtml(estado)}</span>`;
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
	if (!capturar()) return;
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
	if (!capturar()) return;
	const codos = codosCableado.slice(); // los codos marcados al tender el cable quedan fijados
	proyecto.conductores.push({
		id: idUnico('c'),
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

/**
 * Longitud del cable (mm) por su recorrido ortogonal real. Es la MISMA cuenta que se le pasa al
 * DRC y al PDF —vive en `escena3d`—: tenerla dos veces era pedir que el total del panel y la
 * caída de tensión del papel acabaran discrepando.
 */
function longitudCableMm(c: Conductor): number {
	return largoDibujadoMm(proyecto, c);
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
/**
 * Dónde se puede tender cable, en mm de modelo.
 *
 * No es la placa a secas: un cable rodea su borde, y los que van a campo BAJAN hasta la línea de
 * los prensaestopas, que está por debajo de la placa. Es el mismo terreno que usa el ruteo
 * automático, así que a mano se puede llegar exactamente adonde llega solo.
 */
function areaDeCableado(): { x0: number; x1: number; y0: number; y1: number } {
	const g = proyecto.gabinete;
	const margen = 10;
	return {
		x0: -margen, x1: (g?.ancho ?? 0) + margen,
		y0: -margen, y1: yEntradasCampo(proyecto),
	};
}

/**
 * Huellas que un cable NO puede cruzar por encima.
 *
 * Las imágenes de referencia quedan fuera a propósito: son la foto del tablero de verdad, y
 * cablear sobre ellas es justo para lo que están.
 */
function huellasQueEsquivarLosCables(): Huella[] {
	const g = proyecto.gabinete;
	if (!g) return [];
	return g.colocaciones
		.filter((c) => !proyecto.dispositivos.find((d) => d.id === c.dispositivoId)?.imagen)
		.map((c) => ({ x: c.x, y: c.y, ancho: c.ancho, alto: c.alto }));
}

/** Punto de cable ya recortado al área, fuera de los aparatos y redondeado al milímetro. */
function puntoDeCableValido(x: number, y: number): { x: number; y: number } {
	const dentro = dentroDelArea({ x, y }, areaDeCableado());
	const libre = fueraDeLaHuella(dentro, huellasQueEsquivarLosCables());
	return { x: Math.round(libre.x), y: Math.round(libre.y) };
}

/**
 * Repasa los peinados hechos a mano y saca de encima de los aparatos los puntos que hayan
 * quedado ahí. Se llama al SOLTAR un aparato o un riel: son los movimientos que pueden dejar
 * un cable cruzando por encima de algo sin que nadie haya tocado el cable.
 */
/** Si el saneado tuvo que mover algo, se dice: nadie debe encontrarse cambios sin explicación. */
function avisarSiSeMovioAlgunCable(cuantos: number): void {
	if (!cuantos) return;
	avisar(`${cuantos} punto${cuantos > 1 ? 's' : ''} de cable se apartó del aparato para no cruzarlo por encima`, 'info');
}

function sanearTrazados(): number {
	let arreglados = 0;
	for (const c of proyecto.conductores) {
		if (!c.trazado?.length) continue;
		for (let i = 0; i < c.trazado.length; i++) {
			const antes = c.trazado[i];
			const ahora = puntoDeCableValido(antes.x, antes.y);
			if (ahora.x !== antes.x || ahora.y !== antes.y) { c.trazado[i] = ahora; arreglados++; }
		}
	}
	return arreglados;
}

function moverWaypoint(c: Conductor, idx: number, x: number, y: number): void {
	const wps = c.trazado;
	if (!wps || !wps[idx]) return;
	const p = salidasDeCable(proyecto, c);
	const prev = idx > 0 ? wps[idx - 1] : p?.salidaA;
	const next = idx < wps.length - 1 ? wps[idx + 1] : p?.salidaB;
	// Primero se encierra en el área y luego se alinea: así el recorte nunca desalinea un tramo
	// que el usuario acaba de dejar recto.
	const dentro = puntoDeCableValido(x, y);
	let nx = dentro.x;
	let ny = dentro.y;
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
		if (!capturar()) return;
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
	if (!capturar()) return;
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
	// cae sobre una unión existente, se mueve esa; si no hay unión ahí, el cable NO se deforma:
	// las uniones se crean con doble clic y solo así (ver `crearUnionBajoElPuntero`, que explica
	// por qué). Los aparatos solo tienen prioridad si están DELANTE del cable.
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
			/*
			 * CADA COSA SE BUSCA UNA VEZ.
			 *
			 * Aquí se lanzaba `cableBajoElPuntero` dos veces por cada movimiento del ratón —una
			 * para el resaltado y otra para decidir el cursor— y al añadir el hover de aparato iban
			 * a ser tres trazados de rayo por movimiento sobre una escena con cincuenta cables. El
			 * resultado se guarda y se reutiliza: el hover de aparato sale más barato que antes de
			 * existir, porque de paso quita el trazado duplicado que ya había.
			 *
			 * El aparato bajo el puntero sale de `elementoBajoElPuntero`, que es EXACTAMENTE la
			 * misma función que decide qué se selecciona al pulsar. No hay un segundo criterio: con
			 * uno propio, el hover podría iluminar un aparato y el clic elegir otro.
			 */
			const cid = b ? undefined : cableBajoElPuntero(ev);
			resaltarHoverCable(cid);
			const bajo = b || cid || cableandoDesde ? undefined : elementoBajoElPuntero(ev);
			resaltarHoverDispositivo(bajo?.tipo === 'dispositivo' ? bajo.id : undefined);
			if (cableandoDesde) {
				const p = puntoCable(ev);
				if (p) actualizarGomaCable(p.x, p.y);
				// Un temblor de la mano no es un arrastre: hasta 5 px recorridos sigue siendo clic.
				if (arrastreDeCableado) {
					arrastreDeCableado.recorrido += Math.hypot(ev.movementX || 0, ev.movementY || 0);
					if (arrastreDeCableado.recorrido > 5) arrastreDeCableado.movido = true;
				}
			}
			renderer.domElement.style.cursor = b || cableandoDesde ? 'crosshair' : (cid ? 'grab' : '');
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
			if (!capturar()) return;
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
	if (!capturadoEsteArrastre) { if (!capturar()) return; capturadoEsteArrastre = true; }
	// Antes de tocar nada: foto del riel y de sus aparatos, por si hay que devolverlos.
	if (!estadoRielArrastre && sel.tipo === 'riel') estadoRielArrastre = capturarEstadoRiel(sel.id);
	const g = proyecto.gabinete!;

	// --- Redimensionar / ordenar con un tirador ---
	if (handleArrastrado) {
		if (sel.tipo === 'cable') {
			// Mover el punto de quiebre del tirador (o crear el primero si el cable no tenía).
			const c = proyecto.conductores.find((x) => x.id === sel!.id)!;
			if (handleArrastrado.indice === undefined || handleArrastrado.indice < 0) {
				c.trazado = [puntoDeCableValido(p.x, p.y)];
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
		avisarSiSeMovioAlgunCable(sanearTrazados());
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
		marcarSucio();
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
	avisarSiSeMovioAlgunCable(sanearTrazados());

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
	if (!capturar()) return false;
	insertarWaypoint(c, p.x, p.y);
	reconstruirCables();
	construirHandles();
	pintarPaneles();
	pintarSeleccion();
	marcarSucio();
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
			if (!capturar()) return;
			c.trazado.splice(handle.indice, 1);
			if (c.trazado.length === 0) delete c.trazado;
			reconstruirCables();
			construirHandles();
			pintarPaneles();
			pintarSeleccion();
			marcarSucio();
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
	const foco = document.activeElement as HTMLElement | null;
	const activo = foco?.tagName;
	/*
	 * Escribiendo, las teclas son para escribir: Supr borra letras y no aparatos.
	 *
	 * `isContentEditable` no es un extra: el texto del dossier son bloques `contenteditable`, o
	 * sea `<div>`, no `<input>`. Mirando solo el nombre de la etiqueta, corregir un párrafo del
	 * informe y darle a Supr para borrar una letra le abría a uno «¿Eliminar -Q1 y sus cables?»,
	 * y Ctrl+Z deshacía un cambio del tablero en vez de lo que acababa de escribir.
	 *
	 * Escape es la excepción, y por eso se deja pasar. Las ventanas con campos —los datos del
	 * proyecto, el controlador— ponen el cursor en el primer recuadro al abrirse, así que con la
	 * regla a secas Escape no cerraba NINGUNA de ellas: escribías el nombre del cliente, pulsabas
	 * Escape y no pasaba nada. Cerrar con Escape es lo que hace cualquier programa.
	 */
	const escribiendo = activo === 'INPUT' || activo === 'SELECT' || activo === 'TEXTAREA'
		|| !!foco?.isContentEditable;
	if (escribiendo && ev.key !== 'Escape') return;

	/*
	 * CADA HERRAMIENTA ATIENDE SUS PROPIAS TECLAS.
	 *
	 * La Planta 3D y la ventana de Inicio ocupan la pantalla ENTERA: con cualquiera de las dos
	 * delante, del tablero no se ve ni un tornillo. Y sin embargo sus atajos seguían llegando.
	 * Comprobado: con la Planta abierta, Ctrl+Z deshacía un cambio del tablero sin que se notara
	 * nada —el aparato desaparecía detrás—, y Supr abría un «¿Eliminar -Q1 y sus cables?» sobre
	 * el plano de la cubierta, preguntando por un aparato que no estabas mirando.
	 *
	 * ESCAPE ES LA EXCEPCIÓN Y TIENE QUE PASAR. No es un atajo de edición: es la tecla de «cierra
	 * lo que está encima», y este manejador es el ÚNICO sitio donde se cierran las ventanas. Al
	 * bloquearlo aquí, con la ventana de Inicio delante —que es CÓMO ARRANCA el programa—, la guía
	 * rápida y los datos del proyecto dejaban de cerrarse con el teclado. Lo cazó `qa/entrega.mjs`
	 * sobre el archivo empaquetado, que es el único que arranca en Inicio de verdad; las demás
	 * suites entran con `?inicio=0` y no pasaban por ahí.
	 *
	 * Se sale sin tocar `preventDefault`: la Planta tiene su propio manejador de teclas (WASD,
	 * H para los paneles) y le tienen que seguir llegando.
	 */
	if (!($('mundo') as HTMLElement).hidden || !($('inicio') as HTMLElement).hidden) {
		if (ev.key === 'Escape') cerrarVentanasDeArriba();
		return;
	}

	/*
	 * Y con un diálogo bloqueante delante, mandan sus dos teclas y ninguna más.
	 *
	 * Estando abierto un «¿Eliminar…?», otro Supr encolaba una segunda pregunta detrás de la
	 * primera. El propio diálogo escucha Enter y Escape, así que basta con quitarse de en medio.
	 */
	if (!($('modal-dialogo') as HTMLElement).hidden) return;

	/*
	 * Con una ventana abierta encima —ayuda, ejemplos, datos del proyecto, DRC, el puente con la
	 * Planta— o con el dossier delante, la única tecla que conserva sentido es Escape, que es la
	 * que las cierra. Supr, Ctrl+Z o Ctrl+V estarían editando el tablero de debajo a ciegas.
	 */
	const ventanaEncima = [...document.querySelectorAll<HTMLElement>('[id^="modal-"]')]
		.some((el) => el.id !== 'modal-dialogo' && !el.hidden)
		|| !($('panel-dossier') as HTMLElement).hidden;
	if (ventanaEncima && ev.key !== 'Escape') return;

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
		/*
		 * Escape cierra lo que esté abierto encima, y luego va soltando lo que se esté haciendo.
		 *
		 * Se BUSCAN las ventanas abiertas en vez de llevar una lista escrita a mano: la lista se
		 * quedó corta —cerraba tres de las nueve, así que la ayuda, los ejemplos y la explicación
		 * de un aparato no se cerraban con Escape— y volvería a quedarse corta con la siguiente
		 * ventana que se añadiera. `modal-dialogo` se queda fuera porque tiene su propio Escape,
		 * que además devuelve «cancelado» a quien esté esperando la respuesta.
		 */
		const dossierAbierto = !($('panel-dossier') as HTMLElement).hidden;
		if (cerrarVentanasDeArriba()) { /* ya se cerró lo de encima */ }
		else if (dossierAbierto) panelDossier.abrir(false);
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
	if (!sePuedeEditar()) return;
	const g = proyecto.gabinete!;
	const nombre = s.tipo === 'canaleta' ? 'la canaleta' : 'el riel';
	if (!(await confirmar(`¿Eliminar ${nombre} «${s.id}»?`, { ok: 'Eliminar', peligro: true }))) return;
	if (!capturar()) return;
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
	/*
	 * Va por `reemplazarProyecto` y NO por `capturar()`, y eso importa por dos razones.
	 *
	 * La primera: empezar de cero estando en un ejemplo tiene que funcionar. Salir de un ejemplo no
	 * es editarlo, y con el veto en `capturar()` el botón «Nuevo tablero» se quedaba muerto —lo
	 * cazó `qa/general.mjs`, que carga un ejemplo y pulsa Nuevo—.
	 *
	 * La segunda: así es todo o nada, como abrir un archivo, un ejemplo o una plantilla. Las cuatro
	 * puertas que cambian el tablero entero pasan ya por el mismo sitio.
	 */
	// El catálogo se ve desde el primer momento, para poder empezar a añadir aparatos.
	reemplazarProyecto(proyectoNuevo(), () => aplicarModo('editor'));
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
		/*
		 * SE COMPRUEBA ANTES DE METERLA, con la misma regla que el cargador.
		 *
		 * Tercera auditoría, TS3-P0-01. El selector acepta `image/*` y `new Image()` decodifica un
		 * SVG sin rechistar, así que entraba, se dibujaba y se autoguardaba — y al recargar, el
		 * cargador la quitaba porque el PDF no sabe imprimirla. Trabajo aceptado por un lado y
		 * tirado por el otro. Lo que no se va a poder guardar no se acepta, y se dice en el momento.
		 */
		const juicio = imagenAdmisible(url);
		if (!juicio.ok) {
			avisar(`Esa imagen no se puede usar: ${juicio.motivo}. `
				+ 'Guárdala como PNG o JPEG y vuelve a intentarlo.', 'error');
			(e.target as HTMLInputElement).value = '';
			return;
		}
		const img = new Image();
		img.onload = () => {
			if (modo !== 'editor') aplicarModo('editor');
			if (!capturar()) return;
			const g = proyecto.gabinete!;
			// Tamaño inicial ~1/3 del ancho de placa, conservando proporción de la imagen.
			const ancho = Math.round(g.ancho * 0.35);
			const alto = Math.round(ancho * (img.height / img.width));
			const id = idUnico('img');
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
		/*
		 * ABRIR ES TODO O NADA.
		 *
		 * Segunda auditoría, TS2-P1-01: `proyecto = abierto` se hacía ANTES de que el recálculo
		 * terminase, y si la revisión, el ruteo o el render fallaban con el archivo nuevo, el
		 * editor se quedaba mostrando —y autoguardando— un proyecto a medio montar, con el
		 * anterior ya perdido.
		 *
		 * Tercera auditoría, TS3-P2-03: aquello devolvía el proyecto pero no el HISTORIAL, que se
		 * quedaba con un paso de deshacer inútil y sin nada que rehacer. `reemplazarProyecto()`
		 * mueve las tres cosas —proyecto, historial y guardado— o ninguna.
		 */
		reemplazarProyecto(abierto);
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
	// El informe sale de la MISMA revisión que se ve en pantalla: antes recalculaba los potenciales
	// por su cuenta y podía contar una historia distinta de la del panel.
	descargar(`${proyecto.nombre} - dossier.html`, generarInformeHTML(revision), 'text/html');
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
			placeholder="DO1 = DI1 Y NO DI2&#10;AO1 = 0 a 10 según UI1 de 18 a 22">${escaparHtml(d.programa ?? '')}</textarea>
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
	pintar();
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


/*
 * La segunda herramienta se CONSTRUYE solo cuando se abre.
 *
 * Segunda auditoría, TS2-P2-12. Aquí ponía que «se carga solo cuando se abre: son 240 KB que
 * quien solo diseña tableros no tiene por qué pagar al arrancar». Eso NO es lo que pasa, y el
 * comentario mentía sobre el propio código: `app/vite.config.ts` fuerza `inlineDynamicImports:
 * true` —a propósito, porque lo que se entrega es UN SOLO archivo HTML que se abre con doble
 * clic—, así que este `import()` no descarga nada: los bytes ya están dentro y ya se han
 * interpretado. Lo que sí se difiere es construir la escena de la cubierta, que es el trabajo
 * caro de verdad: 134 máquinas, 264 pilares y la red de conductos.
 *
 * Diferir también los BYTES exigiría renunciar al archivo único, que es la razón por la que este
 * programa se puede pasar por pendrive y abrir en una obra sin instalar nada. No se cambia; se
 * cuenta bien, que es lo que faltaba.
 */
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
	if (!capturar()) return;
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
($('btn-copiar-ejemplo') as HTMLButtonElement).onclick = () => copiarEjemploParaTrabajar();

($('btn-deshacer') as HTMLButtonElement).onclick = deshacer;
($('btn-rehacer') as HTMLButtonElement).onclick = rehacer;

/* ----------------------------- Vista de esquema ----------------------------- */

const panelEsq = instalarEsquema({
	proyecto: () => proyecto,
	potenciales: () => revision.potenciales,
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

/**
 * Lee lo copiado comprobando su forma, como se hace con un archivo.
 *
 * Devuelve `undefined` si no hay nada aprovechable, y lanza si lo que hay está tan roto que
 * merece decírselo al usuario. Cada aparato pasa por `cargarProyecto`: es el mismo codec que
 * valida un `.tablero`, así que un aparato pegado no puede entrar con una forma que un aparato
 * abierto no podría. Eso era lo que pedía la auditoría —un solo codec para todos los canales— y
 * de paso sale gratis: no hay una segunda lista de reglas que mantener sincronizada.
 */
function leerPortapapeles(bruto: unknown): Portapapeles | undefined {
	if (typeof bruto !== 'object' || bruto === null) return undefined;
	const lista = (bruto as { aparatos?: unknown }).aparatos;
	if (!Array.isArray(lista)) return undefined;
	if (lista.length > 200) throw new Error('trae más de 200 aparatos');
	const aparatos: Portapapeles['aparatos'] = [];
	for (const x of lista) {
		if (typeof x !== 'object' || x === null) continue;
		const e = x as Record<string, unknown>;
		const d = e.dispositivo;
		if (typeof d !== 'object' || d === null) continue;
		const num = (v: unknown, min: number, max: number): number | undefined =>
			(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined);
		const ancho = num(e.ancho, 1, 5000);
		const alto = num(e.alto, 1, 5000);
		if (ancho === undefined || alto === undefined) continue;
		// El aparato, por el codec de verdad: se mete en un proyecto mínimo y se lee.
		const sobre = JSON.stringify({
			formato: 'tablero-studio', version: 1, nombre: 'portapapeles',
			gabinete: { ancho: 600, alto: 600, rieles: [], canaletas: [], colocaciones: [] },
			hojas: [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }],
			dispositivos: [d], conductores: [],
		});
		const leido = cargarProyecto(sobre).proyecto.dispositivos[0];
		if (!leido) continue;
		aparatos.push({
			dispositivo: leido, ancho, alto,
			dx: num(e.dx, -5000, 5000) ?? 0,
			dy: num(e.dy, -5000, 5000) ?? 0,
		});
	}
	return aparatos.length ? { aparatos } : undefined;
}
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
		if (bruto) datos = leerPortapapeles(JSON.parse(bruto));
	} catch (e) {
		/*
		 * Tercera auditoría, TS3-P2-01. Esto era un `JSON.parse` y a usar la estructura tal cual,
		 * que era el único canal de entrada que quedaba fuera del cargador. Con un
		 * `{"aparatos":[null]}` en la clave, Ctrl+V daba
		 * «Cannot read properties of null (reading 'ancho')» y el editor se quedaba a medias.
		 *
		 * El portapapeles no es un archivo que llegue por correo, pero vive en `localStorage`
		 * entre sesiones y lo escribe una versión del programa que puede no ser la que lo lee.
		 * Con eso basta para tratarlo como lo que es: una entrada.
		 */
		avisar(`Lo copiado no se pudo leer (${(e as Error).message}). Vuelve a copiar el aparato.`, 'error');
		try { localStorage.removeItem(CLAVE_PORTAPAPELES); } catch { /* sin almacén */ }
		return;
	}
	if (!datos?.aparatos?.length) { avisar('No hay nada copiado todavía (Ctrl+C sobre un aparato).', 'info'); return; }

	const primero = datos.aparatos[0];
	const hueco = buscarHueco(primero.ancho, primero.alto);
	if (!hueco) { avisar('Añade un riel antes de pegar.', 'error'); return; }

	/*
	 * NINGUNA COPIA SE QUEDA ESCONDIDA DEBAJO DE OTRO APARATO.
	 *
	 * Solo se miraba el hueco del PRIMERO y luego se pegaban todos con el mismo desfase. Si una
	 * copia caía sobre un aparato ya montado y su fila estaba llena de lado a lado,
	 * `xLibreCercano(...) ?? col.x` se quedaba con la posición solapada: la copia entraba justo
	 * encima de la otra —invisible, porque la tapa— y el aviso decía «2 aparatos pegados» como si
	 * todo hubiera ido bien. En la placa de verdad eso son dos aparatos comprados y uno montado.
	 *
	 * Cuando la fila no da más de sí se manda al final del riel con más sitio, que es exactamente
	 * lo que hace «Añadir del catálogo» cuando la placa está llena: sobresalir un poco se ve y se
	 * arregla arrastrando; quedar oculto debajo de otro, no. Y se avisa, que para eso está.
	 */
	/*
	 * Pegar es TODO O NADA. Tercera auditoría, TS3-P3-01, que pide empezar la frontera transaccional
	 * justamente por «importación/clipboard». Esto empujaba aparatos y colocaciones al proyecto de
	 * uno en uno y luego llamaba a `actualizarTodo()`: si el render reventaba a media lista, quedaba
	 * media pegada en pantalla y ya escrita en el navegador, porque `recalcular()` autoguarda.
	 */
	const sobresalen: string[] = [];
	const nuevos: string[] = [];
	try {
		mutarProyecto(() => {
			for (const a of datos!.aparatos) {
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
				// Si cae encima de algo se busca hueco libre en su misma fila; y si la fila entera está
				// ocupada, al final del riel con más sitio (aunque sobresalga), nunca encima de otro.
				if (solapaCon(col.x, col.y, col.ancho, col.alto, copia.id)) {
					const libre = xLibreCercano(col.x, col.y, col.ancho, col.alto, copia.id);
					if (libre !== undefined) col.x = libre;
					else {
						// `buscarHueco` solo devuelve `undefined` si no hay ni un riel, y eso ya se
						// descartó arriba; el `?? hueco` es para no tener que afirmar nada al compilador.
						const otro = buscarHueco(col.ancho, col.alto) ?? hueco;
						col.x = otro.x; col.y = otro.y; col.rielId = otro.rielId;
						sobresalen.push(copia.designacion ?? copia.id);
					}
				}
				g.colocaciones.push(col);
				extenderRielPara(col);
				nuevos.push(copia.id);
			}
			seleccionExtra = nuevos.slice(1);
			aplicarSeleccion(nuevos[0] ? { tipo: 'dispositivo', id: nuevos[0] } : undefined);
		});
	} catch {
		/*
		 * Si la transacción se echa atrás hay que DECIRLO. Sin esto, el usuario pulsa Ctrl+V, no
		 * pasa absolutamente nada y no hay forma de saber si es que no había nada copiado, si el
		 * atajo no llegó o si algo falló. Un no-op silencioso es el peor de los tres.
		 */
		avisar('No se pudo pegar. El tablero se queda como estaba.', 'error');
		return;
	}
	const pegados = `${nuevos.length} aparato${nuevos.length > 1 ? 's' : ''} pegado${nuevos.length > 1 ? 's' : ''}`;
	if (sobresalen.length) {
		// Sin escapar A PROPÓSITO: `avisar()` escribe con `textContent`, que no interpreta nada.
		// Escapar aquí enseñaría «&lt;» en pantalla, que es el fallo contrario y también es feo.
		avisar(`${pegados}. No cabía${sobresalen.length > 1 ? 'n' : ''} en la fila: `
			+ `${sobresalen.join(', ')} quedó al final del riel. Arrástralo a su sitio.`, 'info');
	} else {
		avisar(pegados, 'ok');
	}
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
		id: idUnico('d'),
		numero,
		designacion: (d.designacion ?? '').replace(/\d+$/, '') + numero,
	};
}

/* ------------------------ Entregables: rótulos y DXF ------------------------ */

($('btn-etiquetas') as HTMLButtonElement).onclick = () => {
	try {
		exportarEtiquetasPDF(proyecto, revision.potenciales, `${nombreArchivo()}-rotulos.pdf`);
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
	const errores = revision.hallazgos.filter((h) => h.severidad === 'error').length;
	const avisos = revision.hallazgos.length - errores;
	$('drc-resumen').textContent = revision.hallazgos.length === 0
		? 'El tablero pasa todas las reglas.'
		: `${errores} ${errores === 1 ? 'error' : 'errores'} y ${avisos} ${avisos === 1 ? 'aviso' : 'avisos'} `
			+ 'sobre el tablero tal como está ahora.';
	cont.innerHTML = '';
	if (revision.hallazgos.length === 0) {
		cont.innerHTML = '<li class="vacio">✔ Sin errores ni avisos</li>';
	}
	for (const h of revision.hallazgos) {
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
				cerrarVentana('modal-drc');
				if (destino.tipo === 'cable') { aplicarModo('trabajo'); enfocarCamaraEnCable(destino.id); }
				aplicarSeleccion(destino);
			};
		}
		cont.appendChild(li);
	}
	abrirVentana('modal-drc');
}

($('chip-drc') as HTMLButtonElement).onclick = () => abrirDetalleDRC();
($('btn-cerrar-drc') as HTMLButtonElement).onclick = () => cerrarVentana('modal-drc');
$('modal-drc').addEventListener('click', (e) => {
	if (e.target === $('modal-drc')) cerrarVentana('modal-drc');
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
	abrirVentana('modal-proyecto');
	setTimeout(() => ($('pr-cliente') as HTMLInputElement).focus(), 0);
}

function guardarDatosProyecto(): void {
	const texto = (id: string) => ($(id) as HTMLInputElement).value.trim() || undefined;
	/**
	 * Un número del formulario, con su rango propio. VACÍO ES AUSENCIA, no cero.
	 *
	 * Era `Number(input.value)` con un `v >= 0` común, y las dos cosas estaban mal:
	 *
	 *  · `Number('') === 0`, y `0 >= 0` pasa el filtro. Un campo en blanco quedaba DECLARADO como
	 *    0. Medido sobre el ejemplo del arranque directo: dejando el ambiente en blanco, el
	 *    balance térmico daba 7,6 °C interiores en vez de 42,6. Treinta y cinco grados de error, y
	 *    siempre hacia el lado que tranquiliza. La placa de características, además, salía
	 *    afirmando «0 °C» y «0 Hz» en un documento que se entrega firmado.
	 *  · El `>= 0` común rechazaba una temperatura ambiente de −10 °C, que es perfectamente
	 *    normal en una sala de máquinas o en una cubierta en invierno, y la convertía en ausencia.
	 *
	 * También se acepta la coma decimal, que es como se escribe aquí.
	 */
	/*
	 * EN BLANCO NO ES LO MISMO QUE MAL ESCRITO.
	 *
	 * Segunda auditoría, TS2-P1-06. Los dos acababan igual: en `undefined`. Se cerraba la ventana y
	 * salía «Datos del proyecto guardados» aunque lo escrito no se hubiera guardado.
	 *
	 * En la Icc importa más que en el resto: la regla R13 —la que comprueba que el poder de corte
	 * de cada protección aguanta el cortocircuito del sitio— solo se ejecuta si `icc > 0`. Un
	 * dedazo al teclear la Icc APAGABA esa comprobación entera, en silencio, y el DRC seguía dando
	 * el visto bueno. Quien firma el tablero no tiene forma de enterarse.
	 *
	 * En blanco sigue queriendo decir «sin declarar», que es un dato legítimo y el dossier lo sabe
	 * decir. Mal escrito es un error, y un error se enseña y no se guarda nada.
	 */
	const malos: { id: string; nombre: string; motivo: string }[] = [];
	const numero = (id: string, nombre: string, min: number, max: number, unidad = '') => {
		const campo = $(id) as HTMLInputElement;
		campo.removeAttribute('aria-invalid');
		const crudo = campo.value.trim().replace(',', '.');
		if (crudo === '') return undefined;                 // en blanco = sin declarar
		const v = Number(crudo);
		if (!Number.isFinite(v)) {
			malos.push({ id, nombre, motivo: `«${campo.value.trim()}» no es un número` });
			return undefined;
		}
		if (v < min || v > max) {
			malos.push({ id, nombre, motivo: `${v}${unidad} está fuera de ${min} a ${max}${unidad}` });
			return undefined;
		}
		return v;
	};
	// Se leen TODOS antes de decidir, para poder señalar de una vez todo lo que está mal.
	const icc = numero('pr-icc', 'Icc presunta', 0, 100, ' kA');
	const ambiente = numero('pr-ambiente', 'Temperatura ambiente', -40, 80, ' °C');
	const inominal = numero('pr-inominal', 'Corriente asignada', 0, 10000, ' A');
	const frecuencia = numero('pr-frecuencia', 'Frecuencia', 0, 400, ' Hz');
	if (malos.length) {
		for (const m of malos) ($(m.id) as HTMLInputElement).setAttribute('aria-invalid', 'true');
		($(malos[0].id) as HTMLInputElement).focus();
		avisar(`No se guardó nada: ${malos.map((m) => `${m.nombre}, ${m.motivo}`).join('; ')}. `
			+ 'Corrígelo o déjalo en blanco para dejarlo sin declarar.', 'error');
		return;   // la ventana se queda abierta y el proyecto, intacto
	}
	if (!capturar()) return;
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
		// Rangos: la Icc de una instalación de baja tensión va de casi nada a 100 kA; el ambiente
		// admite bajo cero; la frecuencia solo tiene sentido en la banda industrial.
		iccPresuntaKA: icc ?? 0,
		temperaturaAmbienteC: ambiente,
		corrienteAsignadaA: inominal ?? 0,
		frecuenciaHz: frecuencia,
		gradoIP: ($('pr-ip') as HTMLInputElement).value.trim(),
		montajeGabinete: montaje ? (montaje as OpcionesProyecto['montajeGabinete']) : undefined,
		regimenNeutro: ($('pr-neutro') as HTMLSelectElement).value as OpcionesProyecto['regimenNeutro'],
		usoPrevisto: ($('pr-uso') as HTMLSelectElement).value as OpcionesProyecto['usoPrevisto'],
	};
	cerrarVentana('modal-proyecto');
	recalcular();      // la Icc cambia el DRC al instante
	pintarPaneles();
	panelEsq.refrescar();
	avisar('Datos del proyecto guardados', 'ok');
}

($('btn-datos-proyecto') as HTMLButtonElement).onclick = () => abrirDatosProyecto();
($('btn-cerrar-proyecto') as HTMLButtonElement).onclick = () => cerrarVentana('modal-proyecto');
($('btn-cancelar-proyecto') as HTMLButtonElement).onclick = () => cerrarVentana('modal-proyecto');
($('btn-guardar-proyecto') as HTMLButtonElement).onclick = () => guardarDatosProyecto();
$('modal-proyecto').addEventListener('click', (e) => {
	if (e.target === $('modal-proyecto')) cerrarVentana('modal-proyecto');
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
	abrirVentana('modal-controlador');
	setTimeout(() => ($('ctrl-fabricante') as HTMLInputElement).focus(), 0);
}

function cerrarControladorAMedida(): void {
	cerrarVentana('modal-controlador');
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
		id: idUnico('ctrl-medida-'),
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
	reemplazarProyecto,
	descartarBienvenida: () => { bienvenidaDescartada = true; },
	aplicarModo,
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

/**
 * Fotogramas dibujados por el editor. Lo lee la sonda de QA para comprobar que, con la Planta
 * abierta, este bucle está de verdad parado y no solo «debería».
 */
let fotogramasEditor = 0;
/** Cuándo se dibujó el fotograma anterior, para animar la simulación con el tiempo REAL. */
let ultimoFotograma = performance.now();

renderer.setAnimationLoop(() => {
	/*
	 * SOLO DIBUJA LA HERRAMIENTA QUE SE VE.
	 *
	 * Segunda auditoría, TS2-P2-01. Este bucle seguía corriendo con la Planta 3D encima, y la
	 * Planta tiene el suyo: dos escenas de Three.js dibujándose a la vez, una de ellas tapada.
	 * No causa el zoom exponencial de antes —eso ya se arregló— pero es el doble de trabajo de
	 * GPU y de batería en un portátil que se lleva a la obra, y en una máquina justa se nota en
	 * el retardo del ratón. El de la Planta ya se paraba solo al esconderse; este no.
	 *
	 * Se pone el reloj en hora al salir: si no, al cerrar la Planta el primer fotograma traería
	 * de golpe todo el rato que ha estado parado y el motor daría un latigazo.
	 */
	if (!($('mundo') as HTMLElement).hidden) { ultimoFotograma = performance.now(); return; }
	fotogramasEditor++;

	/*
	 * Y LLEVA LA ESCENA AL ESTADO QUE DICE LA SIMULACIÓN: la armadura del contactor entra, la
	 * palanca de la protección baja, el piloto alumbra con su color y el eje del motor gira. Sin
	 * esto, energizar solo cambiaba un texto en el panel.
	 */
	const ahora = performance.now();
	// Tope de 100 ms, por lo mismo: un salto grande no puede convertirse en un tirón.
	const dt = Math.min((ahora - ultimoFotograma) / 1000, 0.1);
	ultimoFotograma = ahora;
	animarSimulacion({
		grupos: escenario.dispositivos.children,
		proyecto,
		resultado: panelSim.resultado(),
		estado: panelSim.estadoDeLosMandos(),
		energizado: panelSim.energizado(),
		dt,
		reloj: ahora / 1000,
		cables: escenario.cables,
	});
	(vista2D ? controlesOrto : controles).update();
	ajustarRotulos();
	pintar();
});

/*
 * ---------------- NIVEL DE DETALLE DE LA INFORMACIÓN ESCRITA ----------------
 *
 * Un tablero real no enseña lo mismo desde la puerta que con la nariz pegada a un borne, y este
 * programa tiene que hacer lo mismo por dos razones distintas.
 *
 * La primera es de LECTURA. Desde la vista general lo único que importa es qué aparato es cuál:
 * «-KM1». La numeración de bornes a esa distancia no se lee —son cifras de dos milímetros— pero
 * sí se acumula, y cien marcas ilegibles no informan de nada: ensucian. Al revés pasa lo mismo:
 * con la cámara encima de un contactor, un cartel de «-KM1» del tamaño de media pantalla tapa
 * justo lo que se ha ido a mirar.
 *
 * La segunda es de COSTE. Los sprites de rótulo no se tocan por fotograma más que en su escala, y
 * el microtexto se apaga por grupos con `visible`, que no cuesta nada: la tarjeta ni siquiera los
 * ve. No hay un solo elemento del DOM implicado.
 *
 * El reparto por distancia de la cámara al aparato:
 *
 *   lejos (> 900 mm)      identificador del tablero, y nada más
 *   media (350..900 mm)   además la referencia y las marcas de ajuste
 *   cerca (< 350 mm)      además la numeración de cada borne
 *
 * Y el identificador, a la vez, se encoge conforme uno se acerca en vez de crecer con la escena.
 */
const LEJOS = 900;
const CERCA = 350;
const posicionMundo = new THREE.Vector3();

function ajustarRotulos(): void {
	const camaraActual = camaraViva();
	const ojo = camaraActual.position;
	const idSel = sel?.tipo === 'dispositivo' ? sel.id : undefined;
	for (const grupo of escenario.dispositivos.children) {
		grupo.getWorldPosition(posicionMundo);
		const dist = ojo.distanceTo(posicionMundo);
		const seleccionado = grupo.userData.dispositivoId === idSel;
		for (const hijo of grupo.children) {
			const lod = hijo.userData.lod as string | undefined;
			if (lod === 'micro') hijo.visible = dist < CERCA;
			else if (lod === 'medio') hijo.visible = dist < LEJOS;
			const rot = hijo.userData.rotulo as
				{ base: number; proporcion: number; altura: number; rango: string } | undefined;
			if (!rot || !(hijo instanceof THREE.Sprite)) continue;
			/*
			 * TAMAÑO CONSTANTE EN PANTALLA, con tope. La altura aparente de un sprite es
			 * proporcional a su escala partida por la distancia, así que para que ocupe siempre lo
			 * mismo hay que escalarlo CON la distancia. Los dos topes evitan los dos extremos:
			 * que se haga gigante encima del aparato y que se convierta en un punto desde lejos.
			 */
			const escala = Math.min(rot.base * 1.35, Math.max(rot.base * 0.42, dist * rot.base * 0.0011));
			hijo.scale.set(escala, escala * rot.proporcion, 1);
			// Y la altura a la que cuelga acompaña al tamaño, para que no se despegue del aparato.
			hijo.position.y = rot.altura + (escala - rot.base) * 0.35;
			/*
			 * De cerca se desvanece. Si la cámara está encima de KM1, el usuario ya sabe que es
			 * KM1: el cartel solo estorba. La chapa de tensión se va antes que el identificador,
			 * porque es información de estado y va por detrás en la jerarquía.
			 */
			const desdeCuando = rot.rango === 'estado' ? CERCA * 1.5 : CERCA;
			const mat = hijo.material as THREE.SpriteMaterial;
			let opacidad = dist > desdeCuando ? 1 : Math.max(0.16, dist / desdeCuando);
			/*
			 * MUY DE CERCA EL RÓTULO SOBRA, y además estorba: por debajo de 200 mm la cámara está
			 * mirando la fila de bornes, que es justo lo que el cartel tapa. Quien ha llegado hasta
			 * ahí ya sabe qué aparato es. Se apaga del todo, con un tramo de transición para que no
			 * desaparezca de golpe.
			 */
			if (dist < 200) opacidad *= Math.max(0, (dist - 130) / 70);
			/*
			 * Y el del aparato SELECCIONADO se retira: el panel lateral ya está enseñando su
			 * referencia, su tensión, su posición y sus cables. Dos sitios diciendo lo mismo, y uno
			 * de ellos encima del propio aparato, es competir consigo mismo.
			 */
			if (seleccionado) opacidad *= 0.35;
			mat.opacity = opacidad;
		}
	}
}

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
		/**
		 * Hace que el PRÓXIMO montaje de la escena reviente. TS3-P2-03.
		 *
		 * Sirve para comprobar que abrir un archivo es de verdad todo o nada: si el render falla
		 * después de haber sustituido el proyecto, ni el proyecto, ni el historial, ni lo guardado
		 * pueden quedarse a medias.
		 */
		romperProximoMontaje: () => { romperMontaje = true; },
		/** El historial, para poder mirar que un fallo no se lo lleva por delante. */
		historial: () => ({ deshacer: pila.length, rehacer: rehacerPila.length }),
		/**
		 * Lo que cuesta DIBUJAR un fotograma, en ms. TS3-P3-02.
		 *
		 * Se llama al render directamente, `n` veces seguidas, en vez de cronometrar
		 * `requestAnimationFrame`. No es un capricho: en una pestaña sin pantalla el navegador
		 * estrangula el rAF, y midiéndolo así salían 1.814 ms por fotograma. Eso no es lo que
		 * cuesta dibujar el tablero — es cada cuánto le da la gana al navegador llamarnos.
		 * Cronometrando el `render` se mide el programa y no el andamiaje.
		 */
		medirDibujado: (n = 30) => {
			pintar();   // el primero calienta: sube texturas a la GPU
			const t: number[] = [];
			for (let i = 0; i < n; i++) {
				const desde = performance.now();
				pintar();
				t.push(performance.now() - desde);
			}
			t.sort((a, b) => a - b);
			return {
				mediana: Math.round(t[Math.floor(t.length / 2)] * 100) / 100,
				peor: Math.round(t[t.length - 1] * 100) / 100,
			};
		},
		/** Lo que hay guardado en el navegador ahora mismo, tal cual. */
		autoguardado: () => localStorage.getItem(CLAVE_AUTOSAVE),
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
		/** Selecciona un aparato, para poder abrir su ficha desde las pruebas. */
		elegir: (id: string) => { seleccionar(id); },
		/** Selecciona un aparato por id, como si se hubiera pinchado en él. */
		seleccionarPorId: (id: string) => seleccionar(id),
		/** Fotogramas que ha dibujado el editor (para ver si su bucle está parado). */
		fotogramas: () => fotogramasEditor,
		/** Repinta la lista de rieles y canaletas (para comprobar cómo entra ahí un id del archivo). */
		pintarEstructura: () => pintarEstructura(),
		/** Añade un aparato a la selección múltiple, como haría un Shift+clic. */
		anadirASeleccion: (id: string) => { construyendoSeleccion = true; alternarEnSeleccion(id); construyendoSeleccion = false; },
		/** Resumen del esquema montado ahora mismo (para comprobar que no pierde aparatos). */
		esquema: () => revision.hojasEsquema.map((h) => ({
			numero: h.numero,
			aparatos: h.simbolos.map((s) => s.dispositivoId),
			fuera: h.simbolos.filter((s) => s.x < 0 || s.y < 0
				|| s.x + s.ancho > h.anchoMm || s.y + s.alto > h.altoMm).length,
		})),
		/**
		 * Punto en pantalla del tirador de una unión del cable.
		 *
		 * Es el único sitio válido para probar que una unión se arrastra: agarrar un píxel
		 * cualquiera del tubo NO deforma el cable, y es a propósito —solo se mueve la unión si se
		 * pincha a menos de 26 mm de ella; las uniones se crean con doble clic—.
		 */
		puntoDeUnion: (conductorId: string, indice = 0) => {
			const c = proyecto.conductores.find((x) => x.id === conductorId);
			const w = c?.trazado?.[indice];
			if (!w) return undefined;
			const v = aPantalla(escenario.aEscena(w.x, w.y, Z_HANDLE_CABLE));
			return { x: Math.round(v.x), y: Math.round(v.y) };
		},
		/**
		 * Un punto de PANTALLA sobre el recorrido dibujado de un cable.
		 *
		 * Da una coordenada y no hace nada más: la unión la crea el doble clic de verdad sobre ese
		 * punto, pasando por el mismo manejador que usa quien está trabajando. Una sonda que
		 * insertara el punto de quiebre por su cuenta probaría OTRA COSA, y fue justo por ahí por
		 * donde se escapó que crear una unión no se guardaba: en pantalla estaba y al recargar, no.
		 */
		puntoSobreCable: (conductorId: string) => {
			/*
			 * El punto sale del RECORRIDO REAL que dibuja la escena, no del medio de la recta
			 * entre los dos bornes: los cables van en ortogonal y por corredores libres, así que
			 * ese medio cae casi siempre en un sitio donde no hay cable. Se toma el centro del
			 * tramo más largo, que es el que más margen deja para acertarle.
			 */
			const ruta = rutasDeCables(proyecto).find((r) => r.conductorId === conductorId);
			if (!ruta || ruta.nodos.length < 2) return undefined;
			let mejor = 0;
			let largo = -1;
			for (let i = 0; i < ruta.nodos.length - 1; i++) {
				const d = Math.abs(ruta.nodos[i + 1].x - ruta.nodos[i].x)
					+ Math.abs(ruta.nodos[i + 1].y - ruta.nodos[i].y);
				if (d > largo) { largo = d; mejor = i; }
			}
			const a = ruta.nodos[mejor];
			const b2 = ruta.nodos[mejor + 1];
			const v = aPantalla(escenario.aEscena((a.x + b2.x) / 2, (a.y + b2.y) / 2, ruta.z));
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
		hallazgos: () => revision.hallazgos,
		/**
		 * Balance térmico calculado. Se expone porque es donde se nota si una opción del proyecto
		 * llegó como número, como ausencia o como NaN: un campo en blanco daba 7,6 °C interiores
		 * en vez de 42,6 y el veredicto salía tranquilizador sin motivo.
		 */
		termico: () => revision.termico,
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
			/*
			 * SE PROBABA UN SOLO PUNTO POR TRAMO, Y ENCIMA FUERA DEL PERFIL.
			 *
			 * El desplazamiento perpendicular era fijo, +20 mm, y la cota fija, z = 30. Un carril
			 * mide 35 mm de ancho medidos desde su eje, o sea que +20 cae dos milímetros y medio
			 * POR FUERA del perfil; y z = 30 es un punto flotando veintidós milímetros por delante
			 * de él. Que la sonda acertara dependía de que la perspectiva, desde el ángulo en que
			 * estuviera la cámara, proyectara ese punto del aire encima del carril. Cuando no lo
			 * hacía —y en el primer ejemplo no lo hace— la sonda daba «el perfil está cubierto de
			 * aparatos» sobre un carril que se ve perfectamente.
			 *
			 * Ahora se barren varios desplazamientos DENTRO del perfil, a los dos lados de su eje,
			 * y a la altura a la que el perfil está de verdad. La condición de aceptación no se
			 * toca: sigue exigiendo que lo primero que se vea en ese píxel sea el propio perfil,
			 * que es lo que distingue «hay un trozo libre» de «pincho a ver si suena la flauta».
			 */
			const canal = tipo === 'canaleta' ? (e as typeof g.canaletas[number]) : undefined;
			const medio = (canal ? canal.ancho : 35) / 2;
			const desvios = [0, medio * 0.5, -medio * 0.5, medio * 0.8, -medio * 0.8];
			const cotas = canal ? [canal.alto, 2] : [8, 4, 12];
			for (let t = 6; t <= e.largo - 6; t += 4) {
				for (const d of desvios) {
					for (const z of cotas) {
						const x = vertical ? e.x + d : e.x + t;
						const y = vertical ? e.y + t : e.y + d;
						const p = aPantalla(escenario.aEscena(x, y, z));
						// Solo vale si en ese píxel lo primero que se ve es el propio perfil.
						puntero.set(((p.x - r.left) / r.width) * 2 - 1, -((p.y - r.top) / r.height) * 2 + 1);
						raycaster.setFromCamera(puntero, camaraViva());
						const golpe = raycaster.intersectObjects(escenario.raiz.children, true)
							.find((h) => h.object.userData[clave] || h.object.userData.dispositivoId);
						if (golpe?.object.userData[clave] === id) return p;
					}
				}
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
		/**
		 * El dossier en crudo, para poder mirar DENTRO del PDF desde una prueba.
		 *
		 * Se genera con los ajustes que se le pasen y se deja el proyecto como estaba: así una
		 * prueba puede comparar el mismo tablero con y sin empresa, en A4 y en Carta, sin tener que
		 * ir tocando la interfaz para cada caso.
		 */
		dossierCrudo: async (ajustes?: unknown): Promise<string> => {
			const antes = proyecto.dossier;
			if (ajustes !== undefined) proyecto.dossier = ajustes as typeof proyecto.dossier;
			try {
				const { dossierComoBlob } = await import('./pdf.js');
				const bytes = new Uint8Array(await dossierComoBlob(proyecto).arrayBuffer());
				let texto = '';
				for (let i = 0; i < bytes.length; i++) texto += String.fromCharCode(bytes[i]);
				return texto;
			} finally {
				proyecto.dossier = antes;
			}
		},
		/** Recorrido resuelto de cada cable (mm de modelo), tal cual se dibuja. */
		/**
		 * Las rutas con su recorrido 3D FINAL incluido. Los `nodos` son la polilínea ortogonal antes
		 * de redondear y de darle profundidad: apuntar ahí es apuntar a donde el cable NO está.
		 */
		rutas: () => rutasDeCables(proyecto).map((r) => ({
			id: r.conductorId, nodos: r.nodos, z: r.z, radio: r.radio,
			puntos: r.puntos.map((q) => ({
				x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, z: Math.round(q.z * 10) / 10,
			})),
		})),
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
		/*
		 * Para la cámara EN SECO, quitándole la amortiguación.
		 *
		 * La órbita glisa: `controles.update()` la sigue acercando al destino en cada fotograma, y
		 * la aproximación es asintótica, o sea que nunca llega. Para una persona eso es lo que hace
		 * que girar el tablero se sienta suave; para una prueba que calcula un píxel y pincha en él
		 * es veneno, porque entre las dos cosas la escena se ha movido un pelo y un tubo fino se
		 * escapa. Con esto la prueba mide y pincha sobre la MISMA vista. No cambia lo que se
		 * comprueba —que el clic agarre el cable señalado—, solo quita el temblor de en medio.
		 */
		congelarCamara: (parar: boolean) => {
			controles.enableDamping = !parar;
			controlesOrto.enableDamping = !parar;
			controles.update();
			controlesOrto.update();
		},
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
				// Hay tensión y todavía nadie ha accionado nada: es normal, no es avería.
				sinAccionar: r?.sinAccionar ?? false,
			};
		},
		/** Recalcula si los rótulos de la barra caben (lo hace la app al cambiar tamaño o estado). */
		ajustarBarra: () => ajustarRotulosBarra(),
		/**
		 * Las tensiones que hay vivas ahora mismo, sin repetir.
		 *
		 * Es lo que hace falta para comprobar el tablero de control: su gracia es que conviven la
		 * red de 220 V y el control de 24 V, separados, y eso no se ve en «qué está funcionando».
		 */
		tensionesVivas: () => {
			const r = panelSim.resultado();
			return [...new Set([...(r?.vivos.values() ?? [])].map((v) => v.tension))].sort((a, b) => b - a);
		},
		/** Estado de los mandos que el usuario ha accionado. */
		estadoSim: () => Object.entries(panelSim.estadoDeLosMandos()).map(([id, st]) => ({ id, ...st })),
		/** Acciona un aparato como si se hubiera pinchado en él con el tablero energizado. */
		accionar: (id: string) => panelSim.accionar(id),
		/** Cuántos tubos de cable están de verdad ILUMINADOS en la escena (lo que se ve). */
		/**
		 * Las PIEZAS animadas de un aparato: dónde están y cómo alumbran.
		 *
		 * Es lo que permite comprobar que energizar SE VE y no solo se cuenta: si la armadura del
		 * contactor no baja o el eje del motor no gira, aquí se nota. Mirar la lista de
		 * «funcionando» no valdría: eso ya iba bien cuando en pantalla no se movía nada.
		 */
		piezas: (id: string) => {
			const g = escenario.dispositivos.children.find((x) => x.userData.dispositivoId === id);
			if (!g) return null;
			const piezas: Record<string, unknown[]> = {};
			g.traverse((o) => {
				const nombre = o.userData.pieza as string | undefined;
				if (!nombre || !(o instanceof THREE.Mesh)) return;
				const mat = o.material as THREE.MeshStandardMaterial | undefined;
				(piezas[nombre] ??= []).push({
					x: Math.round(o.position.x * 100) / 100,
					y: Math.round(o.position.y * 100) / 100,
					z: Math.round(o.position.z * 100) / 100,
					giro: Math.round(o.rotation.x * 1000) / 1000,
					brillo: Math.round((mat?.emissiveIntensity ?? 0) * 100) / 100,
					color: mat?.color?.getHex?.() ?? 0,
				});
			});
			return piezas;
		},
		/**
		 * EL VOLUMEN QUE OCUPA DE VERDAD CADA APARATO, medido sobre la geometría ya montada.
		 *
		 * Sirve para cazar con números lo que a ojo cuesta ver: una pieza que se sale de la huella
		 * declarada, o dos aparatos cuyos cuerpos se atraviesan. Un modelo puede DECLARAR 72 mm de
		 * fondo y tener una tapa girada que llega a 56 y otra mitad hundida diez milímetros dentro
		 * de su propio cuerpo: de frente no se ve, y medido salta a la primera.
		 *
		 * Las cotas van en milímetros de modelo (Y hacia abajo), como la colocación.
		 */
		cuerpos: () => {
			const g = proyecto.gabinete;
			if (!g) return [];
			const caja = new THREE.Box3();
			const salida = [];
			for (const grupo of escenario.dispositivos.children) {
				const id = grupo.userData.dispositivoId as string | undefined;
				const col = id && g.colocaciones.find((c) => c.dispositivoId === id);
				if (!id || !col) continue;   // los aparatos de campo no tienen huella en la placa
				/*
				 * Solo el CUERPO. Los rótulos flotan a propósito por encima del aparato —la
				 * designación a 13 mm y la chapa de tensión a 26— y son carteles orientados a la
				 * cámara, no plástico: metiéndolos en la medida, todos los aparatos parecerían
				 * desbordar su huella y la comprobación no diría nada.
				 */
				caja.makeEmpty();
				grupo.traverse((o) => { if (o instanceof THREE.Mesh) caja.expandByObject(o); });
				if (caja.isEmpty()) continue;
				/*
				 * A qué profundidad arranca la geometría que cae SOBRE EL CARRIL.
				 *
				 * El carril ocupa los primeros 8 mm por detrás del aparato, en una banda de 35 mm de
				 * alto. Un cuerpo macizo que arranque en la placa se lo lleva dentro —era el caso de
				 * todos los aparatos, y no se nota de frente porque el carril queda tapado—. Con el
				 * canal por detrás, lo que quede en esa banda tiene que empezar por delante del
				 * carril; solo la pinza baja a agarrarse a los labios.
				 */
				const pieza = new THREE.Box3();
				let enCarril = Infinity;
				grupo.traverse((o) => {
					if (!(o instanceof THREE.Mesh)) return;
					pieza.setFromObject(o);
					const yModelo = g.alto / 2 - (pieza.min.y + pieza.max.y) / 2;
					if (Math.abs(yModelo - (col.y + col.alto / 2)) < 17) enCarril = Math.min(enCarril, pieza.min.z);
				});
				salida.push({
					id, x: col.x, y: col.y, ancho: col.ancho, alto: col.alto,
					minX: caja.min.x + g.ancho / 2, maxX: caja.max.x + g.ancho / 2,
					minY: g.alto / 2 - caja.max.y, maxY: g.alto / 2 - caja.min.y,
					minZ: caja.min.z, maxZ: caja.max.z,
					zSobreCarril: Number.isFinite(enCarril) ? enCarril : null,
				});
			}
			return salida;
		},
		/**
		 * EL CHOQUE ENTRE CABLES, MEDIDO SOBRE LA GEOMETRÍA QUE SE VE.
		 *
		 * «Cero pares a la misma profundidad» era la comprobación anterior, y es cierta sin demostrar
		 * nada: dos cables en capas distintas se cruzan igual mientras entran y salen de ellas, y dos
		 * ejes a 3 mm siguen siendo dos tubos de 3 mm de radio metidos uno dentro de otro. Esto mide
		 * la distancia mínima entre los recorridos tridimensionales completos, con sus radios, y dice
		 * quién choca con quién y en qué punto del tablero.
		 */
		choquesCable: () => {
			const d = diagnosticoCables(proyecto);
			const corto = (c: { a: string; b: string; holgura: number; donde: { x: number; y: number; z: number } }) => ({
				a: c.a, b: c.b,
				holgura: Math.round(c.holgura * 100) / 100,
				x: Math.round(c.donde.x), y: Math.round(c.donde.y), z: Math.round(c.donde.z),
			});
			return {
				cables: d.cables,
				holguraMinima: Number.isFinite(d.holguraMinima) ? Math.round(d.holguraMinima * 100) / 100 : null,
				penetraciones: d.conflictos.filter((c) => c.holgura < 0).length,
				conflictos: d.conflictos.slice(0, 20).map(corto),
				invasiones: d.invasiones.slice(0, 20).map(corto),
			};
		},
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
		/**
		 * Pone la vista EXACTAMENTE donde se le diga, sin pasar por el ratón.
		 *
		 * Las fotos de revisión visual tienen que salir desde el mismo sitio antes y después de un
		 * cambio, y arrastrando el ratón eso no se consigue: cada arrastre real cuesta segundos en
		 * este contenedor y llega adonde llega. Aquí se dan las coordenadas y se acabó.
		 */
		verDesde: (v: { x: number; y: number; z: number; tx?: number; ty?: number; tz?: number }) => {
			camara.position.set(v.x, v.y, v.z);
			controles.target.set(v.tx ?? 0, v.ty ?? 0, v.tz ?? 0);
			controles.update();
		},
		/** Centro y radio de un aparato en coordenadas de mundo, para poder encuadrarlo de cerca. */
		bulto: (dispositivoId: string) => {
			const g = escenario.dispositivos.children.find((o) => o.userData.dispositivoId === dispositivoId);
			if (!g) return undefined;
			const caja = new THREE.Box3().setFromObject(g);
			const c = caja.getCenter(new THREE.Vector3());
			return { x: c.x, y: c.y, z: c.z, radio: caja.getSize(new THREE.Vector3()).length() / 2 };
		},
		/**
		 * HISTOGRAMA DE LO QUE SE ESTÁ VIENDO, para poder discutir la iluminación con números.
		 *
		 * Ajustar exposición y luces «a ojo» sobre capturas es como igualar un sonido girando el
		 * mando sin mirar el vúmetro: se acaba compensando una cosa con otra. Aquí se lee el
		 * framebuffer y se cuenta cuánto hay pegado al negro y cuánto pegado al blanco, que son
		 * los dos sitios donde se pierde información y no se recupera.
		 *
		 * `negrosMuertos` son los píxeles del lienzo 3D por debajo de 12/255 en los tres canales:
		 * un pocillo ahí dentro no es una cavidad, es un agujero. `blancosMuertos`, los que pasan
		 * de 246: una placa ahí no tiene superficie, tiene papel. `mediana` dice si el conjunto
		 * está globalmente claro u oscuro, y `contraste` es la desviación típica de la luminancia.
		 */
		histograma: () => {
			const c = renderer.domElement;
			const lienzo = document.createElement('canvas');
			lienzo.width = Math.min(c.width, 800);
			lienzo.height = Math.min(c.height, 500);
			const ctx = lienzo.getContext('2d')!;
			ctx.drawImage(c, 0, 0, lienzo.width, lienzo.height);
			const d = ctx.getImageData(0, 0, lienzo.width, lienzo.height).data;
			const cuenta = new Array(256).fill(0);
			let negros = 0;
			let blancos = 0;
			let n = 0;
			for (let i = 0; i < d.length; i += 4) {
				const r = d[i];
				const g2 = d[i + 1];
				const b2 = d[i + 2];
				const lum = Math.round(0.2126 * r + 0.7152 * g2 + 0.0722 * b2);
				cuenta[lum]++;
				if (r < 12 && g2 < 12 && b2 < 12) negros++;
				if (r > 246 && g2 > 246 && b2 > 246) blancos++;
				n++;
			}
			let acc = 0;
			let mediana = 0;
			for (let v = 0; v < 256; v++) { acc += cuenta[v]; if (acc >= n / 2) { mediana = v; break; } }
			let media = 0;
			for (let v = 0; v < 256; v++) media += (v * cuenta[v]) / n;
			let varianza = 0;
			for (let v = 0; v < 256; v++) varianza += (cuenta[v] / n) * (v - media) ** 2;
			return {
				negrosMuertos: Math.round((negros / n) * 10000) / 100,
				blancosMuertos: Math.round((blancos / n) * 10000) / 100,
				mediana,
				media: Math.round(media * 10) / 10,
				contraste: Math.round(Math.sqrt(varianza) * 10) / 10,
			};
		},
		/**
		 * Las marcas serigrafiadas que hay en la escena, por aparato. Sirve para comprobar que el
		 * dibujo y el modelo dicen lo mismo: si un aparato declara diez bornes tienen que salir
		 * diez números, y con los identificadores que el aparato declara, no con otros.
		 */
		marcas: () => escenario.dispositivos.children.map((g) => {
			const textos: string[] = [];
			g.traverse((o) => { if (o.userData.esMarca) textos.push(o.userData.textoMarca as string); });
			return { dispositivo: g.userData.dispositivoId as string, marcas: textos };
		}),
		/** Fuerza la intensidad del realce de selección, para compararlas en el mismo encuadre. */
		realceSeleccion: (v: number) => { realceSel = v; if (sel) { limpiarResaltado(); pintarSeleccion(); } },
		/** Pone el hover de aparato desde una prueba, sin depender de la posición del ratón. */
		hoverDispositivo: (id: string | undefined) => resaltarHoverDispositivo(id),
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
		drc: () => revision.hallazgos,
	};
}
