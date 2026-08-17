# Synology NAS 自動備份

這個工具由 NAS 主動讀取 Firestore，建立帶時間戳的 JSON 與 `car-mileage-latest.json`。Service account 金鑰只放在 NAS，不可提交到 Git，也不可放在 Web Station 的 `web` 資料夾。

## 需求

- Node.js 22 或更新版本
- Firebase service account JSON
- NAS 上只有管理員可讀取的備份資料夾

Firebase Admin SDK 14 需要 Node.js 22。如果 NAS 套件沒有 Node.js 22，可在 Synology Container Manager 使用官方 Node.js 22 容器執行相同目錄。

## 安裝

1. 將 `nas-backup` 複製到 NAS，例如 `/volume1/docker/car-mileage-backup`。
2. 在該目錄執行 `npm install --omit=dev`。
3. 從 Firebase Console 建立專用 service account JSON。
4. 把金鑰存到 Web Station 根目錄之外，例如 `/volume1/secure/firebase/car-mileage-service-account.json`。
5. 複製 `run-backup.sh.example` 為 NAS 上的 `run-backup.sh`，再修改路徑。
6. 手動執行一次並確認產生 JSON。

## Synology 排程

在 DSM 開啟「控制台 > 工作排程器 > 新增 > 排程的工作 > 使用者定義的指令」：

- 使用者：建議建立只能讀取 service account 與寫入備份資料夾的專用本機使用者
- 排程：每天凌晨一次
- 指令：`/bin/sh /volume1/docker/car-mileage-backup/run-backup.sh`
- 啟用執行結果通知

工具不會自動刪除舊備份。建議再使用 Hyper Backup 備份整個 `car-mileage` 資料夾，保留策略由 DSM 管理。

## 安全提醒

- 不要把 service account JSON 放進本專案或 GitHub。
- 不要讓 Web Station 的 `http` 群組讀取金鑰。
- service account 建議只授予讀取這個 Firestore 專案所需的最小權限。
- 初次設定完成後，檢查備份檔的 `backupMetadata.sha256` 與排程通知。
