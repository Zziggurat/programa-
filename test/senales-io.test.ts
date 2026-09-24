import assert from 'node:assert/strict';
import test from 'node:test';
import { generarListaSenalesIO } from '../src/ingenieria/senales-io.js';
import { cargarProyecto } from '../src/modelo/cargar.js';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Dispositivo, Proyecto } from '../src/modelo/tipos.js';

const pines = ['+24', '0V', 'DI1', 'DI2', 'DO1', 'DOC', 'AI1', 'AIC', 'AO1', 'AOC'];

function controlador(id: string, personalizado = false): Dispositivo {
	return {
		id, tipo: personalizado ? 'otro' : 'plc', designacion: `-A-${id}`,
		...(personalizado ? { imagen: 'data:image/png;base64,AQID',
			componentePersonalizado: { definicionId: 'mi-plc', revision: 1 } } : {}),
		bornes: pines.map((pin) => ({ id: pin, rotulo: pin === 'DI2' ? 'AO55' : pin })),
		comportamiento: { version: 1, clase: 'controlador',
			alimentacion: { entradas: ['+24'], retornos: ['0V'] },
			salidasDigitales: [{ borne: 'DO1', comun: 'DOC', electrica: {
				tensionV: 24, sistema: 'DC', tipoSalida: 'PNP', corrienteMaxA: 0.5 } }],
			entradasAnalogicas: [{ borne: 'AI1', comun: 'AIC', unidad: 'mA', rango: [4, 20],
				variable: { magnitud: 'presión', unidad: 'bar', minimo: 0, maximo: 10 }, modoEntrada: 'pasiva' }],
			salidasAnalogicas: [{ borne: 'AO1', referencia: 'AOC', unidad: 'V', rango: [0, 10] }],
		},
		programaPLC: { version: 1, lenguaje: 'tablerostudio-plc-v4', FUENTE: '',
			etiquetas: [{ nombre: 'PRESION_ALTA', tipo: 'BOOL', io: { clase: 'DI', borne: 'DI1' } }] },
	};
}

function proyecto(): Proyecto {
	const p = crearProyecto('Lista de E/S');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Control' }];
	p.gabinete = { ancho: 600, alto: 800, rieles: [], canaletas: [], colocaciones: [] };
	p.dispositivos = [controlador('nativo'), controlador('importado', true),
		{ id: 's1', tipo: 'sensor', bornes: [{ id: 'S', tipo: 'senal' }] },
		{ id: 'x1', tipo: 'bornero', bornes: [{ id: '1' }, { id: '2' }] }];
	p.conductores = [
		{ id: 'w-z', de: { dispositivoId: 'nativo', borneId: 'DI1' }, a: { dispositivoId: 'x1', borneId: '1' } },
		{ id: 'w-a', de: { dispositivoId: 'x1', borneId: '2' }, a: { dispositivoId: 'importado', borneId: 'AI1' },
			estadoRutaFisica: 'pendiente' },
		{ id: 'w-b', de: { dispositivoId: 'nativo', borneId: 'DO1' }, a: { dispositivoId: 's1', borneId: 'S' } },
	];
	return p;
}

test('DOC-02: nativo e importado con mismo perfil producen DI/DO/AI/AO por borne físico', () => {
	const resultado = generarListaSenalesIO(proyecto());
	assert.deepEqual(resultado.diagnosticos, []);
	for (const id of ['nativo', 'importado']) {
		const filas = resultado.filas.filter((x) => x.dispositivoId === id);
		assert.deepEqual(filas.map(({ borneId, clase }) => [borneId, clase]), [
			['DI1', 'DI'], ['DI2', 'DI'], ['DO1', 'DO'], ['AI1', 'AI'], ['AO1', 'AO'],
		]);
		assert.equal(filas.find((x) => x.borneId === 'DI2')?.rotulo, 'AO55');
		assert.equal(filas.find((x) => x.borneId === 'DI2')?.clase, 'DI', 'el rótulo no clasifica E/S');
		assert.equal(filas.find((x) => x.borneId === 'DO1')?.calidad, 'DECLARADA');
		assert.equal(filas.find((x) => x.borneId === 'AI1')?.unidad, 'mA');
		assert.equal(filas.find((x) => x.borneId === 'AO1')?.rango?.[1], 10);
		assert.equal(filas.find((x) => x.borneId === 'DI2')?.calidad, 'NO_VERIFICADA');
	}
	assert.equal(resultado.filas.find((x) => x.dispositivoId === 'nativo' && x.borneId === 'DI1')?.origen,
		'ETIQUETA_EXPLICITA');
	assert.equal(resultado.filas.find((x) => x.dispositivoId === 'nativo' && x.borneId === 'DI2')?.origen,
		'DI_INFERIDA');
});

test('DOC-02: bornes y conductores reales, extremos pendientes y desconectados sin rutas inventadas', () => {
	const resultado = generarListaSenalesIO(proyecto());
	const tomar = (id: string, borne: string) => resultado.filas.find((x) => x.dispositivoId === id && x.borneId === borne)!;
	assert.deepEqual(tomar('nativo', 'DI1').conexiones, [{ conductorId: 'w-z',
		otroDispositivoId: 'x1', otroBorneId: '1', extremoValido: true }]);
	assert.deepEqual(tomar('importado', 'AI1').conexiones, [{ conductorId: 'w-a',
		otroDispositivoId: 'x1', otroBorneId: '2', estadoRutaFisica: 'pendiente', extremoValido: true }]);
	assert.equal(tomar('importado', 'AI1').estadoConexion, 'CONECTADO', 'pendiente físicamente sigue unido eléctricamente');
	assert.equal(tomar('nativo', 'DI2').estadoConexion, 'SIN_CONDUCTOR');
	assert.equal(tomar('nativo', 'DI2').conexiones.length, 0);
	assert.equal(tomar('nativo', 'DO1').conexiones[0]?.otroDispositivoId, 's1');
});

test('DOC-02: múltiples vistas del esquema y orden de arrays no duplican ni alteran la lista', () => {
	const p = proyecto();
	p.esquema = { representaciones: [
		{ id: 'simbolo-2', dispositivoId: 'nativo', hojaId: 'h1', posicion: { columna: 2, fila: 1 }, parte: { tipo: 'completa' } },
		{ id: 'simbolo-1', dispositivoId: 'nativo', hojaId: 'h1', posicion: { columna: 1, fila: 1 }, parte: { tipo: 'completa' } },
	] };
	const original = generarListaSenalesIO(p);
	assert.equal(original.filas.length, 10, 'dos controladores × cinco señales, no representaciones × señales');
	const invertido = structuredClone(p);
	invertido.dispositivos.reverse(); invertido.conductores.reverse();
	for (const d of invertido.dispositivos) d.bornes.reverse();
	invertido.esquema?.representaciones?.reverse();
	assert.deepEqual(generarListaSenalesIO(invertido), original);
	assert.deepEqual(generarListaSenalesIO(cargarProyecto(JSON.stringify(p)).proyecto), original,
		'guardar/cargar conserva clase y conexión');
});

test('DOC-02: adaptador legacy identifica sus suposiciones; imagen sin perfil no atribuye E/S', () => {
	const p = crearProyecto('Legacy');
	p.dispositivos = [
		{ id: 'antiguo', tipo: 'plc', bornes: ['+24', '0V', 'DI1', 'DO1', 'AO1']
			.map((id) => ({ id, tipo: 'control' as const })) },
		{ id: 'foto', tipo: 'plc', imagen: 'data:image/png;base64,AQID', bornes: [{ id: 'DO1' }] },
	];
	const r = generarListaSenalesIO(p);
	assert.deepEqual(r.filas.map((x) => [x.borneId, x.clase, x.origen, x.calidad]), [
		['DI1', 'DI', 'DI_INFERIDA', 'NO_VERIFICADA'],
		['DO1', 'DO', 'ADAPTADOR_LEGACY', 'NO_VERIFICADA'],
		['AO1', 'AO', 'ADAPTADOR_LEGACY', 'NO_VERIFICADA'],
	]);
	assert.deepEqual(r.diagnosticos.map((x) => [x.dispositivoId, x.codigo]), [['foto', 'SIN_PERFIL_CONTROLADOR']]);
});

test('DOC-02: extremo roto y rol múltiple se exponen, nunca se convierten en señal sana', () => {
	const p = proyecto();
	p.conductores.push({ id: 'w-roto', de: { dispositivoId: 'nativo', borneId: 'DO1' },
		a: { dispositivoId: 'inexistente', borneId: 'X' } });
	const nativo = p.dispositivos.find((d) => d.id === 'nativo')!;
	if (nativo.comportamiento?.clase !== 'controlador') throw new Error('fixture incorrecto');
	nativo.comportamiento.salidasAnalogicas.push({ borne: 'DO1', referencia: 'AOC', rango: [0, 10], unidad: 'V' });
	const r = generarListaSenalesIO(p);
	const do1 = r.filas.find((x) => x.dispositivoId === 'nativo' && x.borneId === 'DO1')!;
	assert.equal(do1.clase, 'AMBIGUA');
	assert.deepEqual(do1.clasesDeclaradas, ['DO', 'AO']);
	assert.equal(do1.calidad, 'NO_VERIFICADA');
	assert.equal(do1.estadoConexion, 'EXTREMO_INVALIDO');
	assert.deepEqual(do1.conexiones.map((x) => x.conductorId), ['w-b', 'w-roto']);
	assert.deepEqual(r.diagnosticos.map((x) => x.codigo), ['ROL_AMBIGUO']);
});

test('DOC-02: perfil explícito inválido bloquea la caída a heurística legacy', () => {
	const p = proyecto();
	const plc = p.dispositivos.find((d) => d.id === 'nativo')!;
	if (plc.comportamiento?.clase !== 'controlador') throw new Error('fixture incorrecto');
	plc.comportamiento.salidasDigitales[0].borne = 'DO_INEXISTENTE';
	const r = generarListaSenalesIO(p);
	assert.equal(r.filas.some((x) => x.dispositivoId === 'nativo'), false);
	assert.deepEqual(r.diagnosticos.map((x) => [x.dispositivoId, x.codigo]), [['nativo', 'PERFIL_INVALIDO']]);
	assert.match(r.diagnosticos[0].mensaje, /DO_INEXISTENTE/);
});
