/**
 * EL GABINETE: LA CAJA DE VERDAD QUE HAY ALREDEDOR DE LA PLACA.
 *
 * Hasta ahora el tablero se dibujaba como lo que es por dentro —la placa de montaje, los carriles,
 * las canaletas y los aparatos— con un fondo y cuatro paredes de dos milímetros insinuadas
 * alrededor. Eso se lee como una plancha con cosas encima, no como un armario. Aquí está la
 * envolvente: fondo, laterales, techo, suelo, marco perimetral y PUERTA.
 *
 *
 * TRES REGLAS QUE MANDAN SOBRE TODO LO DEMÁS
 *
 * 1. PARAMÉTRICO, NO UNA MAQUETA. Todo sale de `cajaDe(gabinete)` —ancho, alto y profundidad— y de
 *    unos pocos espesores. Un armario de 400 × 600 y uno de 1.200 × 2.000 salen de la misma
 *    función y los dos tienen proporciones de chapa creíbles, porque lo que NO escala es el
 *    espesor: la chapa de un armario grande no es más gorda, es la misma de 2 mm.
 *
 * 2. LAS PIEZAS SE SOLAPAN, NUNCA SE TOCAN A TOPE. Dos caras que mueren exactamente en el mismo
 *    plano es la definición de z-fighting, y este proyecto acaba de gastar dos fases quitando
 *    justamente eso de los aparatos. Un armario es una caja de cajas: si se montara «a tope» como
 *    se dibuja de forma natural, reintroduciría el problema entero de una tacada. Así que cada
 *    pieza se METE unos milímetros dentro de la siguiente. Es además como está hecho de verdad
 *    —la chapa se pliega y se solapa, no se apoya canto contra canto— así que no cuesta realismo.
 *
 * 3. LA PUERTA ES UNA ENTIDAD, NO UN ADORNO. Tiene su propio eje de giro, su jerarquía y dos
 *    grupos de montaje —cara exterior y cara interior— que ya están puestos para que los pilotos,
 *    los pulsadores y los cuerpos de aparato que vengan después cuelguen de ella y se muevan con
 *    ella sin tocar nada de esto. Abrir la puerta es girar UN grupo.
 */
import * as THREE from 'three';

import { M, cajaCanto, granoDePintura } from './dispositivos3d.js';

/* ------------------------------- Medidas de la chapa ------------------------------- */

/** Espesor de la chapa del cuerpo. Un armario industrial va en 1,5–2 mm; no escala con el tamaño. */
const CHAPA = 2;
/** Espesor del fondo: siempre algo más gordo, porque es el que aguanta la placa de montaje. */
const CHAPA_FONDO = 3;
/**
 * Cuánto se mete cada pieza dentro de la siguiente. Ver la regla 2 de la cabecera: es lo que
 * impide que dos caras acaben en el mismo plano.
 */
const SOLAPE = 3;
/** Ancho del marco perimetral (la pestaña plegada hacia dentro sobre la que cierra la puerta). */
const MARCO = 22;
/** Rebaje entre el canto del cuerpo y la cara del marco: el asiento de la junta. */
const REBAJE = 5;
/** Fondo de la hoja de la puerta: chapa exterior más el pliegue de retorno. */
const FONDO_HOJA = 15;
/** Holgura entre el canto del cuerpo y la cara interior de la puerta cerrada. */
const HOLGURA_PUERTA = 1;
/** Apertura de la puerta, en radianes. 118° es lo que da un armario de pared antes de tocar. */
const APERTURA = (118 * Math.PI) / 180;

/** Cara interior del fondo del armario. La placa de montaje ya vive delante de este plano. */
export const Z_FONDO_INTERIOR = -11;

/* ---------------------------------- La puerta ---------------------------------- */

/** En qué cara de la puerta se monta algo. Los dos usan las MISMAS x,y: son el mismo agujero. */
export type CaraPuerta = 'frente' | 'interior';

export interface Puerta {
	/**
	 * EL EJE DE BISAGRA. Girar esto —y solo esto— abre y cierra. Todo lo que cuelgue de la hoja
	 * viaja con ella sin enterarse.
	 */
	pivote: THREE.Group;
	/** La hoja: origen en su centro, cara interior en z = 0 y cara exterior en z = `fondo`. */
	hoja: THREE.Group;
	/** Cara EXTERIOR: lentes de piloto, pulsadores, selectores, displays, rótulos. */
	frente: THREE.Group;
	/** Cara INTERIOR: cuerpos de aparato, bornes, contactos y su cableado. */
	interior: THREE.Group;
	/** Apertura máxima en radianes, ya con el signo del lado de las bisagras aplicado. */
	aperturaMaxima: number;
	ancho: number;
	alto: number;
	fondo: number;
	/**
	 * Coloca un objeto en una cara de la puerta, en mm desde su esquina SUPERIOR IZQUIERDA vista
	 * de frente, y a `z` mm por fuera de esa cara.
	 *
	 * Las dos caras usan las mismas `x, y` a propósito: una lente y el cuerpo del piloto que la
	 * lleva son el mismo taladro, y tener que acordarse de espejar la X para el interior es la
	 * clase de detalle que se olvida una vez y descuadra el montaje entero.
	 */
	colocar(objeto: THREE.Object3D, cara: CaraPuerta, x: number, y: number, z?: number): void;
	/**
	 * Da la vuelta a un objeto construido mirando al frente para que mire hacia DENTRO del
	 * armario. Es lo que necesita el cuerpo de un aparato montado en la cara interior.
	 */
	haciaDentro(objeto: THREE.Object3D): void;
}

/** Todo lo que la escena necesita saber de la envolvente. */
export interface Envolvente {
	/** El armario entero: cuerpo y puerta. */
	grupo: THREE.Group;
	puerta: Puerta;
}

/* ------------------------------- Piezas elementales ------------------------------- */

function chapa(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
	m.position.set(x, y, z);
	m.castShadow = true;
	m.receiveShadow = true;
	return m;
}

/**
 * Un MARCO: una placa rectangular con un hueco rectangular dentro, de una sola pieza.
 *
 * De una pieza y no de cuatro tiras, y no es por ahorrar mallas: cuatro tiras se cruzan en las
 * esquinas, y cuatro solapes con caras a la misma altura en las esquinas es justo lo que hay que
 * evitar. Un `Shape` con su agujero no tiene esquinas que se peleen.
 */
function marco(
	w: number, h: number, hueco: number, d: number, mat: THREE.Material, z: number, radio = 3,
): THREE.Mesh {
	const fuera = new THREE.Shape();
	const r = Math.min(radio, w / 2 - 1, h / 2 - 1);
	rectangulo(fuera, w, h, r);
	const dentro = new THREE.Path();
	rectangulo(dentro, w - 2 * hueco, h - 2 * hueco, Math.max(1, r - hueco * 0.4));
	fuera.holes.push(dentro);
	const geo = new THREE.ExtrudeGeometry(fuera, { depth: d, bevelEnabled: false, curveSegments: 3 });
	geo.translate(0, 0, -d / 2);
	const m = new THREE.Mesh(geo, mat);
	m.position.z = z;
	m.castShadow = true;
	m.receiveShadow = true;
	return m;
}

/**
 * Una chapa con un HUECO rectangular dentro, de una sola pieza.
 *
 * De una pieza y no de cuatro tiras alrededor del hueco, por lo mismo que el marco: cuatro tiras
 * se solapan en las esquinas y comparten sus caras de arriba y de abajo, que es exactamente la
 * receta del z-fighting. Un `Shape` con su agujero no tiene esquinas que se peleen.
 *
 * Sale tumbada en el plano XY con el espesor en Z; quien la use la gira a donde le toque.
 */
function chapaConHueco(
	w: number, h: number, d: number, mat: THREE.Material,
	hueco: { x: number; y: number; w: number; h: number },
): THREE.Mesh {
	const fuera = new THREE.Shape();
	rectangulo(fuera, w, h, 2);
	const dentro = new THREE.Path();
	rectangulo(dentro, hueco.w, hueco.h, 3);
	// `rectangulo` dibuja centrado en el origen; el hueco se lleva a su sitio moviendo sus curvas.
	for (const c of dentro.curves) {
		const q = c as unknown as Record<string, THREE.Vector2 | undefined>;
		for (const clave of ['v0', 'v1', 'v2']) q[clave]?.add(new THREE.Vector2(hueco.x, hueco.y));
	}
	fuera.holes.push(dentro);
	const geo = new THREE.ExtrudeGeometry(fuera, { depth: d, bevelEnabled: false, curveSegments: 3 });
	geo.translate(0, 0, -d / 2);
	const m = new THREE.Mesh(geo, mat);
	m.castShadow = true;
	m.receiveShadow = true;
	return m;
}

/** Dibuja un rectángulo de esquinas redondeadas centrado en el origen. */
function rectangulo(p: THREE.Shape | THREE.Path, w: number, h: number, r: number): void {
	const hw = w / 2;
	const hh = h / 2;
	p.moveTo(-hw + r, -hh);
	p.lineTo(hw - r, -hh);
	p.quadraticCurveTo(hw, -hh, hw, -hh + r);
	p.lineTo(hw, hh - r);
	p.quadraticCurveTo(hw, hh, hw - r, hh);
	p.lineTo(-hw + r, hh);
	p.quadraticCurveTo(-hw, hh, -hw, hh - r);
	p.lineTo(-hw, -hh + r);
	p.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
}

/* --------------------------------- El cuerpo --------------------------------- */

/**
 * Cuerpo del armario: fondo, dos laterales, techo, suelo y el marco perimetral del frente.
 *
 * El reparto en profundidad, que es lo que hay que mirar para entender que no hay dos caras en el
 * mismo plano (todas las cotas relativas al canto delantero `zBoca`):
 *
 *   zFondoExt  = Z_FONDO_INTERIOR − 3    cara exterior del fondo
 *   Z_FONDO_INTERIOR                     cara interior del fondo; la placa va delante, sobre sus espárragos
 *   zBoca − 12                           cara trasera del marco (metida dentro del cuerpo)
 *   zBoca − 5                            cara delantera del marco: el asiento de la junta
 *   zBoca                                canto delantero de laterales, techo y suelo
 *   zBoca + 1                            cara interior de la puerta cerrada
 *   zBoca + 16                           cara exterior de la puerta
 */
function construirCuerpo(
	ancho: number, alto: number, zBoca: number, mats: Materiales, pasacables: BocaPasacables,
): THREE.Group {
	const g = new THREE.Group();
	const zFondo = Z_FONDO_INTERIOR - CHAPA_FONDO / 2;

	// Fondo. Es el único que no se solapa con nadie por detrás porque no hay nada detrás.
	g.add(chapa(ancho, alto, CHAPA_FONDO, mats.exterior, 0, 0, zFondo));

	/*
	 * Laterales, techo y suelo. Arrancan METIDOS en el fondo —de ahí el `SOLAPE`— y llegan hasta
	 * el canto de la boca. Sus cantos delanteros son los 2 mm de chapa que se ven al mirar el
	 * armario abierto de frente, y son lo que hace que el espesor se perciba.
	 */
	const fondoUtil = zBoca - (Z_FONDO_INTERIOR - SOLAPE);
	const zCentro = Z_FONDO_INTERIOR - SOLAPE + fondoUtil / 2;
	for (const lado of [-1, 1]) {
		g.add(chapa(CHAPA, alto, fondoUtil, mats.exterior, lado * (ancho / 2 - CHAPA / 2), 0, zCentro));
	}
	// Techo entero; el SUELO va aparte, porque lleva el hueco de los pasacables.
	g.add(chapa(ancho - 2 * CHAPA, CHAPA, fondoUtil, mats.exterior, 0, alto / 2 - CHAPA / 2, zCentro));

	/*
	 * Marco perimetral: la pestaña plegada hacia dentro sobre la que cierra la puerta. Va
	 * RETRANQUEADA cinco milímetros respecto al canto, y ese rebaje es donde asienta la junta.
	 * Su cara trasera se mete siete milímetros más, dentro del cuerpo, donde no la ve nadie.
	 */
	const grueso = 7;
	g.add(marco(ancho - 2 * CHAPA + SOLAPE, alto - 2 * CHAPA + SOLAPE, MARCO, grueso, mats.exterior,
		zBoca - REBAJE - grueso / 2));

	// Los taladros del marco: por donde se atornilla la placa de montaje al armario de verdad.
	for (const sx of [-1, 1]) {
		for (const sy of [-1, 1]) {
			const t = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 4, 10), mats.sombra);
			t.rotation.x = Math.PI / 2;
			t.position.set(sx * (ancho / 2 - MARCO / 2 - CHAPA), sy * (alto / 2 - MARCO / 2 - CHAPA), zBoca - REBAJE - 1.2);
			g.add(t);
		}
	}

	/*
	 * EL SUELO, CON SU HUECO PASACABLES.
	 *
	 * Aquí no vale una chapa entera. Por el suelo del armario entran los cables de campo, y la
	 * escena ya dibuja sus prensaestopas y los tubos que bajan de ellos hasta el motor, los
	 * sensores y las válvulas. Con el suelo cerrado, todo eso ATRAVESABA la chapa: antes no se
	 * notaba porque las paredes eran translúcidas, y en cuanto la envolvente pasa a ser opaca
	 * queda a la vista.
	 *
	 * Un armario de verdad lo resuelve como se resuelve aquí: un hueco en el suelo y una PLACA
	 * PASACABLES desmontable que lo tapa, con los prensaestopas montados sobre ella. Así el hueco
	 * está donde de verdad pasan los cables —lo dice quien monta la escena, que es quien sabe
	 * dónde caen— y deja de haber nada atravesando chapa.
	 */
	const hueco = {
		x: pasacables.x,
		// La chapa se dibuja tumbada: su eje Y local mira hacia el FONDO del armario, así que la
		// profundidad cambia de signo al pasarla a coordenadas de la pieza.
		y: -(pasacables.z - zCentro),
		w: Math.min(pasacables.ancho, ancho - 2 * CHAPA - 24),
		h: Math.min(pasacables.fondo, fondoUtil - 24),
	};
	const suelo = chapaConHueco(ancho - 2 * CHAPA, fondoUtil, CHAPA, mats.exterior, hueco);
	suelo.rotation.x = -Math.PI / 2;
	suelo.position.set(0, -alto / 2 + CHAPA / 2, zCentro);
	g.add(suelo);

	// La placa desmontable, atornillada por FUERA y un pelo por debajo del suelo para no
	// compartir plano con él. Es la que lleva los prensaestopas.
	const tapa = cajaCanto(hueco.w + 22, hueco.h + 22, CHAPA + 1.2, mats.galvanizada, 0, 0, 0, 4, 0.5);
	tapa.rotation.x = -Math.PI / 2;
	tapa.position.set(hueco.x, -alto / 2 + CHAPA / 2 - CHAPA - 0.9, pasacables.z);
	g.add(tapa);
	// Sus cuatro tornillos, que es lo que la hace legible como pieza desmontable y no como parche.
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			const t = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 3, 8), mats.herraje);
			t.position.set(hueco.x + sx * (hueco.w / 2 + 6), -alto / 2 - CHAPA - 1.6, pasacables.z + sz * (hueco.h / 2 + 6));
			g.add(t);
		}
	}

	return g;
}

/* --------------------------------- La puerta --------------------------------- */

/**
 * UNA BISAGRA TIENE DOS PALAS Y SOLO UNA DE ELLAS GIRA.
 *
 * La primera versión montaba las dos palas y el nudillo en un solo grupo colgado del PIVOTE, así
 * que al abrir la puerta la bisagra entera se iba con ella: la pala que debería estar atornillada
 * al armario se despegaba del armario y se quedaba flotando en el aire junto a la hoja. Se veía a
 * simple vista con la puerta a medio abrir, y no se veía con la puerta cerrada, que es por lo que
 * había aguantado.
 *
 * Y el nudillo estaba SIETE MILÍMETROS FUERA DEL EJE, así que además describía un arco al abrir
 * en lugar de quedarse quieto girando sobre sí mismo, que es lo único que hace un nudillo.
 *
 * Ahora se devuelven las dos partes por separado: `movil` se cuelga del pivote —el nudillo, en el
 * eje exacto, y la pala de la hoja— y `fija` se cuelga del CUERPO, que es donde está atornillada.
 * Con eso la bisagra se comporta como una bisagra en todo el recorrido sin una línea de animación.
 */
interface Bisagra {
	/** Nudillo, pasador y pala de la hoja: giran con la puerta. */
	movil: THREE.Group;
	/** Pala atornillada al armario: no se mueve nunca. */
	fija: THREE.Group;
}

function construirBisagra(mats: Materiales, signo: number): Bisagra {
	const movil = new THREE.Group();
	// Nudillo: el cilindro por el que pasa el pasador. EN EL EJE, que es donde gira la puerta.
	const nudillo = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 34, 14), mats.herraje);
	nudillo.castShadow = true;
	movil.add(nudillo);
	// Pasador, asomando un par de milímetros por arriba y por abajo, como uno de verdad.
	const pasador = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 40, 8), mats.acero);
	movil.add(pasador);
	/*
	 * La pala de la HOJA sale del nudillo hacia la puerta y se mete en su canto: no sobresale por
	 * el costado del armario, que es lo que hacía que la bisagra pareciera un tirante pegado a la
	 * pared. `-signo` apunta siempre hacia el interior del armario, tenga las bisagras del lado
	 * que las tenga.
	 */
	const palaHoja = chapa(22, 26, 3.6, mats.herraje, -signo * 10, 0, 5);
	palaHoja.castShadow = true;
	movil.add(palaHoja);

	const fija = new THREE.Group();
	// La pala del CUERPO va detrás de la de la hoja, apoyada contra el costado del armario.
	const palaCuerpo = chapa(20, 26, 3.6, mats.herraje, -signo * 9, 0, -5);
	palaCuerpo.castShadow = true;
	fija.add(palaCuerpo);
	// Sus dos tornillos: es lo que la lee como pieza atornillada y no como un bulto de la chapa.
	for (const sy of [-1, 1]) {
		const t = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 2.4, 8), mats.acero);
		t.rotation.x = Math.PI / 2;
		t.position.set(-signo * 13, sy * 8, -7.2);
		fija.add(t);
	}
	return { movil, fija };
}

/**
 * CIERRE DE CUARTO DE VUELTA, que es lo que lleva un armario industrial: un embellecedor
 * rectangular con un inserto de doble paletón que se gira noventa grados con una llave plana.
 */
function construirCierre(mats: Materiales): THREE.Group {
	const c = new THREE.Group();
	// Embellecedor embutido en la hoja. Va PROUD de la chapa, que es como está montado.
	const escudo = cajaCanto(30, 62, 5, mats.herraje, 0, 0, 2.5, 4, 0.8);
	escudo.castShadow = true;
	c.add(escudo);
	// El casquillo que sobresale y el paletón dentro.
	const casquillo = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.6, 7, 14), mats.herraje);
	casquillo.rotation.x = Math.PI / 2;
	casquillo.position.z = 6.5;
	casquillo.castShadow = true;
	c.add(casquillo);
	const paleton = chapa(3.4, 13, 3, mats.sombra, 0, 0, 9.2);
	c.add(paleton);
	return c;
}

function construirHoja(ancho: number, alto: number, mats: Materiales): THREE.Group {
	const h = new THREE.Group();
	/*
	 * La hoja es chapa PLEGADA, no una losa: una piel exterior y un retorno perimetral hacia
	 * dentro. Modelarla como un bloque de quince milímetros la delata al mirarla de canto, que es
	 * justo la vista en la que una puerta abierta se ve más.
	 */
	const piel = cajaCanto(ancho, alto, CHAPA + 1, mats.puerta, 0, 0, FONDO_HOJA - 1.5, 5, 0.7);
	piel.castShadow = true;
	piel.receiveShadow = true;
	h.add(piel);

	// Retorno perimetral: se mete un milímetro en la piel para no compartir plano con ella.
	const retorno = marco(ancho - 1.2, alto - 1.2, 16, FONDO_HOJA - 2, mats.puerta, (FONDO_HOJA - 2) / 2, 4);
	h.add(retorno);

	/*
	 * JUNTA de estanqueidad, en la cara interior del retorno. Sobresale siete milímetros por
	 * detrás de la hoja: al cerrar entra en el rebaje del marco y queda apretada contra él, que es
	 * lo que se ve en un armario cerrado si uno se fija en la línea oscura del perímetro.
	 */
	const junta = marco(ancho - 30, alto - 30, 9, 7, mats.junta, -2.4, 3);
	junta.castShadow = false;
	h.add(junta);

	return h;
}

/* ------------------------------- Materiales ------------------------------- */

interface Materiales {
	/** Chapa pintada del cuerpo: RAL 7035 apagado, la misma familia que la placa de montaje. */
	exterior: THREE.MeshStandardMaterial;
	/** La puerta, medio tono más clara: es otra pieza y la luz le llega de otra manera. */
	puerta: THREE.MeshStandardMaterial;
	/** Herrajes: bisagras y cierre, en acero niquelado. */
	herraje: THREE.MeshStandardMaterial;
	acero: THREE.MeshStandardMaterial;
	galvanizada: THREE.MeshStandardMaterial;
	junta: THREE.MeshStandardMaterial;
	sombra: THREE.MeshStandardMaterial;
}

function materiales(): Materiales {
	/*
	 * LA CHAPA DEL ARMARIO ES PINTURA EN POLVO, y eso se nota en el GRANO: un powder-coat tiene
	 * una piel de naranja finísima que rompe el reflejo y es lo que impide que una superficie
	 * grande de chapa se lea como plástico moldeado. Es el mismo mapa que ya lleva la placa de
	 * montaje —una textura de 64 píxeles compartida—, así que no cuesta nada y las dos piezas
	 * pintadas del tablero se ven del mismo material, que es lo que son.
	 *
	 * NO se toca la respuesta metálica: subirla convertiría la chapa en un espejo, que es
	 * justamente lo que un armario pintado no es.
	 */
	const grano = granoDePintura();
	const pintada = (color: number) => {
		const m = M.pintado(color);
		if (grano) m.roughnessMap = grano;
		return m;
	};
	return {
		exterior: pintada(0xb9bab6),
		puerta: pintada(0xc3c4c0),
		/*
		 * HERRAJES SATINADOS, NO CROMADOS DE ESPEJO.
		 *
		 * Con la rugosidad de serie (0,35) el nudillo de la bisagra —un cilindro pequeño y muy
		 * curvo— devolvía casi solo el entorno, y el entorno tiene el cielo azulado: mirando el
		 * armario de canto, la bisagra salía AZUL y se leía como una pieza de plástico. El cierre,
		 * que es plano y grande, aguantaba bien el espejo; la bisagra no. Un herraje de armario es
		 * acero niquelado satinado, así que se le sube la rugosidad hasta que refleja la luz y no
		 * el paisaje. El cierre pierde un punto de brillo y sigue leyéndose como metal.
		 */
		herraje: M.metal(0xb4b9bd, 0.48),
		acero: M.metal(0x8d9297, 0.52),
		galvanizada: M.galvanizado(),
		junta: M.baquelita(0x23262a),
		sombra: M.baquelita(0x2a2e32),
	};
}

/* --------------------------------- Montaje --------------------------------- */

/**
 * Por dónde entran los cables de campo: el hueco del suelo y la placa que lo tapa.
 *
 * Lo dice quien monta la escena, no esta función: los prensaestopas los coloca `escena3d` a partir
 * del ancho de la placa y del número de aparatos de campo, así que es quien sabe dónde caen. Aquí
 * solo se abre el suelo donde le digan.
 */
export interface BocaPasacables {
	/** Centro del hueco a lo ancho del armario (0 = centrado). */
	x: number;
	/** Centro del hueco en profundidad, en coordenadas de escena. */
	z: number;
	ancho: number;
	fondo: number;
}

export interface OpcionesEnvolvente {
	/** De qué lado están las bisagras, mirando el armario de frente. */
	bisagras?: 'izquierda' | 'derecha';
	/** Cuánto abre la puerta al arrancar, de 0 (cerrada) a 1 (abierta del todo). */
	apertura?: number;
	/** Dónde abrir el suelo para que pasen los cables de campo. */
	pasacables?: BocaPasacables;
}

/**
 * Monta la envolvente completa alrededor de la placa.
 *
 * `ancho`, `alto` y `profundidad` son los del ARMARIO —los que da `cajaDe`—, no los de la placa:
 * la placa es más pequeña y va montada dentro sobre sus espárragos.
 */
export function construirEnvolvente(
	ancho: number, alto: number, profundidad: number, opciones: OpcionesEnvolvente = {},
): Envolvente {
	const mats = materiales();
	const grupo = new THREE.Group();
	const zBoca = Z_FONDO_INTERIOR - SOLAPE + profundidad;
	// Sin boca declarada se abre una razonable: centrada, ancha y hacia el frente, que es por donde
	// entra la mayoría de las instalaciones.
	const boca: BocaPasacables = opciones.pasacables ?? {
		x: 0, z: Z_FONDO_INTERIOR + profundidad * 0.3,
		ancho: ancho * 0.6, fondo: Math.min(profundidad * 0.4, 70),
	};

	grupo.add(construirCuerpo(ancho, alto, zBoca, mats, boca));

	/* ---- La puerta ---- */
	const izquierda = (opciones.bisagras ?? 'izquierda') === 'izquierda';
	const signo = izquierda ? -1 : 1;   // hacia dónde queda el eje de bisagra
	const pivote = new THREE.Group();
	pivote.position.set(signo * (ancho / 2), 0, zBoca + HOLGURA_PUERTA);

	const hoja = construirHoja(ancho, alto, mats);
	// La hoja se descentra media anchura para que su canto de bisagra caiga sobre el eje.
	hoja.position.x = -signo * (ancho / 2);
	pivote.add(hoja);

	/*
	 * BISAGRAS. Van sobre el eje —por fuera del canto de la hoja, como las de verdad— y su número
	 * sale del alto: dos hasta un metro, tres por encima. Un armario de dos metros con dos
	 * bisagras se ve mal aunque nadie sepa decir por qué.
	 */
	const cuantas = alto > 1000 ? 3 : 2;
	for (let i = 0; i < cuantas; i++) {
		const { movil, fija } = construirBisagra(mats, signo);
		const y = alto / 2 - alto * (cuantas === 2 ? [0.22, 0.78][i] : [0.14, 0.5, 0.86][i]);
		// En el EJE: x = 0 e z = 0 en coordenadas del pivote. Todo lo que se separe de ahí
		// describe un arco al abrir, y un nudillo no describe arcos.
		movil.position.set(0, y, 0);
		pivote.add(movil);
		// La pala fija se cuelga del cuerpo, no del pivote, y por eso hay que darle la posición
		// del eje en coordenadas de la escena.
		fija.position.set(pivote.position.x, y, pivote.position.z);
		grupo.add(fija);
	}

	/*
	 * CIERRE, en el canto libre. Se cuelga de la HOJA y no del pivote: gira con la puerta, que es
	 * lo que hace un cierre.
	 */
	const cierre = construirCierre(mats);
	cierre.position.set(-signo * (ancho / 2 - 34), 0, FONDO_HOJA - 1);
	hoja.add(cierre);

	/*
	 * LOS DOS GRUPOS DE MONTAJE. Están vacíos y ese es el objetivo: cuando lleguen los pilotos,
	 * los pulsadores y los cuerpos de aparato, se cuelgan de aquí y ya viajan con la puerta. No
	 * habrá que tocar nada de este archivo para que se abran con ella.
	 */
	const frente = new THREE.Group();
	frente.position.z = FONDO_HOJA;
	hoja.add(frente);
	const interior = new THREE.Group();
	hoja.add(interior);

	const puerta: Puerta = {
		pivote, hoja, frente, interior,
		aperturaMaxima: izquierda ? -APERTURA : APERTURA,
		ancho, alto, fondo: FONDO_HOJA,
		colocar(objeto, cara, x, y, z = 0) {
			const destino = cara === 'frente' ? frente : interior;
			objeto.position.set(x - ancho / 2, alto / 2 - y, cara === 'frente' ? z : -z);
			destino.add(objeto);
		},
		haciaDentro(objeto) {
			objeto.rotation.y = Math.PI;
		},
	};
	pivote.rotation.y = puerta.aperturaMaxima * (opciones.apertura ?? 0);
	grupo.add(pivote);

	/*
	 * EL ARMARIO NO SE PINCHA. Las mallas de la envolvente se quedan FUERA del trazado de rayos:
	 * ni pueden robar un clic que iba para un cable, ni cuestan tiempo en cada movimiento del
	 * ratón. Medido antes de esto, buscar el aparato bajo el puntero ya era la etapa más cara del
	 * `pointermove` (1,4 ms en un tablero de 52 cables); meterle treinta mallas más de armario
	 * habría sido pagar dos veces por algo que además molesta.
	 */
	grupo.traverse((o) => {
		if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).raycast = () => undefined;
	});

	return { grupo, puerta };
}
