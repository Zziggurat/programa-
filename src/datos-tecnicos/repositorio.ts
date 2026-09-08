import type { BackendPersistencia } from '../persistencia/tipos.js';
import { DatosTecnicosInvalidos, LIMITES_TECNICOS, validarRevisionTecnica } from './schema.js';
import { congelarSubconjunto, indexarRevisiones, verificarRevision } from './hash.js';
import { claveRevision, referenciaTecnica, type ReferenciaTecnica, type RevisionHumanaTecnica, type RevisionProductoTecnico, type RevisionTecnica } from './tipos.js';

type RegistroTecnico = { clave: string; tipo: 'REVISION'; revision: RevisionTecnica } | { clave: string; tipo: 'BORRADOR'; borrador: RevisionProductoTecnico } | { clave: string; tipo: 'REVISION_HUMANA'; evidencia: RevisionHumanaTecnica };
const abortar = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('Operación cancelada; no se adoptaron datos.', 'AbortError'); };
/** Biblioteca global independiente. Un proyecto SIEMPRE resuelve su subconjunto congelado. */
export class RepositorioDatosTecnicos {
	constructor(private readonly backend: BackendPersistencia) {}
	async listar(): Promise<RevisionTecnica[]> {
		return this.backend.transaccion(['technicalData'], 'readonly', async tx => (await tx.listar<RegistroTecnico>('technicalData')).flatMap(x => x.tipo === 'REVISION' ? [x.revision] : []));
	}
	async obtener(ref: ReferenciaTecnica): Promise<RevisionTecnica | undefined> {
		const r = await this.backend.transaccion(['technicalData'], 'readonly', tx => tx.obtener<RegistroTecnico>('technicalData', claveRevision(ref)));
		return r?.tipo === 'REVISION' && r.revision.hash === ref.hash ? r.revision : undefined;
	}
	async importar(revisiones: RevisionTecnica[], opciones: { signal?: AbortSignal; progreso?: (n: number, total: number) => void } = {}): Promise<{ nuevas: number; existentes: number }> {
		if (!Array.isArray(revisiones) || revisiones.length > LIMITES_TECNICOS.revisiones) throw new DatosTecnicosInvalidos('Demasiadas revisiones en una importación.');
		// Canonicalización FUERA de IDB; ceder al event loop permite cancelar imports grandes.
		const rs = structuredClone(revisiones);
		for (let i = 0; i < rs.length; i++) {
			abortar(opciones.signal); verificarRevision(rs[i]);
			if ((i + 1) % 100 === 0) { opciones.progreso?.(i + 1, rs.length); await new Promise<void>(resolve => setTimeout(resolve, 0)); }
		}
		indexarRevisiones(rs, false);
		congelarSubconjunto(rs.map(referenciaTecnica), rs); abortar(opciones.signal);
		return this.backend.transaccion(['technicalData'], 'readwrite', async tx => {
			let nuevas = 0, existentes = 0;
			for (const r of rs) {
				abortar(opciones.signal); const clave = claveRevision(referenciaTecnica(r)); const previo = await tx.obtener<RegistroTecnico>('technicalData', clave);
				if (previo) { if (previo.tipo !== 'REVISION' || previo.revision.hash !== r.hash) throw new DatosTecnicosInvalidos(`CONFLICT: revisión inmutable ${r.nombre} r${r.revision}.`); verificarRevision(previo.revision); existentes++; }
				else { await tx.guardar<RegistroTecnico>('technicalData', clave, { clave, tipo: 'REVISION', revision: r }); nuevas++; }
			}
			abortar(opciones.signal); return { nuevas, existentes };
		});
	}
	async guardarBorrador(borrador: RevisionProductoTecnico): Promise<void> {
		validarRevisionTecnica({ ...borrador, hash: `sha256:${'0'.repeat(64)}` });
		const clave = JSON.stringify(['borrador', borrador.catalogo.id, borrador.id]);
		await this.backend.transaccion(['technicalData'], 'readwrite', tx => tx.guardar<RegistroTecnico>('technicalData', clave, { clave, tipo: 'BORRADOR', borrador: structuredClone(borrador) }));
	}
	async listarBorradores(): Promise<RevisionProductoTecnico[]> {
		return this.backend.transaccion(['technicalData'], 'readonly', async tx => (await tx.listar<RegistroTecnico>('technicalData')).flatMap(x => x.tipo === 'BORRADOR' ? [x.borrador] : []));
	}
	async eliminarCatalogo(catalogoId: string): Promise<void> {
		await this.backend.transaccion(['technicalData'], 'readwrite', async tx => {
			for (const r of await tx.listar<RegistroTecnico>('technicalData')) if ((r.tipo === 'REVISION' && r.revision.catalogo.id === catalogoId) || (r.tipo === 'BORRADOR' && r.borrador.catalogo.id === catalogoId)) await tx.eliminar('technicalData', r.clave);
		});
	}
	/** Solo gesto explícito local; esta evidencia jamás se importa desde un paquete. */
	async registrarRevisionHumana(e: RevisionHumanaTecnica): Promise<void> {
		if (!/^sha256:[a-f0-9]{64}$/.test(e.hash) || !e.responsable.trim() || !e.evidencia.trim() || !['REVISADO', 'RECHAZADO'].includes(e.estado) || !Number.isFinite(Date.parse(e.fecha))) throw new DatosTecnicosInvalidos('Evidencia humana incompleta.');
		const clave = `humana:${e.hash}`;
		await this.backend.transaccion(['technicalData'], 'readwrite', tx => tx.guardar<RegistroTecnico>('technicalData', clave, { clave, tipo: 'REVISION_HUMANA', evidencia: structuredClone(e) }));
	}
	async revisionHumana(hash: string): Promise<RevisionHumanaTecnica | undefined> {
		const r = await this.backend.transaccion(['technicalData'], 'readonly', tx => tx.obtener<RegistroTecnico>('technicalData', `humana:${hash}`));
		return r?.tipo === 'REVISION_HUMANA' ? r.evidencia : undefined;
	}
}
