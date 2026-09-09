# 車用里程計費系統

兩位固定使用者共用的里程與支出即時對帳工具。前端可部署到 GitHub Pages，資料保存在 Cloud Firestore。

## 安全設計

- Google 一鍵登入，不需要另外記住密碼
- 登入狀態明確保存在同一台裝置與瀏覽器，除非主動登出或清除網站資料
- 只有 `authorized_users` 內啟用的兩個 UID 可讀寫
- `admin` 顯示完整管理介面；`member` 登入後直接進入新增頁
- `member` 可以修改自己本月新增的紀錄，但不能刪除、月結、還原或重設
- 首次從 Firebase 伺服器完成載入前，所有寫入控制都會停用
- 每次新增、修改、刪除與月結都使用 Firestore transaction
- 寫入失敗不會清空表單
- 雲端文件不存在時不會自動以全零資料覆蓋
- 管理員可更正歷史月份的一般費用；歷史里程與輪胎紀錄保持唯讀

歷史頁面可展開每個已封存月份，預覽完整的里程、費用與雙方結算月報；按「列印／儲存 PDF」後，可在系統列印視窗中選擇儲存為 PDF。

## 更正已結算帳本

1. 管理員開啟「歷史」，展開月份，按「更正費用」。
2. 新增費用或修改／刪除既有一般費用。表單的「加入草稿／更新草稿」只改草稿。
3. 填寫更正原因，按「預覽更正差額」，核對費用差異、雙方代付與新結算結果。
4. 按「確認儲存更正」。費用、結算與修改紀錄會在同一筆交易中儲存。

沿用既有分攤規則，里程比例使用所選歷史月份。未修改的舊費用保留原分攤金額（包含小數），不會整月重新套用新版公式。零里程月份以各半計算。輪胎費用及換胎基準不開放修改，也不能將一般費用改為輪胎。

更正差額不是未付款金額；系統不記錄實際轉帳，也不將差額轉入本月。更正後月報顯示版本與更正時間，實際付款由雙方另外確認。

若同一月份被其他裝置更新或還原，草稿保留，但不能覆蓋新帳。可展開查看最新明細、下載草稿，再以最新月份重新開始。草稿下載是比較／抄錄用途，不能作為完整帳本匯入。離線或儲存失敗也保留當次草稿；關閉頁面前請下載需要保留的草稿。

開啟更正前會核對歷史明細及已存在的合計欄位。不能確認的舊分攤規則、重複 ID 或不一致合計會明確阻止更正，不自動猜算。已知舊備份中的「使用比例（依 Numbers 原始公式）」缺少可重建的規則，需先核對原始帳目；不影響其他月份。

修改紀錄儲存在各月份的 `correctionVersion`、`corrections`，包含原因、操作者、時間、每筆前後內容及結算摘要；這些欄位會隨手動和 NAS 完整備份保存。舊月份／費用 ID 僅在該月第一次更正時補上，其餘月份不遷移。還原含修改紀錄的備份時會檢查版本與合計連續性。現有 Firestore rules 已限制 member 不能改 `historyMonths`，本次不變更規則；member 當期紀錄的逐筆歸屬限制另列後續工作。

每次歷史更正及備份匯入前檢查文件容量，超過保守安全門檻就阻止寫入並保留草稿。計算依據：[Firestore 儲存大小](https://firebase.google.com/docs/firestore/storage-size)。

### 開發驗證與預覽

```sh
python3 -m http.server 8765 --bind 127.0.0.1
node --test tests/history-corrections.test.mjs
# 可選：以本機修改前完整帳本執行 16 個月及 8 月保養回歸測試
LEDGER_TEST_BACKUP='帳本備份/2026-09-08_修改前完整帳本.json' node --test tests/history-corrections.test.mjs
# 需已安裝 playwright；可透過 NODE_PATH 指定外部套件位置
node tests/history-browser.cjs
```

瀏覽器測試攔截 Firebase SDK，使用隔離資料模擬同步、交易失敗及角色，不接觸正式 Firestore；不能取代線上 rules 驗證。預設使用 macOS Chrome，可設定 `CHROME_PATH`、`LEDGER_TEST_URL`。測試截圖放在 `output/history-corrections/`。

`http://127.0.0.1:8765/?preview=1#history` 可操作歷史費用更正，僅改記憶體示範資料，重新整理即還原。其他既有寫入操作仍不具正式資料寫入權限。

發布前需備份正式帳本、核對本機預覽；發布後以實際 admin／member 檢查更正、月報與權限。本次本機測試不代表已部署。

## Firebase 一次性設定

### 啟用 Google 登入

1. Firebase Console > Authentication > Sign-in method。
2. 啟用 Google。
3. Authentication > Settings > Authorized domains，加入 GitHub Pages 網域，例如 `帳號.github.io`。

### 建立兩位授權使用者

1. 先開啟網站並使用 Google 登入。
2. 未授權畫面會顯示目前 Firebase UID。
3. 在 Firestore 建立 `authorized_users/{UID}` 文件。
4. 第一位使用者設定：

```json
{
  "active": true,
  "role": "admin",
  "name": "Terence"
}
```

5. 第二位使用者設定：

```json
{
  "active": true,
  "role": "member",
  "name": "Ken"
}
```

### 部署 Firestore Rules

將 [firestore.rules](./firestore.rules) 貼到 Firebase Console > Firestore Database > Rules 並發佈。部署前先確認兩個 `authorized_users` 文件已建立，避免把自己鎖在資料庫外。

## GitHub Pages

必須提交本資料夾內的乾淨原始檔，不要再從 GitHub 網頁使用「另存新檔」取得 `index.html`。

主要檔案：

- `index.html`
- `styles.css`
- `app.js`
- `history-editor.mjs`
- `history-corrections.mjs`
- `firebase-config.js`
- `firestore.rules`

GitHub Repository > Settings > Pages，選擇要部署的 branch 與根目錄即可。

本機管理員預覽可用 `http://127.0.0.1:8765/?preview=1`；Ken 介面可用 `http://127.0.0.1:8765/?preview=1&role=member`。預覽只會在 `127.0.0.1` 啟用，使用內建示範資料且無法通過 Firestore 權限寫入正式資料。

## 舊備份

三份舊 JSON 仍保留在專案根目錄。新版匯入會接受舊格式並在 transaction 中正規化：

- `payer` 轉為 `user`
- `rule` 轉為 `splitType`
- 里程與費用補上穩定 ID
- 金額與里程轉為數值
- 新紀錄補上建立者 UID，資料格式升級為 `schemaVersion: 3`

還原備份只允許 `role: admin` 的使用者操作。

## NAS 自動備份

請參考 [nas-backup/README.md](./nas-backup/README.md)。Service account JSON 不得提交到 GitHub。

## 手機淺色介面

固定使用白底藍色；新增入口、里程表單、費用表單與本月紀錄分開。表單期間隱藏主導覽，欄位不自動聚焦，提供收起鍵盤按鈕及內嵌錯誤提示。歷史月報的畫面及 PDF 同步採用淺色配色。

新增路由為 `#add-mileage`、`#add-expense`、`#records`；原本 `#add` 為選擇類型入口。Ken 仍只可存取新增、自己的紀錄及帳號。

本機 `?preview=1` 的新增、修改及歷史更正均只改示範資料，重新整理即還原。正式網域始終使用 Firebase 登入與交易。

手機回歸測試：在本機伺服器啟動後，使用已安裝 Playwright 的 Node 執行 `tests/mobile-ui.cjs`。以 `LEDGER_TEST_URL` 指定本機網址；測試攔截 Firebase SDK 並使用模擬交易，涵蓋失敗保留、重複儲存、角色權限、各種寬度與月報 PDF。iPhone 主畫面捷徑與實體鍵盤需另行實機驗收。
