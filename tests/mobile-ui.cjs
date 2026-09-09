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
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'dark',reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='127.0.0.1')return route.continue();
   const mock=mocks[path.basename(url.pathname)];
   if(mock && url.hostname==='www.gstatic.com')return route.fulfill({contentType:'text/javascript',body:mock});
   return route.abort();
 });
 const page=await context.newPage(),errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({fixture})=>{window.__db=fixture;window.__role='admin';},{fixture});
 await page.goto(baseURL); await page.locator('#appShell').waitFor({state:'visible'});
 fs.mkdirSync('output/ui-light',{recursive:true});
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light');
 await page.locator('.mobile-nav [data-route=add]').click();await page.locator('#mileageTab').click();
 assert.equal(await page.locator('.mobile-nav').isVisible(),false);
 assert.notEqual(await page.evaluate(()=>document.activeElement.id),'endMileage');
 await page.locator('#endMileage').fill('150');assert.match(await page.locator('#mileagePreview').innerText(),/50 km/);
 await page.locator('#endMileage').press('Enter');assert.equal(await page.evaluate(()=>window.__db.mileageList.length),0);
 await page.locator('#mileageSubmitButton').click();assert.equal(await page.evaluate(()=>window.__db.mileageList.length),1);
 await page.locator('#entryBack').click();await page.locator('#expenseTab').click();
 await page.locator('#expenseItem').selectOption('其他');await page.locator('#customExpenseItem').fill('停車費');
 await page.locator('#expenseAmount').fill('100.5');await page.locator('#expenseSubmitButton').click();assert.equal(await page.locator('#expenseAmountError').isVisible(),true);
 await page.locator('#expenseAmount').fill('120');await page.evaluate(()=>window.__fail=true);await page.locator('#expenseSubmitButton').click();
 assert.equal(await page.locator('#expenseAmount').inputValue(),'120');assert.equal(await page.evaluate(()=>window.__db.expenseList.length),0);
 await page.evaluate(()=>window.__fail=false);await page.locator('#expenseSubmitButton').dblclick();
 assert.equal(await page.evaluate(()=>window.__db.expenseList.length),1);
 await page.locator('#entryBack').click();await page.locator('.mobile-nav [data-route=records]').click();
 assert.match(await page.locator('#monthRecords').innerText(),/停車費/);
 await page.locator('[data-action=edit-expense]').click();await page.locator('#expenseAmount').fill('180');await page.locator('#expenseSubmitButton').click();
 assert.equal(await page.evaluate(()=>window.__db.expenseList[0].amount),180);
 for(const [width,height] of [[320,700],[375,812],[430,932],[844,390],[1280,900]]) {
   await page.setViewportSize({width,height});
   for(const route of ['home','add','add-mileage','add-expense','records','history','settings']) {
     await page.evaluate(route=>location.hash=route,route);await page.waitForTimeout(40);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}: ${route}`);
   }
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>location.hash='home');await page.waitForTimeout(50);
 await page.screenshot({path:'output/ui-light/home.png',fullPage:true});
 await page.locator('.mobile-nav [data-route=history]').click();await page.locator('#historyList summary').click();
 await page.getByRole('button',{name:'預覽與輸出月報'}).click();
 assert.equal(await page.locator('.report-settlement').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(234, 242, 255)');
 await page.setViewportSize({width:1100,height:900});await page.screenshot({path:'output/ui-light/report-screen.png'});
 await page.evaluate(()=>{document.body.classList.add('report-printing');});
 await page.emulateMedia({media:'print'});
 await page.pdf({path:'output/ui-light/monthly-report-light.pdf',format:'A4',printBackground:true,preferCSSPageSize:true});
 await page.emulateMedia({media:'screen'});await page.evaluate(()=>document.body.classList.remove('report-printing'));
 await page.locator('#reportCloseButton').click();
 const member=await context.newPage();member.on('pageerror',e=>errors.push(e.message));
 await member.addInitScript(({fixture})=>{window.__db=fixture;window.__role='member';},{fixture});
 await member.goto(baseURL+'/#history');await member.locator('#appShell').waitFor({state:'visible'});
 assert.equal(await member.locator('.mobile-nav a:visible').count(),3);
 await member.locator('#expenseTab').click();
 for (const amount of ['70','80']) { await member.locator('#expenseAmount').fill(amount);await member.locator('#expenseSubmitButton').click();assert.equal(await member.locator('#expensePayer').inputValue(),'Ken'); }
 assert.equal(await member.evaluate(()=>window.__db.expenseList.every(e=>e.user==='Ken')),true);
 await member.locator('#entryBack').click();await member.locator('.mobile-nav [data-route=records]').click();assert.equal(await member.locator('.delete-record:visible').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: production transaction mocks, failed-save retention, single-click and duplicate-save protection, integer input, current edit, repeated member payer, role routing, responsive widths, light report and PDF');
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1)});
