import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { TourKind } from '@shared/constants/enums';

/** Ya no hay lista de tours (spec 0047): son dos y el menú lleva directo a cada uno. */
export default async function ToursPage() {
  const locale = await getLocale();
  redirect(`/${locale}/dashboard/tours/${TourKind.Day}`);
}
