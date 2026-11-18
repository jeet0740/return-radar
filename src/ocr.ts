import { recognizeText } from 'expo-ocr-kit';
import { parseDate } from './utils';

export type ReceiptScan = { store: string; date: string | null; total: number | null; rawText: string };

function extractDate(lines: string[]): string | null {
  const currentYear = new Date().getFullYear();
  for (const line of lines) {
    const match = line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (!match) continue;
    let y: number, m: number, d: number;
    if (match[1]) { y = Number(match[1]); m = Number(match[2]); d = Number(match[3]); }
    else {
      m = Number(match[4]); d = Number(match[5]); y = Number(match[6]);
      if (y < 100) y += 2000;
    }
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (parseDate(iso) && y >= 2000 && y <= currentYear + 1) return iso;
  }
  return null;
}

function extractTotal(lines: string[]): number | null {
  const moneyPattern = /(?:\$\s*)?(\d{1,5}(?:,\d{3})*\.\d{2})\b/g;
  const candidates: { amount: number; score: number; index: number }[] = [];
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    const totalLabel = /\b(grand total|amount due|balance due|total paid|total amount|total)\b/.test(lower);
    const excluded = /\b(subtotal|sub total|tax|discount|change|cash back|savings|tip|tendered|payment method)\b/.test(lower);
    for (const match of line.matchAll(moneyPattern)) {
      const amount = Number(match[1].replace(/,/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      candidates.push({ amount, score: (totalLabel ? 10 : 0) - (excluded ? 15 : 0), index });
    }
  });
  candidates.sort((a, b) => b.score - a.score || b.index - a.index);
  return candidates[0]?.score >= 10 ? candidates[0].amount : null;
}

function extractStore(lines: string[]): string {
  const header = lines.slice(0, 6).map(x => x.trim()).filter(Boolean);
  const result = header.find(line =>
    line.length >= 3 && line.length <= 48 &&
    /[a-zA-Z]{3}/.test(line) &&
    !/\b(receipt|invoice|welcome|thank you|date|time|cashier|store #|transaction|phone|www\.|https?:|subtotal|total|tax)\b/i.test(line) &&
    !/^\d/.test(line) &&
    !/\d{3}[-.) ]\d{3}[-. ]\d{4}/.test(line)
  );
  return result ?? '';
}

export function parseReceiptText(rawText: string): ReceiptScan {
  const lines = rawText.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return { store: extractStore(lines), date: extractDate(lines), total: extractTotal(lines), rawText };
}

export async function scanReceipt(uri: string): Promise<ReceiptScan> {
  if (!uri) throw new Error('Receipt image is missing.');
  const result = await recognizeText(uri);
  return parseReceiptText(result.text ?? '');
}
