// Pure historical-ledger operations. Never normalize or recalculate unrelated months.
const PEOPLE = ["Terence", "Ken"];
const SPLITS = new Set(["month_mileage", "23_13", "50_50", "Terence", "Ken", "tire"]);
const copy = (value) => structuredClone(value);
const fail = (message) => { throw new Error(message); };
const numeric = (value, name) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${name} 不是有效的非負數字。`);
  return value;
};

export function fingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const monthKey = (month) => String(month.id || month.label || "");
export const isTyre = (expense) => expense.splitType === "tire" || /輪胎|換胎/.test(`${expense.item || ""} ${expense.rule || ""}`);

export function historicalSplit(expense) {
  if (isTyre(expense)) return "tire";
  if (expense.splitType) {
    if (!SPLITS.has(expense.splitType)) fail(`「${expense.item}」的分攤方式無法識別。`);
    return expense.splitType;
  }
  const rule = String(expense.rule || "");
  if (/2\/3/.test(rule)) return "23_13";
  if (/各一半|50/.test(rule)) return "50_50";
  if (/全歸 Terence|全部由 Terence/.test(rule)) return "Terence";
  if (/全歸 Ken|全部由 Ken/.test(rule)) return "Ken";
  if (/當月里程比|本月里程比例/.test(rule)) return "month_mileage";
  fail(`「${expense.item}」的舊分攤規則「${rule || "未記錄"}」無法確認，請先核對原始帳目。`);
}

export function summarize(expenses) {
  const result = { totalExp: 0, totalCharging: 0, totalOtherExpense: 0, tPaid: 0, kPaid: 0, kResponsibility: 0, netFlow: 0 };
  for (const expense of expenses) {
    if (!expense || typeof expense.item !== "string" || !expense.item.trim()) fail("費用明細缺少項目名稱。");
    const amount = numeric(expense.amount, `「${expense.item}」金額`);
    const share = numeric(expense.kenShare, `「${expense.item}」Ken 分攤`);
    if (share > amount) fail(`「${expense.item}」分攤超過金額。`);
    const payer = expense.user || expense.payer;
    if (!PEOPLE.includes(payer) || (expense.user && expense.payer && expense.user !== expense.payer)) fail(`「${expense.item}」付款人資料不一致。`);
    result.totalExp += amount;
    result[expense.item.includes("充電") ? "totalCharging" : "totalOtherExpense"] += amount;
    result[payer === "Ken" ? "kPaid" : "tPaid"] += amount;
    result.kResponsibility += share;
  }
  result.netFlow = result.kResponsibility - result.kPaid;
  return result;
}

export function auditMonth(month, { checkRules = true } = {}) {
  const s = month?.snapshot;
  if (!monthKey(month || {}) || !s || !Array.isArray(s.expenses) || !Array.isArray(s.mileages)) fail("歷史月份缺少必要明細。");
  numeric(s.mTkm, "Terence 月里程");
  numeric(s.mKkm, "Ken 月里程");
  for (const person of PEOPLE) {
    const km = s.mileages.reduce((sum, entry) => {
      if (!PEOPLE.includes(entry.user)) fail("里程紀錄的使用者無法識別。");
      const diff = numeric(entry.diff, "里程差額");
      return sum + (entry.user === person ? diff : 0);
    }, 0);
    if (Math.abs(km - s[person === "Ken" ? "mKkm" : "mTkm"]) > 0.000001) fail(`${person} 月里程與明細不一致。`);
  }
  const summary = summarize(s.expenses);
  for (const [key, value] of Object.entries(summary)) {
    if (s[key] != null && (typeof s[key] !== "number" || !Number.isFinite(s[key]) || Math.abs(s[key] - value) > 0.01)) {
      fail(`${month.label} 的 ${key} 與明細不一致，請先核對原始帳目。`);
    }
  }
  if (checkRules) s.expenses.forEach(historicalSplit);
  return summary;
}

export function prepareMonth(month) {
  auditMonth(month);
  const result = copy(month);
  result.id ||= `history-${encodeURIComponent(month.label)}`;
  result.correctionVersion ??= 0;
  if (!Number.isSafeInteger(result.correctionVersion) || result.correctionVersion < 0) fail("月份更正版本無效。");
  if (result.corrections != null && !Array.isArray(result.corrections)) fail("月份修改紀錄格式無效。");
  const logs = result.corrections || [];
  if (logs.length !== result.correctionVersion) fail("月份更正版本與修改紀錄數量不一致。");
  const logIds = new Set();
  for (const [index, log] of logs.entries()) {
    if (!log || log.version !== index + 1 || !log.id || logIds.has(log.id)
      || typeof log.reason !== "string" || !log.reason.trim() || typeof log.createdBy !== "string"
      || !log.createdBy || typeof log.actorName !== "string" || !Number.isFinite(Date.parse(log.createdAt))
      || !Array.isArray(log.changes) || !log.changes.length || !log.before || !log.after) fail("月份修改紀錄缺少必要資訊。");
    logIds.add(log.id);
    for (const key of Object.keys(summarize([]))) {
      if (!Number.isFinite(log.before[key]) || !Number.isFinite(log.after[key])) fail("修改紀錄的結算資料不完整。");
      if (index > 0 && Math.abs(log.before[key] - logs[index - 1].after[key]) > 0.01) fail("歷次更正的結算資料不連續。");
    }
    for (const change of log.changes) {
      if (!change?.id || (!change.before && !change.after)) fail("修改紀錄的費用差異不完整。");
      for (const expense of [change.before, change.after].filter(Boolean)) {
        if (expense.id !== change.id) fail("修改紀錄的費用 ID 不一致。");
        summarize([expense]);
      }
    }
  }
  if (logs.length) {
    const current = summarize(result.snapshot.expenses);
    for (const key of Object.keys(current)) if (Math.abs(logs.at(-1).after[key] - current[key]) > 0.01) fail("最新更正紀錄與帳本合計不一致。");
  }
  result.snapshot.expenses = result.snapshot.expenses.map((expense, index) => ({
    ...expense, id: expense.id || `${result.id}-expense-${index}`
  }));
  if (new Set(result.snapshot.expenses.map((e) => e.id)).size !== result.snapshot.expenses.length) fail("費用 ID 重複，請先核對原始帳目。");
  return result;
}

export function makeExpense(input, month, original, actor, now) {
  if (original && isTyre(original)) fail("輪胎紀錄在本版保持唯讀。");
  const item = String(input.item || "").trim();
  if (!item || item.length > 60) fail("項目名稱需為 1 至 60 個字。");
  if (isTyre({ item })) fail("本版不支援補登或變更輪胎費用。");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) fail("請輸入大於 0 的整數金額。");
  if (!PEOPLE.includes(input.user)) fail("請選擇有效的付款人。");
  let splitType = input.splitType;
  let payer = input.user;
  if (item.includes("充電")) splitType = "month_mileage";
  else if (/車貸|保險/.test(item)) splitType = "23_13";
  else if (item.includes("ETC")) {
    if (!["Terence", "Ken"].includes(splitType)) fail("請選擇 ETC 費用歸屬。");
    payer = "Ken";
  } else if (!["month_mileage", "23_13", "50_50"].includes(splitType)) fail("一般費用請選擇里程比例、2:1 或各半。");
  if (original && original.item === item && original.amount === input.amount
    && (original.user || original.payer) === payer && historicalSplit(original) === splitType) return copy(original);
  const s = month.snapshot;
  const ratio = s.mTkm + s.mKkm > 0 ? s.mKkm / (s.mTkm + s.mKkm) : 0.5;
  const fraction = { month_mileage: ratio, "23_13": 1 / 3, "50_50": 0.5, Terence: 0, Ken: 1 }[splitType];
  const rule = { month_mileage: `本月里程比例，Ken ${(ratio * 100).toFixed(1)}%`, "23_13": "Terence 2/3、Ken 1/3", "50_50": "雙方各一半", Terence: "全部由 Terence 負擔", Ken: "全部由 Ken 負擔" }[splitType];
  return {
    ...(original || {}), id: original?.id || input.id, item, amount: input.amount,
    user: payer, payer, splitType, kenShare: Math.round(input.amount * fraction), rule,
    createdAt: original?.createdAt || now, createdBy: original?.createdBy || actor.uid,
    updatedAt: original ? now : null
  };
}

export function changeList(before, after) {
  const old = new Map(before.map((e) => [e.id, e]));
  const next = new Map(after.map((e) => [e.id, e]));
  return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
    const previous = old.get(id) || null;
    const current = next.get(id) || null;
    return fingerprint(previous) === fingerprint(current) ? [] : [{ id, before: previous, after: current }];
  });
}

export function settlementText(netFlow) {
  const value = Math.round(Math.abs(netFlow));
  if (!value) return "雙方帳目平衡";
  return `${netFlow > 0 ? "Ken 應付給 Terence" : "Terence 應付給 Ken"} $${value.toLocaleString("zh-TW")}`;
}

export function buildCorrection(base, expenses, reason, actor, now, correctionId) {
  if (actor?.role !== "admin" || !actor.uid) fail("只有管理員可以更正歷史帳本。");
  if (!reason.trim() || reason.trim().length > 200) fail("請填寫 1 至 200 字的更正原因。");
  const prepared = prepareMonth(base);
  const changes = changeList(prepared.snapshot.expenses, expenses);
  if (!changes.length) fail("尚未變更任何費用。");
  if (new Set(expenses.map((e) => e.id)).size !== expenses.length || expenses.some((e) => !e.id)) fail("費用 ID 無效或重複。");
  for (const change of changes) {
    if ((change.before && isTyre(change.before)) || (change.after && isTyre(change.after))) fail("輪胎紀錄在本版保持唯讀。");
    if (change.after) {
      const expected = makeExpense(change.after, prepared, change.before, actor, change.after.updatedAt || change.after.createdAt);
      for (const key of ["item", "amount", "user", "payer", "splitType", "kenShare", "rule"]) {
        if (expected[key] !== change.after[key]) fail(`「${change.after.item}」計算不一致，請重新編輯該筆費用。`);
      }
    }
  }
  const before = summarize(prepared.snapshot.expenses);
  const after = summarize(expenses);
  prepared.snapshot = { ...prepared.snapshot, ...after, finalActionStr: settlementText(after.netFlow), expenses: copy(expenses) };
  prepared.correctionVersion += 1;
  prepared.corrections = [...(prepared.corrections || []), {
    id: correctionId, version: prepared.correctionVersion, createdAt: now,
    createdBy: actor.uid, actorName: actor.name || actor.uid, reason: reason.trim(),
    before, after, changes: copy(changes)
  }];
  auditMonth(prepared);
  return prepared;
}

export function applyCorrection(database, key, expectedFingerprint, corrected, actor) {
  if (actor?.role !== "admin") fail("只有管理員可以更正歷史帳本。");
  const matches = database.historyMonths.filter((month) => monthKey(month) === key);
  if (matches.length !== 1 || fingerprint(matches[0]) !== expectedFingerprint) fail("這個月份已被更新或還原。草稿已保留，請重新載入最新月份後比較。");
  // Replace the target only; live current records and later months come from the transaction.
  database.historyMonths[database.historyMonths.indexOf(matches[0])] = copy(corrected);
}

// Firestore map/array/string/number storage calculation, with reserved document metadata.
// https://firebase.google.com/docs/firestore/storage-size
export function estimatedDocumentBytes(value) {
  const size = (item) => {
    if (item === null || typeof item === "boolean") return 1;
    if (typeof item === "number") return 8;
    if (typeof item === "string") return new TextEncoder().encode(item).length + 1;
    if (Array.isArray(item)) return item.reduce((sum, child) => sum + size(child), 0);
    if (item && typeof item === "object") return 32 + Object.entries(item).reduce((sum, [key, child]) => sum + size(key) + size(child), 0);
    fail("帳本包含無法儲存的欄位。");
  };
  return size(value) + 4096;
}

export function assertDocumentSize(database) {
  if (estimatedDocumentBytes(database) > 1000000) fail("帳本已接近容量上限，這次更正尚未儲存。請先備份並整理儲存結構；草稿已保留。");
}
