import './globals.css';

export const metadata = {
  title: 'Laboratorio ADMS - MB10-VL',
  description: 'Captura en vivo de las tramas del biometrico ZKTeco',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
