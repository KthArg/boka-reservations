// Fotos de los tours en el almacenamiento propio (spec 0036). La página del tour carga la foto
// desde Supabase Storage: una URL de otro servidor le entregaría la IP del visitante a un tercero
// que el aviso de privacidad no declara.

export const TOUR_IMAGES_BUCKET = 'tour-images';

/** 5 MB, igual que el límite del bucket (…050). */
export const TOUR_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Tipos aceptados y la extensión con que se guardan (el bucket de …050 acepta los mismos). */
export const TOUR_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const TOUR_IMAGE_TYPES: readonly string[] = Object.keys(TOUR_IMAGE_EXTENSIONS);

/** Prefijo de las URL públicas del bucket en este entorno. */
export function tourImagesPublicPrefix(
  supabaseUrl: string = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
): string {
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${TOUR_IMAGES_BUCKET}/`;
}

/** La URL apunta a un archivo del bucket de este entorno (el CHECK de la base es la otra capa). */
export function isTourImageUrl(url: string, supabaseUrl?: string): boolean {
  const prefix = tourImagesPublicPrefix(supabaseUrl);
  return url.startsWith(prefix) && url.length > prefix.length && !/[?#]/.test(url);
}
