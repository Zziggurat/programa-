/**
 * EL MAZO DE PUERTA: el cable que va de la placa a un aparato montado en la hoja.
 *
 * Hasta ahora este cable existía eléctricamente y no existía en el espacio. `anclajeBorne`
 * devolvía `undefined` para un aparato con `montaje: 'puerta'` y el conductor sencillamente no se
 * dibujaba: encendía el piloto y no se veía por dónde. Seis de los sesenta y un conductores del
 * estrella-triángulo estaban en esa situación.
 *
 * UN CABLE A LA PUERTA TIENE TRES ZONAS, Y CADA UNA VIVE EN UN SITIO DISTINTO:
 *
 *   1. LA PLACA. Del borne de origen hasta un punto junto a las bisagras. Esto NO es nuevo: es el
 *      mismo recorrido de siempre, con sus corredores, sus canaletas, sus capas, sus puntos de
 *      paso y su selección. Lo único que se añade es que ese punto junto a la bisagra sea un
 *      destino válido, que es lo que hace `anclajeBorne` ahora.
 *
 *   2. LA ZONA FLEXIBLE. Un lazo de servicio entre el armario y la hoja. Es el único tramo que se
 *      deforma al abrir, y el único que se recalcula mientras la puerta se mueve.
 *
 *   3. LA PUERTA. Del punto de entrada en la hoja hasta el terminal del aparato. Va en
 *      COORDENADAS DE LA PUERTA, colgado del mismo grupo que los aparatos, así que gira con ella
 *      sin una sola línea de animación y sin ninguna conversión mundo/local que pueda salir mal.
 *      Ése fue el error clásico de los waypoints y aquí no se puede repetir: no hay ninguna
 *      coordenada de mundo guardada como fuente de verdad.
 *
 * Y por qué la reserva funciona con tan poco lazo: el mazo entra al lado de la BISAGRA. Un punto a
 * veintiséis milímetros del eje recorre, girando ciento dieciocho grados, apenas cinco
 * centímetros. Por eso en un tablero real el mazo va donde va: no porque quede bonito, sino
 * porque es el único sitio donde el cable casi no se entera de que la puerta se abre.
 */
import * as THREE from 'three';

import { Colocacion, Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { Puerta } from './gabinete3d.js';

/** Separación entre conductores dentro del mazo, en mm. */
const SEP_MAZO = 8;
/** A qué distancia del canto de bisagras entra el mazo en la hoja. */
const DESDE_BISAGRA = 26;
/** Profundidad a la que corre el mazo por la cara interior de la puerta, desde su cara exterior. */
const Z_CARA_INTERIOR = -9;

export interface CablePuerta {
	conductorId: string;
	/** El tramo que va colgado de la hoja: gira con ella. */
	enLaPuerta: THREE.Mesh;
	/** El lazo de servicio, en coordenadas de mundo. */
	flexible: THREE.Mesh;
	/** Marcador solidario con la hoja: da la posición de mundo del punto de entrada. */
	entrada: THREE.Object3D;
	/** El punto fijo junto a las bisagras, en coordenadas de mundo. */
	fijo: THREE.Vector3;
	/** Longitud de cable reservada para el tramo flexible. Fija: es lo que hay cortado. */
	reserva: number;
	radio: number;
	/** Hacia dónde cae la panza. Sale de la geometría del armario, no de un número a mano. */
	caida: THREE.Vector3;
	/** La normal de salida de la hoja, para que el cable no nazca pegado a la chapa. */
	salida: THREE.Vector3;
	segmentos: number;
	radiales: number;
	/** El recorrido del lazo, en coordenadas de escena. Se refresca al mover la puerta. */
	trazaLazo: THREE.Vector3[];
}

/**
 * EL RECORRIDO DE UN CONDUCTOR DEL MAZO, en coordenadas de ESCENA y al día.
 *
 * Existe porque el señalado de cables del editor NO trabaja con rayos: proyecta la polilínea del
 * conductor a píxeles y mide la distancia al puntero, que es lo que permite coger un cable de dos
 * píxeles de grueso sin puntería de cirujano. Esa polilínea salía del trazado de PLACA, y el mazo
 * no tiene trazado de placa: por eso los dos puentes que unen dos pilotos entre sí se veían, se
 * dibujaban y no se podían seleccionar de ninguna manera —el señalador no sabía que existían—.
 *
 * Se dan los puntos ya muestreados y en coordenadas de escena para que preguntarlo salga barato:
 * se calcula en cada movimiento del ratón.
 */
export interface TrazaMazo {
	conductorId: string;
	radio: number;
	/** En coordenadas de ESCENA. Es un buffer reutilizado: se lee y se olvida, no se guarda. */
	puntos: THREE.Vector3[];
}

export interface Mazo {
	/** Todo lo que gira con la puerta. Cuelga de la hoja. */
	enLaPuerta: THREE.Group;
	/** Los lazos de servicio. Cuelgan del mundo fijo. */
	flexibles: THREE.Group;
	cables: CablePuerta[];
}

/**
 * ¿ESTE APARATO ESTÁ EN LA PUERTA? Una sola pregunta, en un solo sitio, para que no haya dos
 * criterios distintos repartidos por el programa.
 */
export function enLaPuerta(proyecto: Proyecto, dispositivoId: string): boolean {
	return proyecto.gabinete?.colocaciones
		.some((c) => c.dispositivoId === dispositivoId && c.montaje === 'puerta') ?? false;
}

/**
 * EL PUNTO FIJO DEL MAZO, junto a las bisagras, en coordenadas de MODELO (las de la placa).
 *
 * Sale de la geometría del armario y del lado de las bisagras, nunca de coordenadas escritas a
 * mano: cambiar el tamaño de la caja o pasar las bisagras al otro lado lo mueve solo.
 *
 * Cae en la franja de aire que hay entre el canto de la placa y el costado del armario, que es
 * exactamente por donde sube el mazo en un tablero de verdad, y a media profundidad de la boca
 * para que el lazo salga hacia la puerta sin rozar el marco.
 */
export function anclajeFijoDeMazo(
	placa: { ancho: number; alto: number },
	caja: { ancho: number; alto: number; profundidad: number },
	izquierda: boolean,
	alturaModelo: number,
	desvio = 0,
): { x: number; y: number; z: number } {
	const signo = izquierda ? -1 : 1;
	// De escena a modelo: x_modelo = x_escena + placa.ancho/2.
	const xEscena = signo * (caja.ancho / 2 - DESDE_BISAGRA);
	// La boca del armario, la misma cota que usa `construirEnvolvente`.
	const zBoca = -11 - 3 + caja.profundidad;
	return {
		x: xEscena + placa.ancho / 2,
		// En el modelo la Y crece hacia ABAJO, al revés que en la escena: por eso el desvío del
		// carril se resta aquí y se suma allí. Es la misma separación vista desde los dos lados.
		y: alturaModelo - desvio,
		/*
		 * EN EL PLANO POR EL QUE CORRE EL CABLEADO, y aquí estaba el «cable flotando».
		 *
		 * El anclaje estaba a media boca del armario —cuarenta milímetros por detrás del marco—,
		 * o sea en el aire, delante de todo. El trazado de placa sale de la canaleta por donde
		 * sale siempre, en el plano de los cables expuestos, y para llegar a un punto que está
		 * ocho centímetros más adelante no le queda más remedio que cruzar el hueco en diagonal.
		 * Eso es exactamente lo que se veía: un hilo tenso atravesando el vano hasta la puerta.
		 *
		 * Un soporte de amarra de verdad va atornillado a algo: al costado, al canto de la placa
		 * o al final de la canaleta. Poniéndolo en el mismo plano por el que ya viaja el cable,
		 * el trazado llega a él sin salirse de su capa y la diagonal desaparece. Quien sube al
		 * plano de la puerta es el LAZO, que para eso está.
		 */
		z: Math.min(zBoca - 40, Z_CABLE_EXPUESTO),
	};
}

/**
 * La cota a la que corren los cables que no van por canaleta. Es la misma que usa `escena3d`;
 * está aquí repetida como constante con nombre para que el anclaje del mazo no pueda separarse
 * de ella por accidente, y `test/mazo-puerta.test.ts` comprueba que siguen valiendo lo mismo.
 */
export const Z_CABLE_EXPUESTO = 66;

/**
 * A QUÉ ALTURA DEL MODELO SUBE EL MAZO PARA ESTE APARATO.
 *
 * La puerta mide lo que mide la caja y la placa mide otra cosa, así que la misma altura tiene dos
 * números según desde dónde se mire. Esta conversión es la que hace que el tramo de placa y el
 * lazo se encuentren EXACTAMENTE en el mismo punto: las dos mitades la llaman a ella.
 */
export function alturaDeMazo(
	placa: { alto: number }, caja: { alto: number }, yEnLaPuerta: number,
): number {
	return yEnLaPuerta + (placa.alto - caja.alto) / 2;
}

/**
 * QUÉ SITIO OCUPA ESTE APARATO EN EL MAZO.
 *
 * Los tres pilotos R, S y T están a la MISMA altura, así que sus tres cables llegarían al mismo
 * punto de la bisagra y se dibujarían uno dentro de otro. El mazo se abanica: cada aparato tiene
 * su carril, y el carril tiene que salir del modelo para que el tramo de placa y el de puerta
 * calculen el mismo sin hablarse.
 *
 * EL CARRIL LO DA LA POSICIÓN, NO EL ORDEN DEL ARRAY. Salía del orden de `colocaciones`, y eso
 * no es un dato estable: basta con que el proyecto se guarde y se vuelva a abrir después de
 * haber tocado algo para que dos aparatos cambien de sitio en la lista. Medido: tras guardar y
 * recargar, el tramo de hoja de un conductor caía uno o dos milímetros más adentro que antes,
 * porque su carril había pasado a ser el del vecino. Un recorrido guardado tiene que volver
 * exactamente igual, y no puede depender de en qué orden se escribieron las cosas.
 *
 * Ordenar de izquierda a derecha y de arriba abajo, además, es lo que haría un montador: el
 * aparato más a la izquierda se lleva el carril de fuera. El identificador solo desempata dos
 * aparatos que estuvieran exactamente en el mismo punto, para que el orden sea total.
 */
export function carrilDeMazo(
	colocaciones: readonly Colocacion[], dispositivoId: string,
): { indice: number; total: number } {
	const enPuerta = colocaciones.filter((c) => c.montaje === 'puerta').slice().sort(
		(a, b) => (a.x - b.x) || (a.y - b.y) || (a.dispositivoId < b.dispositivoId ? -1 : 1),
	);
	return { indice: Math.max(0, enPuerta.findIndex((c) => c.dispositivoId === dispositivoId)), total: enPuerta.length };
}

/** El desvío en milímetros que le toca a ese carril, centrado sobre el eje del mazo. */
export function desvioDeCarril(indice: number, total: number): number {
	return (indice - (total - 1) / 2) * SEP_MAZO;
}

/** El terminal de un aparato de puerta, en coordenadas locales del grupo de montaje de la hoja. */
function terminalEnLaHoja(
	grupo: THREE.Object3D, cara: THREE.Object3D, borneId: string,
): THREE.Vector3 | undefined {
	let hallado: THREE.Object3D | undefined;
	grupo.traverse((o) => { if (!hallado && o.userData.borneId === borneId) hallado = o; });
	if (!hallado) return undefined;
	return cara.worldToLocal(hallado.getWorldPosition(new THREE.Vector3()));
}

/**
 * LA PANZA QUE LE TOCA A UN VANO. Cuanto más se separan los extremos, menos panza queda: es lo que
 * mantiene la longitud aparente del cable mientras la puerta se mueve.
 *
 * Sale de la longitud de un arco de parábola —`L ≈ d·(1 + 8/3·(h/d)²)`— despejando la flecha. No
 * es conservación exacta de la longitud y no hace falta que lo sea: hace falta que el cable no se
 * vea estirado como una cuerda al abrir ni amontonado al cerrar, y eso lo da de sobra.
 */
export function flechaDeLazo(reserva: number, distancia: number): number {
	if (distancia >= reserva) return 0;
	return distancia * Math.sqrt((3 / 8) * (reserva / Math.max(1, distancia) - 1));
}

/**
 * EL RADIO MÍNIMO DE CURVATURA, en milímetros.
 *
 * Un conductor flexible no admite doblarse tanto como uno quiera: pasado cierto punto el
 * aislamiento se pellizca y el cobre se fatiga, y en un lazo que se dobla cada vez que se abre la
 * puerta eso es la avería con el tiempo. La referencia conservadora que se usa en obra para un
 * lazo móvil es diez veces el diámetro exterior; aquí se toma como MÍNIMO FÍSICO —el lazo nunca
 * se cierra más que eso— y no como una cifra a la que haya que ajustar todos los recorridos.
 */
function radioMinimo(radioCable: number): number {
	return 10 * (radioCable * 2);
}

/**
 * La curva del lazo de servicio, en coordenadas de mundo.
 *
 * La panza no baja solo lo que sobra de cable: baja, como mínimo, lo que hace falta para que el
 * doblez de la panza no cierre por debajo del radio mínimo. Con la puerta cerrada, los dos
 * anclajes están casi encima uno del otro y la panza sería un pliegue en horquilla si nadie lo
 * impidiera.
 */
function curvaFlexible(c: CablePuerta, destino: THREE.Vector3): THREE.CubicBezierCurve3 {
	const d = c.fijo.distanceTo(destino);
	/*
	 * De dónde sale el mínimo: en una curva de Bézier cúbica simétrica con la flecha `h` sobre
	 * una cuerda `d`, el radio en el vértice vale del orden de `d² / (6h)`. Despejando `h` para
	 * que ese radio no baje del mínimo sale `h ≥ d² / (6·Rmin)`, y además la propia panza no
	 * puede ser más corta que el radio mínimo o el pliegue de arriba sería el que se cierra.
	 */
	const rmin = radioMinimo(c.radio);
	const porRadio = Math.max(rmin * 0.75, (d * d) / (6 * rmin));
	const h = Math.min(Math.max(flechaDeLazo(c.reserva, d), porRadio), c.reserva * 0.5);
	const p1 = c.fijo.clone()
		.addScaledVector(c.caida, h)
		.addScaledVector(destino.clone().sub(c.fijo).normalize(), d * 0.25);
	const p2 = destino.clone()
		.addScaledVector(c.caida, h)
		.addScaledVector(c.salida, Math.min(26, d * 0.3));
	return new THREE.CubicBezierCurve3(c.fijo, p1, p2, destino);
}

/**
 * REESCRIBE EL TUBO SIN CREAR GEOMETRÍA.
 *
 * Un tubo a lo largo de una curva es la misma malla siempre: `segmentos × radiales` vértices con
 * la misma topología. Lo único que cambia al abrir la puerta son las POSICIONES. Rehacer un
 * `TubeGeometry` por fotograma y por cable sería tirar y pedir memoria sesenta veces por segundo
 * para no cambiar ni un índice. Aquí se recorren los mismos búferes y se escriben encima.
 */
function reescribirTubo(
	malla: THREE.Mesh, curva: THREE.Curve<THREE.Vector3>, radio: number,
	segmentos: number, radiales: number,
): void {
	const geo = malla.geometry as THREE.BufferGeometry;
	const pos = geo.getAttribute('position') as THREE.BufferAttribute;
	const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
	const marcos = curva.computeFrenetFrames(segmentos, false);
	const p = new THREE.Vector3();
	let k = 0;
	for (let i = 0; i <= segmentos; i++) {
		curva.getPointAt(i / segmentos, p);
		const N = marcos.normals[i];
		const B = marcos.binormals[i];
		for (let j = 0; j <= radiales; j++) {
			const a = (j / radiales) * Math.PI * 2;
			const sx = -Math.sin(a), cy = Math.cos(a);
			const nx = cy * N.x + sx * B.x;
			const ny = cy * N.y + sx * B.y;
			const nz = cy * N.z + sx * B.z;
			nor.setXYZ(k, nx, ny, nz);
			pos.setXYZ(k, p.x + radio * nx, p.y + radio * ny, p.z + radio * nz);
			k += 1;
		}
	}
	pos.needsUpdate = true;
	nor.needsUpdate = true;
	geo.boundingSphere = null;
	geo.boundingBox = null;
}

/** El material de un conductor del mazo: el mismo criterio que el resto del cableado. */
function materialDeCable(color: number, conductorId: string): THREE.MeshStandardMaterial {
	const grano = ((conductorId.charCodeAt(0) + conductorId.length * 13) % 7) / 100;
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.32 + grano,
		metalness: 0.04,
		emissive: new THREE.Color(color).multiplyScalar(0.55),
		emissiveIntensity: 0,
	});
}

function tubo(
	curva: THREE.Curve<THREE.Vector3>, segmentos: number, radio: number, radiales: number,
	material: THREE.Material, conductorId: string,
): THREE.Mesh {
	const m = new THREE.Mesh(new THREE.TubeGeometry(curva, segmentos, radio, radiales, false), material);
	m.userData.conductorId = conductorId;
	m.userData.tuboVisible = true;
	m.userData.enLaPuerta = true;
	m.castShadow = true;
	m.receiveShadow = true;
	return m;
}

/* ==================================================================================
 * LOS PUNTOS DE FIJACIÓN
 *
 * Un cable que cambia de dirección en el aire no se sostiene solo: en un tablero cada quiebre
 * está sujeto por algo —una base de amarra pegada a la chapa, un clip, la boca de una canaleta,
 * un soporte atornillado—. Sin ellos el mazo se lee como una línea dibujada encima de la puerta;
 * con ellos se lee como cable INSTALADO, que es de lo que iba esta pasada.
 *
 * No se modelan accesorios de catálogo: una base baja y una brida por encima bastan para que la
 * lectura sea la correcta, y son dos geometrías compartidas por todo el tablero.
 * ================================================================================== */

/** Medidas de una base de amarra corriente, en milímetros. */
const BASE_AMARRA = { ancho: 19, fondo: 19, alto: 4 };

let geomBase: THREE.BoxGeometry | undefined;
let geomBrida: THREE.TorusGeometry | undefined;
let matBase: THREE.MeshStandardMaterial | undefined;

/**
 * UNA SUJECIÓN DEL MAZO: base pegada a la chapa y brida abrazando el haz.
 *
 * `grosor` es lo que abraza, o sea el ancho del mazo en ese punto: una brida que abraza un solo
 * hilo y otra que abraza seis no pueden dibujarse iguales.
 */
function sujecion(grosor: number): THREE.Group {
	geomBase ??= new THREE.BoxGeometry(BASE_AMARRA.ancho, BASE_AMARRA.fondo, BASE_AMARRA.alto);
	geomBrida ??= new THREE.TorusGeometry(1, 0.75, 5, 18);
	matBase ??= new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.78, metalness: 0.03 });
	const g = new THREE.Group();
	const base = new THREE.Mesh(geomBase, matBase);
	base.position.z = BASE_AMARRA.alto / 2;
	base.castShadow = true;
	g.add(base);
	// La brida: un aro achatado alrededor del haz, tumbado sobre la base.
	const brida = new THREE.Mesh(geomBrida, matBase);
	const r = Math.max(2.2, grosor / 2 + 1.1);
	brida.scale.set(r, r, 1);
	brida.rotation.y = Math.PI / 2;
	brida.position.z = BASE_AMARRA.alto + r - 0.6;
	g.add(brida);
	/*
	 * No estorba al ratón: lo que se pincha son los cables, no sus bridas. Sin esto, una base de
	 * amarra de diecinueve milímetros taparía justo el punto donde el mazo cambia de dirección,
	 * que es donde uno pincha para entenderlo.
	 */
	g.traverse((o) => { (o as THREE.Mesh).raycast = () => undefined; });
	return g;
}

/**
 * Deja el tubo con su recorrido apuntado: los puntos EN LOCAL, que no cambian nunca, y un buffer
 * del mismo tamaño donde escribir los de mundo cada vez que alguien pregunte. Así señalar un
 * cable de puerta no reserva memoria en cada movimiento del ratón.
 */
function apuntarTraza(m: THREE.Mesh, curva: THREE.Curve<THREE.Vector3>, muestras: number): void {
	const local = curva.getPoints(muestras);
	m.userData.traza = local;
	m.userData.trazaMundo = local.map(() => new THREE.Vector3());
	m.userData.radioCable = ((m.geometry as THREE.TubeGeometry).parameters?.radius) ?? 1;
}

export interface OpcionesMazo {
	proyecto: Proyecto;
	puerta: Puerta;
	/** Los grupos de los aparatos montados en la puerta, para encontrar sus terminales. */
	aparatos: THREE.Object3D[];
	/** De modelo a escena, la misma que usa el resto del escenario. */
	aEscena: (x: number, y: number, z: number) => THREE.Vector3;
	placa: { ancho: number; alto: number };
	caja: { ancho: number; alto: number; profundidad: number };
	izquierda: boolean;
	color: (conductor: { id: string; color?: string }) => number;
	radio: (seccion?: number) => number;
}

/**
 * Monta el mazo entero. Se llama UNA vez por reconstrucción de escena; abrir la puerta no vuelve
 * a pasar por aquí.
 */
export function construirMazoPuerta(o: OpcionesMazo): Mazo {
	const { proyecto, puerta } = o;
	const enPuerta = new THREE.Group();
	const flexibles = new THREE.Group();
	const cables: CablePuerta[] = [];
	puerta.frente.add(enPuerta);

	const g = proyecto.gabinete;
	if (!g) return { enLaPuerta: enPuerta, flexibles, cables };

	// Las matrices tienen que estar al día ANTES de preguntar dónde cae un terminal: si no,
	// `worldToLocal` trabaja con la posición de la hoja de hace un fotograma.
	puerta.pivote.updateMatrixWorld(true);

	const conductores = proyecto.conductores.filter(
		(c) => enLaPuerta(proyecto, c.de.dispositivoId) || enLaPuerta(proyecto, c.a.dispositivoId),
	);
	if (!conductores.length) return { enLaPuerta: enPuerta, flexibles, cables };

	/*
	 * A QUÉ ALTURA ENTRA EL MAZO. A la del aparato al que sirve, no a una altura fija: si los
	 * pilotos están arriba, el mazo sube por la bisagra hasta arriba, como haría un montador.
	 */
	const destinos: { conductorId: string; dispositivoId: string; grupo: THREE.Object3D; borneId: string; col: Colocacion }[] = [];
	for (const c of conductores) {
		for (const extremo of [c.de, c.a]) {
			const col = g.colocaciones.find(
				(k) => k.dispositivoId === extremo.dispositivoId && k.montaje === 'puerta',
			);
			if (!col) continue;
			const grupo = o.aparatos.find((k) => k.userData.dispositivoId === extremo.dispositivoId);
			if (grupo) destinos.push({ conductorId: c.id, dispositivoId: extremo.dispositivoId, grupo, borneId: extremo.borneId, col });
		}
	}
	const terminales = new Map<string, THREE.Vector3>();
	for (const d of destinos) {
		const p = terminalEnLaHoja(d.grupo, puerta.frente, d.borneId);
		// LA CLAVE LLEVA EL APARATO, y no es un detalle: `w54` va del borne X2 de un piloto al
		// borne X2 de OTRO, así que con la clave `conductor|borne` el segundo terminal pisaba al
		// primero y el cable se dibujaba dos veces contra el mismo punto.
		if (p) terminales.set(`${d.conductorId}|${d.dispositivoId}|${d.borneId}`, p);
	}
	if (!terminales.size) return { enLaPuerta: enPuerta, flexibles, cables };

	const signo = o.izquierda ? -1 : 1;
	const xEntrada = signo * (puerta.ancho / 2 - DESDE_BISAGRA);

	/*
	 * EL MAZO TRONCAL. Y por qué no vale que cada hilo vaya por su cuenta.
	 *
	 * Antes, cada conductor entraba en la hoja a la altura de SU aparato y cruzaba en horizontal
	 * hasta él. Con tres pilotos en fila salían tres carreras paralelas sueltas por la chapa, que
	 * no es como se cablea una puerta: se sube UN mazo pegado al canto de las bisagras y de él se
	 * derivan los hilos, cada uno a la altura de lo suyo.
	 *
	 * El tronco entra a la altura del aparato más alto y baja hasta el más bajo; cada conductor
	 * lo acompaña con su carril —unos milímetros de separación para que se distingan los seis— y
	 * se separa en horizontal cuando llega a su altura.
	 */
	const alturasHoja = destinos.map((d) => o.caja.alto / 2 - d.col.y);
	const yTronco = alturasHoja.length ? Math.max(...alturasHoja) : 0;
	const yTroncoBajo = alturasHoja.length ? Math.min(...alturasHoja) : 0;
	const grosorMazo = Math.max(6, destinos.length * 2.6);

	/*
	 * LAS SUJECIONES DEL TRONCO. Una en el punto de transferencia —junto a las bisagras, que es
	 * donde el mazo pasa de la puerta al lazo— y las demás repartidas a lo largo del tronco, cada
	 * `PASO_SUJECION` milímetros. Un cable fuera de canaleta no puede colgar medio metro sin nada
	 * que lo sujete, y sin la sujeción de arriba el borne del aparato acabaría aguantando el
	 * movimiento de la puerta, que es justo lo que no debe pasar.
	 */
	const PASO_SUJECION = 110;
	const zSujecion = Z_CARA_INTERIOR + 1.5;
	/** Pone una sujeción en la cara interior de la hoja, mirando hacia dentro del armario. */
	const amarrar = (x: number, y: number, grosor: number): void => {
		const sj = sujecion(grosor);
		sj.position.set(x, y, zSujecion);
		sj.rotation.y = Math.PI;
		enPuerta.add(sj);
	};
	{
		const alto = Math.max(0, yTronco - yTroncoBajo);
		const cuantas = Math.max(1, Math.round(alto / PASO_SUJECION));
		for (let i = 0; i <= cuantas; i++) amarrar(xEntrada, yTronco - (alto * i) / cuantas, grosorMazo);
		/*
		 * Y A LO LARGO DE CADA DERIVACIÓN. Un hilo que cruza veinte centímetros de chapa desde el
		 * tronco hasta su piloto no puede ir suelto: se amarra cada palmo, que es lo que impide
		 * que se descuelgue y lo que hace que se lea como cable instalado y no como una línea
		 * dibujada por encima. Se amarra por APARATO, no por conductor: lo que se sujeta es el
		 * haz que va a ese aparato, no cada hilo por separado.
		 */
		const porAparato = new Map<string, { y: number; x: number; n: number }>();
		for (const d of destinos) {
			const t = terminales.get(`${d.conductorId}|${d.dispositivoId}|${d.borneId}`);
			if (!t) continue;
			const antes = porAparato.get(d.dispositivoId);
			porAparato.set(d.dispositivoId, { y: t.y, x: t.x, n: (antes?.n ?? 0) + 1 });
		}
		for (const [, q] of porAparato) {
			const largo = Math.abs(q.x - xEntrada);
			const cuantos = Math.floor(largo / PASO_SUJECION);
			const paso = (q.x - xEntrada) / (cuantos + 1);
			for (let i = 1; i <= cuantos; i++) amarrar(xEntrada + paso * i, q.y, Math.max(6, q.n * 2.6));
		}
	}
	// La normal exterior de la hoja en coordenadas de mundo: por ahí sale el cable de la puerta.
	const salida = new THREE.Vector3(0, 0, -1)
		.applyQuaternion(puerta.frente.getWorldQuaternion(new THREE.Quaternion())).normalize();

	for (const c of conductores) {
		const propio = destinos.filter((d) => d.conductorId === c.id);
		if (!propio.length) continue;
		const radio = o.radio(c.seccion);
		const material = materialDeCable(o.color(c), c.id);
		const puntoDe = (d: typeof propio[number]) => terminales.get(`${c.id}|${d.dispositivoId}|${d.borneId}`);

		/*
		 * DOS EXTREMOS EN LA PUERTA: NO PASA POR LA BISAGRA.
		 *
		 * Un puente entre dos pilotos vecinos —el retorno del neutro, en el estrella-triángulo son
		 * `w54` y `w55`— no sale del armario ni vuelve a entrar: va de un borne al de al lado por
		 * la cara interior de la hoja. Bajarlo hasta la bisagra y subirlo otra vez sería dibujar
		 * dos metros de cable donde hay veinte centímetros.
		 */
		if (propio.length >= 2) {
			const a = puntoDe(propio[0]);
			const b2 = puntoDe(propio[1]);
			if (!a || !b2) continue;
			const carril = Z_CARA_INTERIOR - 4;
			const puntos = [
				a.clone(),
				new THREE.Vector3(a.x, a.y, carril),
				new THREE.Vector3((a.x + b2.x) / 2, (a.y + b2.y) / 2 - 9, carril),
				new THREE.Vector3(b2.x, b2.y, carril),
				b2.clone(),
			];
			const curva = new THREE.CatmullRomCurve3(puntos, false, 'centripetal', 0.5);
			const malla = tubo(curva, 40, radio, 10, material, c.id);
			malla.userData.guia = puntos.map((q) => ({ x: q.x, y: q.y, z: q.z }));
			apuntarTraza(malla, curva, 26);
			enPuerta.add(malla);
			continue;
		}

		/* ---- Un solo extremo en la puerta: los tres tramos ---- */
		const d = propio[0];
		const t = puntoDe(d);
		if (!t) continue;
		const carril = carrilDeMazo(g.colocaciones, d.dispositivoId);
		const desvio = desvioDeCarril(carril.indice, carril.total);
		/*
		 * EL PUNTO DE TRANSFERENCIA ES UNO PARA TODO EL MAZO, a la altura por la que entra el
		 * tronco. Antes cada conductor tenía el suyo a la altura de su aparato, así que con los
		 * pilotos repartidos por la puerta salían anclajes sueltos por media bisagra. En un
		 * tablero, el mazo cruza por UN sitio.
		 */
		const alturaModelo = alturaDeMazo(o.placa, o.caja, o.caja.alto / 2 - yTronco);
		const zCarril = Z_CARA_INTERIOR - Math.abs(desvio) * 0.2;

		/*
		 * 3. EL TRAMO QUE VA EN LA PUERTA, en coordenadas de la hoja.
		 *
		 * Y ACABA METIÉNDOSE EN EL APARATO, no rebotando en él. La primera versión bajaba hasta
		 * detrás del terminal y volvía a subir hasta el tornillo: esa inversión de sentido hacía
		 * que el spline se pasara de largo POR DELANTE de la chapa, y el mazo aparecía dibujado
		 * sobre la cara exterior de la puerta cerrada. Medido: el tubo llegaba a z=167 con la
		 * cara exterior de la hoja en 162. Con el último tramo yendo siempre hacia dentro, lo que
		 * se pasa de largo se mete en el cuerpo del piloto, que es opaco y lo tapa.
		 */
		/*
		 * ENTRA POR EL TRONCO, BAJA CON ÉL Y SE DERIVA A SU ALTURA. Tres tramos rectos con las
		 * esquinas redondeadas por el spline: es lo que se ve en la cara interior de una puerta
		 * cableada, y no una diagonal de esquina a esquina.
		 *
		 * El carril del conductor se reparte entre la X —para que dentro del tronco los seis
		 * hilos se distingan— y la Z, para que la derivación de uno no se meta dentro de la del
		 * de al lado cuando dos aparatos están a la misma altura.
		 */
		const xCarril = xEntrada + desvio * 0.32;
		const haciaAparato = Math.sign(t.x - xEntrada) || 1;
		const yDerivacion = t.y + desvio * 0.22;
		const entradaLocal = new THREE.Vector3(xCarril, yTronco, zCarril);
		/*
		 * El punto de «acabar de bajar» solo se pone si el tronco TIENE largo. Con los tres
		 * pilotos a la misma altura, meterlo igualmente dibujaba un escalón de un centímetro
		 * arriba y otro abajo justo al salir de la sujeción: un rizo que no venía de ninguna
		 * parte y que delataba que la ruta se había escrito sin mirar el caso fácil.
		 */
		const bajaElTronco = Math.abs(yTronco - yDerivacion) > 25;
		const puntos = [
			entradaLocal,
			...(bajaElTronco
				? [new THREE.Vector3(xCarril, yDerivacion + Math.sign(yTronco - yDerivacion) * 16, zCarril)]
				: []),
			new THREE.Vector3(xCarril + haciaAparato * 16, yDerivacion, zCarril),
			new THREE.Vector3(t.x - haciaAparato * 20, yDerivacion, zCarril),
			new THREE.Vector3(t.x, t.y, zCarril),
			t.clone(),
		];
		const curvaPuerta = new THREE.CatmullRomCurve3(puntos, false, 'centripetal', 0.5);
		const mallaPuerta = tubo(curvaPuerta, 48, radio, 10, material, c.id);
		mallaPuerta.userData.guia = puntos.map((q) => ({ x: q.x, y: q.y, z: q.z }));
		apuntarTraza(mallaPuerta, curvaPuerta, 30);
		enPuerta.add(mallaPuerta);

		/* ---- 1 y 2. El punto fijo y el lazo ---- */
		const marcador = new THREE.Object3D();
		marcador.position.copy(entradaLocal);
		puerta.frente.add(marcador);
		marcador.updateMatrixWorld(true);
		const destinoMundo = marcador.getWorldPosition(new THREE.Vector3());

		const anclaModelo = anclajeFijoDeMazo(o.placa, o.caja, o.izquierda, alturaModelo, desvio);
		const fijo = o.aEscena(anclaModelo.x, anclaModelo.y, anclaModelo.z);
		/*
		 * Y SU SOPORTE, una sola vez. El lazo tiene que salir de algo atornillado al armario: si
		 * naciera del aire, quien estaría aguantando el tirón de abrir y cerrar la puerta sería
		 * el borne del aparato, que es la avería clásica de un mazo mal amarrado.
		 */
		if (!flexibles.children.length) {
			const centro = o.aEscena(
				anclajeFijoDeMazo(o.placa, o.caja, o.izquierda, alturaModelo, 0).x,
				anclajeFijoDeMazo(o.placa, o.caja, o.izquierda, alturaModelo, 0).y,
				anclajeFijoDeMazo(o.placa, o.caja, o.izquierda, alturaModelo, 0).z,
			);
			const sj = sujecion(grosorMazo);
			sj.position.copy(centro);
			// Atornillado al costado: la base mira hacia el interior del armario.
			sj.rotation.y = signo * Math.PI / 2;
			flexibles.add(sj);
		}

		/*
		 * LA PANZA CAE HACIA ABAJO Y UN POCO HACIA DENTRO DEL ARMARIO. Hacia abajo porque un lazo
		 * de servicio cuelga; hacia dentro porque si cayera hacia fuera se saldría por la boca del
		 * armario y se vería flotando por delante del marco con la puerta cerrada.
		 */
		const dentro = new THREE.Vector3(-signo, 0, 0);
		const caida = new THREE.Vector3(0, -1, 0).addScaledVector(dentro, 0.3).normalize();

		const cable: CablePuerta = {
			conductorId: c.id,
			enLaPuerta: mallaPuerta,
			flexible: undefined as unknown as THREE.Mesh,
			entrada: marcador,
			fijo,
			reserva: fijo.distanceTo(destinoMundo) + 74,
			radio,
			caida,
			salida,
			segmentos: 26,
			radiales: 10,
			trazaLazo: [],
		};
		const curvaLazo = curvaFlexible(cable, destinoMundo);
		cable.flexible = tubo(curvaLazo, cable.segmentos, radio, cable.radiales, material, c.id);
		cable.trazaLazo = curvaLazo.getPoints(20);
		flexibles.add(cable.flexible);
		cables.push(cable);
	}
	return { enLaPuerta: enPuerta, flexibles, cables };
}

/**
 * Vuelve a tender SOLO los lazos. Es lo único que depende del ángulo de la puerta, y se llama
 * únicamente cuando ese ángulo ha cambiado de verdad.
 */
export function actualizarMazoPuerta(mazo: Mazo): void {
	const destino = new THREE.Vector3();
	for (const c of mazo.cables) {
		c.entrada.getWorldPosition(destino);
		const curva = curvaFlexible(c, destino);
		reescribirTubo(c.flexible, curva, c.radio, c.segmentos, c.radiales);
		// Y el recorrido que usa el señalado por píxeles, en los MISMOS puntos ya reservados.
		for (let i = 0; i < c.trazaLazo.length; i++) curva.getPoint(i / (c.trazaLazo.length - 1), c.trazaLazo[i]);
	}
}

/**
 * Los recorridos de TODO el mazo en coordenadas de escena, listos para medir contra el puntero.
 *
 * El tramo que cuelga de la hoja lleva encima la matriz de la puerta, así que se transforma aquí
 * —una multiplicación por punto, sobre buffers ya reservados— en vez de guardarse en mundo. Que
 * es la regla de esta fase: la fuente de verdad de un tramo de puerta son sus coordenadas de
 * puerta, y el mundo se deduce cuando hace falta.
 */
export function trazasDeMazo(mazo: Mazo): TrazaMazo[] {
	const salida: TrazaMazo[] = [];
	for (const m of mazo.enLaPuerta.children as THREE.Mesh[]) {
		const local = m.userData.traza as THREE.Vector3[] | undefined;
		const mundo = m.userData.trazaMundo as THREE.Vector3[] | undefined;
		if (!local || !mundo) continue;
		m.updateWorldMatrix(true, false);
		for (let i = 0; i < local.length; i++) mundo[i].copy(local[i]).applyMatrix4(m.matrixWorld);
		salida.push({
			conductorId: m.userData.conductorId as string,
			radio: (m.userData.radioCable as number) ?? 1,
			puntos: mundo,
		});
	}
	for (const c of mazo.cables) {
		if (c.trazaLazo.length > 1) salida.push({ conductorId: c.conductorId, radio: c.radio, puntos: c.trazaLazo });
	}
	return salida;
}
