-- CreateEnum
CREATE TYPE "CounterpartyType" AS ENUM ('MANUFACTURER', 'SUPPLIER', 'CLEARING_AGENT', 'FREIGHT_FORWARDER', 'INSURANCE_COMPANY', 'BANK');

-- CreateEnum
CREATE TYPE "CounterpartyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_SUPPLIER', 'PI_RECEIVED', 'AWAITING_SHIPMENT', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProformaInvoiceStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'SUPERSEDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LetterOfCreditStatus" AS ENUM ('DRAFTED', 'APPLIED', 'ISSUED', 'PRESENTED', 'SETTLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('IN_TRANSIT', 'AT_PORT', 'CLEARING', 'CLEARED', 'RECEIVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "LandedCostComponentType" AS ENUM ('FREIGHT', 'MARINE_INSURANCE', 'CUSTOMS_DUTY', 'PORT_CHARGES', 'CLEARING_FEES', 'INLAND_TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "LandedCostStatus" AS ENUM ('ESTIMATED', 'ACTUAL', 'RECONCILED');

-- CreateEnum
CREATE TYPE "LandedCostAllocationMethod" AS ENUM ('EQUAL_PER_UNIT', 'WEIGHTED_BY_VALUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ForwarderInvoiceStatus" AS ENUM ('PENDING', 'RECONCILED', 'DISPUTED', 'PAID');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('PASSENGER', 'CARGO');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('IN_TRANSIT', 'IN_WAREHOUSE_CKD', 'IN_ASSEMBLY', 'IN_WAREHOUSE_CBU', 'SOLD_AS_CKD', 'SOLD_AS_CBU', 'DAMAGED', 'IN_REPAIR', 'DEMO', 'INTERNAL_USE', 'TRANSFERRED', 'RETURNED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('RECEIPT', 'ASSEMBLY_START', 'ASSEMBLY_COMPLETE', 'SALE', 'RETURN', 'DAMAGE', 'WRITE_OFF', 'DEMO', 'INTERNAL_USE', 'TRANSFER', 'REPAIR_IN', 'REPAIR_OUT', 'RESTOCK_FROM_REPAIR', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MovementReferenceType" AS ENUM ('SHIPMENT', 'SALES_ORDER', 'ASSEMBLY_JOB', 'RETURN', 'ADJUSTMENT', 'TRANSFER');

-- CreateEnum
CREATE TYPE "WarehouseStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SparePartMovementType" AS ENUM ('RECEIPT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AssemblyJobStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('END_USER', 'RESELLER');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CustomerTierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('WAREHOUSE_PICKUP', 'RETAIL_POS');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'AWAITING_PAYMENT', 'PAYMENT_RECEIVED', 'RELEASE_AUTHORISED', 'PICKING', 'READY_FOR_DISPATCH', 'DISPATCHED', 'DELIVERED', 'CLOSED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SaleForm" AS ENUM ('CKD', 'CBU');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('BANK_TRANSFER', 'POS_TERMINAL');

-- CreateEnum
CREATE TYPE "PaymentConfirmationSource" AS ENUM ('WEBHOOK', 'MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PosReconciliationStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ReturnDisposition" AS ENUM ('PENDING_DECISION', 'REPAIR', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('INITIATED', 'INSPECTING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ApprovalRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVED', 'REJECTED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "DocumentAccessCategory" AS ENUM ('PROCUREMENT', 'SALES', 'HR', 'PUBLIC');

-- CreateEnum
CREATE TYPE "PeriodSnapshotStatus" AS ENUM ('LOCKED');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "reportsToUserId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystemRole" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CounterpartyType" NOT NULL,
    "contact" JSONB,
    "bankDetails" JSONB,
    "status" "CounterpartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "supplierPortalRef" TEXT,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "totalValue" DECIMAL(18,2) NOT NULL,
    "expectedShipDate" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quantityOrdered" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proforma_invoices" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "piNumber" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 0,
    "issueDate" TIMESTAMP(3),
    "validityUntil" TIMESTAMP(3),
    "status" "ProformaInvoiceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "totalValue" DECIMAL(18,2) NOT NULL,
    "freightAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "insuranceAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "portOfLoading" TEXT,
    "portOfDischarge" TEXT,
    "rawDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proforma_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proforma_invoice_lines" (
    "id" TEXT NOT NULL,
    "proformaInvoiceId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "proforma_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letters_of_credit" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "lcNumber" TEXT,
    "issuingBankId" TEXT,
    "beneficiaryBankId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "presentationPeriodDays" INTEGER,
    "presentationDate" TIMESTAMP(3),
    "settlementDate" TIMESTAMP(3),
    "status" "LetterOfCreditStatus" NOT NULL DEFAULT 'DRAFTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letters_of_credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "shipmentReference" TEXT NOT NULL,
    "billOfLadingNumber" TEXT,
    "vesselName" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "arrivalDate" TIMESTAMP(3),
    "clearingStartedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "status" "ShipmentStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "freightForwarderId" TEXT,
    "clearingAgentId" TEXT,
    "insuranceCompanyId" TEXT,
    "isHistoricalImport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifest_lines" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "quantityDeclared" INTEGER NOT NULL,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "variance" INTEGER NOT NULL DEFAULT 0,
    "varianceReason" TEXT,
    "varianceResolvedAt" TIMESTAMP(3),

    CONSTRAINT "manifest_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "landed_costs" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "componentType" "LandedCostComponentType" NOT NULL,
    "counterpartyId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "exchangeRateToBase" DECIMAL(18,6),
    "allocationMethod" "LandedCostAllocationMethod" NOT NULL DEFAULT 'EQUAL_PER_UNIT',
    "status" "LandedCostStatus" NOT NULL DEFAULT 'ESTIMATED',
    "invoiceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landed_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forwarder_invoices" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "forwarderId" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "amountInvoiced" DECIMAL(18,2) NOT NULL,
    "amountEstimated" DECIMAL(18,2) NOT NULL,
    "variance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "ForwarderInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "rawDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forwarder_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturerId" TEXT,
    "category" "ProductCategory" NOT NULL DEFAULT 'PASSENGER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantAttributes" JSONB NOT NULL,
    "supplierSkuCode" TEXT NOT NULL,
    "currentMarketPrice" DECIMAL(18,2) NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "engineNumber" TEXT NOT NULL,
    "chassisNumber" TEXT NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "currentWarehouseId" TEXT,
    "landedCost" DECIMAL(18,2),
    "assembledAt" TIMESTAMP(3),
    "assembledById" TEXT,
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" JSONB,
    "status" "WarehouseStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "fromWarehouseId" TEXT,
    "toWarehouseId" TEXT,
    "referenceType" "MovementReferenceType",
    "referenceId" TEXT,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientTimestamp" TIMESTAMP(3),
    "clientId" TEXT,
    "notes" TEXT,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_parts" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantityOnHand" INTEGER NOT NULL DEFAULT 0,
    "landedCostPerUnit" DECIMAL(18,2),
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spare_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spare_part_movements" (
    "id" TEXT NOT NULL,
    "sparePartId" TEXT NOT NULL,
    "movementType" "SparePartMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "referenceType" "MovementReferenceType",
    "referenceId" TEXT,
    "actorId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientId" TEXT,
    "notes" TEXT,

    CONSTRAINT "spare_part_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assembly_jobs" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "supervisorId" TEXT,
    "status" "AssemblyJobStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assembly_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tiers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CustomerTierStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'RESELLER',
    "tierId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" JSONB,
    "taxId" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_entries" (
    "id" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "customerTierId" TEXT NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "setById" TEXT,

    CONSTRAINT "price_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_orders" (
    "id" TEXT NOT NULL,
    "soNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL DEFAULT 'WAREHOUSE_PICKUP',
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentReceivedTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order_lines" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "unitId" TEXT,
    "saleForm" "SaleForm" NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "sales_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vatRate" DECIMAL(5,4) NOT NULL,
    "vatAmount" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "pdfDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "methodType" "PaymentMethodType" NOT NULL,
    "provider" TEXT,
    "webhookEndpoint" TEXT,
    "status" "CounterpartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceNumber" TEXT,
    "confirmationSource" "PaymentConfirmationSource" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "confirmedById" TEXT,
    "receiptDocumentId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_transactions" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTransactionId" TEXT,
    "rawPayload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(18,2) NOT NULL,
    "reconciliationStatus" "PosReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',

    CONSTRAINT "pos_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "release_authorisations" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referencePaymentId" TEXT,
    "documentId" TEXT,

    CONSTRAINT "release_authorisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "dnNumber" TEXT NOT NULL,
    "preparedById" TEXT,
    "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicleReg" TEXT,
    "driverName" TEXT,
    "documentId" TEXT,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waybills" (
    "id" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "wbNumber" TEXT NOT NULL,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waybills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proofs_of_delivery" (
    "id" TEXT NOT NULL,
    "deliveryNoteId" TEXT NOT NULL,
    "receivedBy" TEXT,
    "signedAt" TIMESTAMP(3),
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proofs_of_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initiatedById" TEXT,
    "reason" TEXT,
    "disposition" "ReturnDisposition" NOT NULL DEFAULT 'PENDING_DECISION',
    "dispositionDecidedById" TEXT,
    "dispositionDecidedAt" TIMESTAMP(3),
    "status" "ReturnStatus" NOT NULL DEFAULT 'INITIATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerAction" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "status" "ApprovalRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_step_rules" (
    "id" TEXT NOT NULL,
    "approvalRuleId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "requiredRoleId" TEXT,
    "allowAnyHolder" BOOLEAN NOT NULL DEFAULT true,
    "requiredUserId" TEXT,

    CONSTRAINT "approval_step_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "approvalRuleId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "initiatedById" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_decisions" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "stepSequence" INTEGER NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decision" "ApprovalDecisionType" NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,

    CONSTRAINT "approval_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accessCategory" "DocumentAccessCategory" NOT NULL DEFAULT 'PROCUREMENT',

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_links" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "linkLabel" TEXT,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "context" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_toggles" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "value" JSONB NOT NULL,
    "status" "CounterpartyStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastChangedById" TEXT,
    "lastChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_toggles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_snapshots" (
    "id" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenById" TEXT,
    "status" "PeriodSnapshotStatus" NOT NULL DEFAULT 'LOCKED',

    CONSTRAINT "period_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_valuation_lines" (
    "id" TEXT NOT NULL,
    "periodSnapshotId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantityOnHand" INTEGER NOT NULL,
    "valuationMarket" DECIMAL(18,2) NOT NULL,
    "valuationLandedCost" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "stock_valuation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "id_range_allocations" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idType" TEXT NOT NULL,
    "rangeStart" INTEGER NOT NULL,
    "rangeEnd" INTEGER NOT NULL,
    "nextValue" INTEGER NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exhausted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "id_range_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conflict_review_items" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fieldPath" TEXT,
    "versionA" JSONB NOT NULL,
    "versionB" JSONB NOT NULL,
    "contextA" JSONB,
    "contextB" JSONB,
    "status" "ConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conflict_review_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_sync_actions" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resultRef" TEXT,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_sync_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_reportsToUserId_idx" ON "users"("reportsToUserId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "counterparties_type_idx" ON "counterparties"("type");

-- CreateIndex
CREATE INDEX "counterparties_status_idx" ON "counterparties"("status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_poNumber_key" ON "purchase_orders"("poNumber");

-- CreateIndex
CREATE INDEX "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchaseOrderId_idx" ON "purchase_order_lines"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "purchase_order_lines_productVariantId_idx" ON "purchase_order_lines"("productVariantId");

-- CreateIndex
CREATE INDEX "proforma_invoices_purchaseOrderId_idx" ON "proforma_invoices"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "proforma_invoices_status_idx" ON "proforma_invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "proforma_invoices_purchaseOrderId_piNumber_revisionNumber_key" ON "proforma_invoices"("purchaseOrderId", "piNumber", "revisionNumber");

-- CreateIndex
CREATE INDEX "proforma_invoice_lines_proformaInvoiceId_idx" ON "proforma_invoice_lines"("proformaInvoiceId");

-- CreateIndex
CREATE INDEX "proforma_invoice_lines_productVariantId_idx" ON "proforma_invoice_lines"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "letters_of_credit_purchaseOrderId_key" ON "letters_of_credit"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_shipmentReference_key" ON "shipments"("shipmentReference");

-- CreateIndex
CREATE INDEX "shipments_purchaseOrderId_idx" ON "shipments"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "shipments_status_idx" ON "shipments"("status");

-- CreateIndex
CREATE INDEX "manifest_lines_shipmentId_idx" ON "manifest_lines"("shipmentId");

-- CreateIndex
CREATE INDEX "manifest_lines_productVariantId_idx" ON "manifest_lines"("productVariantId");

-- CreateIndex
CREATE INDEX "landed_costs_shipmentId_idx" ON "landed_costs"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "forwarder_invoices_shipmentId_key" ON "forwarder_invoices"("shipmentId");

-- CreateIndex
CREATE INDEX "products_manufacturerId_idx" ON "products"("manufacturerId");

-- CreateIndex
CREATE INDEX "product_variants_productId_idx" ON "product_variants"("productId");

-- CreateIndex
CREATE INDEX "product_variants_supplierSkuCode_idx" ON "product_variants"("supplierSkuCode");

-- CreateIndex
CREATE INDEX "product_variants_status_idx" ON "product_variants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "units_engineNumber_key" ON "units"("engineNumber");

-- CreateIndex
CREATE UNIQUE INDEX "units_chassisNumber_key" ON "units"("chassisNumber");

-- CreateIndex
CREATE INDEX "units_productVariantId_idx" ON "units"("productVariantId");

-- CreateIndex
CREATE INDEX "units_shipmentId_idx" ON "units"("shipmentId");

-- CreateIndex
CREATE INDEX "units_status_idx" ON "units"("status");

-- CreateIndex
CREATE INDEX "units_currentWarehouseId_idx" ON "units"("currentWarehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_clientId_key" ON "stock_movements"("clientId");

-- CreateIndex
CREATE INDEX "stock_movements_unitId_idx" ON "stock_movements"("unitId");

-- CreateIndex
CREATE INDEX "stock_movements_movementType_idx" ON "stock_movements"("movementType");

-- CreateIndex
CREATE INDEX "stock_movements_occurredAt_idx" ON "stock_movements"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "spare_parts_sku_key" ON "spare_parts"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "spare_part_movements_clientId_key" ON "spare_part_movements"("clientId");

-- CreateIndex
CREATE INDEX "spare_part_movements_sparePartId_idx" ON "spare_part_movements"("sparePartId");

-- CreateIndex
CREATE INDEX "spare_part_movements_actorId_idx" ON "spare_part_movements"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "assembly_jobs_unitId_key" ON "assembly_jobs"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tiers_name_key" ON "customer_tiers"("name");

-- CreateIndex
CREATE INDEX "customers_tierId_idx" ON "customers"("tierId");

-- CreateIndex
CREATE INDEX "customers_type_idx" ON "customers"("type");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- CreateIndex
CREATE INDEX "price_list_entries_productVariantId_idx" ON "price_list_entries"("productVariantId");

-- CreateIndex
CREATE INDEX "price_list_entries_customerTierId_idx" ON "price_list_entries"("customerTierId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_soNumber_key" ON "sales_orders"("soNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sales_orders_clientId_key" ON "sales_orders"("clientId");

-- CreateIndex
CREATE INDEX "sales_orders_customerId_idx" ON "sales_orders"("customerId");

-- CreateIndex
CREATE INDEX "sales_orders_status_idx" ON "sales_orders"("status");

-- CreateIndex
CREATE INDEX "sales_order_lines_salesOrderId_idx" ON "sales_order_lines"("salesOrderId");

-- CreateIndex
CREATE INDEX "sales_order_lines_productVariantId_idx" ON "sales_order_lines"("productVariantId");

-- CreateIndex
CREATE INDEX "sales_order_lines_unitId_idx" ON "sales_order_lines"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_salesOrderId_key" ON "invoices"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_clientId_key" ON "payments"("clientId");

-- CreateIndex
CREATE INDEX "payments_salesOrderId_idx" ON "payments"("salesOrderId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pos_transactions_paymentId_key" ON "pos_transactions"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "release_authorisations_salesOrderId_key" ON "release_authorisations"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_salesOrderId_key" ON "delivery_notes"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_dnNumber_key" ON "delivery_notes"("dnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "waybills_deliveryNoteId_key" ON "waybills"("deliveryNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "waybills_wbNumber_key" ON "waybills"("wbNumber");

-- CreateIndex
CREATE UNIQUE INDEX "proofs_of_delivery_deliveryNoteId_key" ON "proofs_of_delivery"("deliveryNoteId");

-- CreateIndex
CREATE INDEX "returns_salesOrderId_idx" ON "returns"("salesOrderId");

-- CreateIndex
CREATE INDEX "returns_unitId_idx" ON "returns"("unitId");

-- CreateIndex
CREATE INDEX "approval_step_rules_approvalRuleId_idx" ON "approval_step_rules"("approvalRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_step_rules_approvalRuleId_sequence_key" ON "approval_step_rules"("approvalRuleId", "sequence");

-- CreateIndex
CREATE INDEX "approval_requests_approvalRuleId_idx" ON "approval_requests"("approvalRuleId");

-- CreateIndex
CREATE INDEX "approval_requests_subjectType_subjectId_idx" ON "approval_requests"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE INDEX "approval_decisions_approvalRequestId_idx" ON "approval_decisions"("approvalRequestId");

-- CreateIndex
CREATE INDEX "documents_accessCategory_idx" ON "documents"("accessCategory");

-- CreateIndex
CREATE INDEX "document_links_documentId_idx" ON "document_links"("documentId");

-- CreateIndex
CREATE INDEX "document_links_entityType_entityId_idx" ON "document_links"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_entries_actorUserId_idx" ON "audit_log_entries"("actorUserId");

-- CreateIndex
CREATE INDEX "audit_log_entries_entityType_entityId_idx" ON "audit_log_entries"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_entries_occurredAt_idx" ON "audit_log_entries"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "feature_toggles_key_key" ON "feature_toggles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "period_snapshots_periodLabel_key" ON "period_snapshots"("periodLabel");

-- CreateIndex
CREATE INDEX "stock_valuation_lines_periodSnapshotId_idx" ON "stock_valuation_lines"("periodSnapshotId");

-- CreateIndex
CREATE INDEX "id_range_allocations_userId_idx" ON "id_range_allocations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "id_range_allocations_deviceId_idType_rangeStart_key" ON "id_range_allocations"("deviceId", "idType", "rangeStart");

-- CreateIndex
CREATE INDEX "conflict_review_items_status_idx" ON "conflict_review_items"("status");

-- CreateIndex
CREATE INDEX "conflict_review_items_entityType_entityId_idx" ON "conflict_review_items"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "processed_sync_actions_clientId_key" ON "processed_sync_actions"("clientId");

-- CreateIndex
CREATE INDEX "processed_sync_actions_processedAt_idx" ON "processed_sync_actions"("processedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_reportsToUserId_fkey" FOREIGN KEY ("reportsToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "counterparties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoices" ADD CONSTRAINT "proforma_invoices_rawDocumentId_fkey" FOREIGN KEY ("rawDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoice_lines" ADD CONSTRAINT "proforma_invoice_lines_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "proforma_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_invoice_lines" ADD CONSTRAINT "proforma_invoice_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_issuingBankId_fkey" FOREIGN KEY ("issuingBankId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_beneficiaryBankId_fkey" FOREIGN KEY ("beneficiaryBankId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_freightForwarderId_fkey" FOREIGN KEY ("freightForwarderId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_clearingAgentId_fkey" FOREIGN KEY ("clearingAgentId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_insuranceCompanyId_fkey" FOREIGN KEY ("insuranceCompanyId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_lines" ADD CONSTRAINT "manifest_lines_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifest_lines" ADD CONSTRAINT "manifest_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_invoiceDocumentId_fkey" FOREIGN KEY ("invoiceDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forwarder_invoices" ADD CONSTRAINT "forwarder_invoices_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forwarder_invoices" ADD CONSTRAINT "forwarder_invoices_forwarderId_fkey" FOREIGN KEY ("forwarderId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forwarder_invoices" ADD CONSTRAINT "forwarder_invoices_rawDocumentId_fkey" FOREIGN KEY ("rawDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "counterparties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_currentWarehouseId_fkey" FOREIGN KEY ("currentWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_assembledById_fkey" FOREIGN KEY ("assembledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_part_movements" ADD CONSTRAINT "spare_part_movements_sparePartId_fkey" FOREIGN KEY ("sparePartId") REFERENCES "spare_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spare_part_movements" ADD CONSTRAINT "spare_part_movements_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_jobs" ADD CONSTRAINT "assembly_jobs_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assembly_jobs" ADD CONSTRAINT "assembly_jobs_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "customer_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_customerTierId_fkey" FOREIGN KEY ("customerTierId") REFERENCES "customer_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_entries" ADD CONSTRAINT "price_list_entries_setById_fkey" FOREIGN KEY ("setById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_pdfDocumentId_fkey" FOREIGN KEY ("pdfDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receiptDocumentId_fkey" FOREIGN KEY ("receiptDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_authorisations" ADD CONSTRAINT "release_authorisations_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_authorisations" ADD CONSTRAINT "release_authorisations_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "release_authorisations" ADD CONSTRAINT "release_authorisations_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waybills" ADD CONSTRAINT "waybills_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofs_of_delivery" ADD CONSTRAINT "proofs_of_delivery_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_rules" ADD CONSTRAINT "approval_step_rules_approvalRuleId_fkey" FOREIGN KEY ("approvalRuleId") REFERENCES "approval_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_rules" ADD CONSTRAINT "approval_step_rules_requiredRoleId_fkey" FOREIGN KEY ("requiredRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step_rules" ADD CONSTRAINT "approval_step_rules_requiredUserId_fkey" FOREIGN KEY ("requiredUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approvalRuleId_fkey" FOREIGN KEY ("approvalRuleId") REFERENCES "approval_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_valuation_lines" ADD CONSTRAINT "stock_valuation_lines_periodSnapshotId_fkey" FOREIGN KEY ("periodSnapshotId") REFERENCES "period_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_valuation_lines" ADD CONSTRAINT "stock_valuation_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_valuation_lines" ADD CONSTRAINT "stock_valuation_lines_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "id_range_allocations" ADD CONSTRAINT "id_range_allocations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conflict_review_items" ADD CONSTRAINT "conflict_review_items_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
