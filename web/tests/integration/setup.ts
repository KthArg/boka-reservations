// Carga .env.local para los tests de integración sin depender de dotenv.
import { readFileSync } from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
try {
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // Sin .env.local — los tests usarán sus fallbacks hardcodeados
}
