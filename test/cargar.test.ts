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
