import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || "track-car-spending";
const backupDirectory = process.env.CAR_BACKUP_DIR;
const documentPath = process.env.FIRESTORE_DOCUMENT_PATH || "car_sharing_system/v5_database_premium";

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error("缺少 GOOGLE_APPLICATION_CREDENTIALS，請指定 NAS 上的 Firebase service account JSON。");
}

if (!backupDirectory) {
  throw new Error("缺少 CAR_BACKUP_DIR，請指定 NAS 備份資料夾。");
}

initializeApp({
  credential: applicationDefault(),
  projectId
});

const firestore = getFirestore();
const snapshot = await firestore.doc(documentPath).get();

if (!snapshot.exists) {
  throw new Error(`Firestore 文件不存在：${documentPath}`);
}

const exportedAt = new Date();
const timestamp = exportedAt.toISOString().replaceAll(":", "-").replace(".", "-");
const payload = {
  ...snapshot.data(),
  backupMetadata: {
    exportedAt: exportedAt.toISOString(),
    projectId,
    documentPath,
    source: "synology-nas-scheduled-backup"
  }
};
const bodyWithoutChecksum = JSON.stringify(payload, null, 2);
const checksum = createHash("sha256").update(bodyWithoutChecksum).digest("hex");
const body = JSON.stringify({ ...payload, backupMetadata: { ...payload.backupMetadata, sha256: checksum } }, null, 2);

await mkdir(backupDirectory, { recursive: true });

const archiveName = `car-mileage-${timestamp}.json`;
const archivePath = path.join(backupDirectory, archiveName);
const latestPath = path.join(backupDirectory, "car-mileage-latest.json");
const temporaryArchivePath = `${archivePath}.tmp`;
const temporaryLatestPath = `${latestPath}.tmp`;

await writeFile(temporaryArchivePath, body, { encoding: "utf8", mode: 0o600 });
await rename(temporaryArchivePath, archivePath);
await writeFile(temporaryLatestPath, body, { encoding: "utf8", mode: 0o600 });
await rename(temporaryLatestPath, latestPath);

console.log(JSON.stringify({
  ok: true,
  archivePath,
  latestPath,
  exportedAt: exportedAt.toISOString(),
  revision: payload.revision ?? null,
  historyMonths: Array.isArray(payload.historyMonths) ? payload.historyMonths.length : null,
  checksum
}));
