import { recognizeText } from 'expo-ocr-kit';
import { parseDate } from './utils';

export type ReceiptItem = { title: string; price: number };
export type ReceiptScan = { items: ReceiptItem[]; returnDays: number | null; store: string; date: string | null; total: number | null; rawText: string };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function validDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const iso = [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
  return year >= 2000 && year <= new Date().getFullYear() + 1 && parseDate(iso) ? iso : null;
}

function extractDate(lines: string[]): string | null {
  for (const line of lines) {
    const named = line.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2}|\d{2})\b/i);
    if (named) {
      const date = validDate(Number(named[3]), MONTHS[named[1].slice(0, 3).toLowerCase()], Number(named[2]));
      if (date) return date;
    }
    const iso = line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
    if (iso) {
      const date = validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      if (date) return date;
    }
    const us = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2}|\d{2})\b/);
    if (us) {
      const date = validDate(Number(us[3]), Number(us[1]), Number(us[2]));
      if (date) return date;
    }
  }
  return null;
}

function amounts(line: string): number[] {
  // Handle "$88.46", "88.46", "88,46", and OCR inserting spaces after "$".
  const matches = [...line.matchAll(/(?:[$]\s*)?(\d{1,3}(?:,\d{3})*|\d{1,6})[.,](\d{2})(?!\d)/g)];
  return matches.map(m => Number(m[1].replace(/,/g, '') + '.' + m[2])).filter(n => n > 0 && n < 1000000);
}

function extractTotal(lines: string[]): number | null {
  const normalized = lines.map(x => x.replace(/\s+/g, ' ').trim());
  const totalLabel = /\b(grand\s*total|total\s*amount|amount\s*due|balance\s*due|total\s*paid|total)\b/i;
  const exclude = /\b(sub\s*total|subtotal|tax|savings|discount|change|cash\s*back|tip)\b/i;
  const candidates: { value: number; score: number; index: number }[] = [];
  normalized.forEach((line, index) => {
    if (!totalLabel.test(line) || exclude.test(line)) return;
    const own = amounts(line);
    for (const value of own) candidates.push({ value, score: 10, index });
    // Vision OCR sometimes puts "Total" and "$88.46" on separate lines.
    if (!own.length && normalized[index + 1]) {
      for (const value of amounts(normalized[index + 1])) candidates.push({ value, score: 7, index });
    }
  });
  candidates.sort((a, b) => b.score - a.score || b.index - a.index);
  return candidates[0]?.value ?? null;
}

function extractStore(lines: string[]): string {
  const header = lines.slice(0, 12).map(x => x.trim()).filter(Boolean);
  // Recognize common retailer wordmarks even if the OCR separates logo and address.
  const brands = [
    ['TARGET', /\btarget\b/i], ['WALMART', /\bwalmart\b/i], ['COSTCO', /\bcostco\b/i],
    ['CVS', /\bcvs\b/i], ['WALGREENS', /\bwalgreens\b/i], ['BEST BUY', /\bbest\s*buy\b/i],
    ['HOME DEPOT', /\bhome\s*depot\b/i], ['LOWE\'S', /\blowe'?s\b/i],
    ['KROGER', /\bkroger\b/i], ['MACY\'S', /\bmacy'?s\b/i],
    ['TJ MAXX', /\bt\.?j\.?\s*maxx\b/i], ['STARBUCKS', /\bstarbucks\b/i],
  ] as const;
  for (const [name, pattern] of brands) {
    if (header.some(line => pattern.test(line))) return name;
  }
  const candidate = header.find(line =>
    line.length >= 3 && line.length <= 45 &&
    /[a-zA-Z]{3}/.test(line) &&
    !/^\d/.test(line) &&
    !/\b(receipt|invoice|welcome|thank|date|time|cashier|register|trans|store\s*#|phone|subtotal|total|tax|visa|mastercard|credit|debit|auth|circle|earnings)\b/i.test(line) &&
    !/\b(st|street|ave|avenue|road|rd|blvd|highway|hwy|drive|dr|suite|zip)\b/i.test(line) &&
    !/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(line) &&
    !/\(\d{3}\)\s*\d{3}/.test(line) &&
    !/https?:|www\.|@/.test(line)
  );
  return candidate ?? '';
}

export function parseReceiptText(rawText: string): ReceiptScan {
  const lines = rawText.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const items: ReceiptItem[] = [];
  const excluded = /\b(total|subtotal|tax|visa|mastercard|cash|change|discount|saved|savings|balance|payment|debit|credit|auth|date|time|register|transaction|store|receipt|points|earnings|return|exchange)\b/i;
  const metadata = /^(?:qty|quantity|sku|upc|item\s*(?:#|no\.?))\b|^\d{2,}(?:[- ]\d+)+/i;
  const priceOnly = /^\$?\s*(\d+(?:,\d{3})*\.\d{2})$/;
  let pending = '';
  for (const line of lines) {
    if (/\bsub\s*total\b/i.test(line)) break;
    if (excluded.test(line)) { pending = ''; continue; }
    const match = line.match(/^(.+?)\s+\$?\s*(\d+(?:,\d{3})*\.\d{2})$/);
    const standalone = line.match(priceOnly);
    const label = match ? match[1].trim() : line;
    const isMetadata = metadata.test(label);
    const isName = !isMetadata && /^[a-zA-Z]/.test(label) && /[a-zA-Z]{3}/.test(label) && !/\b[A-Z]{2}\s+\d{5}\b|https?:|www\./i.test(label);
    if (standalone || match) {
      const title = standalone || isMetadata ? pending : isName ? label : '';
      const price = Number((standalone ? standalone[1] : match![2]).replace(/,/g, ''));
      if (Number.isFinite(price) && price > 0) {
        items.push({ title: title || 'Unidentified product ' + (items.length + 1), price });
        pending = '';
      }
    } else if (isName) {
      pending = label;
    }
  }
  const policy = rawText.match(/(?:return[s]?|exchange[s]?)[\s\S]{0,80}?\b(\d{1,3})\s*days\b/i);
  const days = policy ? Number(policy[1]) : 0;
  return { items, returnDays: days > 0 && days <= 365 ? days : null, store: extractStore(lines), date: extractDate(lines), total: extractTotal(lines), rawText };
}

export async function scanReceipt(uri: string): Promise<ReceiptScan> {
  if (!uri) throw new Error('Receipt image is missing.');
  const result = await recognizeText(uri);
  return parseReceiptText(result.text ?? '');
}
