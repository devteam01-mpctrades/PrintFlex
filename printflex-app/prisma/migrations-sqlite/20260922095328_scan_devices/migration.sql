-- AlterTable
ALTER TABLE "OrderIndex" ADD COLUMN "shippingCity" TEXT;

-- CreateTable
CREATE TABLE "ScanDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "pinVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "ScanDevice_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "limitBehaviour" TEXT NOT NULL DEFAULT 'HARD_CAP',
    "meterPeriodStart" DATETIME,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "pinHash" TEXT,
    "pinVersion" INTEGER NOT NULL DEFAULT 0,
    "scanSecret" TEXT,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV-',
    "invoiceNextNumber" INTEGER NOT NULL DEFAULT 1,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Shop" ("createdAt", "domain", "id", "installedAt", "invoiceNextNumber", "invoicePrefix", "limitBehaviour", "meterPeriodStart", "pinHash", "plan", "scanSecret", "settingsJson", "timezone", "uninstalledAt", "updatedAt") SELECT "createdAt", "domain", "id", "installedAt", "invoiceNextNumber", "invoicePrefix", "limitBehaviour", "meterPeriodStart", "pinHash", "plan", "scanSecret", "settingsJson", "timezone", "uninstalledAt", "updatedAt" FROM "Shop";
DROP TABLE "Shop";
ALTER TABLE "new_Shop" RENAME TO "Shop";
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ScanDevice_secretHash_key" ON "ScanDevice"("secretHash");

-- CreateIndex
CREATE INDEX "ScanDevice_shopId_revokedAt_idx" ON "ScanDevice"("shopId", "revokedAt");
