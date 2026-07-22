import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const raiz='/workspace/programa-/app/dist';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=createServer((q,s)=>{const r=join(raiz,q.url==='/'?'index.html':q.url.split('?')[0]);if(!existsSync(r)){s.writeHead(404);s.end();return;}s.writeHead(200,{'content-type':mime[extname(r)]??'application/octet-stream'});s.end(readFileSync(r));});
await new Promise(r=>server.listen(4197,r));
const dir='/tmp/claude-0/-home-user-programatablero/09597771-dc81-5659-a040-86f41ce50a30/scratchpad';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--use-gl=swiftshader','--no-sandbox']});
const page=await b.newPage({viewport:{width:1500,height:950}});
const errs=[]; page.on('pageerror',e=>errs.push(e.message)); page.on('dialog',d=>d.accept());
await page.addInitScript(()=>{localStorage.removeItem('tablerostudio-proyecto');localStorage.setItem('tablerostudio-visto','1');});
await page.goto('http://127.0.0.1:4197/'); await page.waitForTimeout(3000);
const H=[]; const chk=(c,m)=>H.push((c?'✔ ':'✘ ')+m);
const modelo=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('tablerostudio-proyecto')));

await page.$eval('#btn-empezar-ejemplo', el=>el.click()); await page.waitForTimeout(700);

// Tensión de trabajo en Editor
await page.$eval('#lista-dispositivos li:has-text("-A1")', el=>el.click()); await page.waitForTimeout(300);
const tieneSelector = await page.$('#dev-tension') ? true:false;
chk(tieneSelector, 'Panel Editor tiene selector de Tensión de trabajo');
if(tieneSelector){
  await page.selectOption('#dev-tension','380'); await page.waitForTimeout(500);
  const t = (await modelo()).dispositivos.find(d=>d.id==='a1').tensionNominal;
  chk(t===380, `Cambiar tensión de -A1 a 380 V (modelo=${t})`);
}
await page.screenshot({ path: `${dir}/volt-editor.png` });

// Colorear por voltaje
await page.check('#ver-voltaje'); await page.waitForTimeout(500);
const leyendaVisible = await page.isVisible('#leyenda-voltaje');
chk(leyendaVisible, 'Leyenda de colores por voltaje visible al activar');
await page.screenshot({ path: `${dir}/volt-coloreado.png` });
await page.uncheck('#ver-voltaje'); await page.waitForTimeout(300);

// Cable seleccionado muestra origen/destino: modo Trabajo, seleccionar un cable
await page.$eval('#modo-trabajo', el=>el.click()); await page.waitForTimeout(300);
let selCable=false;
for(let gx=560; gx<=820 && !selCable; gx+=25){ for(let gy=300; gy<=560; gy+=30){
  await page.mouse.click(gx,gy); await page.waitForTimeout(50);
  if(!(await page.isVisible('#panel-der'))) continue;
  const t=await page.textContent('#panel-der').catch(()=>'')||'';
  if(/Quitar cable/.test(t)){selCable=true;break;}
}}
chk(selCable, 'Cable seleccionable en Trabajo (muestra origen→destino)');
await page.waitForTimeout(300);
await page.screenshot({ path: `${dir}/volt-cable-extremos.png` });

console.log('\n=== VOLTAJE / CABLES ===');
for(const h of H)console.log(h);
console.log('errores JS:', errs.length?errs.join(' | '):'0');
await b.close(); server.close();
