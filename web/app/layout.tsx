import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Boka Trails',
  description: 'Reservas de tours de senderismo y birdwatching en Costa Rica',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
