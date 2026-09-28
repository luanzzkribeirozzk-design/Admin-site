import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Renda Mobile · Admin",
  description: "Painel administrativo da plataforma Renda Mobile",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
