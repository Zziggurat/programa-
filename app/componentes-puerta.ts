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

/* ------------------------------- Medidas del piloto -------------------------------
 *
 * TODAS SALEN DE UN Ø22 DE VERDAD, no de «qué tal se ve». Un piloto de señalización normalizado
 * se monta en un taladro de 22 mm, calza un embellecedor de unos 29 mm y enseña una lente de 21
 * a 23. Ésas son las tres cotas, y lo demás se deduce de ellas: si la pieza parece pequeña en la
 * puerta es porque una puerta de armario es grande, no porque falte tamaño. En la foto de un
 * tablero real tres pilotos ocupan un palmo de una hoja de medio metro.
 */

/** Diámetro del taladro: 22 mm es LA medida de la aparamenta de mando y señalización. */
const TALADRO = 22;
/** Radio exterior del aro embellecedor. Un Ø22 real calza un embellecedor de unos 29 mm. */
const R_ARO = 14.85;
/**
 * Radio del vidrio: Ø21, la parte baja de la horquilla de catálogo (21 a 23).
 *
 * Se bajó desde Ø22 mirando la primera tanda de fotos: con la lente en el máximo de la horquilla
 * y el aro en el mínimo, al aro le quedaban tres milímetros y medio de anchura y de frente no se
 * leía como un embellecedor, sino como un contorno. Con Ø21 de lente y Ø29,7 de aro la corona
 * pasa a cuatro milímetros y medio, que es lo que hace que la pieza se reconozca a dos metros.
 */
const R_LENTE = 10.5;
/** Lo que sobresale el conjunto por delante de la chapa. Y ahora se cumple: ver `perfilLente`. */
const VUELO = 8;
/** Hasta dónde llega el resplandor sobre la chapa. Poco más que el aro no se ve; ver el halo. */
const R_HALO = 34;
/** Fondo de la hoja de la puerta: lo que hay que atravesar para salir por dentro. */
const CHAPA_PUERTA = 15;
/** Altura de la boca del aro. La lente asoma justo por encima de ella. */
const ALTO_ARO = 5.1;

/**
 * EL PERFIL DE LA LENTE, Y POR QUÉ AHORA ES CASI PLANA.
 *
 * Aquí hubo primero un casquete esférico aplastado por el eje equivocado —la lente salía ovalada
 * y sobresalía catorce milímetros— y después una cúpula de revolución correcta pero demasiado
 * alta: cuatro milímetros y ocho décimas de domo sobre veinte de diámetro seguían leyéndose como
 * media bola de caramelo. Puesta al lado de la fotografía de un piloto de catálogo la diferencia
 * es evidente: la lente de un Ø22 es un disco levemente abombado, con un faldón recto que asoma
 * por la boca del aro y un domo de dos milímetros y pico. Casi todo el vuelo lo pone el aro.
 *
 * Es un PERFIL DE REVOLUCIÓN, que no tiene ejes que confundir: lo que mide el dibujo es lo que
 * mide la pieza, y el vuelo sale de la última cota y no de un factor de escala.
 *
 * Y el orden de los puntos importa por partida doble. `LatheGeometry` reparte la coordenada `v`
 * de la textura a lo largo del perfil —`v = j / (puntos - 1)`—, así que el punto 0 (el asiento,
 * en el borde) es `v = 0` y el último (el centro del domo) es `v = 1`. Eso convierte una simple
 * franja vertical en un degradado RADIAL exacto, que es lo que hace falta para que la lente
 * encendida tenga el centro casi blanco y el borde saturado, como en una foto de verdad, sin
 * pagar ni una luz ni un shader propio.
 */
function perfilLente(): THREE.LatheGeometry {
	const R = R_LENTE;
	const puntos = [
		new THREE.Vector2(R, 0),           // asiento, dentro del aro
		new THREE.Vector2(R, 5.2),         // faldón recto: lo que asoma por la boca del aro
		new THREE.Vector2(R * 0.985, 5.9), // labio: el canto matado del vidrio
		new THREE.Vector2(R * 0.94, 6.55),
		new THREE.Vector2(R * 0.84, 7.1),
		new THREE.Vector2(R * 0.66, 7.55),
		new THREE.Vector2(R * 0.38, 7.86),
		new THREE.Vector2(0, VUELO),       // el domo acaba EXACTAMENTE en el vuelo prometido
	];
	return new THREE.LatheGeometry(puntos, 32);
}

/**
 * EL ARO EMBELLECEDOR: un ANILLO de plástico negro, no una arandela gris.
 *
 * Dos correcciones seguidas. La primera fue de forma: era un cilindro macizo, así que la lente
 * nacía enterrada y solo se veía la cúpula flotando sobre un disco. Un embellecedor de verdad
 * tiene hueco, y por él asoma el faldón de la lente; esa sombra estrecha entre el vidrio y el
 * plástico es la mitad de lo que hace que la pieza se lea como aparamenta montada.
 *
 * La segunda es de material, y viene de mirar la fotografía en vez de imaginarla: el aro de un
 * piloto Ø22 moderno NO es metal satinado. Es plástico negro mate, y contra una hoja clara eso
 * es lo que dibuja el anillo oscuro que se reconoce a tres metros. En cromado se confundía con
 * la chapa y desaparecía; en negro, la pieza aparece.
 *
 * El perfil lleva pared interior, boca matada, cara superior, chaflán exterior y falda: cinco
 * cantos que la luz puede coger. Un anillo sin chaflanes es un tubo, y un tubo no tiene volumen.
 */
function perfilAro(): THREE.LatheGeometry {
	/*
	 * EL ORDEN DE LOS PUNTOS DECIDE HACIA DÓNDE MIRA LA PIEZA, y aquí estaba al revés. Ése era
	 * el motivo real de que el aro se viera «como una arandela gris plana sin volumen»: NO SE
	 * VEÍA EL ARO. Lo que se veía era su SOMBRA sobre la chapa.
	 *
	 * `LatheGeometry` saca la normal de la dirección del perfil —normal = (Δy, −Δx)— así que un
	 * perfil recorrido de dentro hacia fuera deja la cara superior mirando hacia ABAJO y la falda
	 * exterior mirando hacia el eje. Con `side: FrontSide`, que es lo normal, el trazado de rayos
	 * y el dibujado descartan las dos: el anillo desaparecía entero. Seguía proyectando sombra
	 * —el mapa de sombras usa la cara contraria— y ese cerco oscuro sobre la puerta era todo lo
	 * que quedaba de él. Se comprobó pintándolo de magenta y a doble cara: aparecía.
	 *
	 * Se recorre de FUERA HACIA DENTRO, que es lo que deja las normales hacia el observador.
	 */
	const puntos = [
		new THREE.Vector2(R_ARO, -0.8),                    // falda exterior, apoyada en la puerta
		new THREE.Vector2(R_ARO, ALTO_ARO - 1.9),
		new THREE.Vector2(R_ARO - 0.25, ALTO_ARO - 0.85),  // chaflán exterior
		new THREE.Vector2(R_ARO - 1.15, ALTO_ARO),         // cara superior: PLANA y ancha, 2,7 mm
		new THREE.Vector2(R_LENTE + 1.1, ALTO_ARO),        // el canto matado de la boca
		new THREE.Vector2(R_LENTE + 0.5, ALTO_ARO - 1.1),
		new THREE.Vector2(R_LENTE + 0.5, -0.8),            // pared interior, metida en la chapa
	];
	return new THREE.LatheGeometry(puntos, 32);
}

/**
 * EL DEGRADADO DE LA LENTE ENCENDIDA, en una tira de 4 × 64 píxeles por color.
 *
 * Un piloto encendido NO es un disco de color plano. La lámpara está detrás del centro, así que
 * el centro se quema hacia el blanco y el color solo se reconoce en la corona exterior, donde el
 * plástico teñido tiene más camino que atravesar. Eso es lo que se ve en cualquier fotografía de
 * un tablero encendido, y era exactamente lo que faltaba: un rojo uniforme de borde a borde se
 * lee como una pegatina.
 *
 * Se resuelve con un `emissiveMap` y sin tocar la iluminación de la escena. El material emite
 * BLANCO y la textura pone el color: donde la textura es blanca sale blanco, donde es roja sale
 * roja. Como `v` recorre el perfil de la lente, la tira vertical se convierte en un degradado
 * concéntrico perfecto.
 *
 * Hay una textura por COLOR, no por piloto: tres pilotos rojos comparten la suya, y el tablero
 * entero no pasa de cinco.
 */
const emisionCache = new Map<number, THREE.CanvasTexture | null>();

function degradadoDeLente(color: number): THREE.CanvasTexture | null {
	const guardado = emisionCache.get(color);
	if (guardado !== undefined) return guardado;
	if (typeof document === 'undefined') { emisionCache.set(color, null); return null; }
	const lienzo = document.createElement('canvas');
	lienzo.width = 4; lienzo.height = 64;
	const ctx = lienzo.getContext('2d')!;
	const c = new THREE.Color(color);
	const hsl = { h: 0, s: 0, l: 0 };
	c.getHSL(hsl);
	// El borde, a plena saturación; hacia el centro se desatura y sube de luminosidad hasta el
	// blanco. Se hace en HSL y no interpolando a `#ffffff` porque interpolar en RGB pasa por
	// rosas y verdes pálidos que no se parecen a una lámpara.
	const tono = (l: number, sat: number) => `#${new THREE.Color().setHSL(hsl.h, hsl.s * sat, l).getHexString()}`;
	/*
	 * `v = 1` es el CENTRO del domo y, con `flipY` puesto, cae en la fila de arriba del lienzo.
	 *
	 * Y las paradas NO son proporcionales al radio, porque `v` recorre los PUNTOS del perfil y
	 * el perfil no reparte el radio a partes iguales. Traducidas: y=0,12 cae a un tercio del
	 * radio, y=0,26 a dos tercios y y=0,45 ya al 85 %. Con las paradas repartidas «a ojo» sobre
	 * el lienzo, el núcleo blanco se comía dos tercios de la lente y un piloto rojo encendido se
	 * veía blanco con un filo rojo; en la fotografía de un tablero de verdad es al revés: rojo
	 * con un núcleo blanco pequeño.
	 */
	const g = ctx.createLinearGradient(0, 0, 0, 64);
	g.addColorStop(0.00, '#ffffff');                            // centro: el filamento
	g.addColorStop(0.12, tono(0.88, 0.35));                     // núcleo caliente, hasta 1/3 del radio
	g.addColorStop(0.26, tono(0.62, 0.9));                      // a dos tercios ya se reconoce el color
	g.addColorStop(0.45, tono(Math.min(0.46, hsl.l), 1));       // corona saturada
	g.addColorStop(1.00, tono(Math.min(0.4, hsl.l * 0.85), 1)); // borde, contra el aro
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 4, 64);
	const tex = new THREE.CanvasTexture(lienzo);
	tex.colorSpace = THREE.SRGBColorSpace;
	emisionCache.set(color, tex);
	return tex;
}

/**
 * El degradado del CERCO de contacto: opaco pegado al aro y apagándose enseguida hacia fuera.
 * Compartido por todos los pilotos, igual que el del halo: un asiento es igual en todos.
 */
let cercoCache: THREE.CanvasTexture | null | undefined;

function degradadoDeCerco(): THREE.CanvasTexture | null {
	if (cercoCache !== undefined) return cercoCache;
	if (typeof document === 'undefined') { cercoCache = null; return null; }
	const lienzo = document.createElement('canvas');
	lienzo.width = lienzo.height = 32;
	const ctx = lienzo.getContext('2d')!;
	/*
	 * `RingGeometry` mapea la textura sobre el CUADRADO que envuelve al anillo, centrada: un
	 * degradado concéntrico en el lienzo sale concéntrico en la pieza. El anillo va de 14,4 a
	 * 17,2 mm, o sea del 84 % al 100 % del radio exterior, así que toda la caída tiene que
	 * ocurrir en ese último dieciséis por ciento del lienzo.
	 */
	const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
	g.addColorStop(0, '#ffffff');
	g.addColorStop(0.84, '#ffffff');   // pegado al aro: la sombra es más densa
	g.addColorStop(0.92, '#5a5a5a');
	g.addColorStop(1, '#000000');      // y se ha ido
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 32, 32);
	cercoCache = new THREE.CanvasTexture(lienzo);
	return cercoCache;
}

/**
 * Y EL MISMO TRUCO PARA LA LENTE APAGADA, en escala de grises y compartido por todos.
 *
 * Apagada, una lente de plástico teñido tampoco es plana: el centro deja ver el interior hueco y
 * se aclara un punto, y el borde —donde el espesor es mayor— queda más denso. Multiplicando el
 * color por esta tira se consigue ese relieve sin una textura por color, porque es el MISMO
 * degradado para todos: solo cambia el color que lo multiplica.
 */
let densidadCache: THREE.CanvasTexture | null | undefined;

function densidadDeLente(): THREE.CanvasTexture | null {
	if (densidadCache !== undefined) return densidadCache;
	if (typeof document === 'undefined') { densidadCache = null; return null; }
	const lienzo = document.createElement('canvas');
	lienzo.width = 4; lienzo.height = 64;
	const ctx = lienzo.getContext('2d')!;
	/*
	 * Y VA AL REVÉS QUE EL DE ENCENDIDO, que es lo que se ve en la foto: apagada, la lente deja
	 * ver por el centro el hueco oscuro donde vive la lámpara, y es el BORDE —donde el plástico
	 * teñido tiene más espesor y coge luz rasante— el que se ve más claro. Oscuro en el centro,
	 * pero nunca negro: sigue siendo plástico de color, no un agujero.
	 */
	const g = ctx.createLinearGradient(0, 0, 0, 64);
	g.addColorStop(0, '#b2b2b2');   // centro: el pozo de la lámpara
	g.addColorStop(0.45, '#d6d6d6');
	g.addColorStop(1, '#ffffff');   // borde: el canto del vidrio
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 4, 64);
	densidadCache = new THREE.CanvasTexture(lienzo);
	densidadCache.colorSpace = THREE.SRGBColorSpace;
	return densidadCache;
}

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
	 * El ARO embellecedor, que es lo que tapa el taladro: plástico negro mate, como el de la
	 * fotografía. Proyecta sombra sobre la chapa a propósito —es lo que le da el asiento— y por
	 * eso la hoja la recibe: sin esa media luna de sombra al pie del aro, la pieza flota.
	 */
	/*
	 * El negro no es negro del todo y el satinado no es mate del todo, a propósito: con
	 * `M.tecnico` puro —rugosidad 0,72 sobre un 0x17— el aro se comía toda la luz y el chaflán
	 * dejaba de existir, que es justo lo que se quería ganar dándole un chaflán. Con algo más de
	 * brillo el canto devuelve una línea y la corona se lee como una pieza de plástico moldeado.
	 */
	const aro = new THREE.Mesh(perfilAro(), new THREE.MeshStandardMaterial({
		color: 0x1c1f22, roughness: 0.5, metalness: 0.05,
	}));
	aro.rotation.x = Math.PI / 2;
	aro.castShadow = true;
	g.add(aro);

	/*
	 * Y UN CERCO DE CONTACTO, que es sombra dibujada y no calculada.
	 *
	 * La sombra proyectada depende de dónde esté el sol de la escena: mirando el tablero de
	 * frente, con la luz casi de frente también, el aro no proyecta casi nada y vuelve a
	 * despegarse de la chapa. Este anillo oscurísimo y muy corto, pegado a la puerta, hace el
	 * papel de la oclusión ambiental del contacto: no se ve como una pieza, se ve como el
	 * asiento del aro. Es una malla sin sombra ni escritura de profundidad, así que no participa
	 * en ninguna de las peleas de coplanaridad que costó dos fases dejar limpias.
	 */
	const cerco = new THREE.Mesh(
		new THREE.RingGeometry(R_ARO - 0.2, R_ARO + 2.8, 32),
		new THREE.MeshBasicMaterial({
			color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
			alphaMap: degradadoDeCerco() ?? undefined,
		}),
	);
	cerco.position.z = 0.6;
	cerco.raycast = () => undefined;
	g.add(cerco);

	/*
	 * La LENTE. Es la pieza que enciende, y lleva el contrato que espera `animacion-sim`:
	 * `pieza: 'lente'` para encontrarla y `colorPropio` para saber de qué color enciende. Con eso,
	 * el mismo bucle que enciende los pilotos de la placa enciende éste, sin una línea nueva.
	 *
	 * `colorApagado` es lo único que se añade al contrato: sin él, un piloto apagado se pinta de su
	 * color a plena saturación y parece encendido de día.
	 */
	const lente = new THREE.Mesh(
		perfilLente(),
		new THREE.MeshStandardMaterial({
			/*
			 * NO ES UN PLÁSTICO PULIDO. Una lente de piloto DIFUNDE: por eso se ve encendida
			 * desde un lado del pasillo y no como un punto de luz que solo existe de frente. Con
			 * `roughness` de espejo salía un reflejo blanco duro que la convertía en un caramelo.
			 */
			color: colorApagado(color), roughness: 0.4, metalness: 0.0,
			map: densidadDeLente() ?? undefined,
			/*
			 * EMITE BLANCO Y EL COLOR LO PONE LA TEXTURA. Es lo que permite que el centro se
			 * queme hacia el blanco y el borde se quede saturado: con `emissive` de color, un
			 * mapa en escala de grises solo puede oscurecer, nunca desaturar, así que un rojo
			 * encendido no podía tener el núcleo blanco por mucho que se subiera la intensidad
			 * —lo único que conseguía era un rojo plano más brillante—.
			 */
			emissive: new THREE.Color(0xffffff), emissiveIntensity: 0,
			emissiveMap: degradadoDeLente(color) ?? undefined,
		}),
	);
	lente.rotation.x = Math.PI / 2;
	lente.userData.pieza = 'lente';
	lente.userData.colorPropio = color;
	lente.userData.colorApagado = colorApagado(color);
	/*
	 * El contrato con `animacion-sim`: de qué color EMITE. Blanco, porque el color lo lleva el
	 * `emissiveMap`. Los aparatos que no lo declaran siguen emitiendo su propio color, así que
	 * ningún piloto de placa cambia de aspecto por esto.
	 */
	lente.userData.colorEmision = 0xffffff;
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
	/*
	 * EL DISCO ERA DEMASIADO PEQUEÑO PARA VERSE, Y ESTABA DELANTE DE LA LENTE.
	 *
	 * Medido sobre la build —perfil radial de luminancia alrededor del piloto, apagado contra
	 * encendido— el resplandor aportaba +9 sobre 255 en el propio aro y CERO fuera de él a
	 * cualquier distancia. O sea: no existía. El radio era 1,28 × el aro, así que todo el
	 * degradado se consumía por debajo del metal y lo poco que sobraba se apagaba en cuatro
	 * milímetros.
	 *
	 * Ahora el disco es bastante mayor que el aro y va PEGADO A LA CHAPA, no volando por delante
	 * de la lente. Con eso el resplandor cae donde tiene que caer —en la puerta, alrededor del
	 * embellecedor— y el aro y la lente, que son opacos y están delante, tapan el centro solos.
	 * De canto el disco queda a milímetro y medio de la chapa, así que no aparece la raya
	 * luminosa flotante que delataba al truco.
	 */
	const halo = new THREE.Mesh(
		new THREE.CircleGeometry(R_HALO, 28),
		new THREE.MeshBasicMaterial({
			color, transparent: true, opacity: 0, depthWrite: false,
			// Con el disco liso, de cerca el resplandor era un CÍRCULO de color con el canto
			// recortado: se veía el borde de la malla, que es exactamente lo que un resplandor no
			// tiene. El degradado lo apaga hacia fuera y la forma desaparece.
			alphaMap: degradadoDeHalo(),
			blending: THREE.AdditiveBlending, toneMapped: false,
		}),
	);
	halo.position.z = 1.4;
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
		M.tecnico(0x212427),
	);
	pasante.rotation.x = Math.PI / 2;
	pasante.position.z = -(CHAPA_PUERTA + 8) / 2 + 1;
	g.add(pasante);

	/*
	 * LA TUERCA DE APRIETE, por dentro: es lo que sujeta el piloto a la chapa. En un Ø22 de
	 * catálogo es de plástico negro con seis caras y no de acero, y de eso hay foto: la única
	 * pieza metálica que se ve por dentro son los tornillos de los terminales.
	 */
	const tuerca = new THREE.Mesh(
		new THREE.CylinderGeometry(TALADRO / 2 + 2.8, TALADRO / 2 + 2.8, 4.2, 6),
		M.tecnico(0x26292c),
	);
	tuerca.rotation.x = Math.PI / 2;
	tuerca.position.z = -CHAPA_PUERTA - 2.7;
	g.add(tuerca);

	/*
	 * EL CUERPO DEL PORTALÁMPARAS, cilíndrico y con nervios.
	 *
	 * Era una caja lisa de 26 mm, y una caja lisa negra en la penumbra del armario es una mancha:
	 * al abrir la puerta no se distinguía de la chapa que tiene detrás. Un piloto de verdad es un
	 * cilindro con anillos de refuerzo y ventilación, y esos anillos son lo único que hay ahí
	 * dentro para que la luz rasante marque la pieza. Tres anillos y un cuerpo: cuatro mallas,
	 * ninguna transparencia y ninguna sombra nueva.
	 */
	const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(12.6, 11.4, 18, 20), M.tecnico(0x232629));
	cuerpo.rotation.x = Math.PI / 2;
	cuerpo.position.z = -CHAPA_PUERTA - 12.5;
	cuerpo.castShadow = true;
	g.add(cuerpo);
	for (let i = 0; i < 3; i++) {
		const nervio = new THREE.Mesh(
			new THREE.CylinderGeometry(13.4 - i * 0.35, 13.4 - i * 0.35, 1.8, 20),
			M.tecnico(0x1b1e21),
		);
		nervio.rotation.x = Math.PI / 2;
		nervio.position.z = -CHAPA_PUERTA - 7.5 - i * 4.6;
		g.add(nervio);
	}
	// El zócalo donde apoyan los terminales, un poco más estrecho que el cuerpo.
	const zocalo = new THREE.Mesh(new THREE.BoxGeometry(24, 20, 7), M.tecnico(0x1f2225));
	zocalo.position.z = -CHAPA_PUERTA - 24;
	zocalo.castShadow = true;
	g.add(zocalo);

	/*
	 * LOS TERMINALES, uno por borne del aparato. Salen de `d.bornes`, no de una lista escrita
	 * aquí: si mañana un componente de puerta tiene tres bornes, le salen tres tornillos sin tocar
	 * este archivo. Van marcados con su `borneId` para que el día que se cablee la puerta se sepa
	 * cuál es cuál sin adivinar.
	 */
	const bornes = d.bornes.length ? d.bornes : [{ id: 'X1' }, { id: 'X2' }];
	const paso = 24 / (bornes.length + 1);
	// La cara trasera del zócalo: de ahí para atrás salen las regletas, y de ahí sale también la
	// cota de los cables del mazo. Una sola cota, para que nada quede enterrado en el plástico.
	const zBorne = -CHAPA_PUERTA - 28.5;
	bornes.forEach((b, i) => {
		const x = -12 + paso * (i + 1);
		const base = new THREE.Mesh(new THREE.BoxGeometry(paso * 0.82, 9, 6), M.baquelita(0x15181a));
		base.position.set(x, 0, zBorne);
		base.userData.borneId = b.id;
		g.add(base);
		const tornillo = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 2.6, 10), M.metal(0xc2c8cd));
		tornillo.position.set(x, 0, zBorne - 3.4);
		tornillo.rotation.x = Math.PI / 2;
		g.add(tornillo);
		const rot = marca(b.id, 2.6);
		if (rot) {
			rot.position.set(x, -6.6, zBorne - 3.2);
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
	/*
	 * ES UNA ZONA DE AGARRE, NO UNA PIEZA: se marca como tal para que no le robe el clic a nada
	 * que se vea. Es un cilindro INVISIBLE y bastante más gordo que la lente, así que sin esta
	 * marca tapaba —para el ratón, no para los ojos— todo lo que pasara por detrás. Y por detrás
	 * pasa ahora el mazo: los puentes que unen dos pilotos por la cara interior de la hoja no se
	 * podían seleccionar desde ningún ángulo, porque a treinta y cuatro milímetros por delante
	 * había un cilindro que nadie ve. Misma regla que el tubo de agarre de los cables: gana
	 * siempre lo visible.
	 */
	agarre.userData.agarre = true;
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

/**
 * UNA PROPIEDAD CONFIGURABLE, declarada por la ficha y presentada sola por el editor.
 *
 * Ésta es la pieza que faltaba y la que causó el fallo del color. El piloto TENÍA su color en el
 * modelo, el constructor lo leía y el material lo pintaba… pero no había ni un solo control en
 * ninguna parte para cambiarlo, así que un piloto nacía verde y verde se quedaba. Y la ficha del
 * aparato, en el espacio Frontal, ofrecía únicamente los controles de cablear.
 *
 * El arreglo no es «añadir un selector de color al piloto»: eso lo volvería a dejar roto para el
 * pulsador, para el selector y para la seta. La ficha DECLARA qué se puede configurar y el editor
 * lo dibuja sin saber de qué familia se trata. Registrar una familia nueva con sus propiedades no
 * toca ni una línea de la interfaz.
 */
export interface PropiedadFrontal {
	/** Dónde vive en el modelo: una clave de `Dispositivo`. */
	clave: 'colorSenal' | 'designacion' | 'descripcion' | 'tensionNominal';
	etiqueta: string;
	/**
	 * Cómo se edita:
	 *  · `texto`  — una línea
	 *  · `numero` — un número con unidad
	 *  · `lista`  — una de las `opciones`
	 */
	tipo: 'texto' | 'numero' | 'lista';
	opciones?: { valor: string; texto: string }[];
	unidad?: string;
	/** Qué se guarda al crear el aparato si nadie dice otra cosa. */
	porDefecto?: string | number;
	/**
	 * True cuando cambiarla obliga a rehacer la geometría (un color de lente sí; una descripción
	 * no). Sirve para no reconstruir nada que no haga falta.
	 */
	rehaceGeometria?: boolean;
}

export interface FichaFrontal {
	/** Nombre de la familia, para la interfaz. */
	familia: string;
	/** El hueco que ocupa este aparato concreto (puede depender de su ficha). */
	huella(d: Dispositivo): HuellaFrontal;
	/** La geometría, con el origen en la CARA EXTERIOR de la puerta y +Z hacia el observador. */
	construir(d: Dispositivo, col: Colocacion): THREE.Group;
	/** Lo que el editor deja configurar. La posición y el identificador los pone él por su cuenta. */
	propiedades: PropiedadFrontal[];
}

/** Las cinco de señalización de IEC 60073, para que las ofrezca cualquier familia que las use. */
export const OPCIONES_COLOR: { valor: string; texto: string }[] = [
	{ valor: 'rojo', texto: 'Rojo — falla, parada, peligro' },
	{ valor: 'verde', texto: 'Verde — marcha, condición normal' },
	{ valor: 'ambar', texto: 'Ámbar — aviso, atención' },
	{ valor: 'azul', texto: 'Azul — acción obligatoria' },
	{ valor: 'blanco', texto: 'Blanco — confirmación, sin significado' },
];

const FICHAS = new Map<string, FichaFrontal>();

/**
 * Un punto PE soldado a la hoja vive solo por su cara interior. No es un piloto sin lente: es el
 * perno, la arandela dentada y la borna anular sobre la que termina el conductor de protección.
 * Se reconoce por semántica explícita (`bornero` con bornes exclusivamente PE), nunca por texto.
 */
function construirPuntoPePuerta(d: Dispositivo): THREE.Group {
	const g = new THREE.Group();
	g.userData.dispositivoId = d.id;
	g.userData.montaje = 'puerta';

	const zBase = -CHAPA_PUERTA - 2.4;
	const apoyo = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 2.8, 24), M.metal(0xaeb5ba));
	apoyo.rotation.x = Math.PI / 2;
	apoyo.position.z = zBase;
	apoyo.userData.pieza = 'punto-pe';
	g.add(apoyo);

	// La arandela verde/amarilla hace identificable la función sin convertir el color en semántica.
	const identificador = new THREE.Mesh(
		new THREE.TorusGeometry(9.2, 2.2, 8, 24),
		new THREE.MeshStandardMaterial({ color: 0x59a832, roughness: 0.62, metalness: 0.05 }),
	);
	identificador.position.z = zBase - 2;
	identificador.userData.pieza = 'identificador-pe';
	g.add(identificador);
	const marcaAmarilla = new THREE.Mesh(new THREE.BoxGeometry(16, 3.2, 1.2), M.tecnico(0xe0c52e));
	marcaAmarilla.position.z = zBase - 3.1;
	marcaAmarilla.rotation.z = Math.PI / 4;
	marcaAmarilla.raycast = () => undefined;
	g.add(marcaAmarilla);

	const perno = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 15, 12), M.metal(0xc7cdd1));
	perno.rotation.x = Math.PI / 2;
	perno.position.z = zBase - 8;
	perno.castShadow = true;
	g.add(perno);
	const tuerca = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 3.5, 6), M.metal(0xb8bec2));
	tuerca.rotation.x = Math.PI / 2;
	tuerca.position.z = zBase - 13.5;
	g.add(tuerca);

	// Éste es el punto geométrico al que llega el mazo. Lleva el id persistente del borne real.
	const terminal = new THREE.Mesh(new THREE.BoxGeometry(11, 8, 3), M.metal(0xc5a45d));
	terminal.position.set(0, 0, zBase - 17);
	terminal.userData.borneId = d.bornes[0]?.id ?? 'PE';
	terminal.userData.pieza = 'terminal-pe';
	g.add(terminal);
	const rotulo = marca(d.bornes[0]?.id ?? 'PE', 2.8);
	if (rotulo) {
		rotulo.position.set(0, -9, zBase - 18.6);
		rotulo.rotation.y = Math.PI;
		g.add(rotulo);
	}
	return g;
}

const FICHA_PUNTO_PE: FichaFrontal = {
	familia: 'Punto PE de hoja',
	huella: () => ({ forma: 'redonda', ancho: 28 }),
	construir: construirPuntoPePuerta,
	propiedades: [
		{ clave: 'designacion', etiqueta: 'Marca', tipo: 'texto' },
		{ clave: 'descripcion', etiqueta: 'Para qué es', tipo: 'texto' },
	],
};

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
	if (d.tipo === 'bornero' && d.bornes.length > 0 && d.bornes.every((b) => b.tipo === 'PE')) {
		return FICHA_PUNTO_PE;
	}
	return FICHAS.get(d.tipo) ?? FICHAS.get('piloto')!;
}

registrarFrontal('piloto', {
	familia: 'Luz piloto',
	/*
	 * LA HUELLA ES EL ARO, NO EL TALADRO.
	 *
	 * El taladro mide 22 y es lo que se marca en el plano de mecanizado, pero lo que OCUPA el
	 * piloto en la chapa es el embellecedor, que mide casi treinta. Y la huella no la usa el
	 * taladrista: la usan el imantado, el reparto por huecos, la alineación por cantos, el borde
	 * de la hoja y la zona de agarre del ratón. Con 22, dos pilotos «sin hueco entre ellos»
	 * quedaban con los aros montados uno sobre otro, y uno pegado al canto sacaba el aro fuera de
	 * la chapa. Lo que el editor mide tiene que ser lo que se ve.
	 */
	huella: () => ({ forma: 'redonda', ancho: R_ARO * 2 }),
	construir: construirPilotoPuerta,
	propiedades: [
		{ clave: 'designacion', etiqueta: 'Marca', tipo: 'texto' },
		{
			clave: 'colorSenal', etiqueta: 'Color de la lente', tipo: 'lista',
			opciones: OPCIONES_COLOR, porDefecto: 'rojo', rehaceGeometria: true,
		},
		{ clave: 'tensionNominal', etiqueta: 'Tensión', tipo: 'numero', unidad: 'V', porDefecto: 24 },
		{ clave: 'descripcion', etiqueta: 'Para qué es', tipo: 'texto' },
	],
});

/** Lo que hay que guardar al crear un aparato de esta familia: los valores por defecto de su ficha. */
export function valoresPorDefecto(tipo: string): Record<string, string | number> {
	const f = FICHAS.get(tipo);
	const v: Record<string, string | number> = {};
	for (const p of f?.propiedades ?? []) if (p.porDefecto !== undefined) v[p.clave] = p.porDefecto;
	return v;
}

/**
 * Construye el componente de frontal que le toque a este aparato.
 *
 * Y LO FIRMA ENTERO. Cada malla del componente lleva el identificador del aparato, y eso no es
 * un detalle de contabilidad: el señalado del editor mira el `dispositivoId` de la malla que
 * corta el rayo, no el del grupo. Sin la firma, un piloto solo se podía «encontrar» a través de
 * su cilindro de agarre invisible, y el día que ese cilindro pasó a ser el último recurso —para
 * que dejara de robarle el clic a los cables que pasan por detrás— pinchar el centro de la lente
 * dejó de seleccionar el piloto: se lo llevaba cualquier cable que cruzara ese píxel, aunque
 * estuviera detrás de la chapa de la puerta.
 *
 * Se firma aquí, en el registro, y no en cada familia: así lo hereda el pulsador, el selector y
 * todo lo que se registre mañana, sin que su autor tenga que acordarse.
 */
export function construirComponentePuerta(d: Dispositivo, col: Colocacion): THREE.Group {
	const g = fichaFrontal(d).construir(d, col);
	g.traverse((o) => {
		if ((o as THREE.Mesh).isMesh && o.userData.dispositivoId === undefined) o.userData.dispositivoId = d.id;
	});
	return g;
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
