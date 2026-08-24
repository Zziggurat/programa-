/** UI de biblioteca documental. No conoce IndexedDB, el renderer ni el proyecto global. */
import type { GestorDocumentos } from './gestor-documentos.js';
import type { RecuperacionLegacy } from '../src/persistencia/tipos.js';
import { avisar, confirmar, descargar, escaparHtml, pedirTexto } from './dialogos.js';
import { abrirVentana, cerrarVentana } from './ventanas.js';

export interface ContextoUIProyectos {
	gestor: GestorDocumentos;
	crearProyecto: () => import('../src/modelo/tipos.js').Proyecto;
	abrirEjemplos: () => void;
	importarArchivo: (archivo: File) => Promise<void>;
	exportarActivo: () => Promise<void>;
	listarRecuperaciones: () => Promise<RecuperacionLegacy[]>;
}

export interface PanelProyectos {
	abrir(): Promise<void>;
	refrescar(): Promise<void>;
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const fecha = (iso: string): string => new Intl.DateTimeFormat(undefined, {
	dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(iso));

export function instalarUIProyectos(ctx: ContextoUIProyectos): PanelProyectos {
	const lista = $('lista-mis-tableros');
	const recuperacion = $('lista-recuperacion');
	const recuperacionLegacy = $('lista-recuperacion-legacy');
	const archivo = $('archivo-importar-biblioteca') as HTMLInputElement;
	let pintando = 0;

	async function pintar(): Promise<void> {
		const turno = ++pintando;
		const activo = ctx.gestor.documentoActivo();
		const esperandoRecuperacion = ctx.gestor.estaEsperandoRecuperacion();
		const documentos = await ctx.gestor.listar();
		if (turno !== pintando) return;
		lista.innerHTML = documentos.length ? '' : '<p class="vacio-biblioteca">Todavía no hay tableros guardados.</p>';
		for (const d of documentos) {
			const tarjeta = document.createElement('article');
			tarjeta.className = `tarjeta-documento${d.id === activo?.id ? ' activo' : ''}`;
			tarjeta.dataset.documentoId = d.id;
			tarjeta.innerHTML = `<div class="documento-info"><h3>${escaparHtml(d.nombre)}</h3>`
				+ `<p>Modificado ${escaparHtml(fecha(d.modificadoEn))} · revisión ${d.revision}</p>`
				+ `${esperandoRecuperacion && d.id === activo?.id
					? '<strong>⚠ El contenido actual está dañado; restaura una versión antes de continuar</strong>'
					: d.estado === 'requiere-revision' ? '<strong>⚠ Requiere revisar una migración reparada</strong>' : ''}</div>`
				+ '<div class="acciones-documento"></div>';
			const acciones = tarjeta.querySelector('.acciones-documento')!;
			const boton = (texto: string, titulo: string, accion: () => Promise<void>) => {
				const b = document.createElement('button'); b.className = 'boton'; b.textContent = texto; b.title = titulo;
				b.onclick = async () => { b.disabled = true; try { await accion(); } finally { b.disabled = false; } };
				if (esperandoRecuperacion) b.disabled = true;
				acciones.appendChild(b); return b;
			};
			const abrir = boton(d.id === activo?.id && !ctx.gestor.estaMostrandoEjemplo() ? 'Abierto' : 'Abrir',
				'Abrir este tablero sin perder el actual', async () => {
					await ctx.gestor.abrir(d.id); cerrarVentana('modal-tableros');
					avisar(`Tablero «${d.nombre}» abierto`, 'ok');
				});
			abrir.classList.add('primario');
			abrir.disabled = esperandoRecuperacion
				|| d.id === activo?.id && !ctx.gestor.estaMostrandoEjemplo();
			boton('Renombrar', 'Cambiar el nombre sin cambiar la identidad', async () => {
				const nombre = await pedirTexto('Nuevo nombre del tablero', d.nombre);
				if (!nombre) return; await ctx.gestor.renombrar(d.id, nombre); await pintar();
			});
			boton('Duplicar', 'Crear una copia independiente', async () => {
				await ctx.gestor.duplicar(d.id); await pintar(); avisar('Copia independiente creada', 'ok');
			});
			if (d.estado === 'requiere-revision') {
				boton('Aceptar reparación', 'Confirmar la revisión saneada; el original permanece en Recuperación', async () => {
					if (!await confirmar(
						`¿Aceptar la revisión reparada de «${d.nombre}»? El archivo original seguirá disponible en Recuperación.`,
						{ ok: 'Aceptar reparación' },
					)) return;
					await ctx.gestor.aceptarReparacion(d.id);
					await pintar();
					avisar('Reparación aceptada. El original permanece en Recuperación.', 'ok');
				});
			}
			const borrar = boton('Eliminar', 'Eliminar este tablero y sus snapshots', async () => {
				if (!await confirmar(`¿Eliminar «${d.nombre}»? Esta acción no se puede deshacer.`, {
					ok: 'Eliminar', peligro: true,
				})) return;
				await ctx.gestor.eliminar(d.id); await pintar(); avisar('Tablero eliminado', 'info');
			});
			borrar.classList.add('peligro');
			lista.appendChild(tarjeta);
		}

		recuperacion.innerHTML = esperandoRecuperacion
			? '<p class="error-biblioteca">El proyecto activo no se puede leer. Elige una versión válida para recuperarlo; el registro dañado no se modificará hasta que confirmes.</p>'
			: '';
		const snapshots = activo && !ctx.gestor.estaMostrandoEjemplo()
			? await ctx.gestor.listarSnapshots()
			: [];
		if (turno !== pintando) return;
		for (const s of snapshots.slice(0, 8)) {
			const fila = document.createElement('div'); fila.className = 'fila-snapshot';
			fila.innerHTML = `<span>${escaparHtml(fecha(s.creadoEn))} · r${s.revisionOrigen}</span>`;
			const b = document.createElement('button'); b.className = 'boton'; b.textContent = 'Restaurar';
			b.onclick = async () => {
				if (!await confirmar('¿Restaurar esta versión? La versión actual se conservará como recuperación.', {
					ok: 'Restaurar', peligro: true,
				})) return;
				await ctx.gestor.restaurarSnapshot(s.id); cerrarVentana('modal-tableros');
				avisar('Versión recuperada; la anterior también quedó guardada.', 'ok');
			};
			fila.appendChild(b); recuperacion.appendChild(fila);
		}
		if (!snapshots.length) recuperacion.insertAdjacentHTML(
			'beforeend',
			'<p class="vacio-biblioteca">No hay versiones anteriores de este tablero.</p>',
		);

		const antiguas = await ctx.listarRecuperaciones();
		if (turno !== pintando) return;
		recuperacionLegacy.innerHTML = antiguas.length ? '' : '<p class="vacio-biblioteca">No hay copias antiguas ni datos en cuarentena.</p>';
		for (const r of antiguas) {
			const fila = document.createElement('div'); fila.className = 'fila-snapshot';
			fila.innerHTML = `<span>${escaparHtml(fecha(r.creadoEn))}${r.motivo ? ` · ${escaparHtml(r.motivo)}` : ''}</span>`;
			const b = document.createElement('button'); b.className = 'boton'; b.textContent = 'Descargar original';
			b.onclick = () => descargar(`recuperacion-${r.creadoEn}.json`, r.raw, 'application/json');
			fila.appendChild(b); recuperacionLegacy.appendChild(fila);
		}
	}

	async function abrir(): Promise<void> {
		abrirVentana('modal-tableros');
		lista.innerHTML = '<p class="vacio-biblioteca">Cargando tableros…</p>';
		try { await pintar(); } catch (e) {
			lista.innerHTML = `<p class="error-biblioteca">No se pudo abrir la biblioteca: ${escaparHtml((e as Error).message)}</p>`;
		}
	}

	$('btn-cerrar-tableros').onclick = () => cerrarVentana('modal-tableros');
	$('modal-tableros').addEventListener('click', (e) => {
		if (e.target === $('modal-tableros')) cerrarVentana('modal-tableros');
	});
	$('btn-mis-tableros').onclick = () => { void abrir(); };
	$('inicio-mis-tableros').onclick = () => { void abrir(); };
	$('btn-nuevo-biblioteca').onclick = async () => {
		try {
			await ctx.gestor.crear(ctx.crearProyecto()); cerrarVentana('modal-tableros');
			avisar('Tablero nuevo creado y guardado con identidad propia.', 'ok');
		} catch (e) { avisar(`No se pudo crear el tablero: ${(e as Error).message}`, 'error'); }
	};
	$('btn-importar-biblioteca').onclick = () => archivo.click();
	archivo.onchange = async () => {
		const f = archivo.files?.[0]; archivo.value = ''; if (!f) return;
		try { await ctx.importarArchivo(f); cerrarVentana('modal-tableros'); avisar('Proyecto importado', 'ok'); }
		catch (e) { avisar(`No se pudo importar: ${(e as Error).message}`, 'error'); }
	};
	$('btn-exportar-biblioteca').onclick = async () => {
		try { await ctx.exportarActivo(); } catch (e) { avisar(`No se pudo exportar: ${(e as Error).message}`, 'error'); }
	};
	$('btn-ejemplos-biblioteca').onclick = () => { cerrarVentana('modal-tableros'); ctx.abrirEjemplos(); };
	$('btn-volver-tablero').onclick = async () => {
		try { await ctx.gestor.volverAMiTablero(); avisar('Volviste a tu tablero guardado.', 'ok'); }
		catch (e) { avisar(`No se pudo volver: ${(e as Error).message}`, 'error'); }
	};

	return { abrir, refrescar: pintar };
}
