'use server';

import { createSupabaseServerClient } from '@/lib/db/supabase-server';
import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const locale = await getLocale();
  redirect(`/${locale}/login`);
}
