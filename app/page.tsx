export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 720, margin: "80px auto", padding: 24 }}>
      <p style={{ color: "#64748b", fontWeight: 700, letterSpacing: 1 }}>RENDA MOBILE</p>
      <h1>Admin em fundação técnica</h1>
      <p>
        O backend, Firebase e o endpoint de webhook estão preparados. O painel administrativo visual será construído em uma etapa posterior.
      </p>
      <p style={{ color: "#64748b" }}>Health check: <a href="/api/health">/api/health</a></p>
    </main>
  );
}
