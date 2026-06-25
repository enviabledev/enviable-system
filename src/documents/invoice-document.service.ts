import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OverpaymentResolution,
  PaymentStatus,
  Prisma,
  ProductType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { amountInWords } from './amount-in-words';
import { BankAccount, CompanyProfile, loadCompanyProfile } from './company-profile';
import {
  addDays,
  addressHtml,
  currencyMeta,
  formatAmount,
  formatDate,
  formatMoney,
} from './formatting';

/** A metadata cell whose value may be a real datum or an honest placeholder. */
interface MetaCell {
  value: string;
  /** false => the value is a placeholder for a field the system does not store. */
  known: boolean;
}

const UNKNOWN = 'Not provided'; // honest placeholder for fields the system does not capture
const DEFAULT_UOM = 'UNIT';

@Injectable()
export class InvoiceDocumentService {
  private readonly company: CompanyProfile;
  private readonly salesCurrency: string;
  private readonly defaultNetDays: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.company = loadCompanyProfile(config);
    // Sales are transacted in Naira; there is no currency column on Invoice yet
    // (see BACKLOG). Overridable so this is a deliberate default, not a hard-code.
    this.salesCurrency = (config.get<string>('INVOICE_SALES_CURRENCY') || 'NGN').toUpperCase();
    const net = Number(config.get<string>('INVOICE_DEFAULT_NET_DAYS'));
    this.defaultNetDays = Number.isFinite(net) && net > 0 ? net : 14;
  }

  // ── Sales invoice (Direction A) ────────────────────────────────────────────

  async buildSalesInvoiceContext(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        salesOrder: {
          include: {
            customer: true,
            createdBy: true,
            lines: { include: { productVariant: { include: { product: true } } } },
          },
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    const so = invoice.salesOrder;
    const customer = so.customer;
    const currency = this.salesCurrency;

    const lines = this.groupSalesLines(so.lines).map((g, i) => ({
      idx: i + 1,
      desc: g.description,
      sku: g.sku,
      uom: DEFAULT_UOM,
      qty: g.qty,
      unitPrice: formatAmount(g.unitPrice),
      amount: formatAmount(g.amount),
    }));

    const dueDate = addDays(invoice.issueDate, this.defaultNetDays);
    const salesperson = so.createdBy?.fullName ?? '';
    const customerAddress = this.jsonAddressLines(customer.address);

    const payment = await this.buildPaymentSummary(so.id, invoice.total, currency);

    const vatRatePct = invoice.vatRate
      .mul(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toString();

    return {
      filename: `${invoice.invoiceNumber}.pdf`,
      currencySymbol: currencyMeta(currency).symbol,
      company: this.companyContext(),
      doc: {
        title: 'SALES INVOICE',
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: formatDate(invoice.issueDate),
        dueDate: formatDate(dueDate),
        salesOrder: so.soNumber,
      },
      billTo: {
        name: customer.name,
        addressHtml: addressHtml([
          ...customerAddress,
          customer.taxId ? `TIN: ${customer.taxId}` : null,
          customer.phone ?? null,
        ]),
      },
      // No delivery address is stored separately from billing (see BACKLOG), so
      // Ship To mirrors Bill To and is labelled as the customer's own site.
      shipTo: {
        name: customer.name,
        addressHtml: addressHtml(customerAddress),
      },
      meta: {
        customerCode: this.unknownCell(),
        customerPO: this.unknownCell(),
        paymentTerms: { value: `Net ${this.defaultNetDays} Days`, known: true } as MetaCell,
        salesperson: salesperson
          ? ({ value: salesperson, known: true } as MetaCell)
          : this.unknownCell(),
      },
      lines,
      totals: {
        subtotal: formatMoney(so.subtotal, currency),
        vatLabel: `VAT @ ${vatRatePct}%`,
        vatAmount: formatMoney(invoice.vatAmount, currency),
        grandTotal: formatMoney(invoice.total, currency),
      },
      payment,
      amountInWords: amountInWords(invoice.total, currency),
      signatories: {
        preparedBy: salesperson ? `Sales Desk · ${salesperson}` : 'Sales Desk',
        preparedDate: formatDate(invoice.issueDate),
        approvedBy: 'Accounts Department',
        receivedBy: 'Customer signature & stamp',
      },
      terms: {
        stamp: 'Goods once sold are not eligible for return or exchange.',
        note: 'This is a system-generated invoice and is valid without signature.',
      },
      bank: this.bankContext(this.bankForLines(so.lines)),
    };
  }

  // ── Sales-side proforma invoice (Direction C design, sales data) ───────────

  /**
   * Customer-facing proforma invoice (Enviable -> customer), bound to the
   * SalesOrder the PI documents. Reuses the Direction C branded-band template
   * with sales-correct labels: Enviable is the seller ("From"), the customer is
   * "Bill To", and the payment box carries Enviable's own bank for the customer
   * to pay into. Distinct from buildProformaInvoiceContext, which binds the
   * procurement-side (supplier -> Enviable) PI.
   */
  async buildSalesProformaInvoiceContext(salesPiId: string) {
    const pi = await this.prisma.salesProformaInvoice.findUnique({
      where: { id: salesPiId },
      include: {
        issuedBy: { select: { fullName: true } },
        salesOrder: {
          include: {
            customer: true,
            lines: { include: { productVariant: { include: { product: true } } } },
          },
        },
      },
    });
    if (!pi) {
      throw new NotFoundException(`Sales proforma invoice ${salesPiId} not found`);
    }

    const so = pi.salesOrder;
    const customer = so.customer;
    const currency = this.salesCurrency;

    const lines = this.groupSalesLines(so.lines).map((g, i) => ({
      idx: i + 1,
      desc: g.description,
      sku: g.sku,
      uom: DEFAULT_UOM,
      qty: g.qty,
      unitPrice: formatAmount(g.unitPrice),
      amount: formatAmount(g.amount),
    }));

    const totalRows: Array<{ label: string; value: string }> = [
      { label: 'Sub-Total', value: formatMoney(so.subtotal, currency) },
    ];
    if (so.discountTotal.gt(0)) {
      totalRows.push({
        label: 'Discount',
        value: `- ${formatMoney(so.discountTotal, currency)}`,
      });
    }
    totalRows.push({ label: 'VAT @ 7.5%', value: formatMoney(so.vatAmount, currency) });

    const customerAddress = this.jsonAddressLines(customer.address);

    return {
      filename: `${pi.piNumber}.pdf`,
      currencySymbol: currencyMeta(currency).symbol,
      company: { name: this.company.name },
      doc: {
        piNumber: pi.piNumber,
        issueDate: formatDate(pi.issuedAt),
        salesOrder: so.soNumber,
        totalValue: formatMoney(so.total, currency),
      },
      from: {
        name: this.company.name,
        addressHtml: addressHtml([
          ...this.company.addressLines,
          `RC ${this.company.rcNo} · TIN ${this.company.tin}`,
        ]),
      },
      billTo: {
        name: customer.name,
        addressHtml: addressHtml([
          ...customerAddress,
          customer.taxId ? `TIN: ${customer.taxId}` : null,
          customer.phone ?? null,
        ]),
      },
      lines,
      totals: { rows: totalRows, grandTotal: formatMoney(so.total, currency) },
      amountInWords: amountInWords(so.total, currency),
      payment: { html: this.salesProformaPaymentHtml(this.bankForLines(so.lines)) },
      authorisation: pi.issuedBy
        ? `Issued: ${pi.issuedBy.fullName} · ${formatDate(pi.issuedAt)}`
        : `Issued: ${formatDate(pi.issuedAt)}`,
      terms: {
        note: 'This is a system-generated document and is valid without signature.',
      },
    };
  }

  // ── Proforma invoice (Direction C) ─────────────────────────────────────────

  async buildProformaInvoiceContext(proformaId: string) {
    const pi = await this.prisma.proformaInvoice.findUnique({
      where: { id: proformaId },
      include: {
        approvedBy: true,
        purchaseOrder: { include: { supplier: true } },
        lines: { include: { productVariant: { include: { product: true } } } },
      },
    });
    if (!pi) {
      throw new NotFoundException(`Proforma invoice ${proformaId} not found`);
    }

    const po = pi.purchaseOrder;
    const supplier = po.supplier;
    const currency = (po.currency || 'USD').toUpperCase();

    const lines = pi.lines.map((line, i) => ({
      idx: i + 1,
      desc: this.describeVariant(line.productVariant),
      sku: line.productVariant.supplierSkuCode,
      uom: DEFAULT_UOM,
      qty: line.quantity,
      unitPrice: formatAmount(line.unitPrice),
      amount: formatAmount(line.lineTotal),
    }));

    const goods = pi.lines.reduce(
      (acc, line) => acc.add(line.lineTotal),
      new Prisma.Decimal(0),
    );

    const totalRows: Array<{ label: string; value: string }> = [
      { label: 'Goods Sub-Total', value: formatMoney(goods, currency) },
    ];
    if (pi.freightAmount.gt(0)) {
      totalRows.push({ label: 'Freight', value: formatMoney(pi.freightAmount, currency) });
    }
    if (pi.insuranceAmount.gt(0)) {
      totalRows.push({
        label: 'Marine Insurance',
        value: formatMoney(pi.insuranceAmount, currency),
      });
    }

    return {
      filename: `${pi.piNumber}-rev${pi.revisionNumber}.pdf`,
      currencySymbol: currencyMeta(currency).symbol,
      company: { name: this.company.name },
      doc: {
        piNumber: `${pi.piNumber} · Rev ${pi.revisionNumber}`,
        issueDate: pi.issueDate ? formatDate(pi.issueDate) : UNKNOWN,
        validUntil: pi.validityUntil ? formatDate(pi.validityUntil) : UNKNOWN,
        purchaseOrder: po.poNumber,
        totalValue: formatMoney(pi.totalValue, currency),
      },
      from: {
        name: supplier.name,
        addressHtml: addressHtml(this.jsonContactLines(supplier.contact)),
      },
      billTo: {
        name: this.company.name,
        addressHtml: addressHtml([
          ...this.company.addressLines,
          `RC ${this.company.rcNo} · TIN ${this.company.tin}`,
        ]),
      },
      lines,
      totals: { rows: totalRows, grandTotal: formatMoney(pi.totalValue, currency) },
      amountInWords: amountInWords(pi.totalValue, currency),
      payment: { html: this.proformaPaymentHtml(pi, supplier) },
      authorisation: pi.approvedBy
        ? `Authorised: ${pi.approvedBy.fullName}${pi.approvedAt ? ` · ${formatDate(pi.approvedAt)}` : ''}`
        : `Status: ${pi.status.replace(/_/g, ' ')}`,
      terms: {
        note: 'This is a system-generated document and is valid without signature.',
      },
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * Payment summary for the sales invoice. Figures are derived from CONFIRMED
   * payments only (received money), consistent with the SO's paymentReceivedTotal
   * derivation. When any confirmed payment carried an overpayment resolution, the
   * excess and its resolution (Refund + mechanism, or Credit) are surfaced. The
   * whole block renders only when there is something to show (`has`), so an
   * invoice issued before any payment is unchanged.
   */
  private async buildPaymentSummary(
    salesOrderId: string,
    total: Prisma.Decimal,
    currency: string,
  ) {
    const payments = await this.prisma.payment.findMany({
      where: { salesOrderId, status: PaymentStatus.CONFIRMED },
    });

    const amountPaid = payments.reduce(
      (acc, p) => acc.add(p.amount),
      new Prisma.Decimal(0),
    );
    const balanceDue = Prisma.Decimal.max(total.minus(amountPaid), 0);

    const overpaid = payments.filter((p) => p.overpaymentResolution != null);
    const overpaymentTotal = overpaid.reduce(
      (acc, p) => acc.add(p.overpaymentAmount ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );

    let overpayment: {
      amount: string;
      resolutionLabel: string;
      note: string;
    } | null = null;
    if (overpaymentTotal.gt(0)) {
      const labels = [
        ...new Set(
          overpaid.map((p) =>
            p.overpaymentResolution === OverpaymentResolution.REFUND
              ? `Refund${p.refundMechanism ? ` (${p.refundMechanism.replace(/_/g, ' ')})` : ''}`
              : 'Credit',
          ),
        ),
      ];
      const note =
        overpaid
          .map((p) => p.refundReference || p.creditNotes || '')
          .find((n) => n.length > 0) ?? '';
      overpayment = {
        amount: formatMoney(overpaymentTotal, currency),
        resolutionLabel: labels.join(', '),
        note,
      };
    }

    return {
      has: amountPaid.gt(0) || overpayment != null,
      amountPaid: formatMoney(amountPaid, currency),
      balanceDue: formatMoney(balanceDue, currency),
      overpayment,
    };
  }

  /**
   * Route to Enviable's bank account for the order's wheeler type. A sales order
   * is single-product-type, so the first line's variant type determines it;
   * defaults to THREE_WHEELER for an empty line set (defensive).
   */
  private bankForLines(
    lines: Array<{ productVariant: { productType: ProductType } }>,
  ): BankAccount {
    const type = lines[0]?.productVariant.productType ?? ProductType.THREE_WHEELER;
    return this.company.banks[type];
  }

  private bankContext(bank: BankAccount) {
    return {
      name: bank.bankName,
      accountName: bank.accountName,
      accountNumber: bank.accountNumber,
      sortCode: bank.sortCode,
    };
  }

  private companyContext() {
    return {
      name: this.company.name,
      addressHtml: addressHtml(this.company.addressLines),
      tel: this.company.tel,
      email: this.company.email,
      rcNo: this.company.rcNo,
      tin: this.company.tin,
    };
  }

  private unknownCell(): MetaCell {
    return { value: UNKNOWN, known: false };
  }

  /**
   * One SalesOrderLine is one Unit (no quantity column). The customer-facing
   * invoice presents quantities, so identical units (same variant at the same
   * unit price) are aggregated into a single priced line with a count.
   */
  private groupSalesLines(
    lines: Array<{
      productVariantId: string;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      productVariant: { supplierSkuCode: string; variantAttributes: Prisma.JsonValue; product: { name: string } };
    }>,
  ) {
    const groups = new Map<
      string,
      { description: string; sku: string; unitPrice: Prisma.Decimal; qty: number; amount: Prisma.Decimal }
    >();
    for (const line of lines) {
      const key = `${line.productVariantId}__${line.unitPrice.toString()}`;
      const existing = groups.get(key);
      if (existing) {
        existing.qty += 1;
        existing.amount = existing.amount.add(line.lineTotal);
      } else {
        groups.set(key, {
          description: this.describeVariant(line.productVariant),
          sku: line.productVariant.supplierSkuCode,
          unitPrice: line.unitPrice,
          qty: 1,
          amount: line.lineTotal,
        });
      }
    }
    return [...groups.values()];
  }

  /** Product name plus any readable variant attribute values (e.g. "TVS King - Yellow"). */
  private describeVariant(variant: {
    variantAttributes: Prisma.JsonValue;
    product: { name: string };
  }): string {
    const attrs = this.readableJsonValues(variant.variantAttributes);
    return attrs.length > 0 ? `${variant.product.name} - ${attrs.join(', ')}` : variant.product.name;
  }

  /** Pull scalar values out of a flat JSON object for inline display. */
  private readableJsonValues(json: Prisma.JsonValue): string[] {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
    return Object.values(json as Record<string, unknown>)
      .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0);
  }

  /** Best-effort address-line extraction from an untyped Customer.address JSON. */
  private jsonAddressLines(json: Prisma.JsonValue): string[] {
    if (!json) return [];
    if (typeof json === 'string') return [json];
    if (typeof json !== 'object' || Array.isArray(json)) return [];
    const o = json as Record<string, unknown>;
    const pick = (...keys: string[]): string[] =>
      keys
        .map((k) => o[k])
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim());
    const line1 = pick('line1', 'street', 'address1', 'address');
    const line2 = pick('line2', 'address2');
    const cityState = pick('city', 'state', 'region').join(', ');
    const country = pick('country');
    const lines = [...line1, ...line2];
    if (cityState) lines.push(cityState);
    lines.push(...country);
    // If nothing matched the known keys, fall back to all scalar values.
    return lines.length > 0 ? lines : this.readableJsonValues(json);
  }

  /** Best-effort contact-line extraction from an untyped Counterparty.contact JSON. */
  private jsonContactLines(json: Prisma.JsonValue): string[] {
    const lines = this.jsonAddressLines(json);
    return lines.length > 0 ? lines : [];
  }

  /**
   * Payment box for the sales-side PI: Enviable's bank for the customer to pay
   * into, plus a payment instruction. The account is routed by the sales order's
   * wheeler type (one account per type); the caller resolves it via bankForLines.
   */
  private salesProformaPaymentHtml(bank: BankAccount): string {
    return [
      `<b>${this.escape(bank.bankName)}</b>`,
      `Account Name: ${this.escape(bank.accountName)}`,
      `Account Number: ${this.escape(bank.accountNumber)}`,
      `Sort Code: ${this.escape(bank.sortCode)}`,
      'Please quote the PI number on your transfer and send proof of payment to confirm your order.',
    ].join('<br/>');
  }

  private proformaPaymentHtml(
    pi: { paymentTerms: string | null; portOfLoading: string | null; portOfDischarge: string | null },
    supplier: { bankDetails: Prisma.JsonValue },
  ): string {
    const bankLines = this.readableJsonValues(supplier.bankDetails);
    const parts: string[] = [];
    if (bankLines.length > 0) parts.push(`<b>${this.escape(bankLines[0])}</b>`);
    const rest = bankLines.slice(1).map((l) => this.escape(l));
    const tail: string[] = [];
    if (pi.paymentTerms) tail.push(`Terms: ${this.escape(pi.paymentTerms)}`);
    const ports = [pi.portOfLoading, pi.portOfDischarge].filter(Boolean) as string[];
    if (ports.length > 0) tail.push(`Port: ${this.escape(ports.join(' to '))}`);
    return [...parts, ...rest, ...tail].join('<br/>') || 'Per purchase order terms';
  }

  private escape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
