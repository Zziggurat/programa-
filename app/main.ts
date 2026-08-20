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
import { cajaDeGabinete, crearProyecto, declarado, extremoTexto, opcionesDe } from '../src/modelo/proyecto.js';
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
	construirUnCable, contadores, radioCodo, radioDeCable, reiniciarContadores, rutaProvisional,
	RutaCable, rutasVigentes, rutaVigente,
	vaciar, VOLTAJE_COLOR,
	yEntradasCampo, Z_FRENTE, Z_IMAGEN_FONDO, Z_IMAGEN_FRENTE,
} from './escena3d.js';
import { canaletasQueContienen, encajarEnCanaleta, invasionSolida, RedCanaletas } from './canaletas-red.js';
import {
	Bloqueo, distanciaASegmento, Eje, indiceDeInsercion, normalDeArrastre, P3,
	proyectarEnPolilinea, respetarBloqueo,
} from './edicion-cables.js';
import { colorDeTipo } from './dispositivos3d.js';
import {
	colorDePiloto, construirComponentePuerta, fichaFrontal, huellaFrontal, RADIO_PILOTO,
	valoresPorDefecto,
} from './componentes-puerta.js';
import {
	Alineacion as AlineacionFrontal, alinearFrontal, AyudasFrontal, dentroDeLaHoja, Guia, imantarEnFrontal,
	PiezaFrontal, repartirFrontal,
} from './edicion-frontal.js';
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
	dentroDelArea, fueraDeLaHuella, Huella, longitudSolapada, orthogonalize,
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
	| { tipo: 'cable'; id: string }
	/** Un rótulo del frontal. Los aparatos de puerta se siguen seleccionando como `dispositivo`. */
	| { tipo: 'rotulo'; id: string };

/**
 * DÓNDE SE ESTÁ TRABAJANDO.
 *
 * Un tablero tiene dos caras y en cada una se hace un oficio distinto: dentro se arma y se
 * cablea, y en el frontal se decide lo que el tablero le dice a quien lo opera. Son dos trabajos
 * con herramientas distintas, y meterlos en la misma pantalla obliga a esquivar la puerta para
 * cablear y a bucear entre canaletas para colocar un piloto.
 *
 *   interior   la placa, los carriles, las canaletas y los cables. La puerta se abre y se aparta.
 *   frontal    la hoja de frente, cerrada, como una superficie técnica sobre la que se compone.
 *   conjunto   el armario entero, para mirarlo y enseñarlo.
 *
 * Cambiar de espacio NO reconstruye nada ni mueve un aparato: solo cambia la cámara, lo que se
 * ve y qué herramientas hay a mano. Y cada espacio se acuerda de su cámara, así que volver es
 * volver a donde uno estaba.
 */
type Espacio = 'interior' | 'frontal' | 'conjunto';

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
	rutaPrevia = undefined; // manda otra vez el reparto completo
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
	asentarPuerta();   // deja la puerta y, con ella, los rótulos que tape
	/*
	 * La escena es nueva, así que la rejilla y las guías que colgaban de la puerta ANTERIOR ya no
	 * existen: se olvidan las referencias antes de volver a dibujarlas. Sin esto, la rejilla se
	 * quedaba apuntando a un grupo liberado y no había forma de apagarla.
	 */
	rejillaFrontal = undefined;
	guiasFrontal = undefined;
	refrescarRejillaFrontal();
	if (espacio === 'frontal') resaltarFrontal();
	pintarListaFrontal();
	asentarSuelo();
	ajustarSombras();
}

/* ======================= EL FRONTAL: ESPACIOS Y EDICIÓN =======================
 *
 * Dos espacios igual de importantes, y la misma escena para los dos. Cambiar de espacio no
 * reconstruye nada ni mueve un aparato: cambia la cámara, lo que se ve y las herramientas.
 */

let espacio: Espacio = 'interior';
/** La cámara de cada espacio, para poder volver a donde uno estaba. */
const camaraDeEspacio = new Map<Espacio, { pos: THREE.Vector3; mira: THREE.Vector3 }>();
/** Piezas del frontal marcadas además de la principal (Mayúsculas). */
let frontalExtra: { clase: 'aparato' | 'rotulo'; id: string }[] = [];

/** La hoja de la puerta, en milímetros. Es la superficie sobre la que se compone el frontal. */
function hojaDeLaPuerta(): { ancho: number; alto: number } {
	const caja = cajaDe(proyecto.gabinete!);
	return { ancho: caja.ancho, alto: caja.alto };
}

/**
 * Las piezas del frontal tal como están en el PROYECTO, con la huella que ocupan.
 *
 * Sale del modelo y no de la escena a propósito: el editor mueve datos, y la escena es lo que se
 * dibuja a partir de ellos. Si el editor leyera la escena, redondear un milímetro al dibujar
 * acabaría corriendo la pieza de sitio cada vez que se la tocara.
 */
function piezasFrontal(): PiezaFrontal[] {
	const g = proyecto.gabinete;
	if (!g) return [];
	const piezas: PiezaFrontal[] = [];
	for (const col of g.colocaciones) {
		if (col.montaje !== 'puerta') continue;
		const d = proyecto.dispositivos.find((x) => x.id === col.dispositivoId);
		if (!d) continue;
		const h = huellaFrontal(d);
		piezas.push({
			id: col.dispositivoId, clase: 'aparato', x: col.x, y: col.y,
			ancho: h.ancho, alto: h.alto ?? h.ancho,
		});
	}
	for (const r of g.rotulos ?? []) {
		const grupo = escenario.frontal.find((f) => f.tipo === 'rotulo' && f.id === r.id)?.grupo;
		const h = grupo?.userData.huellaRotulo as { ancho: number; alto: number } | undefined;
		piezas.push({
			id: r.id, clase: 'rotulo', x: r.x, y: r.y,
			ancho: h?.ancho ?? 40, alto: h?.alto ?? (r.alto ?? 5),
		});
	}
	return piezas;
}

/** Escribe la posición de una pieza en el modelo. Es el único sitio que la mueve. */
function moverPiezaFrontal(clase: 'aparato' | 'rotulo', id: string, x: number, y: number): void {
	const g = proyecto.gabinete!;
	if (clase === 'aparato') {
		const col = g.colocaciones.find((c) => c.dispositivoId === id);
		if (col) { col.x = Math.round(x); col.y = Math.round(y); }
	} else {
		const r = g.rotulos?.find((k) => k.id === id);
		if (r) { r.x = Math.round(x); r.y = Math.round(y); }
	}
	// Y en la escena, moviendo SOLO ese grupo. Colocar una pieza no reconstruye la puerta.
	const m = escenario.frontal.find((f) => f.id === id && f.tipo === clase);
	if (m) escenario.puerta.colocar(m.grupo, 'frente', Math.round(x), Math.round(y), 0);
}

/* --------------------------- Señalar en el frontal --------------------------- */

/**
 * LA PIEZA DEL FRONTAL BAJO EL PUNTERO, con tolerancia en PÍXELES.
 *
 * Mismo criterio que los cables y por el mismo motivo: una lente de 22 mm vista de lejos son unos
 * pocos píxeles. Se mide contra la huella real de cada pieza y nunca por debajo de un dedo de
 * ratón, así que da igual el zoom.
 */
function piezaFrontalBajoElPuntero(ev: MouseEvent, tolerancia = 12): PiezaFrontal | undefined {
	if (!escenario.envolvente.visible) return undefined;
	const px = punteroEnPixeles(ev);
	prepararProyeccion();
	const piezas = piezasFrontal();
	let mejor: { p: PiezaFrontal; d: number } | undefined;
	for (const p of piezas) {
		const m = escenario.frontal.find((f) => f.id === p.id && f.tipo === p.clase);
		if (!m) continue;
		const c = m.grupo.getWorldPosition(new THREE.Vector3());
		const v = aPixeles(c.x, c.y, c.z, px.ancho, px.alto);
		if (v.w <= 0) continue;
		const borde = aPixeles(c.x + p.ancho / 2, c.y, c.z, px.ancho, px.alto);
		const radio = Math.max(tolerancia, Math.hypot(borde.x - v.x, borde.y - v.y));
		const d = Math.hypot(v.x - px.x, v.y - px.y);
		if (d > radio) continue;
		if (!mejor || d < mejor.d) mejor = { p, d };
	}
	return mejor?.p;
}

/**
 * El punto del ratón sobre EL PLANO DE LA HOJA, en milímetros desde su esquina superior izquierda.
 *
 * Se usa el plano de la puerta esté donde esté —abierta, cerrada o a medias—, así que las piezas
 * se pueden mover también con el armario en escorzo. Y como todo se expresa en el plano de la
 * hoja, una pieza NO PUEDE quedarse flotando por delante o por detrás de la chapa: no hay ninguna
 * coordenada donde meter esa distancia. No es una comprobación, es que no existe el grado de
 * libertad.
 */
function puntoEnLaPuerta(ev: MouseEvent): { x: number; y: number } | undefined {
	const f = escenario.puerta.frente;
	f.updateMatrixWorld(true);
	const q = f.getWorldQuaternion(new THREE.Quaternion());
	const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
	const origen = f.getWorldPosition(new THREE.Vector3());
	punteroEnPixeles(ev);
	raycaster.setFromCamera(puntero, camaraViva());
	const impacto = new THREE.Vector3();
	const plano = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origen);
	if (!raycaster.ray.intersectPlane(plano, impacto)) return undefined;
	const local = f.worldToLocal(impacto.clone());
	const hoja = hojaDeLaPuerta();
	return { x: local.x + hoja.ancho / 2, y: hoja.alto / 2 - local.y };
}

/* ------------------------------- Arrastre ------------------------------- */

interface ArrastreFrontal {
	pieza: PiezaFrontal;
	/** Del centro de la pieza al punto donde se pinchó: mover no debe centrarla en el cursor. */
	dx: number;
	dy: number;
	/** Y las demás piezas marcadas, con su desfase respecto a la que se agarró. */
	acompanan: { clase: 'aparato' | 'rotulo'; id: string; dx: number; dy: number }[];
	movido: boolean;
}
let arrastreFrontal: ArrastreFrontal | undefined;
let guiasFrontal: THREE.Group | undefined;

/** Dibuja las guías del imantado sobre la hoja. Se borran al soltar: no son decoración fija. */
function mostrarGuiasFrontal(guias: Guia[]): void {
	quitarGuiasFrontal();
	if (!guias.length) return;
	const hoja = hojaDeLaPuerta();
	const g = new THREE.Group();
	for (const guia of guias) {
		const puntos = guia.eje === 'x'
			? [new THREE.Vector3(guia.valor - hoja.ancho / 2, hoja.alto / 2, 1.2),
				new THREE.Vector3(guia.valor - hoja.ancho / 2, -hoja.alto / 2, 1.2)]
			: [new THREE.Vector3(-hoja.ancho / 2, hoja.alto / 2 - guia.valor, 1.2),
				new THREE.Vector3(hoja.ancho / 2, hoja.alto / 2 - guia.valor, 1.2)];
		const linea = new THREE.Line(
			new THREE.BufferGeometry().setFromPoints(puntos),
			new THREE.LineBasicMaterial({
				// La rejilla y un vecino no son lo mismo y no se pintan igual: azul es «me he
				// alineado con esa pieza», gris es «he caído en la rejilla».
				color: guia.con === 'rejilla' ? 0x8a929a : 0x4da3ff,
				transparent: true, opacity: 0.9, depthTest: false,
			}),
		);
		linea.renderOrder = 997;
		linea.raycast = () => undefined;
		g.add(linea);
	}
	escenario.puerta.frente.add(g);
	guiasFrontal = g;
}

function quitarGuiasFrontal(): void {
	if (!guiasFrontal) return;
	guiasFrontal.parent?.remove(guiasFrontal);
	liberar(guiasFrontal);
	guiasFrontal = undefined;
}

/** La rejilla del frontal, si está encendida. Se dibuja una vez y se enseña o se esconde. */
let rejillaFrontal: THREE.Object3D | undefined;

function refrescarRejillaFrontal(): void {
	const on = espacio === 'frontal' && ($('frontal-rejilla') as HTMLInputElement).checked;
	if (rejillaFrontal) { rejillaFrontal.parent?.remove(rejillaFrontal); liberar(rejillaFrontal); rejillaFrontal = undefined; }
	if (!on) return;
	const paso = Math.max(1, Number(($('frontal-paso') as HTMLInputElement).value) || 5);
	const hoja = hojaDeLaPuerta();
	const puntos: THREE.Vector3[] = [];
	for (let x = paso; x < hoja.ancho; x += paso) {
		puntos.push(new THREE.Vector3(x - hoja.ancho / 2, hoja.alto / 2, 0.9),
			new THREE.Vector3(x - hoja.ancho / 2, -hoja.alto / 2, 0.9));
	}
	for (let y = paso; y < hoja.alto; y += paso) {
		puntos.push(new THREE.Vector3(-hoja.ancho / 2, hoja.alto / 2 - y, 0.9),
			new THREE.Vector3(hoja.ancho / 2, hoja.alto / 2 - y, 0.9));
	}
	const g = new THREE.LineSegments(
		new THREE.BufferGeometry().setFromPoints(puntos),
		new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14 }),
	);
	g.raycast = () => undefined;
	escenario.puerta.frente.add(g);
	rejillaFrontal = g;
}

/** Las ayudas que están activas ahora mismo. Alt las apaga todas mientras se tenga apretada. */
function ayudasFrontal(ev: MouseEvent): AyudasFrontal {
	const imantar = ($('frontal-snap') as HTMLInputElement).checked && !ev.altKey;
	const rejilla = ($('frontal-rejilla') as HTMLInputElement).checked
		? Math.max(1, Number(($('frontal-paso') as HTMLInputElement).value) || 5)
		: undefined;
	return { imantar, rejilla, tolerancia: 4 };
}

/** Un movimiento del ratón con una pieza del frontal agarrada. */
function moverArrastreFrontal(ev: MouseEvent): void {
	if (!arrastreFrontal) {
		// Sin nada agarrado, el ratón solo señala: cursor de mano sobre lo que se puede coger.
		renderer.domElement.style.cursor = piezaFrontalBajoElPuntero(ev) ? 'grab' : '';
		return;
	}
	const p = puntoEnLaPuerta(ev);
	if (!p) return;
	const a = arrastreFrontal;
	const hoja = hojaDeLaPuerta();
	const bruto = { x: p.x + a.dx, y: p.y + a.dy };
	/*
	 * Las ayudas se calculan contra las piezas que NO se están moviendo: alinearse consigo mismo no
	 * significa nada, y con Alt no se calcula ninguna.
	 */
	const quietas = piezasFrontal().filter(
		(q) => !(q.clase === a.pieza.clase && q.id === a.pieza.id)
			&& !a.acompanan.some((k) => k.clase === q.clase && k.id === q.id),
	);
	const imantado = imantarEnFrontal(bruto, quietas, ayudasFrontal(ev));
	const sitio = dentroDeLaHoja(imantado, a.pieza, hoja);
	moverPiezaFrontal(a.pieza.clase, a.pieza.id, sitio.x, sitio.y);
	for (const q of a.acompanan) {
		const suyo = dentroDeLaHoja({ x: sitio.x + q.dx, y: sitio.y + q.dy },
			piezasFrontal().find((k) => k.clase === q.clase && k.id === q.id) ?? { ancho: 24, alto: 24 }, hoja);
		moverPiezaFrontal(q.clase, q.id, suyo.x, suyo.y);
	}
	mostrarGuiasFrontal(imantado.guias);
	a.movido = true;
	$('ayuda').textContent = `🎛️ ${Math.round(sitio.x)} · ${Math.round(sitio.y)} mm`
		+ (imantado.guias.length ? ` · imantado a ${imantado.guias.map((g) => g.con).join(' y ')}` : '')
		+ ' · Alt para colocar al milímetro';
}

/** Soltar. Aquí NO se recoloca nada: la pieza se queda exactamente donde se dejó. */
function soltarArrastreFrontal(): void {
	const a = arrastreFrontal;
	arrastreFrontal = undefined;
	quitarGuiasFrontal();
	arrastrando = false;
	permitirOrbita(true);
	renderer.domElement.style.cursor = '';
	if (!a) return;
	if (a.movido) {
		/*
		 * EL PASO DE DESHACER SE TOMA AQUÍ, Y ANTES NO SE TOMABA EN NINGUNA PARTE.
		 *
		 * Este comentario prometía «la foto se captura al soltar» y no había ninguna llamada a
		 * `capturar()` en todo el arrastre del frontal. O sea: mover un piloto por la puerta no
		 * dejaba paso en el historial, y Ctrl+Z después deshacía LO ANTERIOR. Medido usando el
		 * editor: mover de x=228 a x=304, deshacer, y la pieza aparecía en 229 —el estado que
		 * había guardado la última pulsación de flecha— con la posición nueva perdida.
		 *
		 * La foto tiene que ser del sitio DE PARTIDA, y al soltar las piezas ya están en el de
		 * llegada. Así que se las devuelve un instante a donde estaban, se hace la foto y se las
		 * vuelve a poner donde el usuario las dejó. Son dos escrituras de dos números por pieza,
		 * sin dibujar nada entre medias, y a cambio el historial guarda exactamente el paso que
		 * el usuario acaba de dar.
		 *
		 * Hacerlo al soltar y no al primer movimiento tiene además dos ventajas: un clic que no
		 * llega a mover nada no gasta paso, y no se llama a `autoguardar()` en cada `pointermove`,
		 * que serializaría el proyecto entero decenas de veces por arrastre.
		 */
		const tocadas = [
			{ clase: a.pieza.clase, id: a.pieza.id, x0: a.pieza.x, y0: a.pieza.y },
			...a.acompanan.map((q) => ({ clase: q.clase, id: q.id, x0: a.pieza.x + q.dx, y0: a.pieza.y + q.dy })),
		].map((t) => {
			const q = piezasFrontal().find((k) => k.clase === t.clase && k.id === t.id);
			return { ...t, x: q?.x ?? t.x0, y: q?.y ?? t.y0 };
		});
		for (const t of tocadas) moverPiezaFrontal(t.clase, t.id, t.x0, t.y0);
		// Si el proyecto es de solo lectura, `capturar` dice que no y las piezas se quedan donde
		// estaban: el arrastre se deshace solo, que es lo honesto.
		const sePuedeEditar = capturar();
		if (sePuedeEditar) {
			for (const t of tocadas) moverPiezaFrontal(t.clase, t.id, t.x, t.y);
			marcarSucio();
		}
		pintarListaFrontal();
		pintarSeleccion();
	}
	$('ayuda').textContent = espacio === 'frontal'
		? '🎛️ FRONTAL — Arrastra los mandos y los rótulos sobre la puerta · Mayúsculas para elegir varios · '
			+ 'Alt mientras arrastras coloca al milímetro sin ayudas · Supr quita · Ctrl+D duplica'
		: AYUDA[modo];
}

/* ------------------- La ficha de un componente de puerta ------------------- */

/**
 * LA FICHA SE DIBUJA SOLA A PARTIR DE LO QUE DECLARA LA FAMILIA.
 *
 * No hay una línea aquí que sepa qué es un piloto. Cuando llegue el pulsador, la seta o el
 * voltímetro, cada uno declarará sus propiedades en su ficha y este panel las enseñará sin
 * enterarse. Lo único que pone el editor por su cuenta es lo que tienen TODOS: dónde está y qué
 * se puede hacer con él.
 */
function pintarPanelComponenteFrontal(id: string): void {
	const panel = $('panel-der');
	const d = proyecto.dispositivos.find((x) => x.id === id);
	const col = proyecto.gabinete?.colocaciones.find((c) => c.dispositivoId === id);
	if (!d || !col) { panel.style.display = 'none'; return; }
	const ficha = fichaFrontal(d);
	panel.style.display = 'block';

	const campos = ficha.propiedades.map((p, i) => {
		const valor = (d as unknown as Record<string, unknown>)[p.clave];
		const idc = `fp-${i}`;
		if (p.tipo === 'lista') {
			const ops = (p.opciones ?? []).map((o) =>
				`<option value="${escaparHtml(o.valor)}"${String(valor ?? p.porDefecto) === o.valor ? ' selected' : ''}>${escaparHtml(o.texto)}</option>`).join('');
			return `<div class="campo"><label for="${idc}">${escaparHtml(p.etiqueta)}</label>`
				+ `<span><select id="${idc}">${ops}</select></span></div>`;
		}
		const tipo = p.tipo === 'numero' ? 'number' : 'text';
		return `<div class="campo"><label for="${idc}">${escaparHtml(p.etiqueta)}</label>`
			+ `<span><input id="${idc}" type="${tipo}" value="${escaparHtml(String(valor ?? ''))}">`
			+ `${p.unidad ? ` ${escaparHtml(p.unidad)}` : ''}</span></div>`;
	}).join('');

	panel.innerHTML = `
		<h1>${escaparHtml(d.designacion ?? d.id)}</h1>
		<div class="sub">${escaparHtml(ficha.familia)} · montado en la puerta</div>
		${campos}
		<div class="campo"><label for="fp-x">X</label><span><input id="fp-x" type="number" step="1" value="${Math.round(col.x)}"> mm</span></div>
		<div class="campo"><label for="fp-y">Y</label><span><input id="fp-y" type="number" step="1" value="${Math.round(col.y)}"> mm</span></div>
		<div class="botonera">
			<button class="boton" id="fp-duplicar">⧉ Duplicar</button>
			<button class="boton" id="fp-borrar">🗑 Quitar</button>
		</div>`;

	ficha.propiedades.forEach((p, i) => {
		const el = document.getElementById(`fp-${i}`) as HTMLInputElement | HTMLSelectElement | null;
		if (!el) return;
		el.onchange = () => {
			if (!capturar()) return;
			const bruto = el.value.trim();
			const objeto = d as unknown as Record<string, unknown>;
			if (p.tipo === 'numero') objeto[p.clave] = bruto === '' ? undefined : Number(bruto);
			else objeto[p.clave] = bruto === '' ? undefined : bruto;
			/*
			 * Solo se rehace la GEOMETRÍA DE ESE COMPONENTE, y solo si la propiedad la cambia. Un
			 * color de lente sí; una descripción no. Cambiar el color de un piloto no puede costar
			 * reconstruir el armario entero, y con decenas de mandos en la puerta se notaría.
			 */
			if (p.rehaceGeometria) rehacerComponenteFrontal(id);
			recalcular();
			pintarListaFrontal();
			pintarPaneles();
			pintarSeleccion();
			marcarSucio();
		};
	});
	const mover = (cual: 'x' | 'y') => () => {
		const el = $(`fp-${cual}`) as HTMLInputElement;
		if (!capturar()) return;
		const hoja = hojaDeLaPuerta();
		const pieza = piezasFrontal().find((q) => q.clase === 'aparato' && q.id === id) ?? { ancho: 30, alto: 30 };
		const destino = dentroDeLaHoja(
			{ x: cual === 'x' ? Number(el.value) || 0 : col.x, y: cual === 'y' ? Number(el.value) || 0 : col.y },
			pieza, hoja,
		);
		moverPiezaFrontal('aparato', id, destino.x, destino.y);
		pintarListaFrontal();
		pintarSeleccion();
		marcarSucio();
	};
	($('fp-x') as HTMLInputElement).onchange = mover('x');
	($('fp-y') as HTMLInputElement).onchange = mover('y');
	($('fp-duplicar') as HTMLButtonElement).onclick = () => duplicarFrontal();
	($('fp-borrar') as HTMLButtonElement).onclick = () => borrarFrontal();
}

/**
 * Rehace UN componente de la puerta y nada más.
 *
 * Se quita su grupo, se construye otro con los datos nuevos y se cuelga donde estaba. El armario,
 * la puerta, los otros mandos, los rótulos y todo el interior se quedan como están: cambiar el
 * color de una lente no puede costar volver a montar el tablero.
 */
function rehacerComponenteFrontal(id: string): void {
	const d = proyecto.dispositivos.find((x) => x.id === id);
	const col = proyecto.gabinete?.colocaciones.find((c) => c.dispositivoId === id);
	const i = escenario.frontal.findIndex((f) => f.tipo === 'aparato' && f.id === id);
	if (!d || !col || i < 0) return;
	const viejo = escenario.frontal[i].grupo;
	viejo.parent?.remove(viejo);
	liberar(viejo);
	const nuevo = construirComponentePuerta(d, col);
	escenario.puerta.colocar(nuevo, 'frente', col.x, col.y, 0);
	escenario.frontal[i] = { tipo: 'aparato', id, grupo: nuevo };
	const j = escenario.aparatos.findIndex((g) => g.userData.dispositivoId === id);
	if (j >= 0) escenario.aparatos[j] = nuevo;
	if (espacio === 'frontal') resaltarFrontal();
}

/* ------------------------- La ficha de un rótulo ------------------------- */

function pintarPanelRotulo(id: string): void {
	const panel = $('panel-der');
	const r = proyecto.gabinete?.rotulos?.find((k) => k.id === id);
	if (!r) { panel.style.display = 'none'; return; }
	panel.style.display = 'block';
	const opcion = (v: string, t: string) => `<option value="${v}"${(r.estilo ?? 'grabado') === v ? ' selected' : ''}>${t}</option>`;
	panel.innerHTML = `
		<h1>Rótulo</h1>
		<div class="sub">Señalética del frontal · no es un aparato: no consume ni sale en el esquema</div>
		<div class="campo"><label for="rot-texto">Texto</label></div>
		<textarea id="rot-texto" rows="3" style="width:100%">${escaparHtml(r.texto)}</textarea>
		<div class="campo"><label for="rot-estilo">Tipo</label><span><select id="rot-estilo">
			${opcion('grabado', 'Grabado en la chapa')}${opcion('placa', 'Placa atornillada')}${opcion('aviso', 'Aviso de riesgo')}
		</select></span></div>
		<div class="campo"><label for="rot-alto">Altura de letra</label><span><input type="number" id="rot-alto" min="2" max="40" step="0.5" value="${r.alto ?? 5}"> mm</span></div>
		<div class="campo"><label for="rot-ancho">Ancho máximo</label><span><input type="number" id="rot-ancho" min="10" max="1200" step="5" value="${Math.round(r.ancho ?? 0) || ''}" placeholder="auto"> mm</span></div>
		<div class="campo"><label for="rot-x">X</label><span><input type="number" id="rot-x" step="1" value="${Math.round(r.x)}"> mm</span></div>
		<div class="campo"><label for="rot-y">Y</label><span><input type="number" id="rot-y" step="1" value="${Math.round(r.y)}"> mm</span></div>
		<div class="botonera">
			<button class="boton" id="rot-duplicar">⧉ Duplicar</button>
			<button class="boton" id="rot-borrar">🗑 Quitar</button>
		</div>`;

	const guardar = (cambio: () => void, rehacer: boolean) => {
		if (!capturar()) return;
		cambio();
		if (rehacer) trasCambiarFrontal();
		else { moverPiezaFrontal('rotulo', r.id, r.x, r.y); pintarListaFrontal(); marcarSucio(); }
	};
	// El texto y el aspecto cambian la geometría, así que hay que rehacerla; mover no.
	($('rot-texto') as HTMLTextAreaElement).onchange = (e) =>
		guardar(() => { r.texto = (e.target as HTMLTextAreaElement).value.slice(0, 120); }, true);
	($('rot-estilo') as HTMLSelectElement).onchange = (e) =>
		guardar(() => { r.estilo = (e.target as HTMLSelectElement).value as typeof r.estilo; }, true);
	($('rot-alto') as HTMLInputElement).onchange = (e) =>
		guardar(() => { r.alto = Math.max(2, Number((e.target as HTMLInputElement).value) || 5); }, true);
	($('rot-ancho') as HTMLInputElement).onchange = (e) => guardar(() => {
		const v = Number((e.target as HTMLInputElement).value);
		if (v > 0) r.ancho = v; else delete r.ancho;
	}, true);
	($('rot-x') as HTMLInputElement).onchange = (e) =>
		guardar(() => { r.x = Math.round(Number((e.target as HTMLInputElement).value) || 0); }, false);
	($('rot-y') as HTMLInputElement).onchange = (e) =>
		guardar(() => { r.y = Math.round(Number((e.target as HTMLInputElement).value) || 0); }, false);
	($('rot-duplicar') as HTMLButtonElement).onclick = () => duplicarFrontal();
	($('rot-borrar') as HTMLButtonElement).onclick = () => borrarFrontal();
}

/* ------------------------- Cambiar de espacio ------------------------- */

/** Encuadra la puerta de frente, como una lámina técnica. */
function encuadrarFrontal(): void {
	const hoja = hojaDeLaPuerta();
	const lienzo = renderer.domElement;
	const alto = Math.max(40, lienzo.clientHeight);
	const tapaIzq = $('panel-izq').getBoundingClientRect().width;
	const panelDer = $('panel-der');
	const tapaDer = panelDer.style.display === 'none' ? 0 : panelDer.getBoundingClientRect().width;
	const anchoVisible = Math.max(260, lienzo.clientWidth - tapaIzq - tapaDer);
	const fovV = (camara.fov * Math.PI) / 180;
	const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (anchoVisible / alto));
	// 1,18 es el aire alrededor de la hoja: lo justo para ver el marco y el canto del armario.
	const distancia = Math.max(
		(hoja.alto * 1.18) / 2 / Math.tan(fovV / 2),
		(hoja.ancho * 1.18) / 2 / Math.tan(fovH / 2),
		320,
	);
	const mundoPorPixel = (2 * distancia * Math.tan(fovV / 2)) / alto;
	const desvio = ((tapaIzq - tapaDer) / 2) * mundoPorPixel;
	// La puerta cerrada está delante de la boca del armario; la cámara se pone frente a ELLA.
	const zPuerta = escenario.puerta.frente.getWorldPosition(new THREE.Vector3()).z;
	controles.target.set(-desvio, 0, zPuerta);
	camara.position.set(-desvio, 0, zPuerta + distancia);
	controles.update();
}

/**
 * CAMBIA DE ESPACIO. No reconstruye la escena ni toca una sola posición del tablero.
 *
 * Lo que hace es tres cosas: guardar dónde estaba la cámara del espacio que se deja, poner la del
 * que se entra —la que quedó guardada, o una de estreno si es la primera vez— y ajustar qué se ve
 * y qué se puede tocar. Volver a un espacio es volver exactamente a donde uno estaba.
 */
function aplicarEspacio(nuevo: Espacio): void {
	if (colocando) soltarColocacion();
	// Se guarda la cámara del espacio que se abandona.
	camaraDeEspacio.set(espacio, {
		pos: camara.position.clone(), mira: controles.target.clone(),
	});
	const antes = espacio;
	espacio = nuevo;
	for (const [id, e] of [['esp-interior', 'interior'], ['esp-frontal', 'frontal'], ['esp-conjunto', 'conjunto']] as const) {
		$(id).classList.toggle('activo', espacio === e);
	}
	document.body.classList.toggle('espacio-frontal', espacio === 'frontal');

	/*
	 * LA PUERTA SE PONE DONDE HAGA FALTA PARA EL OFICIO DE CADA ESPACIO, y solo al ENTRAR: dentro
	 * del espacio manda el botón, porque un usuario que abre la puerta en el frontal para ver los
	 * cuerpos por dentro no quiere que se le vuelva a cerrar sola.
	 */
	if (antes !== nuevo) {
		if (espacio === 'frontal') moverPuerta(false);          // cerrada: es la superficie a componer
		else if (espacio === 'interior') moverPuerta(true);     // abierta: estorba menos
	}
	// En el frontal no se cablea ni se mueven canaletas: la selección del interior se suelta.
	if (espacio === 'frontal' && sel && sel.tipo !== 'rotulo' && sel.tipo !== 'dispositivo') {
		aplicarSeleccion(undefined);
	}
	if (espacio !== 'frontal') { frontalExtra = []; quitarGuiasFrontal(); }
	escenario.bornes.visible = espacio === 'interior' && modo === 'trabajo' && !visualizacion;

	const guardada = camaraDeEspacio.get(espacio);
	if (guardada) {
		camara.position.copy(guardada.pos);
		controles.target.copy(guardada.mira);
		controles.update();
	} else if (espacio === 'frontal') {
		encuadrarFrontal();
	} else {
		encuadrar();
	}
	refrescarRejillaFrontal();
	pintarListaFrontal();
	pintarSeleccion();
	$('ayuda').textContent = espacio === 'frontal'
		? '🎛️ FRONTAL — Arrastra los mandos y los rótulos sobre la puerta · Mayúsculas para elegir varios · '
			+ 'Alt mientras arrastras coloca al milímetro sin ayudas · Supr quita · Ctrl+D duplica'
		: espacio === 'conjunto'
			? '🧊 CONJUNTO — El armario entero. Gira y acerca la vista; para editar, entra en Interior o Frontal.'
			: AYUDA[modo];
}

/* ------------------------- La lista y las órdenes ------------------------- */

/** ¿Está esta pieza marcada, sola o dentro de la selección múltiple? */
function frontalMarcado(clase: 'aparato' | 'rotulo', id: string): boolean {
	const principal = clase === 'rotulo' ? sel?.tipo === 'rotulo' && sel.id === id
		: sel?.tipo === 'dispositivo' && sel.id === id;
	return principal || frontalExtra.some((f) => f.clase === clase && f.id === id);
}

/** Todas las piezas marcadas, en orden de la lista. */
function seleccionFrontal(): PiezaFrontal[] {
	return piezasFrontal().filter((p) => frontalMarcado(p.clase, p.id));
}

function pintarListaFrontal(): void {
	const ul = document.getElementById('lista-frontal');
	if (!ul) return;
	ul.innerHTML = '';
	const g = proyecto.gabinete;
	if (!g) return;
	for (const p of piezasFrontal()) {
		const li = document.createElement('li');
		li.className = frontalMarcado(p.clase, p.id) ? 'seleccionado' : '';
		let nombre = p.id;
		let color = '#8a929a';
		if (p.clase === 'aparato') {
			const d = proyecto.dispositivos.find((x) => x.id === p.id);
			nombre = d?.designacion ?? p.id;
			color = `#${colorDePiloto(d ?? ({ } as Dispositivo)).toString(16).padStart(6, '0')}`;
		} else {
			nombre = (g.rotulos?.find((r) => r.id === p.id)?.texto ?? p.id).split(/\n/)[0];
			color = '#cfd6de';
		}
		li.innerHTML = `<span class="punto" style="background:${color}"></span>`
			+ `<span class="des">${escaparHtml(nombre)}</span>`
			+ `<span class="donde">${Math.round(p.x)} · ${Math.round(p.y)}</span>`;
		li.onclick = (ev) => {
			if (ev.shiftKey) alternarFrontalExtra(p.clase, p.id);
			else seleccionarFrontal(p.clase, p.id);
		};
		ul.appendChild(li);
	}
}

function seleccionarFrontal(clase: 'aparato' | 'rotulo', id: string): void {
	frontalExtra = [];
	aplicarSeleccion(clase === 'rotulo' ? { tipo: 'rotulo', id } : { tipo: 'dispositivo', id });
	pintarListaFrontal();
}

function alternarFrontalExtra(clase: 'aparato' | 'rotulo', id: string): void {
	if (!sel) { seleccionarFrontal(clase, id); return; }
	if (frontalMarcado(clase, id)) {
		frontalExtra = frontalExtra.filter((f) => !(f.clase === clase && f.id === id));
	} else {
		frontalExtra.push({ clase, id });
	}
	resaltarFrontal();
	pintarListaFrontal();
	pintarSeleccion();
}

/** Los recuadros de lo marcado en el frontal. Se rehacen enteros: son cuatro líneas. */
let marcosFrontal: THREE.LineSegments[] = [];

/**
 * MARCA LO ELEGIDO CON UN RECUADRO, no tiñendo materiales.
 *
 * Aquí había un fallo de los que no se ven hasta que se ven: se recorría el grupo y se le subía el
 * `emissive` a cada material. Los rótulos se dibujan con la tinta del ATLAS, y esa tinta es UN
 * material compartido por toda la escena —dos, en realidad: uno claro y uno oscuro—. Marcar un
 * rótulo ponía azul la serigrafía de TODO el tablero: los números de los bornes, las referencias
 * de los aparatos, todo.
 *
 * El arreglo no es esquivar los rótulos, que dejaría la misma trampa puesta para el siguiente que
 * comparta un material. Es no tocar materiales que no son tuyos: se dibuja un recuadro, que es
 * además lo que ya hace el resto del programa para decir «esto está seleccionado».
 */
function resaltarFrontal(): void {
	for (const m of marcosFrontal) { m.parent?.remove(m); m.geometry.dispose(); }
	marcosFrontal = [];
	if (espacio !== 'frontal') return;
	for (const m of escenario.frontal) {
		if (!frontalMarcado(m.tipo, m.id)) continue;
		const principal = (m.tipo === 'rotulo' && sel?.tipo === 'rotulo' && sel.id === m.id)
			|| (m.tipo === 'aparato' && sel?.tipo === 'dispositivo' && sel.id === m.id);
		const marco = marcoDe(m.grupo, principal ? 0x4da3ff : 0x2f6fa8, principal ? 0.95 : 0.7, 4);
		if (marco) marcosFrontal.push(marco);
	}
}

/* ------------------------- Añadir, duplicar y quitar ------------------------- */

/** Un hueco libre cerca del centro de la hoja, para no nacer encima de otra cosa. */
function huecoEnLaHoja(ancho: number, alto: number): { x: number; y: number } {
	const hoja = hojaDeLaPuerta();
	const piezas = piezasFrontal();
	for (let anillo = 0; anillo < 24; anillo++) {
		for (const [sx, sy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
			const x = hoja.ancho / 2 + sx * anillo * 44;
			const y = hoja.alto * 0.22 + sy * anillo * 40;
			const choca = piezas.some((p) => Math.abs(p.x - x) < (p.ancho + ancho) / 2 + 6
				&& Math.abs(p.y - y) < (p.alto + alto) / 2 + 6);
			if (!choca) return dentroDeLaHoja({ x, y }, { ancho, alto }, hoja);
		}
	}
	return dentroDeLaHoja({ x: hoja.ancho / 2, y: hoja.alto / 2 }, { ancho, alto }, hoja);
}

function idLibre(prefijo: string, usados: (id: string) => boolean): string {
	for (let i = 1; i < 9999; i++) if (!usados(`${prefijo}${i}`)) return `${prefijo}${i}`;
	return `${prefijo}${Date.now()}`;
}

function anadirPilotoFrontal(): void {
	if (!capturar()) return;
	const g = proyecto.gabinete!;
	const id = idLibre('h', (k) => proyecto.dispositivos.some((d) => d.id === k));
	const sitio = huecoEnLaHoja(30, 30);
	/*
	 * Los valores de arranque salen de la FICHA de la familia, no de un literal escrito aquí. Era
	 * justo lo que dejaba todos los pilotos verdes: un `colorSenal: 'verde'` en esta línea, sin
	 * ningún sitio donde cambiarlo después.
	 */
	proyecto.dispositivos.push({
		id, tipo: 'piloto', designacion: id.toUpperCase(),
		descripcion: 'Piloto de señalización (puerta)',
		corrienteNominal: 0.02,
		bornes: [{ id: 'X1' }, { id: 'X2' }],
		...valoresPorDefecto('piloto'),
	} as Dispositivo);
	g.colocaciones.push({
		dispositivoId: id, x: sitio.x, y: sitio.y, ancho: 30, alto: 30, montaje: 'puerta',
	});
	/*
	 * Y SU RÓTULO DEBAJO. Un mando sin leyenda no dice nada, y un tablero donde hay que acordarse
	 * de rotular cada piloto a mano acaba con la mitad sin rotular. Nace como una pieza aparte, no
	 * pegada al piloto: se mueve, se alinea y se edita por su cuenta, que es lo que hace falta
	 * cuando la leyenda es «MARCHA VENTILADOR» y no cabe centrada bajo el aro.
	 */
	g.rotulos = g.rotulos ?? [];
	g.rotulos.push({
		id: idLibre('rot', (k) => g.rotulos!.some((r) => r.id === k)),
		texto: id.toUpperCase(), x: sitio.x, y: Math.round(sitio.y + 28), alto: 5, montaje: 'puerta',
	});
	trasCambiarFrontal();
	seleccionarFrontal('aparato', id);
}

function anadirRotuloFrontal(estilo: 'grabado' | 'placa' | 'aviso'): void {
	if (!capturar()) return;
	const g = proyecto.gabinete!;
	g.rotulos = g.rotulos ?? [];
	const id = idLibre('rot', (k) => g.rotulos!.some((r) => r.id === k));
	const texto = estilo === 'aviso' ? 'CUIDADO\nTABLERO ELÉCTRICO'
		: estilo === 'placa' ? 'MOTOR 1' : 'MARCHA';
	const alto = estilo === 'aviso' ? 8 : estilo === 'placa' ? 6 : 4.5;
	const sitio = huecoEnLaHoja(texto.length * alto * 0.4, alto * 2.4);
	g.rotulos.push({ id, texto, x: sitio.x, y: sitio.y, alto, estilo, montaje: 'puerta' });
	trasCambiarFrontal();
	seleccionarFrontal('rotulo', id);
}

function duplicarFrontal(): void {
	const piezas = seleccionFrontal();
	if (!piezas.length || !capturar()) return;
	const g = proyecto.gabinete!;
	const nuevos: { clase: 'aparato' | 'rotulo'; id: string }[] = [];
	for (const p of piezas) {
		// El duplicado nace DESPLAZADO, no encima: dos piezas exactamente superpuestas se ven como
		// una y quien duplica cree que no ha pasado nada.
		const dx = p.ancho + 10;
		if (p.clase === 'aparato') {
			const d = proyecto.dispositivos.find((x) => x.id === p.id);
			const col = g.colocaciones.find((c) => c.dispositivoId === p.id);
			if (!d || !col) continue;
			const id = idLibre('h', (k) => proyecto.dispositivos.some((x) => x.id === k));
			/*
			 * COPIA PROFUNDA, y no es una precaución teórica: con `{ ...d }` la copia comparte el
			 * ARRAY DE BORNES con el original, así que tocar un borne de la copia tocaba el del
			 * original y al guardar salían dos aparatos atados por una referencia que nadie ve.
			 * Lo mismo con `terminales`, `puentes` y `rol`. Se clona entero y se le da identidad.
			 */
			proyecto.dispositivos.push({ ...clonar(d), id, designacion: id.toUpperCase() });
			const sitio = dentroDeLaHoja({ x: col.x + dx, y: col.y }, p, hojaDeLaPuerta());
			g.colocaciones.push({ ...col, dispositivoId: id, x: Math.round(sitio.x), y: Math.round(sitio.y) });
			nuevos.push({ clase: 'aparato', id });
		} else {
			const r = g.rotulos?.find((k) => k.id === p.id);
			if (!r) continue;
			const id = idLibre('rot', (k) => g.rotulos!.some((x) => x.id === k));
			const sitio = dentroDeLaHoja({ x: r.x + dx, y: r.y }, p, hojaDeLaPuerta());
			g.rotulos!.push({ ...clonar(r), id, x: Math.round(sitio.x), y: Math.round(sitio.y) });
			nuevos.push({ clase: 'rotulo', id });
		}
	}
	trasCambiarFrontal();
	if (nuevos.length) {
		seleccionarFrontal(nuevos[0].clase, nuevos[0].id);
		frontalExtra = nuevos.slice(1);
		resaltarFrontal();
		pintarListaFrontal();
	}
	avisar(`${nuevos.length} ${nuevos.length === 1 ? 'pieza duplicada' : 'piezas duplicadas'}`, 'ok');
}

function borrarFrontal(): void {
	const piezas = seleccionFrontal();
	if (!piezas.length || !capturar()) return;
	const g = proyecto.gabinete!;
	for (const p of piezas) {
		if (p.clase === 'aparato') {
			// Un aparato se lleva sus cables: dejarlos colgando de un borne que ya no existe es lo
			// que producía los «cables fantasma».
			proyecto.conductores = proyecto.conductores.filter(
				(c) => c.de.dispositivoId !== p.id && c.a.dispositivoId !== p.id,
			);
			proyecto.dispositivos = proyecto.dispositivos.filter((d) => d.id !== p.id);
			g.colocaciones = g.colocaciones.filter((c) => c.dispositivoId !== p.id);
		} else {
			g.rotulos = (g.rotulos ?? []).filter((r) => r.id !== p.id);
		}
	}
	frontalExtra = [];
	aplicarSeleccion(undefined);
	trasCambiarFrontal();
	avisar(`${piezas.length} ${piezas.length === 1 ? 'pieza quitada' : 'piezas quitadas'}`, 'ok');
}

/** Añadir o quitar piezas SÍ cambia la escena: se rehace y se recalcula. Mover, no. */
function trasCambiarFrontal(): void {
	recalcular();
	montarEscenario();
	pintarListaFrontal();
	pintarPaneles();
	pintarSeleccion();
	marcarSucio();
}

function aplicarCambiosFrontal(cambios: Map<string, { x: number; y: number }>, que: string): void {
	if (cambios.size === 0) { avisar('No había nada que mover', 'info'); return; }
	if (!capturar()) return;
	const hoja = hojaDeLaPuerta();
	for (const p of piezasFrontal()) {
		const c = cambios.get(p.id);
		// El borde de la hoja se impone también aquí: alinear a la izquierda un grupo que ya
		// tocaba el canto no puede sacar la primera pieza fuera de la chapa.
		if (c) { const d = dentroDeLaHoja(c, p, hoja); moverPiezaFrontal(p.clase, p.id, d.x, d.y); }
	}
	pintarListaFrontal();
	pintarSeleccion();
	marcarSucio();
	avisar(`${que}: ${cambios.size} ${cambios.size === 1 ? 'pieza' : 'piezas'}`, 'ok');
}

/* ============================ LA PUERTA DEL ARMARIO ============================

 * Una puerta que no se puede cerrar no es una puerta, y una que no se puede abrir tapa el trabajo.
 * Así que es un ESTADO, con dos reglas de sentido común:
 *
 *   · trabajando (Editor y Trabajo) arranca ABIERTA, porque lo que se está haciendo está dentro;
 *   · en Visualización arranca CERRADA, porque ahí se enseña el armario terminado.
 *
 * Y se puede cambiar cuando uno quiera. Además, el armario entero se puede esconder con su
 * casilla: si alguna vez estorba —una cámara metida entre la puerta y la placa—, se quita de en
 * medio sin perder nada, igual que las tapas de las canaletas.
 *
 * La animación NO es física. Es una interpolación con arranque y frenada suaves, de poco más de
 * un tercio de segundo, montada sobre el bucle de dibujo que ya existe: ni un `requestAnimationFrame`
 * nuevo, ni un motor de física para girar una chapa.
 */

/** Dónde está la puerta ahora mismo: 0 cerrada, 1 abierta del todo. */
let puertaAhora = 1;
/** El parámetro sin suavizar, que es sobre el que avanza el tiempo. */
let puertaCrudo = 1;
/** Adónde va. Si coincide con `puertaAhora`, no hay nada que animar. */
let puertaDestino = 1;
/** Segundos que tarda en recorrer todo el arco. */
const PUERTA_SEGUNDOS = 0.38;

/** Arranque y frenada suaves. Sin esto el giro sale de máquina, no de puerta. */
function suavizar(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

/** Lleva la puerta al ángulo que le toca según `puertaAhora`. */
function aplicarPuerta(): void {
	const p = escenario.puerta;
	if (p) p.pivote.rotation.y = p.aperturaMaxima * puertaAhora;
	const b = $('btn-puerta') as HTMLButtonElement | null;
	if (b) b.textContent = puertaDestino > 0.5 ? 'Cerrar la puerta' : 'Abrir la puerta';
	refrescarEtiquetas();
}

/**
 * CON LA PUERTA CERRADA NO SE LEE LO QUE HAY DENTRO.
 *
 * Los rótulos de designación son sprites que se dibujan SIN comprobar profundidad, a propósito:
 * así se leen aunque pase un cable por delante, que es para lo que están. El precio es que
 * atraviesan cualquier cosa, y con una puerta de chapa delante eso se ve raro de verdad: una
 * caja cerrada con «-KM1» flotando encima.
 *
 * No se les cambia el material —eso rompería justo lo que los hace útiles—: se apagan mientras la
 * puerta tape lo que rotulan. Si el armario está escondido no hay puerta que tape nada, y vuelven.
 */
function refrescarEtiquetas(): void {
	const casilla = ($('ver-etiquetas') as HTMLInputElement).checked;
	const hayArmario = escenario.envolvente.visible;
	// 0,15 ≈ 18°: en cuanto la puerta despega, lo de dentro ya se ve.
	const seVeDentro = !hayArmario || puertaAhora > 0.15;
	const v = casilla && !visualizacion && seVeDentro;
	for (const t of escenario.etiquetas) t.visible = v;
}

/** Un paso de la animación. Devuelve verdadero mientras siga moviéndose. */
function animarPuerta(dt: number): boolean {
	if (puertaAhora === puertaDestino) return false;
	const paso = dt / PUERTA_SEGUNDOS;
	const sentido = Math.sign(puertaDestino - puertaAhora);
	// Se avanza sobre el parámetro CRUDO y se suaviza al aplicarlo: así el suavizado no depende
	// del punto de partida y una puerta a medio camino no pega un tirón al cambiar de idea.
	puertaCrudo = Math.max(0, Math.min(1, puertaCrudo + sentido * paso));
	puertaAhora = suavizar(puertaCrudo);
	if ((sentido > 0 && puertaCrudo >= 1) || (sentido < 0 && puertaCrudo <= 0)) {
		puertaCrudo = puertaDestino;
		puertaAhora = puertaDestino;
	}
	aplicarPuerta();
	return true;
}

/** Abre o cierra la puerta con su animación. */
function moverPuerta(abrir: boolean): void {
	puertaDestino = abrir ? 1 : 0;
	aplicarPuerta();
}

/**
 * Deja la puerta como estaba, sin animación, después de montar la escena de nuevo.
 *
 * SE CONSERVA EL ESTADO, no se impone uno. La escena se vuelve a montar cada vez que se mueve un
 * aparato o un carril, y una puerta que se abriera sola en cada uno de esos momentos sería un
 * tic. Arranca abierta —trabajando, lo que importa está dentro— y a partir de ahí manda quien
 * pulse el botón.
 *
 * En Visualización se deja abierta a propósito: ahí los paneles laterales están escondidos, así
 * que el botón no se alcanza, y dejar al usuario delante de una caja cerrada que no puede abrir
 * sería encerrarle fuera de su propio tablero.
 */
function asentarPuerta(): void {
	if (visualizacion) puertaDestino = 1;
	puertaCrudo = puertaDestino;
	puertaAhora = puertaDestino;
	escenario.envolvente.visible = ($('ver-gabinete') as HTMLInputElement).checked;
	aplicarPuerta();
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
/**
 * Copia PROFUNDA de un objeto de datos del proyecto.
 *
 * Un `{ ...x }` copia el objeto pero no lo que cuelga de él: los bornes, los terminales y los
 * puentes siguen siendo los MISMOS arrays. Dos aparatos que comparten su lista de bornes son dos
 * aparatos que en realidad son uno, y el día que se toque cualquiera de los dos se descubre tarde.
 */
function clonar<T>(x: T): T {
	return JSON.parse(JSON.stringify(x)) as T;
}

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
	if (sel.tipo === 'rotulo') {
		pintarPanelRotulo(sel.id);
		return;
	}
	/*
	 * EN EL FRONTAL, LA FICHA LA MANDA EL FRONTAL.
	 *
	 * La ficha corriente de un aparato está partida por el modo del interior: en Editor enseña lo
	 * de colocar y en Trabajo lo de cablear. Un piloto de puerta seleccionado desde el Frontal caía
	 * en la mitad de «Trabajo» y solo ofrecía controles de cableado —justo lo que en la puerta
	 * todavía no se hace—, así que sus propiedades no estaban en ninguna parte y su color no se
	 * podía tocar. Aquí manda el espacio, no el modo.
	 */
	if (espacio === 'frontal' && sel.tipo === 'dispositivo'
		&& proyecto.gabinete?.colocaciones.find((c) => c.dispositivoId === sel!.id)?.montaje === 'puerta') {
		pintarPanelComponenteFrontal(sel.id);
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
	/*
	 * 5. LA CAJA NO PUEDE SER MÁS PEQUEÑA QUE LO QUE TIENE QUE CONTENER, Y LA FICHA TIENE QUE
	 *    DECIRLO.
	 *
	 * El modelo ya agrandaba la envolvente al dibujarla si no cabía la placa, pero el campo se
	 * quedaba con lo tecleado: uno escribía 30 cm, veía dibujados 36 y la ficha seguía diciendo
	 * 30. Aquí se guarda la medida EFECTIVA, la misma que usan el dibujo, el plano y el balance
	 * térmico, y `pintarEstructura` la devuelve al campo. Así lo que se lee es lo que hay.
	 */
	const efectiva = cajaDeGabinete(g);
	g.caja = { ancho: efectiva.ancho, alto: efectiva.alto, profundidad: efectiva.profundidad };
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

/**
 * El grupo 3D de un aparato, esté montado en la placa o en la puerta.
 *
 * Se pregunta al REGISTRO y no a los hijos de `escenario.dispositivos`: desde que hay componentes
 * de puerta, un aparato puede colgar de la hoja —tiene que abrirse con ella— y ya no está ahí.
 */
function grupoDe(id: string): THREE.Group | undefined {
	return escenario.aparatos.find((g) => g.userData.dispositivoId === id) as THREE.Group | undefined;
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
		marcoSeleccion.parent?.remove(marcoSeleccion);
		marcoSeleccion.geometry.dispose();
		marcoSeleccion = undefined;
	}
	// Y el del hover, que si no se queda flotando sobre un aparato que ya no existe al reconstruir.
	hoverDispositivo = undefined;
	if (marcoHover) {
		marcoHover.parent?.remove(marcoHover);
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
	m.renderOrder = 998;
	m.raycast = () => {};
	/*
	 * EL MARCO CUELGA DE DONDE CUELGUE SU APARATO, no de la escena.
	 *
	 * Colgado de la escena, un marco sobre un piloto de puerta se quedaba clavado en el aire en
	 * cuanto la puerta se movía. Colgándolo del padre del aparato viaja con él. Para todo lo que
	 * está en la placa no cambia nada —ese padre no tiene transformación— y para lo que está en la
	 * puerta pasa a ser correcto.
	 *
	 * La caja se midió en coordenadas de MUNDO, así que se le quita la rotación del padre para que
	 * siga siendo la misma caja que se midió.
	 */
	const padre = raiz.parent ?? escena;
	padre.add(m);
	m.position.copy(padre.worldToLocal(centro.clone()));
	m.quaternion.copy(padre.getWorldQuaternion(new THREE.Quaternion()).invert());
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
		marcoHover.parent?.remove(marcoHover);
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
	if (espacio === 'frontal') resaltarFrontal();
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
	if (cable) return { tipo: 'cable', id: cable }; // los cables tienen la prioridad más baja
	// Y si el rayo no ha dado con nada, se mira si el puntero está CERCA de un componente de
	// puerta: una lente de diez milímetros a dos metros son tres píxeles, y acertarle sería
	// cuestión de puntería. Ver `componentePuertaCerca`.
	return componentePuertaCerca(ev);
}

/** Radio de agarre de un componente de puerta, en píxeles. El mismo dedo que para los cables. */
const AGARRE_PUERTA_PX = 15;

/**
 * COMPONENTE DE PUERTA CERCA DEL PUNTERO, medido en PÍXELES.
 *
 * Es la misma regla que se aplicó a los cables y por el mismo motivo: una zona de agarre definida
 * en milímetros se encoge en pantalla justo cuando el tablero se ve de lejos o de canto, que es
 * cuando más falta hace. Aquí la tolerancia es la misma esté el piloto donde esté.
 *
 * Solo entra en juego cuando el trazado de rayos NO ha encontrado nada, así que no le quita el
 * clic a nada: es una red de seguridad, no una prioridad nueva.
 */
function componentePuertaCerca(ev: MouseEvent): Seleccion | undefined {
	if (!escenario.envolvente.visible) return undefined;
	const px = punteroEnPixeles(ev);
	prepararProyeccion();
	let mejor: { id: string; d: number } | undefined;
	for (const g of escenario.aparatos) {
		if (g.userData.montaje !== 'puerta') continue;
		const centro = g.getWorldPosition(new THREE.Vector3());
		const p = aPixeles(centro.x, centro.y, centro.z, px.ancho, px.alto);
		if (p.w <= 0) continue;
		// El radio aparente del propio piloto, para que de cerca la zona sea la pieza y de lejos
		// nunca baje de un dedo de ratón.
		const borde = aPixeles(centro.x + RADIO_PILOTO, centro.y, centro.z, px.ancho, px.alto);
		const radio = Math.max(AGARRE_PUERTA_PX, Math.hypot(borde.x - p.x, borde.y - p.y));
		const d = Math.hypot(p.x - px.x, p.y - px.y);
		if (d > radio) continue;
		if (!mejor || d < mejor.d) mejor = { id: g.userData.dispositivoId as string, d };
	}
	return mejor ? { tipo: 'dispositivo', id: mejor.id } : undefined;
}

/* ==================================================================================
 * SEÑALAR UN CABLE: LA TOLERANCIA SE MIDE EN PÍXELES, NO EN MILÍMETROS
 *
 * «Estoy haciendo clic exactamente sobre el cable y el editor no lo encuentra» tenía una causa
 * concreta y medible: el agarre era un tubo invisible de radio fijo en MILÍMETROS alrededor del
 * cable. Un tubo de 9 mm de radio a 300 mm de la cámara ocupa decenas de píxeles; el mismo tubo
 * al fondo del tablero, o visto de canto, ocupa uno o dos. La zona de agarre se encogía justo
 * cuando más falta hacía, y encima dependía de que el rayo del ratón cortara una malla, así que
 * un cable tapado por una canaleta era imposible de coger aunque se estuviera viendo.
 *
 * Aquí se hace al revés: se proyecta el RECORRIDO REAL del cable a la pantalla y se mide la
 * distancia del puntero a esa polilínea en píxeles. La tolerancia es la misma para todos los
 * cables, cerca o lejos, de frente o de canto, y no depende de ninguna geometría de agarre —que
 * de paso deja de hacer falta—. Y como sale de la polilínea, se sabe además EN QUÉ PUNTO 3D del
 * cable ha caído el puntero, que es lo que hacía falta para insertar uniones donde toca.
 * ================================================================================== */

/** Radio de agarre, en píxeles de pantalla. Un dedo de ratón, no un tubo de milímetros. */
const TOLERANCIA_PX = 12;

/** Un cable señalado por el puntero, con todo lo que hace falta para decidir quién se lleva el clic. */
interface CableSenalado {
	id: string;
	/** El punto del recorrido que queda bajo el puntero, en milímetros de modelo. */
	punto: P3;
	/** Posición continua dentro de la polilínea (índice + fracción del segmento). */
	avance: number;
	/** Distancia del puntero al eje del cable, en píxeles. */
	pixeles: number;
	/** Radio aparente del cable ahí, en píxeles: si `pixeles <= radio`, el puntero está SOBRE el tubo. */
	radio: number;
	/** Distancia del punto a la cámara: sirve para saber quién está delante. */
	profundidad: number;
}

/** Puntero en píxeles del lienzo, y de paso deja `puntero` listo para los trazados de rayo. */
function punteroEnPixeles(ev: MouseEvent): { x: number; y: number; ancho: number; alto: number } {
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	return { x: ev.clientX - r.left, y: ev.clientY - r.top, ancho: r.width, alto: r.height };
}

const _v = new THREE.Vector3();
const _vp = new THREE.Matrix4();

/**
 * Proyecta un punto de ESCENA a píxeles del lienzo.
 *
 * La división de perspectiva se hace a mano para quedarse con la `w`: un punto con `w <= 0` está
 * DETRÁS de la cámara y su proyección sale reflejada. Dejarlo pasar convierte un cable que entra y
 * sale del encuadre en un segmento que cruza toda la pantalla y se lleva clics que no son suyos.
 */
function aPixeles(x: number, y: number, z: number, ancho: number, alto: number): { x: number; y: number; w: number } {
	const e = _vp.elements;
	const w = e[3] * x + e[7] * y + e[11] * z + e[15];
	if (w === 0) return { x: 0, y: 0, w: 0 };
	const nx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
	const ny = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
	return { x: (nx * 0.5 + 0.5) * ancho, y: (-ny * 0.5 + 0.5) * alto, w };
}

/** Deja lista la matriz vista·proyección de la cámara viva (una vez por búsqueda, no por punto). */
function prepararProyeccion(): THREE.Camera {
	const camara = camaraViva();
	camara.updateMatrixWorld();
	_vp.multiplyMatrices(camara.projectionMatrix, camara.matrixWorldInverse);
	return camara;
}

/**
 * TODOS los cables cuyo recorrido pasa a menos de `tolerancia` píxeles del puntero, el más
 * cercano primero. Devolver la lista entera —y no solo el ganador— es lo que permite desempatar
 * cuando hay varios amontonados bajo el mismo punto de la pantalla.
 */
function cablesSenalados(ev: MouseEvent, tolerancia = TOLERANCIA_PX): CableSenalado[] {
	// Con los cables ocultos no hay cable que señalar: lo que no se ve no se coge.
	if (!escenario.cables.visible) return [];
	const rutas = rutaPrevia
		? rutasVigentes().map((r) => (r.conductorId === rutaPrevia!.conductorId ? rutaPrevia! : r))
		: rutasVigentes();
	if (!rutas.length) return [];
	const px = punteroEnPixeles(ev);
	const camara = prepararProyeccion();
	const g = proyecto.gabinete;
	if (!g) return [];
	const ojo = camara.position;
	const salida: CableSenalado[] = [];
	// Buffer reutilizado: proyectar cincuenta recorridos no puede crear cincuenta mil objetos.
	let sx: Float64Array = new Float64Array(0);
	let sy: Float64Array = new Float64Array(0);
	let sw: Float64Array = new Float64Array(0);
	for (const ruta of rutas) {
		const n = ruta.puntos.length;
		if (n < 2) continue;
		if (sx.length < n) { sx = new Float64Array(n * 2); sy = new Float64Array(n * 2); sw = new Float64Array(n * 2); }
		for (let i = 0; i < n; i++) {
			const q = ruta.puntos[i];
			const p = aPixeles(q.x - g.ancho / 2, g.alto / 2 - q.y, q.z, px.ancho, px.alto);
			sx[i] = p.x; sy[i] = p.y; sw[i] = p.w;
		}
		let mejor = Infinity;
		let seg = 0;
		let t = 0;
		for (let i = 0; i < n - 1; i++) {
			if (sw[i] <= 0 || sw[i + 1] <= 0) continue; // tramo que pasa por detrás de la cámara
			const d = distanciaASegmento(px.x, px.y, sx[i], sy[i], sx[i + 1], sy[i + 1]);
			if (d >= mejor) continue;
			mejor = d;
			seg = i;
			const dx = sx[i + 1] - sx[i], dy = sy[i + 1] - sy[i];
			const l2 = dx * dx + dy * dy;
			t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px.x - sx[i]) * dx + (px.y - sy[i]) * dy) / l2));
		}
		if (mejor > tolerancia) continue;
		const a = ruta.puntos[seg], b = ruta.puntos[seg + 1];
		const punto: P3 = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
		// Radio aparente: cuántos píxeles mide el grosor del cable justo ahí.
		const c0 = aPixeles(punto.x - g.ancho / 2, g.alto / 2 - punto.y, punto.z, px.ancho, px.alto);
		const c1 = aPixeles(punto.x - g.ancho / 2 + ruta.radio, g.alto / 2 - punto.y, punto.z, px.ancho, px.alto);
		const c2 = aPixeles(punto.x - g.ancho / 2, g.alto / 2 - punto.y, punto.z + ruta.radio, px.ancho, px.alto);
		const radio = Math.max(Math.hypot(c1.x - c0.x, c1.y - c0.y), Math.hypot(c2.x - c0.x, c2.y - c0.y));
		salida.push({
			id: ruta.conductorId, punto, avance: seg + t, pixeles: mejor, radio,
			profundidad: ojo.distanceTo(_v.set(punto.x - g.ancho / 2, g.alto / 2 - punto.y, punto.z)),
		});
	}
	/*
	 * VARIOS CABLES BAJO EL MISMO PUNTO. Manda el que esté SOBRE el puntero de verdad (dentro de
	 * su propio grosor) y, entre los que lo estén, el que se vea delante: es el que el usuario
	 * tiene delante de los ojos. Solo cuando ninguno está encima se ordena por cercanía, que es el
	 * caso de «apunté cerca» y ahí lo razonable es el más próximo al cursor.
	 */
	salida.sort((a, b) => {
		const ea = a.pixeles <= a.radio ? 0 : 1;
		const eb = b.pixeles <= b.radio ? 0 : 1;
		if (ea !== eb) return ea - eb;
		if (ea === 0) return a.profundidad - b.profundidad;
		return a.pixeles - b.pixeles;
	});
	return salida;
}

/** El cable señalado por el puntero, con su punto 3D. */
function cableSenalado(ev: MouseEvent, tolerancia = TOLERANCIA_PX): CableSenalado | undefined {
	return cablesSenalados(ev, tolerancia)[0];
}

/** Conductor cuyo recorrido está bajo el puntero (para el resaltado al pasar el ratón). */
function cableBajoElPuntero(ev: MouseEvent): string | undefined {
	return cableSenalado(ev)?.id;
}

/**
 * ¿El cable señalado se lleva el clic, o lo tapa un aparato?
 *
 * Las canaletas, los rieles y la placa NO entran en esta cuenta a propósito: un cable que se ve
 * pasar por delante de una canaleta se tiene que poder coger, y estando dentro de ella también,
 * porque es donde va. Los aparatos sí, porque un cable que pasa POR DETRÁS de un contactor no se
 * está viendo, y el clic es para el contactor.
 */
function cableEstaDelante(ev: MouseEvent, golpe?: CableSenalado): boolean {
	const c = golpe ?? cableSenalado(ev);
	if (!c) return false;
	punteroEnPixeles(ev);
	raycaster.setFromCamera(puntero, camaraViva());
	const dAparato = raycaster.intersectObjects(escenario.dispositivos.children, true)
		.find((i) => i.object.userData.dispositivoId)?.distance ?? Infinity;
	return c.profundidad <= dAparato + 2;
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
		/*
		 * CADA TIRADOR, EXACTAMENTE ENCIMA DE SU PUNTO DEL CABLE.
		 *
		 * Antes se ponían todos a una profundidad fija; ver `puntoDibujado` para por qué eso los
		 * separaba del cable en cuanto la cámara dejaba de estar de frente.
		 */
		const wps = c.trazado ?? [];
		if (wps.length === 0) {
			// Sin puntos todavía: se ofrece uno EN MITAD DEL CABLE, no colgando al aire. Tirando de
			// él se crea la primera unión justo ahí, que es donde el usuario la está viendo.
			const ruta = rutaEnPantalla(c.id);
			const medio = ruta?.puntos.length
				? ruta.puntos[Math.floor(ruta.puntos.length / 2)]
				: { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), z: Z_HANDLE_CABLE };
			esfera(escenario.aEscena(medio.x, medio.y, medio.z), { rol: 'esquina', sel, indice: -1 }, 0x2ea3ff);
		} else {
			for (let i = 0; i < wps.length; i++) {
				const q = puntoDibujado(c, i) ?? { x: wps[i].x, y: wps[i].y, z: Z_HANDLE_CABLE };
				esfera(escenario.aEscena(q.x, q.y, q.z), { rol: 'esquina', sel, indice: i }, 0x2ea3ff);
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

/** Sobre qué plano se está moviendo un punto de cable ahora mismo. */
type ModoArrastre = 'placa' | 'profundidad';

/**
 * EL PUNTO DEL RATÓN EN 3D, SOBRE EL PLANO QUE SE PUEDA USAR DESDE DONDE ESTÁ LA CÁMARA.
 *
 * Aquí estaba la razón de que editar un cable fuese «manejable de frente y no desde el lateral».
 * El arrastre proyectaba SIEMPRE sobre un plano paralelo a la placa, a profundidad fija. Mirando
 * el tablero de frente eso es lo correcto y es cómodo. Pero desde una cámara lateral ese plano se
 * ve de canto: el rayo del ratón lo corta casi en paralelo, así que un pixel de movimiento
 * desplazaba el punto decenas de milímetros, y la profundidad —lo único que se quiere tocar desde
 * el lateral— no se podía cambiar en absoluto, porque el plano la tenía clavada.
 *
 * La regla ahora es una sola y vale para cualquier cámara: se arrastra sobre el plano que MÁS DE
 * FRENTE le quede al ojo.
 *
 *   cámara mirando la placa   →  plano de la placa      →  se mueve en X/Y, la profundidad no se toca
 *   cámara lateral o cenital  →  plano vertical         →  se mueve en profundidad y en un eje
 *
 * Con eso la vista lateral pasa de servir solo para mirar a ser la herramienta natural para decir
 * «este tramo va más adentro», sin gizmos ni modos que aprender: te pones de lado y arrastras.
 * Y para cuando se quiere profundidad sin mover la cámara, la tecla Mayúsculas fuerza el plano
 * vertical desde cualquier vista.
 */
function puntoCable3D(
	ev: MouseEvent, actual: { x: number; y: number; z: number }, forzarProfundidad: boolean,
): { x: number; y: number; z: number; modo: ModoArrastre } | undefined {
	const g = proyecto.gabinete;
	if (!g) return undefined;
	const r = renderer.domElement.getBoundingClientRect();
	puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
	const camara = camaraViva();
	raycaster.setFromCamera(puntero, camara);
	const mira = new THREE.Vector3();
	camara.getWorldDirection(mira);
	// El punto que se está moviendo, en coordenadas de escena: es por donde tiene que pasar el plano.
	const aqui = new THREE.Vector3(actual.x - g.ancho / 2, g.alto / 2 - actual.y, actual.z);
	/*
	 * 0,55 ≈ 57° respecto a la placa. Por encima de eso la cámara todavía mira la placa lo bastante
	 * de frente como para que arrastrar en X/Y sea preciso; por debajo, el plano empieza a verse de
	 * canto y es cuando conviene cambiar. No es un número mágico: es dónde deja de ser cómodo.
	 */
	// La regla vive en `edicion-cables`, para que la prueba mida exactamente lo que hace el editor.
	const n = normalDeArrastre(mira, forzarProfundidad);
	const normal = new THREE.Vector3(n.x, n.y, n.z);
	const deLado = n.z === 0;
	const impacto = new THREE.Vector3();
	if (!raycaster.ray.intersectPlane(new THREE.Plane(normal, -normal.dot(aqui)), impacto)) return undefined;
	return {
		x: impacto.x + g.ancho / 2,
		y: g.alto / 2 - impacto.y,
		z: impacto.z,
		modo: deLado ? 'profundidad' : 'placa',
	};
}

/* --------------------- Puntos de quiebre de los cables (estilo Tinkercad) --------------------- */

/**
 * EL RECORRIDO QUE SE ESTÁ VIENDO AHORA MISMO, sea el del reparto o el de la vista previa.
 *
 * Una sola respuesta a «¿por dónde pasa este cable?». Los tiradores, las uniones nuevas y el
 * puntero preguntan aquí, así que no pueden discrepar entre ellos ni con lo que se ve.
 */
function rutaEnPantalla(conductorId: string): RutaCable | undefined {
	if (rutaPrevia?.conductorId === conductorId) return rutaPrevia;
	return rutaVigente(conductorId);
}

/**
 * DÓNDE ESTÁ DIBUJADO, EN 3D, UN PUNTO DEL PEINADO.
 *
 * Un punto de peinado no es un punto del dibujo: el usuario guarda `x,y` y puede que `z`, y el
 * cable que se ve pasa por ahí redondeando la esquina y, si el punto no trae profundidad, a la
 * altura que le haya tocado. Ésta es la traducción de lo uno a lo otro, y es la que faltaba: sin
 * ella el tirador se ponía a una profundidad FIJA (55 mm) mientras el cable corría a 66, a 95 o
 * metido en una canaleta a 30. De frente la diferencia no se nota; en cuanto la cámara se
 * inclinaba, la bolita se separaba del cable justo lo que dice la perspectiva. Ése era el bug de
 * «los puntos aparecen alejados del cable según el ángulo».
 */
function puntoDibujado(c: Conductor, idx: number): P3 | undefined {
	const wp = c.trazado?.[idx];
	if (!wp) return undefined;
	const ruta = rutaEnPantalla(c.id);
	const en = ruta && proyectarEnPolilinea(ruta.puntos, wp);
	return en ? en.punto : { x: wp.x, y: wp.y, z: wp.z ?? Z_FRENTE };
}

/**
 * La profundidad a la que corre AHORA MISMO ese punto del peinado.
 *
 * En cuanto el usuario arrastra un punto, se le fija la suya: a partir de ese momento la
 * profundidad la pone él y no el repartidor. Congelar la que ya tenía dibujada —y no una por
 * defecto— es lo que hace que el cable no pegue un salto al empezar a moverlo.
 */
function zDibujada(c: Conductor, idx: number): number {
	return Math.round(puntoDibujado(c, idx)?.z ?? Z_FRENTE);
}

/**
 * Longitud del cable (mm) por su recorrido ortogonal real. Es la MISMA cuenta que se le pasa al
 * DRC y al PDF —vive en `escena3d`—: tenerla dos veces era pedir que el total del panel y la
 * caída de tensión del papel acabaran discrepando.
 */
function longitudCableMm(c: Conductor): number {
	return largoDibujadoMm(proyecto, c);
}

/**
 * INSERTA UNA UNIÓN EN LA TRAYECTORIA DE VERDAD.
 *
 * Antes esto recibía un `x,y` sacado de proyectar el clic sobre un plano horizontal a 52 mm y
 * buscaba el tramo más cercano EN PLANTA. Con la cámara inclinada esa proyección cae donde el
 * plano corta el rayo, que no es donde está el cable; con el cable metido en una canaleta a 30 mm
 * de profundidad, el error eran centímetros; y en planta dos tramos que se cruzan están a
 * distancia cero, así que el punto entraba en el tramo equivocado y el cable daba un tirón.
 *
 * Ahora entra un punto que YA está sobre el recorrido —lo da `cablesSenalados`, midiendo en
 * píxeles contra la polilínea dibujada— y su posición a lo largo de él. El punto se guarda con su
 * profundidad, así que la unión nace exactamente donde el usuario la ha visto nacer.
 */
function insertarWaypoint(c: Conductor, p: P3, avance: number): number {
	const wps = c.trazado ? c.trazado.slice() : [];
	const ruta = rutaEnPantalla(c.id);
	const idx = ruta ? indiceDeInsercion(ruta.puntos, wps, avance) : wps.length;
	wps.splice(idx, 0, { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) });
	c.trazado = wps;
	// Los demás puntos del peinado también fijan su profundidad: a partir de ahora este cable lo
	// manda el usuario entero, y el repartidor deja de elegirle capa (ver la regla `literal`).
	fijarProfundidades(c);
	return idx;
}

/**
 * CONGELA LA PROFUNDIDAD DE TODO EL PEINADO EN LA QUE SE ESTÁ VIENDO.
 *
 * En cuanto el usuario toca un cable, ese cable pasa a ser suyo: se le da `z` a todos sus puntos
 * con la que tienen dibujada ahora mismo. Dos motivos, y los dos son de fondo:
 *
 *  · Con todos los puntos en 3D el recorrido es LITERAL —se dibuja tal cual se guarda— y el
 *    repartidor deja de reescribirlo. Medido antes de esto: lo que el usuario colocaba y lo que
 *    se dibujaba llegaban a discrepar 155 mm.
 *  · Congelar lo que se ve, y no una profundidad por defecto, es lo que evita que el cable pegue
 *    un salto en el instante en que se empieza a editarlo.
 */
function fijarProfundidades(c: Conductor): void {
	const wps = c.trazado;
	if (!wps) return;
	for (let i = 0; i < wps.length; i++) {
		if (wps[i].z === undefined) wps[i] = { ...wps[i], z: zDibujada(c, i) };
	}
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

/**
 * Repasa los peinados hechos a mano y saca de encima de los aparatos los puntos que hayan
 * quedado ahí. Se llama al SOLTAR un aparato o un riel: son los movimientos que pueden dejar
 * un cable cruzando por encima de algo sin que nadie haya tocado el cable.
 */
/** Si al mover el aparato han quedado puntos de cable debajo, se dice. No se tocan. */
function avisarSiSeMovioAlgunCable(cuantos: number): void {
	if (!cuantos) return;
	avisar(`${cuantos} punto${cuantos > 1 ? 's' : ''} de cable queda${cuantos > 1 ? 'n' : ''} por encima de un aparato — revísalo`, 'info');
}

/**
 * CUENTA los puntos de peinado que han quedado encima de un aparato. NO los mueve.
 *
 * Antes los apartaba, y era la última puerta por la que el programa reorganizaba a mano lo que
 * había hecho el usuario: bastaba mover un contactor un centímetro para que media docena de
 * puntos de cable, colocados uno a uno, saltaran a otro sitio. Se avisa y se deja; corregirlo es
 * un arrastre, y el usuario sabe cuál.
 */
function contarTrazadosInvadidos(): number {
	const huellas = huellasQueEsquivarLosCables();
	let cuantos = 0;
	for (const c of proyecto.conductores) {
		if (!c.trazado?.length) continue;
		for (const p of c.trazado) {
			const libre = fueraDeLaHuella({ x: p.x, y: p.y }, huellas);
			if (Math.round(libre.x) !== p.x || Math.round(libre.y) !== p.y) cuantos++;
		}
	}
	return cuantos;
}

/*
 * CRONÓMETRO POR ETAPAS DEL ARRASTRE.
 *
 * Diego pidió números antes de optimizar, y con razón: en este proyecto ya ha pasado dos veces que
 * la causa «evidente» era falsa. Esto mide lo que de verdad cuesta cada tramo del camino que va
 * desde que se mueve el ratón hasta que la pantalla enseña el cable en su sitio nuevo.
 *
 * Solo se enciende desde QA; apagado cuesta una comparación por etapa.
 */
const crono = { activo: false, etapas: new Map<string, { n: number; ms: number }>() };

function medirEtapa<T>(etapa: string, fn: () => T): T {
	if (!crono.activo) return fn();
	const t0 = performance.now();
	const r = fn();
	const e = crono.etapas.get(etapa) ?? { n: 0, ms: 0 };
	e.n++; e.ms += performance.now() - t0;
	crono.etapas.set(etapa, e);
	return r;
}

/**
 * VISTA PREVIA DE UN SOLO CABLE MIENTRAS SE ARRASTRA.
 *
 * El editor manual y el ruteo automático son dos problemas distintos aunque compartan geometría.
 * Mientras el usuario tiene el ratón apretado hace falta una cosa: que el cable siga al cursor. Lo
 * demás —encontrarle sitio en las canaletas, reservar carriles, comprobarlo contra los otros
 * cincuenta y uno, pasar el DRC— es trabajo de cuando suelta.
 *
 * Antes no había esa separación y se pagaba entera en cada píxel de movimiento. Medido sobre el
 * estrella-triángulo: 5.215 ms por movimiento del ratón, 50 cables reconstruidos y 50
 * TubeGeometry creadas… para mover UN punto de UN cable, y encima con un reparto completo del
 * router por medio (0,93 por movimiento).
 *
 * Aquí se cambia solo la malla de ese cable. Los otros cincuenta y uno no se tocan: ni se
 * destruyen ni se vuelven a subir a la tarjeta.
 */
/**
 * El recorrido de la vista previa, mientras dura el arrastre.
 *
 * Durante el arrastre el cable que se ve NO es el del último reparto: es éste. Todo lo que
 * pregunte «por dónde pasa este cable» tiene que ver el mismo, o el tirador se quedaría en la
 * posición anterior mientras el tubo ya se ha movido.
 */
let rutaPrevia: RutaCable | undefined;

function previsualizarCable(conductorId: string): void {
	const ruta = rutaProvisional(proyecto, conductorId);
	if (!ruta) return;
	rutaPrevia = ruta;
	const conductor = proyecto.conductores.find((c) => c.id === conductorId);
	if (!conductor) return;
	// Fuera la malla vieja de ESTE cable, y solo la suya.
	for (const hijo of [...escenario.cables.children]) {
		let suyo = false;
		hijo.traverse((o) => { if (o.userData.conductorId === conductorId) suyo = true; });
		if (!suyo) continue;
		escenario.cables.remove(hijo);
		liberar(hijo);
	}
	/*
	 * Un recorrido que no vale se ve ROJO, y se sigue pudiendo mover. Es la diferencia entre un
	 * programa que informa y uno que forcejea: el cable dice «aquí no», pero no te quita el ratón.
	 */
	const color = motivoInvalido ? 0xd2453c : colorDeCable(conductor.color);
	escenario.cables.add(construirUnCable(ruta, color, escenario.aEscena));
	if (!motivoInvalido && sel?.tipo === 'cable' && sel.id === conductorId) resaltarCable(conductorId);
}

/*
 * BLOQUEO DE EJE: «a partir de ahora solo profundidad».
 *
 * Mover un punto en 3D con un ratón que solo sabe de dos ejes es el problema de siempre, y el
 * truco de elegir el plano según dónde esté la cámara lo resuelve a medias: sirve para trabajar
 * cómodo, pero no para decir «esto y solo esto». Cambiar la profundidad sin tocar la X de rebote
 * era prácticamente imposible.
 *
 * Se elige la solución más simple que existe y la que ya conoce cualquiera que haya usado un
 * programa 3D: durante el arrastre se pulsa X, Y o Z y el movimiento se queda en ese eje. Volver a
 * pulsar la misma tecla lo suelta. No hay gizmo que estorbe, no hay modo que recordar, no hay que
 * apuntar a un tirador de tres píxeles, y funciona igual desde cualquier cámara.
 *
 * EL BLOQUEO ES DE VERDAD, no una aproximación: al pulsar la tecla se apunta dónde estaba el punto
 * y los dos ejes que no se editan se devuelven a ese valor DESPUÉS de todo lo demás —del recorte
 * al área, del alineado con los vecinos y del encaje en la canaleta—. Cualquiera de esos tres
 * podría mover una coordenada que el usuario acaba de decir que no se toca.
 */
let ejeArrastre: Bloqueo | undefined;
let guiaEje: THREE.Line | undefined;

/** La línea del eje bloqueado, discreta y solo mientras dura el arrastre. */
function mostrarGuiaEje(punto: { x: number; y: number; z: number }, eje: Eje): void {
	quitarGuiaEje();
	const LARGO = 160;
	const d = eje === 'x' ? [LARGO, 0, 0] : eje === 'y' ? [0, LARGO, 0] : [0, 0, LARGO];
	const c = escenario.aEscena(punto.x, punto.y, punto.z);
	const geo = new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(c.x - d[0], c.y + d[1], c.z - d[2]),
		new THREE.Vector3(c.x + d[0], c.y - d[1], c.z + d[2]),
	]);
	// Los colores de eje de toda la vida: X rojo, Y verde, Z azul. Apagados, que esto es una guía
	// de trabajo y no un adorno.
	const color = eje === 'x' ? 0xd06a63 : eje === 'y' ? 0x6fb06a : 0x5b8fd0;
	guiaEje = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75, depthTest: false }));
	guiaEje.renderOrder = 999;
	guiaEje.raycast = () => {};
	escena.add(guiaEje);
}

function quitarGuiaEje(): void {
	if (!guiaEje) return;
	escena.remove(guiaEje);
	guiaEje.geometry.dispose();
	(guiaEje.material as THREE.Material).dispose();
	guiaEje = undefined;
}

/**
 * ¿ESTE PUNTO ES UN SITIO VÁLIDO PARA UN CABLE?
 *
 * Contesta con el MISMO criterio que usa el ruteo automático, que es el punto entero de esta
 * función: una canaleta no es un obstáculo, es un sitio. Lo que no se puede atravesar de una
 * canaleta son sus SÓLIDOS —el fondo, el zócalo, las paredes, los dientes y la tapa— y de eso ya
 * sabe `invasionSolida`, que es la que usa el repartidor. Aquí no se construye un segundo detector
 * simplificado: se pregunta al que ya existe.
 *
 * Lo que sí es obstáculo es la cara de un aparato: en un tablero de verdad un hilo no cruza por
 * encima de un automático, lo rodea.
 */
function validezDelPunto(p: { x: number; y: number; z?: number }, radio: number): { ok: boolean; motivo?: string } {
	const g = proyecto.gabinete;
	if (!g) return { ok: true };
	const z = p.z ?? Z_FRENTE;
	const red = new RedCanaletas(g.canaletas);
	const dentroDeDucto = canaletasQueContienen(red, [{ x: p.x, y: p.y, z }]);
	const inv = invasionSolida(red, g.canaletas, { x: p.x, y: p.y, z }, radio);
	if (inv) return { ok: false, motivo: `atraviesa ${inv.parte} de la canaleta ${inv.canaleta}` };
	// Dentro del hueco de una canaleta se está bien aunque haya un aparato cerca: son cosas
	// distintas y el cable va por debajo de su cara.
	if (dentroDeDucto.size) return { ok: true };
	for (const c of g.colocaciones) {
		const d = proyecto.dispositivos.find((k) => k.id === c.dispositivoId);
		if (d?.imagen) continue;   // las imágenes de referencia son para cablear encima
		if (p.x > c.x - 2 && p.x < c.x + c.ancho + 2 && p.y > c.y - 2 && p.y < c.y + c.alto + 2) {
			return { ok: false, motivo: `cruza por encima de ${d?.designacion ?? c.dispositivoId}` };
		}
	}
	return { ok: true };
}

/** Si la posición de ahora mismo tiene un problema, cuál: se pinta el cable en rojo y se cuenta. */
let motivoInvalido: string | undefined;

/**
 * MOVER UNA UNIÓN, UNA SOLA VEZ ESCRITO.
 *
 * Hay dos formas de coger un punto de cable —por el tubo o por su esfera azul— y durante mucho
 * tiempo cada una tuvo su código. La del tubo se fue quedando con lo bueno (3D, bloqueo de eje,
 * vista previa barata) y la de la esfera se quedó como estaba: dos dimensiones y reconstrucción
 * completa del tablero en cada píxel. Y la esfera es justo por donde agarra la gente, porque es lo
 * que se ve y lo que invita a tirar.
 *
 * Ahora las dos llaman aquí. Si mañana cambia la regla del plano de arrastre o la del bloqueo,
 * cambia en un sitio y las dos formas de agarrar siguen haciendo lo mismo.
 */
function arrastrarUnion(
	ev: MouseEvent, c: Conductor, indice: number, desde: { x: number; y: number; z: number },
): void {
	// Con Z bloqueada se fuerza el plano vertical aunque la cámara mire de frente: en el plano de
	// la placa la profundidad no cambia por definición, y parecería que la tecla no funciona.
	const enZ = ejeArrastre?.eje === 'z';
	const pc = medirEtapa('1 pantalla→mundo', () => puntoCable3D(ev, desde, ev.shiftKey || enZ));
	if (!pc) return;
	// Con X o Y bloqueadas la profundidad no se toca; el resto del tiempo, solo cambia cuando se
	// está arrastrando sobre el plano vertical, que es cuando el usuario la está pidiendo.
	const zNueva = ejeArrastre && ejeArrastre.eje !== 'z' ? undefined
		: (pc.modo === 'profundidad' ? pc.z : undefined);
	// Alt suelta las ayudas: colocación literal, sin alinear con el vecino ni encajar en canaleta.
	medirEtapa('2 mover punto', () => moverWaypoint(c, indice, pc.x, pc.y, zNueva, ejeArrastre, !ev.altKey));
	medirEtapa('2b validez', () => {
		const wp = c.trazado?.[indice];
		if (!wp) return;
		const v = validezDelPunto(wp, radioDeCable(c.seccion));
		motivoInvalido = v.ok ? undefined : v.motivo;
	});
	medirEtapa('3 previsualizar el cable', () => previsualizarCable(c.id));
	medirEtapa('4 handles', () => construirHandles());
	medirEtapa('5 pista', () => mostrarPistaArrastre());
}

/** Lo último que se supo del punto que se está arrastrando: para poder contarlo en pantalla. */
let pistaArrastre: {
	z: number; modo: ModoArrastre; canaleta?: string; ranura?: boolean; eje?: Eje;
	/** Verdadero cuando una ayuda ha alineado el punto con su vecino: se dice, no se hace en silencio. */
	alineado?: boolean;
} | undefined;

/**
 * Lo que se está haciendo con el punto, dicho en la barra que ya existe.
 *
 * Técnico y de paso: la profundidad en milímetros, y si el punto se ha enganchado a una canaleta,
 * cuál. Nada de widgets flotantes ni indicadores de videojuego —esto es una barra de estado de
 * herramienta— y solo mientras dura el arrastre, porque después no aporta nada.
 */
function mostrarPistaArrastre(): void {
	if (!pistaArrastre) return;
	const dentro = pistaArrastre.canaleta
		? ` · dentro de la canaleta ${pistaArrastre.canaleta}${pistaArrastre.ranura ? ' (por una ranura)' : ''}`
		: '';
	const como = pistaArrastre.eje
		? `SOLO EJE ${pistaArrastre.eje.toUpperCase()}`
		: (pistaArrastre.modo === 'profundidad' ? 'moviendo en PROFUNDIDAD' : 'moviendo sobre la placa');
	const suelta = pistaArrastre.eje ? ' · pulsa la misma tecla para soltar el eje' : ' · X/Y/Z bloquean un eje';
	const aviso = motivoInvalido ? ` · ⚠ ${motivoInvalido}` : '';
	// Una ayuda que mueve el punto se DICE. Lo que no se puede es corregir en silencio.
	const ayuda = pistaArrastre.alineado ? ' · alineado con el vecino (Alt lo desactiva)' : '';
	$('ayuda').textContent = `↕ ${como} · Z: ${pistaArrastre.z} mm${dentro}${ayuda}${aviso}${suelta}`;
}

/**
 * MUEVE UN PUNTO DEL PEINADO. EL PUNTO VA DONDE EL USUARIO LO PONE.
 *
 * Esta función es el sitio donde el programa dejó de estar de acuerdo con quien lo usaba, y por
 * eso su regla ahora está escrita entera:
 *
 *   1. Lo ÚNICO que se impone es el área de cableado, porque fuera de la placa y de la línea de
 *      prensaestopas no hay tablero donde poner un cable. No es una opinión sobre el trazado: es
 *      el borde del mundo.
 *   2. Las ayudas —alinearse con el punto vecino, encajar en el volumen libre de una canaleta—
 *      son AYUDAS: mueven poco, se ven en la barra de estado mientras pasan, y con Alt no pasan.
 *   3. Lo que estorbe —un aparato, otro cable, una pared— se AVISA en rojo y no se toca la
 *      posición. Antes se expulsaba el punto fuera del bloque entero de aparatos: eso es lo que
 *      se sentía como una pared invisible, y era además lo que hacía casi imposible meter un
 *      cable en una canaleta encajada entre dos filas de riel.
 *   4. Un punto movido a mano sale de aquí SIEMPRE con su profundidad. Mientras un punto no
 *      tenía `z` el repartidor le elegía capa por su cuenta, y eso reescribía el recorrido que
 *      el usuario acababa de dibujar —medido: hasta 155 mm entre lo colocado y lo dibujado—.
 *   5. Un eje bloqueado es exacto: `respetarBloqueo` se aplica al final, después de todo lo
 *      demás, para que ninguna ayuda pueda deshacerlo.
 */
function moverWaypoint(
	c: Conductor, idx: number, x: number, y: number, z?: number, bloqueo?: Bloqueo, asistir = true,
): void {
	const wps = c.trazado;
	if (!wps || !wps[idx]) return;
	// Tocar un cable lo hace tuyo: TODOS sus puntos fijan la profundidad que tienen dibujada, y a
	// partir de ahí el repartidor deja de elegirle capa. Va aquí y no en quien llama para que la
	// regla no dependa de por dónde se haya entrado a mover el punto.
	fijarProfundidades(c);
	const p = salidasDeCable(proyecto, c);
	const prev = idx > 0 ? wps[idx - 1] : p?.salidaA;
	const next = idx < wps.length - 1 ? wps[idx + 1] : p?.salidaB;

	// (1) El borde del mundo, y nada más.
	const dentro = dentroDelArea({ x, y }, areaDeCableado());
	let nx = Math.round(dentro.x);
	let ny = Math.round(dentro.y);

	// (2) Ayuda: alinear en vertical/horizontal con el vecino más cercano en cada eje.
	let alineado = false;
	if (asistir) {
		if (prev && Math.abs(nx - prev.x) < SNAP_ORTO) { nx = prev.x; alineado = true; }
		else if (next && Math.abs(nx - next.x) < SNAP_ORTO) { nx = next.x; alineado = true; }
		if (prev && Math.abs(ny - prev.y) < SNAP_ORTO) { ny = prev.y; alineado = true; }
		else if (next && Math.abs(ny - next.y) < SNAP_ORTO) { ny = next.y; alineado = true; }
	}

	// (4) La profundidad: la nueva si el arrastre la trae, y si no la que el punto ya tenía o la
	// que se le ve dibujada. De aquí no sale nunca un punto sin `z`.
	const zPedida = z ?? wps[idx].z ?? zDibujada(c, idx);

	/*
	 * (2 bis) Ayuda: ENCAJE EN LA CANALETA, para que estar dentro signifique estar dentro.
	 *
	 * No se esconde el cable ni se le pinta de otro color cuando pasa por un ducto: se le mete en
	 * el volumen que queda entre las dos paredes y por debajo de la tapa, descontando su propio
	 * radio. Así, al quitar la tapa el cable está ahí, y al ponerla queda tapado porque lo tapa la
	 * tapa, no porque nadie lo haya ocultado.
	 */
	const radio = radioDeCable(c.seccion);
	const encaje = asistir
		? encajarEnCanaleta(new RedCanaletas(proyecto.gabinete?.canaletas ?? []), { x: nx, y: ny, z: zPedida }, radio)
		: undefined;
	if (encaje) {
		wps[idx] = respetarBloqueo({
			x: Math.round(encaje.punto.x),
			y: Math.round(encaje.punto.y),
			z: Math.round(encaje.punto.z),
		}, bloqueo) as { x: number; y: number; z: number };
		pistaArrastre = {
			z: wps[idx].z!, modo: z === undefined ? 'placa' : 'profundidad', canaleta: encaje.canaleta,
			ranura: encaje.ranura !== undefined, eje: bloqueo?.eje, alineado,
		};
		return;
	}
	// Fuera de toda canaleta: la profundidad se queda entre la placa y el frente del mazo, sin
	// atravesar la placa por detrás ni salir volando por delante.
	const zSana = Math.max(radio, Math.min(Z_FRENTE + 24, zPedida));
	wps[idx] = respetarBloqueo({ x: nx, y: ny, z: Math.round(zSana) }, bloqueo) as { x: number; y: number; z: number };
	pistaArrastre = { z: wps[idx].z!, modo: z === undefined ? 'placa' : 'profundidad', eje: bloqueo?.eje, alineado };
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
		// Lo que está montado en OTRA superficie no estorba: un piloto de puerta y un contactor de
		// placa pueden estar en las mismas coordenadas porque los separa el fondo del armario.
		if ((c.montaje ?? 'placa') !== 'placa') continue;
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

/** Radio de agarre de un tirador, en píxeles. Se ve pequeño y se coge cómodo: son dos cosas distintas. */
const AGARRE_HANDLE_PX = 16;

/**
 * Tirador bajo el puntero (tiene prioridad sobre cualquier otra cosa).
 *
 * También en píxeles, y por el mismo motivo que los cables: una bolita de 9 mm de radio vista de
 * lejos son dos píxeles, y para acertarle hacía falta puntería. Se sigue dibujando igual de
 * pequeña —no se toca el aspecto— pero la zona sensible es siempre la misma en pantalla.
 */
function handleBajoElPuntero(ev: MouseEvent): DatosHandle | undefined {
	if (escenario.handles.children.length === 0) return undefined;
	const px = punteroEnPixeles(ev);
	prepararProyeccion();
	let mejor: { datos: DatosHandle; d: number } | undefined;
	for (const o of escenario.handles.children) {
		// Los marcadores/etiquetas de extremo no tienen `handle`; se ignoran para no bloquear el tirador.
		const datos = o.userData.handle as DatosHandle | undefined;
		if (!datos) continue;
		const c = aPixeles(o.position.x, o.position.y, o.position.z, px.ancho, px.alto);
		if (c.w <= 0) continue;
		const d = Math.hypot(c.x - px.x, c.y - px.y);
		if (d > AGARRE_HANDLE_PX) continue;
		if (!mejor || d < mejor.d) mejor = { datos, d };
	}
	return mejor?.datos;
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
	/*
	 * EN EL FRONTAL SE TRABAJA SOBRE LA PUERTA, y nada más. Aquí no se cablea, no se mueven
	 * canaletas y no se pincha un aparato del interior por accidente a través de la chapa: el clic
	 * es para lo que hay montado en la hoja, y si no hay nada, para deseleccionar.
	 */
	if (espacio === 'frontal' && ev.button === 0) {
		const pieza = piezaFrontalBajoElPuntero(ev);
		if (!pieza) {
			if (!ev.shiftKey) { frontalExtra = []; aplicarSeleccion(undefined); pintarListaFrontal(); }
			return;
		}
		if (ev.shiftKey) { alternarFrontalExtra(pieza.clase, pieza.id); return; }
		if (!frontalMarcado(pieza.clase, pieza.id)) seleccionarFrontal(pieza.clase, pieza.id);
		const p = puntoEnLaPuerta(ev);
		if (!p) return;
		// Se agarran TODAS las marcadas, cada una con su desfase: mover un grupo alineado no puede
		// desalinearlo.
		arrastreFrontal = {
			pieza, dx: pieza.x - p.x, dy: pieza.y - p.y, movido: false,
			acompanan: seleccionFrontal()
				.filter((q) => !(q.clase === pieza.clase && q.id === pieza.id))
				.map((q) => ({ clase: q.clase, id: q.id, dx: q.x - pieza.x, dy: q.y - pieza.y })),
		};
		arrastrando = true;
		permitirOrbita(false);
		renderer.domElement.style.cursor = 'grabbing';
		return;
	}
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
		const golpe = cableSenalado(ev);
		const cid = golpe?.id;
		if (golpe && cid && (elem?.tipo !== 'dispositivo' || cableEstaDelante(ev, golpe))) {
			if (!(sel?.tipo === 'cable' && sel.id === cid)) aplicarSeleccion({ tipo: 'cable', id: cid });
			const c = proyecto.conductores.find((x) => x.id === cid);
			const p = golpe.punto;
			if (c) {
				/*
				 * Se mide en 3D contra el punto tal como está DIBUJADO, no contra sus coordenadas
				 * guardadas: una unión metida en una canaleta está a 30 mm de profundidad y el clic
				 * aterriza ahí, no en el plano del frente. Midiéndolo en planta, como antes,
				 * agarrar una unión hundida era cuestión de suerte.
				 */
				const idx = (c.trazado ?? []).findIndex((w, i) => {
					const q = puntoDibujado(c, i) ?? { x: w.x, y: w.y, z: Z_FRENTE };
					return Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) < 26;
				});
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
	if (crono.activo) { const e = crono.etapas.get('0 pointermove') ?? { n: 0, ms: 0 }; e.n++; crono.etapas.set('0 pointermove', e); }
	if (visualizacion) return;
	if (espacio === 'frontal') { moverArrastreFrontal(ev); return; }
	// Aparato recién sacado del catálogo: va pegado al ratón hasta que un clic lo suelta.
	if (colocando) { moverColocacionAlCursor(ev); return; }
	// Resaltado al pasar el ratón (modo Trabajo): bornes (para cablear) y cables (para tocarlos).
	if (!arrastrando) {
		if (modo === 'trabajo') {
			const b = medirEtapa('h1 borne bajo puntero', () => borneBajoElPuntero(ev));
			medirEtapa('h2 resaltar borne', () => { resaltarHoverBorne(b); mostrarTipBorne(b, ev); });
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
			const cid = medirEtapa('h3 cable bajo puntero', () => (b ? undefined : cableBajoElPuntero(ev)));
			medirEtapa('h4 resaltar cable', () => resaltarHoverCable(cid));
			const bajo = medirEtapa('h5 elemento bajo puntero', () => (b || cid || cableandoDesde ? undefined : elementoBajoElPuntero(ev)));
			medirEtapa('h6 resaltar aparato', () => resaltarHoverDispositivo(bajo?.tipo === 'dispositivo' ? bajo.id : undefined));
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
			motivoInvalido = undefined;
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
		const c = proyecto.conductores.find((x) => x.id === arrastrandoCable!.id);
		const wp = c?.trazado?.[arrastrandoCable.indice];
		if (c && wp) {
			/*
			 * De dónde sale la profundidad de partida: la del propio punto si ya la tiene, y si no
			 * la del frente, que es donde estaba dibujado hasta ahora. Así el primer arrastre en
			 * profundidad empieza justo donde el usuario ve el cable, y no pega un salto.
			 */
			const desde = { x: wp.x, y: wp.y, z: wp.z ?? Z_FRENTE };
			/*
			 * Con Z bloqueada hay que forzar el plano vertical aunque la cámara mire de frente: en
			 * el plano de la placa la profundidad no cambia por definición, así que sin esto pulsar
			 * Z de frente no haría nada y parecería que la tecla no funciona.
			 */
			arrastrarUnion(ev, c, arrastrandoCable.indice, desde);
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
				/*
				 * El tirador de un cable sin peinado está EN MITAD DEL CABLE. Tirando de él nace ahí
				 * la primera unión —donde el usuario la está viendo nacer, con su profundidad— y
				 * desde ese mismo movimiento ya sigue al cursor como cualquier otra.
				 */
				const ruta = rutaEnPantalla(c.id);
				if (!ruta?.puntos.length) return;
				const medio = Math.floor(ruta.puntos.length / 2);
				const i = insertarWaypoint(c, ruta.puntos[medio], medio);
				handleArrastrado.indice = i;
				arrastrarUnion(ev, c, i, { ...ruta.puntos[medio] });
			} else {
				const wp = c.trazado?.[handleArrastrado.indice];
				if (wp) arrastrarUnion(ev, c, handleArrastrado.indice, { x: wp.x, y: wp.y, z: wp.z ?? Z_FRENTE });
			}
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
	if (arrastreFrontal) { soltarArrastreFrontal(); return; }
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
	// Se apunta ANTES de limpiar, o se apunta `undefined` y no se entera nadie.
	const handleAntes: DatosHandle | undefined = handleArrastrado;
	const selAntes: Seleccion | undefined = sel;
	handleArrastrado = undefined;
	const eraCable = arrastrandoCable;
	arrastrandoCable = undefined;
	pendienteCable = undefined; // si no llegó a moverse, fue solo un clic de selección
	// La barra vuelve a lo suyo: la profundidad solo interesa mientras se está moviendo el punto.
	if (pistaArrastre) { pistaArrastre = undefined; $('ayuda').textContent = AYUDA[modo]; }
	ejeArrastre = undefined;
	quitarGuiaEje();
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
		avisarSiSeMovioAlgunCable(contarTrazadosInvadidos());
		actualizarTodo();
		pintarEstructura();
		return;
	}
	/*
	 * Soltar un tirador de cable es exactamente lo mismo que soltar el tubo, así que pasa por el
	 * mismo sitio. Antes no: el tirador no revertía nada y no explicaba nada.
	 */
	const eraHandleDeCable = handleAntes && selAntes?.tipo === 'cable' && (handleAntes.indice ?? -1) >= 0
		? { id: selAntes.id, indice: handleAntes.indice! }
		: undefined;
	const cableSoltado = eraCable ?? eraHandleDeCable;
	if (cableSoltado) {
		/*
		 * EL PUNTO SE QUEDA DONDE SE HA SOLTADO. Si el sitio tiene un problema, se DICE.
		 *
		 * Aquí había una vuelta automática al último sitio válido. Sonaba prudente y en la mano es
		 * lo contrario: uno coloca un punto donde lo quiere, suelta, y el programa lo manda a otro
		 * lado por su cuenta. En un tablero de verdad un cable puede rozar, cruzar, ir apretado o
		 * pasar por donde el instalador decide que pase; quien juzga eso es el instalador, no el
		 * editor. Lo que sí hace el editor es no callarse: el aviso queda en la barra y el problema
		 * sale en la revisión, para poder corregirlo sabiendo qué pasa.
		 */
		if (motivoInvalido) {
			avisar(`Revisa ese punto: ${motivoInvalido}. Se queda donde lo has dejado.`, 'error');
		}
		motivoInvalido = undefined;
		/*
		 * AQUÍ ES DONDE SE PAGA LO CARO, y solo aquí.
		 *
		 * Durante el arrastre se ha ido dibujando una vista previa de ESTE cable y nada más. Al
		 * soltar se hace el trabajo de verdad: el repartidor vuelve a buscar sitio para todos, con
		 * su comprobación contra los demás conductores, contra los aparatos y contra las canaletas.
		 * Una vez, no trescientas.
		 */
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
	avisarSiSeMovioAlgunCable(contarTrazadosInvadidos());

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
	const golpe = cableSenalado(ev);
	const c = golpe ? proyecto.conductores.find((x) => x.id === golpe.id) : undefined;
	if (!c || !golpe) return false;
	if (!(sel?.tipo === 'cable' && sel.id === golpe.id)) aplicarSeleccion({ tipo: 'cable', id: c.id });
	if (!capturar()) return false;
	insertarWaypoint(c, golpe.punto, golpe.avance);
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
	 * LOS ATAJOS DEL FRONTAL. Van antes que los del interior porque en el frontal las mismas teclas
	 * significan otra cosa —Supr quita un piloto de la puerta, no un aparato del carril— y porque
	 * el espacio activo es lo que dice qué se está tocando.
	 */
	if (espacio === 'frontal' && !activo?.match(/INPUT|TEXTAREA|SELECT/)) {
		if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); borrarFrontal(); return; }
		if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') { ev.preventDefault(); duplicarFrontal(); return; }
		if (ev.key === 'Escape') { frontalExtra = []; aplicarSeleccion(undefined); pintarListaFrontal(); return; }
		/*
		 * Y LAS FLECHAS, que es como se coloca al milímetro sin pelearse con el ratón: una pulsación
		 * mueve un milímetro y con Mayúsculas diez. Ninguna ayuda toca esto —el usuario está
		 * diciendo exactamente cuánto— más allá del borde de la hoja.
		 */
		const flechas: Record<string, [number, number]> = {
			ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
		};
		const paso = flechas[ev.key];
		if (paso) {
			const piezas = seleccionFrontal();
			if (!piezas.length) return;
			ev.preventDefault();
			if (!capturar()) return;
			const cuanto = ev.shiftKey ? 10 : 1;
			const hoja = hojaDeLaPuerta();
			for (const q of piezas) {
				const sitio = dentroDeLaHoja({ x: q.x + paso[0] * cuanto, y: q.y + paso[1] * cuanto }, q, hoja);
				moverPiezaFrontal(q.clase, q.id, sitio.x, sitio.y);
			}
			pintarListaFrontal();
			pintarSeleccion();
			marcarSucio();
			return;
		}
	}
	/*
	 * X / Y / Z BLOQUEAN UN EJE MIENTRAS SE ARRASTRA UNA UNIÓN.
	 *
	 * Va lo primero, y solo con el ratón apretado sobre un punto de cable: fuera del arrastre estas
	 * teclas no significan nada aquí y no se le quitan a nadie. La misma tecla otra vez suelta el
	 * eje, que es como se comporta en cualquier programa 3D y es lo que la mano espera.
	 */
	// Vale igual si se agarró por el tubo o por la esfera azul: para la mano es el mismo gesto.
	const unionEnMano = arrastrandoCable
		? { id: arrastrandoCable.id, indice: arrastrandoCable.indice }
		: (handleArrastrado && sel?.tipo === 'cable' && (handleArrastrado.indice ?? -1) >= 0
			? { id: sel.id, indice: handleArrastrado.indice! }
			: undefined);
	if (unionEnMano && !activo?.match(/INPUT|TEXTAREA|SELECT/) && !ev.ctrlKey && !ev.metaKey) {
		const tecla = ev.key.toLowerCase();
		if (tecla === 'x' || tecla === 'y' || tecla === 'z') {
			ev.preventDefault();
			const c = proyecto.conductores.find((k) => k.id === unionEnMano.id);
			const wp = c?.trazado?.[unionEnMano.indice];
			if (!wp) return;
			if (ejeArrastre?.eje === tecla) {
				ejeArrastre = undefined;
				quitarGuiaEje();
			} else {
				// Se apunta dónde está el punto AHORA: es a esos valores a los que vuelven los ejes
				// que no se editan, movimiento tras movimiento.
				ejeArrastre = { eje: tecla, ancla: { x: wp.x, y: wp.y, z: wp.z } };
				mostrarGuiaEje({ x: wp.x, y: wp.y, z: wp.z ?? Z_FRENTE }, tecla);
			}
			pistaArrastre = { z: wp.z ?? Z_FRENTE, modo: ejeArrastre ? 'profundidad' : 'placa', eje: ejeArrastre?.eje };
			mostrarPistaArrastre();
			return;
		}
	}
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
	// Los bornes son del interior: en el frontal no se cablea, así que no se enseñan aunque el
	// modo de dentro siga siendo Trabajo.
	escenario.bornes.visible = modo === 'trabajo' && espacio !== 'frontal';
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
($('ver-etiquetas') as HTMLInputElement).onchange = () => refrescarEtiquetas();
/* ------------------- Los mandos del frontal y de los espacios ------------------- */

$('esp-interior').onclick = () => aplicarEspacio('interior');
$('esp-frontal').onclick = () => aplicarEspacio('frontal');
$('esp-conjunto').onclick = () => aplicarEspacio('conjunto');

$('btn-add-piloto').onclick = () => anadirPilotoFrontal();
$('btn-add-rotulo').onclick = () => anadirRotuloFrontal('grabado');
$('btn-add-placa').onclick = () => anadirRotuloFrontal('placa');
$('btn-add-aviso').onclick = () => anadirRotuloFrontal('aviso');
$('btn-dup-frontal').onclick = () => duplicarFrontal();
$('btn-borrar-frontal').onclick = () => borrarFrontal();

for (const [id, como, que] of [
	['btn-al-izq', 'izquierda', 'Alineado a la izquierda'],
	['btn-al-cx', 'centroX', 'Centrado en vertical'],
	['btn-al-der', 'derecha', 'Alineado a la derecha'],
	['btn-al-arr', 'arriba', 'Alineado arriba'],
	['btn-al-cy', 'centroY', 'Centrado en horizontal'],
	['btn-al-aba', 'abajo', 'Alineado abajo'],
] as const) {
	$(id).onclick = () => aplicarCambiosFrontal(alinearFrontal(seleccionFrontal(), como as AlineacionFrontal), que);
}
$('btn-rep-h').onclick = () => aplicarCambiosFrontal(repartirFrontal(seleccionFrontal(), 'x'), 'Ejes repartidos en horizontal');
$('btn-rep-v').onclick = () => aplicarCambiosFrontal(repartirFrontal(seleccionFrontal(), 'y'), 'Ejes repartidos en vertical');
$('btn-hue-h').onclick = () => aplicarCambiosFrontal(repartirFrontal(seleccionFrontal(), 'x', 'huecos'), 'Huecos igualados en horizontal');
$('btn-hue-v').onclick = () => aplicarCambiosFrontal(repartirFrontal(seleccionFrontal(), 'y', 'huecos'), 'Huecos igualados en vertical');

($('frontal-rejilla') as HTMLInputElement).onchange = () => refrescarRejillaFrontal();
($('frontal-paso') as HTMLInputElement).onchange = () => refrescarRejillaFrontal();

($('ver-gabinete') as HTMLInputElement).onchange = (e) => {
	escenario.envolvente.visible = (e.target as HTMLInputElement).checked;
	refrescarEtiquetas();
};
($('btn-puerta') as HTMLButtonElement).onclick = () => moverPuerta(puertaDestino < 0.5);

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
		// Todos los aparatos, monten donde monten: un piloto de puerta se enciende con el mismo
		// bucle y por el mismo motivo que uno de placa.
		grupos: escenario.aparatos,
		proyecto,
		resultado: panelSim.resultado(),
		estado: panelSim.estadoDeLosMandos(),
		energizado: panelSim.energizado(),
		dt,
		reloj: ahora / 1000,
		cables: escenario.cables,
	});
	animarPuerta(dt);
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
		/*
		 * MEDIR EL MOTEADO, en vez de discutir si «parpadea un poco».
		 *
		 * Se mueve la cámara MUY poco entre toma y toma —décimas de grado— y se compara cada
		 * fotograma con el anterior. Con un giro así de pequeño una escena sana casi no cambia:
		 * los bordes se desplazan un pixel y ya. Lo que delata un artefacto es un píxel que salta
		 * de claro a oscuro (o al revés) EN MEDIO DE UNA ZONA LISA, porque eso no lo puede hacer la
		 * geometría moviéndose: solo lo hace una superficie que gana y pierde una comparación de
		 * profundidad, o una sombra que se muestrea a sí misma.
		 *
		 * Por eso no basta con contar píxeles que cambian: hay que exigir que el entorno del píxel
		 * fuera liso en el fotograma de partida. Sin esa condición, el contorno de cada tornillo
		 * cuenta como parpadeo y todas las configuraciones salen igual de mal.
		 */
		medirMoteado: (camaras: { x: number; y: number; z: number; tx: number; ty: number; tz: number }[], salto = 70, llano = 18) => {
			const c = renderer.domElement;
			const w = Math.floor(c.width / 2), h = Math.floor(c.height / 2);
			const lienzo2 = document.createElement('canvas');
			lienzo2.width = w; lienzo2.height = h;
			const ctx = lienzo2.getContext('2d', { willReadFrequently: true })!;
			const luces: Float32Array[] = [];
			for (const cam of camaras) {
				(window as unknown as { qa: { verDesde: (v: unknown) => void } }).qa.verDesde(cam);
				pintar();
				ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, w, h);
				const d = ctx.getImageData(0, 0, w, h).data;
				const L = new Float32Array(w * h);
				for (let i = 0; i < w * h; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
				luces.push(L);
			}
			const pares: number[] = [];
			const focos: [number, number][] = [];
			for (let k = 1; k < luces.length; k++) {
				const A = luces[k - 1], B = luces[k];
				let n = 0;
				for (let y = 1; y < h - 1; y++) {
					for (let x = 1; x < w - 1; x++) {
						const i = y * w + x;
						if (Math.abs(B[i] - A[i]) < salto) continue;
						// ¿Era una zona lisa antes de moverse? Si no, es un borde, no un artefacto.
						const v = A[i];
						if (Math.abs(A[i - 1] - v) > llano || Math.abs(A[i + 1] - v) > llano) continue;
						if (Math.abs(A[i - w] - v) > llano || Math.abs(A[i + w] - v) > llano) continue;
						n++;
						if (focos.length < 400 && n % 7 === 0) focos.push([x, y]);
					}
				}
				pares.push(n);
			}
			const total = pares.reduce((a, b) => a + b, 0);
			return {
				pares, total, porMillon: Math.round((total / (pares.length * w * h)) * 1e6), pixeles: w * h,
				// DÓNDE parpadea, en coordenadas de pantalla. Contar cuántos píxeles saltan dice que
				// hay un problema; saber en qué píxeles saltan permite preguntarle al rayo qué hay
				// ahí, que es lo único que acaba nombrando al culpable.
				donde: focos.slice(0, 40).map(([x, y]) => ({ x: x * 2, y: y * 2 })),
			};
		},
		/*
		 * INTERRUPTORES PARA AISLAR UN PARPADEO.
		 *
		 * Un moteado negro/blanco que cambia al mover la cámara puede venir de dos sitios muy
		 * distintos: dos superficies peleándose por la misma profundidad (z-fighting) o el mapa de
		 * sombras muestreándose a sí mismo (shadow acne). A ojo se parecen. Apagando una cosa cada
		 * vez y volviendo a medir, se distinguen sin discutir.
		 */
		sombras: (on: boolean) => {
			renderer.shadowMap.enabled = on;
			// Los materiales ya compilados llevan dentro si había sombras o no: sin esto, apagarlas
			// no cambia nada de lo que ya se está dibujando y la prueba sale plana.
			escena.traverse((o) => {
				if (o instanceof THREE.Mesh && o.material) {
					for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
				}
			});
			pintar();
		},
		/**
		 * Mueve el sesgo del mapa de sombras SIN recompilar nada.
		 *
		 * Sirve para contestar «¿esto es shadow acne?» sin apagar las sombras. Apagarlas obliga a
		 * recompilar todos los shaders de la escena, y sobre SwiftShader eso no termina: el primer
		 * intento de barrido se quedó quince minutos colgado. Separando la muestra a lo largo de la
		 * normal se ve lo mismo y cuesta un uniform: si el moteado se desploma, el negro venía del
		 * mapa de sombras muestreándose a sí mismo.
		 */
		sesgoSombra: (normalBias: number, bias?: number) => {
			sol.shadow.normalBias = normalBias;
			if (bias !== undefined) sol.shadow.bias = bias;
			pintar();
			return { normalBias: sol.shadow.normalBias, bias: sol.shadow.bias };
		},
		/**
		 * Las mallas de un aparato, una a una, para poder apagarlas y ver cuál parpadea.
		 *
		 * Buscar dos superficies coplanares leyendo el código de un modelo de trescientas líneas es
		 * perder la tarde. Apagarlas de una en una y volver a medir contesta en dos minutos, y
		 * contesta con el nombre de la pieza.
		 */
		mallasDe: (dispositivoId: string) => {
			const g = escenario.dispositivos.children.find((o) => o.userData.dispositivoId === dispositivoId);
			if (!g) return [];
			const out: Record<string, unknown>[] = [];
			let i = 0;
			g.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const caja = o.geometry.boundingBox ?? (o.geometry.computeBoundingBox(), o.geometry.boundingBox!);
				const tam = caja.getSize(new THREE.Vector3());
				const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
				out.push({
					i: i++,
					pieza: (o.userData.pieza as string) ?? o.name ?? '(sin nombre)',
					marca: !!o.userData.esMarca,
					vertices: o.geometry.attributes.position?.count ?? 0,
					forma: o.geometry.type,
					tam: { x: +tam.x.toFixed(1), y: +tam.y.toFixed(1), z: +tam.z.toFixed(1) },
					pos: { x: +o.position.x.toFixed(1), y: +o.position.y.toFixed(1), z: +o.position.z.toFixed(1) },
					color: mat?.color ? `#${mat.color.getHexString()}` : '—',
					transparente: !!mat?.transparent,
					lado: mat?.side,
					escribeProfundidad: mat?.depthWrite,
				});
			});
			return out;
		},
		/**
		 * BUSCA TODOS LOS PARES DE CARAS CASI COPLANARES DE UN APARATO.
		 *
		 * Bisecar aparato por aparato encuentra UNA culpable cada vez y cuesta veinte minutos. Esto
		 * las encuentra todas de golpe y sin renderizar nada: dos cajas que se solapan en x/y y cuyas
		 * caras frontales están a menos de un pelo la una de la otra son, por definición, dos
		 * superficies peleándose por la misma profundidad. Da igual de qué aparato sean.
		 *
		 * Se mira solo la cara frontal porque es la que se ve: el tablero se mira de frente y en
		 * diagonal, no desde detrás.
		 */
		/**
		 * CARAS COPLANARES CONTRA **TODA LA ESCENA**, no solo dentro del mismo aparato.
		 *
		 * La sonda `coplanares` mira las piezas de un aparato entre sí, y con eso se encontraron
		 * cuatro causas de moteado. Pero deja fuera el caso que queda: dos aparatos IGUALES que
		 * motean distinto —x1 da 35 y x0 da 196— no pueden diferenciarse por su modelo, así que la
		 * otra superficie tiene que ser de fuera: la placa, un carril, una canaleta o el aparato de
		 * al lado. Esto lo busca donde está.
		 */
		vecinosCoplanares: (dispositivoId: string, tolerancia = 0.4) => {
			const g = escenario.dispositivos.children.find((o) => o.userData.dispositivoId === dispositivoId);
			if (!g) return [];
			const mias: { caja: THREE.Box3; luz: number }[] = [];
			g.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
				const c = mat?.color ?? new THREE.Color(0x808080);
				mias.push({ caja: new THREE.Box3().setFromObject(o), luz: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b });
			});
			const fuera: { quien: string; sep: number; solape: number; contraste: number }[] = [];
			const mirar = (raiz: THREE.Object3D, etiqueta: (o: THREE.Object3D) => string): void => {
				raiz.traverse((o) => {
					if (!(o instanceof THREE.Mesh)) return;
					let suyo = false;
					for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q === g) suyo = true;
					if (suyo) return;
					const caja = new THREE.Box3().setFromObject(o);
					const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
					const c = mat?.color ?? new THREE.Color(0x808080);
					const luz = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
					for (const m of mias) {
						const sep = Math.abs(caja.max.z - m.caja.max.z);
						if (sep > tolerancia) continue;
						const ancho = Math.min(caja.max.x, m.caja.max.x) - Math.max(caja.min.x, m.caja.min.x);
						const alto = Math.min(caja.max.y, m.caja.max.y) - Math.max(caja.min.y, m.caja.min.y);
						if (ancho <= 0.5 || alto <= 0.5) continue;
						const quien = etiqueta(o);
						if (!quien) return;
						fuera.push({
							quien, sep: Math.round(sep * 1000) / 1000,
							solape: Math.round(ancho * alto), contraste: Math.round(Math.abs(luz - m.luz) * 100) / 100,
						});
						return;
					}
				});
			};
			mirar(escenario.dispositivos, (o) => {
				for (let q: THREE.Object3D | null = o; q; q = q.parent) {
					if (q.userData.dispositivoId) return `aparato ${q.userData.dispositivoId}`;
				}
				return 'aparato ?';
			});
			// La estructura (placa, carriles, canaletas, caja) cuelga de la raíz, no de un grupo propio.
			mirar(escenario.raiz, (o) => {
				for (let q: THREE.Object3D | null = o; q; q = q.parent) {
					if (q.userData.canaletaId) return `canaleta ${q.userData.canaletaId}`;
					if (q.userData.rielId) return `carril ${q.userData.rielId}`;
					// Los aparatos ya se han mirado arriba; los cables, tiradores y cotas no son
					// superficie: se ignoran para no llamarlos «estructura».
					if (q === escenario.dispositivos || q === escenario.cables || q === escenario.bornes
						|| q === escenario.cotas || q === escenario.handles) return '';
				}
				return 'estructura (placa o caja)';
			});
			// Lo que ya salió por el barrido de aparatos no se repite.
			return fuera.sort((a, b) => b.solape - a.solape).slice(0, 12);
		},
		coplanares: (dispositivoId: string, tolerancia = 0.25, contraste = 0.12) => {
			const g = escenario.dispositivos.children.find((o) => o.userData.dispositivoId === dispositivoId);
			if (!g) return [];
			const cajas: { i: number; frente: number; x0: number; x1: number; y0: number; y1: number; area: number; color: string; luz: number }[] = [];
			let i = 0;
			g.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const n = i++;
				// La serigrafía lleva su propio polygonOffset, pero se mide igual: descartarla de
				// entrada fue lo que dejó fuera las regletas en la primera pasada.
				const caja = new THREE.Box3().setFromObject(o);
				const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
				const col = mat?.color ?? new THREE.Color(0x808080);
				cajas.push({
					i: n, frente: caja.max.z, x0: caja.min.x, x1: caja.max.x, y0: caja.min.y, y1: caja.max.y,
					area: (caja.max.x - caja.min.x) * (caja.max.y - caja.min.y),
					color: `#${col.getHexString()}`,
					luz: 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b,
				});
			});
			const pares: { a: number; b: number; separacion: number; solape: number; colores: string }[] = [];
			for (let m = 0; m < cajas.length; m++) {
				for (let n = m + 1; n < cajas.length; n++) {
					const A = cajas[m], B = cajas[n];
					const sep = Math.abs(A.frente - B.frente);
					if (sep > tolerancia) continue;
					const ancho = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
					const alto = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
					if (ancho <= 0.5 || alto <= 0.5) continue;
					const solape = ancho * alto;
					// Un solape ridículo respecto a las dos piezas es un canto rozando otro, no dos
					// caras compitiendo: eso no se ve parpadear.
					if (solape < Math.min(A.area, B.area) * 0.05) continue;
					/*
					 * Y las dos caras tienen que ser de COLORES DISTINTOS para que el pleito se vea.
					 * Dos piezas del mismo gris peleándose por la profundidad no producen moteado:
					 * gane la que gane, sale el mismo píxel. Sin este filtro la sonda devolvía 2.066
					 * pares en los cinco tableros y casi ninguno parpadeaba, o sea que no servía
					 * para decidir nada.
					 */
					const dif = Math.abs(A.luz - B.luz);
					if (dif < contraste) continue;
					pares.push({
						a: A.i, b: B.i, separacion: +sep.toFixed(3), solape: Math.round(solape),
						colores: `${A.color} / ${B.color}`,
					});
				}
			}
			return pares.sort((x, y) => y.solape - x.solape);
		},
		/** Enciende o apaga una de esas mallas por su índice. */
		verMalla: (dispositivoId: string, indice: number, visible: boolean) => {
			const g = escenario.dispositivos.children.find((o) => o.userData.dispositivoId === dispositivoId);
			if (!g) return false;
			let i = 0, hecho = false;
			g.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				if (i++ === indice) { o.visible = visible; hecho = true; }
			});
			pintar();
			return hecho;
		},
		/* ---- Peinado manual en 3D: crear, mover y leer puntos sin ratón ---- */

		/** Crea un punto de quiebre sobre el recorrido del cable, a la altura de (x,y) en planta. */
		crearPuntoCable: (conductorId: string, x: number, y: number) => {
			const c = proyecto.conductores.find((k) => k.id === conductorId);
			if (!c) return -1;
			const ruta = rutaEnPantalla(conductorId);
			const en = ruta && proyectarEnPolilinea(ruta.puntos, { x, y });
			if (!en) return -1;
			const i = insertarWaypoint(c, en.punto, en.indice + en.t);
			reconstruirCables();
			construirHandles();
			return i;
		},
		/**
		 * Mueve un punto del peinado, con profundidad si se le da.
		 *
		 * Es la misma función que usa el arrastre con el ratón, así que lo que comprueba una prueba
		 * es lo que le pasa a Diego cuando arrastra: si aquí el punto acaba dentro de la canaleta,
		 * es que ahí acaba de verdad.
		 */
		moverPuntoCable: (
			conductorId: string, indice: number, x: number, y: number, z?: number, asistir = true,
		) => {
			const c = proyecto.conductores.find((k) => k.id === conductorId);
			if (!c?.trazado?.[indice]) return undefined;
			moverWaypoint(c, indice, x, y, z, undefined, asistir);
			reconstruirCables();
			construirHandles();
			return { punto: c.trazado[indice], pista: pistaArrastre };
		},
		/**
		 * ¿ESTÁ CADA TIRADOR ENCIMA DE SU CABLE? Medido en píxeles, que es donde se ve.
		 *
		 * El fallo que hay que cerrar es «los puntos aparecen alejados del cable, sobre todo según
		 * el ángulo de la cámara». Se mide desde donde se ve: se proyecta el tirador a la pantalla,
		 * se proyecta el recorrido dibujado del cable, y se mira a cuántos píxeles cae uno del
		 * otro. Si el tirador está sobre el cable, la distancia es del orden del grosor del tubo, y
		 * lo es MIRE DESDE DONDE MIRE la cámara.
		 */
		distanciaTiradores: (conductorId: string) => {
			aplicarSeleccion({ tipo: 'cable', id: conductorId });
			construirHandles();
			const ruta = rutaEnPantalla(conductorId);
			const g = proyecto.gabinete;
			if (!ruta || !g) return undefined;
			const r = renderer.domElement.getBoundingClientRect();
			prepararProyeccion();
			const linea = ruta.puntos.map((q) => aPixeles(q.x - g.ancho / 2, g.alto / 2 - q.y, q.z, r.width, r.height));
			const salida: { indice: number; pixeles: number; antes?: number }[] = [];
			for (const o of escenario.handles.children) {
				const h = o.userData.handle as DatosHandle | undefined;
				if (!h || h.sel.tipo !== 'cable' || h.sel.id !== conductorId) continue;
				const alEje = (px: { x: number; y: number }): number => {
					let d = Infinity;
					for (let i = 0; i < linea.length - 1; i++) {
						if (linea[i].w <= 0 || linea[i + 1].w <= 0) continue;
						d = Math.min(d, distanciaASegmento(px.x, px.y, linea[i].x, linea[i].y, linea[i + 1].x, linea[i + 1].y));
					}
					return Math.round(d * 100) / 100;
				};
				const c = aPixeles(o.position.x, o.position.y, o.position.z, r.width, r.height);
				/*
				 * Y EL CONTROL, en la misma pasada: dónde caería este tirador con la regla vieja, la
				 * profundidad fija de 55 mm. Sin él, decir «0,0 píxeles» no demuestra nada —el
				 * tirador sale del recorrido, así que faltaría más—. Con él se ve la diferencia
				 * entre las dos reglas MIRANDO LO MISMO desde la misma cámara.
				 */
				const wp = proyecto.conductores.find((k) => k.id === conductorId)?.trazado?.[h.indice ?? -1];
				const viejo = wp
					? aPixeles(wp.x - g.ancho / 2, g.alto / 2 - wp.y, Z_HANDLE_CABLE, r.width, r.height)
					: undefined;
				salida.push({
					indice: h.indice ?? -1, pixeles: alEje(c),
					antes: viejo ? alEje(viejo) : undefined,
				});
			}
			return salida;
		},
		/** Radio de curvatura con el que se dibuja ese cable: es lo que recorta las esquinas. */
		radioCodoDe: (conductorId: string) => {
			const c = proyecto.conductores.find((k) => k.id === conductorId);
			return c ? radioCodo(radioDeCable(c.seccion)) : undefined;
		},
		/** Los puntos que el usuario ha fijado a mano, tal cual se guardan. */
		trazadoDe: (conductorId: string) =>
			proyecto.conductores.find((k) => k.id === conductorId)?.trazado?.map((q) => ({ ...q })),
		/** El recorrido 3D que de verdad se dibuja, con la profundidad ya resuelta. */
		rutaDe: (conductorId: string) =>
			rutasDeCables(proyecto).find((r) => r.conductorId === conductorId)?.puntos.map((q) => ({
				x: Math.round(q.x), y: Math.round(q.y), z: Math.round(q.z),
			})),
		/** Pone o quita las tapas de las canaletas (lo mismo que la casilla de la vista). */
		ponerTapas: (puestas: boolean) => {
			($('ver-tapas') as HTMLInputElement).checked = puestas;
			for (const t of escenario.tapas) t.visible = puestas;
			pintar();
			return escenario.tapas.length;
		},
		/**
		 * Toca el mapa de rugosidad de la pintura: quitarlo, repetirlo menos o filtrarlo mejor.
		 *
		 * Es un ruido blanco de 64×64 repetido 26 veces sobre la placa, y sin anisotropía. Eso es
		 * una frecuencia altísima en pantalla, y en oblicuo el filtrado no da abasto: la rugosidad
		 * centellea y con ella el reflejo. Con estas tres palancas se puede saber si el moteado
		 * viene de ahí sin adivinarlo.
		 */
		grano: (opciones: { mapa?: boolean; repeticion?: number; anisotropia?: number }) => {
			let tocados = 0;
			escena.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
					const mat = m as THREE.MeshStandardMaterial;
					const guardado = o.userData.grano as THREE.Texture | undefined;
					if (!mat?.roughnessMap && !guardado) continue;
					if (opciones.mapa === false && mat.roughnessMap) {
						o.userData.grano = mat.roughnessMap;
						mat.roughnessMap = null;
						mat.needsUpdate = true;
					} else if (opciones.mapa === true && guardado) {
						mat.roughnessMap = guardado;
						mat.needsUpdate = true;
					}
					const tex = mat.roughnessMap ?? guardado;
					if (tex && opciones.repeticion !== undefined) tex.repeat.set(opciones.repeticion, opciones.repeticion);
					if (tex && opciones.anisotropia !== undefined) { tex.anisotropy = opciones.anisotropia; tex.needsUpdate = true; }
					tocados++;
				}
			});
			pintar();
			return tocados;
		},
		/** Dónde cae un punto del modelo en la pantalla: para poder agarrarlo con el ratón. */
		/**
		 * «HAGO CLIC EXACTAMENTE SOBRE EL CABLE Y EL EDITOR NO LO ENCUENTRA»: medido.
		 *
		 * Se apunta al EJE del cable, en el punto del recorrido que toque, se convierte a píxeles
		 * ENTEROS —que es lo que entrega un ratón de verdad— y se pregunta qué encuentra ahí el
		 * editor. Y en la misma pasada se pregunta lo mismo al método anterior, reproducido tal
		 * cual: un cilindro de agarre de `max(radio + 7, 9)` MILÍMETROS alrededor del eje, cortado
		 * por el rayo del ratón. Así la comparación es entre dos reglas mirando el mismo píxel de
		 * la misma cámara, y no entre dos sesiones distintas.
		 */
		aciertoDeClic: (conductorId: string, fraccion: number) => {
			const ruta = rutaEnPantalla(conductorId);
			const g = proyecto.gabinete;
			if (!ruta?.puntos.length || !g) return undefined;
			const q = ruta.puntos[Math.min(ruta.puntos.length - 1, Math.round(fraccion * (ruta.puntos.length - 1)))];
			const r = renderer.domElement.getBoundingClientRect();
			prepararProyeccion();
			const v = aPixeles(q.x - g.ancho / 2, g.alto / 2 - q.y, q.z, r.width, r.height);
			if (v.w <= 0) return undefined;
			// Píxeles enteros y dentro del lienzo: si el punto cae fuera, no es un caso de agarre.
			const px = { x: Math.round(r.left + v.x), y: Math.round(r.top + v.y) };
			if (v.x < 0 || v.y < 0 || v.x > r.width || v.y > r.height) return undefined;
			const ev = new PointerEvent('pointermove', {
				clientX: px.x, clientY: px.y, bubbles: true, cancelable: true, pointerId: 1, buttons: 0,
			});
			const lista = cablesSenalados(ev);
			const elegido = lista[0];
			const mio = lista.find((c) => c.id === conductorId);
			const ahora = elegido?.id;
			/*
			 * Y por qué falla cuando falla, que no es lo mismo:
			 *   ninguno  no se encuentra nada → ése es el fallo del que se queja Diego
			 *   tapado   se encuentra otro cable que está DELANTE en ese píxel → correcto: lo que
			 *            se ve ahí es el otro, y el clic es suyo
			 *   otro     se encuentra otro que no está delante → eso sí sería un fallo
			 */
			const porque = !elegido ? 'ninguno'
				: elegido.id === conductorId ? 'acierta'
					: (mio && elegido.profundidad <= mio.profundidad ? 'tapado' : 'otro');
			/*
			 * El método anterior, reproducido: cilindro de agarre en milímetros contra el rayo. Se
			 * comprueba sobre los puntos MEDIOS de cada tramo del recorrido, que están a 8 mm unos
			 * de otros, así que la aproximación es más generosa que el tubo original, no menos.
			 */
			punteroEnPixeles(ev);
			raycaster.setFromCamera(puntero, camaraViva());
			const rayo = raycaster.ray;
			let antes: string | undefined;
			let mejor = Infinity;
			for (const otra of rutasVigentes()) {
				const grueso = Math.max(otra.radio + 7, 9);
				for (let i = 0; i < otra.puntos.length - 1; i++) {
					const a = otra.puntos[i], b = otra.puntos[i + 1];
					const pa = new THREE.Vector3(a.x - g.ancho / 2, g.alto / 2 - a.y, a.z);
					const pb = new THREE.Vector3(b.x - g.ancho / 2, g.alto / 2 - b.y, b.z);
					const medio = pa.clone().add(pb).multiplyScalar(0.5);
					const d = rayo.distanceToPoint(medio);
					if (d <= grueso) {
						const t = rayo.origin.distanceTo(medio);
						if (t < mejor) { mejor = t; antes = otra.conductorId; }
					}
				}
			}
			return {
				pantalla: px, ahora, antes, porque,
				acierta: ahora === conductorId, acertabaAntes: antes === conductorId,
			};
		},
		/**
		 * QUÉ ESTÁN HACIENDO LOS COMPONENTES DE PUERTA, leído de la ESCENA y no del modelo.
		 *
		 * Es la única forma de comprobar que lo que se ve es lo que dice el circuito: se mira la
		 * intensidad de emisión de la lente y la opacidad del halo —lo que de verdad se dibuja—,
		 * no una variable de estado que podría estar diciendo una cosa mientras la pantalla dice
		 * otra. Y se devuelve la posición en el mundo, para poder verificar que la pieza viaja con
		 * la puerta.
		 */
		componentesDePuerta: () => escenario.aparatos
			.filter((g) => g.userData.montaje === 'puerta')
			.map((g) => {
				let lente: THREE.Mesh | undefined;
				let halo: THREE.Mesh | undefined;
				g.traverse((o) => {
					if (o.userData.pieza === 'lente') lente = o as THREE.Mesh;
					if (o.userData.pieza === 'halo') halo = o as THREE.Mesh;
				});
				const mat = lente?.material as THREE.MeshStandardMaterial | undefined;
				const mh = halo?.material as THREE.MeshBasicMaterial | undefined;
				const w = g.getWorldPosition(new THREE.Vector3());
				return {
					id: g.userData.dispositivoId as string,
					encendido: (mat?.emissiveIntensity ?? 0) > 0.01,
					emision: Math.round((mat?.emissiveIntensity ?? 0) * 100) / 100,
					halo: Math.round((mh?.opacity ?? 0) * 100) / 100,
					color: mat ? `#${mat.color.getHexString()}` : undefined,
					mundo: { x: Math.round(w.x), y: Math.round(w.y), z: Math.round(w.z) },
					/*
					 * SIN REDONDEAR. Comprobar que la puerta se mueve como un sólido rígido es
					 * comparar distancias entre piezas a lo largo del giro, y con las coordenadas
					 * redondeadas al milímetro esa distancia baila sola casi un milímetro: la
					 * prueba acusaba a la puerta de deformarse cuando lo que se deformaba era la
					 * medida. Lo redondeado se queda para leerlo; esto es para medirlo.
					 */
					fino: { x: w.x, y: w.y, z: w.z },
				};
			}),
		/**
		 * ¿SE PUEDE SEÑALAR ESE APARATO? Se apunta a su centro, se despacha un movimiento de ratón
		 * de verdad y se pregunta qué ha encontrado el editor. `desvio` mueve el puntero unos
		 * píxeles: sirve para comprobar que la zona de agarre es cómoda y no exige puntería.
		 */
		senalar: (dispositivoId: string, desvio = 0) => {
			const g = escenario.aparatos.find((o) => o.userData.dispositivoId === dispositivoId);
			if (!g) return undefined;
			const r = renderer.domElement.getBoundingClientRect();
			prepararProyeccion();
			const w = g.getWorldPosition(new THREE.Vector3());
			const v = aPixeles(w.x, w.y, w.z, r.width, r.height);
			if (v.w <= 0) return { fuera: true };
			const ev = new PointerEvent('pointermove', {
				clientX: Math.round(r.left + v.x + desvio), clientY: Math.round(r.top + v.y),
				bubbles: true, cancelable: true, pointerId: 1, buttons: 0,
			});
			const hallado = elementoBajoElPuntero(ev);
			return {
				pantalla: { x: Math.round(v.x), y: Math.round(v.y) },
				hallado: hallado ? `${hallado.tipo}:${hallado.id}` : 'nada',
				acierta: hallado?.tipo === 'dispositivo' && hallado.id === dispositivoId,
			};
		},
		/**
		 * ABRE UN PROYECTO desde su JSON, por el MISMO camino que el botón de abrir archivo.
		 *
		 * Es lo que permite probar el ida y vuelta de guardar y cargar sin tocar el disco: si esto
		 * pasara por un atajo distinto del que usa el usuario, la prueba diría que el archivo
		 * sobrevive cuando lo que sobrevive es otra cosa.
		 */
		cargarJson: (json: string) => {
			const { proyecto: abierto } = cargarProyecto(json);
			reemplazarProyecto(abierto);
			return true;
		},
		/** Deja la puerta en un ángulo exacto, sin animación: para mirarla a medio abrir. */
		ponerPuerta: (t: number) => {
			puertaDestino = Math.max(0, Math.min(1, t));
			puertaCrudo = puertaDestino;
			puertaAhora = puertaDestino;
			aplicarPuerta();
			pintar();
			return puertaAhora;
		},
		/* ---- El frontal, para poder probarlo desde fuera ---- */
		/** Las piezas montadas en la puerta tal como las ve el editor. */
		piezasDelFrontal: () => piezasFrontal().map((q) => ({
			...q, x: Math.round(q.x), y: Math.round(q.y),
			ancho: Math.round(q.ancho), alto: Math.round(q.alto),
		})),
		/** Dónde cae en pantalla una pieza del frontal, para poder pincharla con el ratón de verdad. */
		puntoEnPantallaDeFrontal: (clase: 'aparato' | 'rotulo', id: string) => {
			const m = escenario.frontal.find((f) => f.tipo === clase && f.id === id);
			if (!m) return undefined;
			const r = renderer.domElement.getBoundingClientRect();
			prepararProyeccion();
			const w = m.grupo.getWorldPosition(new THREE.Vector3());
			const v = aPixeles(w.x, w.y, w.z, r.width, r.height);
			return v.w > 0 ? { x: r.left + v.x, y: r.top + v.y } : undefined;
		},
		/** Marca varias piezas del frontal, como haría un Mayúsculas+clic repetido. */
		marcarEnFrontal: (claves: ['aparato' | 'rotulo', string][]) => {
			if (!claves.length) return 0;
			seleccionarFrontal(claves[0][0], claves[0][1]);
			for (const [clase, id] of claves.slice(1)) alternarFrontalExtra(clase, id);
			return seleccionFrontal().length;
		},
		/**
		 * LA IDENTIDAD DE LAS PIEZAS GRANDES DE LA ESCENA.
		 *
		 * «Mover un piloto no reconstruye el armario» no se puede comprobar contando milisegundos:
		 * un ordenador rápido reconstruye el armario entero sin que se note. Lo que sí es
		 * incontestable es la IDENTIDAD de las mallas: si el grupo del armario sigue siendo el
		 * mismo objeto de antes, nadie lo ha vuelto a montar. Y si cambia, se ha rehecho aunque el
		 * resultado se vea igual.
		 */
		identidades: () => ({
			envolvente: escenario.envolvente.uuid,
			puerta: escenario.puerta.pivote.uuid,
			raiz: escenario.raiz.uuid,
			cables: escenario.cables.uuid,
			dispositivos: escenario.dispositivos.uuid,
			frontal: escenario.frontal.map((f) => `${f.tipo}:${f.id}=${f.grupo.uuid}`),
			mallasEnEscena: (() => { let n = 0; escenario.raiz.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; })(),
		}),
		/** Dónde está la cámara ahora mismo: para comprobar que cambiar de espacio no la pierde. */
		camaraAhora: () => ({
			espacio,
			pos: { x: Math.round(camara.position.x), y: Math.round(camara.position.y), z: Math.round(camara.position.z) },
			mira: { x: Math.round(controles.target.x), y: Math.round(controles.target.y), z: Math.round(controles.target.z) },
		}),
		/** Quita un conductor por su id: así se «pierde una fase» sin tocar ninguna bandera. */
		quitarConductor: (conductorId: string) => {
			const antes = proyecto.conductores.length;
			proyecto.conductores = proyecto.conductores.filter((c) => c.id !== conductorId);
			if (proyecto.conductores.length === antes) return false;
			recalcular();
			reconstruirCables();
			return true;
		},
		/** El conductor que alimenta un borne, para poder cortarlo por su nombre. */
		conductorHacia: (dispositivoId: string, borneId: string) => proyecto.conductores.find(
			(c) => (c.a.dispositivoId === dispositivoId && c.a.borneId === borneId)
				|| (c.de.dispositivoId === dispositivoId && c.de.borneId === borneId),
		)?.id,
		pantallaDe: (x: number, y: number, z: number) => {
			const g = proyecto.gabinete;
			if (!g) return undefined;
			const v = new THREE.Vector3(x - g.ancho / 2, g.alto / 2 - y, z).project(camaraViva());
			const r = renderer.domElement.getBoundingClientRect();
			return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
		},
		/**
		 * ARRASTRA UNA UNIÓN DESDE DENTRO DE LA PÁGINA, sin pasar por el ida y vuelta del navegador.
		 *
		 * Conducir el ratón desde Playwright mide sobre todo a Playwright: treinta movimientos
		 * tardaban 147 segundos y el cronómetro de la aplicación apenas contaba treinta
		 * milisegundos de trabajo. Eso no es el lag de Diego, es el arnés. Aquí se despachan los
		 * MISMOS eventos que produce un ratón de verdad, en un bucle apretado, y se cronometra lo
		 * que tarda la aplicación en atenderlos. Eso sí es lo que se siente al arrastrar.
		 */
		/**
		 * PASEAR EL RATÓN POR ENCIMA DEL TABLERO, sin apretar, y cronometrarlo.
		 *
		 * El arrastre ya se medía; esto mide lo OTRO que pasa todo el rato: buscar qué hay bajo el
		 * puntero en cada movimiento. Desde que la selección se resuelve proyectando los recorridos
		 * a la pantalla, ese trabajo es proporcional al número de cables, así que hay que saber
		 * cuánto cuesta de verdad y no suponerlo.
		 */
		simularPaseo: (n = 60) => {
			const r = renderer.domElement.getBoundingClientRect();
			const tiempos: number[] = [];
			let encontrados = 0;
			for (let i = 0; i < n; i++) {
				const x = r.left + r.width * (0.18 + 0.64 * (i / (n - 1)));
				const y = r.top + r.height * (0.22 + 0.56 * (((i * 7) % n) / (n - 1)));
				const t0 = performance.now();
				renderer.domElement.dispatchEvent(new PointerEvent('pointermove', {
					clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, buttons: 0,
				}));
				tiempos.push(performance.now() - t0);
				if (cableHover) encontrados++;
			}
			const ord = [...tiempos].sort((a, b) => a - b);
			const q = (f: number) => Math.round(ord[Math.min(ord.length - 1, Math.floor(ord.length * f))] * 100) / 100;
			return {
				eventos: n, encontrados,
				mediana: q(0.5), p95: q(0.95), peor: q(0.999),
				msTotal: Math.round(tiempos.reduce((a, b) => a + b, 0) * 10) / 10,
			};
		},
		simularArrastre: (conductorId: string, indice: number, n = 30, dx = 2, dy = 1.5, eje?: 'x' | 'y' | 'z') => {
			const c = proyecto.conductores.find((k) => k.id === conductorId);
			const wp = c?.trazado?.[indice];
			if (!c || !wp) return undefined;
			const g = proyecto.gabinete!;
			const r = renderer.domElement.getBoundingClientRect();
			const aPantalla = (x: number, y: number, z: number) => {
				const v = new THREE.Vector3(x - g.ancho / 2, g.alto / 2 - y, z).project(camaraViva());
				return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
			};
			/*
			 * Primero se SELECCIONA el cable, como hace cualquiera antes de tocar una unión: los
			 * tiradores solo existen para el cable seleccionado, y sin tirador el `pointerdown` no
			 * tiene a qué agarrarse. La primera versión de esta sonda no lo hacía y el arrastre no
			 * llegaba a arrancar: los pasos de la prueba salían en verde porque nada se movía, que
			 * es la peor forma de pasar una prueba.
			 */
			aplicarSeleccion({ tipo: 'cable', id: conductorId });
			construirHandles();
			/*
			 * Se apunta al TIRADOR, no a donde uno cree que está el punto.
			 *
			 * Proyectando `wp` con `Z_FRENTE` cuando el punto no tiene z propia, la pulsación caía
			 * varios centímetros de donde el tirador se dibuja de verdad —su profundidad la decide
			 * el repartidor— y en un tablero de cincuenta y dos cables eso significa pulsar sobre
			 * OTRO cable: el diagnóstico decía «encontrado w27, índice −1» cuando se buscaba w1. El
			 * tirador sabe dónde está; se le pregunta a él.
			 */
			const tirador = escenario.handles.children.find((o) => {
				const h = o.userData.handle as DatosHandle | undefined;
				return h?.sel.tipo === 'cable' && h.sel.id === conductorId && h.indice === indice;
			});
			const p0 = tirador
				? (() => {
					const v = tirador.getWorldPosition(new THREE.Vector3()).project(camaraViva());
					return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
				})()
				: aPantalla(wp.x, wp.y, wp.z ?? Z_FRENTE);
			const lanzar = (tipo: string, x: number, y: number, extra: PointerEventInit = {}) =>
				renderer.domElement.dispatchEvent(new PointerEvent(tipo, {
					clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, ...extra,
				}));
			lanzar('pointermove', p0.x, p0.y);
			lanzar('pointerdown', p0.x, p0.y);
			// Qué encontró la pulsación: sin esto, un arrastre que no arranca es indistinguible de
			// uno que arranca y no mueve nada.
			const tras = {
				modo, arrastrando, pendiente: pendienteCable ? { ...pendienteCable } : undefined,
				handle: !!handleArrastrado, seleccion: sel ? { ...sel } : undefined,
				tiradores: escenario.handles.children.length,
				enPantalla: { x: Math.round(p0.x), y: Math.round(p0.y) },
			};
			// Un primer movimiento convierte la intención en arrastre; solo entonces la tecla del eje
			// tiene a quién aplicarse.
			if (eje) {
				// 40 píxeles: el arrastre no arranca hasta que el punto se ha movido 6 mm de modelo,
				// y con un paso pequeño la tecla del eje llegaría antes de que hubiera arrastre.
				lanzar('pointermove', p0.x + 40, p0.y + 40);
				window.dispatchEvent(new KeyboardEvent('keydown', { key: eje, bubbles: true }));
			}
			const t0 = performance.now();
			const porEvento: number[] = [];
			for (let i = 1; i <= n; i++) {
				const t = performance.now();
				lanzar('pointermove', p0.x + i * dx, p0.y + i * dy);
				porEvento.push(performance.now() - t);
			}
			const ms = performance.now() - t0;
			// Se apunta ANTES de soltar: al soltar se limpia todo y ya no habría a quién preguntar.
			// Cuenta como enganchado tanto el tubo como la esfera azul: son las dos formas de coger
			// el mismo punto, y la esfera es la que usa la gente.
			const enganchado = !!arrastrandoCable || (!!handleArrastrado && sel?.tipo === 'cable');
			const bloqueo = ejeArrastre?.eje;
			// Dónde estaba el punto CUANDO SE BLOQUEÓ el eje. Comparar contra la posición previa al
			// arrastre no dice nada: entre una cosa y otra el punto se ha movido a propósito.
			const ancla = ejeArrastre ? { ...ejeArrastre.ancla } : undefined;
			lanzar('pointerup', p0.x + n * dx, p0.y + n * dy, { buttons: 0 });
			porEvento.sort((a, b) => a - b);
			return {
				eventos: n,
				// Sin esto, un arrastre que no llega a engancharse se lee como «no se movió nada» y
				// parece que el bloqueo de eje funciona cuando lo que pasa es que no pasó nada.
				enganchado, bloqueo, ancla, tras,
				msTotal: Math.round(ms * 100) / 100,
				mediana: Math.round(porEvento[Math.floor(n / 2)] * 100) / 100,
				p95: Math.round(porEvento[Math.floor(n * 0.95)] * 100) / 100,
				peor: Math.round(porEvento[n - 1] * 100) / 100,
			};
		},
		/** ¿Vale este sitio para un cable? Con el mismo criterio que usa el ruteo automático. */
		validez: (x: number, y: number, z: number, radio = 3) => validezDelPunto({ x, y, z }, radio),
		/** El eje bloqueado ahora mismo, si hay alguno. */
		ejeBloqueado: () => ejeArrastre?.eje,
        /** Qué problema tiene la posición de ahora mismo, si tiene alguno. */
		problemaArrastre: () => motivoInvalido,
		/* ---- Cronómetro del arrastre: medir antes de optimizar ---- */
		cronometro: (encender: boolean) => {
			crono.activo = encender;
			crono.etapas.clear();
			reiniciarContadores();
			return encender;
		},
		cronometroLeer: () => ({
			etapas: [...crono.etapas.entries()].map(([etapa, e]) => ({
				etapa, veces: e.n, msTotal: Math.round(e.ms * 100) / 100,
				msPorVez: Math.round((e.ms / e.n) * 1000) / 1000,
			})).sort((a, b) => b.msTotal - a.msTotal),
			contadores: { ...contadores, msFirmas: Math.round(contadores.msFirmas * 100) / 100 },
		}),
		/** Esconde (o devuelve) los planos de serigrafía del atlas, sin tocar nada más. */
		marcas3d: (on: boolean) => {
			let n = 0;
			escena.traverse((o) => {
				if (o.userData.esMarca) { o.visible = on; n++; }
			});
			pintar();
			return n;
		},
		/** Los números de profundidad de la cámara, para no discutir de precisión Z a ojo. */
		profundidadCamara: () => {
			const c = camaraViva() as THREE.PerspectiveCamera;
			const caja = new THREE.Box3().setFromObject(escenario.raiz);
			const tam = caja.getSize(new THREE.Vector3());
			const centro = caja.getCenter(new THREE.Vector3());
			return {
				near: c.near, far: c.far, razon: Math.round(c.far / c.near),
				distanciaAlCentro: Math.round(c.position.distanceTo(centro)),
				escena: { x: Math.round(tam.x), y: Math.round(tam.y), z: Math.round(tam.z) },
			};
		},
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
		/**
		 * QUÉ HAY DE VERDAD EN ESE PÍXEL, CHAPA DEL ARMARIO INCLUIDA.
		 *
		 * `diagnosticoPixel` usa el trazado de rayos de la interacción, y la envolvente está fuera
		 * de él a propósito —el armario no se pincha—. Eso está bien para saber qué se puede
		 * seleccionar y es inútil para la pregunta «¿se ve la canaleta A TRAVÉS del costado?»,
		 * porque el costado no aparece en la lista aunque esté delante. Aquí se le devuelve el
		 * trazado a la envolvente el tiempo justo de lanzar un rayo, y se recupera después.
		 */
		queHayEnPixel: (x: number, y: number) => {
			const r = renderer.domElement.getBoundingClientRect();
			puntero.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
			raycaster.setFromCamera(puntero, camaraViva());
			const devueltos: { m: THREE.Mesh; fn: THREE.Mesh['raycast'] }[] = [];
			escenario.envolvente.traverse((o) => {
				const m = o as THREE.Mesh;
				if (!m.isMesh) return;
				devueltos.push({ m, fn: m.raycast });
				m.raycast = THREE.Mesh.prototype.raycast;
			});
			try {
				return raycaster.intersectObjects(escenario.raiz.children, true).slice(0, 6).map((h) => {
					const u = h.object.userData;
					const que = u.tuboVisible ? 'cable' : u.canaletaId ? 'canaleta' : u.rielId ? 'riel'
						: u.dispositivoId ? 'aparato' : devueltos.some((d) => d.m === h.object) ? 'ARMARIO' : 'otro';
					const m = h.object as THREE.Mesh;
					return `${que}:${u.canaletaId ?? u.rielId ?? u.dispositivoId ?? m.geometry.type}`
						+ `@${h.distance.toFixed(1)}`
						+ `[${h.point.x.toFixed(1)},${h.point.y.toFixed(1)},${h.point.z.toFixed(1)}]`;
				});
			} finally {
				for (const d of devueltos) d.m.raycast = d.fn;
			}
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
		/**
		 * EL COLOR QUE DE VERDAD SALE POR PANTALLA en un punto del lienzo 3D.
		 *
		 * «Ese cable se ve amarillento» es una impresión, y con impresiones no se corrige un
		 * pipeline de color: se compensa una cosa con otra hasta que parece bien desde un ángulo.
		 * Esto lee el framebuffer y devuelve el píxel con su tono y su saturación, para poder
		 * comparar el mismo conductor apagado y encendido con números.
		 *
		 * Se promedia un cuadradito de 3×3 porque un cable es un tubo: el píxel exacto puede caer
		 * en la raya especular y decir «blanco» de un conductor negro.
		 */
		colorEnPixel: (x: number, y: number) => {
			const c = renderer.domElement;
			const r = c.getBoundingClientRect();
			const px = Math.round(((x - r.left) / r.width) * c.width);
			const py = Math.round(((y - r.top) / r.height) * c.height);
			const lienzo = document.createElement('canvas');
			lienzo.width = 3;
			lienzo.height = 3;
			const ctx = lienzo.getContext('2d')!;
			ctx.drawImage(c, px - 1, py - 1, 3, 3, 0, 0, 3, 3);
			const d = ctx.getImageData(0, 0, 3, 3).data;
			let R = 0;
			let G = 0;
			let B = 0;
			for (let i = 0; i < 9; i++) { R += d[i * 4]; G += d[i * 4 + 1]; B += d[i * 4 + 2]; }
			R = Math.round(R / 9); G = Math.round(G / 9); B = Math.round(B / 9);
			const col = new THREE.Color(R / 255, G / 255, B / 255);
			const hsl = { h: 0, s: 0, l: 0 };
			col.getHSL(hsl);
			return { r: R, g: G, b: B, tono: Math.round(hsl.h * 360), saturacion: Math.round(hsl.s * 100), luz: Math.round(hsl.l * 100) };
		},
		/** Los valores REALES de emisión de cada cable en ejecución. Para dejar de suponerlos. */
		emisionCables: () => {
			const out: { id: string; color: string; emissive: string; intensidad: number }[] = [];
			escenario.cables.traverse((o) => {
				if (!(o instanceof THREE.Mesh) || !o.userData.tuboVisible) return;
				const m = o.material as THREE.MeshStandardMaterial;
				out.push({
					id: o.userData.conductorId as string,
					color: m.color.getHexString(),
					emissive: m.emissive.getHexString(),
					intensidad: Math.round(m.emissiveIntensity * 1000) / 1000,
				});
			});
			return out;
		},
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
