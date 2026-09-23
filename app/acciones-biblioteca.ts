/** Captura rechazos de almacenamiento sin afirmar que una operación quizá confirmada fue revertida. */
export async function ejecutarAccionBiblioteca(
	accion: () => Promise<void>, alError: (error: unknown) => void,
): Promise<boolean> {
	try { await accion(); return true; }
	catch (error) { alError(error); return false; }
}
