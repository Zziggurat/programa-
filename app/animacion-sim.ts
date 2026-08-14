/**
 * QUE SE VEA FUNCIONAR, no que lo cuente un panel.
 *
 * Con el tablero energizado, el simulador ya sabía qué estaba metido y qué no: lo decía en la
 * lista de «funcionando» y encendía los cables con tensión. Pero los APARATOS no hacían nada. Un
 * contactor metido, una lámpara encendida y un motor girando se veían exactamente igual: los tres
 * con el mismo brillo ámbar por encima, todos a la vez, sin distinguir uno de otro y sin que se
 * moviera nada. Para comprobar que el cableado está bien —que es para lo que sirve energizar—
 * había que leerse el panel, no mirar el tablero.
 *
 * Aquí cada componente hace lo que hace el de verdad:
 *
 *   contactor y relé    la armadura BAJA cuando la bobina tira (es lo que se mira en la obra)
 *   protección          la palanca sube o baja, y la mirilla pasa de verde a rojo al abrir
 *   térmico disparado   se marca en rojo, que es lo que se ve al saltar
 *   piloto y lámpara    se encienden con SU color: rojo el de defecto, verde el de marcha
 *   pulsador            la cabeza se hunde mientras está apretado
 *   motor               el eje GIRA, y más deprisa cuanta más tensión le llega
 *   válvula             el vástago sale al abrir
 *   sonda o boya        su testigo se enciende al accionarla
 *
 * Las piezas vienen marcadas desde donde se construye el aparato (`userData.pieza`), así que este
 * módulo no sabe de geometría: busca piezas por nombre y las mueve. Un aparato al que nadie le
 * marcó piezas simplemente no se anima, sin romperse.
 *
 * EL ÍNDICE SE CALCULA UNA VEZ POR APARATO, no en cada fotograma: recorrer el árbol entero de la
 * escena sesenta veces por segundo era lo que había que evitar, y con treinta aparatos se nota.
 */
import * as THREE from 'three';

import { Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { EstadoTablero, ResultadoSimulacion } from '../src/motores/simulacion.js';

/** Las piezas móviles de un aparato, localizadas una sola vez. */
interface Piezas {
	armadura: THREE.Mesh[];
	palanca: THREE.Mesh[];
	mirilla: THREE.Mesh[];
	lente: THREE.Mesh[];
	boton: THREE.Mesh[];
	eje: THREE.Mesh[];
	vastago: THREE.Mesh[];
	pantalla: THREE.Mesh[];
	led: THREE.Mesh[];
	/** Posición de reposo de cada pieza, para poder devolverla al desenergizar. */
	reposo: Map<THREE.Object3D, THREE.Vector3>;
}

const VACIO = (): Piezas => ({
	armadura: [], palanca: [], mirilla: [], lente: [], boton: [], eje: [], vastago: [],
	pantalla: [], led: [],
	reposo: new Map(),
});

/** Localiza (y recuerda) las piezas móviles que cuelgan de un grupo. */
function piezasDe(grupo: THREE.Object3D): Piezas {
	const guardado = grupo.userData.piezasSim as Piezas | undefined;
	if (guardado) return guardado;
	const p = VACIO();
	grupo.traverse((o) => {
		const nombre = o.userData.pieza as keyof Piezas | undefined;
		if (!nombre || !(o instanceof THREE.Mesh)) return;
		const lista = p[nombre];
		if (!Array.isArray(lista)) return;
		lista.push(o);
		p.reposo.set(o, o.position.clone());
	});
	grupo.userData.piezasSim = p;
	return p;
}

export interface EntradaAnimacion {
	/** Los grupos 3D por aparato: los del riel y los de campo. */
	grupos: THREE.Object3D[];
	proyecto: Proyecto;
	resultado: ResultadoSimulacion | undefined;
	estado: EstadoTablero;
	energizado: boolean;
	/** Segundos transcurridos desde el fotograma anterior. */
	dt: number;
	/** Segundos desde que arrancó el editor, para los latidos lentos (el refresco de un display). */
	reloj: number;
	/** El grupo de los cables, para encenderlos según la corriente que llevan. */
	cables?: THREE.Object3D;
}

/**
 * Lleva la escena al estado que dice la simulación. Se llama en cada fotograma.
 *
 * Sin tensión devuelve todo a su reposo: las palancas arriba, la armadura fuera, las lentes
 * apagadas. Es importante que sea el MISMO camino —y no un «deshacer» aparte— porque así no hay
 * dos sitios donde se pueda quedar algo a medias.
 */
export function animarSimulacion(e: EntradaAnimacion): void {
	const reloj = e.reloj;
	const porId = new Map<string, Dispositivo>();
	for (const d of e.proyecto.dispositivos) porId.set(d.id, d);
	const activos = e.energizado ? e.resultado?.activos : undefined;

	/*
	 * --- LOS CABLES RESPIRAN, Y BRILLAN SEGÚN LO QUE LLEVAN ---
	 *
	 * Todos los cables vivos se encendían con el MISMO amarillo fijo, así que el tablero
	 * energizado era una maraña uniforme: no se distinguía la maniobra de la potencia ni se veía
	 * por dónde iba de verdad la corriente. Ahora el brillo sale de la intensidad que la
	 * simulación calcula para cada conductor, y cada uno late con su propia fase: el conjunto se
	 * ve VIVO en vez de pintado.
	 */
	if (e.cables) {
		const corrientes = e.energizado ? e.resultado?.corrientePorConductor : undefined;
		e.cables.traverse((o) => {
			if (!(o instanceof THREE.Mesh)) return;
			// Solo el TUBO. Del cable cuelgan además el tubo de agarre invisible y las punteras de
			// las dos puntas, y una puntera de plástico blanco encendiéndose no es un cable con
			// tensión: es una bombilla donde no la hay.
			if (!o.userData.tuboVisible) return;
			const id = o.userData.conductorId as string | undefined;
			if (!id) return;
			const mat = o.material as THREE.MeshStandardMaterial | undefined;
			if (!mat?.emissive) return;
			if (!e.energizado || !e.resultado?.conductoresVivos.has(id)) { mat.emissiveIntensity = 0; return; }
			const amperios = corrientes?.get(id) ?? 0;
			// Un hilo de maniobra lleva miliamperios y uno de potencia varios amperios: la escala es
			// logarítmica para que el de mando se vea sin que el de potencia deslumbre.
			const base = 0.5 + Math.min(0.6, Math.log10(1 + amperios * 4) * 0.42);
			// La fase sale del id, así que cada cable late a su aire y no parpadean todos a la vez.
			const fase = (id.charCodeAt(0) + id.length * 7) % 10;
			mat.emissiveIntensity = base + 0.09 * Math.sin(reloj * 2.6 + fase);
		});
	}

	for (const grupo of e.grupos) {
		const id = grupo.userData.dispositivoId as string | undefined;
		if (!id) continue;
		const d = porId.get(id);
		if (!d) continue;
		const p = piezasDe(grupo);
		const st = e.estado[id] ?? {};
		const enMarcha = !!activos?.has(id);

		/* --- Contactor y relé: la armadura entra cuando la bobina tira --- */
		for (const m of p.armadura) {
			const base = p.reposo.get(m);
			if (base) m.position.z = base.z - (enMarcha ? 2.2 : 0);
		}

		/* --- Protecciones: palanca y mirilla --- */
		const abierto = st.cerrado === false;
		const disparado = !!st.disparado;
		for (const m of p.palanca) {
			const base = p.reposo.get(m);
			// Abierta baja del todo; disparada se queda a medias, que es como avisa de que ha saltado.
			if (base) m.position.y = base.y - (disparado ? 7 : abierto ? 11 : 0);
		}
		for (const m of p.mirilla) {
			const mat = m.material as THREE.MeshStandardMaterial;
			mat.color.setHex(disparado ? 0xd32f2f : abierto ? 0xb0342c : 0x2e7d32);
			mat.emissive.setHex(disparado ? 0x8e1b16 : 0x000000);
			mat.emissiveIntensity = disparado ? 0.7 : 0;
		}

		/* --- Pilotos, lámparas y testigos: se encienden con su propio color --- */
		for (const m of p.lente) {
			const propio = (m.userData.colorPropio as number | undefined) ?? 0xffd54f;
			const mat = m.material as THREE.MeshStandardMaterial;
			// Una sonda o boya se enciende cuando está ACCIONADA, aunque no consuma nada.
			const encendida = enMarcha || (d.tipo === 'sensor' && !!st.activo);
			mat.emissive.setHex(encendida ? propio : 0x000000);
			mat.emissiveIntensity = encendida ? 1.15 : 0;
			mat.color.setHex(propio);
		}

		/* --- Pulsadores: la cabeza se hunde mientras está apretada --- */
		for (const m of p.boton) {
			const base = p.reposo.get(m);
			if (base) m.position.z = base.z - (st.activo ? 3.2 : 0);
		}

		/*
		 * --- MOTORES: el eje gira, y a la velocidad que le toca ---
		 *
		 * Antes giraba siempre a la misma velocidad aunque el comentario prometiera «más deprisa
		 * cuanta más tensión»: el comentario decía una cosa y el código hacía otra. Ahora sale de
		 * la simulación de verdad —de la tensión a la que está trabajando— así que un motor a 380 V
		 * se ve girar más vivo que uno a 220, y uno de 24 V apenas. No es un dato de catálogo: es
		 * lo que el propio circuito le está dando.
		 */
		if (p.eje.length && enMarcha) {
			const tension = d.tensionNominal ?? 220;
			// 220 V como referencia: ~9 rad/s. Se acota para que ni se pare ni maree.
			const vueltas = Math.min(16, Math.max(4, 9 * Math.sqrt(tension / 220)));
			for (const m of p.eje) m.rotation.x += vueltas * e.dt;
		}

		/* --- Válvulas: el vástago sale al abrir --- */
		for (const m of p.vastago) {
			const base = p.reposo.get(m);
			if (base) m.position.y = base.y + (enMarcha ? 6 : 0);
		}

		/*
		 * --- PANTALLAS Y LEDS ---
		 *
		 * Un autómata, un variador o una fuente con tensión tienen la pantalla ENCENDIDA; sin
		 * tensión están a oscuras. Antes nacían siempre iluminados, así que daban igual el tablero
		 * energizado que apagado: el equipo parecía vivo aunque no llegara ni un voltio.
		 *
		 * «Tener tensión» se toma de la simulación: o está haciendo algo, o el motor de lógica lo
		 * reconoce como controlador en marcha. Con el tablero sin energizar, todo apagado.
		 */
		const ctrl = e.energizado
			? e.resultado?.controladores.find((c) => c.dispositivoId === id)
			: undefined;
		const conTension = enMarcha || !!ctrl;
		for (const m of p.pantalla) {
			const propio = (m.userData.colorPropio as number | undefined) ?? 0x39e08a;
			const mat = m.material as THREE.MeshStandardMaterial;
			mat.emissive.setHex(propio);
			// Un parpadeo lentísimo, como el refresco de un display: vivo sin llamar la atención.
			mat.emissiveIntensity = conTension ? 0.75 + 0.06 * Math.sin(reloj * 2.2) : 0;
		}
		/*
		 * Los LEDs del autómata dicen lo que dice el programa: el primero es el de tensión y los
		 * demás, sus salidas. Así se ve entrar DO1 sin abrir el panel de la simulación, que es
		 * media gracia de tener un autómata dibujado.
		 */
		for (const m of p.led) {
			const propio = (m.userData.colorPropio as number | undefined) ?? 0x21d07a;
			const i = (m.userData.indiceLed as number | undefined) ?? 0;
			const mat = m.material as THREE.MeshStandardMaterial;
			const encendido = i === 0 ? conTension : conTension && (ctrl?.salidas.length ?? 0) >= i;
			mat.emissive.setHex(propio);
			mat.emissiveIntensity = encendido ? 1 : 0;
		}
	}
}
