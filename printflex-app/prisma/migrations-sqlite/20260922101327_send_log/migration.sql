-- CreateTable
CREATE TABLE "SendLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "documentId" TEXT,
    "templateId" TEXT,
    "trigger" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "messageId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "SendLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SendLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SendLog_shopId_createdAt_idx" ON "SendLog"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "SendLog_orderId_trigger_status_idx" ON "SendLog"("orderId", "trigger", "status");
