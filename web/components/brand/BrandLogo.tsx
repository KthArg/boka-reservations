/** Logo oficial de Boka Verde (spec 0042). Las variantes son los PNG de la marca en public/brand. */
type Variant = 'bone' | 'white' | 'forest' | 'mix';

const SRC: Record<Variant, string> = {
  bone: '/brand/logo-hueso.png',
  white: '/brand/logo-blanco.png',
  forest: '/brand/logo-verde-oscuro.png',
  mix: '/brand/logo-mix-amarillo.png',
};

// Proporción de los archivos (720 × 256): con el alto y el ancho explícitos no hay salto de diseño.
const WIDTH = 720;
const HEIGHT = 256;

type Props = {
  variant: Variant;
  className?: string;
  priority?: boolean;
  /** Repetición decorativa del logo (sin texto alternativo) y carga diferida. */
  decorative?: boolean;
};

export function BrandLogo({ variant, className, priority = false, decorative = false }: Props) {
  return (
    <img
      src={SRC[variant]}
      alt={decorative ? '' : 'Boka Verde'}
      width={WIDTH}
      height={HEIGHT}
      className={className}
      decoding="async"
      loading={decorative ? 'lazy' : undefined}
      fetchPriority={priority ? 'high' : undefined}
    />
  );
}
