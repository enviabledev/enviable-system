import { ConfigService } from '@nestjs/config';
import { ProductType } from '@prisma/client';

/** One Enviable bank account, surfaced on customer documents for payment. */
export interface BankAccount {
  bankName: string;
  accountName: string;
  accountNumber: string;
  sortCode: string;
}

/**
 * Company-level data the invoice documents need but the transactional records
 * do not store: the issuer's own identity and bank accounts. There is no
 * company-profile table yet (see BACKLOG: invoice document fields), so this is
 * sourced from configuration with defaults taken from the approved design so a
 * fresh environment renders a complete, correct document out of the box.
 *
 * Every field is overridable via env (INVOICE_COMPANY_* / INVOICE_BANK_*) so an
 * operator can correct the registered details without a code change, and so the
 * eventual DB-backed profile can supersede this with no template changes.
 *
 * Bank accounts are keyed by wheeler type: a customer document routes to the
 * account for the sales order's product type (one account per wheeler type, two
 * total). The values below are PLACEHOLDERS; Theresa supplies the real account
 * details (set via the INVOICE_BANK_2W_* / INVOICE_BANK_3W_* env vars) before
 * launch.
 */
export interface CompanyProfile {
  name: string;
  /** Address lines, rendered <br/>-joined in the document header. */
  addressLines: string[];
  tel: string;
  email: string;
  rcNo: string;
  tin: string;
  banks: Record<ProductType, BankAccount>;
}

const DEFAULT_BANKS: Record<ProductType, BankAccount> = {
  // 3-wheeler keeps the previously-configured single account so existing
  // tricycle documents are unchanged.
  THREE_WHEELER: {
    bankName: 'Zenith Bank PLC',
    accountName: 'Enviable Tricycle Auto Parts Ltd',
    accountNumber: '1014772390',
    sortCode: '057-Apapa',
  },
  // 2-wheeler PLACEHOLDER account; replace before launch.
  TWO_WHEELER: {
    bankName: 'PLACEHOLDER Bank PLC (2-wheeler)',
    accountName: 'Enviable Tricycle Auto Parts Ltd',
    accountNumber: '0000000000',
    sortCode: '000-000',
  },
};

const DEFAULTS = {
  name: 'Enviable Tricycle Auto Parts Ltd',
  addressLines: ['Plot 14B, Apapa-Oshodi Expressway, Apapa, Lagos State, Nigeria'],
  tel: '+234 803 555 0142',
  email: 'sales@enviabletricycle.com',
  rcNo: '1748392',
  tin: '21845-0001',
};

export function loadCompanyProfile(config: ConfigService): CompanyProfile {
  const get = (key: string, fallback: string): string => {
    const raw = config.get<string>(key);
    return raw && raw.trim().length > 0 ? raw.trim() : fallback;
  };
  const bank = (envPrefix: string, fallback: BankAccount): BankAccount => ({
    bankName: get(`${envPrefix}_NAME`, fallback.bankName),
    accountName: get(`${envPrefix}_ACCOUNT_NAME`, fallback.accountName),
    accountNumber: get(`${envPrefix}_ACCOUNT_NUMBER`, fallback.accountNumber),
    sortCode: get(`${envPrefix}_SORT_CODE`, fallback.sortCode),
  });
  const address = config.get<string>('INVOICE_COMPANY_ADDRESS');
  return {
    name: get('INVOICE_COMPANY_NAME', DEFAULTS.name),
    // Address lines are pipe-separated in the single env var so a multi-line
    // address survives a flat configuration store.
    addressLines:
      address && address.trim().length > 0
        ? address.split('|').map((line) => line.trim()).filter(Boolean)
        : DEFAULTS.addressLines,
    tel: get('INVOICE_COMPANY_TEL', DEFAULTS.tel),
    email: get('INVOICE_COMPANY_EMAIL', DEFAULTS.email),
    rcNo: get('INVOICE_COMPANY_RC', DEFAULTS.rcNo),
    tin: get('INVOICE_COMPANY_TIN', DEFAULTS.tin),
    banks: {
      THREE_WHEELER: bank('INVOICE_BANK_3W', DEFAULT_BANKS.THREE_WHEELER),
      TWO_WHEELER: bank('INVOICE_BANK_2W', DEFAULT_BANKS.TWO_WHEELER),
    },
  };
}
