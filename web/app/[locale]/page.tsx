import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

export default async function HomePage() {
  const locale = await getLocale();
  redirect(`/${locale}/tours`);
}
