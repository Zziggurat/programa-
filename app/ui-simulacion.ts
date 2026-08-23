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

import { Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { esReferenciaVisualInerte } from '../src/modelo/apariencia.js';
import { MemoriaLogica, memoriaLogicaVacia } from '../src/motores/logica.js';
import {
	EstadoAparato, EstadoTablero, MemoriaTiempos, ResultadoSimulacion, formatearA, memoriaVacia, simular,
} from '../src/motores/simulacion.js';
import { emisionDeCable } from './animacion-sim.js';
import { Escenario } from './escena3d.js';
import { avisar, escaparHtml } from './dialogos.js';

/** Lo que la simulación necesita del editor. */
export interface ContextoSimulacion {
	proyecto: () => Proyecto;
	/** La escena montada ahora mismo (se reconstruye al cambiar el tablero, por eso es función). */
	escenario: () => Escenario;
	/** Selecciona un aparato del tablero (al pinchar una fila del panel). */
	seleccionar: (id: string | undefined) => void;
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

/** Las protecciones que se abren y se cierran a mano. */
const PROTECCIONES = new Set(['disyuntor', 'diferencial', 'guardamotor', 'seccionador', 'fusible']);

/** Un térmico se reconoce por su contacto 95-96: es lo que se dispara a mano para probar. */
const esTermico = (d: Dispositivo): boolean => d.tipo === 'rele' && d.bornes.some((b) => b.id === '95');

/**
 * ¿ESTE APARATO SE PUEDE ACCIONAR?
 *
 * Tiene que decir exactamente lo mismo que `accionarEnSimulacion`, porque de aquí sale la lista de
 * mandos que se le enseña al usuario: si dijera de más, saldría un botón que no hace nada; si
 * dijera de menos, faltaría el botón que hace falta para arrancar el tablero. Las dos leen la
 * misma tabla `PROTECCIONES` y el mismo `esTermico` para no poder separarse.
 *
 * Una sonda CON RANGO no entra: su mando no es un botón sino el deslizador de «Sondas».
 */
function esMando(d: Dispositivo): boolean {
	if (d.tipo === 'pulsador' || d.tipo === 'selector') return true;
	if (d.tipo === 'sensor') return !d.rangoSonda;
	if (PROTECCIONES.has(d.tipo)) return true;
	return esTermico(d);
}

/** Cómo se lee y cómo se rotula el botón de un mando, según cómo esté ahora. */
function estadoDelMando(d: Dispositivo, st: EstadoAparato): { texto: string; boton: string; encendido: boolean } {
	if (esTermico(d)) {
		const disparado = !!st.disparado;
		return { texto: disparado ? 'DISPARADO' : 'rearmado', boton: disparado ? 'Rearmar' : 'Disparar', encendido: disparado };
	}
	if (PROTECCIONES.has(d.tipo)) {
		if (st.disparado) return { texto: 'DISPARADO', boton: 'Rearmar', encendido: true };
		const abierto = st.cerrado === false;
		return { texto: abierto ? 'abierto' : 'cerrado', boton: abierto ? 'Cerrar' : 'Abrir', encendido: abierto };
	}
	const activo = !!st.activo;
	return { texto: activo ? 'accionado' : 'en reposo', boton: activo ? 'Soltar' : 'Accionar', encendido: activo };
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
	/** Instantes en que cada protección empezó a ver corriente de más, para cronometrar su disparo. */
	let sobrecargaDesde: Record<string, number> = {};

	function recalcularSimulacion(): void {
		if (!energizado) return;
		if (!relojSim) relojSim = { ahora: 0, memoria: memoriaVacia(), logica: memoriaLogicaVacia() };
		ultimaSim = simular(proyecto(), estadoSim, activosPrevios, relojSim);
		activosPrevios = ultimaSim.activos;
		aplicarDisparos();
		pintarSimulacion();
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
		const ahora = relojSim.ahora;
		const activos = new Set<string>();
		for (const d of ultimaSim.disparos) {
			activos.add(d.dispositivoId);
			if (sobrecargaDesde[d.dispositivoId] === undefined) sobrecargaDesde[d.dispositivoId] = ahora;
			const llevaS = (ahora - sobrecargaDesde[d.dispositivoId]) / 1000;
			if (llevaS < d.segundos) continue;
			estadoSim[d.dispositivoId] = { ...(estadoSim[d.dispositivoId] ?? {}), disparado: true };
			delete sobrecargaDesde[d.dispositivoId];
			avisar(`⚡ ${d.designacion} ha DISPARADO — ${d.explicacion}`, 'error');
			// Al abrirse cambia el circuito entero: se vuelve a resolver con la protección abierta.
			ultimaSim = simular(proyecto(), estadoSim, activosPrevios, relojSim);
			activosPrevios = ultimaSim.activos;
			return;
		}
		// La falta desapareció antes de que saltara: el cronómetro se olvida (como el bimetal, que se enfría).
		for (const id of Object.keys(sobrecargaDesde)) if (!activos.has(id)) delete sobrecargaDesde[id];
	}

	/** Arranca o para el reloj según esté el tablero energizado. */
	function ajustarRelojSim(): void {
		if (tickSim !== undefined) { clearInterval(tickSim); tickSim = undefined; }
		$('sim-transcurrido').textContent = '0,0 s';
		if (!energizado) { relojSim = undefined; sobrecargaDesde = {}; return; }
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
			const hayTiempo = proyecto().dispositivos.some((d) => d.temporizacion?.segundos
				|| (d.tipo === 'plc' && /\b(retardo|m[ií]nimo)\b/i.test(d.programa ?? '')))
				|| Object.keys(sobrecargaDesde).length > 0;
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

	function pintarPanelSimulacion(): void {
		const cont = $('sim-funcionando');
		const avisos = $('sim-avisos');
		const r = ultimaSim;
		cont.innerHTML = '';
		avisos.innerHTML = '';
		$('sim-consumo').innerHTML = '';
		$('sim-carga').innerHTML = '';
		$('sim-sondas').innerHTML = '';
		$('sim-controladores').innerHTML = '';
		if (!r) return;

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
			$('sim-mandos').innerHTML = '<h3 class="titulo-sim">Mandos</h3>' + mandos.map((d) => {
				const st = estadoSim[d.id] ?? {};
				const { texto, boton, encendido } = estadoDelMando(d, st);
				const fuera = dentroDelArmario.has(d.id) ? ''
					: '<span class="fuera" title="No está montado en el armario: va en la puerta o en '
						+ 'campo, así que solo se acciona desde aquí">· en la puerta</span>';
				return `<div class="fila-mando ${encendido ? 'activo' : ''}">`
					+ `<span class="des-sim">${escaparHtml(d.designacion ?? d.id)}</span>`
					+ `<span class="estado-mando">${escaparHtml(texto)}</span>${fuera}`
					+ `<button data-mando="${escaparHtml(d.id)}">${escaparHtml(boton)}</button></div>`;
			}).join('');
			for (const el of $('sim-mandos').querySelectorAll<HTMLElement>('[data-mando]')) {
				el.onclick = () => { accionarEnSimulacion(el.dataset.mando!); };
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
			d.tipo === 'sensor' && !esReferenciaVisualInerte(d) && cableado(d));
		/*
		 * Una SONDA es la que declara su rango de medida; lo demás son contactos de campo —un
		 * presostato, una boya, un final de carrera— que se accionan con su interruptor, no con un
		 * mando de temperatura. Si nadie declara rango, se toman todos como sondas: es lo que hacía
		 * antes, y así los proyectos viejos siguen teniendo su mando.
		 */
		const conRango = posiblesSondas.filter((d) => d.rangoSonda);
		const sondas = conRango.length ? conRango : posiblesSondas;
		if (sondas.length && r.controladores.length) {
			$('sim-sondas').innerHTML = '<h3 class="titulo-sim">Sondas</h3>' + sondas.map((d) => {
				const [min, max] = d.rangoSonda ?? [-10, 60];
				const paso = (max - min) > 200 ? 5 : (max - min) > 20 ? 0.5 : 0.1;
				const v = estadoSim[d.id]?.valor ?? Math.round((min + max) / 2);
				const unidad = d.unidadSonda ? ` ${d.unidadSonda}` : '';
				return `<label class="fila-sonda" title="${escaparHtml(d.descripcion ?? '')}">`
					+ `<span class="des-sim">${escaparHtml(d.designacion ?? d.id)}</span>`
					+ `<input type="range" min="${min}" max="${max}" step="${paso}" value="${v}" `
					+ `data-sonda="${escaparHtml(d.id)}" data-unidad="${escaparHtml(unidad)}">`
					+ `<span class="valor-sonda">${v}${escaparHtml(unidad)}</span></label>`;
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
					const sondasTxt = Object.entries(c.sondas).map(([b, v]) => pin(`${b}=${v}`, 'on')).join('');
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
					return `<div class="ctrl-sim" data-id="${escaparHtml(c.dispositivoId)}">`
						+ `<span class="des-sim">${escaparHtml(c.designacion)}</span> `
						+ `<span style="color:var(--texto-suave)">${c.reglas} renglón(es)</span>`
						+ `<div class="es">${entradas || pin('sin entradas activas')}${sondasTxt}`
						+ `<span style="color:var(--texto-suave)">→</span>${salidas || pin('sin salidas')}</div>`
						+ renglones + cuentas + '</div>';
				}).join('');
			for (const el of $('sim-controladores').querySelectorAll<HTMLElement>('[data-id]')) {
				el.onclick = () => seleccionar(el.dataset.id!);
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
			.filter((c) => c.corriente > 0 && c.nominal)
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
		for (const [clave, valor] of r.analogicas) {
			const [id, borne] = clave.split('::');
			const d = proyecto().dispositivos.find((x) => x.id === id);
			const fila = document.createElement('div');
			fila.className = 'fila-sim analogica';
			fila.innerHTML = `<span class="punto-sim"></span>`
				+ `<span class="des-sim">${escaparHtml(`${d?.designacion ?? id}:${borne}`)}</span>`
				+ `<span class="que-sim">${valor.toFixed(1)} V · ${Math.round((valor / 10) * 100)} %</span>`;
			fila.onclick = () => seleccionar(id);
			cont.appendChild(fila);
		}
		if (r.funcionando.length === 0 && cont.children.length === 0) cont.innerHTML = '<div class="nada-sim">Nada está funcionando todavía.</div>';
		for (const f of r.funcionando) {
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
		const st = { ...(estadoSim[d.id] ?? {}) };
		switch (d.tipo) {
			case 'sensor':
				// Una SONDA no se acciona: se mueve. Cambiarle un `activo` que nadie mira daría la
				// impresión de que el clic no hace nada; el mando de verdad está en el panel.
				if (d.rangoSonda) {
					const mando = document.querySelector<HTMLInputElement>(`#sim-sondas [data-sonda="${d.id}"]`);
					mando?.focus();
					const u = d.unidadSonda ? ` ${d.unidadSonda}` : '';
					avisar(`${d.designacion ?? d.id} es una sonda: muévela con su mando del panel `
						+ `(ahora marca ${estadoSim[d.id]?.valor ?? '—'}${u}).`, 'info');
					return true;
				}
				st.activo = !st.activo;
				avisar(`${d.designacion ?? d.id}: ${st.activo ? 'accionado' : 'en reposo'}`, 'info');
				break;
			case 'pulsador':
			case 'selector':
				st.activo = !st.activo;
				avisar(`${d.designacion ?? d.id}: ${st.activo ? 'accionado' : 'en reposo'}`, 'info');
				break;
			default:
				/*
				 * Protecciones y térmicos, leyendo LAS MISMAS tablas que `esMando`. Antes esto era
				 * una lista de `case` escrita aparte, y de ahí sale el fallo clásico: se añade un
				 * tipo de aparato en un sitio y no en el otro, y queda un botón que no hace nada (o
				 * un aparato que no se puede accionar y nadie sabe por qué).
				 */
				if (PROTECCIONES.has(d.tipo)) {
					// Si había disparado, el clic lo rearma; si estaba cerrado, lo abre.
					if (st.disparado) { st.disparado = false; st.cerrado = true; }
					else st.cerrado = st.cerrado === false;
					avisar(`${d.designacion ?? d.id}: ${st.cerrado === false ? 'abierto' : 'cerrado'}`, 'info');
					break;
				}
				// Un térmico se dispara a mano para comprobar que el mando cae como debe.
				if (esTermico(d)) {
					st.disparado = !st.disparado;
					avisar(`${d.designacion ?? d.id}: ${st.disparado ? 'DISPARADO' : 'rearmado'}`,
						st.disparado ? 'error' : 'ok');
					break;
				}
				return false;
		}
		estadoSim[d.id] = st;
		recalcularSimulacion();
		return true;
	}

	function aplicarEnergizado(activo: boolean): void {
		energizado = activo;
		document.body.classList.toggle('modo-simulacion', activo);
		$('btn-energizar').classList.toggle('activo', activo);
		($('seccion-simulacion') as HTMLElement).hidden = !activo;
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
			ultimaSim = undefined;
			ajustarRelojSim();   // para el reloj y olvida las cuentas atrás
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
		estadoSim = {};
		activosPrevios = new Set();
		ultimaSim = undefined;
		// El reloj también vuelve a cero: si no, los temporizadores seguirían con la cuenta de antes
		// y un relé a la desconexión se quedaría enganchado sin motivo.
		ajustarRelojSim();
		recalcularSimulacion();
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
		puedeAccionar: (id: string) => {
			const d = proyecto().dispositivos.find((x) => x.id === id);
			return !!d && esMando(d);
		},
		resultado: () => ultimaSim,
		estadoDeLosMandos: () => estadoSim,
		reiniciar: () => { volverAReposo(); pintarSimulacion(); },
	};
}
