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
  // 3-wheeler: Globus Bank account (the real tricycle collection account,
  // supplied by Theresa for launch). Sort code is intentionally blank: Nigerian
  // inter-bank (NIP) transfers route on bank name + account number alone, and
  // the bank did not supply one. Documents omit the sort line when it is empty.
  THREE_WHEELER: {
    bankName: 'Globus Bank',
    accountName: 'Enviable Tricycle Auto Parts Limited Account 2',
    accountNumber: '1000503348',
    sortCode: '',
  },
  // 2-wheeler: Globus Bank account, distinct registered name and number.
  TWO_WHEELER: {
    bankName: 'Globus Bank',
    accountName: 'Enviable Tricycles Auto Parts Ltd - 2 Wheeler',
    accountNumber: '1000579033',
    sortCode: '',
  },
};

const DEFAULTS = {
  name: 'Enviable Tricycle Auto Parts Limited',
  addressLines: ['52 Saka Tinubu Street, VI Lagos'],
  // Tel is intentionally blank: no company phone was supplied for launch, and a
  // fabricated number must not print on a tax document. Documents omit the Tel
  // line when it is empty; set INVOICE_COMPANY_TEL once a real line exists.
  tel: '',
  email: 'info@enviabletricycle.com',
  rcNo: '6987445',
  tin: '31405903-0001',
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
