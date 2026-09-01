/** Gate I/J: exportaciones visibles de informe, BOM, wiring y terminales V7. */
import { chromium } from 'playwright-core';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { abrirNavegador, esperarEditorListo, servidorDeQA } from './lib/entorno.mjs';
const inicio=Date.now();let servidor,browser,page;let fallos=0,comprobaciones=0;const erroresJS=[];
const debugLog=join(process.cwd(),'debug.log'),debugLogExistia=existsSync(debugLog),chromeLogAnterior=process.env.CHROME_LOG_FILE;
process.env.CHROME_LOG_FILE=process.platform==='win32'?'NUL':'/dev/null';
function comprobar(n,c,d=''){comprobaciones++;if(!c)fallos++;console.log(`${c?'OK  ':'FAIL'}  ${n}${d?` → ${d}`:''}`)}
async function click(id){const b=page.locator(`#${id}`);await b.waitFor({state:'visible'});await b.click()}
async function abrirEjemplo(){
	if(await page.locator('#inicio').isVisible().catch(()=>false))await click('inicio-ejemplos');else{await click('btn-aprender');await click('btn-ejemplos')}
	await page.locator('#modal-ejemplos').waitFor({state:'visible'});await page.locator('.tarjeta-ejemplo',{hasText:'Fixture V5: caída de tensión'}).first().getByRole('button',{name:/Abrir y estudiar/i}).click();
	await Promise.race([page.locator('#modal-dialogo').waitFor({state:'visible',timeout:1200}).catch(()=>false),page.waitForFunction(()=>window.qa.proyecto().nombre==='Fixture V5 — caída de tensión',null,{timeout:1200}).catch(()=>false)]);
	if(await page.locator('#modal-dialogo').isVisible().catch(()=>false))await click('dialogo-ok');await page.waitForFunction(()=>window.qa.proyecto().nombre==='Fixture V5 — caída de tensión',null,{timeout:30000});
	if(await page.locator('#modal-explicacion').isVisible().catch(()=>false))await click('btn-cerrar-explicacion');
}
async function descargarAccion(accion){const evento=page.waitForEvent('download');await page.locator(`[data-ing-doc="${accion}"]`).click();const d=await evento;const ruta=await d.path();return ruta?readFileSync(ruta,'utf8'):''}
try{
	const e=await servidorDeQA();servidor=e.servidor;browser=await abrirNavegador(chromium);page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
	page.on('pageerror',x=>erroresJS.push(x.message));page.on('console',m=>{if(m.type()==='error')erroresJS.push(`console: ${m.text()}`)});
	await page.goto(`${e.url}/?qa=1`,{waitUntil:'domcontentloaded'});await esperarEditorListo(page);await abrirEjemplo();await click('hta-ingenieria');await click('ingenieria-validar');
	await page.locator('[data-ing-view="documentacion"]').click();await page.locator('[data-ing-doc="prepare"]').click();await page.locator('.ing-doc-preview').waitFor({state:'visible'});
	const previa=await page.locator('.ing-doc-preview').innerText();
	comprobar('prepara informe con proyecto/revisión/snapshot/Build ID',/Project ID.*Revisión.*Snapshot.*Build ID.*DEV-1\.0\.0/s.test(previa),previa);
	comprobar('documentación publica BOM, conductores y borneras desde Gate H',/BOM.*líneas.*Conductores.*Borneras/s.test(previa));
	const json=await descargarAccion('json');const informe=JSON.parse(json);
	comprobar('JSON conserva formato, Build ID y ejemplo efímero',informe.formato==='tablerostudio-informe-ingenieria'&&informe.trazabilidad.buildId==='DEV-1.0.0'&&informe.proyecto.id==='EJEMPLO_EFIMERO');
	comprobar('JSON contiene circuitos, potencia, issues, procedencia y limitaciones',informe.circuitos.length>0&&informe.potencia&&Array.isArray(informe.issues)&&informe.conductores.every(c=>c.origenLongitud)&&informe.limitaciones.length>0);
	const bom=await descargarAccion('bom');comprobar('BOM CSV incluye metadatos sin inventar precios',/^Cantidad;Tipo;Descripción;Fabricante;Referencia;Perfil;Modelo físico;Designaciones/m.test(bom)&&!/Precio|Costo/.test(bom));
	const wiring=await descargarAccion('wiring');comprobar('Wiring CSV incluye extremos, sección, longitud y provenance',/^ID;Número;De dispositivo;De terminal;A dispositivo;A terminal;Sección mm²;Color;Material;Longitud m;Provenance;Circuitos/m.test(wiring)&&/CONFIGURADO/.test(wiring));
	const terminal=await descargarAccion('terminal');comprobar('Terminal list CSV usa esquema explícito aun sin bornero en el fixture',/^Bornero;Designación;Borne;Tipo;Conexiones;Circuitos/.test(terminal));
	const html=await descargarAccion('html');comprobar('HTML técnico es autocontenido, trazable y declara límites',/<!doctype html>/i.test(html)&&/DEV-1\.0\.0/.test(html)&&/No constituye certificación normativa/.test(html)&&!/<script\b|https?:\/\//i.test(html));
	comprobar('no hubo errores JavaScript',erroresJS.length===0,erroresJS.slice(0,4).join(' | '));
}catch(error){fallos++;console.error(`ERROR NO CONTROLADO: ${error?.stack??error}`)}finally{
	try{await page?.close()}catch(e){fallos++;console.error(e)}try{await browser?.close()}catch(e){fallos++;console.error(e)}if(servidor)try{servidor.closeAllConnections?.();await new Promise((ok,no)=>servidor.close(e=>e?no(e):ok()))}catch(e){fallos++;console.error(e)}
	if(!debugLogExistia&&existsSync(debugLog))try{unlinkSync(debugLog)}catch(e){fallos++;console.error(e)}if(chromeLogAnterior===undefined)delete process.env.CHROME_LOG_FILE;else process.env.CHROME_LOG_FILE=chromeLogAnterior;
}
console.log(`\n=== ${fallos?`${fallos} FALLO(S) ✗`:'TODO OK ✔'} · ${comprobaciones} comprobaciones · ${((Date.now()-inicio)/1000).toFixed(1)} s ===`);process.exitCode=fallos?1:0;
