import { describe, expect, it } from 'vitest';
import { isTourImageUrl, tourImagesPublicPrefix } from './cover-image';

const SUPABASE = 'https://abc.supabase.co';
const PREFIX = `${SUPABASE}/storage/v1/object/public/tour-images/`;

describe('isTourImageUrl', () => {
  it('acepta un archivo del bucket de este entorno', () => {
    expect(isTourImageUrl(`${PREFIX}volcan.webp`, SUPABASE)).toBe(true);
  });

  it.each([
    ['otro servidor', 'https://images.example.com/volcan.jpg'],
    ['otro bucket', `${SUPABASE}/storage/v1/object/public/otro/volcan.jpg`],
    ['otro proyecto', 'https://xyz.supabase.co/storage/v1/object/public/tour-images/a.jpg'],
    ['el bucket sin archivo', PREFIX],
    ['un parámetro de consulta', `${PREFIX}a.jpg?track=1`],
  ])('rechaza %s', (_case, url) => {
    expect(isTourImageUrl(url, SUPABASE)).toBe(false);
  });

  it('arma el prefijo aunque la URL de Supabase termine en barra', () => {
    expect(tourImagesPublicPrefix(`${SUPABASE}/`)).toBe(PREFIX);
  });
});
