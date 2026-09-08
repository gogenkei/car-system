import { prepareMonth, fingerprint, monthKey, isTyre, historicalSplit, makeExpense, changeList, summarize, settlementText, buildCorrection, applyCorrection } from "./history-corrections.mjs";

export function createHistoryEditor(host) {
  const dialog = document.querySelector("#historyEditDialog");
  const form = document.querySelector("#historyExpenseForm");
  const list = document.querySelector("#historyExpenseList");
  const error = document.querySelector("#historyEditError");
  const preview = document.querySelector("#historyEditPreview");
  const reason = document.querySelector("#historyEditReason");
  const conflict = document.querySelector("#historyEditConflict");
  const save = document.querySelector("#historyEditSave");
  const byId = (id) => document.getElementById(id);
  const fields = form.elements;
  let draft = null;
  let editingId = null;
  let pending = false;
  let inputDirty = false;
  let reviewed = false;
  let returnFocus = null;
  const money = (value) => new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
  const text = (parent, tag, value, className = "") => {
    const el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    parent.append(el);
    return el;
  };
  const button = (parent, label, action) => {
    const el = text(parent, "button", label, "button button-secondary");
    el.type = "button";
    el.addEventListener("click", action);
    return el;
  };
  function showError(message) {
    error.textContent = message;
    if (message) error.focus();
  }
  function invalidate() {
    reviewed = false;
    preview.hidden = true;
    save.hidden = true;
    error.textContent = "";
  }
  function dirty() {
    return draft && (inputDirty || reason.value.trim() || changeList(draft.prepared.snapshot.expenses, draft.expenses).length);
  }
  function restoreFocus() {
    const target = returnFocus?.isConnected ? returnFocus : document.querySelector("#historyTitle");
    if (target) { if (target !== returnFocus) target.setAttribute("tabindex", "-1"); target.focus(); }
  }
  function configure() {
    const kind = fields.kind.value;
    byId("historyCustomField").hidden = kind !== "其他";
    fields.customItem.required = kind === "其他";
    fields.payer.disabled = kind.startsWith("ETC-");
    fields.split.disabled = kind !== "其他";
    byId("historySplitField").hidden = kind !== "其他";
    const explanations = {
      "⚡ 充電": "依這個歷史月份的里程比例分攤。",
      "🚗 車貸": "Terence 負擔 2/3，Ken 負擔 1/3。",
      "🛡️ 保險": "Terence 負擔 2/3，Ken 負擔 1/3。",
      "ETC-Terence": "由 Ken 先付，全部由 Terence 負擔。",
      "ETC-Ken": "由 Ken 先付，全部由 Ken 負擔。",
      "其他": "選擇這筆費用的分攤方式；零里程月份依各半計算。"
    };
    if (kind.startsWith("ETC-")) fields.payer.value = "Ken";
    byId("historyRuleHelp").textContent = explanations[kind];
  }
  function resetForm() {
    editingId = null;
    form.reset();
    fields.kind.value = "⚡ 充電";
    inputDirty = false;
    byId("historyExpenseFormTitle").textContent = "新增一筆費用";
    byId("historyExpenseStage").textContent = "加入草稿";
    byId("historyExpenseCancel").hidden = true;
    configure();
  }
  function describe(expense) {
    if (!expense) return "無";
    return `${expense.item} · ${money(expense.amount)} · ${expense.user || expense.payer} 先付 · ${expense.rule || historicalSplit(expense)} · Ken 分攤 ${money(expense.kenShare)}`;
  }
  function renderList() {
    list.replaceChildren();
    const changes = changeList(draft.prepared.snapshot.expenses, draft.expenses);
    byId("historyDraftCount").textContent = `${draft.expenses.length} 筆費用 · ${changes.length} 筆變更尚未儲存`;
    for (const expense of draft.expenses) {
      const row = text(list, "li", "", "correction-record");
      text(row, "p", describe(expense));
      const actions = text(row, "div", "", "correction-actions");
      if (isTyre(expense)) {
        text(actions, "span", "輪胎紀錄保持唯讀", "correction-note");
      } else {
        const editButton = button(actions, "修改", () => edit(expense.id));
        editButton.setAttribute("aria-label", `修改 ${expense.item} ${money(expense.amount)}`);
        const remove = button(actions, "從草稿刪除", async () => {
          if (pending) return;
          if (editingId === expense.id && inputDirty && !await host.confirm("捨棄這筆未加入草稿的輸入？", "刪除後仍可取消整份草稿，雲端帳本不會立即改變。")) return;
          draft.expenses = draft.expenses.filter((e) => e.id !== expense.id);
          if (editingId === expense.id) resetForm();
          invalidate(); renderList(); byId("historyDraftCount").focus();
        });
        remove.setAttribute("aria-label", `從草稿刪除 ${expense.item} ${money(expense.amount)}`);
      }
    }
    if (!draft.expenses.length) text(list, "li", "草稿已無費用。儲存後本月支出將為零。");
  }
  async function edit(id) {
    if (pending) return;
    if (inputDirty && !await host.confirm("捨棄尚未加入草稿的輸入？", "已加入草稿的變更仍會保留。")) return;
    const expense = draft.expenses.find((e) => e.id === id);
    if (!expense || isTyre(expense)) return;
    resetForm();
    editingId = id;
    const split = historicalSplit(expense);
    const kind = expense.item.includes("ETC") ? `ETC-${split === "Terence" ? "Terence" : "Ken"}`
      : expense.item.includes("充電") ? "⚡ 充電" : expense.item.includes("車貸") ? "🚗 車貸" : expense.item.includes("保險") ? "🛡️ 保險" : "其他";
    fields.kind.value = kind;
    fields.customItem.value = expense.item;
    fields.amount.value = expense.amount;
    fields.payer.value = expense.user || expense.payer;
    fields.split.value = ["month_mileage", "23_13", "50_50"].includes(split) ? split : "month_mileage";
    byId("historyExpenseFormTitle").textContent = `修改 ${expense.item}`;
    byId("historyExpenseStage").textContent = "更新草稿";
    byId("historyExpenseCancel").hidden = false;
    configure();
    fields.amount.focus();
  }
  function candidate() {
    if (inputDirty || editingId) throw new Error("請先將表單內容加入／更新草稿，或取消這筆編輯。");
    return buildCorrection(draft.base, draft.expenses, reason.value, host.actor(), new Date().toISOString(), draft.correctionId);
  }
  function renderPreview(next) {
    preview.replaceChildren();
    text(preview, "h3", "儲存前確認");
    const before = summarize(draft.prepared.snapshot.expenses);
    const after = summarize(next.snapshot.expenses);
    const metrics = text(preview, "dl", "", "correction-comparison");
    for (const [label, key] of [["總支出", "totalExp"], ["Terence 先付", "tPaid"], ["Ken 先付", "kPaid"], ["Ken 應分攤", "kResponsibility"]]) {
      text(metrics, "dt", label); text(metrics, "dd", `${money(before[key])} → ${money(after[key])}`);
    }
    text(preview, "p", `更正前：${settlementText(before.netFlow)}`);
    text(preview, "p", `更正後：${settlementText(after.netFlow)}`, "correction-total");
    // Compare rounded settlement balances, rather than rounding a raw floating-point delta.
    const balance = (net) => Math.sign(net) * Math.round(Math.abs(net));
    const delta = balance(after.netFlow) - balance(before.netFlow);
    text(preview, "p", `本次更正差額：${delta === 0 ? "無差額" : `${delta > 0 ? "Ken 對 Terence" : "Terence 對 Ken"} 的應付淨額增加 ${money(Math.abs(delta))}`}。實際付款由雙方另行確認。`);
    const entries = text(preview, "ul", "", "correction-changes");
    for (const change of changeList(draft.prepared.snapshot.expenses, draft.expenses)) {
      const li = text(entries, "li", "");
      text(li, "strong", change.before ? change.after ? "修改" : "刪除" : "新增");
      text(li, "p", `原：${describe(change.before)}`);
      text(li, "p", `新：${describe(change.after)}`);
    }
    preview.hidden = false;
    save.hidden = false;
    reviewed = true;
    preview.focus();
  }
  function latest() { return host.database().historyMonths.find((m) => monthKey(m) === draft?.key); }
  function refreshConflict() {
    if (!draft) return false;
    const current = latest();
    const changed = !current || fingerprint(current) !== draft.fingerprint;
    conflict.hidden = !changed;
    if (changed) {
      conflict.replaceChildren();
      text(conflict, "h3", "這個月份已有更新，草稿仍保留");
      text(conflict, "p", "請比較最新內容。下載草稿可保留目前變更；重新開始會捨棄這份草稿，改用最新月份。");
      if (current) {
        text(conflict, "p", `最新結算：${settlementText(summarize(current.snapshot.expenses).netFlow)}`);
        const details = text(conflict, "details", "");
        text(details, "summary", "查看最新費用明細");
        for (const expense of current.snapshot.expenses) text(details, "p", describe(expense));
      } else text(conflict, "p", "最新帳本已沒有這個月份。");
      button(conflict, "下載目前草稿", exportDraft);
      if (current) button(conflict, "以最新月份重新開始", async () => {
        if (await host.confirm("捨棄目前草稿並重新開始？", "請先下載需要保留的草稿。重新開始會使用最新月份的費用。")) {
          try { load(current); } catch (err) { showError(err.message); }
        }
      });
    }
    save.disabled = changed || pending || !host.writable();
    return changed;
  }
  function exportDraft() {
    host.download(`歷史費用更正草稿-${draft.base.label}.json`, {
      kind: "history-correction-draft", month: draft.base.label, base: draft.base,
      expenses: draft.expenses, reason: reason.value,
      unstaged: Object.fromEntries(new FormData(form)), editingId
    });
  }
  function renderAudit(month) {
    const audit = byId("historyCorrectionLog");
    audit.replaceChildren();
    for (const entry of [...(month.corrections || [])].reverse()) {
      const details = text(audit, "details", "");
      text(details, "summary", `第 ${entry.version} 次更正 · ${entry.actorName} · ${new Date(entry.createdAt).toLocaleString("zh-TW")}`);
      text(details, "p", entry.reason);
      text(details, "p", `${settlementText(entry.before.netFlow)} → ${settlementText(entry.after.netFlow)}`);
      for (const change of entry.changes) text(details, "p", `${describe(change.before)} → ${describe(change.after)}`);
    }
    if (!month.corrections?.length) text(audit, "p", "這個月份尚無更正紀錄。");
  }
  function load(month) {
    const prepared = prepareMonth(month);
    draft = { key: monthKey(month), base: structuredClone(month), prepared, fingerprint: fingerprint(month), expenses: structuredClone(prepared.snapshot.expenses), correctionId: host.newId() };
    reason.value = "";
    byId("historyEditTitle").textContent = `更正 ${month.label} 的費用`;
    conflict.hidden = true;
    resetForm(); invalidate(); renderList(); renderAudit(month);
    sync();
  }
  async function close() {
    if (pending) return;
    if (dirty() && !await host.confirm("捨棄這份更正草稿？", "尚未儲存的費用變更與輸入將捨棄，已結算帳本不會改變。")) return;
    draft = null; dialog.close(); restoreFocus();
  }
  function sync() {
    if (!draft) return;
    if (host.actor()?.role !== "admin") { draft = null; dialog.close(); return; }
    try { refreshConflict(); } catch (err) { save.disabled = true; showError(err.message); }
    byId("historyWriteState").textContent = pending ? "正在儲存，請稍候…" : host.writable() ? "" : "目前無法寫入雲端；可繼續整理草稿，連線恢復後再儲存。";
  }
  form.addEventListener("input", () => { inputDirty = true; invalidate(); });
  form.addEventListener("change", () => { inputDirty = true; invalidate(); configure(); });
  reason.addEventListener("input", invalidate);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!draft || pending) return;
    try {
      const kind = fields.kind.value;
      const item = kind === "其他" ? fields.customItem.value : kind.startsWith("ETC-") ? "🛣️ ETC" : kind;
      const splitType = kind.startsWith("ETC-") ? kind.slice(4) : fields.split.value;
      const old = draft.expenses.find((e) => e.id === editingId);
      const expense = makeExpense({ id: host.newId(), item, amount: Number(fields.amount.value), user: fields.payer.value, splitType }, draft.prepared, old, host.actor(), new Date().toISOString());
      if (editingId) draft.expenses[draft.expenses.findIndex((e) => e.id === editingId)] = expense;
      else draft.expenses.push(expense);
      resetForm(); invalidate(); renderList(); byId("historyDraftCount").focus();
    } catch (err) { showError(err.message); }
  });
  byId("historyExpenseCancel").addEventListener("click", () => { resetForm(); invalidate(); });
  byId("historyEditReview").addEventListener("click", () => {
    try { renderPreview(candidate()); refreshConflict(); } catch (err) { showError(err.message); }
  });
  save.addEventListener("click", async () => {
    if (!draft || pending || !reviewed) return;
    try {
      if (!host.writable()) throw new Error("尚未連上雲端，草稿已保留。");
      if (refreshConflict()) throw new Error("月份已更新，請先比較最新內容。");
      const corrected = candidate();
      pending = true;
      byId("historyEditorControls").disabled = true;
      byId("historyEditClose").disabled = true;
      sync();
      await host.commit((database) => applyCorrection(database, draft.key, draft.fingerprint, corrected, host.actor()));
      draft = null; dialog.close(); restoreFocus();
    } catch (err) { showError(err.message); }
    finally {
      pending = false;
      byId("historyEditorControls").disabled = false;
      byId("historyEditClose").disabled = false;
      sync();
    }
  });
  byId("historyEditClose").addEventListener("click", close);
  byId("historyDraftDownload").addEventListener("click", exportDraft);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  return {
    open(key) {
      if (host.actor()?.role !== "admin") return;
      const matches = host.database().historyMonths.filter((m) => monthKey(m) === key);
      if (matches.length !== 1) { host.toast("月份識別不唯一，請先核對帳目。"); return; }
      try {
        load(matches[0]); returnFocus = document.activeElement;
        dialog.showModal(); byId("historyEditTitle").focus();
      } catch (err) { draft = null; host.toast(err.message, 8000); }
    }, sync, hasDraft: () => Boolean(dirty())
  };
}
