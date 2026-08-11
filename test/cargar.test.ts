/**
 * Tests de la apertura de archivos de proyecto.
 *
 * Un archivo a medio descargar, uno de otra aplicación o uno guardado con una versión más nueva
 * del programa tienen que dar un motivo entendible, no una pantalla en blanco. Y un archivo con
 * basura recuperable (un cable colgando, una colocación fantasma) tiene que abrirse limpio y
 * decir qué se arregló.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ArchivoInvalido, VERSION_FORMATO, cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { Proyecto } from '../src/modelo/tipos.js';

/** Proyecto mínimo pero válido, tal como lo escribe el programa. */
function bueno(): Proyecto {
	const p = crearProyecto('Tablero de prueba');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	p.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', bornes: [{ id: '1', tipo: 'L' }] }];
	p.gabinete.colocaciones = [{ dispositivoId: 'q1', x: 20, y: 20, ancho: 18, alto: 85 }];
	return p;
}

const abrir = (p: unknown): ReturnType<typeof cargarProyecto> => cargarProyecto(JSON.stringify(p));

test('un proyecto bien formado se abre sin arreglos', () => {
	const r = abrir(bueno());
	assert.equal(r.arreglos.length, 0);
	assert.equal(r.proyecto.nombre, 'Tablero de prueba');
	assert.equal(r.proyecto.dispositivos.length, 1);
	assert.equal(r.proyecto.gabinete!.ancho, 600);
});

test('un JSON roto da un motivo, no una excepción cualquiera', () => {
	assert.throws(() => cargarProyecto('{"formato":"tablero-'), (e: Error) => {
		assert.ok(e instanceof ArchivoInvalido);
		assert.match(e.message, /JSON/i);
		return true;
	});
});

test('un archivo de otra aplicación se rechaza por su nombre', () => {
	assert.throws(() => abrir({ version: 1, gabinete: { ancho: 600, alto: 800 } }),
		(e: Error) => e instanceof ArchivoInvalido && /TableroStudio/.test(e.message));
});

test('un proyecto de una versión más nueva pide actualizar el programa', () => {
	const p = { ...bueno(), version: VERSION_FORMATO + 1 };
	assert.throws(() => abrir(p), (e: Error) => e instanceof ArchivoInvalido && /Actualiza/i.test(e.message));
});

test('sin gabinete no hay proyecto que abrir', () => {
	const p = bueno();
	delete (p as Partial<Proyecto>).gabinete;
	assert.throws(() => abrir(p), (e: Error) => e instanceof ArchivoInvalido && /gabinete/i.test(e.message));
});

test('un gabinete sin medidas válidas se rechaza en vez de abrir un armario de 0 mm', () => {
	const p = bueno();
	p.gabinete!.ancho = 0;
	assert.throws(() => abrir(p), (e: Error) => e instanceof ArchivoInvalido && /medidas/i.test(e.message));
});

test('un cable que apunta a un aparato inexistente se quita y se cuenta', () => {
	const p = bueno();
	p.conductores = [
		{ id: 'c1', de: { dispositivoId: 'q1', borneId: '1' }, a: { dispositivoId: 'fantasma', borneId: '2' } },
	];
	const r = abrir(p);
	assert.equal(r.proyecto.conductores.length, 0);
	assert.ok(r.arreglos.some((a) => /cable/i.test(a)), r.arreglos.join(' | '));
});

test('una colocación sin aparato deja de ocupar sitio en la placa', () => {
	const p = bueno();
	p.gabinete!.colocaciones.push({ dispositivoId: 'no-existe', x: 200, y: 20, ancho: 18, alto: 85 });
	const r = abrir(p);
	assert.equal(r.proyecto.gabinete!.colocaciones.length, 1);
	assert.ok(r.arreglos.some((a) => /colocaci/i.test(a)), r.arreglos.join(' | '));
});

test('los aparatos sin id o sin tipo y los duplicados se descartan', () => {
	const p = bueno() as unknown as Record<string, unknown>;
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', bornes: [] },
		{ id: 'q1', tipo: 'disyuntor', bornes: [] },  // duplicado
		{ tipo: 'rele', bornes: [] },                 // sin id
		{ id: 'x9', bornes: [] },                     // sin tipo
	];
	const r = cargarProyecto(JSON.stringify(p));
	assert.equal(r.proyecto.dispositivos.length, 1);
	assert.ok(r.arreglos.some((a) => /aparato/i.test(a)), r.arreglos.join(' | '));
});

test('una lista corrupta no revienta la apertura: se vacía y se dice', () => {
	const p = bueno() as unknown as Record<string, unknown>;
	p.conductores = 'esto no es una lista';
	const r = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(r.proyecto.conductores, []);
	assert.ok(r.arreglos.length > 0);
});

test('un proyecto sin hojas recibe una para que el esquema tenga dónde dibujarse', () => {
	const p = bueno();
	p.hojas = [];
	const r = abrir(p);
	assert.equal(r.proyecto.hojas.length, 1);
	assert.ok(r.arreglos.some((a) => /hoja/i.test(a)), r.arreglos.join(' | '));
});

test('un proyecto sin nombre no sale anónimo', () => {
	const p = bueno();
	p.nombre = '   ';
	assert.equal(abrir(p).proyecto.nombre, 'Tablero sin nombre');
});

test('los datos administrativos y las opciones sobreviven a la ida y vuelta', () => {
	const p = bueno();
	p.datos = { cliente: 'Minera Los Andes', revision: 'B' };
	p.opciones = { iccPresuntaKA: 10, montajeGabinete: 'empotrado' };
	const r = abrir(p);
	assert.equal(r.proyecto.datos!.cliente, 'Minera Los Andes');
	assert.equal(r.proyecto.opciones!.iccPresuntaKA, 10);
	assert.equal(r.proyecto.opciones!.montajeGabinete, 'empotrado');
});

test('el archivo abierto queda marcado con la versión de formato de este programa', () => {
	assert.equal(abrir(bueno()).proyecto.version, VERSION_FORMATO);
});

/* ---------------- Los ajustes del esquema sobreviven a guardar y abrir ---------------- */

test('las colocaciones a mano del esquema no se pierden al abrir el archivo', () => {
	// Si se perdieran, el usuario ordenaría su esquema, guardaría, y al volver se lo encontraría
	// desordenado otra vez sin saber por qué.
	const p = crearProyecto('t');
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', bornes: [], esquema: { columna: 7, fila: 3 } }];
	p.esquema = { columnasPorHoja: 6, titulos: { 1: 'Fuerza del taller' } };

	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(proyecto.dispositivos[0].esquema, { columna: 7, fila: 3 });
	assert.equal(proyecto.esquema?.columnasPorHoja, 6);
	assert.equal(proyecto.esquema?.titulos?.['1'], 'Fuerza del taller');
});

test('un ajuste de esquema corrupto no rompe el dibujo: se descarta', () => {
	const p = crearProyecto('t') as unknown as Record<string, unknown>;
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [
		{ id: 'a', tipo: 'disyuntor', bornes: [], esquema: { columna: 'siete', fila: null } },
		{ id: 'b', tipo: 'disyuntor', bornes: [], esquema: 'lo que sea' },
	];
	p.esquema = { columnasPorHoja: 500, titulos: { 1: 42, 2: '  ' } };

	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.equal(proyecto.dispositivos[0].esquema, undefined, 'una columna que no es número se cuela');
	assert.equal(proyecto.dispositivos[1].esquema, undefined);
	assert.equal(proyecto.esquema?.columnasPorHoja, 20, '500 columnas dejarían el esquema ilegible');
	assert.equal(proyecto.esquema?.titulos, undefined, 'títulos que no son texto se cuelan');
});

/* ------------- Lo que se añade al dossier sobrevive a guardar y abrir ------------- */

test('los apartados apagados y los bloques del dossier se conservan', () => {
	const p = crearProyecto('t');
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.dossier = {
		secciones: { bom: false },
		bloques: [
			{ id: 'b1', tipo: 'texto', donde: 'principio', titulo: 'Presentación',
				trozos: [{ texto: 'Estimado ' }, { texto: 'cliente', negrita: true, tam: 14 }] },
			{ id: 'b2', tipo: 'imagen', donde: 'final', imagen: 'data:image/png;base64,AAAA', anchoPct: 70 },
		],
	};
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.equal(proyecto.dossier?.secciones?.bom, false);
	assert.equal(proyecto.dossier?.bloques?.length, 2);
	assert.deepEqual(proyecto.dossier?.bloques?.[0].trozos?.[1], { texto: 'cliente', negrita: true, tam: 14 });
	assert.equal(proyecto.dossier?.bloques?.[1].anchoPct, 70);
});

test('un «data:» que no es una imagen NO entra en el dossier', () => {
	// Un data:text/html metido a mano en el archivo acabaría dentro del PDF que se manda fuera.
	const p = crearProyecto('t') as unknown as Record<string, unknown>;
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.dossier = {
		bloques: [
			{ id: 'malo', tipo: 'imagen', donde: 'final', imagen: 'data:text/html,<script>x</script>' },
			{ id: 'peor', tipo: 'imagen', donde: 'final', imagen: 'javascript:alert(1)' },
			{ id: 'bueno', tipo: 'imagen', donde: 'final', imagen: 'data:image/jpeg;base64,BBBB' },
		],
	};
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(proyecto.dossier?.bloques?.map((b) => b.id), ['bueno']);
});

test('un bloque con un destino inventado se coloca al final, no se pierde', () => {
	const p = crearProyecto('t') as unknown as Record<string, unknown>;
	p.gabinete = { ancho: 400, alto: 400, rieles: [], canaletas: [], colocaciones: [] };
	p.dossier = { bloques: [{ id: 'x', tipo: 'texto', donde: 'en la luna', trozos: [{ texto: 'hola' }] }] };
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.equal(proyecto.dossier?.bloques?.[0].donde, 'final');
});

/* ================== Auditoría TS-P1-02: lo de DENTRO también se mira ==================

El cargador comprobaba bien el primer nivel —que `rieles` sea una lista de objetos, que el
gabinete tenga medidas— pero lo de dentro pasaba con un `as` y sin mirar. Y lo que se dibuja son
esos números. Medido antes del arreglo, cargando y pasando los motores:

  · `bornes: ["1", 2, null]`  →  TypeError: Cannot read properties of null (reading 'id').
                                 La aplicación entera se cae al primer recálculo.
  · `canaleta.ancho: null`    →  el ruteo devuelve longitudes NaN, sin avisar de nada.

No hace falta mala fe: estos archivos van por correo y por pendrive entre el taller y la obra, se
copian a medias, se abren con la versión de otro y alguna vez se tocan a mano. */

/** Proyecto válido al que se le puede romper una pieza. */
function conEstructura(): Record<string, unknown> {
	const p = bueno() as unknown as Record<string, unknown>;
	p.gabinete = {
		ancho: 600, alto: 800,
		rieles: [{ id: 'r1', x: 30, y: 80, largo: 540 }],
		canaletas: [{ id: 'ch1', x: 20, y: 140, largo: 560, orientacion: 'h', ancho: 40, alto: 60 }],
		colocaciones: [{ dispositivoId: 'q1', x: 20, y: 20, ancho: 18, alto: 85 }],
	};
	return p;
}

/** ¿Queda algún NaN o Infinity suelto ahí dentro? Es lo que hace desaparecer cosas de la pantalla. */
function tieneNumerosImposibles(v: unknown, visto = new Set<unknown>()): boolean {
	if (typeof v === 'number') return !Number.isFinite(v);
	if (v && typeof v === 'object') {
		if (visto.has(v)) return false;
		visto.add(v);
		return Object.values(v).some((x) => tieneNumerosImposibles(x, visto));
	}
	return false;
}

test('un riel con la posición en texto se abre con números, no con NaN', () => {
	const p = conEstructura();
	(p.gabinete as Record<string, unknown[]>).rieles = [{ id: 'r1', x: 'treinta', y: 80, largo: 540 }];
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	const riel = proyecto.gabinete!.rieles[0];
	assert.ok(Number.isFinite(riel.x), `x salió «${riel.x}»`);
	assert.ok(!tieneNumerosImposibles(proyecto));
});

test('un riel sin largo se abre del ancho de la placa, no invisible', () => {
	const p = conEstructura();
	(p.gabinete as Record<string, unknown[]>).rieles = [{ id: 'r1', x: 30, y: 80 }];
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	// Se ve y se puede arrastrar hasta donde toque: un riel de largo 0 no existe para el usuario.
	assert.ok(proyecto.gabinete!.rieles[0].largo > 0);
});

test('una canaleta con el perfil en null sale con un perfil real', () => {
	const p = conEstructura();
	(p.gabinete as Record<string, unknown[]>).canaletas =
		[{ id: 'ch1', x: 20, y: 140, largo: 560, orientacion: 'h', ancho: null, alto: 60 }];
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.ok(proyecto.gabinete!.canaletas[0].ancho > 0);
	assert.ok(!tieneNumerosImposibles(proyecto), 'ese null acababa en longitudes NaN del ruteo');
});

/*
 * Con las colocaciones NO se inventa nada, y es a propósito: una colocación dice dónde va montado
 * un aparato de verdad. Ponerla «más o menos» sería dibujar un tablero que no existe. Se descarta,
 * el aparato se queda sin colocar y el DRC lo canta, que es lo que hay que arreglar a mano.
 */
test('una colocación sin medidas creíbles se descarta y se cuenta', () => {
	const p = conEstructura();
	(p.gabinete as Record<string, unknown[]>).colocaciones = [
		{ dispositivoId: 'q1', x: 20, y: 20, ancho: 'x', alto: 85 },
	];
	const { proyecto, arreglos } = cargarProyecto(JSON.stringify(p));
	assert.equal(proyecto.gabinete!.colocaciones.length, 0);
	assert.ok(arreglos.some((a) => /colocaciones/.test(a)), `arreglos: ${arreglos.join(' | ')}`);
});

test('unos bornes que no son objetos no tiran la aplicación', () => {
	const p = conEstructura();
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', designacion: '-Q1', bornes: ['1', 2, null] }];
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(proyecto.dispositivos[0].bornes, []);
});

test('dos bornas con el mismo número se quedan en una (si no, no se distinguen al cablear)', () => {
	const p = conEstructura();
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', bornes: [{ id: '1' }, { id: '1' }, { id: '2' }] }];
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(proyecto.dispositivos[0].bornes.map((b) => b.id), ['1', '2']);
});

/*
 * Un dato eléctrico que no es un número es un dato que NO ESTÁ, y sin declarar el programa ya
 * sabe decirlo. Dejarlo pasar es peor que perderlo: el DRC compara la corriente con la sección
 * del cable, y comparar con un texto sale siempre falso — el aviso de «cable insuficiente» no
 * aparece y el tablero se monta con un hilo que no aguanta.
 */
test('una corriente nominal en texto se queda sin declarar, no en cero', () => {
	const p = conEstructura();
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', corrienteNominal: 'diez amperios', bornes: [{ id: '1' }] }];
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.equal(proyecto.dispositivos[0].corrienteNominal, undefined);
});

test('un número de polos imposible no entra', () => {
	const p = conEstructura();
	p.dispositivos = [{ id: 'q1', tipo: 'disyuntor', polos: 99, bornes: [{ id: '1' }] }];
	assert.equal(cargarProyecto(JSON.stringify(p)).proyecto.dispositivos[0].polos, undefined);
});

test('un trazado de cable con puntos rotos se limpia (si no, el cable desaparece de la pantalla)', () => {
	const p = conEstructura();
	p.dispositivos = [
		{ id: 'q1', tipo: 'disyuntor', bornes: [{ id: '1' }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }] },
	];
	p.conductores = [{
		id: 'c1', de: { dispositivoId: 'q1', borneId: '1' }, a: { dispositivoId: 'x1', borneId: '1' },
		trazado: [{ x: 'a', y: null }, { x: 5 }, { x: 10, y: 20 }],
	}];
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	assert.deepEqual(proyecto.conductores[0].trazado, [{ x: 10, y: 20 }]);
	assert.ok(!tieneNumerosImposibles(proyecto));
});

/*
 * Auditoría TS-P1-03, la otra puerta. Los recuadros de «Datos del proyecto» ya validaban lo que
 * se teclea, pero las opciones del ARCHIVO entraban con un `as` y sin mirar. Esos dos números son
 * de los que deciden: la Icc presunta dice si las protecciones aguantan un cortocircuito, y la
 * temperatura ambiente sale en el balance térmico. Un valor imposible ahí no da un error visible:
 * da un veredicto tranquilizador sin motivo, que es peor.
 */
test('unas opciones imposibles en el archivo se quedan sin declarar', () => {
	const p = conEstructura();
	p.opciones = {
		iccPresuntaKA: 'mucha', temperaturaAmbienteC: null, frecuenciaHz: -50,
		corrienteAsignadaA: 1e12, montajeGabinete: 'colgando', regimenNeutro: 'XX', gradoIP: 'IP999',
	};
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	const o = proyecto.opciones ?? {};
	assert.equal(o.iccPresuntaKA, undefined);
	assert.equal(o.temperaturaAmbienteC, undefined);
	assert.equal(o.frecuenciaHz, undefined);
	assert.equal(o.corrienteAsignadaA, undefined);
	assert.equal(o.montajeGabinete, undefined);
	assert.equal(o.regimenNeutro, undefined);
	assert.equal(o.gradoIP, undefined);
});

test('unas opciones buenas se respetan enteras', () => {
	const p = conEstructura();
	p.opciones = {
		iccPresuntaKA: 6, temperaturaAmbienteC: 40, frecuenciaHz: 50,
		corrienteAsignadaA: 63, montajeGabinete: 'mural', regimenNeutro: 'TN-S', gradoIP: 'IP54',
	};
	assert.deepEqual(cargarProyecto(JSON.stringify(p)).proyecto.opciones, {
		iccPresuntaKA: 6, temperaturaAmbienteC: 40, frecuenciaHz: 50,
		corrienteAsignadaA: 63, montajeGabinete: 'mural', regimenNeutro: 'TN-S', gradoIP: 'IP54',
	});
});

test('una placa de tamaño imposible no se abre', () => {
	const p = conEstructura();
	(p.gabinete as Record<string, unknown>).ancho = 1e9;
	// Un número enorme manda la cámara al infinito y deja la pantalla en negro: mejor decirlo.
    assert.throws(() => cargarProyecto(JSON.stringify(p)), ArchivoInvalido);
});

/*
 * Cliente, obra, revisión y fecha van al CAJETÍN DEL PLANO, que los mide para encajarlos en su
 * casilla. Si el archivo trae `cliente: {}`, lo que llega al PDF no es una cadena: o revienta la
 * exportación, o —peor— sale un «[object Object]» impreso en un plano que se firma y va a obra.
 */
test('los datos del cajetín que no son texto no llegan al plano', () => {
	const p = conEstructura();
	p.datos = { cliente: {}, obra: 42, proyectista: null, revision: [], fecha: 'ayer' };
	const { proyecto } = cargarProyecto(JSON.stringify(p));
	for (const [k, v] of Object.entries(proyecto.datos ?? {})) {
		assert.equal(typeof v === 'string' || v === undefined, true, `«${k}» salió como ${typeof v}`);
	}
	assert.equal(proyecto.datos?.fecha, undefined, 'una fecha que no es ISO no se inventa');
});

test('los datos buenos del cajetín se respetan', () => {
	const p = conEstructura();
	p.datos = { cliente: 'Nuevo Pudahuel', obra: 'Terminal Internacional', revision: 'B', fecha: '2026-08-08' };
	assert.deepEqual(cargarProyecto(JSON.stringify(p)).proyecto.datos, {
		cliente: 'Nuevo Pudahuel', obra: 'Terminal Internacional', proyectista: undefined,
		fabricante: undefined, revision: 'B', fecha: '2026-08-08', notas: undefined,
	});
});

/* ==============================================================================================
 * Segunda auditoría, TS2-P1-01: lo anidado también.
 *
 * El aparato entraba con un spread del objeto externo y solo se saneaban los campos escalares.
 * Todo lo que es una lista o un objeto —y que después un motor recorre— pasaba con la forma que
 * trajera. Medido contra el build de entonces: los cuatro casos de abajo CARGABAN con cero
 * arreglos y reventaban al primer recálculo, con el proyecto anterior ya sustituido en memoria.
 * ============================================================================================== */

import { calcularPotenciales } from '../src/motores/potenciales.js';
import { simular } from '../src/motores/simulacion.js';
import { verificarProyecto } from '../src/motores/drc.js';
import { readFileSync } from 'node:fs';

/** Un aparato con un campo cualquiera metido a mano, como llega un archivo tocado por fuera. */
function conCampo(campo: string, valor: unknown): unknown {
	const p = bueno() as unknown as Record<string, unknown>;
	const d = (p.dispositivos as Record<string, unknown>[])[0];
	d[campo] = valor;
	return p;
}

/** Lo que hace la aplicación nada más abrir: si algo revienta, revienta aquí. */
function usar(p: Proyecto): void {
	const pot = calcularPotenciales(p);
	verificarProyecto(p, pot);
	simular(p);
}

/*
 * Las formas con las que llega la basura de verdad: la lista que es un objeto, la lista con un
 * hueco, el objeto donde iba una lista y el texto donde iba todo.
 */
const BASURA: [string, unknown][] = [
	['objeto vacío', {}],
	['lista con un nulo', [null]],
	['texto', 'hola'],
	['número', 7],
	['lista de listas rotas', [[null, 'a'], ['b'], []]],
	['objeto con campos a medias', { tipo: 'ninguno' }],
	['lista de objetos incompletos', [{}, { bornes: null }, { lado: 'ninguno' }]],
];

/** Todo campo de `Dispositivo` que no sea un escalar suelto: si algún motor lo recorre, va aquí. */
const ANIDADOS = [
	'puentes', 'puentesInternos', 'terminales', 'bornes', 'rangoRegulacionA', 'rangoSonda',
	'temporizacion', 'rasgosFrente', 'posicion', 'rol', 'esquema',
];

for (const campo of ANIDADOS) {
	test(`\`${campo}\` con cualquier forma: o no entra, o entra bien — pero no revienta`, () => {
		for (const [nombre, valor] of BASURA) {
			let cargado: Proyecto;
			try {
				cargado = abrir(conCampo(campo, valor)).proyecto;
			} catch (e) {
				// Rechazarlo con un motivo entendible es una respuesta válida; reventar, no.
				assert.ok(e instanceof ArchivoInvalido, `${campo}=${nombre}: ${(e as Error).message}`);
				continue;
			}
			assert.doesNotThrow(() => usar(cargado),
				`${campo} = ${nombre}: cargó y después reventó un motor`);
		}
	});
}

test('un SVG no entra como imagen: jsPDF no sabe dibujarlo y el dossier queda inservible', () => {
	const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
	const { proyecto } = abrir(conCampo('imagen', svg));
	assert.equal(proyecto.dispositivos[0].imagen, undefined,
		'el selector lo acepta como image/*, pero al generar el PDF paraba con «type UNKNOWN»');

	const png = `data:image/png;base64,${'iVBORw0KGgo='.repeat(3)}`;
	assert.equal(abrir(conCampo('imagen', png)).proyecto.dispositivos[0].imagen, png,
		'y un PNG de verdad sí entra');
});

test('una imagen sin fin no entra: el historial guarda 60 copias del proyecto', () => {
	const gigante = `data:image/png;base64,${'A'.repeat(7_000_000)}`;
	assert.equal(abrir(conCampo('imagen', gigante)).proyecto.dispositivos[0].imagen, undefined);
});

/*
 * Y QUE NO SE OLVIDE NINGUNO.
 *
 * La lista de arriba se escribió a mano mirando `Dispositivo`. Dentro de seis meses alguien añade
 * un campo nuevo que es una lista, se le olvida el lector, y el agujero vuelve a estar abierto sin
 * que ninguna prueba lo note. Esto lo impide: lee el tipo y exige que cada campo estructurado
 * tenga su lector en el cargador.
 */
test('ningún campo estructurado de Dispositivo se queda sin lector en el cargador', () => {
	const tipos = readFileSync(new URL('../../src/modelo/tipos.ts', import.meta.url), 'utf8');
	const cargador = readFileSync(new URL('../../src/modelo/cargar.ts', import.meta.url), 'utf8');
	const cuerpo = /export interface Dispositivo \{([\s\S]*?)\n\}/.exec(tipos)?.[1];
	assert.ok(cuerpo, 'no se encontró la interfaz Dispositivo: la comprobación dejaría de mirar');

	const sinComentarios = cuerpo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
	const estructurados: string[] = [];
	for (const m of sinComentarios.matchAll(/^\t([A-Za-z_$][\w$]*)\??:\s*([^;]+);/gm)) {
		const [, nombre, tipo] = m;
		// Escalares: texto, número, booleano y uniones de literales de texto. Lo demás se recorre.
		const escalar = /^(string|number|boolean)$/.test(tipo.trim())
			|| /^(['"][^'"]*['"]\s*\|?\s*)+$/.test(tipo.trim());
		if (!escalar) estructurados.push(nombre);
	}
	assert.ok(estructurados.length >= 10, `solo vio ${estructurados.length} campos estructurados`);

	// El nombre tiene que aparecer LEÍDO en `leerDispositivos`, no solo mencionado en un comentario.
	const leerDisp = /function leerDispositivos[\s\S]*?\n\}/.exec(cargador)![0];
	const sinLector = estructurados.filter((c) => !new RegExp(`\\b${c}:`).test(leerDisp));
	assert.deepEqual(sinLector, [], '\n  Estos campos de `Dispositivo` entran sin comprobar su forma:\n  '
		+ `${sinLector.join(', ')}\n\n`
		+ '  Un `for…of` sobre uno de ellos con la forma equivocada tira el editor entero con el\n'
		+ '  proyecto anterior ya sustituido en memoria. Añade su lector en `leerDispositivos`.\n');
});

/* ==============================================================================================
 * EL CONTRATO DE DIAGNÓSTICOS. Tercera auditoría, TS3-P0-01.
 *
 * La protección del autosave —congelar el guardado si hubo que reparar el archivo— depende de que
 * el cargador DIGA que lo reparó. Y eso era una lista que cada lector podía olvidar rellenar.
 * `leerImagen()` la olvidaba: quitaba la imagen, devolvía cero arreglos, el arranque no congelaba
 * nada y el primer autoguardado reemplazaba el original. Medido por la auditoría, por la interfaz:
 * 1.046 bytes antes, 910 después, imagen perdida, cero diálogos.
 *
 * Lo que sigue no comprueba un caso: comprueba la REGLA, campo por campo. Si mañana alguien añade
 * un lector y se olvida de apuntar lo que tira, esto lo dice con el nombre del campo.
 * ============================================================================================== */

/** Un valor que ningún campo del modelo puede aceptar tal cual. */
const VENENO: Record<string, unknown> = {
	imagen: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
	fabricante: {},
	referencia: [],
	descripcion: 42,
	designacion: { a: 1 },
	congelado: 'false',
	campo: 'sí',
	poderCorteEstimado: 1,
	corrienteNominal: 'diez amperios',
	tensionNominal: {},
	polos: 99,
	disipacionW: 'mucho',
	poderCorteKA: -5,
	sensibilidadMA: [],
	profundidad: 'hondo',
	curvaDisparo: 'Ñ',
	claseDiferencial: 'Z',
	clase: 'ÑÑ',
	programa: 7,
	unidadSonda: {},
	colorCuerpo: [],
	hojaId: 3,
	temporizacion: { tipo: 'siempre', segundos: 'muchos' },
	rangoSonda: [10, 0],
	rangoRegulacionA: 'de 1 a 10',
	posicion: { x: 'a', y: 'b' },
	rol: { tipo: 'esclavo' },
	rasgosFrente: { leds: 'tres' },
	terminales: [{ lado: 'diagonal', bornes: [] }],
	puentes: {},
	puentesInternos: [null],
};

for (const [campo, valor] of Object.entries(VENENO)) {
	test(`«${campo}» malo: o se conserva, o se rechaza, pero SIEMPRE se declara`, () => {
		const p = bueno() as unknown as Record<string, unknown>;
		const d = (p.dispositivos as Record<string, unknown>[])[0];
		d[campo] = valor;
		const r = abrir(p);
		const quedo = (r.proyecto.dispositivos[0] as unknown as Record<string, unknown>)[campo];

		if (quedo !== undefined) return;   // se conservó tal cual: no hubo cambio destructivo
		assert.ok(r.arreglos.length > 0,
			`se tiró «${campo}» y el cargador no dijo nada. Eso deja el autosave sin congelar y `
			+ 'el original se pisa: es exactamente el P0 de la tercera auditoría.');
		assert.ok(r.diagnosticos.some((x) => x.ruta.endsWith(`.${campo}`)),
			`el diagnóstico no dice DÓNDE estaba. Rutas: ${r.diagnosticos.map((x) => x.ruta).join(', ')}`);
	});
}

test('un proyecto limpio no genera ni un diagnóstico', () => {
	const r = abrir(bueno());
	assert.deepEqual(r.diagnosticos, []);
	assert.deepEqual(r.arreglos, []);
});

test('un cable a un borne que no existe no entra, y se dice', () => {
	const p = bueno();
	p.conductores = [{ id: 'w1', de: { dispositivoId: 'q1', borneId: '1' },
		a: { dispositivoId: 'q1', borneId: 'NO_EXISTE' } }];
	const r = abrir(p);
	assert.equal(r.proyecto.conductores.length, 0);
	assert.ok(r.arreglos.some((a) => /borne/.test(a)), r.arreglos.join(' · '));
});

test('dos cables con el mismo id: se queda uno', () => {
	const p = bueno();
	const c = { de: { dispositivoId: 'q1', borneId: '1' }, a: { dispositivoId: 'q1', borneId: '1' } };
	p.conductores = [{ id: 'w1', ...c }, { id: 'w1', ...c }];
	const r = abrir(p);
	assert.equal(r.proyecto.conductores.length, 1);
	assert.ok(r.arreglos.some((a) => /identificador/.test(a)));
});

test('un archivo con más aparatos de los que caben se recorta y se dice', () => {
	const p = bueno() as unknown as Record<string, unknown>;
	p.dispositivos = Array.from({ length: 3000 }, (_, i) => ({
		id: `d${i}`, tipo: 'disyuntor', bornes: [{ id: '1', tipo: 'L' }],
	}));
	const r = abrir(p);
	assert.ok(r.proyecto.dispositivos.length < 3000);
	assert.ok(r.arreglos.some((a) => /máximo/.test(a)), r.arreglos.join(' · '));
});

test('las opciones mal tipadas no llegan a los motores', () => {
	const p = bueno() as unknown as Record<string, unknown>;
	p.opciones = { formatoDesignacion: false, reservaCable: 'mucho', inicioNumeracionConductores: {} };
	const r = abrir(p);
	assert.equal(r.proyecto.opciones?.formatoDesignacion, undefined);
	assert.equal(r.proyecto.opciones?.reservaCable, undefined);
	assert.equal(r.proyecto.opciones?.inicioNumeracionConductores, undefined);
	assert.equal(r.diagnosticos.filter((d) => d.ruta.startsWith('opciones.')).length, 3);
});
