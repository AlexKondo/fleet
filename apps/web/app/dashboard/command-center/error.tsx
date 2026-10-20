"use client";
export default function CommandCenterError({ reset }: { reset: () => void }) {
  return (
    <div
      role="alert"
      style={{
        padding: 32,
        color: "#08163d",
        background: "#f3f8fe",
        minHeight: "100vh",
      }}
    >
      <h1>Não foi possível carregar a Central de Comando</h1>
      <p>Seus registros foram preservados. Tente consultar novamente.</p>
      <button
        onClick={reset}
        style={{
          marginTop: 16,
          padding: "12px 20px",
          background: "#0068ff",
          color: "white",
          border: 0,
          borderRadius: 6,
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
