import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Renda Mobile Admin",
  description: "Fundação administrativa da plataforma Renda Mobile",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
