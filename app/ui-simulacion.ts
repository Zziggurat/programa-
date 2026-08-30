/**
 * Modo Energizar: dar tensión al tablero y verlo funcionar.
 *
 * Todo lo que pasa con el tablero energizado vive aquí: el reloj de la maniobra, el disparo de las
 * protecciones, el brillo de los cables vivos en el 3D, el panel de lo que está funcionando y el
 * clic que acciona un pulsador en vez de seleccionarlo.
 *
 * No importa nada de `main.ts`. Lo que necesita del editor —el proyecto, la escena, seleccionar un
 * aparato— entra por `ContextoSimulacion` al instalarlo, y a cambio devuelve `PanelSimulacion`:
 * eso, y solo eso, es lo que el editor puede pedirle.
 */
import * as THREE from 'three';

import { resolverComportamiento } from '../src/modelo/comportamiento.js';
import { Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import type { ClaseIOPLC, FuerzasPLC, OrdenesRuntimePLC } from '../src/modelo/programa-plc.js';
import { esReferenciaVisualInerte } from '../src/modelo/apariencia.js';
import { MemoriaLogica, memoriaLogicaVacia } from '../src/motores/logica.js';
import {
	EstadoAparato, EstadoTablero, EstadoVariador, MemoriaTiempos, ResultadoSimulacion,
	actualizarProteccionesRuntime, formatearA, memoriaVacia, simular,
} from '../src/motores/simulacion.js';
import {
	ETIQUETA_FALLO_RUNTIME, cambiarFalloRuntime, fallosCompatibles,
} from '../src/motores/fallos-runtime.js';
import { emisionDeCable } from './animacion-sim.js';
import { Escenario } from './escena3d.js';
import { avisar, escaparHtml } from './dialogos.js';
import { actualizarAnalisisFisica, actualizarInstrumentosFisica, htmlFisicaV5, type SeleccionInstrumentosFisica } from './panel-fisica.js';
import type { FallaFisicaRuntime } from '../src/fisica/fallas.js';

/** Lo que la simulación necesita del editor. */
export interface ContextoSimulacion {
	proyecto: () => Proyecto;
	/** La escena montada ahora mismo (se reconstruye al cambiar el tablero, por eso es función). */
	escenario: () => Escenario;
	/** Selecciona un aparato del tablero (al pinchar una fila del panel). */
	seleccionar: (id: string | undefined) => void;
	/** Selecciona el tubo visible de un conductor desde sus magnitudes V5. */
	seleccionarCable?: (id: string) => void;
	/** Sincroniza la visibilidad del cajón cuando Energizar lo fuerza fuera de su herramienta. */
	refrescarPanel?: () => void;
}

/** Lo que el editor puede pedirle a la simulación una vez instalada. */
export interface PanelSimulacion {
	/** ¿Está el tablero con tensión? */
	energizado: () => boolean;
	/** Da o quita tensión. */
	alternar: () => void;
	/** Vuelve a resolver el circuito (tras cambiar el tablero). No hace nada si no hay tensión. */
	recalcular: () => void;
	/**
	 * Acciona un aparato como si se hubiera pinchado en él. Devuelve true si ha accionado algo,
	 * para que el clic no siga su camino normal (seleccionar para editar).
	 */
	accionar: (dispositivoId: string) => boolean;
	/** Mantiene apretado un mando momentáneo hasta la llamada correspondiente a `soltar`. */
	presionar: (dispositivoId: string) => boolean;
	/** Suelta un mando momentáneo; no cambia selectores ni aparatos de corte. */
	soltar: (dispositivoId: string) => boolean;
	/**
	 * ¿Este aparato se accionaría si se pinchara en él?
	 *
	 * Hace falta porque, con la cámara en el botón izquierdo, el editor tiene que decidir al
	 * APRETAR si el gesto puede acabar accionando algo, y accionarlo de verdad solo al soltar.
	 * Preguntar `accionar()` para averiguarlo sería accionarlo: la pregunta y el acto tienen que
	 * ser dos cosas distintas. Lee la misma tabla que `accionar`, así que no pueden separarse.
	 */
	puedeAccionar: (dispositivoId: string) => boolean;
	/** El último resultado de la simulación, para las pruebas y el panel. */
	resultado: () => ResultadoSimulacion | undefined;
	/** La posición de cada mando, para las pruebas. */
	estadoDeLosMandos: () => EstadoTablero;
	/**
	 * Olvida TODO lo que la simulación recordaba: mandos, memoria del circuito y reloj.
	 *
	 * Lo llama el editor cuando el tablero se cambia entero —abrir un ejemplo, abrir un archivo,
	 * empezar de cero—, porque a partir de ahí lo que hubiera guardado no es de este tablero.
	 */
	reiniciar: () => void;
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export type ControlSimulacion =
	| {
		clase: 'mando';
		modo: 'momentaneo' | 'mantenido';
		posiciones: 2 | 3;
		reposo: number;
	}
	| { clase: 'sensor'; analogico: boolean }
	| { clase: 'proteccion'; rearmable: boolean; termico: boolean;
		funcion: 'termico' | 'termomagnetico' | 'fusible' | 'diferencial' | 'no-declarada' }
	| { clase: 'seccionador' };

/**
 * Traduce el contrato eléctrico al control que puede operar una persona.
 *
 * El perfil manda incluso si la carcasa es `otro` o viene de una imagen. `tipo` solo conserva una
 * excepción honesta del adaptador legacy: hoy `proteccion` es también el contrato de continuidad
 * de un seccionador, aunque éste no dispara. Hasta que el perfil tenga una clase `corte`, se lo
 * separa aquí para no presentarlo como protección ni inventarle un rearme.
 */
export function controlDeSimulacion(d: Dispositivo): ControlSimulacion | undefined {
	const perfil = resolverComportamiento(d);
	if (perfil?.clase === 'mando' && d.rol?.tipo !== 'esclavo') {
		return {
			clase: 'mando', modo: perfil.modo, posiciones: perfil.posiciones, reposo: perfil.reposo,
		};
	}
	if (perfil?.clase === 'sensor') return { clase: 'sensor', analogico: !!perfil.transmisor || !!d.rangoSonda };
	if (perfil?.clase !== 'proteccion') return undefined;
	if (d.tipo === 'seccionador') return { clase: 'seccionador' };
	const ids = new Set(d.bornes.map((b) => b.id));
	return {
		clase: 'proteccion',
		rearmable: perfil.rearmable,
		termico: perfil.funcion === 'termico' || ids.has('95') && !ids.has('A1'),
		funcion: perfil.funcion === 'seccionamiento' || !perfil.funcion ? 'no-declarada' : perfil.funcion,
	};
}

/** Dura más que el scan predeterminado y el tick de UI, para que un gesto sintético no se pierda. */
export const DURACION_PULSO_SINTETICO_MS = 250;

export type OperacionControl = 'accionar' | 'presionar' | 'soltar';

export interface ResultadoOperacionControl {
	atendido: boolean;
	cambio: boolean;
	estado: EstadoAparato;
}

/** Texto compacto y estable para el estado contractual de un variador. */
export function textoEstadoVariador(v: EstadoVariador): string {
	const estado = v.estado === 'sin-alimentacion' ? 'SIN ALIMENTACIÓN'
		: v.estado === 'listo' ? 'READY' : v.estado === 'marcha' ? 'RUN'
			: v.estado === 'decel' ? 'DECEL' : 'FAULT';
	const electrica = v.referenciaElectrica?.valorElectrico === undefined ? ''
		: ` · ${v.referenciaElectrica.valorElectrico.toFixed(2)} ${v.referenciaElectrica.unidadElectrica}`;
	return `${estado} · ${v.frecuenciaHz.toFixed(1)} Hz · ref. ${v.referenciaPorcentaje.toFixed(0)} %${electrica}`
		+ ` · ${v.calidadReferencia.toUpperCase().replaceAll('-', ' ')}`;
}

/**
 * Indica si el resultado puede cambiar únicamente porque avanza el reloj.
 *
 * El scheduler de la UI no debe decidir por la carcasa legacy: un controlador importado, un
 * motor con perfil o un VFD en rampa dependen del tiempo igual que sus equivalentes nativos.
 */
export function requiereAvanceTemporal(
	proyecto: Proyecto,
	resultado: ResultadoSimulacion | undefined,
	sobrecargas: Readonly<Record<string, number>>,
): boolean {
	return proyecto.dispositivos.some((d) => d.temporizacion?.segundos
		|| (resolverComportamiento(d)?.clase === 'controlador'
			&& (!!d.programaPLC || /\b(retardo|m[ií]nimo)\b/i.test(d.programa ?? ''))))
		|| Object.keys(sobrecargas).length > 0
		|| !!resultado?.motores.some((motor) => motor.estado === 'arrancando')
		|| !!resultado?.motores.some((motor) => motor.estado === 'desacelerando')
		|| !!resultado?.protecciones.some((p) => p.estado === 'calentando')
		|| !!resultado?.disparos.length
		|| !!resultado?.fallos.some((f) => f.tipo === 'sobrecarga' || f.tipo === 'perdida-fase')
		|| !!resultado?.actuadores.some((a) => a.estado === 'abriendo' || a.estado === 'cerrando')
		|| !!resultado?.variadores.some((variador) =>
			Math.abs(variador.frecuenciaHz - variador.frecuenciaObjetivoHz) > 0.01);
}

/** Transición pura del estado runtime; la UI y los tests usan exactamente las mismas reglas. */
export function operarControl(
	d: Dispositivo,
	estado: EstadoAparato,
	operacion: OperacionControl,
): ResultadoOperacionControl {
	const control = controlDeSimulacion(d);
	const siguiente = { ...estado };
	if (!control) return { atendido: false, cambio: false, estado: siguiente };

	if (control.clase === 'mando') {
		if (control.modo === 'momentaneo') {
			const activo = operacion === 'presionar' ? true
				: operacion === 'soltar' ? false : !siguiente.activo;
			const cambio = siguiente.activo !== activo;
			siguiente.activo = activo;
			delete siguiente.posicion;
			return { atendido: true, cambio, estado: siguiente };
		}
		if (operacion !== 'accionar') return { atendido: false, cambio: false, estado: siguiente };
		const actual = Number.isInteger(siguiente.posicion) && siguiente.posicion! >= 0
			&& siguiente.posicion! < control.posiciones ? siguiente.posicion! : control.reposo;
		siguiente.posicion = (actual + 1) % control.posiciones;
		delete siguiente.activo;
		return { atendido: true, cambio: true, estado: siguiente };
	}

	if (control.clase === 'sensor') {
		if (operacion !== 'accionar') return { atendido: false, cambio: false, estado: siguiente };
		if (control.analogico) return { atendido: true, cambio: false, estado: siguiente };
		siguiente.activo = !siguiente.activo;
		return { atendido: true, cambio: true, estado: siguiente };
	}

	if (operacion !== 'accionar') return { atendido: false, cambio: false, estado: siguiente };
	if (control.clase === 'seccionador') {
		siguiente.cerrado = siguiente.cerrado === false;
		// Un seccionador no tiene mecanismo de disparo. Se elimina cualquier residuo heredado en vez
		// de convertir el siguiente clic en un supuesto rearme.
		delete siguiente.disparado;
		return { atendido: true, cambio: true, estado: siguiente };
	}
	if (siguiente.disparado) {
		if (!control.rearmable) {
			if (control.funcion !== 'fusible') return { atendido: true, cambio: false, estado: siguiente };
			delete siguiente.disparado;
			siguiente.cerrado = true;
			siguiente.reemplazoFusibleSolicitado = true;
			return { atendido: true, cambio: true, estado: siguiente };
		}
		siguiente.disparado = false;
		siguiente.cerrado = true;
		siguiente.rearmeSolicitado = true;
		return { atendido: true, cambio: true, estado: siguiente };
	}
	if (control.termico) {
		siguiente.disparado = true;
		return { atendido: true, cambio: true, estado: siguiente };
	}
	siguiente.cerrado = siguiente.cerrado === false;
	return { atendido: true, cambio: true, estado: siguiente };
}

/**
 * ¿ESTE APARATO SE PUEDE ACCIONAR?
 *
 * Tiene que decir exactamente lo mismo que `accionarEnSimulacion`, porque de aquí sale la lista de
 * mandos que se le enseña al usuario: si dijera de más, saldría un botón que no hace nada; si
 * dijera de menos, faltaría el botón que hace falta para arrancar el tablero. Las dos leen la
 * misma clasificación por perfil y las mismas transiciones puras para no poder separarse.
 *
 * Una sonda CON RANGO no entra: su mando no es un botón sino el deslizador de «Sondas».
 */
function esMando(d: Dispositivo): boolean {
	const control = controlDeSimulacion(d);
	return !!control && !(control.clase === 'sensor' && control.analogico);
}

/** Cómo se lee y cómo se rotula el botón de un mando, según cómo esté ahora. */
export function estadoDelMando(
	d: Dispositivo,
	st: EstadoAparato,
): { texto: string; boton: string; encendido: boolean; deshabilitado?: boolean } {
	const control = controlDeSimulacion(d);
	if (!control) return { texto: 'sin control', boton: 'No disponible', encendido: false, deshabilitado: true };
	if (control.clase === 'mando' && control.modo === 'mantenido') {
		const posicion = Number.isInteger(st.posicion) && st.posicion! >= 0
			&& st.posicion! < control.posiciones ? st.posicion! : control.reposo;
		return {
			texto: `posición ${posicion + 1}/${control.posiciones}`,
			boton: 'Cambiar',
			encendido: posicion !== control.reposo,
		};
	}
	if (control.clase === 'mando' || control.clase === 'sensor') {
		const activo = !!st.activo;
		return { texto: activo ? 'accionado' : 'en reposo', boton: activo ? 'Soltar' : 'Accionar', encendido: activo };
	}
	if (control.clase === 'seccionador') {
		const abierto = st.cerrado === false;
		return { texto: abierto ? 'abierto' : 'cerrado', boton: abierto ? 'Cerrar' : 'Abrir', encendido: abierto };
	}
	if (st.disparado && !control.rearmable) {
		return { texto: 'FUNDIDO · requiere sustitución', boton: 'Reemplazar fusible', encendido: true };
	}
	if (st.disparado) return { texto: 'DISPARADO', boton: 'Rearmar', encendido: true };
	if (control.termico) {
		return { texto: 'rearmado', boton: 'Disparar', encendido: false };
	}
	const abierto = st.cerrado === false;
	return { texto: abierto ? 'abierto' : 'cerrado', boton: abierto ? 'Cerrar' : 'Abrir', encendido: abierto };
}

export function instalarSimulacion(ctx: ContextoSimulacion): PanelSimulacion {
	const proyecto = ctx.proyecto;
	const seleccionar = ctx.seleccionar;

	/**
	 * Dar tensión al tablero y verlo funcionar. Es la petición literal de quien lo probó: «no sé cómo
	 * dar play para energizar y ver los circuitos funcionando».
	 *
	 * `estadoSim` guarda la posición de cada mando (pulsado, abierto, disparado) y `activosPrevios` la
	 * MEMORIA del circuito: qué bobinas estaban metidas. Esa memoria es la que hace que un
	 * enclavamiento se sostenga al soltar el pulsador de marcha en vez de caerse.
	 */
	let energizado = false;
	const seleccionInstrumentos: SeleccionInstrumentosFisica = {};
	let estadoSim: EstadoTablero = {};
	let activosPrevios = new Set<string>();
	let ultimaSim: ResultadoSimulacion | undefined;

	/*
	 * EL RELOJ DEL TABLERO.
	 *
	 * Mientras está energizado corre un reloj y la simulación se rehace cinco veces por segundo. No
	 * es un adorno: sin reloj no hay temporizadores —y sin temporizadores no hay estrella-triángulo
	 * ni arranque escalonado de una UMA, que son la mitad de los tableros que se montan—. También es
	 * lo que permite que una protección dispare DESPUÉS de un rato, como dispara de verdad, en vez de
	 * saltar en el mismo instante en que se cierra el circuito.
	 */
	let relojSim: { ahora: number; memoria: MemoriaTiempos; logica: MemoriaLogica } | undefined;
	let tickSim: number | undefined;
	/** Cuándo se atendió el reloj por última vez, para saber cuánto ha pasado DE VERDAD. */
	let ultimoTic = 0;
	/** Cuántas veces más rápido corre el reloj de la maniobra que el de la pared. */
	let velocidadSim = 1;
	/**
	 * El panel se repinta al presionar y reemplaza el propio botón que recibió `pointerdown`.
	 * Por eso el final del gesto vive temporalmente en `window`, no en el nodo efímero. Cada gesto
	 * retira sus dos listeners al terminar; reinstalar el panel no acumula observadores globales.
	 */
	const gestosPorPuntero = new Map<number, { id: string; iniciadoEn: number; limpiar: () => void }>();
	const liberacionesPendientes = new Set<number>();
	const clickConsumido = new Set<string>();
	const finalizarPuntero = (ev: PointerEvent) => {
		const gesto = gestosPorPuntero.get(ev.pointerId);
		if (!gesto) return;
		gesto.limpiar();
		const id = gesto.id;
		clickConsumido.add(id);
		const restante = Math.max(0, DURACION_PULSO_SINTETICO_MS - (performance.now() - gesto.iniciadoEn));
		const temporizador = window.setTimeout(() => {
			liberacionesPendientes.delete(temporizador);
			if (energizado) soltarEnSimulacion(id);
		}, restante);
		liberacionesPendientes.add(temporizador);
		// El `click` se despacha después de `pointerup`; una microtarea puede ejecutarse antes. El
		// siguiente macrotask es el primer punto seguro para volver a admitir clicks sintéticos.
		window.setTimeout(() => clickConsumido.delete(id), 0);
	};
	const iniciarPuntero = (pointerId: number, id: string) => {
		gestosPorPuntero.get(pointerId)?.limpiar();
		const alFinalizar = (ev: PointerEvent) => {
			if (ev.pointerId === pointerId) finalizarPuntero(ev);
		};
		const limpiar = () => {
			window.removeEventListener('pointerup', alFinalizar, true);
			window.removeEventListener('pointercancel', alFinalizar, true);
			gestosPorPuntero.delete(pointerId);
		};
		gestosPorPuntero.set(pointerId, { id, iniciadoEn: performance.now(), limpiar });
		window.addEventListener('pointerup', alFinalizar, true);
		window.addEventListener('pointercancel', alFinalizar, true);
	};
	const limpiarGestos = () => {
		for (const gesto of [...gestosPorPuntero.values()]) gesto.limpiar();
		for (const temporizador of liberacionesPendientes) window.clearTimeout(temporizador);
		liberacionesPendientes.clear();
		clickConsumido.clear();
	};

	function recalcularSimulacion(): void {
		if (!energizado) return;
		if (!relojSim) relojSim = { ahora: 0, memoria: memoriaVacia(), logica: memoriaLogicaVacia() };
		ultimaSim = simular(proyecto(), estadoSim, activosPrevios, relojSim);
		activosPrevios = ultimaSim.activos;
		/* Pulsos consumidos por este scan; modo, pausa y fuerzas sí permanecen en la sesión. */
		for (const [id, st] of Object.entries(estadoSim)) if (st.plc) {
			const { paso: _paso, reiniciar: _reiniciar, ackAlarmas: _ack, resetAlarmas: _reset, ...persistentes } = st.plc;
			estadoSim[id] = { ...st, plc: persistentes };
		}
		aplicarDisparos();
		pintarSimulacion();
	}

	function ordenarPLC(id: string, cambios: Partial<OrdenesRuntimePLC>): void {
		const previo = estadoSim[id] ?? {};
		estadoSim[id] = { ...previo, plc: { ...(previo.plc ?? {}), ...cambios } };
		recalcularSimulacion();
	}

	function cambiarFuerzaPLC(id: string, clase: ClaseIOPLC, borne: string, valor: boolean | number | undefined): void {
		const previo = estadoSim[id] ?? {};
		const fuerzas: FuerzasPLC = structuredClone(previo.plc?.fuerzas ?? {});
		const grupo = { ...(fuerzas[clase] ?? {}) } as Record<string, boolean | number>;
		if (valor === undefined) delete grupo[borne]; else grupo[borne] = valor;
		if (Object.keys(grupo).length) (fuerzas as Record<string, unknown>)[clase] = grupo;
		else delete (fuerzas as Record<string, unknown>)[clase];
		ordenarPLC(id, { fuerzas });
	}

	/**
	 * Hace saltar las protecciones que llevan disparadas el tiempo que dice su curva.
	 *
	 * Un cortocircuito corta al instante; una sobrecarga tarda, y ese tiempo se cronometra con el
	 * reloj de la simulación. Así se ve lo que pasa de verdad: el motor arranca, el automático
	 * aguanta unos segundos y luego salta, en vez de no dejarlo arrancar nunca.
	 */
	function aplicarDisparos(): void {
		if (!ultimaSim || !relojSim) return;
		const actualizado = actualizarProteccionesRuntime(
			proyecto(), estadoSim, ultimaSim, relojSim.ahora, relojSim.memoria,
		);
		estadoSim = actualizado.estado;
		for (const evento of actualizado.eventos) {
			avisar(`⚡ ${evento.designacion}: ${evento.estado.toUpperCase()} por ${evento.causa} `
				+ `(${evento.origen}).`, 'error');
		}
		if (!actualizado.cambio) return;
		// Un disparo/reemplazo cambia la topología; se resuelve inmediatamente con el nuevo estado.
		const fallasAntesDelDisparo = ultimaSim.fisica.fallas;
		const selectividadAntesDelDisparo = ultimaSim.fisica.selectividad;
		ultimaSim = simular(proyecto(), estadoSim, activosPrevios, relojSim);
		activosPrevios = ultimaSim.activos;
		/* La red posterior debe mostrar corriente cero, pero el analisis prospectivo que provoco el
		 * disparo sigue siendo evidencia del evento. Se conserva marcado como despejado durante el
		 * mismo ensayo para que la UI pueda explicar Icc, curva y coordinacion despues de abrir Q. */
		ultimaSim.fisica.fallas = fallasAntesDelDisparo.map((f) => ({ ...f, despejada: true }));
		ultimaSim.fisica.selectividad = selectividadAntesDelDisparo;
	}

	/** Arranca o para el reloj según esté el tablero energizado. */
	function ajustarRelojSim(): void {
		if (tickSim !== undefined) { clearInterval(tickSim); tickSim = undefined; }
		$('sim-transcurrido').textContent = '0,0 s';
		if (!energizado) { relojSim = undefined; return; }
		relojSim = { ahora: 0, memoria: memoriaVacia(), logica: memoriaLogicaVacia() };
		ultimoTic = performance.now();
		tickSim = window.setInterval(() => {
			if (!energizado || !relojSim) return;
			/*
			 * El reloj puede correr más deprisa que el de la pared.
			 *
			 * Un retardo de ocho segundos se espera ocho segundos de verdad, y eso está bien la primera
			 * vez —es lo que hace creíble la maniobra—, pero es un castigo cuando hay que probar la
			 * misma secuencia diez veces cambiando un renglón del programa. Con ×20 la UMA entera
			 * arranca en menos de un segundo, y lo que se ve es exactamente lo mismo.
			 */
			/*
			 * EL RELOJ AVANZA LO QUE HA PASADO DE VERDAD, no un tramo fijo por vuelta.
			 *
			 * Antes sumaba 200 ms en cada llamada, dando por hecho que las llamadas caen cada 200 ms
			 * clavadas. No es cierto: `setInterval` se retrasa cuando la página está ocupada y luego
			 * suelta las llamadas atrasadas de golpe, así que el reloj de la maniobra iba unas veces
			 * lento y otras a saltos, según lo que estuviera costando dibujar el panel en ese momento.
			 * Un retardo de 8 s a ×20 podía tardar medio segundo o tres.
			 *
			 * Se vio al añadir la lista de mandos: pintar unas filas más por vuelta bastó para mover
			 * el reloj lo suficiente como para que una prueba de la UMA cambiara de resultado. La
			 * prueba estaba mal, pero el reloj también: midiendo el tiempo REAL, lo que se ve deja de
			 * depender de cuánto trabajo tenga el navegador encima.
			 */
			const ahoraReal = performance.now();
			const transcurrido = Math.min(ahoraReal - ultimoTic, 2000);   // tope: volver de otra pestaña
			ultimoTic = ahoraReal;
			relojSim.ahora += transcurrido * velocidadSim;
			const seg = relojSim.ahora / 1000;
			$('sim-transcurrido').textContent = `${seg.toFixed(1).replace('.', ',')} s`;
			// Solo se rehace si hay algo que dependa del tiempo; si no, es gastar por gastar.
			// Un controlador con retardos o tiempos mínimos también depende del reloj: si no se
			// rehiciera, su cuenta atrás se quedaría clavada y la maniobra nunca avanzaría.
			const hayTiempo = requiereAvanceTemporal(proyecto(), ultimaSim, {});
			if (hayTiempo) recalcularSimulacion();
		}, 200);
	}

	/**
	 * Enciende los cables que están vivos.
	 *
	 * QUIÉN PINTA QUÉ, que es lo que estaba mal. Los APARATOS los anima `animarSimulacion`, pieza a
	 * pieza: la armadura del contactor baja, la palanca sube, la mirilla pasa a rojo, el piloto se
	 * enciende con SU color. Aquí se pintaban además TODAS las mallas de cada aparato activo con un
	 * ámbar plano, encima de aquello. El resultado era que un contactor metido se veía como un
	 * objeto distinto —carcasa amarilla incluida— en vez de como un contactor con la bobina
	 * excitada, y el plástico negro salía amarillo. Solo debe encenderse lo que en el aparato de
	 * verdad comunica estado, así que ese barrido se ha quitado: ya había quien lo hacía bien.
	 *
	 * De los cables se enciende SOLO el tubo visible. Del cable cuelgan también el tubo grueso de
	 * agarre (invisible) y las punteras de las dos puntas, y una puntera de plástico encendida no es
	 * un cable con tensión.
	 */
	function pintarSimulacion(): void {
		const r = ultimaSim;
		ctx.escenario().cables.traverse((o) => {
			if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
			if (!o.userData.tuboVisible) return;
			const id = o.userData.conductorId as string | undefined;
			if (!id) return;
			if (!(energizado && r?.conductoresVivos.has(id))) {
				o.material.emissive.setHex(0x000000);
				o.material.emissiveIntensity = 0;
				return;
			}
			// El color con el que se enciende sale del PROPIO conductor. Esto deja el valor de
			// partida; quién lo modula según la corriente es `animarSimulacion`, con la misma cuenta.
			o.material.emissiveIntensity = 0.3 * emisionDeCable(o.material, o);
		});
		pintarPanelSimulacion();
	}

	/** Proyecta V5 y enlaza sus controles sin alargar el renderer historico de PLC/mandos. */
	function pintarPanelFisica(r: ResultadoSimulacion): void {
		const panel = $('sim-fisica');
		const contextoAnalisis = { diagnostico: r.diagnosticoIndustrial, estadosProteccion: r.protecciones };
		panel.innerHTML = htmlFisicaV5(proyecto(), r.fisica, estadoSim, seleccionInstrumentos, contextoAnalisis);
		actualizarInstrumentosFisica(panel, r.fisica);
		actualizarAnalisisFisica(panel, proyecto(), r.fisica, contextoAnalisis);
		const selectoresInstrumento: [string, keyof SeleccionInstrumentosFisica][] = [
			['[data-instrumento-nodo-a]', 'nodoA'], ['[data-instrumento-nodo-b]', 'nodoB'],
			['[data-instrumento-modo]', 'modoTension'], ['[data-instrumento-conductor]', 'conductorId'],
			['[data-instrumento-sistema]', 'sistemaId'], ['[data-instrumento-carga]', 'cargaId'],
			['[data-analisis-equipo]', 'equipoAnalisisId'],
		];
		for (const [selector, campo] of selectoresInstrumento) {
			const el = panel.querySelector<HTMLSelectElement>(selector); if (!el) continue;
			el.onchange = () => {
				seleccionInstrumentos[campo] = el.value as never;
				actualizarInstrumentosFisica(panel, r.fisica);
				actualizarAnalisisFisica(panel, proyecto(), r.fisica, contextoAnalisis);
			};
		}
		const ejecutarAnalisis = panel.querySelector<HTMLButtonElement>('[data-analisis-ejecutar]');
		if (ejecutarAnalisis) ejecutarAnalisis.onclick = () => actualizarAnalisisFisica(panel, proyecto(), r.fisica, contextoAnalisis);
		for (const el of panel.querySelectorAll<HTMLElement>('[data-fisica-dispositivo]')) {
			el.onclick = (ev) => {
				if ((ev.target as HTMLElement).closest('button,input,label')) return;
				seleccionar(el.dataset.fisicaDispositivo);
			};
		}
		for (const el of panel.querySelectorAll<HTMLButtonElement>('[data-fisica-seleccionar-cable]')) {
			el.onclick = () => ctx.seleccionarCable?.(el.dataset.fisicaSeleccionarCable!);
		}
		const ajustarCable = (id: string, campo: 'longitudM' | 'seccionMm2', valor: number) => {
			if (!(Number.isFinite(valor) && valor > 0)) return;
			const clave = `@fisica:${id}`;
			estadoSim[clave] = { ...(estadoSim[clave] ?? {}), ajustesFisicos: {
				...(estadoSim[clave]?.ajustesFisicos ?? {}), [campo]: valor,
			} };
			recalcularSimulacion();
		};
		for (const el of panel.querySelectorAll<HTMLInputElement>('[data-fisica-longitud]')) {
			el.onchange = () => ajustarCable(el.dataset.fisicaLongitud!, 'longitudM', Number(el.value));
		}
		for (const el of panel.querySelectorAll<HTMLInputElement>('[data-fisica-seccion]')) {
			el.onchange = () => ajustarCable(el.dataset.fisicaSeccion!, 'seccionMm2', Number(el.value));
		}
		for (const el of panel.querySelectorAll<HTMLInputElement>('[data-fisica-burden]')) {
			el.onchange = () => {
				const valor = Number(el.value); if (!(Number.isFinite(valor) && valor >= 0)) return;
				const id = el.dataset.fisicaBurden!; const clave = `@fisica:analog:${id}`;
				estadoSim[clave] = { ...(estadoSim[clave] ?? {}), ajustesAnalogicos: { burdenOhm: valor } };
				recalcularSimulacion();
			};
		}
		for (const el of panel.querySelectorAll<HTMLButtonElement>('[data-fisica-falla-id]')) {
			el.onclick = () => {
				const clave = '@fisica:fallas'; const id = el.dataset.fisicaFallaId!;
				const actuales = [...(estadoSim[clave]?.fallasFisicas ?? [])];
				const indice = actuales.findIndex((f) => f.id === id);
				if (indice >= 0) actuales.splice(indice, 1);
				else {
					const falla: FallaFisicaRuntime = { id, tipo: el.dataset.fisicaFallaTipo as FallaFisicaRuntime['tipo'] };
					if (el.dataset.fisicaNodoA) falla.nodoA = el.dataset.fisicaNodoA;
					if (el.dataset.fisicaNodoB) falla.nodoB = el.dataset.fisicaNodoB;
					if (el.dataset.fisicaRama) falla.ramaId = el.dataset.fisicaRama;
					if (el.dataset.fisicaResistencia) falla.resistenciaAdicionalOhm = Number(el.dataset.fisicaResistencia);
					actuales.push(falla);
				}
				estadoSim[clave] = { ...(estadoSim[clave] ?? {}), fallasFisicas: actuales };
				recalcularSimulacion();
				avisar(indice >= 0 ? `Falla física ${id} retirada.` : `Falla física ${id} inyectada para simulación.`,
					indice >= 0 ? 'info' : 'error');
			};
		}
	}

	function pintarPanelSimulacion(): void {
		const cont = $('sim-funcionando');
		const avisos = $('sim-avisos');
		const r = ultimaSim;
		const panelesPLCAbiertos = new Set([...$('sim-controladores')
			.querySelectorAll<HTMLDetailsElement>('details[open][data-plc-panel]')]
			.map((detalle) => `${detalle.closest<HTMLElement>('[data-id]')?.dataset.id ?? ''}:${detalle.dataset.plcPanel}`));
		cont.innerHTML = '';
		avisos.innerHTML = '';
		$('sim-consumo').innerHTML = '';
		$('sim-carga').innerHTML = '';
		$('sim-fallos').innerHTML = '';
		$('sim-referencias-vfd').innerHTML = '';
		$('sim-sondas').innerHTML = '';
		$('sim-controladores').innerHTML = '';
		$('sim-fisica').innerHTML = '';
		if (!r) return;

		/* Longitud/seccion de ensayo y fallas viven en runtime: no mutan el Proyecto de ejemplo. */
		pintarPanelFisica(r);

		/*
		 * LOS MANDOS: la botonera de la maniobra.
		 *
		 * Esto lo destapó una pregunta de Diego: «¿por qué al energizar no pasa nada y sale "nada
		 * está funcionando todavía", incluso en los tableros de ejemplo?».
		 *
		 * La primera mitad de la respuesta es que ESO ES LO CORRECTO: energizar da tensión, no
		 * arranca nada, igual que subir el automático de un tablero de verdad no pone el motor en
		 * marcha. Hace falta apretar MARCHA.
		 *
		 * La segunda mitad era un fallo de verdad. En el arranque directo y en el estrella-triángulo
		 * los únicos aparatos que arrancan el circuito son `-S0` y `-S1`, y en la bomba es la boya
		 * `-B1`. Los tres son aparatos DE CAMPO: van en la puerta o fuera del armario, así que están
		 * bien modelados eléctricamente pero NO TIENEN CUERPO en el 3D. El aviso decía «pulsa un
		 * pulsador de marcha» y no había ningún pulsador que pinchar: el tablero se quedaba
		 * energizado y muerto, sin manera de hacer nada. Tres de los cinco ejemplos no se podían
		 * probar, que es justo para lo que están.
		 *
		 * Así que todo lo que se puede accionar sale aquí con su botón, esté montado en el riel o
		 * no. Los que no están dentro del armario se marcan, porque saber que un pulsador va en la
		 * puerta es parte de lo que enseña el ejemplo.
		 */
		const dentroDelArmario = new Set(
			(proyecto().gabinete?.colocaciones ?? []).map((c) => c.dispositivoId));
		const mandos = proyecto().dispositivos.filter((d) => esMando(d));
		if (mandos.length) {
			// El reloj repinta este bloque. Si reemplaza el botón que tenía foco, Enter llega al
			// documento y no al mando: para teclado el panel queda inoperable. Se conserva la identidad
			// semántica y se enfoca su nuevo nodo después de reconstruirlo.
			const mandoEnFoco = (document.activeElement as HTMLElement | null)
				?.closest<HTMLElement>('[data-mando]')?.dataset.mando;
			$('sim-mandos').innerHTML = '<h3 class="titulo-sim">Mandos</h3>' + mandos.map((d) => {
				const st = estadoSim[d.id] ?? {};
				const { texto, boton, encendido, deshabilitado } = estadoDelMando(d, st);
				const fuera = dentroDelArmario.has(d.id) ? ''
					: '<span class="fuera" title="No está montado en el armario: va en la puerta o en '
						+ 'campo, así que solo se acciona desde aquí">· en la puerta</span>';
				return `<div class="fila-mando ${encendido ? 'activo' : ''}">`
					+ `<span class="des-sim">${escaparHtml(d.designacion ?? d.id)}</span>`
					+ `<span class="estado-mando">${escaparHtml(texto)}</span>${fuera}`
					+ `<button data-mando="${escaparHtml(d.id)}"${deshabilitado ? ' disabled' : ''}>`
					+ `${escaparHtml(boton)}</button></div>`;
			}).join('');
			for (const el of $('sim-mandos').querySelectorAll<HTMLElement>('[data-mando]')) {
				const id = el.dataset.mando!;
				const dispositivo = proyecto().dispositivos.find((d) => d.id === id);
				const control = dispositivo ? controlDeSimulacion(dispositivo) : undefined;
				if (control?.clase === 'mando' && control.modo === 'momentaneo') {
					el.onpointerdown = (ev) => {
						if (ev.button !== 0) return;
						iniciarPuntero(ev.pointerId, id);
						presionarEnSimulacion(id);
					};
					el.onkeydown = (ev) => {
						if (ev.repeat || (ev.key !== 'Enter' && ev.key !== ' ')) return;
						// El repintado reemplaza este botón durante keydown, así que no se puede esperar
						// su keyup. Se consume el click nativo y se ejecuta un pulso completo con liberación segura.
						ev.preventDefault();
						pulsarSintetico(id);
					};
					el.onclick = (ev) => {
						if (clickConsumido.has(id)) ev.preventDefault();
						else if (pulsarSintetico(id)) {
							// Enter/Espacio y `.click()` no tienen un intervalo pointerdown→pointerup. Se
							// representan como un pulso completo, nunca como un toggle que deje pegado el mando.
						}
					};
				} else {
					el.onclick = () => { accionarEnSimulacion(id); };
				}
			}
			if (mandoEnFoco) {
				$('sim-mandos').querySelector<HTMLElement>(`[data-mando="${CSS.escape(mandoEnFoco)}"]`)
					?.focus({ preventScroll: true });
			}
		}

		/* Fallos de ensayo visibles: la misma transición pública que usan las regresiones rápidas. */
		const conFallos = proyecto().dispositivos
			.map((d) => ({ d, opciones: fallosCompatibles(d) }))
			.filter((x) => x.opciones.length > 0);
		if (conFallos.length) {
			$('sim-fallos').innerHTML = '<h3 class="titulo-sim">Fallas de ensayo</h3>'
				+ conFallos.map(({ d, opciones }) => {
					const actual = opciones.find((f) => estadoSim[d.id]?.fallos?.includes(f)) ?? '';
					return `<label class="fila-sonda fila-fallo"><span class="des-sim">${escaparHtml(d.designacion ?? d.id)}</span>`
						+ `<select data-fallo="${escaparHtml(d.id)}"><option value="">Sin fallo</option>`
						+ opciones.map((f) => `<option value="${f}"${actual === f ? ' selected' : ''}>`
							+ `${escaparHtml(ETIQUETA_FALLO_RUNTIME[f])}</option>`).join('')
						+ '</select></label>';
				}).join('');
			for (const el of $('sim-fallos').querySelectorAll<HTMLSelectElement>('[data-fallo]')) {
				el.onchange = () => {
					const id = el.dataset.fallo!;
					const d = proyecto().dispositivos.find((x) => x.id === id);
					if (!d) return;
					let st = { ...(estadoSim[id] ?? {}) };
					for (const f of fallosCompatibles(d)) st = cambiarFalloRuntime(st, f, false);
					if (el.value) st = cambiarFalloRuntime(st, el.value as Parameters<typeof cambiarFalloRuntime>[1], true);
					estadoSim[id] = st;
					recalcularSimulacion();
					avisar(el.value ? `${d.designacion ?? id}: ${ETIQUETA_FALLO_RUNTIME[el.value as keyof typeof ETIQUETA_FALLO_RUNTIME]} (inyectado).`
						: `${d.designacion ?? id}: fallo de ensayo retirado.`, el.value ? 'error' : 'info');
				};
			}
		}

		/* Referencia VFD operable: escribe únicamente runtime, en la unidad declarada por el perfil. */
		const mandosVfd = proyecto().dispositivos.flatMap((d) => {
			const perfil = resolverComportamiento(d);
			if (perfil?.clase !== 'variador') return [];
			const actual = r.variadores.find((v) => v.dispositivoId === d.id)?.referenciaPorcentaje ?? 0;
			return [{ d, perfil, actual }];
		});
		if (mandosVfd.length) {
			$('sim-referencias-vfd').innerHTML = '<h3 class="titulo-sim">Referencia de variadores</h3>'
				+ mandosVfd.map(({ d, perfil, actual }) => {
					const hz = perfil.frecuencia.minimaHz
						+ (perfil.frecuencia.maximaHz - perfil.frecuencia.minimaHz) * actual / 100;
					return `<label class="fila-sonda fila-referencia-vfd"><span class="des-sim">${escaparHtml(d.designacion ?? d.id)}</span>`
						+ `<input type="range" min="0" max="100" step="1" value="${actual}" data-ref-vfd="${escaparHtml(d.id)}">`
						+ `<span class="valor-sonda">${actual.toFixed(0)} % · ${hz.toFixed(1)} Hz</span></label>`;
				}).join('');
			for (const el of $('sim-referencias-vfd').querySelectorAll<HTMLInputElement>('[data-ref-vfd]')) {
				el.oninput = () => {
					const id = el.dataset.refVfd!;
					const d = proyecto().dispositivos.find((x) => x.id === id);
					const perfil = d ? resolverComportamiento(d) : undefined;
					if (perfil?.clase !== 'variador') return;
					const pct = Number(el.value);
					const [min, max] = perfil.referencia.rango;
					estadoSim[id] = { ...(estadoSim[id] ?? {}), valor: min + (max - min) * pct / 100 };
					recalcularSimulacion();
				};
			}
		}

		/*
		 * LAS SONDAS. Un controlador que decide por temperatura necesita una temperatura, y esa la
		 * pone quien simula: aquí está el mando. Sin esto el programa nunca cumpliría un «UI1 < 21» y
		 * parecería que la lógica no funciona, cuando lo que falta es el número.
		 */
		const cableado = (d: Dispositivo) =>
			proyecto().conductores.some((c) => c.de.dispositivoId === d.id || c.a.dispositivoId === d.id);
		const posiblesSondas = proyecto().dispositivos.filter((d) =>
			resolverComportamiento(d)?.clase === 'sensor' && !esReferenciaVisualInerte(d) && cableado(d));
		/*
		 * Una SONDA es la que declara su rango de medida; lo demás son contactos de campo —un
		 * presostato, una boya, un final de carrera— que se accionan con su interruptor, no con un
		 * mando de temperatura. Si nadie declara rango, se toman todos como sondas: es lo que hacía
		 * antes, y así los proyectos viejos siguen teniendo su mando.
		 */
		const conRango = posiblesSondas.filter((d) => {
			const perfil = resolverComportamiento(d);
			return d.rangoSonda || perfil?.clase === 'sensor' && !!perfil.transmisor;
		});
		const hayControladorV4 = proyecto().dispositivos.some((d) => d.programaPLC?.lenguaje === 'tablerostudio-plc-v4');
		const sondas = conRango.length ? conRango : hayControladorV4 ? [] : posiblesSondas;
		if (sondas.length) {
			$('sim-sondas').innerHTML = '<h3 class="titulo-sim">Sondas</h3>' + sondas.map((d) => {
				const perfil = resolverComportamiento(d);
				const transmisor = perfil?.clase === 'sensor' ? perfil.transmisor : undefined;
				const [min, max] = transmisor
					? [transmisor.variable.minimo, transmisor.variable.maximo] : d.rangoSonda ?? [-10, 60];
				const paso = (max - min) > 200 ? 5 : (max - min) > 20 ? 0.5 : 0.1;
				const v = estadoSim[d.id]?.valor ?? Math.round((min + max) / 2);
				const unidadTexto = transmisor?.variable.unidad ?? d.unidadSonda ?? '';
				const unidad = unidadTexto ? ` ${unidadTexto}` : '';
				const resultadoSensor = r.sensoresAnalogicos.find((s) => s.dispositivoId === d.id);
				const salida = resultadoSensor?.senal.valorElectrico === undefined ? 'sin señal'
					: `${resultadoSensor.senal.valorElectrico.toFixed(2)} ${resultadoSensor.senal.unidadElectrica}`;
				const calidad = resultadoSensor?.senal.calidad ?? 'legacy';
				return `<label class="fila-sonda" title="${escaparHtml(d.descripcion ?? '')}">`
					+ `<span class="des-sim">${escaparHtml(d.designacion ?? d.id)}</span>`
					+ `<input type="range" min="${min}" max="${max}" step="${paso}" value="${v}" `
					+ `data-sonda="${escaparHtml(d.id)}" data-unidad="${escaparHtml(unidad)}">`
					+ `<span class="valor-sonda">${v}${escaparHtml(unidad)}</span>`
					+ `<small class="detalle-senal">${escaparHtml(salida)} · ${escaparHtml(calidad.toUpperCase().replaceAll('-', ' '))}</small></label>`;
			}).join('');
			for (const el of $('sim-sondas').querySelectorAll<HTMLInputElement>('[data-sonda]')) {
				el.oninput = () => {
					const id = el.dataset.sonda!;
					estadoSim[id] = { ...estadoSim[id], valor: Number(el.value) };
					(el.parentElement!.querySelector('.valor-sonda') as HTMLElement).textContent =
						el.value + (el.dataset.unidad ?? '');
					recalcularSimulacion();
				};
			}
		}

		/* LO QUE ESTÁ HACIENDO CADA CONTROLADOR: lo que lee, lo que enciende y lo que espera. */
		if (r.controladores.length) {
			$('sim-controladores').innerHTML = '<h3 class="titulo-sim">Controladores</h3>'
				+ r.controladores.map((c) => {
					const pin = (t: string, clase = '') => `<span class="pin ${clase}">${escaparHtml(t)}</span>`;
					const esperando = new Set(c.esperas.map((e) => e.salida));
					const aiV3 = new Set(c.entradasAnalogicas.map((ai) => ai.borne));
					const sondasTxt = Object.entries(c.sondas).filter(([b]) => !aiV3.has(b))
						.map(([b, v]) => pin(`${b}=${v}`, 'on')).join('')
						+ c.entradasAnalogicas.map((ai) => {
							const bruto = ai.senal.valorElectrico === undefined ? '—'
								: `${ai.senal.valorElectrico.toFixed(2)} ${ai.senal.unidadElectrica}`;
							const valor = ai.valorIngenieria === undefined ? 'sin valor'
								: `${ai.valorIngenieria.toFixed(1)} ${ai.unidad}`;
							return pin(`${ai.borne}: ${bruto} → ${valor} · ${ai.senal.calidad.toUpperCase().replaceAll('-', ' ')}`,
								ai.senal.calidad === 'normal' ? 'on' : 'fallo');
						}).join('');
					const entradas = c.entradas.filter((e) => /^(DI|UI|AI)\d/.test(e)).map((e) => pin(e, 'on')).join('');
					const salidas = c.salidas.map((sx) => pin(sx, esperando.has(sx) ? 'esperando' : 'on')).join('');
					const cuentas = c.esperas.map((e) =>
						`<div class="pista">⏳ ${escaparHtml(e.salida)}: ${e.restan.toFixed(1)} s de ${e.total} s `
						+ `(${e.motivo === 'retardo' ? 'retardo' : 'tiempo mínimo'})</div>`).join('');
					/*
					 * EL PROGRAMA, RENGLÓN A RENGLÓN Y EN MARCHA.
					 *
					 * Es la respuesta a la única pregunta que se hace delante de un tablero que no
					 * arranca: «¿por qué no entra DO1?». El ● verde dice que la condición se cumple; si
					 * está verde y la salida sigue apagada, la culpa es de un tiempo, y ahí abajo está
					 * la cuenta atrás diciendo cuánto falta.
					 */
					const renglones = c.renglones.map((rg) => {
						const estado = rg.encendida ? 'on' : rg.pide ? 'pidiendo' : '';
						const porque = rg.encendida ? 'encendida'
							: rg.pide ? 'la condición se cumple, pero la salida aún no está dada (mira el tiempo)'
								: 'la condición no se cumple';
						return `<div class="renglon-sim ${estado}" title="${escaparHtml(porque)}">`
							+ `<span class="luz"></span><code>${escaparHtml(rg.fuente)}</code></div>`;
					}).join('');
					const runtime = `<div class="plc-runtime"><b class="plc-estado ${c.estado.toLowerCase()}">${c.estado}</b>`
						+ `<span>scan ${c.scan} · ${c.periodoScanMs} ms · ${c.duracionUltimoScanMs.toFixed(2)} ms</span>`
						+ (c.pausado ? '<b class="plc-pausa">PAUSA</b>' : '') + '</div>';
					const controles = `<div class="plc-controles">`
						+ `<button data-plc-action="modo">${c.estado === 'RUN' ? '■ STOP' : '▶ RUN'}</button>`
						+ `<button data-plc-action="pausa">${c.pausado ? 'Continuar' : 'Pausar'}</button>`
						+ `<button data-plc-action="paso" ${c.pausado ? '' : 'disabled'}>1 scan</button>`
						+ '<button data-plc-action="reiniciar">Reset PLC</button></div>';
					const fuerzaDigital = (clase: 'DI' | 'DO', borne: string, activa: boolean) => {
						const valor = (estadoSim[c.dispositivoId]?.plc?.fuerzas?.[clase] as Record<string, boolean> | undefined)?.[borne];
						const marca = valor === undefined ? 'LIBRE' : valor ? 'FORZADA 1' : 'FORZADA 0';
						return `<button class="plc-fuerza ${valor === undefined ? '' : 'activa'}" data-plc-force-digital="${clase}" data-borne="${escaparHtml(borne)}">`
							+ `${clase} ${escaparHtml(borne)}: ${activa ? '1' : '0'} · ${marca}</button>`;
					};
					const fuerzaAnalogica = (clase: 'AI' | 'AO', borne: string, valorActual: number | undefined) => {
						const valor = (estadoSim[c.dispositivoId]?.plc?.fuerzas?.[clase] as Record<string, number> | undefined)?.[borne];
						return `<label class="plc-fuerza-analogica">${clase} ${escaparHtml(borne)}: ${valorActual?.toFixed(2) ?? '—'}`
							+ `<input type="number" step="0.1" placeholder="libre" value="${valor ?? ''}" data-plc-force-analog="${clase}" data-borne="${escaparHtml(borne)}"></label>`;
					};
					const fuerzas = `<details class="plc-fuerzas" data-plc-panel="fuerzas"><summary>Forzar E/S${c.forzadas.length ? ` (${c.forzadas.length})` : ''}</summary><div>`
						+ (c.forzadas.length ? '<button class="plc-quitar-fuerzas" data-plc-clear-forces>Quitar todas las fuerzas</button>' : '')
						+ c.io.DI.map((b) => fuerzaDigital('DI', b, c.entradas.includes(b))).join('')
						+ c.io.DO.map((b) => fuerzaDigital('DO', b, c.salidas.includes(b))).join('')
						+ c.io.AI.map((b) => fuerzaAnalogica('AI', b, c.sondas[b])).join('')
						+ c.io.AO.map((b) => fuerzaAnalogica('AO', b, c.salidasAnalogicas[b])).join('') + '</div></details>';
					const bloques = [
						...Object.entries(c.temporizadores).map(([id, t]) => `${id}: ${t.tipo} IN=${+t.IN} Q=${+t.Q} ET=${(t.ET / 1000).toFixed(1)} s · PT=${(t.PT / 1000).toFixed(1)} s`),
						...Object.entries(c.contadores).map(([id, ct]) => `${id}: ${ct.tipo} CV=${ct.CV} PV=${ct.PV} Q=${+ct.Q}`),
						...Object.entries(c.detalleSecuencias).map(([id, sec]) => `${id}: ${sec.actual}`
							+ `${sec.anterior ? ` · anterior ${sec.anterior}` : ''} · ${(sec.tiempoEnEstadoMs / 1000).toFixed(1)} s`
							+ `${sec.transicion ? ` · ${sec.transicion}` : ''}`),
					].map((x) => `<div class="pista plc-bloque">${escaparHtml(x)}</div>`).join('');
					const memoria = Object.entries(c.variables).filter(([nombre]) => nombre !== 'FIRST_SCAN')
						.map(([nombre, valor]) => `<div><code>${escaparHtml(nombre)}</code><b>${escaparHtml(String(valor))}</b></div>`).join('');
					const tags = c.tags.map((tag) => {
						const valor = typeof tag.valor === 'number' && Number.isNaN(tag.valor) ? '—' : String(tag.valor);
						const fisico = tag.borne && tag.borne !== tag.nombre ? ` → ${tag.clase}:${tag.borne}` : ` · ${tag.clase}`;
						const calidad = tag.calidad ? ` · ${tag.calidad.toUpperCase().replaceAll('-', ' ')}` : '';
						return `<div class="${tag.forzada ? 'forzada' : ''}"><code>${escaparHtml(tag.nombre)}</code>`
							+ `<span>${escaparHtml(fisico)}${escaparHtml(calidad)}</span><b>${escaparHtml(valor)}</b></div>`;
					}).join('');
					const pids = Object.entries(c.pids).map(([id, p]) => `<div class="pista plc-bloque">PID ${escaparHtml(id)}: `
						+ `${p.manual ? 'MANUAL' : 'AUTO'} · OUT=${p.salida.toFixed(2)} · I=${p.integral.toFixed(2)}`
						+ ` · PV ${escaparHtml(p.calidadPV.toUpperCase().replaceAll('-', ' '))}${p.saturado ? ' · SATURADO' : ''}</div>`).join('');
					const interlocks = c.interlocks.filter((x) => x.activo)
						.map((x) => `<div class="pista plc-interlock">⛔ ${escaparHtml(x.salida)}: ${escaparHtml(x.mensaje)}</div>`).join('');
					const diagnosticos = c.diagnosticos.map((x) =>
						`<div class="pista plc-interlock">⚠ ${escaparHtml(x.codigo)}: ${escaparHtml(x.mensaje)}</div>`).join('');
					const alarmas = Object.values(c.alarmas).filter((a) => a.activa).map((a) =>
						`<div class="plc-alarma ${a.severidad.toLowerCase()}"><b>${a.severidad}</b> ${escaparHtml(a.mensaje)}`
						+ `${a.origen ? `<small> · ${escaparHtml(a.origen)}</small>` : ''}`
						+ `<button data-plc-ack="${escaparHtml(a.id)}">${a.reconocida ? 'ACK ✓' : 'ACK'}</button>`
						+ (a.enclavada ? `<button data-plc-reset-alarm="${escaparHtml(a.id)}">Reset</button>` : '') + '</div>').join('');
					const eventos = c.eventos.slice(-5).reverse().map((e) =>
						`<li><time>${(e.instanteMs / 1000).toFixed(1)} s</time> ${escaparHtml(e.mensaje)}</li>`).join('');
					return `<div class="ctrl-sim" data-id="${escaparHtml(c.dispositivoId)}">`
						+ `<span class="des-sim">${escaparHtml(c.designacion)}</span> `
						+ `<span style="color:var(--texto-suave)">${c.reglas} instrucción(es)</span>${runtime}${controles}`
						+ `<div class="es">${entradas || pin('sin entradas activas')}${sondasTxt}`
						+ `<span style="color:var(--texto-suave)">→</span>${salidas || pin('sin salidas')}</div>`
						+ renglones + cuentas + bloques + pids + interlocks + diagnosticos + alarmas
						+ (tags ? `<details class="plc-watch" data-plc-panel="tags"><summary>Tags (${c.tags.length})</summary>${tags}</details>` : '')
						+ (memoria ? `<details class="plc-watch" data-plc-panel="memoria"><summary>Memoria</summary>${memoria}</details>` : '')
						+ fuerzas
						+ (eventos ? `<details class="plc-eventos" data-plc-panel="eventos"><summary>Eventos</summary><ol>${eventos}</ol></details>` : '') + '</div>';
				}).join('');
			for (const detalle of $('sim-controladores').querySelectorAll<HTMLDetailsElement>('details[data-plc-panel]')) {
				const id = detalle.closest<HTMLElement>('[data-id]')?.dataset.id ?? '';
				detalle.open = panelesPLCAbiertos.has(`${id}:${detalle.dataset.plcPanel}`);
			}
			for (const el of $('sim-controladores').querySelectorAll<HTMLElement>('[data-id]')) {
				const id = el.dataset.id!;
				el.onclick = (ev) => { if (!(ev.target as HTMLElement).closest('button,input,details,summary')) seleccionar(id); };
				for (const boton of el.querySelectorAll<HTMLButtonElement>('[data-plc-action]')) boton.onclick = (ev) => {
					ev.stopPropagation(); const c = r.controladores.find((x) => x.dispositivoId === id)!;
					if (boton.dataset.plcAction === 'modo') ordenarPLC(id,
						c.estado === 'RUN' ? { modo: 'STOP', fuerzas: {} } : { modo: 'RUN' });
					if (boton.dataset.plcAction === 'pausa') ordenarPLC(id, { pausado: !c.pausado });
					if (boton.dataset.plcAction === 'paso') ordenarPLC(id, { pausado: true, paso: true });
					if (boton.dataset.plcAction === 'reiniciar') ordenarPLC(id, { reiniciar: true, fuerzas: {} });
				};
				for (const boton of el.querySelectorAll<HTMLButtonElement>('[data-plc-clear-forces]')) boton.onclick = (ev) => {
					ev.stopPropagation(); ordenarPLC(id, { fuerzas: {} });
				};
				for (const boton of el.querySelectorAll<HTMLButtonElement>('[data-plc-force-digital]')) boton.onclick = (ev) => {
					ev.stopPropagation(); const clase = boton.dataset.plcForceDigital as 'DI' | 'DO'; const borne = boton.dataset.borne!;
					const actual = (estadoSim[id]?.plc?.fuerzas?.[clase] as Record<string, boolean> | undefined)?.[borne];
					cambiarFuerzaPLC(id, clase, borne, actual === undefined ? true : actual ? false : undefined);
				};
				for (const input of el.querySelectorAll<HTMLInputElement>('[data-plc-force-analog]')) input.onchange = (ev) => {
					ev.stopPropagation(); const clase = input.dataset.plcForceAnalog as 'AI' | 'AO';
					cambiarFuerzaPLC(id, clase, input.dataset.borne!, input.value.trim() === '' ? undefined : Number(input.value));
				};
				for (const boton of el.querySelectorAll<HTMLButtonElement>('[data-plc-ack]')) boton.onclick = (ev) => {
					ev.stopPropagation(); ordenarPLC(id, { ackAlarmas: [boton.dataset.plcAck!] });
				};
				for (const boton of el.querySelectorAll<HTMLButtonElement>('[data-plc-reset-alarm]')) boton.onclick = (ev) => {
					ev.stopPropagation(); ordenarPLC(id, { resetAlarmas: [boton.dataset.plcResetAlarm!] });
				};
			}
		}

		/*
		 * LO QUE CONSUME EL TABLERO. Antes esto solo decía qué estaba encendido, y un tablero se
		 * dimensiona con números: ahora dice cuánto pasa y por dónde. La cabecera da el total, y el
		 * detalle dice a qué porcentaje de su calibre va cada protección — que es la pregunta de
		 * verdad al montar: «¿este automático me vale o se me va a quedar corto?».
		 */
		if (r.corrienteTotal > 0) {
			$('sim-consumo').innerHTML = '<div class="total-sim">⚡ El tablero consume '
				+ `<b>${escaparHtml(formatearA(r.corrienteTotal))}</b>`
				+ (r.consumos.length > 1 ? ` en ${r.consumos.length} cargas` : '') + '</div>';
		}
		const cargas = [...r.cargaPorAparato.values()]
			.filter((c) => {
				if (!(c.corriente > 0 && c.nominal)) return false;
				const d = proyecto().dispositivos.find((x) => x.id === c.dispositivoId);
				return d ? controlDeSimulacion(d)?.clase === 'proteccion' : false;
			})
			.sort((a, b) => (b.porcentaje ?? 0) - (a.porcentaje ?? 0));
		if (cargas.length) {
			$('sim-carga').innerHTML = '<h3 class="titulo-sim">Carga de las protecciones</h3>'
				+ cargas.map((c) => {
					const pct = c.porcentaje ?? 0;
					const nivel = pct > 100 ? 'malo' : pct > 80 ? 'justo' : 'bien';
					return `<div class="fila-carga ${nivel}" data-id="${escaparHtml(c.dispositivoId)}">`
						+ `<span class="des-sim">${escaparHtml(c.designacion)}</span>`
						+ `<span class="barra-carga"><i style="width:${Math.min(100, pct)}%"></i></span>`
						+ `<span class="cifra-carga">${escaparHtml(formatearA(c.corriente))} / ${c.nominal} A · ${pct} %</span>`
						+ '</div>';
				}).join('');
			for (const fila of $('sim-carga').querySelectorAll('.fila-carga')) {
				(fila as HTMLElement).onclick = () => seleccionar((fila as HTMLElement).dataset.id!);
			}
		}
		/*
		 * LA PUNTA DE ARRANQUE. Un motor pide seis veces su nominal al arrancar, y es la causa nº 1 de
		 * «el automático salta cada vez que parte la máquina». Se enseña siempre que hay un motor
		 * girando, no solo cuando va a saltar: saber que la punta cabe también es información.
		 */
		if (r.arranques.length) {
			$('sim-carga').insertAdjacentHTML('beforeend',
				'<h3 class="titulo-sim">Punta de arranque (directo)</h3>'
				+ r.arranques.map((a) => {
					const p0 = a.protecciones[0];
					const detalle = a.saltaAlArrancar
						? `⚠️ ${escaparHtml(a.protecciones.find((x) => x.disparaEnS !== undefined && x.disparaEnS <= 3)!.designacion)} dispara antes de que arranque`
						: p0
							? `la aguanta ${escaparHtml(p0.designacion)} (${p0.calibre} A)`
							: 'sin protección delante';
					return `<div class="fila-carga ${a.saltaAlArrancar ? 'malo' : 'bien'}" `
						+ `data-id="${escaparHtml(a.dispositivoId)}">`
						+ `<span class="des-sim">${escaparHtml(a.designacion)}</span>`
						+ `<span class="cifra-carga">${escaparHtml(formatearA(a.punta))} `
						+ `(${a.veces} × ${escaparHtml(formatearA(a.nominal))}) · ${detalle}</span></div>`;
				}).join(''));
			for (const fila of $('sim-carga').querySelectorAll('.fila-carga[data-id]')) {
				(fila as HTMLElement).onclick = () => seleccionar((fila as HTMLElement).dataset.id!);
			}
		}

		// Cuentas atrás en marcha: se ve el temporizador contando, que es media gracia de tenerlo.
		for (const t of r.temporizadores.filter((x) => x.contando)) {
			const fila = document.createElement('div');
			fila.className = 'fila-sim contando';
			fila.innerHTML = `<span class="punto-sim"></span><span class="des-sim">${escaparHtml(t.designacion)}</span>`
				+ `<span class="que-sim">⏳ ${t.restan.toFixed(1)} s de ${t.total} s `
				+ `(${t.tipo === 'trabajo' ? 'a la conexión' : 'a la desconexión'})</span>`;
			fila.onclick = () => seleccionar(t.dispositivoId);
			cont.appendChild(fila);
		}
		/*
		 * Las salidas analógicas: cuánto abre la válvula, a qué velocidad va el variador.
		 *
		 * Se enseñan aunque estén a cero, y a propósito: en una salida todo/nada «no aparece» y
		 * «apagada» son lo mismo, pero en una válvula un 0 % es un dato —está cerrada porque la
		 * sonda lo pide— y no verlo dejaría a quien programa sin saber si su rampa funciona.
		 */
		for (const [clave, salida] of r.salidasAnalogicas) {
			const [id, borne] = clave.split('::');
			const d = proyecto().dispositivos.find((x) => x.id === id);
			const recorrido = salida.rango[1] - salida.rango[0];
			const porcentaje = recorrido > 0
				? Math.round((salida.valor - salida.rango[0]) / recorrido * 100) : 0;
			const fila = document.createElement('div');
			fila.className = 'fila-sim analogica';
			fila.innerHTML = `<span class="punto-sim"></span>`
				+ `<span class="des-sim">${escaparHtml(`${d?.designacion ?? id}:${borne}`)}</span>`
				+ `<span class="que-sim">${salida.valor.toFixed(2)} ${salida.unidad} · ${porcentaje} %`
				+ ` · ${escaparHtml(salida.senal.calidad.toUpperCase().replaceAll('-', ' '))}`
				+ ` · ${escaparHtml(salida.senal.origen.toUpperCase().replaceAll('-', ' '))}`
				+ `${salida.supuesto ? ' · rango supuesto' : ''}</span>`;
			fila.onclick = () => seleccionar(id);
			cont.appendChild(fila);
		}

		// Estado completo del variador, incluso cuando no está en RUN. `funcionando` solo contiene
		// aparatos activos y por eso no podía distinguir READY de “no existe” o “sin alimentación”.
		const estadosVariador = new Set(r.variadores.map((v) => v.dispositivoId));
		for (const v of r.variadores) {
			const fila = document.createElement('div');
			fila.className = `fila-sim variador ${v.estado}`;
			fila.dataset.id = v.dispositivoId;
			fila.innerHTML = '<span class="punto-sim"></span>'
				+ `<span class="des-sim">${escaparHtml(v.designacion)}</span>`
				+ `<span class="que-sim">${textoEstadoVariador(v)}</span>`
				+ (v.estado === 'falla'
					? `<button data-reset-vfd="${escaparHtml(v.dispositivoId)}"${v.resetPermitido ? '' : ' disabled'}>`
						+ `${v.resetPermitido ? 'RESET' : 'Retira la causa'}</button>` : '');
			fila.onclick = () => seleccionar(v.dispositivoId);
			cont.appendChild(fila);
		}
		for (const el of cont.querySelectorAll<HTMLButtonElement>('[data-reset-vfd]')) {
			el.onclick = (ev) => {
				ev.stopPropagation();
				const id = el.dataset.resetVfd!;
				estadoSim[id] = { ...(estadoSim[id] ?? {}), resetFallo: true };
				recalcularSimulacion();
				delete estadoSim[id].resetFallo;
				const v = ultimaSim?.variadores.find((x) => x.dispositivoId === id);
				avisar(v?.estado === 'listo' ? `${v.designacion}: RESET aceptado; requiere una nueva orden RUN.`
					: `${v?.designacion ?? id}: RESET rechazado mientras la causa siga activa.`,
					v?.estado === 'listo' ? 'ok' : 'error');
			};
		}
		for (const m of r.motores) {
			const fila = document.createElement('div');
			fila.className = `fila-sim motor ${m.estado}`;
			fila.dataset.id = m.dispositivoId;
			const velocidad = m.rpmEstimada !== undefined ? `${m.rpmEstimada} rpm estimadas`
				: `${m.velocidadPorcentaje.toFixed(0)} % relativo`;
			fila.innerHTML = '<span class="punto-sim"></span>'
				+ `<span class="des-sim">${escaparHtml(m.designacion)}</span>`
				+ `<span class="que-sim">${m.estado.toUpperCase()} · ${m.frecuenciaElectricaHz.toFixed(1)} Hz · ${velocidad}</span>`;
			fila.onclick = () => seleccionar(m.dispositivoId);
			cont.appendChild(fila);
		}
		for (const p of r.protecciones) {
			const fila = document.createElement('div');
			fila.className = `fila-sim proteccion ${p.estado}`;
			fila.dataset.id = p.dispositivoId;
			fila.innerHTML = '<span class="punto-sim"></span>'
				+ `<span class="des-sim">${escaparHtml(p.designacion)}</span>`
				+ `<span class="que-sim">${p.estado.toUpperCase()}`
				+ `${p.estado === 'calentando' ? ` · térmica ${(p.cargaTermica * 100).toFixed(0)} %` : ''}</span>`;
			fila.onclick = () => seleccionar(p.dispositivoId);
			cont.appendChild(fila);
		}

		// La posición viene del resultado eléctrico, no de “está activo”. Una válvula alimentada con
		// referencia 0 V está cerrada al 0 %, aunque como carga tenga tensión en sus bornes.
		const cargasConPosicion = new Set<string>();
		for (const actuador of r.actuadores) {
			const id = actuador.dispositivoId;
			const posicion = actuador.posicionActual;
			const d = proyecto().dispositivos.find((x) => x.id === id);
			const perfil = d ? resolverComportamiento(d) : undefined;
			if (perfil?.clase !== 'carga') continue;
			cargasConPosicion.add(id);
			const fila = document.createElement('div');
			fila.className = `fila-sim posicion-carga ${actuador.estado}`;
			fila.innerHTML = '<span class="punto-sim"></span>'
				+ `<span class="des-sim">${escaparHtml(d?.designacion ?? id)}</span>`
				+ `<span class="que-sim">${perfil.efecto === 'movimiento' ? 'válvula/actuador' : 'carga modulante'}`
				+ ` · ${actuador.estado.toUpperCase()} · comando ${actuador.posicionObjetivo.toFixed(0)} %`
				+ ` · posición ${posicion.toFixed(0)} %`
				+ `${actuador.calidadMando === 'normal' ? '' : ` · ${actuador.calidadMando.toUpperCase().replaceAll('-', ' ')}`}</span>`;
			fila.onclick = () => seleccionar(id);
			cont.appendChild(fila);
		}
		if (r.funcionando.length === 0 && cont.children.length === 0) cont.innerHTML = '<div class="nada-sim">Nada está funcionando todavía.</div>';
		for (const f of r.funcionando) {
			if (estadosVariador.has(f.dispositivoId) || cargasConPosicion.has(f.dispositivoId)) continue;
			const fila = document.createElement('div');
			fila.className = 'fila-sim';
			fila.innerHTML = `<span class="punto-sim"></span><span class="des-sim">${escaparHtml(f.designacion)}</span>`
				+ `<span class="que-sim">${escaparHtml(f.que)}</span>`;
			fila.onclick = () => seleccionar(f.dispositivoId);
			cont.appendChild(fila);
		}
		const textos = [...r.avisos];
		if (r.oscila) {
			textos.push('El circuito no se estabiliza: hay un lazo que se enciende y se apaga solo (un relé '
				+ 'alimentando su propia bobina a través de su contacto NC, por ejemplo).');
		}
		for (const a of textos) {
			const div = document.createElement('div');
			div.className = 'aviso-sim';
			div.textContent = a;
			avisos.appendChild(div);
		}
	}

	/**
	 * Un clic sobre un aparato con el tablero energizado lo ACCIONA en vez de seleccionarlo para
	 * editar. Devuelve true si ha accionado algo, para que el clic no siga su camino normal.
	 */
	function accionarEnSimulacion(dispositivoId: string): boolean {
		const d = proyecto().dispositivos.find((x) => x.id === dispositivoId);
		if (!d) return false;
		const control = controlDeSimulacion(d);
		if (control?.clase === 'sensor' && control.analogico) {
			const mando = document.querySelector<HTMLInputElement>(`#sim-sondas [data-sonda="${d.id}"]`);
			mando?.focus();
			const u = d.unidadSonda ? ` ${d.unidadSonda}` : '';
			avisar(`${d.designacion ?? d.id} es una sonda: muévela con su mando del panel `
				+ `(ahora marca ${estadoSim[d.id]?.valor ?? '—'}${u}).`, 'info');
			return true;
		}
		const operado = operarControl(d, estadoSim[d.id] ?? {}, 'accionar');
		if (!operado.atendido) return false;
		if (operado.cambio) {
			estadoSim[d.id] = operado.estado;
			recalcularSimulacion();
		}
		const visible = estadoDelMando(d, operado.estado);
		if (control?.clase === 'proteccion' && operado.estado.disparado && !control.rearmable) {
			avisar(`${d.designacion ?? d.id}: fusible FUNDIDO; requiere sustitución.`, 'error');
		} else {
			avisar(`${d.designacion ?? d.id}: ${visible.texto}`,
				operado.estado.disparado ? 'error' : 'info');
		}
		return true;
	}

	function operarMomento(dispositivoId: string, operacion: 'presionar' | 'soltar'): boolean {
		const d = proyecto().dispositivos.find((x) => x.id === dispositivoId);
		if (!d) return false;
		const operado = operarControl(d, estadoSim[d.id] ?? {}, operacion);
		if (!operado.atendido) return false;
		if (operado.cambio) {
			estadoSim[d.id] = operado.estado;
			recalcularSimulacion();
		}
		return true;
	}

	function presionarEnSimulacion(dispositivoId: string): boolean {
		return operarMomento(dispositivoId, 'presionar');
	}

	function soltarEnSimulacion(dispositivoId: string): boolean {
		return operarMomento(dispositivoId, 'soltar');
	}

	function pulsarSintetico(dispositivoId: string): boolean {
		if (!presionarEnSimulacion(dispositivoId)) return false;
		window.setTimeout(() => soltarEnSimulacion(dispositivoId), DURACION_PULSO_SINTETICO_MS);
		return true;
	}

	/** Borra exclusivamente runtime; el Proyecto y su diseño no se modifican. */
	function limpiarRuntime(): void {
		limpiarGestos();
		estadoSim = {};
		activosPrevios = new Set();
		ultimaSim = undefined;
		ajustarRelojSim();
	}

	function aplicarEnergizado(activo: boolean): void {
		energizado = activo;
		document.body.classList.toggle('modo-simulacion', activo);
		$('btn-energizar').classList.toggle('activo', activo);
		($('seccion-simulacion') as HTMLElement).hidden = !activo;
		ctx.refrescarPanel?.();
		if (activo) {
			($('seccion-simulacion') as HTMLDetailsElement).open = true;
			// El panel vive debajo de la lista de cables, y en un tablero con treinta cables se queda
			// fuera de la pantalla: energizabas y no veías lo que acababas de encender.
			$('seccion-simulacion').scrollIntoView({ block: 'start', behavior: 'smooth' });
			activosPrevios = new Set();
			ajustarRelojSim();
			recalcularSimulacion();
			avisar('Tablero energizado. Haz clic en un pulsador para accionarlo.', 'ok');
		} else {
			// Detener una sesión vuelve al estado operativo inicial. Un selector, sensor o protección
			// accionado pertenece al runtime y no reaparece mágicamente en la próxima energización.
			limpiarRuntime();
			pintarSimulacion();
			avisar('Tablero sin tensión.', 'info');
		}
	}

	/**
	 * Deja la maniobra como recién montada: pulsadores sueltos, protecciones rearmadas, reloj a
	 * cero y sin memoria de qué bobinas estaban metidas.
	 *
	 * Es lo que hace el botón «Todo en reposo», y es también —exactamente lo mismo— lo que hay que
	 * hacer cuando el tablero se cambia entero.
	 */
	function volverAReposo(): void {
		limpiarRuntime();
		// El reloj también vuelve a cero: si no, los temporizadores seguirían con la cuenta de antes
		// y un relé a la desconexión se quedaría enganchado sin motivo.
		if (energizado) recalcularSimulacion();
		else pintarSimulacion();
	}

	($('btn-energizar') as HTMLButtonElement).onclick = () => aplicarEnergizado(!energizado);
	($('btn-sim-reposo') as HTMLButtonElement).onclick = () => {
		volverAReposo();
		avisar('Todo en reposo: pulsadores soltados, protecciones rearmadas y reloj a cero.', 'ok');
	};

	($('sim-velocidad') as HTMLSelectElement).onchange = (ev) => {
		velocidadSim = Number((ev.target as HTMLSelectElement).value) || 1;
	};

	return {
		energizado: () => energizado,
		alternar: () => aplicarEnergizado(!energizado),
		recalcular: recalcularSimulacion,
		accionar: accionarEnSimulacion,
		presionar: presionarEnSimulacion,
		soltar: soltarEnSimulacion,
		puedeAccionar: (id: string) => {
			const d = proyecto().dispositivos.find((x) => x.id === id);
			return !!d && controlDeSimulacion(d) !== undefined;
		},
		resultado: () => ultimaSim,
		estadoDeLosMandos: () => estadoSim,
		reiniciar: () => { volverAReposo(); pintarSimulacion(); },
	};
}
