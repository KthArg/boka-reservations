import { getLocale } from 'next-intl/server';
import { Hanken_Grotesk, Young_Serif } from 'next/font/google';
import './globals.css';

const bodyFont = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken',
});

const displayFont = Young_Serif({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-young-serif',
});

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${bodyFont.variable} ${displayFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
