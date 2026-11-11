import type { Purchase } from './types';

export const dateToday = () => toDateString(new Date());

export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) || toDateString(date) !== value ? null : date;
}

export function addDays(date: string, days: number): string {
  const parsed = parseDate(date) ?? new Date();
  parsed.setDate(parsed.getDate() + days);
  return toDateString(parsed);
}

export function daysUntil(date: string): number {
  const parsed = parseDate(date);
  if (!parsed) return Number.POSITIVE_INFINITY;
  const today = parseDate(dateToday())!;
  return Math.round((parsed.getTime() - today.getTime()) / 86400000);
}

export function displayDate(value: string): string {
  const parsed = parseDate(value);
  return parsed ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Not set';
}

export const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export function purchaseUrgency(p: Purchase): 'safe' | 'soon' | 'expired' | 'done' {
  if (p.status !== 'active') return 'done';
  if (!p.returnDeadline) return 'safe';
  const days = daysUntil(p.returnDeadline);
  return days < 0 ? 'expired' : days <= 7 ? 'soon' : 'safe';
}

export function deadlineLabel(p: Purchase): string {
  if (p.status === 'returned') return 'Returned';
  if (p.status === 'kept') return 'Keeping';
  if (!p.returnDeadline) return 'No return date';
  const days = daysUntil(p.returnDeadline);
  if (days < 0) return 'Return expired';
  if (days === 0) return 'Due today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}
