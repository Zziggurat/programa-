import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import type { Dispositivo, Proyecto } from '../src/modelo/tipos.js';
import { proyectarBomCanonica } from '../src/motores/bom.js';
import { bomACSV, generarBOM } from '../src/motores/documentacion.js';
import { bomIngenieriaACsv, generarBomIngenieria } from '../src/ingenieria/documentacion.js';

const equipo = (id: string, cambios: Partial<Dispositivo> = {}): Dispositivo => ({
	id, tipo: 'disyuntor', designacion: `-${id}`, descripcion: 'Protección', bornes: [],
	...cambios,
});
const proyecto = (...dispositivos: Dispositivo[]): Proyecto => {
	const p = crearProyecto('BOM canónica');
	p.dispositivos = dispositivos;
	return p;
};
const cantidades = (p: Proyecto) => [
	proyectarBomCanonica(p).map((x) => x.cantidad),
	generarBOM(p).map((x) => x.cantidad),
	generarBomIngenieria(p).map((x) => x.cantidad),
];

test('DOC-02: la misma descripción sin identidad de compra no fusiona instancias', () => {
	const p = proyecto(equipo('q1'), equipo('q2'));
	assert.deepEqual(cantidades(p), [[1, 1], [1, 1], [1, 1]]);
	assert.deepEqual(generarBOM(p).flatMap((x) => x.designaciones), ['-q1', '-q2']);
});

test('DOC-02: referencia comercial completa agrupa, pero tipo, perfil y calibre declarado separan variantes', () => {
	const base = { fabricante: 'Fabricante', referencia: 'M-16' };
	const p = proyecto(
		equipo('q1', { ...base, corrienteNominal: 16, comportamiento: {
			version: 1, clase: 'proteccion', polos: [], contactos: [], rearmable: true,
		} }),
		equipo('q2', { ...base, corrienteNominal: 16, comportamiento: {
			version: 1, clase: 'proteccion', polos: [], contactos: [], rearmable: true,
		} }),
		equipo('q3', { ...base, corrienteNominal: 20, comportamiento: {
			version: 1, clase: 'proteccion', polos: [], contactos: [], rearmable: true,
		} }),
		equipo('q4', { ...base, corrienteNominal: 16, comportamiento: {
			version: 1, clase: 'pasivo', conexiones: [],
		} }),
		equipo('q5', { ...base, tipo: 'fusible', corrienteNominal: 16 }),
	);
	assert.deepEqual(cantidades(p).map((filas) => [...filas].sort()), [[1, 1, 1, 2], [1, 1, 1, 2], [1, 1, 1, 2]]);
	assert.equal(generarBomIngenieria(p).find((x) => x.designaciones.includes('-q1'))?.cantidad, 2);
});

test('DOC-02: variante física compara valores nominales, no solo nombres de campos', () => {
	const base = { fabricante: 'F', referencia: 'Q-16' };
	const p = proyecto(
		equipo('q1', { ...base, fisica: { version: 1, proteccion: { inA: 16 } } }),
		equipo('q2', { ...base, fisica: { version: 1, proteccion: { inA: 20 } } }),
		equipo('q3', { ...base, fisica: { version: 1, proteccion: { inA: 16 } } }),
	);
	assert.deepEqual(cantidades(p).map((filas) => [...filas].sort()), [[1, 2], [1, 2], [1, 2]]);
	assert.deepEqual(generarBomIngenieria(p).find((x) => x.designaciones.includes('-q1'))?.modeloFisico, ['proteccion']);
});

test('DOC-02: dos perfiles de protección funcionalmente incompatibles no comparten partida', () => {
	const base = { tipo: 'otro' as const, fabricante: 'F', referencia: 'SERIE',
		bornes: [], descripcion: 'Protección' };
	const p = proyecto(
		equipo('p1', { ...base, comportamiento: { version: 1, clase: 'proteccion',
			polos: [], contactos: [], rearmable: true, funcion: 'termomagnetico' } }),
		equipo('p2', { ...base, comportamiento: { version: 1, clase: 'proteccion',
			polos: [], contactos: [], rearmable: false, funcion: 'fusible' } }),
	);
	assert.deepEqual(cantidades(p), [[1, 1], [1, 1], [1, 1]]);
});

test('DOC-02: revisiones propias y productos técnicos congelados son identidad persistente', () => {
	const p = proyecto(
		equipo('propio1', { tipo: 'otro', componentePersonalizado: { definicionId: 'cmp', revision: 1 },
			assetId: 'sha256:imagen-a', imagen: 'data:image/png;base64,AA==' }),
		equipo('propio2', { tipo: 'otro', componentePersonalizado: { definicionId: 'cmp', revision: 1 },
			assetId: 'sha256:imagen-b', imagen: 'data:image/png;base64,BB==' }),
		equipo('propio3', { tipo: 'otro', componentePersonalizado: { definicionId: 'cmp', revision: 2 } }),
		equipo('tecnico1'), equipo('tecnico2'), equipo('tecnico3'),
	);
	p.datosTecnicos = { version: 1, revisiones: [], instalaciones: [], vinculos: [
		...['tecnico1', 'tecnico2', 'tecnico3'].map((id, indice) => ({
			entidad: 'DEVICE' as const, entidadId: id, condiciones: {}, decisiones: {},
			producto: { tipo: 'PRODUCTO' as const, catalogoId: 'cat', id: 'Q', revision: indice === 2 ? 2 : 1,
				hash: indice === 2 ? 'hash-b' : 'hash-a' },
		})),
	] };
	const filas = proyectarBomCanonica(p);
	assert.deepEqual(filas.map((x) => x.cantidad).sort(), [1, 1, 2, 2]);
	assert.equal(filas.find((x) => x.designaciones.includes('-propio1'))?.cantidad, 2);
	assert.equal(filas.find((x) => x.designaciones.includes('-tecnico1'))?.cantidad, 2);
	assert.ok(filas.every((x) => !/base64|sha256:imagen/.test(x.clave)), 'foto/asset no son identidad BOM');
	assert.deepEqual(cantidades(p).map((filas) => [...filas].sort()), [[1, 1, 2, 2], [1, 1, 2, 2], [1, 1, 2, 2]]);
	const inverso = structuredClone(p);
	inverso.dispositivos.reverse();
	inverso.datosTecnicos!.vinculos.reverse();
	assert.deepEqual(proyectarBomCanonica(p), proyectarBomCanonica(inverso),
		'orden de dispositivos y vínculos no puede cambiar grupos ni filas');
	const reabierto = JSON.parse(JSON.stringify(p)) as Proyecto;
	assert.deepEqual(proyectarBomCanonica(reabierto), filas,
		'la identidad y las revisiones sobreviven guardar y cargar');
});

test('DOC-02: claves estructuradas evitan colisiones por separador y dependen solo del Proyecto', () => {
	const p = proyecto(
		equipo('q1', { fabricante: 'A|B', referencia: 'C', descripcion: 'D' }),
		equipo('q2', { fabricante: 'A', referencia: 'B|C', descripcion: 'D' }),
	);
	p.esquema = { representaciones: [
		{ id: 'polo', dispositivoId: 'q1', hojaId: 'h1', posicion: { columna: 1, fila: 1 }, parte: { tipo: 'completa' } },
		{ id: 'aux', dispositivoId: 'q1', hojaId: 'h1', posicion: { columna: 2, fila: 1 }, parte: { tipo: 'completa' } },
	] };
	assert.deepEqual(cantidades(p), [[1, 1], [1, 1], [1, 1]]);
	const a = proyectarBomCanonica(p);
	const b = proyectarBomCanonica({ ...p, dispositivos: [...p.dispositivos].reverse(),
		esquema: { representaciones: [...p.esquema.representaciones!].reverse() } });
	assert.deepEqual(a, b, 'el orden de instancias y vistas no altera el BOM');
	assert.deepEqual(generarBOM(p), generarBOM({ ...p, dispositivos: [...p.dispositivos].reverse() }));
	assert.deepEqual(generarBomIngenieria(p), generarBomIngenieria({ ...p, dispositivos: [...p.dispositivos].reverse() }));
});

test('DOC-02: una configuración de circuito no divide un mismo artículo con placa idéntica', () => {
	const base = { fabricante: 'F', referencia: 'PS-24' };
	const p = proyecto(
		equipo('p1', { ...base, tipo: 'fuente', fisica: { version: 1, fuente: { sistema: 'DC',
			tensionNominalV: 24, referencia: '0V', fases: [{ borne: '+', fase: 'POSITIVO' }], rOhm: 0.1 } } }),
		equipo('p2', { ...base, tipo: 'fuente', fisica: { version: 1, fuente: { sistema: 'DC',
			tensionNominalV: 24, referencia: 'GND', fases: [{ borne: 'L+', fase: 'POSITIVO' }], rOhm: 0.2 } } }),
	);
	assert.deepEqual(cantidades(p), [[2], [2], [2]]);
});

test('DOC-02: las filas separadas del mismo SKU explican sus nominales en ambos BOM', () => {
	const base = { fabricante: 'F', referencia: 'Q-16' };
	const p = proyecto(
		equipo('q1', { ...base, corrienteNominal: 16, fisica: { version: 1, proteccion: { inA: 16 } } }),
		equipo('q2', { ...base, corrienteNominal: 20, fisica: { version: 1, proteccion: { inA: 20 } } }),
	);
	const canonica = proyectarBomCanonica(p);
	assert.equal(canonica.length, 2);
	assert.match(canonica.find((f) => f.designaciones.includes('-q1'))!.varianteDeclarada,
		/Corriente nominal: 16 A.*In protección: 16 A/);
	assert.match(canonica.find((f) => f.designaciones.includes('-q2'))!.varianteDeclarada,
		/Corriente nominal: 20 A.*In protección: 20 A/);
	assert.match(bomACSV(generarBOM(p)), /Variante declarada.*Corriente nominal: 16 A/s);
	assert.match(bomIngenieriaACsv(generarBomIngenieria(p)), /Variante declarada.*Corriente nominal: 20 A/s);
	assert.deepEqual(proyectarBomCanonica({ ...p, dispositivos: [...p.dispositivos].reverse() }), canonica);
	assert.deepEqual(proyectarBomCanonica(JSON.parse(JSON.stringify(p)) as Proyecto), canonica);
});
