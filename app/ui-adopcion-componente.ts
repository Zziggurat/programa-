/** Confirmación visible y reversible de la adopción de una revisión de biblioteca.
 * Preparar solo calcula un candidato; ni cambiar un selector ni cerrar esta ventana edita el tablero.
 */
import type { Proyecto } from '../src/modelo/tipos.js';
import {
	prepararAdopcionRevisionComponente, type PreparacionAdopcionComponente,
} from '../src/componentes/adopcion.js';
import type { DefinicionComponentePersonalizado } from '../src/componentes/personalizados.js';
import { abrirVentana, cerrarVentana } from './ventanas.js';

const ID = 'modal-adopcion-componente';

export interface ContextoAdopcionComponente {
	proyecto: Proyecto;
	dispositivoId: string;
	nueva: DefinicionComponentePersonalizado;
	/** Revalida la sesión y confirma el candidato como UNA mutación con historial. */
	aplicar(preparacion: PreparacionAdopcionComponente, sigueAbierta: () => boolean): Promise<void>;
}

const celda = (texto: string): HTMLTableCellElement => {
	const n = document.createElement('td');
	n.textContent = texto;
	return n;
};

export function abrirAdopcionComponente(ctx: ContextoAdopcionComponente): void {
	if (document.getElementById(ID)) return;
	const anterior = ctx.proyecto.dispositivos.find((d) => d.id === ctx.dispositivoId);
	if (!anterior?.componentePersonalizado) throw new Error('La instancia ya no pertenece a la biblioteca personal.');
	const raiz = document.createElement('div');
	raiz.id = ID;
	raiz.hidden = true;
	raiz.innerHTML = `<section class="adopcion-caja">
		<header><div><h2>Revisar nueva revisión</h2><p data-adopcion="titulo"></p></div>
			<button type="button" class="boton" data-adopcion="cerrar" aria-label="Cerrar sin cambiar el tablero">✕</button></header>
		<div class="adopcion-contenido">
			<p>Esta instancia mantiene su fotografía actual hasta que confirmes. Indica adónde va <strong>cada borne anterior</strong>; un ID coincidente es solo una propuesta visible, no una adopción automática. «Capacidad no declarada» no significa que admita cualquier número de cables: compruébala con la ficha del fabricante.</p>
			<div class="adopcion-tabla"><table><thead><tr><th scope="col">Borne anterior</th><th scope="col">Conexiones</th><th scope="col">Borne en la nueva revisión</th></tr></thead><tbody data-adopcion="mapa"></tbody></table></div>
			<h3>Impacto de la adopción</h3><div data-adopcion="impacto" role="status" aria-live="polite"></div>
			<p class="adopcion-error" data-adopcion="error" role="alert" hidden></p>
		</div>
		<footer><button type="button" class="boton" data-adopcion="cancelar">Cancelar</button>
			<button type="button" class="boton primario" data-adopcion="confirmar" disabled>Confirmar adopción</button></footer>
	</section>`;
	document.body.appendChild(raiz);
	const tomar = <T extends HTMLElement>(clave: string): T => raiz.querySelector<T>(`[data-adopcion="${clave}"]`)!;
	const titulo = tomar<HTMLElement>('titulo');
	titulo.textContent = `${anterior.designacion ?? anterior.id} · ${ctx.nueva.nombre} · r${anterior.componentePersonalizado.revision} → r${ctx.nueva.revision}`;
	const tabla = tomar<HTMLTableSectionElement>('mapa');
	const impacto = tomar<HTMLElement>('impacto');
	const error = tomar<HTMLElement>('error');
	const confirmar = tomar<HTMLButtonElement>('confirmar');
	const selects = new Map<string, HTMLSelectElement>();
	let activa = true;
	let ocupada = false;
	let preparada: PreparacionAdopcionComponente | undefined;
	const contarConexiones = (id: string): number => ctx.proyecto.conductores.reduce((n, c) => n
		+ Number(c.de.dispositivoId === anterior.id && c.de.borneId === id)
		+ Number(c.a.dispositivoId === anterior.id && c.a.borneId === id), 0);
	for (const borne of anterior.bornes) {
		const fila = document.createElement('tr');
		fila.append(celda(`${borne.id} · ${borne.tipo ?? 'sin tipo'}`), celda(String(contarConexiones(borne.id))));
		const seleccion = document.createElement('select');
		seleccion.setAttribute('aria-label', `Nuevo borne para ${borne.id}`);
		const vacia = document.createElement('option');
		vacia.value = '';
		vacia.textContent = '— sin correspondencia —';
		seleccion.appendChild(vacia);
		for (const destino of ctx.nueva.terminales) {
			const opcion = document.createElement('option');
			opcion.value = destino.id;
			opcion.textContent = `${destino.id} · ${destino.tipo ?? 'sin tipo'} · ${destino.maxConductores === undefined
				? 'capacidad no declarada' : `máx. ${destino.maxConductores} conductor(es)`}`;
			seleccion.appendChild(opcion);
		}
		// La coincidencia conserva el valor preseleccionado, pero se muestra y valida como cualquier mapeo.
		seleccion.value = ctx.nueva.terminales.some((x) => x.id === borne.id) ? borne.id : '';
		selects.set(borne.id, seleccion);
		const destinoCelda = document.createElement('td');
		destinoCelda.appendChild(seleccion);
		fila.appendChild(destinoCelda);
		tabla.appendChild(fila);
	}
	const mapear = (): Record<string, string> => {
		const mapa: Record<string, string> = Object.create(null) as Record<string, string>;
		for (const [origen, select] of selects) if (select.value) mapa[origen] = select.value;
		return mapa;
	};
	const linea = (texto: string): HTMLLIElement => {
		const li = document.createElement('li'); li.textContent = texto; return li;
	};
	const pintar = (): void => {
		preparada = undefined;
		confirmar.disabled = true;
		error.hidden = true;
		impacto.replaceChildren();
		try {
			const resultado = prepararAdopcionRevisionComponente(ctx.proyecto, ctx.dispositivoId, ctx.nueva, mapear());
			preparada = resultado;
			const i = resultado.impacto;
			const lista = document.createElement('ul');
			lista.append(
				linea(`${i.conductoresAfectados.length} conductor(es) afectados: ${i.conductoresAfectados.join(', ') || 'ninguno'}.`),
				linea(`Bornes: ${i.puertosAfectados.map((p) => {
					const limite = ctx.nueva.terminales.find((b) => b.id === p.nuevo)?.maxConductores;
					return `${p.anterior} → ${p.nuevo} (${p.conexiones} cable(s); ${limite === undefined
						? 'capacidad no declarada' : `máx. ${limite}`})`;
				}).join('; ') || 'sin conexiones'}.`),
				linea(`Retirados: ${i.puertosRetirados.join(', ') || 'ninguno'} · nuevos: ${i.puertosAnadidos.join(', ') || 'ninguno'}.`),
				linea(`Perfil eléctrico: ${i.cambiaPerfil || i.cambiaTipo ? 'cambia; revisar simulación y esquema' : 'se conserva'}.`),
				linea(`Imagen: ${i.cambiaImagen ? 'cambia' : 'se conserva'} · envolvente: ${i.cambiaEnvolvente ? 'cambia; revisar hueco físico' : 'se conserva'}.`),
				linea(`Datos técnicos: ${i.requiereRevisionTecnica ? 'requieren revisión' : 'sin cambio detectado'} · rutas/cables: ${i.requiereRevisionDeRuta ? 'requieren revisión visual' : 'sin cambio detectado'}.`),
			);
			impacto.appendChild(lista);
			confirmar.disabled = ocupada;
		} catch (e) {
			const aviso = document.createElement('p');
			aviso.textContent = `No se puede adoptar todavía: ${(e as Error).message}`;
			impacto.appendChild(aviso);
		}
	};
	for (const select of selects.values()) select.onchange = pintar;
	const cerrar = (): void => cerrarVentana(ID);
	tomar<HTMLButtonElement>('cerrar').onclick = cerrar;
	tomar<HTMLButtonElement>('cancelar').onclick = cerrar;
	confirmar.onclick = async () => {
		if (ocupada || !preparada) return;
		ocupada = true;
		confirmar.disabled = true;
		for (const select of selects.values()) select.disabled = true;
		try {
			await ctx.aplicar(preparada, () => activa);
			if (activa) cerrar();
		} catch (e) {
			if (!activa) return;
			error.textContent = `No se aplicó ningún cambio: ${(e as Error).message}`;
			error.hidden = false;
		} finally {
			ocupada = false;
			if (activa) {
				for (const select of selects.values()) select.disabled = false;
				confirmar.disabled = !preparada;
			}
		}
	};
	abrirVentana(ID, { titulo: 'Revisar nueva revisión de componente', alCerrar: () => {
		activa = false;
		raiz.remove();
	} });
	pintar();
}
