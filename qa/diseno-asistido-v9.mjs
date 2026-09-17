/** V9: flujo humano visible desde Ingeniería, aplicación y persistencia. */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { abrirNavegador, esperarEditorListo, servidorDeQA, trabajarSobreCopia } from './lib/entorno.mjs';

const inicio=Date.now();let servidor,browser,page,fallos=0,comprobaciones=0;const erroresJS=[];
const debugLog=join(process.cwd(),'debug.log'),debugLogExistia=existsSync(debugLog),chromeLogAnterior=process.env.CHROME_LOG_FILE;
const capturas=process.env.QA_V9_CAPTURAS?join(tmpdir(),'tablerostudio-v9-capturas'):undefined;if(capturas)mkdirSync(capturas,{recursive:true});
process.env.CHROME_LOG_FILE=process.platform==='win32'?'NUL':'/dev/null';
function comprobar(nombre,ok,detalle=''){comprobaciones++;if(!ok)fallos++;console.log(`${ok?'OK  ':'FAIL'}  ${nombre}${detalle?` → ${detalle}`:''}`);}
async function click(id){const x=page.locator(`#${id}`);await x.waitFor({state:'visible'});await x.click();}
async function abrirLaboratorio(){
	if(await page.locator('#inicio').isVisible().catch(()=>false))await click('inicio-ejemplos');else{await click('btn-aprender');await click('btn-ejemplos');}
	await page.locator('#modal-ejemplos').waitFor({state:'visible'});
	await page.locator('.tarjeta-ejemplo',{hasText:'Diseño asistido V9'}).first().getByRole('button',{name:/Abrir y estudiar/i}).click();
	await Promise.race([page.locator('#modal-dialogo').waitFor({state:'visible',timeout:1500}).catch(()=>false),page.waitForFunction(()=>window.qa.proyecto().nombre.includes('Diseño asistido V9'),null,{timeout:1500}).catch(()=>false)]);
	if(await page.locator('#modal-dialogo').isVisible().catch(()=>false))await click('dialogo-ok');
	await page.waitForFunction(()=>window.qa.proyecto().nombre.includes('Diseño asistido V9'),null,{timeout:30_000});
	if(await page.locator('#modal-explicacion').isVisible().catch(()=>false))await click('btn-cerrar-explicacion');
}
try{
	const e=await servidorDeQA();servidor=e.servidor;browser=await abrirNavegador(chromium);const contexto=await browser.newContext({viewport:{width:1360,height:900},acceptDownloads:true});page=await contexto.newPage();page.setDefaultTimeout(30_000);
	page.on('pageerror',x=>erroresJS.push(x.message));page.on('console',m=>{if(m.type()==='error')erroresJS.push(`console: ${m.text()}`);});
	await page.goto(`${e.url}/?qa=1`,{waitUntil:'domcontentloaded'});await esperarEditorListo(page);await abrirLaboratorio();
	await click('hta-ingenieria');await click('ingenieria-validar');await page.locator('[data-ing-view="diseno"]').click();
	comprobar('laboratorio V9 visible desde la biblioteca',/Diseño asistido V9/.test(await page.locator('[data-ing-design]').innerText()));
	comprobar('ejemplo mantiene aplicación bloqueada',await page.locator('[data-ing-design-apply]').count()===0||await page.locator('[data-ing-design-apply]').first().isDisabled().catch(()=>true));
	await trabajarSobreCopia(page);await click('hta-ingenieria');await click('ingenieria-validar');await page.locator('[data-ing-view="diseno"]').click();
	await page.locator('[data-ing-design-sections]').fill('3, 4, 6');
	const productos=await page.locator('[data-ing-design-product]').count();comprobar('revisiones exactas sintéticas disponibles',productos>=3,String(productos));
	await page.locator('[data-ing-design-run]').click();
	await page.locator('[data-ing-design-progress]').waitFor({state:'hidden',timeout:60_000}).catch(()=>{});
	await page.waitForFunction(()=>document.querySelectorAll('[data-ing-design-result]').length>=9,null,{timeout:60_000});
	const texto=await page.locator('[data-ing-design]').innerText();
	comprobar('BASE, sección, protección y combinados evaluados',/BASE/.test(texto)&&/SECCION/.test(texto)&&/PROTECCION/.test(texto)&&/COMBINADO/.test(texto));
	comprobar('sección 3 mm² y opciones no-op no generan candidatos',await page.locator('[data-ing-design-result]').count()===9,
		String(await page.locator('[data-ing-design-result]').count()));
	comprobar('cobertura explícita y completa',/EXHAUSTIVA/.test(texto)&&/evaluados/.test(texto));
	comprobar('ranking muestra frontera Pareto',/PARETO/.test(texto));
	if(capturas)await page.screenshot({path:join(capturas,'diseno-v9-ancho.png'),fullPage:true});
	const descarga=page.waitForEvent('download');await page.locator('[data-ing-design-export="json"]').click();const d=await descarga;const ruta=await d.path();const informe=JSON.parse(readFileSync(ruta,'utf8'));
	comprobar('informe portable fija snapshot y revisiones exactas',informe.formato==='tablerostudio-diseno-asistido'&&/^sha256:/.test(informe.snapshot.hash)&&informe.snapshot.revisiones.length>=1);
	if(capturas){const descargaHtml=page.waitForEvent('download');await page.locator('[data-ing-design-export="html"]').click();const dh=await descargaHtml,rh=await dh.path(),hoja=await contexto.newPage();await hoja.setContent(readFileSync(rh,'utf8'),{waitUntil:'domcontentloaded'});await hoja.screenshot({path:join(capturas,'diseno-v9-informe.png'),fullPage:true});await hoja.close();}
	const botones=page.locator('.ing-resultado-diseno',{hasText:'COMBINADO'}).locator('[data-ing-design-apply]:not([disabled])');comprobar('existe una alternativa combinada aplicable',await botones.count()>0);
	await botones.first().click();await page.locator('#modal-dialogo').waitFor({state:'visible'});
	comprobar('preview exige confirmación y enumera cambios',/Aplicar este plan V9.*Se revalidará BASE/s.test(await page.locator('#dialogo-msg').innerText()));await click('dialogo-ok');
	await page.waitForFunction(()=>window.qa.proyecto().ingenieria?.disenoAsistido?.decisiones?.length===1,null,{timeout:30_000});
	comprobar('aplicación combinada persiste intención, no resultados dinámicos',await page.evaluate(()=>{const d=window.qa.proyecto().ingenieria.disenoAsistido.decisiones[0];return d.cambios.some(x=>x.tipo==='SECCION')&&d.cambios.some(x=>x.tipo==='PROTECCION')&&!('resultado'in d)&&!('analisis'in d);}));
	await page.keyboard.press('Control+z');await page.waitForFunction(()=>(window.qa.proyecto().ingenieria?.disenoAsistido?.decisiones?.length??0)===0,null,{timeout:30_000});comprobar('aplicación combinada se deshace como una unidad',true);
	await page.keyboard.press('Control+y');await page.waitForFunction(()=>window.qa.proyecto().ingenieria?.disenoAsistido?.decisiones?.length===1,null,{timeout:30_000});comprobar('aplicación combinada se rehace como una unidad',true);
	await page.evaluate(()=>window.qa.esperarPersistencia());await page.reload({waitUntil:'domcontentloaded'});await esperarEditorListo(page);
	comprobar('decisión V9 sobrevive cierre/reapertura',await page.evaluate(()=>window.qa.proyecto().ingenieria?.disenoAsistido?.decisiones?.length===1));
	if(await page.locator('#inicio').isVisible().catch(()=>false))await click('inicio-tableros');
	await click('hta-ingenieria');await click('ingenieria-validar');await page.locator('[data-ing-view="diseno"]').click();
	await page.setViewportSize({width:760,height:700});
	const ancho=await page.locator('#panel-izq').evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth}));comprobar('panel estrecho no desborda horizontalmente',ancho.scroll<=ancho.client+2,JSON.stringify(ancho));
	if(capturas){await page.screenshot({path:join(capturas,'diseno-v9-estrecho.png'),fullPage:true});console.log(`CAPTURAS ${capturas}`);}
	comprobar('no hubo errores JavaScript',erroresJS.length===0,erroresJS.slice(0,4).join(' | '));
}catch(error){fallos++;console.error(`ERROR NO CONTROLADO: ${error?.stack??error}`);}finally{
	try{await page?.close();}catch(e){fallos++;console.error(e);}try{await browser?.close();}catch(e){fallos++;console.error(e);}
	if(servidor)try{servidor.closeAllConnections?.();await new Promise((ok,no)=>servidor.close(e=>e?no(e):ok()));}catch(e){fallos++;console.error(e);}
	if(!debugLogExistia&&existsSync(debugLog))try{unlinkSync(debugLog);}catch(e){fallos++;console.error(e);}
	if(chromeLogAnterior===undefined)delete process.env.CHROME_LOG_FILE;else process.env.CHROME_LOG_FILE=chromeLogAnterior;
}
console.log(`\n=== ${fallos?`${fallos} FALLO(S) ✗`:'TODO OK ✔'} · ${comprobaciones} comprobaciones · ${((Date.now()-inicio)/1000).toFixed(1)} s ===`);process.exitCode=fallos?1:0;
