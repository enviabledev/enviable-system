-- CreateEnum
CREATE TYPE "OverpaymentResolution" AS ENUM ('REFUND', 'CREDIT');

-- CreateEnum
CREATE TYPE "RefundMechanism" AS ENUM ('BANK_TRANSFER', 'CASH');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "creditNotes" TEXT,
ADD COLUMN     "overpaymentAmount" DECIMAL(18,2),
ADD COLUMN     "overpaymentResolution" "OverpaymentResolution",
ADD COLUMN     "refundMechanism" "RefundMechanism",
ADD COLUMN     "refundReference" TEXT;
