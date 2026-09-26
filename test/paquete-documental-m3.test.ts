import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { tableroEjemplo } from '../ejemplo/tablero-ejemplo.js';
import { EJEMPLOS } from '../ejemplo/biblioteca.js';
import { asignarPlanesAutomaticos, prepararAsignacionPlanesAutomaticos } from '../app/escena3d.js';
import { longitudPlanRutaAutomaticaMm } from '../src/modelo/plan-ruta-automatica.js';

Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});

const { crearArchivosPaqueteDocumental } = await import('../app/paquete-documental.js');

const procedencia = { estado: 'confirmado' as const, projectId: 'doc-123',
	revisionRepositorio: 8, buildId: 'BUILD-QA', generadoEn: '2026-09-24T12:00:00.000Z' };

test('DOC-09: DRC sin hallazgos no se anuncia como certificación o aprobación del tablero', async () => {
	const avisosMaquetacion: string[] = [];
	const logOriginal = console.log;
	let archivos: Awaited<ReturnType<typeof crearArchivosPaqueteDocumental>>;
	try {
		console.log = (...partes: unknown[]) => { avisosMaquetacion.push(partes.join(' ')); };
		archivos = await crearArchivosPaqueteDocumental(tableroEjemplo(), procedencia);
	} finally {
		console.log = logOriginal;
	}
	assert.deepEqual(avisosMaquetacion.filter((a) => /width could not fit page/i.test(a)), []);
	const pdf = archivos.find((a) => a.ruta === 'dossier/dossier.pdf')?.contenido;
	assert.ok(pdf instanceof Uint8Array);
	const textoPdf = Buffer.from(pdf).toString('latin1');
	assert.match(textoPdf, /Sin hallazgos en las reglas implementadas/);
	assert.doesNotMatch(textoPdf, /pasa todas las reglas|listo para fabricar|certificado|Nada queda supuesto/i);
});

test('DOC-09: un borrador con fallo eléctrico conserva y muestra el error sin bloquear la emisión', async () => {
	const proyecto = tableroEjemplo();
	const fuente = proyecto.dispositivos[0];
	const borne = fuente.bornes[0];
	borne.obligatorio = true;
	proyecto.conductores = proyecto.conductores.filter((c) =>
		!(c.de.dispositivoId === fuente.id && c.de.borneId === borne.id)
		&& !(c.a.dispositivoId === fuente.id && c.a.borneId === borne.id));
	const archivos = await crearArchivosPaqueteDocumental(proyecto, procedencia);
	const indice = String(archivos.find((a) => a.ruta === 'index.html')?.contenido ?? '');
	const informe = String(archivos.find((a) => a.ruta === 'dossier/dossier.html')?.contenido ?? '');
	const pdf = archivos.find((a) => a.ruta === 'dossier/dossier.pdf')?.contenido;
	assert.ok(pdf instanceof Uint8Array);
	assert.match(indice, /Borrador técnico para revisión profesional/);
	assert.match(indice, /DRC: [1-9]\d* errores/);
	assert.match(informe, /R2-borne-sin-conectar/);
	assert.match(Buffer.from(pdf).toString('latin1'), /R2-borne-sin-conectar/);
});

test('DOC-09: incluso con los campos listados completos no se afirma que todo el proyecto esté verificado', async () => {
	const proyecto = tableroEjemplo();
	proyecto.datos = { ...proyecto.datos, cliente: 'Cliente', obra: 'Obra',
		proyectista: 'Proyectista', fabricante: 'Fabricante' };
	proyecto.opciones = { ...proyecto.opciones, iccPresuntaKA: 6, corrienteAsignadaA: 32,
		gradoIP: 'IP54', regimenNeutro: 'TN-S', usoPrevisto: 'interior',
		temperaturaAmbienteC: 35, montajeGabinete: 'mural', frecuenciaHz: 50 };
	const archivos = await crearArchivosPaqueteDocumental(proyecto, procedencia);
	const pdf = archivos.find((a) => a.ruta === 'dossier/dossier.pdf')?.contenido;
	assert.ok(pdf instanceof Uint8Array);
	const texto = Buffer.from(pdf).toString('latin1');
	assert.match(texto, /Sin faltantes entre los datos revisados aquí/);
	assert.doesNotMatch(texto, /Nada queda supuesto|todos los datos necesarios|aprobado para fabricar/i);
});

test('DOC-02 compone un único snapshot sin duplicar un aparato multivista ni una conexión interhoja', async () => {
	const p = crearProyecto('<img src=x onerror=alert(1)> & Revisión');
	p.hojas = [{ id: 'h1', numero: 1, titulo: 'Mando' }, { id: 'h2', numero: 2, titulo: 'Potencia' }];
	p.dispositivos = [
		{ id: 'km', tipo: 'contactor', designacion: '-KM1', descripcion: '=HYPERLINK("evil")',
			bornes: [{ id: 'A1', tipo: 'control' }, { id: 'A2', tipo: 'control' }] },
		{ id: 'x', tipo: 'bornero', designacion: '-X1', bornes: [{ id: '1', tipo: 'control' }] },
	];
	p.conductores = [{ id: 'w1', de: { dispositivoId: 'km', borneId: 'A1' },
		a: { dispositivoId: 'x', borneId: '1' }, estadoRutaFisica: 'pendiente' }];
	p.esquema = { representaciones: [
		{ id: 'km-mando', dispositivoId: 'km', hojaId: 'h1', posicion: { columna: 2, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'km-potencia', dispositivoId: 'km', hojaId: 'h2', posicion: { columna: 2, fila: 3 }, parte: { tipo: 'completa' } },
		{ id: 'x', dispositivoId: 'x', hojaId: 'h2', posicion: { columna: 5, fila: 3 }, parte: { tipo: 'completa' } },
	] };
	const antes = JSON.stringify(p);
	const archivos = await crearArchivosPaqueteDocumental(p, procedencia);
	assert.equal(JSON.stringify(p), antes, 'la numeración y los informes no mutan el documento vivo');
	assert.equal(new Set(archivos.map((a) => a.ruta)).size, archivos.length);
	for (const ruta of ['index.html', 'esquema/hoja-001.svg', 'esquema/hoja-002.svg',
		'esquema/esquema.pdf', 'dossier/dossier.pdf', 'dossier/dossier.html',
		'ingenieria/informe.json', 'ingenieria/bom.csv', 'listas/aparatos.csv',
		'listas/conexiones.csv', 'listas/conductores.csv', 'listas/longitudes-conductores.csv', 'listas/borneros.csv',
		'listas/referencias-cruzadas.csv', 'listas/senales-io.csv', 'listas/marcadores.csv']) {
		assert.ok(archivos.some((a) => a.ruta === ruta), `falta ${ruta}`);
	}
	const texto = (ruta: string) => String(archivos.find((a) => a.ruta === ruta)?.contenido ?? '');
	const index = texto('index.html');
	assert.match(index, /Project ID<\/dt><dd>doc-123/);
	assert.match(index, /Revisión del repositorio<\/dt><dd>8/);
	assert.match(index, /BUILD-QA/);
	assert.match(index, /Borrador técnico/);
	assert.match(index, /1 conexiones con ruta física pendiente/);
	assert.doesNotMatch(index, /<img src=x/);
	assert.match(index, /&lt;img src=x/);
	assert.doesNotMatch(index, /<script\b|https?:\/\//i);
	const bom = texto('ingenieria/bom.csv');
	const informe = JSON.parse(texto('ingenieria/informe.json')) as {
		bom: { tipo: string; cantidad: number; designaciones: string[] }[];
	};
	const contactor = informe.bom.find((fila) => fila.tipo === 'contactor');
	assert.ok(contactor);
	assert.equal(contactor.cantidad, 1, 'dos vistas comparten un solo aparato BOM');
	assert.equal(contactor.designaciones.length, 1);
	assert.equal(bom.split(contactor.designaciones[0]).length - 1, 1);
	assert.match(bom, /'=HYPERLINK/);
	const conexiones = texto('listas/conexiones.csv');
	assert.equal((conexiones.match(/w1/g) ?? []).length, 1, 'el enlace interhoja no duplica conductor');
	assert.match(conexiones, /PENDIENTE/);
	const longitudes = texto('listas/longitudes-conductores.csv');
	const columnasLongitud = longitudes.split('\n')[0].split(';');
	const columnaLongitud = (nombre: string): number => columnasLongitud.indexOf(nombre);
	const filaPendiente = longitudes.split('\n').find((fila) => fila.startsWith('w1;'))?.split(';');
	assert.ok(filaPendiente, 'la conexión eléctrica pendiente permanece listada');
	assert.equal(filaPendiente[1], 'PENDIENTE');
	assert.equal(filaPendiente[columnaLongitud('Ruta 2D estimada (mm)')], '', 'sin ruta 2D inventada');
	assert.equal(filaPendiente[columnaLongitud('Referencia XYZ persistente (mm)')], '',
		'sin referencia física inventada');
	assert.equal(filaPendiente[columnaLongitud('Propuesta de corte estimada (mm)')], '',
		'sin propuesta de corte');
	assert.equal(filaPendiente[columnaLongitud('Corte verificado (mm)')], '', 'sin corte verificado');
	assert.match(longitudes, /Propuesta de corte estimada \(mm\)/);
	const marcadores = texto('listas/marcadores.csv');
	assert.match(marcadores, /Borne ID;Ubicación borne;Identificador/);
	assert.match(marcadores, /;APARATO;A1;/,
		'el CSV distingue terminal de aparato de bornera sin derivarlo de la imagen');
	assert.match(marcadores, /;BORNERA;1;/);
	assert.match(marcadores, /Campo principal;Texto principal;Campo secundario;Texto secundario;Cantidad/);
	assert.equal((marcadores.match(/extremo-conductor;w1;/g) ?? []).length, 2,
		'el paquete lleva una etiqueta por cada extremo real del conductor');
	assert.match(texto('ingenieria/informe.json'), /"projectId": "doc-123"/);
	assert.match(texto('esquema/hoja-001.svg'), /doc-123/);
	assert.match(Buffer.from(archivos.find((a) => a.ruta === 'esquema/esquema.pdf')!.contenido as Uint8Array)
		.toString('latin1'), /Project ID doc-123/);
});

test('CAB-26: el paquete muestra la medida XYZ V4 y deja vacío el corte legacy ajeno', async () => {
	const p = EJEMPLOS.find((e) => /arranque directo/i.test(e.titulo))!.crear();
	p.esEjemplo = false;
	p.version = 4;
	assert.equal(asignarPlanesAutomaticos(p, prepararAsignacionPlanesAutomaticos(p,
		new Set(['w4']))), 1);
	const plan = p.conductores.find((c) => c.id === 'w4')!.planRutaAutomatica!;
	const antes = JSON.stringify(p);
	const archivos = await crearArchivosPaqueteDocumental(p, procedencia);
	assert.equal(JSON.stringify(p), antes, 'emitir documentos no reescribe el plan XYZ');
	const csv = String(archivos.find((a) => a.ruta === 'listas/longitudes-conductores.csv')?.contenido ?? '');
	const cabecera = csv.split('\n')[0].split(';');
	const col = (nombre: string) => cabecera.indexOf(nombre);
	const fila = csv.split('\n').find((linea) => linea.startsWith('w4;'))?.split(';');
	assert.ok(fila);
	assert.equal(fila[1], 'RUTA_3D_REFERENCIA');
	assert.equal(Number(fila[col('Referencia XYZ persistente (mm)')]), longitudPlanRutaAutomaticaMm(plan));
	assert.equal(fila[col('Origen referencia XYZ')], 'PLAN_AUTOMATICO_V4');
	assert.equal(fila[col('Ruta 2D estimada (mm)')], '');
	assert.equal(fila[col('Propuesta de corte estimada (mm)')], '');
	const html = String(archivos.find((a) => a.ruta === 'dossier/dossier.html')?.contenido ?? '');
	assert.match(html, /PLAN_AUTOMATICO_V4/);
	assert.match(html, /Un plan XYZ no recibe una propuesta de corte 2D ajena/);
	const conductores = String(archivos.find((a) => a.ruta === 'listas/conductores.csv')?.contenido ?? '');
	assert.match(conductores.split('\n').find((linea) => linea.startsWith('w4;')) ?? '',
		/PLAN_AUTO_XYZ_REFERENCIA/);
	const adoptado = structuredClone(p);
	adoptado.conductores.find((c) => c.id === 'w4')!.fisica = {
		longitudManualM: 3.2, politicaLongitudElectrica: 'RUTA_XYZ',
	};
	const archivosAdoptados = await crearArchivosPaqueteDocumental(adoptado, procedencia);
	const csvAdoptado = String(archivosAdoptados.find((a) => a.ruta === 'listas/longitudes-conductores.csv')?.contenido ?? '');
	const filaAdoptada = csvAdoptado.split('\n').find((linea) => linea.startsWith('w4;'))?.split(';');
	assert.ok(filaAdoptada);
	assert.equal(filaAdoptada[col('Política eléctrica')], 'RUTA_XYZ');
	assert.equal(Number(filaAdoptada[col('Longitud eléctrica adoptada (m)')]),
		longitudPlanRutaAutomaticaMm(plan) / 1000);
	assert.equal(filaAdoptada[col('Origen longitud eléctrica')], 'ESTIMADO');
	assert.equal(filaAdoptada[col('Propuesta de corte estimada (mm)')], '',
		'adoptar la referencia como cálculo eléctrico no acredita un corte de taller');
	if (process.env.QA_PDF_CAPTURE) {
		const contenido = archivosAdoptados.find((a) => a.ruta === 'dossier/dossier.pdf')?.contenido;
		assert.ok(contenido instanceof Uint8Array);
		writeFileSync(process.env.QA_PDF_CAPTURE, contenido);
	}
});
