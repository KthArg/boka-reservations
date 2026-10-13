'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/server';
import { createSupabaseServiceClient } from '@/lib/db/supabase-service';
import { isTourKind, UserRole } from '@shared/constants/enums';
import { TourActionError } from '@shared/constants/tours';
import { pauseTourById, resumeTourById, type TourStatusResult } from './status';

type Change = typeof pauseTourById;

/** Guard de rol, resolución del tour fijo por `kind` y revalidación del sitio (spec 0047). */
async function changeStatus(kind: string, change: Change): Promise<TourStatusResult> {
  let actorId: string;
  try {
    actorId = (await requireRole(UserRole.Admin)).id;
  } catch {
    return { ok: false, error: TourActionError.Unauthorized };
  }
  if (!isTourKind(kind)) return { ok: false, error: TourActionError.StatusChangeFailed };

  const db = createSupabaseServiceClient();
  const { data: tour, error } = await db.from('tours').select('id').eq('kind', kind).maybeSingle();
  if (error || !tour) return { ok: false, error: TourActionError.StatusChangeFailed };

  const result = await change(db, tour.id, actorId);
  if (result.ok) revalidatePath('/', 'layout');
  return result;
}

export async function pauseTour(kind: string): Promise<TourStatusResult> {
  return changeStatus(kind, pauseTourById);
}

export async function resumeTour(kind: string): Promise<TourStatusResult> {
  return changeStatus(kind, resumeTourById);
}
