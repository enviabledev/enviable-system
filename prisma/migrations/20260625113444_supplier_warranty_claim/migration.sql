-- Supplier warranty claim disposition for returns. The two ADD VALUE statements
-- extend existing enums but no DML in this migration USES the new values, so it
-- is safe in a single transaction (Postgres only forbids USING a newly added
-- enum value in the same transaction that added it). The new table references
-- only the brand-new SupplierWarrantyClaimStatus, which is immediately usable.
-- Idempotent and safe on fresh, dev, and production.

-- CreateEnum
CREATE TYPE "SupplierWarrantyClaimStatus" AS ENUM ('CLAIMED', 'RESOLVED_APPROVED', 'RESOLVED_DENIED');

-- AlterEnum
ALTER TYPE "ReturnDisposition" ADD VALUE IF NOT EXISTS 'SUPPLIER_WARRANTY_CLAIM';

-- AlterEnum
ALTER TYPE "UnitStatus" ADD VALUE IF NOT EXISTS 'CLAIMED_TO_SUPPLIER';

-- CreateTable
CREATE TABLE "supplier_warranty_claims" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "supplierCounterpartyId" TEXT NOT NULL,
    "claimReference" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimNotes" TEXT,
    "status" "SupplierWarrantyClaimStatus" NOT NULL DEFAULT 'CLAIMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_warranty_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_warranty_claims_returnId_key" ON "supplier_warranty_claims"("returnId");

-- CreateIndex
CREATE INDEX "supplier_warranty_claims_supplierCounterpartyId_idx" ON "supplier_warranty_claims"("supplierCounterpartyId");

-- AddForeignKey
ALTER TABLE "supplier_warranty_claims" ADD CONSTRAINT "supplier_warranty_claims_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_warranty_claims" ADD CONSTRAINT "supplier_warranty_claims_supplierCounterpartyId_fkey" FOREIGN KEY ("supplierCounterpartyId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
