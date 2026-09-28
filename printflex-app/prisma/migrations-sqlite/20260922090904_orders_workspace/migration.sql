-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "variantId" TEXT,
    "productId" TEXT,
    "imageUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "OrderIndex" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedView_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OrderLineItem_sku_idx" ON "OrderLineItem"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineItem_orderId_shopifyLineItemId_key" ON "OrderLineItem"("orderId", "shopifyLineItemId");

-- CreateIndex
CREATE INDEX "SavedView_shopId_position_idx" ON "SavedView"("shopId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SavedView_shopId_name_key" ON "SavedView"("shopId", "name");
