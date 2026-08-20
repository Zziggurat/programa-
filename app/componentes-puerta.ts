/**
 * COMPONENTES MONTADOS EN LA PUERTA. El primero, la luz piloto.
 *
 * Esto no es «una lucecita»: es la primera pieza de la arquitectura sobre la que después irán los
 * pulsadores, los selectores, los instrumentos y el HMI. Por eso lo que importa aquí no es el
 * aspecto de la lente, sino tres decisiones:
 *
 *
 * 1. UN PILOTO DE PUERTA ES UN APARATO NORMAL, no una categoría nueva.
 *
 * El proyecto ya sabe qué es un piloto: `tipo: 'piloto'`, dos bornes X1/X2, está en la lista de
 * los que CONSUMEN, y el simulador lo mete en `activos` cuando entre sus dos bornes hay la
 * diferencia de potencial que hace falta. Todo eso ya funciona para los pilotos de placa.
 *
 * Si un piloto de puerta fuese un objeto aparte con su propio «encendido: true», habría dos
 * sistemas eléctricos: el de verdad y uno de mentira que se parece. Aquí no se toca nada de eso:
 * un piloto de puerta es el MISMO `Dispositivo` con la MISMA `Colocacion`, y lo único que cambia
 * es sobre qué superficie va montado. El simulador, el DRC, los potenciales, el esquema, el
 * dossier y el guardado ni se enteran.
 *
 *
 * 2. UNA SOLA PIEZA QUE ATRAVIESA LA CHAPA, no dos mitades a juego.
 *
 * El componente se coloca UNA vez, con su origen en la cara exterior de la puerta. Lo que se ve
 * por fuera —aro y lente— está en z ≥ 0, y lo que se ve al abrir —cuerpo y terminales— está en
 * z < 0, atravesando los quince milímetros de la hoja. No hay dos posiciones que mantener
 * sincronizadas porque no hay dos objetos: hay uno, y la chapa pasa por en medio, igual que un
 * piloto de verdad metido en su taladro de 22 mm.
 *
 * Y como cuelga de la hoja, se abre con ella sin que nadie tenga que acordarse.
 *
 *
 * 3. EL COLOR ES UN PARÁMETRO, no una rama.
 *
 * Rojo, verde, ámbar, azul y blanco salen de la misma función. Lo único que cambia es el número.
 */
import * as THREE from 'three';

import { Colocacion, Dispositivo, RotuloFrontal } from '../src/modelo/tipos.js';
import { cajaCanto, M } from './dispositivos3d.js';
import { marca } from './marcas3d.js';

/**
 * Los colores normalizados de señalización. IEC 60073 les da un significado a cada uno, y por eso
 * el catálogo los ofrece por nombre además de por código: quien monta un tablero piensa en «el
 * rojo de falla», no en `#d32f2f`.
 */
export const COLOR_PILOTO: Record<string, number> = {
	rojo: 0xd8332c,     // falla, parada, peligro
	verde: 0x2fa84f,    // marcha, condición normal
	ambar: 0xefa720,    // aviso, atención
	amarillo: 0xefa720,
	azul: 0x2f7fd8,     // acción obligatoria
	blanco: 0xdfe4e8,   // confirmación, sin significado asignado
};

/** Traduce el color de la ficha del aparato al número que usa el material. */
export function colorDePiloto(d: Dispositivo): number {
	const nombre = (d.colorSenal ?? '').trim().toLowerCase();
	if (COLOR_PILOTO[nombre] !== undefined) return COLOR_PILOTO[nombre];
	if (/^#[0-9a-f]{6}$/i.test(nombre)) return parseInt(nombre.slice(1), 16);
	return COLOR_PILOTO.blanco;
}

/**
 * Apagado NO es «el mismo color sin brillo»: un piloto apagado se ve más oscuro y más denso, que
 * es lo que hace que se lea como una lente de plástico y no como una lámpara fundida. Se baja la
 * luminosidad a poco más de un tercio conservando el tono, para que un rojo apagado siga siendo
 * inconfundiblemente el rojo.
 */
export function colorApagado(color: number): number {
	const c = new THREE.Color(color);
	const hsl = { h: 0, s: 0, l: 0 };
	c.getHSL(hsl);
	c.setHSL(hsl.h, Math.min(1, hsl.s * 0.9), hsl.l * 0.34);
	return c.getHex();
}

/**
 * El degradado del resplandor: opaco en el centro y transparente en el borde. Una sola textura de
 * 64 píxeles que comparten TODOS los pilotos del tablero, porque un resplandor es igual en todos.
 */
let haloCache: THREE.CanvasTexture | undefined;

function degradadoDeHalo(): THREE.CanvasTexture | null {
	if (haloCache) return haloCache;
	if (typeof document === 'undefined') return null;
	const lado = 64;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = lado;
	const ctx = canvas.getContext('2d')!;
	const g = ctx.createRadialGradient(lado / 2, lado / 2, 0, lado / 2, lado / 2, lado / 2);
	// La curva es rápida al principio: el resplandor de un LED se apaga enseguida, no se difumina
	// como una niebla. Con una rampa lineal parecía un halo de foco de teatro.
	g.addColorStop(0, '#ffffff');
	g.addColorStop(0.28, '#8a8a8a');
	g.addColorStop(0.62, '#242424');
	g.addColorStop(1, '#000000');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, lado, lado);
	haloCache = new THREE.CanvasTexture(canvas);
	return haloCache;
}

/* ------------------------------- Medidas del piloto ------------------------------- */

/** Diámetro del taladro: 22 mm es LA medida de la aparamenta de mando y señalización. */
const TALADRO = 22;
const R_ARO = 13.6;
const R_LENTE = 11;
/** Lo que sobresale el conjunto por delante de la chapa. */
const VUELO = 7.4;
/** Fondo de la hoja de la puerta: lo que hay que atravesar para salir por dentro. */
const CHAPA_PUERTA = 15;

/**
 * Construye un piloto para montar en la puerta.
 *
 * El origen del grupo es la CARA EXTERIOR de la puerta: +Z sale hacia el observador con la puerta
 * cerrada, −Z entra en el armario. `escena3d` lo coloca con `puerta.colocar(...)` y no tiene que
 * saber nada más.
 */
export function construirPilotoPuerta(d: Dispositivo, col: Colocacion): THREE.Group {
	const g = new THREE.Group();
	g.userData.dispositivoId = d.id;
	g.userData.montaje = 'puerta';
	const color = colorDePiloto(d);

	/* ---------------- Por fuera: aro, lente y rótulo ---------------- */

	/*
	 * El ARO embellecedor, que es lo que tapa el taladro. Va en cromado mate, como el de una
	 * botonera industrial: el aro es de metal aunque el cuerpo sea de plástico, y esa diferencia
	 * de material es la mitad de lo que hace que la pieza se lea como aparamenta.
	 */
	const aro = new THREE.Mesh(
		new THREE.CylinderGeometry(R_ARO, R_ARO + 0.6, 4.6, 28),
		M.metal(0xb6bcc1),
	);
	aro.rotation.x = Math.PI / 2;
	aro.position.z = 1.6;
	aro.castShadow = true;
	g.add(aro);

	/*
	 * La LENTE. Es la pieza que enciende, y lleva el contrato que espera `animacion-sim`:
	 * `pieza: 'lente'` para encontrarla y `colorPropio` para saber de qué color enciende. Con eso,
	 * el mismo bucle que enciende los pilotos de la placa enciende éste, sin una línea nueva.
	 *
	 * `colorApagado` es lo único que se añade al contrato: sin él, un piloto apagado se pinta de su
	 * color a plena saturación y parece encendido de día.
	 */
	const lente = new THREE.Mesh(
		new THREE.SphereGeometry(R_LENTE, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.42),
		new THREE.MeshStandardMaterial({
			color: colorApagado(color), roughness: 0.22, metalness: 0.0,
			emissive: new THREE.Color(color), emissiveIntensity: 0,
		}),
	);
	lente.rotation.x = Math.PI / 2;
	lente.position.z = VUELO - 4.2;
	lente.scale.z = 0.62;                 // una lente de piloto es un casquete, no media bola
	lente.userData.pieza = 'lente';
	lente.userData.colorPropio = color;
	lente.userData.colorApagado = colorApagado(color);
	g.add(lente);

	/*
	 * EL HALO, y por qué no es una luz.
	 *
	 * Un piloto encendido se ve con un resplandor alrededor de la lente. Resolverlo con una luz
	 * puntual sería lo «correcto» y sería un error: cada piloto añadiría una luz a la escena, con
	 * su coste por fragmento, y encima iluminaría el interior del armario, que es justo lo que no
	 * hace un piloto de 20 mA. Esto es un disco aditivo de una sola malla, sin sombra, sin
	 * profundidad y sin coste apreciable: se ve el resplandor y no ilumina nada.
	 */
	const halo = new THREE.Mesh(
		new THREE.CircleGeometry(R_ARO * 1.28, 24),
		new THREE.MeshBasicMaterial({
			color, transparent: true, opacity: 0, depthWrite: false,
			// Con el disco liso, de cerca el resplandor era un CÍRCULO de color con el canto
			// recortado: se veía el borde de la malla, que es exactamente lo que un resplandor no
			// tiene. El degradado lo apaga hacia fuera y la forma desaparece.
			alphaMap: degradadoDeHalo(),
			blending: THREE.AdditiveBlending, toneMapped: false,
		}),
	);
	halo.position.z = VUELO + 0.6;
	halo.userData.pieza = 'halo';
	halo.raycast = () => undefined;
	g.add(halo);

	/*
	 * AQUÍ EL PILOTO SE DIBUJABA SU PROPIA LETRA, y se la ha quitado.
	 *
	 * Desde que el frontal tiene señalética de verdad —rótulos que se colocan, se mueven, se
	 * alinean y se editan— la leyenda de un mando es un rótulo, no una decoración del mando. Con
	 * las dos cosas a la vez, un piloto con su rótulo debajo salía rotulado DOS veces, una encima
	 * de la otra y sin poder mover ninguna de ellas.
	 *
	 * Quien añade un piloto desde el panel se lleva su rótulo hecho, así que no se pierde nada.
	 */

	/* ---------------- Por dentro: cuerpo y terminales ---------------- */

	/*
	 * EL CUERPO PASANTE, que es lo que atraviesa la chapa. Se mete un milímetro por delante de la
	 * cara exterior y sale por detrás de la interior: ni comparte plano con el aro ni con la
	 * chapa, así que no hay dos caras peleándose por la misma profundidad —la regla que costó dos
	 * fases dejar limpia—.
	 */
	const pasante = new THREE.Mesh(
		new THREE.CylinderGeometry(TALADRO / 2 - 0.4, TALADRO / 2 - 0.4, CHAPA_PUERTA + 8, 20),
		M.tecnico(0x2b2f33),
	);
	pasante.rotation.x = Math.PI / 2;
	pasante.position.z = -(CHAPA_PUERTA + 8) / 2 + 1;
	g.add(pasante);

	// La tuerca de apriete, por dentro: es lo que sujeta el piloto a la chapa.
	const tuerca = new THREE.Mesh(
		new THREE.CylinderGeometry(TALADRO / 2 + 2.6, TALADRO / 2 + 2.6, 4, 6),
		M.metal(0xa9afb4),
	);
	tuerca.rotation.x = Math.PI / 2;
	tuerca.position.z = -CHAPA_PUERTA - 2.6;
	g.add(tuerca);

	// El bloque del portalámparas, con su cuello.
	const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(26, 26, 17), M.tecnico(0x33383d));
	cuerpo.position.z = -CHAPA_PUERTA - 12;
	cuerpo.castShadow = true;
	g.add(cuerpo);

	/*
	 * LOS TERMINALES, uno por borne del aparato. Salen de `d.bornes`, no de una lista escrita
	 * aquí: si mañana un componente de puerta tiene tres bornes, le salen tres tornillos sin tocar
	 * este archivo. Van marcados con su `borneId` para que el día que se cablee la puerta se sepa
	 * cuál es cuál sin adivinar.
	 */
	const bornes = d.bornes.length ? d.bornes : [{ id: 'X1' }, { id: 'X2' }];
	const paso = 26 / (bornes.length + 1);
	bornes.forEach((b, i) => {
		const x = -13 + paso * (i + 1);
		const base = new THREE.Mesh(new THREE.BoxGeometry(paso * 0.8, 9, 6), M.baquelita(0x1d2124));
		base.position.set(x, 0, -CHAPA_PUERTA - 22.5);
		base.userData.borneId = b.id;
		g.add(base);
		const tornillo = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 2.6, 10), M.metal(0xc2c8cd));
		tornillo.position.set(x, 0, -CHAPA_PUERTA - 25.4);
		tornillo.rotation.x = Math.PI / 2;
		g.add(tornillo);
		const rot = marca(b.id, 2.6);
		if (rot) {
			rot.position.set(x, -6.6, -CHAPA_PUERTA - 25.6);
			rot.rotation.y = Math.PI;   // se lee desde dentro del armario, que es de donde se cablea
			g.add(rot);
		}
	});

	/*
	 * ZONA DE AGARRE. La lente mide diez milímetros de radio y a dos metros de distancia son tres
	 * píxeles: la misma historia que los cables. La malla de agarre es invisible, generosa y no
	 * estorba a nada, y además `main` la completa con una tolerancia medida EN PÍXELES, que es lo
	 * único que funciona igual de cerca que de lejos.
	 */
	const agarre = new THREE.Mesh(
		new THREE.CylinderGeometry(R_ARO + 5, R_ARO + 5, VUELO + 6, 12),
		new THREE.MeshBasicMaterial({ visible: false }),
	);
	agarre.rotation.x = Math.PI / 2;
	agarre.position.z = VUELO / 2 - 2;
	agarre.userData.dispositivoId = d.id;
	g.add(agarre);

	// Medidas declaradas, para que el editor sepa cuánto ocupa sin tener que medir la malla.
	col.ancho = col.ancho || TALADRO + 8;
	col.alto = col.alto || TALADRO + 8;
	return g;
}

/** Radio aparente del piloto, en mm: lo usa la selección para saber cuándo el puntero está encima. */
export const RADIO_PILOTO = R_ARO;

/* ==================================================================================
 * EL REGISTRO DE COMPONENTES DE FRONTAL
 *
 * Hoy solo hay pilotos. Mañana habrá pulsadores NA/NC, setas de emergencia, selectores de dos y
 * tres posiciones, voltímetros, amperímetros, multimedidores y pantallas. Todos comparten lo
 * mismo y por eso caben en la misma ficha:
 *
 *   · ocupan un TALADRO en la chapa —redondo de 22 mm los mandos, rectangular los instrumentos—;
 *   · sobresalen por fuera y entran por dentro;
 *   · son `Dispositivo` normales para el resto del programa.
 *
 * Añadir una familia es registrar una ficha. No hay que tocar la escena, ni la animación, ni la
 * selección, ni el editor del frontal, ni el guardado: todos preguntan por la ficha y ninguno sabe
 * qué familias existen.
 * ================================================================================== */

/** El hueco que un componente ocupa en la chapa. Lo usan el dibujo y el editor del frontal. */
export interface HuellaFrontal {
	forma: 'redonda' | 'rectangular';
	/** Diámetro si es redonda; ancho si es rectangular. En mm. */
	ancho: number;
	/** Alto, solo para las rectangulares. */
	alto?: number;
}

export interface FichaFrontal {
	/** Nombre de la familia, para la interfaz. */
	familia: string;
	/** El hueco que ocupa este aparato concreto (puede depender de su ficha). */
	huella(d: Dispositivo): HuellaFrontal;
	/** La geometría, con el origen en la CARA EXTERIOR de la puerta y +Z hacia el observador. */
	construir(d: Dispositivo, col: Colocacion): THREE.Group;
}

const FICHAS = new Map<string, FichaFrontal>();

/** Da de alta una familia de componentes de frontal. */
export function registrarFrontal(tipo: string, ficha: FichaFrontal): void {
	FICHAS.set(tipo, ficha);
}

/**
 * La ficha de un aparato. Lo que NO se conoce se dibuja como un mando redondo de 22 mm en vez de
 * desaparecer: un aparato montado en la puerta que no se ve es un aparato que el usuario cree que
 * ha perdido.
 */
export function fichaFrontal(d: Dispositivo): FichaFrontal {
	return FICHAS.get(d.tipo) ?? FICHAS.get('piloto')!;
}

registrarFrontal('piloto', {
	familia: 'Luz piloto',
	huella: () => ({ forma: 'redonda', ancho: TALADRO }),
	construir: construirPilotoPuerta,
});

/** Construye el componente de frontal que le toque a este aparato. */
export function construirComponentePuerta(d: Dispositivo, col: Colocacion): THREE.Group {
	return fichaFrontal(d).construir(d, col);
}

/** El hueco que ocupa un aparato en la chapa del frontal. */
export function huellaFrontal(d: Dispositivo): HuellaFrontal {
	return fichaFrontal(d).huella(d);
}

/* ==================================================================================
 * SEÑALÉTICA: las placas y los rótulos grabados
 *
 * Un rótulo NO es geometría de texto. Se dibuja con el mismo atlas de serigrafía que ya llevan los
 * bornes y los aparatos: cada palabra ocupa una celda y la comparten todos los rótulos del
 * tablero, así que dos placas que digan «MARCHA» cuestan una sola vez. Un tablero con cuarenta
 * rótulos sigue siendo una textura.
 *
 * Se parte por PALABRAS y no por líneas enteras porque las palabras se repiten —MARCHA, MOTOR,
 * TABLERO, FALLA— y las frases no. Y de paso el texto se ajusta al ancho de la placa en vez de
 * aplastarse para caber en una celda.
 * ================================================================================== */

/** Colores de cada estilo de rótulo: fondo, letra y borde. */
const ESTILO_ROTULO = {
	grabado: { fondo: undefined, letra: false, borde: undefined },
	placa: { fondo: 0xe7e9ea, letra: false, borde: 0x8d9499 },
	aviso: { fondo: 0xf2c515, letra: false, borde: 0x1c1c1c },
} as const;

/** Alto de letra por defecto, en mm. */
const ALTO_ROTULO = 5;

function anchoDe(m: THREE.Mesh): number {
	return (m.geometry as THREE.PlaneGeometry).parameters?.width ?? 0;
}

/**
 * Construye un rótulo del frontal. El origen va en la CARA EXTERIOR de la puerta, igual que el de
 * los componentes, y el rótulo queda centrado en el punto que se le da.
 */
export function construirRotuloFrontal(r: RotuloFrontal): THREE.Group {
	const g = new THREE.Group();
	g.userData.rotuloId = r.id;
	const alto = Math.max(2, r.alto ?? ALTO_ROTULO);
	const estilo = ESTILO_ROTULO[r.estilo ?? 'grabado'];
	const anchoMax = r.ancho ?? Math.max(40, alto * 16);

	// Cada palabra, medida, y repartida en líneas que quepan.
	const espacio = alto * 0.42;
	const lineas: THREE.Mesh[][] = [[]];
	let usado = 0;
	for (const trozo of r.texto.split(/\n/)) {
		if (lineas[lineas.length - 1].length) { lineas.push([]); usado = 0; }
		for (const palabra of trozo.split(/\s+/).filter(Boolean)) {
			const m = marca(palabra, alto, !!estilo.letra);
			if (!m) continue;
			const w = anchoDe(m);
			const fila = lineas[lineas.length - 1];
			if (fila.length && usado + espacio + w > anchoMax) { lineas.push([m]); usado = w; continue; }
			fila.push(m);
			usado += (fila.length > 1 ? espacio : 0) + w;
		}
	}
	const conTexto = lineas.filter((l) => l.length);

	/*
	 * Sin atlas —fuera del navegador, o con el atlas lleno— no hay letras. La placa se dibuja
	 * igual: es mejor una placa en blanco, que se ve y se puede mover, que un rótulo invisible que
	 * el usuario cree que ha perdido.
	 */
	const salto = alto * 1.42;
	const anchoTexto = Math.max(
		alto * 4,
		...conTexto.map((f) => f.reduce((a, m, i) => a + anchoDe(m) + (i ? espacio : 0), 0)),
	);
	const altoTexto = Math.max(alto, conTexto.length * salto - (salto - alto));

	/*
	 * LA PLACA, cuando la lleva. Va sobre la chapa, no dentro: una placa de señalización se
	 * atornilla o se pega encima, y el escalón de un milímetro es lo que la hace verse como una
	 * pieza y no como algo pintado. El texto va delante de la placa, nunca en su mismo plano.
	 */
	let zTexto = 0.35;
	if (estilo.fondo !== undefined) {
		const margen = alto * 0.75;
		const placa = cajaCanto(anchoTexto + margen * 2, altoTexto + margen * 1.6, 1.6,
			M.plastico(estilo.fondo, 0.5), 0, 0, 0.8, Math.min(3, alto * 0.5), 0.3);
		placa.castShadow = true;
		g.add(placa);
		if (estilo.borde !== undefined) {
			// El borde es un marco un pelo más grande y MÁS HUNDIDO, así que no comparte plano con
			// la placa: asoma por los cuatro lados y por detrás, como el canto de una pieza.
			const borde = cajaCanto(anchoTexto + margen * 2 + 2.4, altoTexto + margen * 1.6 + 2.4, 1.2,
				M.plastico(estilo.borde, 0.6), 0, 0, 0.4, Math.min(3.6, alto * 0.6), 0.3);
			g.add(borde);
		}
		zTexto = 1.75;
	}

	// Y las palabras, línea a línea, centradas.
	conTexto.forEach((fila, f) => {
		const anchoFila = fila.reduce((a, m, i) => a + anchoDe(m) + (i ? espacio : 0), 0);
		let x = -anchoFila / 2;
		const y = altoTexto / 2 - alto / 2 - f * salto;
		for (const m of fila) {
			m.position.set(x + anchoDe(m) / 2, y, zTexto);
			x += anchoDe(m) + espacio;
			g.add(m);
		}
	});

	g.userData.huellaRotulo = { ancho: anchoTexto, alto: altoTexto };
	return g;
}
