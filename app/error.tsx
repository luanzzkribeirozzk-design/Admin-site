"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("admin_route_error", { name: error.name, message: error.message, digest: error.digest });
  }, [error]);

  return <main className="screen-center error-screen">
    <section className="error-card">
      <div className="brand-mark">RM</div>
      <p className="eyebrow">RENDA MOBILE / ADMIN</p>
      <h1>O painel precisa ser recarregado.</h1>
      <p className="muted">Uma falha temporária interrompeu esta tela. Seus dados não foram alterados.</p>
      <div className="error-actions">
        <button className="button primary" onClick={reset}>Tentar novamente</button>
        <button className="button ghost" onClick={() => window.location.reload()}>Recarregar página</button>
      </div>
    </section>
  </main>;
}
