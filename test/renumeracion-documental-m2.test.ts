import assert from 'node:assert/strict';
import test from 'node:test';
import { crearProyecto } from '../src/modelo/proyecto.js';
import { aplicarRenumeracionEsquema, previsualizarRenumeracionEsquema } from '../src/motores/renumeracion-esquema.js';

// Los exportadores de PDF/paquete comparten utilidades de UI. Solo se simula el DOM mínimo;
// los documentos se generan con jsPDF y los motores reales, no con mocks de resultados.
Object.assign(globalThis, {
	document: { documentElement: {}, querySelectorAll: () => [],
		createElement: () => ({ style: {}, click(): void {}, remove(): void {} }),
		body: { appendChild(): void {} } },
	getComputedStyle: () => ({ getPropertyValue: () => '' }),
	MutationObserver: class { observe(): void {} },
});
const { crearArchivosPaqueteDocumental } = await import('../app/paquete-documental.js');
const { dossierComoBlob } = await import('../app/pdf.js');

const procedencia = { estado: 'confirmado' as const, projectId: 'renumeracion-m2',
	revisionRepositorio: 3, buildId: 'BUILD-QA', generadoEn: '2026-09-24T12:00:00.000Z' };

function proyectoDePrueba() {
	const p = crearProyecto('Renumeración documental M2');
	p.gabinete = { ancho: 400, alto: 600, rieles: [], canaletas: [], colocaciones: [] };
	p.hojas = [{ id: 'potencia', numero: 1, titulo: 'Potencia' },
		{ id: 'mando', numero: 2, titulo: 'Mando' }];
	const bornes = ['1/L1', '2/T1', 'A1', 'A2', '13', '14'].map((id) => ({ id }));
	p.dispositivos = [
		{ id: 'kmA', tipo: 'contactor', numero: 77, designacion: '-K77', rol: { tipo: 'maestro' },
			bornes, comportamiento: { version: 1, clase: 'contactos-electromagneticos',
				bobina: { entrada: 'A1', retorno: 'A2' },
				polos: [{ entrada: '1/L1', salida: '2/T1' }],
				contactos: [{ entrada: '13', salida: '14', reposo: 'abierto', funcion: 'auxiliar' }],
			} },
		{ id: 'kmB', tipo: 'contactor', numero: 99, designacion: '-K2', congelado: true, bornes },
	];
	p.conductores = [{ id: 'w1', de: { dispositivoId: 'kmA', borneId: 'A1' },
		a: { dispositivoId: 'kmB', borneId: 'A1' }, estadoRutaFisica: 'pendiente' }];
	p.esquema = { representaciones: [
		{ id: 'kmA-polos', dispositivoId: 'kmA', hojaId: 'potencia',
			posicion: { columna: 1, fila: 2 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '1/L1', salida: '2/T1' },
			] } },
		{ id: 'kmB-vista', dispositivoId: 'kmB', hojaId: 'potencia',
			posicion: { columna: 3, fila: 2 }, parte: { tipo: 'completa' } },
		{ id: 'kmA-bobina', dispositivoId: 'kmA', hojaId: 'mando',
			posicion: { columna: 2, fila: 4 }, parte: { tipo: 'bobina' } },
		{ id: 'kmA-aux', dispositivoId: 'kmA', hojaId: 'mando',
			posicion: { columna: 5, fila: 2 }, parte: { tipo: 'contactos', pares: [
				{ entrada: '13', salida: '14' },
			] } },
	] };
	return p;
}

test('ESQ-08/DOC: dossier y paquete respetan marcado persistido, nunca la numeración legacy de exportación', async () => {
	const p = proyectoDePrueba();
	const antesDeAplicar = JSON.stringify(p);
	const archivosSinAplicar = await crearArchivosPaqueteDocumental(p, procedencia);
	const aparatosSinAplicar = String(archivosSinAplicar.find((a) => a.ruta === 'listas/aparatos.csv')?.contenido ?? '');
	// El apóstrofo es protección CSV deliberada contra fórmulas de hoja de cálculo.
	assert.match(aparatosSinAplicar, /kmA;'-K77;/, 'exportar antes de confirmar no renumera a escondidas');
	assert.match(aparatosSinAplicar, /kmB;'-K2;/, 'el congelado conserva su texto real');
	assert.doesNotMatch(aparatosSinAplicar, /-K100/, 'numero=99 obsoleto no fuerza -K100');
	assert.equal(JSON.stringify(p), antesDeAplicar, 'exportar antes de aplicar no muta el proyecto');

	const plan = previsualizarRenumeracionEsquema(p);
	assert.deepEqual(plan.conflictos, []);
	assert.equal(plan.cambios, 1);
	assert.equal(plan.filas.find((f) => f.dispositivoId === 'kmA')?.designacionPropuesta, '-K1');
	assert.equal(JSON.stringify(p), antesDeAplicar, 'previsualizar no muta');
	aplicarRenumeracionEsquema(p, plan);
	assert.equal(p.dispositivos.find((d) => d.id === 'kmA')?.designacion, '-K1');
	assert.deepEqual(p.dispositivos.find((d) => d.id === 'kmB') && {
		designacion: p.dispositivos.find((d) => d.id === 'kmB')!.designacion,
		numero: p.dispositivos.find((d) => d.id === 'kmB')!.numero,
	}, { designacion: '-K2', numero: 99 });
	const aplicado = JSON.stringify(p);

	const blobPdf = dossierComoBlob(p, procedencia);
	const dossier = Buffer.from(await blobPdf.arrayBuffer()).toString('latin1');
	assert.match(dossier, /^%PDF-/, 'dossier PDF real');
	assert.match(dossier, /\(-K1\) Tj/, 'el PDF dibuja -K1 como texto, no solo metadato');
	assert.match(dossier, /\(-K2\) Tj/, 'el PDF conserva el congelado -K2');
	assert.doesNotMatch(dossier, /\(-K100\) Tj/, 'el dossier no vuelve a la secuencia legacy');
	assert.equal(JSON.stringify(p), aplicado, 'construir el PDF no muta el proyecto');

	const archivos = await crearArchivosPaqueteDocumental(p, procedencia);
	assert.equal(JSON.stringify(p), aplicado, 'ensamblar el paquete no muta el proyecto');
	const texto = (ruta: string) => {
		const a = archivos.find((x) => x.ruta === ruta);
		assert.ok(a && typeof a.contenido === 'string', `falta texto ${ruta}`);
		return a.contenido;
	};
	for (const ruta of ['esquema/hoja-001.svg', 'esquema/hoja-002.svg',
		'dossier/dossier.html', 'ingenieria/informe.json', 'ingenieria/bom.csv',
		'listas/aparatos.csv', 'listas/marcadores.csv', 'listas/referencias-cruzadas.csv']) {
		assert.match(texto(ruta), /-K1/, `${ruta}: falta designación aprobada`);
		assert.doesNotMatch(texto(ruta), /-K100/, `${ruta}: renumeración legacy oculta`);
	}
	assert.match(texto('listas/aparatos.csv'), /kmA;'-K1;/);
	assert.match(texto('listas/aparatos.csv'), /kmB;'-K2;/);
	assert.match(texto('listas/referencias-cruzadas.csv'), /kmA;'-K1;/,
		'la referencia del maestro utiliza su designación persistida');
	const informe = JSON.parse(texto('ingenieria/informe.json')) as {
		bom: { designaciones: string[] }[];
	};
	assert.ok(informe.bom.some((b) => b.designaciones.includes('-K1')));
	assert.ok(informe.bom.some((b) => b.designaciones.includes('-K2')));
	const pdfEnPaquete = archivos.find((a) => a.ruta === 'dossier/dossier.pdf')?.contenido;
	assert.ok(pdfEnPaquete instanceof Uint8Array, 'el paquete contiene el dossier PDF real');
	const textoPdfEnPaquete = Buffer.from(pdfEnPaquete).toString('latin1');
	assert.match(textoPdfEnPaquete, /\(-K1\) Tj/);
	assert.match(textoPdfEnPaquete, /\(-K2\) Tj/);
	assert.doesNotMatch(textoPdfEnPaquete, /\(-K100\) Tj/);
});
