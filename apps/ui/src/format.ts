import type { ProductOffer } from '@apokorg/core';

const sek = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' });
const num = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 });

/** 1234.5 → "1 234,50 kr" */
export function formatSek(value: number): string {
  return sek.format(value);
}

/** { value: 9.75, per: 'st' } → "9,75 kr/st" */
export function formatUnitPrice(unitPrice: ProductOffer['unitPrice']): string {
  if (!unitPrice) return '';
  return `${num.format(unitPrice.value)} kr/${unitPrice.per}`;
}

export function formatNumber(value: number): string {
  return num.format(value);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sv-SE');
}

/** "2026-11-18 14:02" in local time. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

/** Whole days between an ISO date and now. */
export function daysSince(isoDate: string, now = new Date()): number {
  return Math.floor((now.getTime() - new Date(isoDate).getTime()) / 86_400_000);
}
