import type { EmailLocale } from '../types.js';

const CENTS_PER_UNIT = 100;

export function formatMoney(amountCents: number, currency: string, locale: EmailLocale): string {
  const amount = amountCents / CENTS_PER_UNIT;
  return new Intl.NumberFormat(locale === 'es' ? 'es-CR' : 'en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function formatDateTime(iso: string, locale: EmailLocale): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-CR' : 'en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Costa_Rica',
  }).format(date);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
