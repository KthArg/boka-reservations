import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';

type Params = { params: Promise<{ locale: string }> };

const DEFAULT_NEXT = '/reset-password';
const ALLOWED_TYPES: readonly EmailOtpType[] = ['invite', 'recovery'];

/**
 * Completa una invitación (o recovery) verificando el OTP del email con
 * `verifyOtp({ token_hash })`. Es el patrón server-side de Supabase: no depende
 * del browser que abrió el link (a diferencia del flujo PKCE de /auth/callback),
 * por eso sirve para invitaciones que el admin dispara para otra persona (spec 0010).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { locale } = await params;
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? DEFAULT_NEXT;

  const expired = new URL(`/${locale}/forgot-password?error=link-expired`, request.url);
  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    return NextResponse.redirect(expired);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return NextResponse.redirect(expired);

  const target = next.startsWith('/') ? next : `/${next}`;
  return NextResponse.redirect(new URL(`/${locale}${target}`, request.url));
}
