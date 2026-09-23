import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	DefinicionComponentePersonalizado,
	actualizarDefinicionComponente,
	crearPaqueteProyecto,
	instanciarComponentePersonalizado,
	leerPaqueteProyecto,
	sugerirRolesIEC,
	validarDefinicionComponente,
} from '../src/componentes/personalizados.js';
import { referenciaTecnica } from '../src/datos-tecnicos/tipos.js';
import { curvaTecnica, productoTecnico } from './helpers/datos-tecnicos.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { esReferenciaVisualInerte } from '../src/modelo/apariencia.js';
import { generarFichaTablero } from '../src/motores/ficha-tablero.js';

const definicionContactor = (): DefinicionComponentePersonalizado => ({
	formato: 'tablero-studio-componente',
	version: 1,
	id: 'cmp-k1',
	revision: 1,
	nombre: 'Contactor de imagen',
	fabricante: 'Ejemplo',
	referencia: 'K-IMG',
	creadoEn: '2026-08-23T10:00:00.000Z',
	modificadoEn: '2026-08-23T10:00:00.000Z',
	tipoDispositivo: 'contactor',
	dimensiones: { anchoMm: 45, altoMm: 85, fondoMm: 75 },
	assetId: `sha256:${'a'.repeat(64)}`,
	terminales: [
		{ id: 'A1', tipo: 'control', u: 0.15, v: 0.85 },
		{ id: 'A2', tipo: 'control', u: 0.85, v: 0.85 },
		{ id: 'L1', tipo: 'L', u: 0.2, v: 0.08 },
		{ id: 'T1', tipo: 'L', u: 0.2, v: 0.55 },
		{ id: 'L2', tipo: 'L', u: 0.5, v: 0.08 },
		{ id: 'T2', tipo: 'L', u: 0.5, v: 0.55 },
		{ id: 'L3', tipo: 'L', u: 0.8, v: 0.08 },
		{ id: 'T3', tipo: 'L', u: 0.8, v: 0.55 },
		{ id: '13', tipo: 'control', u: 0.12, v: 0.35 },
		{ id: '14', tipo: 'control', u: 0.12, v: 0.48 },
		{ id: '21', tipo: 'control', u: 0.88, v: 0.35 },
		{ id: '22', tipo: 'control', u: 0.88, v: 0.48 },
	],
	comportamiento: {
		version: 1,
		clase: 'contactos-electromagneticos',
		bobina: { entrada: 'A1', retorno: 'A2' },
		polos: [
			{ entrada: 'L1', salida: 'T1' },
			{ entrada: 'L2', salida: 'T2' },
			{ entrada: 'L3', salida: 'T3' },
		],
		contactos: [
			{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' },
			{ entrada: '21', salida: '22', reposo: 'cerrado', funcion: 'auxiliar' },
		],
	},
	parametros: { tensionV: 24, corrienteA: 9 },
});

const definicionProteccionConFicha = (): DefinicionComponentePersonalizado => {
	const d = definicionContactor();
	d.tipoDispositivo = 'disyuntor';
	d.comportamiento = { version: 1, clase: 'proteccion', funcion: 'termomagnetico', rearmable: true,
		polos: [{ entrada: 'L1', salida: 'T1' }], contactos: [] };
	const curva = curvaTecnica();
	const producto = productoTecnico({ curva: referenciaTecnica(curva) });
	d.fichaTecnica = { producto: referenciaTecnica(producto), revisiones: [producto, curva] };
	return d;
};

test('ficha V8 de componente: producto y curva exactos, sin atribuir autenticidad al hash', () => {
	const d = definicionProteccionConFicha();
	assert.deepEqual(validarDefinicionComponente(d), []);
	const colocado = instanciarComponentePersonalizado(d, 'q-propia');
	assert.equal(colocado.comportamiento?.clase, 'proteccion');
	assert.equal(colocado.componentePersonalizado.revision, 1);
	assert.equal(d.fichaTecnica?.revisiones.length, 2);
	assert.equal(d.fichaTecnica?.revisiones[0].procedencia.origen, 'SINTETICO');
});

test('ficha V8 rechaza dependencia ausente, hash falso, extra, duplicado y familia distinta', () => {
	const falta = definicionProteccionConFicha();
	falta.fichaTecnica!.revisiones.pop();
	assert.match(validarDefinicionComponente(falta).join(' '), /MISSING|dependencia exacta/);
	const hash = definicionProteccionConFicha();
	hash.fichaTecnica!.revisiones[0].nombre = 'Adulterado';
	assert.match(validarDefinicionComponente(hash).join(' '), /Integridad inválida/);
	const extra = definicionProteccionConFicha();
	extra.fichaTecnica!.revisiones = [extra.fichaTecnica!.revisiones[0],
		productoTecnico({ id: 'otro-producto', curva: undefined })];
	assert.match(validarDefinicionComponente(extra).join(' '), /ajenas|dependencia exacta/);
	const duplicada = definicionProteccionConFicha();
	duplicada.fichaTecnica!.revisiones = [duplicada.fichaTecnica!.revisiones[0],
		structuredClone(duplicada.fichaTecnica!.revisiones[0])];
	assert.match(validarDefinicionComponente(duplicada).join(' '), /duplicada/);
	const familia = definicionProteccionConFicha();
	const ajeno = productoTecnico({ id: 'motor-ajeno', familia: 'MOTOR', campos: [], curva: undefined });
	familia.fichaTecnica = { producto: referenciaTecnica(ajeno), revisiones: [ajeno] };
	assert.match(validarDefinicionComponente(familia).join(' '), /familia funcional/);
	const metadata = definicionProteccionConFicha();
	(metadata.fichaTecnica as unknown as Record<string, unknown>).revisionHumana = { estado: 'REVISADO' };
	assert.match(validarDefinicionComponente(metadata).join(' '), /solo un producto exacto/);
});

test('un paquete V3 porta la ficha técnica exacta de dos revisiones; V1/V2 siguen sin ficha', () => {
	const r1 = definicionProteccionConFicha();
	const r2 = { ...structuredClone(r1), revision: 2 };
	const p = crearProyecto('Dos revisiones con ficha');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja' }];
	p.gabinete = { ancho: 400, alto: 500, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'q1', x: 10, y: 10, ancho: 45, alto: 85 },
		{ dispositivoId: 'q2', x: 80, y: 10, ancho: 45, alto: 85 },
	] };
	p.dispositivos = [instanciarComponentePersonalizado(r1, 'q1'), instanciarComponentePersonalizado(r2, 'q2')];
	const asset = [{ id: r1.assetId, mime: 'image/png' as const, base64: 'AQID' }];
	assert.throws(() => crearPaqueteProyecto(p, asset, [r1, r2], 2), /requiere.*V3/);
	const v3 = crearPaqueteProyecto(p, asset, [r2, r1], 3);
	assert.equal(v3.version, 3);
	assert.deepEqual(leerPaqueteProyecto(JSON.stringify(v3)).componentes, [r2, r1]);
	const roto = structuredClone(v3); roto.componentes[0].fichaTecnica!.revisiones.pop();
	assert.throws(() => leerPaqueteProyecto(JSON.stringify(roto)), /MISSING|dependencia exacta/);
	const viejo = definicionContactor();
	const anterior = crearProyecto('Formato anterior');
	anterior.hojas = p.hojas; anterior.gabinete = { ...p.gabinete, colocaciones: [p.gabinete.colocaciones[0]] };
	anterior.dispositivos = [instanciarComponentePersonalizado(viejo, 'q1')];
	assert.equal(leerPaqueteProyecto(JSON.stringify(crearPaqueteProyecto(anterior, asset, [viejo]))).version, 1);
});

test('un contactor personalizado completo valida sin inferir su función desde la imagen', () => {
	assert.deepEqual(validarDefinicionComponente(definicionContactor()), []);
});

test('los límites de borne se validan en el contrato común, no solo en el editor visual', () => {
	const valido = definicionContactor();
	valido.terminales[0].maxConductores = 1;
	valido.terminales[0].seccionMaxMm2 = 2.5;
	assert.deepEqual(validarDefinicionComponente(valido), []);
	assert.equal(instanciarComponentePersonalizado(valido, 'k-limites').bornes[0].seccionMaxMm2, 2.5);

	for (const valor of [0, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Infinity]) {
		const invalido = definicionContactor();
		invalido.terminales[0].maxConductores = valor;
		assert.match(validarDefinicionComponente(invalido).join(' '), /máximo de conductores/);
		assert.throws(() => instanciarComponentePersonalizado(invalido, 'k-limites'), /máximo de conductores/);
		assert.throws(() => actualizarDefinicionComponente(definicionContactor(),
			{ terminales: invalido.terminales }), /máximo de conductores/);
	}
	for (const valor of [0, -1, Number.NaN, Infinity]) {
		const invalido = definicionContactor();
		invalido.terminales[0].seccionMaxMm2 = valor;
		assert.match(validarDefinicionComponente(invalido).join(' '), /sección máxima/);
		assert.throws(() => instanciarComponentePersonalizado(invalido, 'k-limites'), /sección máxima/);
	}
	const sinTopeArbitrario = definicionContactor();
	sinTopeArbitrario.terminales[0].maxConductores = 17;
	sinTopeArbitrario.terminales[0].seccionMaxMm2 = 1001;
	assert.deepEqual(validarDefinicionComponente(sinTopeArbitrario), []);
});

test('el asistente rechaza perfiles eléctricos incoherentes con errores comprensibles', () => {
	const d = definicionContactor();
	assert.equal(d.comportamiento.clase, 'contactos-electromagneticos');
	if (d.comportamiento.clase !== 'contactos-electromagneticos') return;
	d.comportamiento.bobina.retorno = 'A1';
	d.comportamiento.polos[0].entrada = 'A1';
	d.terminales[2].id = 'A1';
	const errores = validarDefinicionComponente(d);
	assert.ok(errores.some((e) => /repetido/i.test(e)), errores.join(' | '));
	assert.ok(errores.some((e) => /mismo borne/i.test(e)), errores.join(' | '));
	assert.ok(errores.some((e) => /bobina y contacto\/polo/i.test(e)), errores.join(' | '));
});

test('las sugerencias IEC nunca convierten GND, 0V o COM en PE', () => {
	const terminales = [
		{ id: 'GND', tipo: 'control' as const },
		{ id: '0V', tipo: 'control' as const },
		{ id: 'COM', tipo: 'senal' as const },
		{ id: 'PE', tipo: 'PE' as const },
	];
	const antes = structuredClone(terminales);
	const sugerencias = sugerirRolesIEC(terminales);
	assert.deepEqual(terminales, antes, 'sugerir no debe mutar ni confirmar roles');
	for (const id of ['GND', '0V', 'COM']) {
		assert.equal(sugerencias.find((s) => s.terminalId === id)?.rol, 'comun');
	}
	assert.equal(sugerencias.find((s) => s.terminalId === 'PE')?.rol, 'proteccion');
});

test('colocar una definición toma un snapshot estable del perfil y los terminales', () => {
	const d = definicionContactor();
	const colocado = instanciarComponentePersonalizado(d, 'k-colocado', {
		imagenResuelta: 'data:image/png;base64,AQID',
	});
	d.terminales[0].id = 'CAMBIADO';
	assert.equal(d.comportamiento.clase, 'contactos-electromagneticos');
	if (d.comportamiento.clase === 'contactos-electromagneticos') d.comportamiento.bobina.entrada = 'CAMBIADO';
	assert.equal(colocado.bornes[0].id, 'A1');
	assert.equal(colocado.comportamiento?.clase, 'contactos-electromagneticos');
	assert.equal(colocado.comportamiento?.clase === 'contactos-electromagneticos'
		? colocado.comportamiento.bobina.entrada : '', 'A1');
	assert.deepEqual(colocado.componentePersonalizado, { definicionId: 'cmp-k1', revision: 1 });
	assert.match(colocado.assetId, /^sha256:/);
	assert.equal(colocado.profundidad, 75, 'la envolvente física conserva el fondo declarado');
});

test('una imagen con perfil es aparato; una imagen legacy sin perfil sigue siendo referencia inerte', () => {
	const personalizado = instanciarComponentePersonalizado(definicionContactor(), 'k-img');
	assert.equal(esReferenciaVisualInerte(personalizado), false);
	assert.equal(esReferenciaVisualInerte({
		id: 'foto', tipo: 'otro', bornes: [], imagen: 'data:image/png;base64,AQID', campo: true,
	}), true);

	const proyecto = crearProyecto('Apariencia no es semántica');
	proyecto.gabinete = {
		ancho: 400, alto: 500, rieles: [], canaletas: [],
		colocaciones: [{ dispositivoId: personalizado.id, x: 10, y: 10, ancho: 45, alto: 85 }],
	};
	proyecto.dispositivos = [personalizado];
	assert.equal(generarFichaTablero(proyecto).aparatos.total, 1,
		'un aparato importado no puede desaparecer de la ficha por tener asset de imagen');
});

test('editar la biblioteca crea una revisión nueva sin alterar la definición anterior', () => {
	const original = definicionContactor();
	const editada = actualizarDefinicionComponente(original, { nombre: 'Contactor revisado' },
		'2026-08-23T11:00:00.000Z');
	assert.equal(original.revision, 1);
	assert.equal(original.nombre, 'Contactor de imagen');
	assert.equal(editada.revision, 2);
	assert.equal(editada.nombre, 'Contactor revisado');
});

test('el paquete portátil conserva proyecto, perfil, procedencia y asset requerido', () => {
	const definicion = definicionContactor();
	const colocado = instanciarComponentePersonalizado(definicion, 'k-colocado');
	const proyecto = crearProyecto('Portátil');
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja 1' }];
	proyecto.gabinete = {
		ancho: 400, alto: 500, rieles: [], canaletas: [],
		colocaciones: [{ dispositivoId: colocado.id, x: 20, y: 30, ancho: 45, alto: 85 }],
	};
	proyecto.dispositivos = [colocado];
	const asset = { id: definicion.assetId, mime: 'image/png' as const, base64: 'AQID' };
	const paquete = crearPaqueteProyecto(proyecto, [asset], [definicion]);
	const releido = leerPaqueteProyecto(JSON.stringify(paquete));
	const recuperado = releido.proyecto.dispositivos[0];
	assert.equal(recuperado.assetId, definicion.assetId);
	assert.deepEqual(recuperado.componentePersonalizado, { definicionId: definicion.id, revision: 1 });
	assert.equal(recuperado.comportamiento?.clase, 'contactos-electromagneticos');
	assert.equal(releido.assets[0].base64, 'AQID');
	assert.throws(() => crearPaqueteProyecto(proyecto, [], [definicion]), /Falta el asset/);
	assert.throws(() => crearPaqueteProyecto(proyecto, [asset], []), /no contiene la revisión 1/);
	const revisionFalsa = actualizarDefinicionComponente(definicion, { nombre: 'Otra revisión' });
	assert.throws(() => crearPaqueteProyecto(proyecto, [asset], [revisionFalsa]), /no contiene la revisión 1/);
	const corrupto = structuredClone(paquete);
	corrupto.componentes[0].revision = 2;
	assert.throws(() => leerPaqueteProyecto(JSON.stringify(corrupto)), /no contiene la revisión 1/);
	const malformado = structuredClone(paquete);
	(malformado.componentes as unknown[])[0] = null;
	assert.throws(() => leerPaqueteProyecto(JSON.stringify(malformado)), /Definición 1.*inválida/);
	const limitesInvalidos = structuredClone(paquete);
	limitesInvalidos.componentes[0].terminales[0].maxConductores = 0;
	assert.throws(() => leerPaqueteProyecto(JSON.stringify(limitesInvalidos)), /máximo de conductores/);
});

test('el codec V1 informa que un proyecto con dos revisiones custom requiere V2', () => {
	const r1 = definicionContactor();
	const r2 = actualizarDefinicionComponente(r1, { nombre: 'r2' });
	const proyecto = crearProyecto('Dos revisiones');
	proyecto.hojas = [{ id: 'h1', numero: 1, titulo: 'Hoja' }];
	proyecto.gabinete = { ancho: 400, alto: 500, rieles: [], canaletas: [], colocaciones: [
		{ dispositivoId: 'k1', x: 10, y: 10, ancho: 45, alto: 85 },
		{ dispositivoId: 'k2', x: 80, y: 10, ancho: 45, alto: 85 },
	] };
	proyecto.dispositivos = [instanciarComponentePersonalizado(r1, 'k1'), instanciarComponentePersonalizado(r2, 'k2')];
	assert.throws(() => crearPaqueteProyecto(proyecto,
		[{ id: r1.assetId, mime: 'image/png', base64: 'AQID' }], [r1, r2]),
	/V1.*revisiones.*formato V2/);
	const paquete = crearPaqueteProyecto(proyecto,
		[{ id: r1.assetId, mime: 'image/png', base64: 'AQID' }], [r2, r1], 2);
	assert.equal(paquete.version, 2);
	assert.deepEqual(leerPaqueteProyecto(JSON.stringify(paquete)).componentes, [r2, r1]);
	const incompleto = structuredClone(paquete);
	incompleto.componentes = [r2];
	assert.throws(() => leerPaqueteProyecto(JSON.stringify(incompleto)), /no contiene la revisión 1/);
	const duplicado = structuredClone(paquete);
	duplicado.componentes.push(r1);
	assert.throws(() => leerPaqueteProyecto(JSON.stringify(duplicado)), /Componente repetido/);
	const sobrante = structuredClone(paquete);
	sobrante.componentes.push({ ...r2, revision: 3 });
	assert.throws(() => leerPaqueteProyecto(JSON.stringify(sobrante)), /no utilizada/);
	const assetSobrante = structuredClone(paquete);
	assetSobrante.assets.push({ id: `sha256:${'b'.repeat(64)}`, mime: 'image/png', base64: 'AQID' });
	assert.throws(() => leerPaqueteProyecto(JSON.stringify(assetSobrante)), /asset no utilizado/);
});
