-- CreateTable
CREATE TABLE "sales_proforma_invoices" (
    "id" TEXT NOT NULL,
    "piNumber" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_proforma_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_proforma_invoices_piNumber_key" ON "sales_proforma_invoices"("piNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sales_proforma_invoices_salesOrderId_key" ON "sales_proforma_invoices"("salesOrderId");

-- AddForeignKey
ALTER TABLE "sales_proforma_invoices" ADD CONSTRAINT "sales_proforma_invoices_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_proforma_invoices" ADD CONSTRAINT "sales_proforma_invoices_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
