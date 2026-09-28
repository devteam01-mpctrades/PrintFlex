-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "limitBehaviour" TEXT NOT NULL DEFAULT 'HARD_CAP',
    "meterPeriodStart" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "pinHash" TEXT,
    "pinVersion" INTEGER NOT NULL DEFAULT 0,
    "scanSecret" TEXT,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV-',
    "invoiceNextNumber" INTEGER NOT NULL DEFAULT 1,
    "batchNextNumber" INTEGER NOT NULL DEFAULT 1,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "pages" INTEGER NOT NULL DEFAULT 0,
    "seen" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "stale" INTEGER NOT NULL DEFAULT 0,
    "shopifyTotal" INTEGER,
    "beyondWindow" INTEGER,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanDevice" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "staffLabel" TEXT,
    "secretHash" TEXT NOT NULL,
    "pinVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ScanDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "assignmentRuleJson" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "settingsJson" TEXT NOT NULL,
    "assignmentRuleJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderIndex" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "countryCode" TEXT,
    "shippingCity" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "fulfillmentStatus" TEXT NOT NULL DEFAULT 'UNFULFILLED',
    "financialStatus" TEXT,
    "shippingMethod" TEXT,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    "documentStatus" TEXT NOT NULL DEFAULT 'NEW',
    "lastPrintedAt" TIMESTAMP(3),
    "lastPackedAt" TIMESTAMP(3),
    "shopifyCreatedAt" TIMESTAMP(3) NOT NULL,
    "shopifyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "number" INTEGER,
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
    "deadlineAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "jobId" TEXT,
    "orderId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "invoiceNumber" TEXT,
    "filePath" TEXT,
    "byteSize" INTEGER,
    "renderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanToken" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT,
    "jobId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "staffLabel" TEXT,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "itemCount" INTEGER,
    "parcelWeightGrams" INTEGER,
    "clientEventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterEntry" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BinMap" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "sequence" INTEGER,

    CONSTRAINT "BinMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleMap" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "bundleSku" TEXT NOT NULL,
    "componentSku" TEXT NOT NULL,
    "componentTitle" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BundleMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT,
    "detailsJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "quantity" INTEGER NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "imageUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceNumber" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "formatted" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceNumber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendLog" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "SendLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE INDEX "SyncRun_shopId_startedAt_idx" ON "SyncRun"("shopId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScanDevice_secretHash_key" ON "ScanDevice"("secretHash");

-- CreateIndex
CREATE INDEX "ScanDevice_shopId_revokedAt_idx" ON "ScanDevice"("shopId", "revokedAt");

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
CREATE UNIQUE INDEX "DocumentJob_shopId_number_key" ON "DocumentJob"("shopId", "number");

-- CreateIndex
CREATE INDEX "Document_shopId_orderId_documentType_templateId_templateVer_idx" ON "Document"("shopId", "orderId", "documentType", "templateId", "templateVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Document_shopId_invoiceNumber_key" ON "Document"("shopId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ScanToken_tokenHash_key" ON "ScanToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ScanToken_shopId_orderId_idx" ON "ScanToken"("shopId", "orderId");

-- CreateIndex
CREATE INDEX "ScanToken_shopId_jobId_idx" ON "ScanToken"("shopId", "jobId");

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

-- CreateIndex
CREATE INDEX "OrderLineItem_sku_idx" ON "OrderLineItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineItem_orderId_shopifyLineItemId_key" ON "OrderLineItem"("orderId", "shopifyLineItemId");

-- CreateIndex
CREATE INDEX "SavedView_shopId_position_idx" ON "SavedView"("shopId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_shopId_name_key" ON "SavedView"("shopId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceNumber_shopId_orderId_key" ON "InvoiceNumber"("shopId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceNumber_shopId_number_key" ON "InvoiceNumber"("shopId", "number");

-- CreateIndex
CREATE INDEX "SendLog_shopId_createdAt_idx" ON "SendLog"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "SendLog_orderId_trigger_status_idx" ON "SendLog"("orderId", "trigger", "status");

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanDevice" ADD CONSTRAINT "ScanDevice_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderIndex" ADD CONSTRAINT "OrderIndex_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentJob" ADD CONSTRAINT "DocumentJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DocumentJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanToken" ADD CONSTRAINT "ScanToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanToken" ADD CONSTRAINT "ScanToken_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanToken" ADD CONSTRAINT "ScanToken_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DocumentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackEvent" ADD CONSTRAINT "PackEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackEvent" ADD CONSTRAINT "PackEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterEntry" ADD CONSTRAINT "MeterEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinMap" ADD CONSTRAINT "BinMap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleMap" ADD CONSTRAINT "BundleMap_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEntry" ADD CONSTRAINT "AuditEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceNumber" ADD CONSTRAINT "InvoiceNumber_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SendLog" ADD CONSTRAINT "SendLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

