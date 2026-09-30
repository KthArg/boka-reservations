import { getLocale } from 'next-intl/server';
import { Gloock, Montserrat } from 'next/font/google';
import './globals.css';

// Spec 0042: las tipografías de la landing, autoalojadas por next/font (sin pedidos a Google en
// tiempo de ejecución; la CSP solo permite fuentes propias).
const bodyFont = Montserrat({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-montserrat',
});

const displayFont = Gloock({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-gloock',
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
