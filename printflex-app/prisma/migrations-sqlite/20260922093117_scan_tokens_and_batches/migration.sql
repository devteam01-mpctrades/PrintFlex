-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "scanSecret" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DocumentJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT,
    "documentTypesJson" TEXT NOT NULL,
    "orderIdsJson" TEXT NOT NULL,
    "optionsJson" TEXT NOT NULL DEFAULT '{}',
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "outputPath" TEXT,
    "pickListPath" TEXT,
    "outputBytes" INTEGER,
    "deadlineAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DocumentJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DocumentJob" ("createdAt", "deadlineAt", "documentTypesJson", "error", "finishedAt", "id", "name", "orderIdsJson", "outputPath", "progress", "shopId", "startedAt", "state", "total", "updatedAt") SELECT "createdAt", "deadlineAt", "documentTypesJson", "error", "finishedAt", "id", "name", "orderIdsJson", "outputPath", "progress", "shopId", "startedAt", "state", "total", "updatedAt" FROM "DocumentJob";
DROP TABLE "DocumentJob";
ALTER TABLE "new_DocumentJob" RENAME TO "DocumentJob";
CREATE INDEX "DocumentJob_shopId_state_createdAt_idx" ON "DocumentJob"("shopId", "state", "createdAt");
CREATE TABLE "new_ScanToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT,
    "jobId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScanToken_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScanToken_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DocumentJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScanToken" ("createdAt", "expiresAt", "id", "orderId", "revokedAt", "shopId", "tokenHash") SELECT "createdAt", "expiresAt", "id", "orderId", "revokedAt", "shopId", "tokenHash" FROM "ScanToken";
DROP TABLE "ScanToken";
ALTER TABLE "new_ScanToken" RENAME TO "ScanToken";
CREATE UNIQUE INDEX "ScanToken_tokenHash_key" ON "ScanToken"("tokenHash");
CREATE INDEX "ScanToken_shopId_orderId_idx" ON "ScanToken"("shopId", "orderId");
CREATE INDEX "ScanToken_shopId_jobId_idx" ON "ScanToken"("shopId", "jobId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
