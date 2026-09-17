/** Recorrido V9 compacto sobre el HTML file://, sin window.qa ni hooks de mutación. */
import { readFileSync } from 'node:fs';
import { copiarEjemploConfirmado } from './confirmacion-visible.mjs';

export async function comprobarDisenoAsistidoOffline(page,must,buildId){
	await page.locator('#btn-aprender').click();await page.locator('#btn-ejemplos').click();await page.locator('#modal-ejemplos').waitFor({state:'visible'});
	await page.locator('.tarjeta-ejemplo',{hasText:'Diseño asistido V9'}).first().getByRole('button',{name:/Abrir y estudiar/i}).click();
	if(await page.locator('#modal-dialogo').isVisible().catch(()=>false))await page.locator('#dialogo-ok').click();
	await page.waitForFunction(()=>document.getElementById('nombre-proyecto')?.value?.includes('Diseño asistido V9'));
	if(await page.locator('#modal-explicacion').isVisible().catch(()=>false))await page.locator('#btn-cerrar-explicacion').click();
	await copiarEjemploConfirmado(page,async()=>{await page.locator('#btn-copiar-ejemplo').click();await page.locator('#chip-ejemplo').waitFor({state:'hidden'});},60_000);
	await page.locator('#hta-ingenieria').click();await page.locator('#ingenieria-validar').click();await page.locator('[data-ing-view="diseno"]').click();
	await page.locator('[data-ing-design-sections]').fill('3, 4, 6');await page.locator('[data-ing-design-run]').click();
	await page.waitForFunction(()=>document.querySelectorAll('[data-ing-design-result]').length===9,null,{timeout:90_000});
	const panel=await page.locator('[data-ing-design]').innerText();must('V9 offline explora BASE/sección/protección/combinados con cobertura explícita',/BASE/.test(panel)&&/SECCION/.test(panel)&&/PROTECCION/.test(panel)&&/COMBINADO/.test(panel)&&/EXHAUSTIVA/.test(panel));
	const aplicables=page.locator('.ing-resultado-diseno',{hasText:'COMBINADO'}).locator('[data-ing-design-apply]:not([disabled])');must('V9 offline encuentra una combinación factible sin red',await aplicables.count()>0);
	const descarga=page.waitForEvent('download');await page.locator('[data-ing-design-export="json"]').click({noWaitAfter:true});const archivo=await descarga,info=JSON.parse(readFileSync(await archivo.path(),'utf8'));
	must('V9 offline exporta evidencia con Build ID y revisiones fijadas',info.formato==='tablerostudio-diseno-asistido'&&info.contexto?.buildId===buildId&&info.snapshot.revisiones.length>=1);
	await aplicables.first().click();await page.locator('#modal-dialogo').waitFor({state:'visible'});await page.locator('#dialogo-ok').click();await page.locator('#ingenieria-estado').filter({hasText:'Plan V9 aplicado'}).waitFor({timeout:60_000});
	const guardado=page.waitForEvent('download');await page.locator('#btn-archivo').click();await page.locator('#btn-guardar').click({noWaitAfter:true});const proyecto=JSON.parse(readFileSync(await (await guardado).path(),'utf8'));
	must('V9 offline aplica y guarda una única decisión tipada',proyecto.ingenieria?.disenoAsistido?.decisiones?.length===1&&proyecto.ingenieria.disenoAsistido.decisiones[0].cambios.some(x=>x.tipo==='SECCION')&&proyecto.ingenieria.disenoAsistido.decisiones[0].cambios.some(x=>x.tipo==='PROTECCION'));
}
