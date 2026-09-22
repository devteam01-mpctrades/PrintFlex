-- CreateTable
CREATE TABLE "InvoiceNumber" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "formatted" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceNumber_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceNumber_shopId_orderId_key" ON "InvoiceNumber"("shopId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceNumber_shopId_number_key" ON "InvoiceNumber"("shopId", "number");
