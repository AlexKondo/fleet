export default function LoadingCommandCenter() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: 32,
        color: "#08163d",
        background: "#f3f8fe",
        minHeight: "100vh",
      }}
    >
      Carregando Fleet Command Center 360°…
    </div>
  );
}
