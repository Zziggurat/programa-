import type { Borne } from './tipos.js';

/** Presentación únicamente: ninguna referencia eléctrica debe usar este texto como identidad. */
export function rotuloVisibleBorne(borne: Pick<Borne, 'id' | 'rotulo'>): string {
	return borne.rotulo?.trim() || borne.id;
}
