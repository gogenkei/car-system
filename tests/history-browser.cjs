/* Run with NODE_PATH pointing to installed playwright and a local HTTP server on 8765. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const baseURL=process.env.LEDGER_TEST_URL || 'http://127.0.0.1:8765';
const fixture={schemaVersion:3,revision:4,systemState:{initialMileage:100,historyTkm:70,historyKkm:30,tyreBaseTkm:0,tyreBaseKkm:0},mileageList:[],expenseList:[],historyMonths:[{id:'month-aug',label:'2026年8月',snapshot:{mTkm:70,mKkm:30,mileages:[{user:'Terence',start:0,end:70,diff:70},{user:'Ken',start:70,end:100,diff:30}],expenses:[{id:'expense-1',item:'保養',amount:300,user:'Ken',payer:'Ken',splitType:'23_13',kenShare:100,rule:'Terence 2/3、Ken 1/3',createdAt:'2026-08-01T00:00:00Z',createdBy:'admin-test'}],totalExp:300,totalCharging:0,totalOtherExpense:300,tPaid:0,kPaid:300,kResponsibility:100,netFlow:-200,finalActionStr:'Terence 應付給 Ken $200'}}]};
const mocks={
 'firebase-app.js':`export const initializeApp=()=>({});`,
 'firebase-auth.js':`export const browserLocalPersistence={}; export class GoogleAuthProvider {setCustomParameters(){}}; export const getAuth=()=>({}); export const setPersistence=async()=>{}; export const signInWithPopup=async()=>{}; export const signInWithRedirect=async()=>{}; export const signOut=async()=>{}; export function onAuthStateChanged(auth,cb){window.__auth=cb;cb({uid:window.__role==='member'?'ken-test':'admin-test',displayName:'Test Admin'});}`,
 'firebase-firestore.js':`export const getFirestore=()=>({});export const doc=(db,...parts)=>({path:parts.join('/')});export const serverTimestamp=()=>null;
const snapshot=()=>({exists:()=>true,data:()=>structuredClone(window.__db),metadata:{fromCache:false,hasPendingWrites:false}});
export const getDocFromServer=async(ref)=>ref.path.startsWith('authorized_users/')?{exists:()=>true,data:()=>({active:true,role:window.__role,name:window.__role==='member'?'Ken':'Terence'})}:snapshot();
export function onSnapshot(ref,opts,cb){window.__emit=()=>cb(snapshot());window.__offline=()=>cb({...snapshot(),metadata:{fromCache:true,hasPendingWrites:false}});cb(snapshot());return ()=>{};}
export async function runTransaction(db,fn){if(window.__fail)throw new Error('測試：儲存失敗');let staged;await fn({get:async()=>snapshot(),set:(ref,data)=>{staged=data}});if(staged){window.__db=staged;window.__emit();}}
`
};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const errors=[];
 const context=await browser.newContext({viewport:{width:1200,height:900},timezoneId:'Asia/Taipei',reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='127.0.0.1')return route.continue();
   const mock=mocks[path.basename(url.pathname)];
   if(mock && url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:mock});
   return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));
 await page.addInitScript(({fixture})=>{window.__db=fixture;window.__role='admin';},{fixture});
 let caseNumber=0;
 const open=async()=>{await page.goto(baseURL+'/?case='+(++caseNumber)+'#history');await page.locator('.history-card summary').click();await page.getByRole('button',{name:'更正費用',exact:true}).click();await page.locator('#historyExpenseAmount').waitFor();};
 const stage=async(amount='3195')=>{await page.locator('#historyExpenseKind').selectOption('其他');await page.locator('#historyExpenseCustom').fill('100000公里保養');await page.locator('#historyExpenseAmount').fill(amount);await page.locator('#historyExpensePayer').selectOption('Ken');await page.locator('#historyExpenseSplit').selectOption('23_13');await page.locator('#historyExpenseStage').click();await page.locator('#historyEditReason').fill('補登月底保養費');};
 await open();await stage();await page.locator('#historyEditReview').click();
 assert.match(await page.locator('#historyEditPreview').innerText(),/2,330/);
 fs.mkdirSync('output/history-corrections',{recursive:true});
 await page.locator('#historyEditPreview').screenshot({path:'output/history-corrections/desktop-preview.png'});
 await page.locator('#historyEditSave').click();await page.waitForFunction(()=>!document.querySelector('#historyEditDialog').open);
 assert.equal(await page.evaluate(()=>window.__db.historyMonths[0].snapshot.netFlow),-2330);
 assert.equal(await page.evaluate(()=>window.__db.historyMonths[0].corrections.length),1);
 await page.locator('.history-card summary').click();await page.getByRole('button',{name:'預覽與輸出月報'}).click();
 assert.match(await page.locator('#monthlyReport').innerText(),/更正版本 1/);
 await page.evaluate(()=>{window.__db.historyMonths[0].timestamp=99;window.__emit();});
 assert.equal(await page.locator('#reportPrintButton').isDisabled(),true);
 await page.locator('#reportRefreshButton').click();assert.equal(await page.locator('#reportPrintButton').isDisabled(),false);
 await page.locator('#reportCloseButton').click();
 console.log('PASS save, audit, and stale report refresh');
 await page.evaluate(()=>{location.hash='#settings';});
 const downloading=page.waitForEvent('download'); await page.locator('#downloadBackupButton').click();
 const downloaded=await downloading; const backup=JSON.parse(fs.readFileSync(await downloaded.path(),'utf8'));
 assert.equal(backup.historyMonths[0].corrections.length,1);
 await page.locator('#importBackupFile').setInputFiles({name:'test-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
 await page.locator('#confirmAcceptButton').click();
 await page.waitForFunction(()=>window.__db.revision===6);
 assert.deepEqual(await page.evaluate(()=>window.__db.historyMonths[0].corrections),backup.historyMonths[0].corrections);
 console.log('PASS full backup export/import preserves correction history');
 // Synchronization cannot overwrite staged inputs; a changed month blocks committing.
 await open();await stage('600');await page.locator('#historyEditReview').click();
 await page.evaluate(()=>{window.__db.historyMonths[0].timestamp=99;window.__emit();});
 assert.equal(await page.locator('#historyEditConflict').isVisible(),true);
 assert.equal(await page.locator('#historyEditSave').isDisabled(),true);
 assert.match(await page.locator('#historyExpenseList').innerText(),/600/);
 await page.locator('#historyEditClose').click();await page.locator('#confirmDialog button[value="cancel"]').click();
 assert.equal(await page.locator('#historyEditDialog').evaluate(el=>el.open),true);
 console.log('PASS conflict preserves draft and cancelled discard');
 // Failure and offline: draft survives, then retry succeeds with newest current records.
 await open();await stage('600');await page.locator('#historyEditReview').click();
 await page.evaluate(()=>{window.__fail=true;});await page.locator('#historyEditSave').click();
 await page.waitForFunction(()=>document.querySelector('#historyEditError').textContent.includes('儲存失敗'));
 assert.match(await page.locator('#historyExpenseList').innerText(),/600/);
 await page.evaluate(()=>window.__offline());assert.equal(await page.locator('#historyEditSave').isDisabled(),true);
 await page.evaluate(()=>{window.__fail=false;window.__db.expenseList.push({id:'latest',item:'充電',amount:50,user:'Ken',splitType:'month_mileage',createdBy:'ken-test'});window.__emit();});
 await page.locator('#historyEditSave').click();await page.waitForFunction(()=>!document.querySelector('#historyEditDialog').open);
 assert.equal(await page.evaluate(()=>window.__db.expenseList[0].id),'latest');
 console.log('PASS failure, offline, retry and concurrent current-month write');
 // Editing/deleting and fixed category UI.
 await open();await page.getByRole('button',{name:'修改 保養 $300',exact:true}).click();
 await page.locator('#historyExpensePayer').selectOption('Terence');await page.locator('#historyExpenseStage').click();
 await page.locator('#historyEditReason').fill('更正付款人');await page.locator('#historyEditReview').click();
 await page.locator('#historyEditSave').click();await page.waitForFunction(()=>!document.querySelector('#historyEditDialog').open);
 assert.equal(await page.evaluate(()=>window.__db.historyMonths[0].snapshot.netFlow),100);
 console.log('PASS edit payer reverses settlement');
 await open();await page.getByRole('button',{name:'從草稿刪除 保養 $300',exact:true}).click();
 await page.locator('#historyEditReason').fill('刪除重複費用');await page.locator('#historyEditReview').click();await page.locator('#historyEditSave').click();
 await page.waitForFunction(()=>!document.querySelector('#historyEditDialog').open);
 assert.equal(await page.evaluate(()=>window.__db.historyMonths[0].snapshot.expenses.length),0);
 assert.equal(await page.evaluate(()=>window.__db.historyMonths[0].snapshot.netFlow),0);
 console.log('PASS deletion recomputes zero settlement');
 // Mobile, dark appearance, keyboard and enlarged text.
 await page.setViewportSize({width:375,height:812});await page.emulateMedia({colorScheme:'dark'});await open();await stage();
 await page.locator('#historyEditReview').click();
 assert.equal(await page.locator('#historyEditDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.locator('#historyEditPreview').screenshot({path:'output/history-corrections/mobile-dark-preview.png'});
 await page.locator('#historyEditDialog').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'output/history-corrections/mobile-dark-editor.png'});
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('#historyEditDialog').contains(document.activeElement)),true);
 await page.setViewportSize({width:812,height:375});await page.addStyleTag({content:'body { font-size: 24px; }'});
 assert.equal(await page.locator('#historyEditDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 console.log('PASS mobile dark, landscape enlarged type, keyboard containment');
 // Member has no history entry point even on a forced history hash.
 const member=await context.newPage();member.on('pageerror',err=>errors.push(err.message));
 await member.addInitScript(({fixture})=>{window.__db=fixture;window.__role='member';},{fixture});
 await member.goto(baseURL+'/#history');await member.locator('#appShell').waitFor();
 assert.equal(await member.getByRole('button',{name:'更正費用',exact:true}).count(),0);
 assert.equal(await member.locator('#historyEditDialog').evaluate(el=>el.open),false);
 console.log('PASS member interface restriction');
 assert.deepEqual(errors,[]);
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
