import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { type NextRequest, NextResponse } from 'next/server';

type Params = { params: Promise<{ locale: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { locale } = await params;
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.redirect(
      new URL(`/${locale}/forgot-password?error=link-expired`, request.url),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/${locale}/forgot-password?error=link-expired`, request.url),
    );
  }

  return NextResponse.redirect(new URL(`/${locale}/reset-password`, request.url));
}
