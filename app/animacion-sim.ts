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
 * módulo no sabe de geometría: busca piezas por nombre y las mueve. Si una imagen personalizada
 * no declara piezas, su material recibe únicamente un realce reversible derivado del resultado.
 *
 * EL ÍNDICE SE CALCULA UNA VEZ POR APARATO, no en cada fotograma: recorrer el árbol entero de la
 * escena sesenta veces por segundo era lo que había que evitar, y con treinta aparatos se nota.
 */
import * as THREE from 'three';

import { resolverComportamiento } from '../src/modelo/comportamiento.js';
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
	/** Materiales del marco/cuerpo disponibles para un estado genérico de una imagen importada. */
	generico: THREE.Mesh[];
	/** El resplandor de un piloto encendido: un disco aditivo, no una luz. */
	halo: THREE.Mesh[];
	/** Posición de reposo de cada pieza, para poder devolverla al desenergizar. */
	reposo: Map<THREE.Object3D, THREE.Vector3>;
}

const VACIO = (): Piezas => ({
	armadura: [], palanca: [], mirilla: [], lente: [], boton: [], eje: [], vastago: [],
	pantalla: [], led: [], generico: [], halo: [],
	reposo: new Map(),
});

const HSL = { h: 0, s: 0, l: 0 };

/**
 * CÓMO SE ENCIENDE UN CONDUCTOR SIN DEJAR DE SER DE SU COLOR.
 *
 * Energizar es un estado AÑADIDO, no un cambio de color: un cable gris con tensión sigue siendo
 * gris, y uno marrón sigue siendo marrón. Durante mucho tiempo no fue así porque había DOS sitios
 * pintando lo mismo —este módulo y `pintarSimulacion`— y el segundo machacaba el emisivo con un
 * ámbar fijo para todos. El síntoma era que cualquier conductor vivo viraba al amarillo: el negro
 * pasaba de tono 220° a 42°. La causa no era la intensidad, era el COLOR del emisivo.
 *
 * Ahora el emisivo sale del propio conductor: mismo tono y misma saturación, y solo se le sube la
 * luz lo justo para que un conductor oscuro tenga algo que emitir. Se acota por arriba para que un
 * gris o un blanco no se vayan al blanco puro, que es la otra forma de perder la identidad.
 *
 * La FUERZA compensa lo contrario: sobre un negro casi cualquier cosa se nota, y sobre un claro
 * casi nada. Un conductor oscuro recibe más y uno claro menos, para que los dos den el mismo salto
 * PERCIBIDO sin que ninguno queme. Un cable energizado no es una tira de LED.
 *
 * Se calcula una vez por cable y se recuerda; si el material cambia de color (colorear por
 * voltaje), el propio color guardado invalida la cuenta.
 */
export function emisionDeCable(mat: THREE.MeshStandardMaterial, malla: THREE.Object3D): number {
	const base = mat.color.getHex();
	const guardado = malla.userData.emision as { base: number; color: number; fuerza: number } | undefined;
	if (guardado?.base === base) {
		mat.emissive.setHex(guardado.color);
		return guardado.fuerza;
	}
	mat.color.getHSL(HSL);
	// El emisivo es el color del conductor tal cual. Solo se le pone un SUELO, porque un negro casi
	// puro multiplicado por cualquier intensidad sigue siendo negro y no habría forma de ver que
	// tiene tensión; y un TECHO, para que un blanco no emita blanco puro y se coma su propio matiz.
	const color = new THREE.Color().setHSL(HSL.h, HSL.s, Math.min(0.72, Math.max(0.30, HSL.l)));
	/*
	 * Y LA FUERZA SUBE CON LO CLARO QUE SEA EL CONDUCTOR, que es justo lo contrario de lo que
	 * parece a primera vista.
	 *
	 * El primer intento le daba más a los oscuros, razonando que un negro necesita más ayuda. Medido
	 * salía al revés: el negro pasaba de luz 6 % a 32 % —ya no era negro, era gris pizarra— y el
	 * gris subía 3 puntos, que no se ve. La razón es que lo que se compara no es el material sino lo
	 * que sale por pantalla, y un conductor oscuro parte de casi cero: cualquier añadido lo
	 * multiplica. Sobre uno claro, ya iluminado y comprimido por el tone mapping, ese mismo añadido
	 * no se nota. Así los dos dan un salto PARECIDO al ojo sin que ninguno cambie de color.
	 */
	const fuerza = 0.38 + 2.6 * HSL.l;
	malla.userData.emision = { base, color: color.getHex(), fuerza };
	mat.emissive.copy(color);
	return fuerza;
}

/** Localiza (y recuerda) las piezas móviles que cuelgan de un grupo. */
function piezasDe(grupo: THREE.Object3D): Piezas {
	const guardado = grupo.userData.piezasSim as Piezas | undefined;
	if (guardado) return guardado;
	const p = VACIO();
	grupo.traverse((o) => {
		const nombre = o.userData.pieza as keyof Piezas | undefined;
		if (!(o instanceof THREE.Mesh)) return;
		if (!nombre) {
			const materiales = Array.isArray(o.material) ? o.material : [o.material];
			if (materiales.some((m) => m instanceof THREE.MeshStandardMaterial)) p.generico.push(o);
			return;
		}
		const lista = p[nombre];
		if (!Array.isArray(lista)) return;
		lista.push(o);
		p.reposo.set(o, o.position.clone());
	});
	grupo.userData.piezasSim = p;
	return p;
}

interface ReposoMaterialSim {
	emissive: number;
	emissiveIntensity: number;
}

/**
 * Realce sobrio para una imagen personalizada sin piezas móviles. No crea geometría, no clona
 * materiales y no guarda un segundo estado: cada fotograma recibe el estado derivado del motor.
 */
function realzarGenerico(
	piezas: Piezas,
	estado: { activo: boolean; color: number; intensidad: number },
): void {
	for (const malla of piezas.generico) {
		const materiales = Array.isArray(malla.material) ? malla.material : [malla.material];
		for (const material of materiales) {
			if (!(material instanceof THREE.MeshStandardMaterial)) continue;
			let reposo = material.userData.reposoSim as ReposoMaterialSim | undefined;
			if (!reposo) {
				reposo = {
					emissive: material.emissive.getHex(),
					emissiveIntensity: material.emissiveIntensity,
				};
				material.userData.reposoSim = reposo;
			}
			material.emissive.setHex(estado.activo ? estado.color : reposo.emissive);
			material.emissiveIntensity = estado.activo ? estado.intensidad : reposo.emissiveIntensity;
		}
	}
}

function tienePiezaFuncional(p: Piezas): boolean {
	return p.armadura.length + p.palanca.length + p.mirilla.length + p.lente.length
		+ p.boton.length + p.eje.length + p.vastago.length + p.pantalla.length
		+ p.led.length + p.halo.length > 0;
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
	/**
	 * LOS GRUPOS de cables, para encenderlos según la corriente que llevan.
	 *
	 * Es una lista y no un grupo suelto porque los conductores no viven todos en el mismo sitio:
	 * los de la placa cuelgan de la raíz y los que van a la puerta tienen su tramo colgado de la
	 * hoja, que gira con ella. Con un solo grupo, un conductor de puerta conducía en la
	 * simulación —y el piloto del otro extremo se encendía— pero él se quedaba apagado.
	 */
	cables?: THREE.Object3D | THREE.Object3D[];
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
	const controladoresPorId = new Map(
		(e.energizado ? e.resultado?.controladores ?? [] : []).map((c) => [c.dispositivoId, c]),
	);
	const variadoresPorId = new Map(
		(e.energizado ? e.resultado?.variadores ?? [] : []).map((v) => [v.dispositivoId, v]),
	);
	const motoresPorId = new Map(
		(e.energizado ? e.resultado?.motores ?? [] : []).map((m) => [m.dispositivoId, m]),
	);

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
		for (const grupoDeCables of (Array.isArray(e.cables) ? e.cables : [e.cables])) grupoDeCables.traverse((o) => {
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
			/*
			 * LA BANDA SE MIDE EN LO QUE AGUANTA EL COLOR, no en lo brillante que quede.
			 *
			 * Iba de 0,5 a 1,1. Como ahora el emissive es el color del PROPIO conductor, esa banda
			 * quemaba a los claros: un hilo gris de mando salía blanco amarillento al energizarse y
			 * dejaba de distinguirse de sus vecinos justo cuando hay que seguirlo con la vista. Con
			 * la mitad de recorrido, un cable oscuro sigue dando un salto grande —parte de casi
			 * nada— y uno claro se aviva sin perder su color.
			 */
			const base = 0.22 + Math.min(0.28, Math.log10(1 + amperios * 4) * 0.2);
			// La fase sale del id, así que cada cable late a su aire y no parpadean todos a la vez.
			const fase = (id.charCodeAt(0) + id.length * 7) % 10;
			const fuerza = emisionDeCable(mat, o);
			mat.emissiveIntensity = (base + 0.05 * Math.sin(reloj * 2.6 + fase)) * fuerza;
		});
	}

	for (const grupo of e.grupos) {
		const id = grupo.userData.dispositivoId as string | undefined;
		if (!id) continue;
		const d = porId.get(id);
		if (!d) continue;
		const p = piezasDe(grupo);
		const st = e.estado[id] ?? {};
		const perfil = resolverComportamiento(d);
		const enMarcha = !!activos?.has(id);
		const posicionCarga = e.energizado ? e.resultado?.posicionesCargas.get(id) : undefined;
		const variador = variadoresPorId.get(id);
		const motor = motoresPorId.get(id);

		/* --- Contactor y relé: la armadura entra cuando la bobina tira --- */
		for (const m of p.armadura) {
			const base = p.reposo.get(m);
			if (base) m.position.z = base.z
				- (perfil?.clase === 'contactos-electromagneticos' && enMarcha ? 2.2 : 0);
		}

		/* --- Protecciones: palanca y mirilla --- */
		const esCorte = perfil?.clase === 'proteccion';
		const abierto = esCorte && st.cerrado === false;
		const disparado = esCorte && !!st.disparado;
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
		// Una sonda o boya se enciende cuando está ACCIONADA, aunque no consuma nada.
		const sensorActivo = e.energizado && perfil?.clase === 'sensor' && !!st.activo;
		const encendida = (perfil?.clase === 'carga' && perfil.efecto === 'luz' && enMarcha)
			|| sensorActivo;
		for (const m of p.lente) {
			const propio = (m.userData.colorPropio as number | undefined) ?? 0xffd54f;
			const mat = m.material as THREE.MeshStandardMaterial;
			/*
			 * DE QUÉ COLOR EMITE puede no ser de qué color ES.
			 *
			 * Los pilotos de puerta llevan un `emissiveMap` que va del blanco en el centro al
			 * color saturado en el borde —que es lo que hace una lámpara detrás de un plástico
			 * teñido— y para que ese mapa mande, el material tiene que emitir BLANCO: `emissive`
			 * multiplica al mapa, y con `emissive` de color no hay mapa en el mundo que pueda
			 * devolver el blanco del núcleo. Quien no lo declare emite su propio color, como
			 * siempre, así que ningún aparato de placa cambia.
			 */
			const emite = (m.userData.colorEmision as number | undefined) ?? propio;
			mat.emissive.setHex(encendida ? emite : 0x000000);
			mat.emissiveIntensity = encendida ? 1.15 : 0;
			/*
			 * APAGADO NO ES «EL MISMO COLOR SIN BRILLO».
			 *
			 * Un piloto apagado se ve más oscuro y más denso —es una lente de plástico teñido con
			 * la lámpara muerta detrás—, y pintándolo del color vivo parece encendido de día. Los
			 * componentes que declaran su `colorApagado` lo usan; los que no, se comportan
			 * exactamente como antes, así que ningún aparato de placa cambia de aspecto.
			 */
			const apagado = m.userData.colorApagado as number | undefined;
			mat.color.setHex(encendida || apagado === undefined ? propio : apagado);
		}
		/*
		 * EL HALO. Es un disco aditivo, no una luz: un piloto de veinte miliamperios no ilumina el
		 * armario, y meter una luz por piloto costaría un fragmento por píxel y por piloto para
		 * conseguir justamente el efecto que no se quiere. Se sube y se baja la opacidad, que no
		 * recompila el material ni toca la geometría.
		 */
		for (const m of p.halo) {
			const mat = m.material as THREE.MeshBasicMaterial;
			const objetivo = encendida ? 0.34 : 0;
			if (mat.opacity !== objetivo) mat.opacity = objetivo;
			m.visible = objetivo > 0;
		}

		/* --- Pulsadores: la cabeza se hunde mientras está apretada --- */
		const pulsado = e.energizado && perfil?.clase === 'mando'
			&& perfil.modo === 'momentaneo' && !!st.activo;
		for (const m of p.boton) {
			const base = p.reposo.get(m);
			if (base) m.position.z = base.z - (pulsado ? 3.2 : 0);
		}

		/*
		 * --- MOTORES: el eje gira, y a la velocidad que le toca ---
		 *
		 * El RESULTADO decide si gira. Durante el estado estimado de arranque la velocidad sube de
		 * forma progresiva; detenido o en falla no gira. La tensión nominal solo da una escala visual
		 * moderada porque el motor no calcula RPM, par ni deslizamiento. No se conserva un estado de
		 * animación alternativo que pueda seguir girando después de que el circuito se detenga.
		 */
		const factorGiro = motor ? motor.velocidadActual : enMarcha ? 1 : 0;
		if (p.eje.length && perfil?.clase === 'carga' && perfil.efecto === 'giro' && factorGiro > 0) {
			const tension = d.tensionNominal ?? 220;
			// 220 V como referencia: ~9 rad/s. Se acota para que ni se pare ni maree.
			const vueltas = Math.min(16, Math.max(4, 9 * Math.sqrt(tension / 220))) * factorGiro;
			for (const m of p.eje) m.rotation.x += vueltas * e.dt;
		}

		/* --- Válvulas: el vástago sigue la posición 0..100 que calculó el motor --- */
		const apertura = perfil?.clase === 'carga' && perfil.efecto === 'movimiento'
			? (posicionCarga ?? (enMarcha ? 100 : 0)) : 0;
		for (const m of p.vastago) {
			const base = p.reposo.get(m);
			if (base) m.position.y = base.y + 6 * Math.max(0, Math.min(100, apertura)) / 100;
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
		const ctrl = controladoresPorId.get(id);
		const fuenteConSalida = e.energizado && perfil?.clase === 'fuente'
			&& perfil.salidas.some((s) => e.resultado?.vivos.has(`${id}::${s.borne}`));
		const conTension = enMarcha || !!ctrl || !!variador?.alimentado || !!fuenteConSalida;
		for (const m of p.pantalla) {
			const propio = (m.userData.colorPropio as number | undefined) ?? 0x39e08a;
			const mat = m.material as THREE.MeshStandardMaterial;
			mat.emissive.setHex(variador?.estado === 'falla' ? 0xd32f2f : propio);
			// Un parpadeo lentísimo, como el refresco de un display: vivo sin llamar la atención.
			mat.emissiveIntensity = conTension
				? (variador?.estado === 'marcha' ? 1 : 0.75) + 0.06 * Math.sin(reloj * 2.2) : 0;
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
			const encendido = variador
				? i === 0 ? variador.alimentado : i === 1 ? variador.estado === 'marcha'
					: i === 2 ? variador.estado === 'falla' : false
				: i === 0 ? conTension : conTension && (ctrl?.salidas.length ?? 0) >= i;
			mat.emissive.setHex(propio);
			mat.emissiveIntensity = encendido ? 1 : 0;
		}

		/*
		 * Una imagen personalizada es plana y no declara `pieza`. Se realza su marco sin teñir la
		 * fotografía: verde/azul cuando su resultado está activo, rojo ante fallo, ámbar al accionar
		 * un sensor o mando. El dato sale del perfil + ResultadoSimulacion/EstadoTablero canónico;
		 * nunca se conserva un booleano visual paralelo.
		 */
		if (d.imagen && !tienePiezaFuncional(p)) {
			const perfilEjecutable = perfil?.clase === 'sin-comportamiento' ? undefined : perfil;
			const posicionActiva = (posicionCarga ?? 0) > 0;
			const entradaActiva = e.energizado && (perfilEjecutable?.clase === 'sensor'
				|| perfilEjecutable?.clase === 'mando') && (!!st.activo
					|| (perfilEjecutable.clase === 'mando' && st.posicion !== undefined
						&& st.posicion !== perfilEjecutable.reposo));
			const fallo = variador?.estado === 'falla'
				|| (perfilEjecutable?.clase === 'proteccion' && !!st.disparado);
			const activoGenerico = !!perfilEjecutable && e.energizado
				&& (enMarcha || posicionActiva || entradaActiva
				|| variador?.estado === 'listo' || variador?.estado === 'marcha' || fallo);
			realzarGenerico(p, {
				activo: activoGenerico,
				color: fallo ? 0xd32f2f : entradaActiva ? 0xf59e0b
					: variador?.estado === 'listo' ? 0x38bdf8 : 0x22c55e,
				intensidad: fallo ? 0.75 : enMarcha || posicionActiva || variador?.estado === 'marcha' ? 0.42 : 0.25,
			});
		}
	}
}
