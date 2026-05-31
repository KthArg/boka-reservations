import { env } from '../../env.js';
import type { EmailAdapter } from '../types.js';
import { createMailpitAdapter } from './mailpit.js';
import { createResendAdapter } from './resend.js';

let cached: EmailAdapter | null = null;

export function getEmailAdapter(): EmailAdapter {
  if (cached) return cached;

  if (env.EMAIL_PROVIDER === 'resend') {
    if (!env.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY ausente con EMAIL_PROVIDER=resend');
    }
    cached = createResendAdapter(env.RESEND_API_KEY, env.EMAIL_FROM);
  } else {
    cached = createMailpitAdapter(env.SMTP_HOST, env.SMTP_PORT, env.EMAIL_FROM);
  }
  return cached;
}
