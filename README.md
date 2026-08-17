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
- 歷史月份在 UI 中保持唯讀，避免累計資料被局部刪除

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
