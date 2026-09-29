"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("admin_global_error", { name: error.name, message: error.message, digest: error.digest });
  }, [error]);

  return <html lang="pt-BR"><body><main className="screen-center error-screen">
    <section className="error-card">
      <div className="brand-mark">RM</div>
      <p className="eyebrow">RENDA MOBILE / ADMIN</p>
      <h1>O painel precisa ser recarregado.</h1>
      <p className="muted">Uma falha temporária no navegador interrompeu o carregamento. Seus dados não foram alterados.</p>
      <div className="error-actions">
        <button className="button primary" onClick={reset}>Tentar novamente</button>
        <button className="button ghost" onClick={() => window.location.reload()}>Recarregar página</button>
      </div>
    </section>
  </main></body></html>;
}
