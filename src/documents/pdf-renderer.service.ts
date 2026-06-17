import { existsSync } from 'node:fs';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Browser } from 'puppeteer-core';
import * as puppeteer from 'puppeteer-core';
import { InvoiceDocumentService } from './invoice-document.service';
import { InvoiceTemplateEngine } from './template-engine';

export interface RenderedHtml {
  filename: string;
  html: string;
}

export interface RenderedPdf {
  filename: string;
  pdf: Buffer;
}

/** Common locations of a Chrome/Chromium binary, checked when no path is configured. */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private readonly engine = new InvoiceTemplateEngine();
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;

  constructor(
    private readonly documents: InvoiceDocumentService,
    private readonly config: ConfigService,
  ) {}

  // ── HTML view (the in-app surface; same HTML the PDF is rendered from) ──────

  async renderSalesInvoiceHtml(invoiceId: string): Promise<RenderedHtml> {
    const ctx = await this.documents.buildSalesInvoiceContext(invoiceId);
    return { filename: ctx.filename, html: this.engine.renderSalesInvoice(ctx) };
  }

  async renderProformaInvoiceHtml(proformaId: string): Promise<RenderedHtml> {
    const ctx = await this.documents.buildProformaInvoiceContext(proformaId);
    return { filename: ctx.filename, html: this.engine.renderProformaInvoice(ctx) };
  }

  // ── PDF (rendered from the exact same HTML) ─────────────────────────────────

  async renderSalesInvoicePdf(invoiceId: string): Promise<RenderedPdf> {
    const { filename, html } = await this.renderSalesInvoiceHtml(invoiceId);
    return { filename, pdf: await this.htmlToPdf(html) };
  }

  async renderProformaInvoicePdf(proformaId: string): Promise<RenderedPdf> {
    const { filename, html } = await this.renderProformaInvoiceHtml(proformaId);
    return { filename, pdf: await this.htmlToPdf(html) };
  }

  // ── rendering internals ─────────────────────────────────────────────────────

  private async htmlToPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // The HTML is fully self-contained (fonts + logo are inlined as base64),
      // so there is nothing to fetch; load is instant and, crucially,
      // deterministic. preferCSSPageSize honours the template's `@page A4`.
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluateHandle('document.fonts.ready');
      const pdf = await page.pdf({
        format: 'a4',
        printBackground: true,
        preferCSSPageSize: true,
        // Disable the tagged-PDF structure tree: Chromium numbers its structure
        // elements (`node%08d`) from a session-global counter, so leaving it on
        // makes otherwise-identical renders differ by those ids. Off, the same
        // immutable invoice renders byte-for-byte identically every time.
        tagged: false,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;
    if (this.launching) return this.launching;

    this.launching = (async () => {
      const executablePath = this.resolveChromePath();
      const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      this.browser = browser;
      this.logger.log(`Headless Chromium launched (${executablePath})`);
      return browser;
    })();

    try {
      return await this.launching;
    } finally {
      this.launching = null;
    }
  }

  private resolveChromePath(): string {
    const configured = this.config.get<string>('PUPPETEER_EXECUTABLE_PATH');
    if (configured && configured.trim().length > 0) {
      if (!existsSync(configured)) {
        throw new InternalServerErrorException(
          `PUPPETEER_EXECUTABLE_PATH is set but no binary exists at ${configured}`,
        );
      }
      return configured;
    }
    const found = CHROME_CANDIDATES.find((p) => existsSync(p));
    if (!found) {
      throw new InternalServerErrorException(
        'No Chrome/Chromium binary found for PDF rendering. Set PUPPETEER_EXECUTABLE_PATH.',
      );
    }
    return found;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}
