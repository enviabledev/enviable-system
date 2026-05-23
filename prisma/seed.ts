// ============================================================================
// Enviable Inventory & Operations System, seed
//
// Populates fixed reference data idempotently. Every write is an upsert on a
// natural key, so the seed is safe to re-run.
//
// IMPORTANT (deliberate): the User upsert updates ONLY fullName in its update
// clause. It NEVER writes passwordHash on an existing row. This protects
// deployed environments: re-seeding can never reset a real user's password to
// the non-authenticating placeholder. To reset a test user's password back to
// the placeholder, use scripts/reset-test-passwords.ts (not the seed).
//
// Prices and the reporting hierarchy are illustrative starting values; the
// Sales Manager / ED confirm the real figures before go-live.
// ============================================================================

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// Non-authenticating placeholder. argon2id verification can never match this
// string, so a freshly-seeded user cannot log in until IT Admin sets a real
// password via scripts/set-password.ts. Must match reset-test-passwords.ts.
const PLACEHOLDER_HASH = '$argon2id$PLACEHOLDER_RESET_REQUIRED';

// ----------------------------------------------------------------------------
// Permission catalogue (atomic keys, grouped by domain)
// ----------------------------------------------------------------------------
const PERMISSIONS: { key: string; category: string; description: string }[] = [
  // Procurement
  { key: 'counterparty.read', category: 'procurement', description: 'View counterparties' },
  { key: 'counterparty.manage', category: 'procurement', description: 'Create/edit counterparties' },
  { key: 'po.read', category: 'procurement', description: 'View purchase orders' },
  { key: 'po.create', category: 'procurement', description: 'Create/edit draft purchase orders' },
  { key: 'po.submit', category: 'procurement', description: 'Submit a PO for approval' },
  { key: 'po.approve', category: 'procurement', description: 'Approve a purchase order' },
  { key: 'pi.read', category: 'procurement', description: 'View proforma invoices' },
  { key: 'pi.review', category: 'procurement', description: 'Create/approve/reject proforma invoices' },
  { key: 'shipment.read', category: 'procurement', description: 'View shipments' },
  { key: 'shipment.manage', category: 'procurement', description: 'Create/edit shipments' },
  { key: 'shipment.receive', category: 'procurement', description: 'Receive units against a shipment' },
  { key: 'landedcost.manage', category: 'procurement', description: 'Manage and allocate landed cost' },
  { key: 'historicalload.run', category: 'procurement', description: 'Run the historical data load' },
  // Inventory
  { key: 'unit.read', category: 'inventory', description: 'View units' },
  { key: 'unit.adjust', category: 'inventory', description: 'Adjust unit status (damage/demo/etc.)' },
  { key: 'unit.transfer', category: 'inventory', description: 'Transfer units between warehouses' },
  { key: 'movement.read', category: 'inventory', description: 'View the cross-unit stock movement log' },
  { key: 'sparepart.read', category: 'inventory', description: 'View spare parts' },
  { key: 'sparepart.manage', category: 'inventory', description: 'Manage spare parts' },
  { key: 'product.read', category: 'inventory', description: 'View the product catalogue (variants, SKUs, attributes)' },
  // Assembly
  { key: 'assembly.read', category: 'assembly', description: 'View assembly jobs' },
  { key: 'assembly.perform', category: 'assembly', description: 'Start/complete/fail assembly jobs' },
  // Sales
  { key: 'customer.read', category: 'sales', description: 'View customers' },
  { key: 'customer.manage', category: 'sales', description: 'Create/edit customers' },
  { key: 'pricelist.read', category: 'sales', description: 'View the price list' },
  { key: 'pricelist.manage', category: 'sales', description: 'Set prices' },
  { key: 'salesorder.read', category: 'sales', description: 'View sales orders' },
  { key: 'salesorder.create', category: 'sales', description: 'Create/edit sales orders' },
  { key: 'salesorder.discount', category: 'sales', description: 'Apply line discounts' },
  { key: 'payment.record', category: 'sales', description: 'Record a payment' },
  { key: 'payment.confirm', category: 'sales', description: 'Confirm a payment / authorise release' },
  { key: 'delivery.manage', category: 'sales', description: 'Manage delivery documents and dispatch' },
  { key: 'return.manage', category: 'sales', description: 'Initiate and resolve returns' },
  // Sensitive
  { key: 'costdata.view', category: 'sensitive', description: 'View cost data (landed cost, margin)' },
  // Reporting
  { key: 'report.stocks', category: 'reporting', description: 'View the stocks report' },
  { key: 'report.revenue', category: 'reporting', description: 'View the revenue/sales report' },
  { key: 'report.customers', category: 'reporting', description: 'View the customers report' },
  { key: 'audit.read', category: 'reporting', description: 'View the audit log' },
  // Sync
  { key: 'conflict.resolve', category: 'sync', description: 'Resolve sync conflicts' },
  // Admin
  { key: 'user.read', category: 'admin', description: 'View users' },
  { key: 'user.manage', category: 'admin', description: 'Create/edit users and roles' },
  { key: 'role.read', category: 'admin', description: 'View roles' },
  { key: 'role.manage', category: 'admin', description: 'Manage roles and permissions' },
  { key: 'toggle.read', category: 'admin', description: 'View feature toggles' },
  { key: 'toggle.manage', category: 'admin', description: 'Change feature toggles' },
  { key: 'approval.read', category: 'admin', description: 'View approval rules and requests' },
  { key: 'approval.manage', category: 'admin', description: 'Manage approval rules' },
  { key: 'document.read', category: 'admin', description: 'View documents' },
  { key: 'document.manage', category: 'admin', description: 'Upload/link documents' },
];

// ----------------------------------------------------------------------------
// Roles, with curated permission grants. "*" means every permission.
// costdata.view is granted ONLY to senior/warehouse roles, never to Sales Officer.
// ----------------------------------------------------------------------------
const ROLES: { name: string; description: string; permissions: string[] }[] = [
  {
    name: 'Managing Director',
    description: 'Top executive, read-wide plus approvals',
    permissions: [
      'counterparty.read', 'po.read', 'po.approve', 'pi.read', 'shipment.read', 'unit.read',
      'movement.read', 'sparepart.read', 'product.read', 'assembly.read', 'customer.read',
      'pricelist.read', 'salesorder.read', 'payment.confirm', 'costdata.view', 'report.stocks',
      'report.revenue', 'report.customers', 'approval.read', 'toggle.read', 'user.read',
      'role.read', 'document.read',
    ],
  },
  {
    name: 'Executive Director',
    description: 'Executive sponsor, approvals and oversight',
    permissions: [
      'counterparty.read', 'po.read', 'po.approve', 'pi.read', 'pi.review', 'shipment.read',
      'unit.read', 'movement.read', 'sparepart.read', 'product.read', 'assembly.read',
      'customer.read', 'pricelist.read', 'salesorder.read', 'payment.confirm', 'costdata.view',
      'report.stocks', 'report.revenue', 'report.customers', 'approval.read', 'approval.manage',
      'toggle.read', 'user.read', 'role.read', 'document.read',
    ],
  },
  {
    name: 'General Manager',
    description: 'Operational head across procurement, inventory, sales',
    permissions: [
      'counterparty.read', 'counterparty.manage', 'po.read', 'po.approve', 'pi.read', 'pi.review',
      'shipment.read', 'shipment.manage', 'unit.read', 'unit.adjust', 'movement.read',
      'sparepart.read', 'product.read', 'assembly.read', 'customer.read', 'pricelist.read',
      'pricelist.manage', 'salesorder.read', 'payment.confirm', 'delivery.manage', 'return.manage',
      'costdata.view', 'report.stocks', 'report.revenue', 'report.customers', 'conflict.resolve',
      'approval.read', 'toggle.read', 'user.read', 'role.read', 'document.read', 'document.manage',
    ],
  },
  {
    name: 'Executive Assistant to ED',
    description: 'Supports the ED; read-oriented plus document handling',
    permissions: [
      'po.read', 'pi.read', 'shipment.read', 'unit.read', 'product.read', 'customer.read',
      'salesorder.read', 'report.stocks', 'document.read', 'document.manage',
    ],
  },
  {
    name: 'Procurement Officer',
    description: 'Runs procurement: POs, PIs, shipments, receipt, landed cost',
    permissions: [
      'counterparty.read', 'counterparty.manage', 'po.read', 'po.create', 'po.submit', 'pi.read',
      'pi.review', 'shipment.read', 'shipment.manage', 'shipment.receive', 'landedcost.manage',
      'unit.read', 'movement.read', 'sparepart.read', 'product.read', 'costdata.view',
      'document.read', 'document.manage',
    ],
  },
  {
    name: 'Warehouse Manager',
    description: 'Owns the warehouse: receipt, units, assembly oversight, delivery',
    permissions: [
      'shipment.read', 'shipment.receive', 'unit.read', 'unit.adjust', 'unit.transfer',
      'movement.read', 'sparepart.read', 'sparepart.manage', 'product.read', 'assembly.read',
      'assembly.perform', 'salesorder.read', 'delivery.manage', 'return.manage', 'costdata.view',
      'report.stocks', 'conflict.resolve', 'document.read',
    ],
  },
  {
    name: 'Assembly Floor Supervisor',
    description: 'Performs assembly jobs',
    permissions: ['unit.read', 'assembly.read', 'assembly.perform', 'sparepart.read', 'product.read'],
  },
  {
    name: 'Head of Sales',
    description: 'Leads sales; pricing, orders, oversight (sees cost/margin)',
    permissions: [
      'customer.read', 'customer.manage', 'pricelist.read', 'pricelist.manage', 'salesorder.read',
      'salesorder.create', 'salesorder.discount', 'payment.record', 'payment.confirm',
      'delivery.manage', 'return.manage', 'unit.read', 'product.read', 'costdata.view',
      'report.revenue', 'report.customers', 'document.read',
    ],
  },
  {
    name: 'Sales Manager',
    description: 'Manages sales operations; confirms payments, authorises release',
    permissions: [
      'customer.read', 'customer.manage', 'pricelist.read', 'pricelist.manage', 'salesorder.read',
      'salesorder.create', 'salesorder.discount', 'payment.confirm', 'delivery.manage',
      'return.manage', 'unit.read', 'product.read', 'costdata.view', 'report.revenue',
      'report.customers', 'document.read',
    ],
  },
  {
    name: 'Sales Officer (Warehouse)',
    description: 'Front-line sales; creates orders, records payments. NO cost visibility.',
    permissions: [
      'customer.read', 'customer.manage', 'pricelist.read', 'salesorder.read', 'salesorder.create',
      'payment.record', 'unit.read', 'product.read', 'document.read',
    ],
  },
  {
    name: 'Stock Auditor',
    description: 'Audits inventory; reads units, movements, spare parts, stocks report',
    permissions: [
      'unit.read', 'movement.read', 'sparepart.read', 'product.read', 'report.stocks', 'document.read',
    ],
  },
  {
    name: 'Quality Assurance',
    description: 'Inspects units; can adjust status for damage/repair',
    permissions: ['unit.read', 'unit.adjust', 'movement.read', 'assembly.read', 'product.read', 'document.read'],
  },
  {
    name: 'Internal Auditor / Compliance',
    description: 'Reads the audit log and all reports',
    permissions: [
      'audit.read', 'report.stocks', 'report.revenue', 'report.customers', 'unit.read',
      'movement.read', 'salesorder.read', 'po.read', 'product.read', 'document.read',
    ],
  },
  {
    name: 'IT Admin',
    description: 'Full system administration',
    permissions: ['*'],
  },
];

// ----------------------------------------------------------------------------
// Users. passwordHash is the placeholder; reporting hierarchy wired by email.
// ----------------------------------------------------------------------------
const USERS: {
  email: string;
  fullName: string;
  roles: string[];
  reportsTo?: string;
}[] = [
  { email: 'theresa@enviable.example', fullName: 'Theresa Nwaubani', roles: ['Executive Director'] },
  {
    email: 'daniel@enviable.example',
    fullName: 'Daniel Omage',
    roles: ['Executive Assistant to ED', 'Procurement Officer'],
    reportsTo: 'theresa@enviable.example',
  },
  {
    email: 'ikenna@enviable.example',
    fullName: 'Ikenna Okoye',
    roles: ['General Manager'],
    reportsTo: 'theresa@enviable.example',
  },
  {
    email: 'kelechi@enviable.example',
    fullName: 'Kelechi Ekuru',
    roles: ['Warehouse Manager'],
    reportsTo: 'ikenna@enviable.example',
  },
  { email: 'itadmin@enviable.example', fullName: 'System Administrator', roles: ['IT Admin'] },
];

async function main() {
  console.log('Seeding Enviable reference data...');

  // Permissions
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description, category: p.category },
      create: p,
    });
  }
  const allPermissions = await prisma.permission.findMany();
  console.log(`  permissions: ${allPermissions.length}`);

  // Roles + grants
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description, isSystemRole: true },
      create: { name: r.name, description: r.description, isSystemRole: true },
    });
    const keys = r.permissions.includes('*')
      ? allPermissions.map((p) => p.key)
      : r.permissions;
    for (const key of keys) {
      const perm = allPermissions.find((p) => p.key === key);
      if (!perm) throw new Error(`Role ${r.name} references unknown permission ${key}`);
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
  console.log(`  roles: ${ROLES.length}`);

  // Users (NEVER reset passwordHash on update; only fullName)
  for (const u of USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { fullName: u.fullName },
      create: { email: u.email, fullName: u.fullName, passwordHash: PLACEHOLDER_HASH },
    });
  }
  // Wire reporting hierarchy + roles
  for (const u of USERS) {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: u.email } });
    if (u.reportsTo) {
      const mgr = await prisma.user.findUniqueOrThrow({ where: { email: u.reportsTo } });
      await prisma.user.update({ where: { id: user.id }, data: { reportsToUserId: mgr.id } });
    }
    for (const roleName of u.roles) {
      const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: {},
        create: { userId: user.id, roleId: role.id },
      });
    }
  }
  console.log(`  users: ${USERS.length}`);

  // Counterparties
  const tvs = await prisma.counterparty.upsert({
    where: { id: 'seed-cp-tvs' },
    update: { name: 'TVS Motor Company Limited' },
    create: {
      id: 'seed-cp-tvs',
      name: 'TVS Motor Company Limited',
      type: 'MANUFACTURER',
      contact: { country: 'India' } as Prisma.InputJsonValue,
    },
  });
  const vsk = await prisma.counterparty.upsert({
    where: { id: 'seed-cp-vsk' },
    update: { name: 'VSK Motors and Traders FZE' },
    create: {
      id: 'seed-cp-vsk',
      name: 'VSK Motors and Traders FZE',
      type: 'SUPPLIER',
      contact: { country: 'United Arab Emirates' } as Prisma.InputJsonValue,
    },
  });
  console.log(`  counterparties: TVS=${tvs.id}, VSK=${vsk.id}`);

  // Products + variants (from PI ORD0000023649)
  const gsPlus = await prisma.product.upsert({
    where: { id: 'seed-prod-gsplus' },
    update: { name: 'TVS King GS+' },
    create: { id: 'seed-prod-gsplus', name: 'TVS King GS+', manufacturerId: tvs.id, category: 'PASSENGER' },
  });
  const zsPlus = await prisma.product.upsert({
    where: { id: 'seed-prod-zsplus' },
    update: { name: 'TVS King ZS+' },
    create: { id: 'seed-prod-zsplus', name: 'TVS King ZS+', manufacturerId: tvs.id, category: 'PASSENGER' },
  });

  const VARIANTS: {
    id: string;
    productId: string;
    sku: string;
    attrs: Record<string, string>;
    marketPrice: string;
  }[] = [
    { id: 'seed-var-gs-ecogreen', productId: gsPlus.id, sku: 'GSP-ECO-GREEN', attrs: { model: 'GS+', colour: 'Eco Green' }, marketPrice: '2800000.00' },
    { id: 'seed-var-gs-nepblue', productId: gsPlus.id, sku: 'GSP-NEP-BLUE', attrs: { model: 'GS+', colour: 'NEP Blue' }, marketPrice: '2800000.00' },
    { id: 'seed-var-gs-winered', productId: gsPlus.id, sku: 'GSP-NF-WINE-RED', attrs: { model: 'GS+', colour: 'NF Wine Red' }, marketPrice: '2800000.00' },
    { id: 'seed-var-gs-gyellow', productId: gsPlus.id, sku: 'GSP-G-YELLOW', attrs: { model: 'GS+', colour: 'G Yellow' }, marketPrice: '2800000.00' },
    { id: 'seed-var-zs-gyellow', productId: zsPlus.id, sku: 'ZSP-G-YELLOW', attrs: { model: 'ZS+', colour: 'G Yellow' }, marketPrice: '3500000.00' },
  ];
  for (const v of VARIANTS) {
    await prisma.productVariant.upsert({
      where: { id: v.id },
      update: { supplierSkuCode: v.sku, currentMarketPrice: v.marketPrice },
      create: {
        id: v.id,
        productId: v.productId,
        supplierSkuCode: v.sku,
        variantAttributes: v.attrs as Prisma.InputJsonValue,
        currentMarketPrice: v.marketPrice,
      },
    });
  }
  console.log(`  variants: ${VARIANTS.length}`);

  // Customer tiers
  const tierStd = await prisma.customerTier.upsert({
    where: { name: 'ResellerStandard' },
    update: {},
    create: { name: 'ResellerStandard', description: 'Standard reseller pricing' },
  });
  const tierVol = await prisma.customerTier.upsert({
    where: { name: 'ResellerVolume' },
    update: {},
    create: { name: 'ResellerVolume', description: 'Volume reseller pricing' },
  });

  // Current price per variant per tier (illustrative)
  const dbVariants = await prisma.productVariant.findMany();
  for (const v of dbVariants) {
    const base = v.currentMarketPrice;
    for (const [tier, factor] of [
      [tierStd, '1.00'],
      [tierVol, '0.97'],
    ] as const) {
      const existing = await prisma.priceListEntry.findFirst({
        where: { productVariantId: v.id, customerTierId: tier.id, effectiveTo: null },
      });
      if (!existing) {
        const price = new Prisma.Decimal(base).mul(new Prisma.Decimal(factor)).toDecimalPlaces(2);
        await prisma.priceListEntry.create({
          data: { productVariantId: v.id, customerTierId: tier.id, price },
        });
      }
    }
  }
  console.log('  price list: current entries ensured per variant/tier');

  // Payment methods
  await prisma.paymentMethod.upsert({
    where: { id: 'seed-pm-bank' },
    update: { name: 'Bank Transfer' },
    create: { id: 'seed-pm-bank', name: 'Bank Transfer', methodType: 'BANK_TRANSFER', status: 'ACTIVE' },
  });
  await prisma.paymentMethod.upsert({
    where: { id: 'seed-pm-pos' },
    update: { name: 'POS Terminal' },
    create: { id: 'seed-pm-pos', name: 'POS Terminal', methodType: 'POS_TERMINAL', status: 'INACTIVE' },
  });
  console.log('  payment methods: Bank Transfer (active), POS Terminal (inactive)');

  // Warehouse
  await prisma.warehouse.upsert({
    where: { id: 'seed-wh-lagos' },
    update: { name: 'Lagos Main' },
    create: {
      id: 'seed-wh-lagos',
      name: 'Lagos Main',
      address: { street: '52 Saka Tinubu Street', area: 'Victoria Island', city: 'Lagos', country: 'Nigeria' } as Prisma.InputJsonValue,
      status: 'ACTIVE',
    },
  });
  console.log('  warehouse: Lagos Main');

  // Feature toggles (all off / placeholder at MVP)
  const TOGGLES: { key: string; description: string; value: Prisma.InputJsonValue }[] = [
    { key: 'discount.requiresApprovalAbove', description: 'Discount amount above which approval is required', value: { enabled: false, threshold: 0 } },
    { key: 'channel.retailPos', description: 'Enable retail POS channel (Phase 2)', value: { enabled: false } },
    { key: 'warehouse.multiSite', description: 'Enable multi-warehouse (Phase 2)', value: { enabled: false } },
  ];
  for (const t of TOGGLES) {
    await prisma.featureToggle.upsert({
      where: { key: t.key },
      update: { description: t.description },
      create: { key: t.key, description: t.description, value: t.value },
    });
  }
  console.log(`  feature toggles: ${TOGGLES.length}`);

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
