-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "limitBehaviour" TEXT NOT NULL DEFAULT 'HARD_CAP',
    "meterPeriodStart" DATETIME,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "pinHash" TEXT,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV-',
    "invoiceNextNumber" INTEGER NOT NULL DEFAULT 1,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "assignmentRuleJson" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Template_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "settingsJson" TEXT NOT NULL,
    "assignmentRuleJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "countryCode" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fulfillmentStatus" TEXT NOT NULL DEFAULT 'UNFULFILLED',
    "financialStatus" TEXT,
    "shippingMethod" TEXT,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "documentStatus" TEXT NOT NULL DEFAULT 'NEW',
    "lastPrintedAt" DATETIME,
    "lastPackedAt" DATETIME,
    "shopifyCreatedAt" DATETIME NOT NULL,
    "shopifyUpdatedAt" DATETIME NOT NULL,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderIndex_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT,
    "documentTypesJson" TEXT NOT NULL,
    "orderIdsJson" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "outputPath" TEXT,
    "deadlineAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DocumentJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "jobId" TEXT,
    "orderId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "invoiceNumber" TEXT,
    "filePath" TEXT,
    "byteSize" INTEGER,
    "renderedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Document_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DocumentJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Document_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Document_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScanToken_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "staffLabel" TEXT,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "itemCount" INTEGER,
    "parcelWeightGrams" INTEGER,
    "clientEventId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MeterEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeterEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BinMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "sequence" INTEGER,
    CONSTRAINT "BinMap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BundleMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "bundleSku" TEXT NOT NULL,
    "componentSku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "BundleMap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE INDEX "Template_shopId_documentType_active_idx" ON "Template"("shopId", "documentType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_templateId_version_key" ON "TemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "OrderIndex_shopId_orderName_idx" ON "OrderIndex"("shopId", "orderName");

-- CreateIndex
CREATE INDEX "OrderIndex_shopId_fulfillmentStatus_idx" ON "OrderIndex"("shopId", "fulfillmentStatus");

-- CreateIndex
CREATE INDEX "OrderIndex_shopId_documentStatus_idx" ON "OrderIndex"("shopId", "documentStatus");

-- CreateIndex
CREATE INDEX "OrderIndex_shopId_countryCode_idx" ON "OrderIndex"("shopId", "countryCode");

-- CreateIndex
CREATE INDEX "OrderIndex_shopId_shippingMethod_idx" ON "OrderIndex"("shopId", "shippingMethod");

-- CreateIndex
CREATE INDEX "OrderIndex_shopId_shopifyCreatedAt_idx" ON "OrderIndex"("shopId", "shopifyCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderIndex_shopId_shopifyOrderId_key" ON "OrderIndex"("shopId", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "DocumentJob_shopId_state_createdAt_idx" ON "DocumentJob"("shopId", "state", "createdAt");

-- CreateIndex
CREATE INDEX "Document_shopId_orderId_documentType_templateId_templateVersion_idx" ON "Document"("shopId", "orderId", "documentType", "templateId", "templateVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Document_shopId_invoiceNumber_key" ON "Document"("shopId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ScanToken_tokenHash_key" ON "ScanToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ScanToken_shopId_orderId_idx" ON "ScanToken"("shopId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PackEvent_clientEventId_key" ON "PackEvent"("clientEventId");

-- CreateIndex
CREATE INDEX "PackEvent_shopId_occurredAt_idx" ON "PackEvent"("shopId", "occurredAt");

-- CreateIndex
CREATE INDEX "PackEvent_shopId_orderId_idx" ON "PackEvent"("shopId", "orderId");

-- CreateIndex
CREATE INDEX "MeterEntry_shopId_period_idx" ON "MeterEntry"("shopId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "MeterEntry_shopId_period_orderId_key" ON "MeterEntry"("shopId", "period", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "BinMap_shopId_sku_key" ON "BinMap"("shopId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "BundleMap_shopId_bundleSku_componentSku_key" ON "BundleMap"("shopId", "bundleSku", "componentSku");

-- CreateIndex
CREATE INDEX "AuditEntry_shopId_createdAt_idx" ON "AuditEntry"("shopId", "createdAt");
