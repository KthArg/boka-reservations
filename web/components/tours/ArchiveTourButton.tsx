'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { archiveTour, reactivateTour } from '@/lib/tours/actions';
import { Icon } from '@/components/admin/icons';

type Props = { tourId: string; mode: 'archive' | 'reactivate'; className: string };

/**
 * Archivar/reactivar con feedback (spec 0028, B12): la action ahora puede rechazar
 * (p. ej. reservas activas en salidas futuras) y el admin debe VER por qué — un
 * `<form action>` directo descartaba el resultado en silencio.
 */
export function ArchiveTourButton({ tourId, mode, className }: Props) {
  const t = useTranslations('tours');
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = mode === 'archive' ? await archiveTour(tourId) : await reactivateTour(tourId);
      if (!result.ok) window.alert(t(`errors.${result.error}`));
    });
  }

  return (
    <button type="button" className={className} onClick={onClick} disabled={pending}>
      <Icon name={mode === 'archive' ? 'archive' : 'restore'} size={15} />
      {t(mode === 'archive' ? 'archive' : 'reactivate')}
    </button>
  );
}
