import { ConfigService } from '@nestjs/config';

/**
 * Company-level data the invoice documents need but the transactional records
 * do not store: the issuer's own identity and bank account. There is no
 * company-profile table yet (see BACKLOG: invoice document fields), so this is
 * sourced from configuration with defaults taken from the approved design so a
 * fresh environment renders a complete, correct document out of the box.
 *
 * Every field is overridable via env (INVOICE_COMPANY_* / INVOICE_BANK_*) so an
 * operator can correct the registered details without a code change, and so the
 * eventual DB-backed profile can supersede this with no template changes.
 */
export interface CompanyProfile {
  name: string;
  /** Address lines, rendered <br/>-joined in the document header. */
  addressLines: string[];
  tel: string;
  email: string;
  rcNo: string;
  tin: string;
  bankName: string;
  bankAccount: string;
}

const DEFAULTS: CompanyProfile = {
  name: 'Enviable Tricycle Auto Parts Ltd',
  addressLines: ['Plot 14B, Apapa-Oshodi Expressway, Apapa, Lagos State, Nigeria'],
  tel: '+234 803 555 0142',
  email: 'sales@enviabletricycle.com',
  rcNo: '1748392',
  tin: '21845-0001',
  bankName: 'Zenith Bank PLC',
  bankAccount: '1014772390 · Apapa',
};

export function loadCompanyProfile(config: ConfigService): CompanyProfile {
  const get = (key: string, fallback: string): string => {
    const raw = config.get<string>(key);
    return raw && raw.trim().length > 0 ? raw.trim() : fallback;
  };
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
    bankName: get('INVOICE_BANK_NAME', DEFAULTS.bankName),
    bankAccount: get('INVOICE_BANK_ACCOUNT', DEFAULTS.bankAccount),
  };
}
