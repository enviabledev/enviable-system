import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Handlebars from 'handlebars';

/**
 * Loads the invoice assets once and compiles the two Handlebars templates. The
 * exact same compiled HTML is handed to BOTH the PDF renderer and the in-app
 * HTML-view endpoint, so the screen view and the printed document cannot drift.
 *
 * Fonts and the logo are embedded as base64 so the rendered HTML is fully
 * self-contained: it needs no network at render time, which is what makes the
 * output deterministic (and lets the HTML view work offline in the PWA shell).
 */
export class InvoiceTemplateEngine {
  private readonly salesTemplate: HandlebarsTemplateDelegate;
  private readonly proformaTemplate: HandlebarsTemplateDelegate;
  /** Constant `<style>...</style>` block: @font-face (base64) + shared stylesheet. */
  private readonly styleBlock: string;
  /** Constant logo as a data URI. */
  private readonly logoDataUri: string;

  constructor(baseDir: string = __dirname) {
    const templatesDir = join(baseDir, 'templates');
    const assetsDir = join(baseDir, 'assets');

    const css = readFileSync(join(templatesDir, 'invoice-styles.css'), 'utf8');
    const interB64 = readFileSync(join(assetsDir, 'fonts', 'inter-latin.woff2')).toString('base64');
    const monoB64 = readFileSync(join(assetsDir, 'fonts', 'jetbrains-mono-latin.woff2')).toString('base64');
    const logoB64 = readFileSync(join(assetsDir, 'tricycle-logo.png')).toString('base64');

    // Inter and JetBrains Mono are variable woff2 (one file spans 400..800), so
    // a single @font-face per family with a weight range is enough.
    const fontFace = `
@font-face { font-family: 'Inter'; font-style: normal; font-weight: 400 800; font-display: swap; src: url(data:font/woff2;base64,${interB64}) format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400 600; font-display: swap; src: url(data:font/woff2;base64,${monoB64}) format('woff2'); }
`;
    this.styleBlock = `<style>${fontFace}\n${css}</style>`;
    this.logoDataUri = `data:image/png;base64,${logoB64}`;

    this.salesTemplate = Handlebars.compile(
      readFileSync(join(templatesDir, 'sales-invoice.hbs'), 'utf8'),
      { noEscape: false },
    );
    this.proformaTemplate = Handlebars.compile(
      readFileSync(join(templatesDir, 'proforma-invoice.hbs'), 'utf8'),
      { noEscape: false },
    );
  }

  private withConstants<T extends object>(context: T): T & { styleBlock: string; logoDataUri: string } {
    return { ...context, styleBlock: this.styleBlock, logoDataUri: this.logoDataUri };
  }

  renderSalesInvoice(context: object): string {
    return this.salesTemplate(this.withConstants(context));
  }

  renderProformaInvoice(context: object): string {
    return this.proformaTemplate(this.withConstants(context));
  }
}
