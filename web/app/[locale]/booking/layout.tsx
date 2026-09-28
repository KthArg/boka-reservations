import { SiteFooter } from '@/components/public/SiteFooter/SiteFooter';

type Props = { children: React.ReactNode };

/**
 * Las páginas de la reserva (enlace personal del correo) no usan el layout del portal, pero
 * llevan el mismo pie con la identidad del operador (spec 0034).
 */
export default function BookingLayout({ children }: Props) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
