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
	await page.locator('#modal-ejemplos').waitFor({state:'visible'});await page.locator('.tarjeta-ejemplo',{hasText:'Fixture V7: proyecto sano'}).first().getByRole('button',{name:/Abrir y estudiar/i}).click();
	await Promise.race([page.locator('#modal-dialogo').waitFor({state:'visible',timeout:1200}).catch(()=>false),page.waitForFunction(()=>window.qa.proyecto().nombre==='Fixture V7 — proyecto sano',null,{timeout:1200}).catch(()=>false)]);
	if(await page.locator('#modal-dialogo').isVisible().catch(()=>false))await click('dialogo-ok');await page.waitForFunction(()=>window.qa.proyecto().nombre==='Fixture V7 — proyecto sano',null,{timeout:30000});
	if(await page.locator('#modal-explicacion').isVisible().catch(()=>false))await click('btn-cerrar-explicacion');
}
async function descargarAccion(accion){const evento=page.waitForEvent('download');await page.locator(`[data-ing-doc="${accion}"]`).click();const d=await evento;const ruta=await d.path();const bytes=ruta?readFileSync(ruta):Buffer.alloc(0);return{bytes,text:bytes.toString('utf8')}}
const tieneBomUtf8=(bytes)=>bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf;
try{
	const e=await servidorDeQA();servidor=e.servidor;browser=await abrirNavegador(chromium);page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
	page.on('pageerror',x=>erroresJS.push(x.message));page.on('console',m=>{if(m.type()==='error')erroresJS.push(`console: ${m.text()}`)});
	await page.goto(`${e.url}/?qa=1`,{waitUntil:'domcontentloaded'});await esperarEditorListo(page);await abrirEjemplo();await click('hta-ingenieria');await click('ingenieria-validar');
	await page.locator('[data-ing-view="documentacion"]').click();await page.locator('[data-ing-doc="prepare"]').click();await page.locator('.ing-doc-preview').waitFor({state:'visible'});
	const previa=await page.locator('.ing-doc-preview').innerText();
	comprobar('prepara informe con proyecto/revisión/snapshot/Build ID',/Project ID.*Revisión.*Snapshot.*Build ID.*DEV-1\.0\.0/s.test(previa),previa);
	comprobar('documentación publica BOM, conductores y borneras desde Gate H',/BOM.*líneas.*Conductores.*Borneras/s.test(previa));
	const json=await descargarAccion('json');const informe=JSON.parse(json.text);
	comprobar('JSON conserva formato, Build ID y ejemplo efímero',informe.formato==='tablerostudio-informe-ingenieria'&&informe.trazabilidad.buildId==='DEV-1.0.0'&&informe.proyecto.id==='EJEMPLO_EFIMERO');
	comprobar('JSON contiene circuitos, potencia, issues, procedencia, criterios y limitaciones',informe.circuitos.length>0&&informe.potencia&&Array.isArray(informe.issues)&&informe.conductores.every(c=>c.origenLongitud)&&informe.criterios?.criterios?.maxVoltageDropPercent===5&&informe.limitaciones.length>0);
	const bom=await descargarAccion('bom');comprobar('BOM CSV incluye metadatos sin inventar precios',/^\uFEFFCantidad;Tipo;Descripción;Fabricante;Referencia;Perfil;Modelo físico;Designaciones/m.test(bom.text)&&!/Precio|Costo/.test(bom.text));
	const wiring=await descargarAccion('wiring');comprobar('Wiring CSV incluye extremos, sección, longitud y provenance',/^\uFEFFID;Número;De dispositivo;De terminal;A dispositivo;A terminal;Sección mm²;Color;Material;Longitud m;Provenance;Circuitos/m.test(wiring.text)&&/CONFIGURADO/.test(wiring.text));
	const terminal=await descargarAccion('terminal');comprobar('Terminal list CSV contiene la bornera y sus conexiones reales',/^\uFEFFBornero;Designación;Borne;Tipo;Conexiones;Circuitos/m.test(terminal.text)&&/x1;'-X1;1;L;/.test(terminal.text)&&/w-fase-carga:q1:2/.test(terminal.text)&&/w-bornero-carga:r1:L/.test(terminal.text));
	comprobar('BOM, wiring y terminales descargan BOM UTF-8 real',tieneBomUtf8(bom.bytes)&&tieneBomUtf8(wiring.bytes)&&tieneBomUtf8(terminal.bytes));
	comprobar('acentos técnicos sobreviven la descarga UTF-8',/Descripción/.test(bom.text)&&/Número.*Sección/s.test(wiring.text)&&/Designación/.test(terminal.text));
	const html=await descargarAccion('html');comprobar('HTML técnico es autocontenido, trazable, escapado y declara límites',/<!doctype html>/i.test(html.text)&&/DEV-1\.0\.0/.test(html.text)&&/Protección &amp; distribución/.test(html.text)&&!/Protección & distribución/.test(html.text)&&/No constituye certificación normativa/.test(html.text)&&!/<script\b|https?:\/\//i.test(html.text));
	comprobar('HTML incluye layout técnico y reglas A4 sin recursos externos',/<header class="cabecera">/.test(html.text)&&/<section><h2>Resumen<\/h2>/.test(html.text)&&/@page\{size:A4/.test(html.text)&&/@media print/.test(html.text)&&/break-inside:avoid-page/.test(html.text));
	comprobar('no hubo errores JavaScript',erroresJS.length===0,erroresJS.slice(0,4).join(' | '));
}catch(error){fallos++;console.error(`ERROR NO CONTROLADO: ${error?.stack??error}`)}finally{
	try{await page?.close()}catch(e){fallos++;console.error(e)}try{await browser?.close()}catch(e){fallos++;console.error(e)}if(servidor)try{servidor.closeAllConnections?.();await new Promise((ok,no)=>servidor.close(e=>e?no(e):ok()))}catch(e){fallos++;console.error(e)}
	if(!debugLogExistia&&existsSync(debugLog))try{unlinkSync(debugLog)}catch(e){fallos++;console.error(e)}if(chromeLogAnterior===undefined)delete process.env.CHROME_LOG_FILE;else process.env.CHROME_LOG_FILE=chromeLogAnterior;
}
console.log(`\n=== ${fallos?`${fallos} FALLO(S) ✗`:'TODO OK ✔'} · ${comprobaciones} comprobaciones · ${((Date.now()-inicio)/1000).toFixed(1)} s ===`);process.exitCode=fallos?1:0;
