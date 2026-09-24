import { inflateSync } from 'node:zlib';

/** Extrae los operadores de texto Tj/TJ emitidos por jsPDF, sin proceso Python externo. */
export function textoPdf(bytes) {
	const partes = [];
	for (const match of bytes.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
		const raw = Buffer.from(match[1], 'latin1');
		try { partes.push(inflateSync(raw).toString('latin1')); }
		catch { partes.push(raw.toString('latin1')); }
	}
	return Array.from(partes.join('\n').matchAll(/\(((?:[^()\\]|\\.)*)\)\s*T[jJ]/g),
		(m) => m[1].replaceAll('\\(', '(').replaceAll('\\)', ')')).join(' ');
}
