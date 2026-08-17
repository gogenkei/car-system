import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { firebaseConfig, firestorePaths } from "./firebase-config.js";

const SCHEMA_VERSION = 3;
const USERS = ["Terence", "Ken"];
const ETC_ITEM = "🛣️ ETC";
const ITEM_LABELS = {
  "⚡ 充電": "充電",
  "🚗 車貸": "車貸",
  "🛡️ 保險": "保險",
  [ETC_ITEM]: "ETC",
  "🛣️ ETC-Terence": "ETC",
  "🛣️ ETC-Ken": "ETC",
  "🛞 輪胎": "輪胎"
};
const ETC_FORM_OWNERS = new Map([
  ["🛣️ ETC-Terence", "Terence"],
  ["🛣️ ETC-Ken", "Ken"]
]);
const SELECTABLE_SPLIT_TYPES = new Set(["month_mileage", "23_13", "50_50"]);
const ROUTES = new Set(["home", "add", "history", "settings"]);
const currencyFormatter = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0
});
const numberFormatter = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const dateTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
try {
  await setPersistence(auth, browserLocalPersistence);
} catch (error) {
  console.error("無法啟用持久登入，將使用瀏覽器可用的預設登入狀態。", error);
}
const db = getFirestore(firebaseApp);
const databaseRef = doc(db, ...firestorePaths.databaseDocument);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

const elements = {
  authGate: document.querySelector("#authGate"),
  gateMessage: document.querySelector("#gateMessage"),
  gateDetails: document.querySelector("#gateDetails"),
  googleSignInButton: document.querySelector("#googleSignInButton"),
  retryButton: document.querySelector("#retryButton"),
  appShell: document.querySelector("#appShell"),
  brandButton: document.querySelector(".brand-button"),
  mainContent: document.querySelector("#mainContent"),
  syncStatus: document.querySelector("#syncStatus"),
  syncStatusText: document.querySelector("#syncStatusText"),
  toastRegion: document.querySelector("#toastRegion"),
  accountInitial: document.querySelector("#accountInitial"),
  settingsAccountInitial: document.querySelector("#settingsAccountInitial"),
  settingsAccountName: document.querySelector("#settingsAccountName"),
  settingsAccountEmail: document.querySelector("#settingsAccountEmail"),
  settingsEyebrow: document.querySelector("#settingsEyebrow"),
  settingsTitle: document.querySelector("#settingsTitle"),
  mobileSettingsLabel: document.querySelector("#mobileSettingsLabel"),
  adminSection: document.querySelector("#adminSection"),
  balanceAction: document.querySelector("#balanceAction"),
  balanceAmount: document.querySelector("#balanceAmount"),
  balanceNote: document.querySelector("#balanceNote"),
  monthTotalKm: document.querySelector("#monthTotalKm"),
  monthMileageSplit: document.querySelector("#monthMileageSplit"),
  monthCharging: document.querySelector("#monthCharging"),
  monthOtherExpense: document.querySelector("#monthOtherExpense"),
  latestMileageSummary: document.querySelector("#latestMileageSummary"),
  lastMileageHelper: document.querySelector("#lastMileageHelper"),
  recentRecords: document.querySelector("#recentRecords"),
  monthRecords: document.querySelector("#monthRecords"),
  monthRecordsTitle: document.querySelector("#monthRecordsTitle"),
  monthRecordsDescription: document.querySelector("#monthRecordsDescription"),
  historyList: document.querySelector("#historyList"),
  mileageForm: document.querySelector("#mileageForm"),
  mileageFormTitle: document.querySelector("#mileageFormTitle"),
  mileageUser: document.querySelector("#mileageUser"),
  endMileage: document.querySelector("#endMileage"),
  mileageError: document.querySelector("#mileageError"),
  mileageSubmitButton: document.querySelector("#mileageSubmitButton"),
  cancelMileageEditButton: document.querySelector("#cancelMileageEditButton"),
  expenseForm: document.querySelector("#expenseForm"),
  expenseFormTitle: document.querySelector("#expenseFormTitle"),
  expenseItem: document.querySelector("#expenseItem"),
  customExpenseField: document.querySelector("#customExpenseField"),
  customExpenseItem: document.querySelector("#customExpenseItem"),
  customExpenseError: document.querySelector("#customExpenseError"),
  expenseAmount: document.querySelector("#expenseAmount"),
  expenseAmountError: document.querySelector("#expenseAmountError"),
  expensePayer: document.querySelector("#expensePayer"),
  expenseSplitType: document.querySelector("#expenseSplitType"),
  lockedSplitValue: document.querySelector("#lockedSplitValue"),
  splitHelper: document.querySelector("#splitHelper"),
  expenseSubmitButton: document.querySelector("#expenseSubmitButton"),
  cancelExpenseEditButton: document.querySelector("#cancelExpenseEditButton"),
  mileageTab: document.querySelector("#mileageTab"),
  expenseTab: document.querySelector("#expenseTab"),
  mileagePanel: document.querySelector("#mileagePanel"),
  expensePanel: document.querySelector("#expensePanel"),
  signOutButton: document.querySelector("#signOutButton"),
  closeMonthLabel: document.querySelector("#closeMonthLabel"),
  closeMonthButton: document.querySelector("#closeMonthButton"),
  downloadBackupButton: document.querySelector("#downloadBackupButton"),
  importBackupLabel: document.querySelector("#importBackupLabel"),
  importBackupFile: document.querySelector("#importBackupFile"),
  resetSystemButton: document.querySelector("#resetSystemButton"),
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmTitle: document.querySelector("#confirmTitle"),
  confirmMessage: document.querySelector("#confirmMessage"),
  confirmAcceptButton: document.querySelector("#confirmAcceptButton")
};

let currentUser = null;
let authorization = null;
let databaseState = createEmptyDatabase();
let calculatedState = calculateDatabase(databaseState);
let appReady = false;
let saving = false;
let unsubscribeSnapshot = null;
let editingMileageId = null;
let editingExpenseId = null;
let retryAction = null;

function createEmptyDatabase() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    systemState: {
      initialMileage: 0,
      historyTkm: 0,
      historyKkm: 0,
      tyreBaseTkm: 0,
      tyreBaseKkm: 0
    },
    mileageList: [],
    expenseList: [],
    historyMonths: []
  };
}

function safeNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function deterministicId(prefix, values) {
  const input = values.join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

function newId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function inferSplitType(expense) {
  if (expense.splitType) return expense.splitType;
  const rule = String(expense.rule || "");
  if (rule.includes("2/3")) return "23_13";
  if (rule.includes("50")) return "50_50";
  if (rule.includes("全歸 Terence")) return "Terence";
  if (rule.includes("全歸 Ken")) return "Ken";
  if (rule.includes("輪胎")) return "tire";
  return "month_mileage";
}

function normalizeMileage(entry, index) {
  const start = safeNumber(entry.start);
  const end = safeNumber(entry.end);
  return {
    id: entry.id || deterministicId("mileage", [entry.createdAt || "", entry.user || "", start, end, index]),
    user: USERS.includes(entry.user) ? entry.user : USERS[0],
    start,
    end,
    diff: safeNumber(entry.diff, Math.max(0, end - start)),
    createdAt: entry.createdAt || new Date(0).toISOString(),
    createdBy: String(entry.createdBy || ""),
    updatedAt: entry.updatedAt || null
  };
}

function normalizeExpense(entry, index) {
  const payer = entry.user || entry.payer;
  const rawItem = String(entry.item || "其他");
  const etcOwner = ETC_FORM_OWNERS.get(rawItem);
  return {
    id: entry.id || deterministicId("expense", [entry.createdAt || "", entry.item || "", entry.amount || 0, payer || "", index]),
    item: (etcOwner ? ETC_ITEM : rawItem).slice(0, 60),
    amount: Math.round(Math.max(0, safeNumber(entry.amount))),
    user: etcOwner ? "Ken" : (USERS.includes(payer) ? payer : USERS[0]),
    splitType: etcOwner || inferSplitType(entry),
    createdAt: entry.createdAt || new Date(0).toISOString(),
    createdBy: String(entry.createdBy || ""),
    updatedAt: entry.updatedAt || null
  };
}

function normalizeDatabase(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const system = source.systemState && typeof source.systemState === "object" ? source.systemState : {};
  const historyMonths = Array.isArray(source.historyMonths) ? source.historyMonths.filter(Boolean) : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(0, Math.round(safeNumber(source.revision))),
    systemState: {
      initialMileage: Math.max(0, safeNumber(system.initialMileage)),
      historyTkm: Math.max(0, safeNumber(system.historyTkm)),
      historyKkm: Math.max(0, safeNumber(system.historyKkm)),
      tyreBaseTkm: Math.max(0, safeNumber(system.tyreBaseTkm)),
      tyreBaseKkm: Math.max(0, safeNumber(system.tyreBaseKkm))
    },
    mileageList: (Array.isArray(source.mileageList) ? source.mileageList : []).map(normalizeMileage),
    expenseList: (Array.isArray(source.expenseList) ? source.expenseList : []).map(normalizeExpense),
    historyMonths
  };
}

function cloneDatabase(data) {
  return normalizeDatabase(structuredClone(data));
}

function splitRuleText(splitType, monthRatioK, tyreRatioK) {
  if (splitType === "50_50") return "雙方各一半";
  if (splitType === "23_13") return "Terence 2/3、Ken 1/3";
  if (splitType === "Terence") return "全部由 Terence 負擔";
  if (splitType === "Ken") return "全部由 Ken 負擔";
  if (splitType === "tire") return `輪胎使用比例，Ken ${(tyreRatioK * 100).toFixed(1)}%`;
  return `本月里程比例，Ken ${(monthRatioK * 100).toFixed(1)}%`;
}

function calculateKenShare(expense, monthRatioK, tyreRatioK) {
  const amount = safeNumber(expense.amount);
  if (expense.splitType === "50_50") return Math.round(amount * 0.5);
  if (expense.splitType === "23_13") return Math.round(amount / 3);
  if (expense.splitType === "Terence") return 0;
  if (expense.splitType === "Ken") return Math.round(amount);
  if (expense.splitType === "tire") return Math.round(amount * tyreRatioK);
  return Math.round(amount * monthRatioK);
}

function calculateDatabase(data) {
  let monthTkm = 0;
  let monthKkm = 0;
  for (const mileage of data.mileageList) {
    if (mileage.user === "Terence") monthTkm += safeNumber(mileage.diff);
    if (mileage.user === "Ken") monthKkm += safeNumber(mileage.diff);
  }

  const monthTotalKm = monthTkm + monthKkm;
  const monthRatioK = monthTotalKm > 0 ? monthKkm / monthTotalKm : 0.5;
  const allTkm = data.systemState.historyTkm + monthTkm;
  const allKkm = data.systemState.historyKkm + monthKkm;
  const tyreTkm = Math.max(0, allTkm - data.systemState.tyreBaseTkm);
  const tyreKkm = Math.max(0, allKkm - data.systemState.tyreBaseKkm);
  const tyreTotalKm = tyreTkm + tyreKkm;
  const tyreRatioK = tyreTotalKm > 0 ? tyreKkm / tyreTotalKm : 0.5;

  let totalExpense = 0;
  let totalCharging = 0;
  let terencePaid = 0;
  let kenPaid = 0;
  let kenResponsibility = 0;

  const detailedExpenses = data.expenseList.map((expense) => {
    const amount = safeNumber(expense.amount);
    const kenShare = calculateKenShare(expense, monthRatioK, tyreRatioK);
    totalExpense += amount;
    if (String(expense.item).includes("充電")) totalCharging += amount;
    if (expense.user === "Terence") terencePaid += amount;
    if (expense.user === "Ken") kenPaid += amount;
    kenResponsibility += kenShare;
    return {
      ...expense,
      kenShare,
      rule: splitRuleText(expense.splitType, monthRatioK, tyreRatioK)
    };
  });

  const netFlow = kenResponsibility - kenPaid;
  let finalAction = "雙方帳目平衡";
  let finalPayer = null;
  let finalReceiver = null;
  if (Math.round(netFlow) > 0) {
    finalPayer = "Ken";
    finalReceiver = "Terence";
    finalAction = "Ken 應付給 Terence";
  } else if (Math.round(netFlow) < 0) {
    finalPayer = "Terence";
    finalReceiver = "Ken";
    finalAction = "Terence 應付給 Ken";
  }

  return {
    monthTkm,
    monthKkm,
    monthTotalKm,
    monthRatioK,
    allTkm,
    allKkm,
    tyreTkm,
    tyreKkm,
    tyreRatioK,
    totalExpense,
    totalCharging,
    totalOtherExpense: totalExpense - totalCharging,
    terencePaid,
    kenPaid,
    kenResponsibility,
    netFlow,
    finalAction,
    finalPayer,
    finalReceiver,
    finalAmount: Math.round(Math.abs(netFlow)),
    detailedExpenses
  };
}

function displayItemName(item) {
  if (ITEM_LABELS[item]) return ITEM_LABELS[item];
  return String(item || "其他").replace(/^[^\p{L}\p{N}]+/u, "").trim() || "其他";
}

function formatCurrency(value) {
  return currencyFormatter.format(Math.round(safeNumber(value)));
}

function formatNumber(value) {
  return numberFormatter.format(Math.round(safeNumber(value)));
}

function formatDateTime(value) {
  if (!value) return "未記錄時間";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormatter.format(date);
}

function latestMileage(data = databaseState) {
  const latest = data.mileageList.at(-1);
  return latest ? safeNumber(latest.end) : safeNumber(data.systemState.initialMileage);
}

function setSyncStatus(state, message) {
  elements.syncStatus.dataset.state = state;
  elements.syncStatusText.textContent = message;
}

function updateWriteControls() {
  const disabled = !appReady || saving;
  document.querySelectorAll("[data-write-controls]").forEach((fieldset) => {
    fieldset.disabled = disabled;
  });
  document.querySelectorAll("[data-write-button]").forEach((button) => {
    button.disabled = disabled;
  });
}

function setWritable(ready, message = null) {
  appReady = Boolean(ready);
  updateWriteControls();
  if (message) setSyncStatus(appReady ? "ready" : "error", message);
}

function setSaving(isSaving, message = "儲存中") {
  saving = isSaving;
  updateWriteControls();
  if (isSaving) setSyncStatus("saving", message);
}

function showGate(message, options = {}) {
  const { details = "", signIn = false, retryLabel = "重新連線", onRetry = null } = options;
  elements.authGate.hidden = false;
  elements.appShell.hidden = true;
  elements.gateMessage.textContent = message;
  elements.gateDetails.hidden = !details;
  elements.gateDetails.textContent = details;
  elements.googleSignInButton.hidden = !signIn;
  elements.retryButton.hidden = !onRetry;
  elements.retryButton.textContent = retryLabel;
  retryAction = onRetry;
}

function showApp() {
  elements.authGate.hidden = true;
  elements.appShell.hidden = false;
}

function showToast(message, duration = 3200) {
  elements.toastRegion.replaceChildren();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), duration);
}

function showFieldError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function clearFormErrors() {
  [elements.mileageError, elements.customExpenseError, elements.expenseAmountError].forEach((element) => {
    showFieldError(element, "");
  });
}

function emptyState(title, description) {
  const container = document.createElement("div");
  container.className = "empty-state";
  const strong = document.createElement("strong");
  const span = document.createElement("span");
  strong.textContent = title;
  span.textContent = description;
  container.append(strong, span);
  return container;
}

function isAdmin() {
  return authorization?.role === "admin";
}

function isOwnedRecord(record) {
  return Boolean(currentUser?.uid) && record?.data?.createdBy === currentUser.uid;
}

function canEditRecord(record) {
  return isAdmin() || isOwnedRecord(record);
}

function recordCard(record, options = {}) {
  const { compact = false, editable = true, deletable = isAdmin() } = options;
  const card = document.createElement("article");
  card.className = "record-card";
  const main = document.createElement("div");
  main.className = "record-main";
  const title = document.createElement("span");
  title.className = "record-title";
  const meta = document.createElement("span");
  meta.className = "record-meta";
  const detail = document.createElement("span");
  detail.className = "record-detail";
  const value = document.createElement("span");
  value.className = "record-value";

  if (record.kind === "mileage") {
    title.textContent = `${record.data.user} 的里程`;
    meta.textContent = `${formatNumber(record.data.start)} → ${formatNumber(record.data.end)} km`;
    detail.textContent = formatDateTime(record.data.createdAt);
    value.textContent = `+${formatNumber(record.data.diff)} km`;
  } else {
    const detailData = calculatedState.detailedExpenses.find((entry) => entry.id === record.data.id);
    title.textContent = displayItemName(record.data.item);
    meta.textContent = `${record.data.user} 先付`;
    detail.textContent = detailData?.rule || splitRuleText(record.data.splitType, calculatedState.monthRatioK, calculatedState.tyreRatioK);
    value.textContent = formatCurrency(record.data.amount);
  }

  main.append(title, meta);
  if (!compact) main.append(detail);
  card.append(main, value);

  if (editable && !compact) {
    const actions = document.createElement("div");
    actions.className = "record-actions";
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "修改";
    editButton.dataset.action = record.kind === "mileage" ? "edit-mileage" : "edit-expense";
    editButton.dataset.id = record.data.id;
    actions.append(editButton);
    if (deletable) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "刪除";
      deleteButton.className = "delete-record";
      deleteButton.dataset.action = record.kind === "mileage" ? "delete-mileage" : "delete-expense";
      deleteButton.dataset.id = record.data.id;
      actions.append(deleteButton);
    }
    card.append(actions);
  }
  return card;
}

function combinedRecords() {
  return [
    ...databaseState.mileageList.map((data) => ({ kind: "mileage", data })),
    ...databaseState.expenseList.map((data) => ({ kind: "expense", data }))
  ].sort((left, right) => String(right.data.createdAt).localeCompare(String(left.data.createdAt)));
}

function renderHome() {
  calculatedState = calculateDatabase(databaseState);
  elements.balanceAction.textContent = calculatedState.finalAction;
  elements.balanceAmount.textContent = formatCurrency(calculatedState.finalAmount);
  elements.balanceNote.textContent = calculatedState.finalAmount === 0
    ? "目前雙方不需要互相匯款"
    : `依 ${databaseState.expenseList.length} 筆費用計算`;
  elements.monthTotalKm.textContent = `${formatNumber(calculatedState.monthTotalKm)} km`;
  elements.monthMileageSplit.textContent = `Terence ${formatNumber(calculatedState.monthTkm)} / Ken ${formatNumber(calculatedState.monthKkm)}`;
  elements.monthCharging.textContent = formatCurrency(calculatedState.totalCharging);
  elements.monthOtherExpense.textContent = formatCurrency(calculatedState.totalOtherExpense);
  const latest = latestMileage();
  elements.latestMileageSummary.textContent = `目前儀表 ${formatNumber(latest)} km`;
  elements.lastMileageHelper.textContent = `${formatNumber(latest)} km`;

  elements.recentRecords.replaceChildren();
  const recent = combinedRecords().slice(0, 5);
  if (!recent.length) {
    elements.recentRecords.append(emptyState("本月還沒有紀錄", "新增第一筆里程或費用後會顯示在這裡。"));
  } else {
    recent.forEach((record) => elements.recentRecords.append(recordCard(record, { compact: true, editable: false })));
  }
}

function renderMonthRecords() {
  elements.monthRecords.replaceChildren();
  const records = isAdmin()
    ? combinedRecords()
    : combinedRecords().filter(isOwnedRecord);
  elements.monthRecordsTitle.textContent = isAdmin() ? "本月全部紀錄" : "你新增的紀錄";
  elements.monthRecordsDescription.textContent = isAdmin()
    ? "使用可見按鈕修改或刪除，不需要滑動手勢。"
    : "可以修改自己本月新增的紀錄；刪除與結算由 Terence 處理。";
  if (!records.length) {
    elements.monthRecords.append(emptyState(
      isAdmin() ? "本月還沒有紀錄" : "你還沒有新增紀錄",
      "使用上方表單新增里程或費用。"
    ));
    return;
  }
  records.forEach((record) => elements.monthRecords.append(recordCard(record, {
    editable: canEditRecord(record),
    deletable: isAdmin()
  })));
}

function snapshotValue(snapshot, key, fallback = 0) {
  return safeNumber(snapshot?.[key], fallback);
}

function renderHistory() {
  elements.historyList.replaceChildren();
  if (!databaseState.historyMonths.length) {
    elements.historyList.append(emptyState("還沒有已封存月份", "完成第一次月結後會顯示在這裡。"));
    return;
  }

  [...databaseState.historyMonths].reverse().forEach((month) => {
    const snapshot = month.snapshot || {};
    const card = document.createElement("details");
    card.className = "history-card";
    const summary = document.createElement("summary");
    const summaryGrid = document.createElement("div");
    summaryGrid.className = "history-summary";
    const text = document.createElement("div");
    const title = document.createElement("strong");
    const result = document.createElement("span");
    const amount = document.createElement("div");
    amount.className = "history-amount";
    title.textContent = month.label || "未命名月份";
    result.textContent = snapshot.finalActionStr || "查看結算內容";
    amount.textContent = formatCurrency(Math.abs(snapshotValue(snapshot, "netFlow")));
    text.append(title, result);
    summaryGrid.append(text, amount);
    summary.append(summaryGrid);

    const detail = document.createElement("div");
    detail.className = "history-detail";
    const values = [
      ["Terence 里程", `${formatNumber(snapshotValue(snapshot, "mTkm"))} km`],
      ["Ken 里程", `${formatNumber(snapshotValue(snapshot, "mKkm"))} km`],
      ["Terence 先付", formatCurrency(snapshotValue(snapshot, "tPaid"))],
      ["Ken 先付", formatCurrency(snapshotValue(snapshot, "kPaid"))]
    ];
    values.forEach(([label, value]) => {
      const item = document.createElement("div");
      const itemLabel = document.createElement("span");
      const itemValue = document.createElement("strong");
      itemLabel.textContent = label;
      itemValue.textContent = value;
      item.append(itemLabel, itemValue);
      detail.append(item);
    });
    card.append(summary, detail);
    elements.historyList.append(card);
  });
}

function renderAccount() {
  const name = currentUser?.displayName || currentUser?.email || "使用者";
  const initial = name.trim().charAt(0).toUpperCase() || "U";
  elements.accountInitial.textContent = initial;
  elements.settingsAccountInitial.textContent = initial;
  elements.settingsAccountName.textContent = name;
  elements.settingsAccountEmail.textContent = currentUser?.email || "";
  const admin = isAdmin();
  elements.appShell.dataset.role = admin ? "admin" : "member";
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = !admin;
  });
  elements.importBackupLabel.hidden = !admin;
  elements.importBackupFile.disabled = !admin;
  elements.brandButton.dataset.route = admin ? "home" : "add";
  elements.brandButton.href = admin ? "#home" : "#add";
  elements.brandButton.setAttribute("aria-label", admin ? "回到本月總覽" : "回到新增紀錄");
  elements.settingsEyebrow.textContent = admin ? "帳本管理" : "登入資訊";
  elements.settingsTitle.textContent = admin ? "設定與備份" : "帳號";
  elements.mobileSettingsLabel.textContent = admin ? "設定" : "帳號";

  const memberName = USERS.includes(authorization?.name) ? authorization.name : "Ken";
  if (!admin) {
    elements.mileageUser.value = memberName;
    elements.expensePayer.value = memberName;
  }
  elements.mileageUser.disabled = !admin;
  elements.expensePayer.disabled = !admin;
  configureExpenseSplit();
}

function renderAll() {
  renderHome();
  renderMonthRecords();
  renderHistory();
  renderAccount();
}

function setAddTab(tabName, focus = false) {
  const mileageSelected = tabName !== "expense";
  elements.mileageTab.setAttribute("aria-selected", String(mileageSelected));
  elements.expenseTab.setAttribute("aria-selected", String(!mileageSelected));
  elements.mileageTab.tabIndex = mileageSelected ? 0 : -1;
  elements.expenseTab.tabIndex = mileageSelected ? -1 : 0;
  elements.mileagePanel.hidden = !mileageSelected;
  elements.expensePanel.hidden = mileageSelected;
  if (focus) (mileageSelected ? elements.endMileage : elements.expenseAmount).focus();
}

function currentRoute() {
  const route = location.hash.replace(/^#\/?/, "");
  return ROUTES.has(route) ? route : "home";
}

function navigate(route, options = {}) {
  const { focusMain = true, addTab = null } = options;
  const allowedRoutes = isAdmin() ? ROUTES : new Set(["add", "settings"]);
  const defaultRoute = isAdmin() ? "home" : "add";
  const safeRoute = allowedRoutes.has(route) ? route : defaultRoute;
  document.querySelectorAll("[data-view]").forEach((view) => {
    view.hidden = view.dataset.view !== safeRoute;
  });
  document.querySelectorAll("[data-route]").forEach((button) => {
    if (button.closest("nav")) {
      if (button.dataset.route === safeRoute) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });
  if (location.hash !== `#${safeRoute}`) history.replaceState(null, "", `#${safeRoute}`);
  if (safeRoute === "add" && addTab) setAddTab(addTab);
  if (focusMain) {
    elements.mainContent.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function assertWritable() {
  if (!appReady) throw new Error("尚未取得 Firebase 最新資料，目前禁止寫入。");
  if (saving) throw new Error("上一筆資料仍在儲存中，請稍候。");
  if (!currentUser || !authorization?.active) throw new Error("目前帳號沒有寫入權限。");
}

async function mutateDatabase(operationName, mutator) {
  assertWritable();
  setSaving(true, operationName);
  try {
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(databaseRef);
      if (!snapshot.exists()) throw new Error("雲端帳本不存在，已停止寫入以避免覆蓋資料。");
      const current = normalizeDatabase(snapshot.data());
      const next = cloneDatabase(current);
      mutator(next, current);
      next.schemaVersion = SCHEMA_VERSION;
      next.revision = current.revision + 1;
      transaction.set(databaseRef, { ...next, updatedAt: serverTimestamp(), updatedBy: currentUser.uid });
    });
    showToast(`${operationName}完成`);
  } catch (error) {
    console.error(error);
    showToast(error.message || `${operationName}失敗，請重試。`, 5200);
    throw error;
  } finally {
    saving = false;
    setWritable(appReady, appReady ? "已同步" : "等待重新同步");
  }
}

async function requestConfirmation(title, message, confirmLabel = "確認") {
  if (!elements.confirmDialog.showModal) return globalThis.confirm(message);
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmAcceptButton.textContent = confirmLabel;
  elements.confirmDialog.showModal();
  return new Promise((resolve) => {
    elements.confirmDialog.addEventListener("close", () => {
      resolve(elements.confirmDialog.returnValue === "confirm");
    }, { once: true });
  });
}

async function handleMileageSubmit(event) {
  event.preventDefault();
  clearFormErrors();
  const end = Math.round(safeNumber(elements.endMileage.value, NaN));
  const user = elements.mileageUser.value;
  const existing = editingMileageId
    ? databaseState.mileageList.find((mileage) => mileage.id === editingMileageId)
    : null;
  if (!Number.isFinite(end)) {
    showFieldError(elements.mileageError, "請輸入目前儀表上的總里程。");
    elements.endMileage.focus();
    return;
  }
  if (editingMileageId && !existing) {
    showFieldError(elements.mileageError, "這筆里程已不存在，請重新整理後再試一次。");
    return;
  }

  const localIndex = existing ? databaseState.mileageList.findIndex((entry) => entry.id === existing.id) : -1;
  const previousEnd = localIndex > 0
    ? databaseState.mileageList[localIndex - 1].end
    : databaseState.systemState.initialMileage;
  const nextEnd = localIndex >= 0 ? databaseState.mileageList[localIndex + 1]?.end : null;
  const minimum = editingMileageId ? previousEnd : latestMileage();
  if (end <= minimum || (nextEnd != null && end >= nextEnd)) {
    const range = nextEnd == null
      ? `大於 ${formatNumber(minimum)} km`
      : `介於 ${formatNumber(minimum)} 與 ${formatNumber(nextEnd)} km 之間`;
    showFieldError(elements.mileageError, `總里程必須${range}。`);
    elements.endMileage.focus();
    return;
  }

  const record = {
    id: editingMileageId || newId("mileage"),
    user,
    end,
    createdAt: existing?.createdAt || new Date().toISOString(),
    createdBy: existing?.createdBy || currentUser.uid,
    updatedAt: editingMileageId ? new Date().toISOString() : null
  };
  const operation = editingMileageId ? "更新里程" : "儲存里程";
  try {
    await mutateDatabase(operation, (next) => {
      if (editingMileageId) {
        const index = next.mileageList.findIndex((entry) => entry.id === record.id);
        if (index < 0) throw new Error("這筆里程已被另一位使用者移除，無法更新。");
        if (!isAdmin() && next.mileageList[index].createdBy !== currentUser.uid) {
          throw new Error("只能修改自己新增的紀錄。");
        }
        next.mileageList[index] = { ...next.mileageList[index], ...record };
        let rebuiltStart = next.systemState.initialMileage;
        next.mileageList = next.mileageList.map((entry) => {
          if (entry.end <= rebuiltStart) throw new Error("修改後的里程順序不合理，請重新確認儀表讀數。");
          const rebuilt = { ...entry, start: rebuiltStart, diff: entry.end - rebuiltStart };
          rebuiltStart = entry.end;
          return rebuilt;
        });
      } else {
        const start = latestMileage(next);
        if (record.end <= start) throw new Error(`另一位使用者已更新里程。請重新確認目前儀表是否大於 ${formatNumber(start)} km。`);
        next.mileageList.push({ ...record, start, diff: record.end - start });
      }
    });
    resetMileageForm();
    renderHome();
  } catch {
    elements.endMileage.focus();
  }
}

function resetMileageForm() {
  editingMileageId = null;
  elements.mileageForm.reset();
  if (!isAdmin()) elements.mileageUser.value = USERS.includes(authorization?.name) ? authorization.name : "Ken";
  elements.mileageFormTitle.textContent = "記錄儀表讀數";
  elements.mileageSubmitButton.textContent = "儲存里程";
  elements.cancelMileageEditButton.hidden = true;
  showFieldError(elements.mileageError, "");
}

function startMileageEdit(id) {
  const mileage = databaseState.mileageList.find((entry) => entry.id === id);
  const wrappedRecord = { kind: "mileage", data: mileage };
  if (!mileage || !canEditRecord(wrappedRecord)) {
    showToast("只能修改自己新增的紀錄。");
    return;
  }
  resetExpenseForm();
  editingMileageId = id;
  elements.mileageUser.value = mileage.user;
  elements.endMileage.value = mileage.end;
  elements.mileageFormTitle.textContent = "修改里程紀錄";
  elements.mileageSubmitButton.textContent = "儲存修改";
  elements.cancelMileageEditButton.hidden = false;
  navigate("add", { addTab: "mileage" });
  elements.endMileage.focus();
}

function showLockedExpenseSplit(value, helperText) {
  elements.expenseSplitType.hidden = true;
  elements.expenseSplitType.disabled = true;
  elements.lockedSplitValue.hidden = false;
  elements.lockedSplitValue.textContent = value;
  elements.splitHelper.textContent = helperText;
}

function showSelectableExpenseSplit() {
  elements.expenseSplitType.hidden = false;
  elements.expenseSplitType.disabled = false;
  elements.lockedSplitValue.hidden = true;
  if (!SELECTABLE_SPLIT_TYPES.has(elements.expenseSplitType.value)) {
    elements.expenseSplitType.value = "month_mileage";
  }
  elements.splitHelper.textContent = "請選擇這筆費用的分攤方式。";
}

function configureExpenseSplit() {
  const type = elements.expenseItem.value;
  const isCustom = type === "其他";
  const etcOwner = ETC_FORM_OWNERS.get(type);
  elements.customExpenseField.hidden = !isCustom;
  elements.expensePayer.disabled = !isAdmin();
  if (type === "⚡ 充電") {
    elements.expenseSplitType.value = "month_mileage";
    showLockedExpenseSplit("依本月里程比例", "充電固定依本月里程比例分攤。");
  } else if (type === "🚗 車貸" || type === "🛡️ 保險") {
    elements.expenseSplitType.value = "23_13";
    showLockedExpenseSplit("Terence 2/3、Ken 1/3", "車貸與保險固定由 Terence 負擔 2/3、Ken 負擔 1/3。");
  } else if (etcOwner) {
    elements.expensePayer.value = "Ken";
    elements.expensePayer.disabled = true;
    showLockedExpenseSplit(
      `由 ${etcOwner} 全額負擔`,
      `付款人固定為 Ken；這筆 ETC 由 ${etcOwner} 全額負擔。`
    );
  } else if (type === "🛞 輪胎") {
    showLockedExpenseSplit("依本期輪胎使用比例", "輪胎固定依本期輪胎使用比例分攤。");
  } else {
    showSelectableExpenseSplit();
  }
}

function selectedExpenseSplitType(type) {
  const etcOwner = ETC_FORM_OWNERS.get(type);
  if (etcOwner) return etcOwner;
  if (type === "⚡ 充電") return "month_mileage";
  if (type === "🚗 車貸" || type === "🛡️ 保險") return "23_13";
  if (type === "🛞 輪胎") return "tire";
  return SELECTABLE_SPLIT_TYPES.has(elements.expenseSplitType.value)
    ? elements.expenseSplitType.value
    : "month_mileage";
}

function resetExpenseForm() {
  editingExpenseId = null;
  elements.expenseForm.reset();
  elements.expenseItem.value = "⚡ 充電";
  elements.expenseFormTitle.textContent = "記錄一筆費用";
  elements.expenseSubmitButton.textContent = "儲存費用";
  elements.cancelExpenseEditButton.hidden = true;
  configureExpenseSplit();
  clearFormErrors();
}

async function handleExpenseSubmit(event) {
  event.preventDefault();
  clearFormErrors();
  const type = elements.expenseItem.value;
  const etcOwner = ETC_FORM_OWNERS.get(type);
  const item = etcOwner
    ? ETC_ITEM
    : (type === "其他" ? elements.customExpenseItem.value.trim() : type);
  const payer = etcOwner ? "Ken" : elements.expensePayer.value;
  const amount = Math.round(safeNumber(elements.expenseAmount.value, NaN));
  if (!item) {
    showFieldError(elements.customExpenseError, "請輸入項目名稱。");
    elements.customExpenseItem.focus();
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    showFieldError(elements.expenseAmountError, "請輸入大於 0 的整數金額。");
    elements.expenseAmount.focus();
    return;
  }

  const existing = editingExpenseId
    ? databaseState.expenseList.find((expense) => expense.id === editingExpenseId)
    : null;
  const record = {
    id: editingExpenseId || newId("expense"),
    item,
    amount,
    user: payer,
    splitType: selectedExpenseSplitType(type),
    createdAt: existing?.createdAt || new Date().toISOString(),
    createdBy: existing?.createdBy || currentUser.uid,
    updatedAt: editingExpenseId ? new Date().toISOString() : null
  };
  const operation = editingExpenseId ? "更新費用" : "儲存費用";
  try {
    await mutateDatabase(operation, (next) => {
      const index = next.expenseList.findIndex((expense) => expense.id === record.id);
      if (editingExpenseId) {
        if (index < 0) throw new Error("這筆費用已被另一位使用者刪除，無法更新。");
        if (!isAdmin() && next.expenseList[index].createdBy !== currentUser.uid) {
          throw new Error("只能修改自己新增的紀錄。");
        }
        next.expenseList[index] = record;
      } else {
        next.expenseList.push(record);
      }
    });
    resetExpenseForm();
  } catch {
    elements.expenseAmount.focus();
  }
}

function startExpenseEdit(id) {
  const expense = databaseState.expenseList.find((entry) => entry.id === id);
  const wrappedRecord = { kind: "expense", data: expense };
  if (!expense || !canEditRecord(wrappedRecord)) {
    showToast("只能修改自己新增的紀錄。");
    return;
  }
  resetMileageForm();
  editingExpenseId = id;
  const isEtcExpense = expense.item === ETC_ITEM || ETC_FORM_OWNERS.has(expense.item);
  const knownItem = isEtcExpense || Object.prototype.hasOwnProperty.call(ITEM_LABELS, expense.item);
  elements.expenseItem.value = isEtcExpense
    ? (expense.splitType === "Terence" ? "🛣️ ETC-Terence" : "🛣️ ETC-Ken")
    : (knownItem ? expense.item : "其他");
  if (!knownItem) elements.customExpenseItem.value = displayItemName(expense.item);
  elements.expenseAmount.value = expense.amount;
  elements.expensePayer.value = isEtcExpense ? "Ken" : expense.user;
  configureExpenseSplit();
  if (!elements.expenseSplitType.disabled && SELECTABLE_SPLIT_TYPES.has(expense.splitType)) {
    elements.expenseSplitType.value = expense.splitType;
  }
  elements.expenseFormTitle.textContent = "編輯費用";
  elements.expenseSubmitButton.textContent = "儲存修改";
  elements.cancelExpenseEditButton.hidden = false;
  navigate("add", { addTab: "expense" });
  elements.expenseAmount.focus();
}

async function deleteExpense(id) {
  if (!isAdmin()) return;
  const expense = databaseState.expenseList.find((entry) => entry.id === id);
  if (!expense) return;
  const confirmed = await requestConfirmation(
    "刪除這筆費用？",
    `${displayItemName(expense.item)} ${formatCurrency(expense.amount)} 將從本月帳目移除。`,
    "刪除費用"
  );
  if (!confirmed) return;
  await mutateDatabase("刪除費用", (next) => {
    const index = next.expenseList.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("這筆費用已不存在。");
    next.expenseList.splice(index, 1);
  });
  if (editingExpenseId === id) resetExpenseForm();
}

async function deleteMileage(id) {
  if (!isAdmin()) return;
  const mileage = databaseState.mileageList.find((entry) => entry.id === id);
  if (!mileage) return;
  const confirmed = await requestConfirmation(
    "刪除這筆里程？",
    `將刪除 ${mileage.user} 的 ${formatNumber(mileage.diff)} km。後續會保留原始儀表讀數並重新計算區間。`,
    "刪除里程"
  );
  if (!confirmed) return;
  await mutateDatabase("刪除里程", (next) => {
    const filtered = next.mileageList.filter((entry) => entry.id !== id);
    if (filtered.length === next.mileageList.length) throw new Error("這筆里程已不存在。");
    let previousEnd = next.systemState.initialMileage;
    next.mileageList = filtered.map((entry) => {
      if (entry.end <= previousEnd) {
        throw new Error("刪除後會產生不合理的里程順序，已停止操作。請先確認相鄰紀錄。");
      }
      const rebuilt = { ...entry, start: previousEnd, diff: entry.end - previousEnd };
      previousEnd = entry.end;
      return rebuilt;
    });
  });
}

function formatMonthLabel(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return "";
  return `${Number(match[1])}年${Number(match[2])}月`;
}

async function closeCurrentMonth() {
  if (!isAdmin()) return;
  const label = formatMonthLabel(elements.closeMonthLabel.value);
  if (!label) {
    showToast("請先選擇要結算的月份。");
    elements.closeMonthLabel.focus();
    return;
  }
  if (!databaseState.mileageList.length && !databaseState.expenseList.length) {
    showToast("本月沒有資料，不需要結算。");
    return;
  }
  const confirmed = await requestConfirmation(
    `結算 ${label}？`,
    "結算後本月紀錄會移至歷史，新的月份將從目前儀表里程繼續。",
    "結算並封存"
  );
  if (!confirmed) return;

  await mutateDatabase("結算本月", (next) => {
    if (next.historyMonths.some((month) => month.label === label)) throw new Error(`${label} 已經存在，請勿重複結算。`);
    if (!next.mileageList.length && !next.expenseList.length) throw new Error("本月資料已被另一位使用者結算。");
    const calculation = calculateDatabase(next);
    const currentLatest = latestMileage(next);
    const detailedExpenses = calculation.detailedExpenses.map((expense) => ({
      ...expense,
      payer: expense.user
    }));
    next.historyMonths.push({
      id: newId("month"),
      label,
      timestamp: Date.now(),
      snapshot: {
        mTkm: calculation.monthTkm,
        mKkm: calculation.monthKkm,
        allTkm: calculation.allTkm,
        allKkm: calculation.allKkm,
        tyreTkm: calculation.tyreTkm,
        tyreKkm: calculation.tyreKkm,
        tyreRatioK: calculation.tyreRatioK,
        tPaid: calculation.terencePaid,
        kPaid: calculation.kenPaid,
        totalCharging: calculation.totalCharging,
        totalOtherExpense: calculation.totalOtherExpense,
        totalExp: calculation.totalExpense,
        kResponsibility: calculation.kenResponsibility,
        netFlow: calculation.netFlow,
        finalActionStr: calculation.finalAmount === 0
          ? "雙方帳目平衡"
          : `${calculation.finalAction} ${formatCurrency(calculation.finalAmount)}`,
        mileages: structuredClone(next.mileageList),
        expenses: detailedExpenses
      }
    });
    next.systemState.historyTkm += calculation.monthTkm;
    next.systemState.historyKkm += calculation.monthKkm;
    next.systemState.initialMileage = currentLatest;
    if (next.expenseList.some((expense) => expense.splitType === "tire")) {
      next.systemState.tyreBaseTkm = next.systemState.historyTkm;
      next.systemState.tyreBaseKkm = next.systemState.historyKkm;
    }
    next.mileageList = [];
    next.expenseList = [];
  });
  navigate("history");
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBackup() {
  if (!isAdmin()) return;
  const date = new Date().toISOString().slice(0, 10);
  downloadJson(`車用里程計費備份-${date}.json`, {
    ...databaseState,
    exportedAt: new Date().toISOString(),
    exportedBy: currentUser?.email || currentUser?.uid || "unknown"
  });
  showToast("完整備份已下載");
}

async function importBackup(file) {
  if (authorization?.role !== "admin") {
    showToast("只有管理員可以還原備份。");
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    showToast("這個檔案不是有效的 JSON。");
    return;
  }
  if (!parsed?.systemState || !Array.isArray(parsed?.mileageList) || !Array.isArray(parsed?.expenseList) || !Array.isArray(parsed?.historyMonths)) {
    showToast("備份缺少必要欄位，已停止還原。");
    return;
  }
  const normalized = normalizeDatabase(parsed);
  const confirmed = await requestConfirmation(
    "用備份取代雲端帳本？",
    `將還原 ${normalized.historyMonths.length} 個歷史月份、${normalized.mileageList.length} 筆里程與 ${normalized.expenseList.length} 筆費用。`,
    "還原備份"
  );
  if (!confirmed) return;
  await mutateDatabase("還原備份", (next, current) => {
    Object.assign(next, normalized, { revision: current.revision });
  });
}

async function resetSystem() {
  if (authorization?.role !== "admin") return;
  const confirmed = await requestConfirmation(
    "重設整個雲端帳本？",
    "所有目前資料與歷史月份都會清除。請先確認 NAS 或手動備份已完成。",
    "永久重設"
  );
  if (!confirmed) return;
  await mutateDatabase("重設帳本", (next, current) => {
    Object.assign(next, createEmptyDatabase(), { revision: current.revision });
  });
  navigate("home");
}

async function initializeEmptyDatabase() {
  if (authorization?.role !== "admin") return;
  try {
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(databaseRef);
      if (snapshot.exists()) return;
      transaction.set(databaseRef, {
        ...createEmptyDatabase(),
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
      });
    });
    await loadDatabaseFromServer();
  } catch (error) {
    showGate("無法建立帳本。", { details: error.message, retryLabel: "再試一次", onRetry: initializeEmptyDatabase });
  }
}

function subscribeToDatabase() {
  if (unsubscribeSnapshot) unsubscribeSnapshot();
  unsubscribeSnapshot = onSnapshot(databaseRef, { includeMetadataChanges: true }, (snapshot) => {
    if (!snapshot.exists()) {
      setWritable(false, "帳本不存在");
      return;
    }
    if (snapshot.metadata.fromCache) {
      setWritable(false, "離線，只能查看");
      return;
    }
    databaseState = normalizeDatabase(snapshot.data());
    calculatedState = calculateDatabase(databaseState);
    renderAll();
    if (snapshot.metadata.hasPendingWrites) {
      setWritable(false, "等待雲端確認");
    } else {
      setWritable(true, "已同步");
    }
  }, (error) => {
    console.error(error);
    setWritable(false, "同步中斷");
    showToast("Firebase 同步中斷，為保護資料已停止輸入。", 5200);
  });
}

async function loadDatabaseFromServer() {
  showGate("正在取得 Firebase 最新資料…");
  setWritable(false);
  try {
    const snapshot = await getDocFromServer(databaseRef);
    if (!snapshot.exists()) {
      if (authorization?.role === "admin") {
        showGate("雲端尚未建立帳本。", {
          details: "這是一次性初始化，不會覆蓋已存在的資料。",
          retryLabel: "建立空白帳本",
          onRetry: initializeEmptyDatabase
        });
      } else {
        showGate("雲端帳本尚未建立。", { details: "請聯絡管理員完成初始化。" });
      }
      return;
    }
    databaseState = normalizeDatabase(snapshot.data());
    calculatedState = calculateDatabase(databaseState);
    showApp();
    renderAll();
    setWritable(true, "已同步");
    navigate(currentRoute(), { focusMain: false });
    subscribeToDatabase();
  } catch (error) {
    console.error(error);
    showGate("無法取得最新資料，已禁止輸入。", {
      details: "請檢查網路或 Firebase 權限後再試一次。現有雲端資料不會被覆蓋。",
      retryLabel: "重新連線",
      onRetry: loadDatabaseFromServer
    });
  }
}

async function authorizeAndLoad(user) {
  showGate("正在確認帳號權限…");
  try {
    const authorizationRef = doc(db, firestorePaths.authorizedUsersCollection, user.uid);
    const snapshot = await getDocFromServer(authorizationRef);
    if (!snapshot.exists() || snapshot.data().active !== true) {
      authorization = null;
      showGate("這個 Google 帳號尚未獲得使用權限。", {
        details: `請在 Firebase 建立 authorized_users/${user.uid}，並設定 active: true。`,
        signIn: true
      });
      return;
    }
    authorization = snapshot.data();
    await loadDatabaseFromServer();
  } catch (error) {
    console.error(error);
    showGate("無法確認使用權限。", {
      details: "請檢查網路與 Firestore Security Rules。",
      retryLabel: "重新檢查",
      onRetry: () => authorizeAndLoad(user)
    });
  }
}

async function handleGoogleSignIn() {
  elements.googleSignInButton.disabled = true;
  elements.gateMessage.textContent = "正在開啟 Google 登入…";
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"].includes(error.code)) {
      await signInWithRedirect(auth, googleProvider);
      return;
    }
    elements.gateMessage.textContent = error.code === "auth/popup-closed-by-user"
      ? "登入視窗已關閉，尚未登入。"
      : "Google 登入失敗，請再試一次。";
  } finally {
    elements.googleSignInButton.disabled = false;
  }
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) {
      event.preventDefault();
      navigate(routeButton.dataset.route, { addTab: routeButton.dataset.addTab || null });
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    try {
      if (actionButton.dataset.action === "edit-mileage") startMileageEdit(actionButton.dataset.id);
      if (actionButton.dataset.action === "edit-expense") startExpenseEdit(actionButton.dataset.id);
      if (actionButton.dataset.action === "delete-expense") await deleteExpense(actionButton.dataset.id);
      if (actionButton.dataset.action === "delete-mileage") await deleteMileage(actionButton.dataset.id);
    } catch {
      // mutateDatabase has already surfaced a user-facing error.
    }
  });
  window.addEventListener("hashchange", () => navigate(currentRoute(), { focusMain: false }));
  elements.googleSignInButton.addEventListener("click", handleGoogleSignIn);
  elements.retryButton.addEventListener("click", () => retryAction?.());
  elements.mileageTab.addEventListener("click", () => setAddTab("mileage", true));
  elements.expenseTab.addEventListener("click", () => setAddTab("expense", true));
  document.querySelector('[role="tablist"]').addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    setAddTab(event.key === "ArrowRight" ? "expense" : "mileage");
    (event.key === "ArrowRight" ? elements.expenseTab : elements.mileageTab).focus();
  });
  elements.mileageForm.addEventListener("submit", handleMileageSubmit);
  elements.cancelMileageEditButton.addEventListener("click", resetMileageForm);
  elements.expenseForm.addEventListener("submit", handleExpenseSubmit);
  elements.expenseItem.addEventListener("change", configureExpenseSplit);
  elements.expensePayer.addEventListener("change", configureExpenseSplit);
  elements.cancelExpenseEditButton.addEventListener("click", resetExpenseForm);
  elements.signOutButton.addEventListener("click", () => signOut(auth));
  elements.closeMonthButton.addEventListener("click", () => closeCurrentMonth().catch(() => {}));
  elements.downloadBackupButton.addEventListener("click", downloadBackup);
  elements.importBackupFile.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await importBackup(file).catch(() => {});
    event.target.value = "";
  });
  elements.resetSystemButton.addEventListener("click", () => resetSystem().catch(() => {}));
  window.addEventListener("beforeunload", (event) => {
    const hasDraft = elements.endMileage.value.trim()
      || elements.expenseAmount.value.trim()
      || elements.customExpenseItem.value.trim()
      || editingMileageId
      || editingExpenseId;
    if (!hasDraft) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function setDefaultMonth() {
  const now = new Date();
  elements.closeMonthLabel.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

bindEvents();
setDefaultMonth();
configureExpenseSplit();
showGate("正在確認登入狀態…");

const localPreview = location.hostname === "127.0.0.1"
  && new URLSearchParams(location.search).has("preview");

if (localPreview) {
  const previewRole = new URLSearchParams(location.search).get("role") === "member" ? "member" : "admin";
  const previewName = previewRole === "member" ? "Ken" : "Terence";
  currentUser = { uid: "local-preview", displayName: previewName, email: "preview@localhost" };
  authorization = { active: true, role: previewRole, name: previewName };
  databaseState = normalizeDatabase({
    ...createEmptyDatabase(),
    systemState: { ...createEmptyDatabase().systemState, initialMileage: 18240 },
    mileageList: [
      { id: "preview-mileage-1", user: "Terence", start: 18240, end: 18318, diff: 78, createdBy: "terence-preview", createdAt: "2026-08-16T09:20:00+08:00" },
      { id: "preview-mileage-2", user: "Ken", start: 18318, end: 18364, diff: 46, createdBy: "local-preview", createdAt: "2026-08-17T08:40:00+08:00" }
    ],
    expenseList: [
      { id: "preview-expense-1", item: "⚡ 充電", amount: 680, user: "Terence", splitType: "month_mileage", createdBy: "terence-preview", createdAt: "2026-08-17T09:10:00+08:00" },
      { id: "preview-expense-2", item: "🛣️ ETC", amount: 240, user: "Ken", splitType: "Ken", createdBy: "local-preview", createdAt: "2026-08-17T10:25:00+08:00" }
    ]
  });
  calculatedState = calculateDatabase(databaseState);
  showApp();
  renderAll();
  setWritable(true, "本機預覽");
  navigate(currentRoute(), { focusMain: false });
} else {
  onAuthStateChanged(auth, async (user) => {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
    currentUser = user;
    authorization = null;
    setWritable(false);
    if (!user) {
      showGate("使用 Google 帳號即可快速進入，不需要另外設定密碼。", { signIn: true });
      return;
    }
    await authorizeAndLoad(user);
  });
}
