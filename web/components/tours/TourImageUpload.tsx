'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser';
import {
  TOUR_IMAGE_EXTENSIONS,
  TOUR_IMAGE_MAX_BYTES,
  TOUR_IMAGE_TYPES,
  TOUR_IMAGES_BUCKET,
} from '@/lib/tours/cover-image';
import styles from './TourForm.module.css';

type Props = {
  value: string;
  onChange: (url: string) => void;
  errors?: string[];
};

/**
 * Foto del tour (spec 0036): se sube al bucket propio con la sesión del admin (las políticas de
 * Storage de …050 solo le permiten escribir a él) y el formulario guarda la URL pública. El campo
 * oculto lleva el valor, así un error de validación del resto del formulario no la pierde.
 */
export function TourImageUpload({ value, onChange, errors }: Props) {
  const t = useTranslations('tours');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!TOUR_IMAGE_TYPES.includes(file.type)) return setError(t('image-error-type'));
    if (file.size > TOUR_IMAGE_MAX_BYTES) return setError(t('image-error-size'));

    setUploading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const path = `${crypto.randomUUID()}.${TOUR_IMAGE_EXTENSIONS[file.type]}`;
      const { error: uploadError } = await supabase.storage
        .from(TOUR_IMAGES_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) return setError(t('image-error-upload'));
      onChange(supabase.storage.from(TOUR_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl);
    } catch {
      setError(t('image-error-upload'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={styles.label}>
      <span>{t('field-cover-image')}</span>
      <input type="hidden" name="cover_image_url" value={value} />
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element -- vista previa de un archivo propio
        <img src={value} alt="" className={styles.coverPreview} />
      ) : null}
      <input
        type="file"
        accept={TOUR_IMAGE_TYPES.join(',')}
        disabled={uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      {value ? (
        <button type="button" className={styles.linkButton} onClick={() => onChange('')}>
          {t('image-remove')}
        </button>
      ) : null}
      <p className={styles.hint}>{uploading ? t('image-uploading') : t('image-hint')}</p>
      {error ? <span className={styles.fieldError}>{error}</span> : null}
      {errors?.map((message) => (
        <span key={message} className={styles.fieldError}>
          {t(`errors.${message}`)}
        </span>
      ))}
    </div>
  );
}
