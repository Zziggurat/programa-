/** Gate I/J: BASE/A/B, deltas, aplicación explícita y persistencia de ScenarioEngine V7. */
import { chromium } from 'playwright-core';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const inicio=Date.now(); let servidor,browser,page; let fallos=0,comprobaciones=0; const erroresJS=[];
const debugLog=join(process.cwd(),'debug.log'), debugLogExistia=existsSync(debugLog), chromeLogAnterior=process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE=process.platform==='win32'?'NUL':'/dev/null';
function comprobar(n,c,d=''){comprobaciones++;if(!c)fallos++;console.log(`${c?'OK  ':'FAIL'}  ${n}${d?` → ${d}`:''}`)}
async function click(id){const b=page.locator(`#${id}`);await b.waitFor({state:'visible'});await b.click()}
async function abrirEjemplo(){
	if(await page.locator('#inicio').isVisible().catch(()=>false))await click('inicio-ejemplos');else{await click('btn-aprender');await click('btn-ejemplos')}
	await page.locator('#modal-ejemplos').waitFor({state:'visible'});await page.locator('.tarjeta-ejemplo',{hasText:'Fixture V5: caída de tensión'}).first().getByRole('button',{name:/Abrir y estudiar/i}).click();
	await Promise.race([page.locator('#modal-dialogo').waitFor({state:'visible',timeout:1200}).catch(()=>false),page.waitForFunction(()=>window.qa.proyecto().nombre==='Fixture V5 — caída de tensión',null,{timeout:1200}).catch(()=>false)]);
	if(await page.locator('#modal-dialogo').isVisible().catch(()=>false))await click('dialogo-ok');
	await page.waitForFunction(()=>window.qa.proyecto().nombre==='Fixture V5 — caída de tensión',null,{timeout:30000});
	if(await page.locator('#modal-explicacion').isVisible().catch(()=>false))await click('btn-cerrar-explicacion');
	await trabajarSobreCopia(page);
}
try{
	const e=await servidorDeQA();servidor=e.servidor;browser=await abrirNavegador(chromium);page=await browser.newPage({viewport:{width:1440,height:960}});
	page.on('pageerror',x=>erroresJS.push(x.message));page.on('console',m=>{if(m.type()==='error')erroresJS.push(`console: ${m.text()}`)});
	await page.goto(`${e.url}/?qa=1`,{waitUntil:'domcontentloaded'});await esperarEditorListo(page);await abrirEjemplo();
	await click('hta-ingenieria');await click('ingenieria-validar');await page.locator('[data-ing-view="escenarios"]').click();
	const base=await page.evaluate(()=>({seccion:window.qa.proyecto().conductores.find(c=>c.id==='w-fase-carga').seccion,inA:window.qa.proyecto().dispositivos.find(d=>d.id==='q1').fisica.proteccion.inA}));
	await page.locator('[data-ing-scenario-conductor]').selectOption('w-fase-carga');await page.locator('[data-ing-scenario-section]').fill('4');await page.locator('[data-ing-scenario-run]').click();
	await page.locator('[data-ing-scenario-result="A"]').waitFor({state:'visible'});
	comprobar('A compara sección 2.5 → 4 y publica deltas',/BASE vs.*4 mm².*BASE NO MODIFICADA.*Deltas de conductores.*w-fase-carga/s.test(await page.locator('[data-ing-scenario-result="A"]').innerText()));
	comprobar('comparar A no muta BASE',await page.evaluate(()=>window.qa.proyecto().conductores.find(c=>c.id==='w-fase-carga').seccion)===base.seccion);

	await page.locator('[data-ing-scenario-slot]').selectOption('B');await page.locator('[data-ing-scenario-type]').selectOption('PROTECCION');
	await page.locator('[data-ing-scenario-protection]').selectOption('q1');await page.locator('[data-ing-scenario-in]').fill('20');await page.locator('[data-ing-scenario-curve]').fill('B');await page.locator('[data-ing-scenario-run]').click();
	comprobar('BASE/A/B se muestran como dos overlays independientes',await page.locator('[data-ing-scenario-result]').count()===2);
	comprobar('comparar B tampoco muta calibre/perfil BASE',await page.evaluate(()=>window.qa.proyecto().dispositivos.find(d=>d.id==='q1').fisica.proteccion.inA)===base.inA);
	const textoB=await page.locator('[data-ing-scenario-result="B"]').innerText();
	comprobar('B expone deltas de protección/selectividad/issues',/Deltas de protecciones.*q1/s.test(textoB)&&/Selectividad nueva/.test(textoB)&&/Issues nuevos/.test(textoB),textoB);

	await page.locator('[data-ing-scenario-apply="A"]').click();await page.locator('#modal-dialogo').waitFor({state:'visible'});
	comprobar('Aplicar requiere confirmación explícita',/Aplicar.*al proyecto.*modifica BASE/i.test(await page.locator('#dialogo-msg').innerText()));await click('dialogo-ok');
	await page.waitForFunction(()=>window.qa.proyecto().conductores.find(c=>c.id==='w-fase-carga').seccion===4,null,{timeout:15000});
	await page.evaluate(()=>window.qa.esperarPersistencia());
	comprobar('aplicar A modifica únicamente la alternativa confirmada',await page.evaluate(()=>window.qa.proyecto().conductores.find(c=>c.id==='w-fase-carga').seccion===4&&window.qa.proyecto().dispositivos.find(d=>d.id==='q1').fisica.proteccion.inA===16));
	await page.reload({waitUntil:'domcontentloaded'});await esperarEditorListo(page);
	comprobar('el escenario aplicado persiste al recargar',await page.evaluate(()=>window.qa.proyecto().conductores.find(c=>c.id==='w-fase-carga').seccion)===4);
	comprobar('no hubo errores JavaScript',erroresJS.length===0,erroresJS.slice(0,4).join(' | '));
}catch(error){fallos++;console.error(`ERROR NO CONTROLADO: ${error?.stack??error}`)}finally{
	try{await page?.close()}catch(e){fallos++;console.error(e)}try{await browser?.close()}catch(e){fallos++;console.error(e)}
	if(servidor)try{servidor.closeAllConnections?.();await new Promise((ok,no)=>servidor.close(e=>e?no(e):ok()))}catch(e){fallos++;console.error(e)}
	if(!debugLogExistia&&existsSync(debugLog))try{unlinkSync(debugLog)}catch(e){fallos++;console.error(e)}
	if(chromeLogAnterior===undefined)delete process.env.CHROME_LOG_FILE;else process.env.CHROME_LOG_FILE=chromeLogAnterior;
}
console.log(`\n=== ${fallos?`${fallos} FALLO(S) ✗`:'TODO OK ✔'} · ${comprobaciones} comprobaciones · ${((Date.now()-inicio)/1000).toFixed(1)} s ===`);process.exitCode=fallos?1:0;
