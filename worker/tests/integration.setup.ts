import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Carga .env.local de web (que tiene las claves de Supabase local) y agrega
// defaults de Mailpit para que el job real funcione contra la cola.
const envPath = resolve(__dirname, '../../web/.env.local');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

process.env.EMAIL_PROVIDER = process.env.EMAIL_PROVIDER ?? 'mailpit';
process.env.SMTP_HOST = process.env.SMTP_HOST ?? '127.0.0.1';
process.env.SMTP_PORT = process.env.SMTP_PORT ?? '54325';
process.env.EMAIL_FROM = process.env.EMAIL_FROM ?? 'Boka Trails <test@localhost>';
process.env.NOTIFICATIONS_ENABLED = process.env.NOTIFICATIONS_ENABLED ?? 'true';
process.env.APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:3000';
