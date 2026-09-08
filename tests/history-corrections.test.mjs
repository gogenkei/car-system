import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auditMonth, prepareMonth, fingerprint, makeExpense, buildCorrection, applyCorrection, summarize, assertDocumentSize, isTyre } from '../history-corrections.mjs';

const actor = { uid: 'admin-test', role: 'admin', name: '管理員' };
const now = '2026-09-08T16:00:00.000Z';
function month(expenses = [], km = [70,30]) {
  return { label:'2026年8月', snapshot: { mTkm:km[0], mKkm:km[1], mileages:[{user:'Terence',diff:km[0]},{user:'Ken',diff:km[1]}], expenses, ...summarize(expenses) } };
}
function expense(base, input = {}, original = null) {
  return makeExpense({id:'expense-test', item:'保養', amount:300, user:'Ken', splitType:'23_13', ...input}, base, original, actor, now);
}
function corrected(base, expenses, id='correction-1') { return buildCorrection(base, expenses, '補登費用', actor, now, id); }

test('fixed categories, selectable rules, ETC payer and zero mileage', () => {
  const m=month();
  for(const [input,share] of [
    [{item:'⚡ 充電',amount:100},30], [{item:'🚗 車貸',amount:100},33],
    [{item:'🛡️ 保險',amount:100},33], [{splitType:'50_50',amount:101},51],
    [{item:'🛣️ ETC',splitType:'Terence',user:'Terence',amount:100},0],
    [{item:'🛣️ ETC',splitType:'Ken',amount:100},100]
  ]) { const e=expense(m,input); assert.equal(e.kenShare,share); if(input.item?.includes('ETC')) assert.equal(e.user,'Ken'); }
  assert.equal(expense(month([],[0,0]),{item:'⚡ 充電',amount:101}).kenShare,51);
});
test('unchanged decimal legacy shares survive, only edited expense recalculates', () => {
  const original={item:'其他',amount:990,payer:'Terence',kenShare:243.2950613473,rule:'本月里程比例，Ken 24.6%'};
  const base=month([original]); const prepared=prepareMonth(base);
  const next=corrected(base,[...prepared.snapshot.expenses,expense(base)]);
  assert.equal(next.snapshot.expenses[0].kenShare,original.kenShare);
  assert.equal(next.snapshot.kResponsibility,343.2950613473);
  assert.equal(next.corrections[0].changes.length,1);
  assert.equal(next.corrections[0].before.kResponsibility,original.kenShare);
});
test('payer update, deletion, reversal and multiple corrections with backup roundtrip', () => {
  const empty=month(); const base=month([expense(empty)]); const p=prepareMonth(base);
  const edited=expense(base,{user:'Terence'},p.snapshot.expenses[0]);
  const next=corrected(base,[edited]); assert.equal(next.snapshot.netFlow,100);
  const deleted=corrected(JSON.parse(JSON.stringify(next)),[],'correction-2');
  assert.equal(deleted.snapshot.netFlow,0); assert.equal(deleted.correctionVersion,2);
  assert.equal(deleted.corrections.length,2); assert.deepEqual(deleted.corrections[0],next.corrections[0]);
  auditMonth(deleted);
});
test('target transaction preserves latest current records, other history and mileage bases', () => {
  const base=month(); const other={...month(),label:'2026年9月'};
  const db={systemState:{historyTkm:12,tyreBaseKkm:3},mileageList:[{id:'latest'}],expenseList:[{id:'new-live'}],historyMonths:[base,other]};
  const before=structuredClone(db); const next=corrected(base,[expense(base)]);
  applyCorrection(db,base.label,fingerprint(base),next,actor);
  assert.deepEqual(db.systemState,before.systemState); assert.deepEqual(db.expenseList,before.expenseList);
  assert.deepEqual(db.mileageList,before.mileageList); assert.deepEqual(db.historyMonths[1],before.historyMonths[1]);
  assert.throws(()=>applyCorrection(db,base.label,fingerprint(base),next,actor),/已被更新/);
  const concurrent=structuredClone(before);concurrent.historyMonths[0].timestamp=123;
  assert.throws(()=>applyCorrection(concurrent,base.label,fingerprint(base),next,actor),/已被更新/);
});
test('invalid data, unknown rules, duplicate IDs, empty changes and non-admin are rejected', () => {
  const base=month();
  assert.throws(()=>corrected(base,[]),/尚未變更/);
  assert.throws(()=>buildCorrection(base,[expense(base)],' ',actor,now,'x'),/更正原因/);
  assert.throws(()=>buildCorrection(base,[expense(base)],'原因',{uid:'ken',role:'member'},now,'x'),/管理員/);
  assert.throws(()=>applyCorrection({historyMonths:[base]},base.label,fingerprint(base),base,{role:'member'}),/管理員/);
  for (const amount of [-1,0,1.5,NaN,Infinity]) assert.throws(()=>expense(base,{amount}));
  assert.throws(()=>prepareMonth(month([{item:'雨刷',amount:990,payer:'Terence',kenShare:243.295,rule:'使用比例（依 Numbers 原始公式）'}])),/雨刷/);
  const bad=month();bad.snapshot.totalExp=100;assert.throws(()=>prepareMonth(bad),/不一致/);
  assert.throws(()=>corrected(base,[expense(base),expense(base)]),/ID/);
});
test('tyre edits, removals and category bypass blocked; unchanged tyre stays identical', () => {
  const tyre={id:'tyre-1',item:'輪胎',amount:500,payer:'Terence',kenShare:150.5,rule:'輪胎使用比例（依 Numbers 原始公式）'};
  const base=month([tyre]);
  assert.ok(isTyre(tyre));
  assert.throws(()=>expense(base,{item:'換胎保養'}),/輪胎/);
  assert.throws(()=>expense(base,{},tyre),/輪胎/);
  assert.throws(()=>corrected(base,[]),/輪胎/);
  const next=corrected(base,[tyre,expense(base)]);
  assert.deepEqual(next.snapshot.expenses[0],tyre);
});
test('document capacity guard counts UTF-8 and field overhead', () => {
  assert.doesNotThrow(()=>assertDocumentSize({historyMonths:[]}));
  assert.throws(()=>assertDocumentSize({huge:'車'.repeat(400000)}),/容量上限/);
});
test('canonical fingerprint tolerates object field order only', () => {
  assert.equal(fingerprint({a:1,b:2}),fingerprint({b:2,a:1}));
  assert.notEqual(fingerprint([1,2]),fingerprint([2,1]));
});
const backupPath=process.env.LEDGER_TEST_BACKUP;
test('local backup regression: 16 month totals and August 3195 maintenance', { skip:!backupPath }, () => {
  const db=JSON.parse(fs.readFileSync(backupPath));
  for(const m of db.historyMonths) auditMonth(m,{checkRules:false});
  assert.equal(db.historyMonths.length,16);
  const base=db.historyMonths.find(m=>m.label==='2026年8月');
  assert.equal(base.snapshot.netFlow,-20772);
  const prepared=prepareMonth(base);
  const next=corrected(base,[...prepared.snapshot.expenses,expense(base,{item:'100000公里保養',amount:3195})]);
  assert.equal(next.snapshot.netFlow,-22902);
  assert.equal(next.snapshot.totalExp-base.snapshot.totalExp,3195);
  assert.equal(next.snapshot.kResponsibility-base.snapshot.kResponsibility,1065);
  assert.deepEqual(base.snapshot.mileages,next.snapshot.mileages);
  let editable=0;
  for(const m of db.historyMonths) { try {prepareMonth(m);editable++;} catch(error) {assert.equal(m.label,'2026年6月');assert.match(error.message,/雨刷/);} }
  assert.equal(editable,15);
  assertDocumentSize({...db,historyMonths:db.historyMonths.map(m=>m===base?next:m)});
});

test('opening and saving an unchanged legacy expense preserves its original rounding', () => {
 const original={id:'legacy',item:'其他',amount:990,payer:'Terence',kenShare:243.2950613473,rule:'本月里程比例，Ken 24.6%'};
 const base=month([original]);
 const same=expense(base,{item:'其他',amount:990,user:'Terence',splitType:'month_mileage'},original);
 assert.deepEqual(same,original);
 assert.throws(()=>corrected(base,[same]),/尚未變更/);
});
