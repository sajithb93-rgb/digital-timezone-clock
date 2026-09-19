"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("QUANTSTRUCTURE runtime error:", error);
  }, [error]);

  return (
    <main style={{ minHeight: "100vh", background: "#080b11", color: "#e8edf5", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 760, margin: "60px auto", border: "1px solid #273142", borderRadius: 14, padding: 24, background: "#0e131c" }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: "#8b98ab", marginBottom: 10 }}>QUANTSTRUCTURE · RUNTIME ERROR</div>
        <h1 style={{ margin: "0 0 12px", fontSize: 24 }}>The dashboard could not load</h1>
        <p style={{ color: "#aeb8c7", lineHeight: 1.6 }}>The application hit a browser runtime error. The exact error is shown below so we can fix the root cause.</p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 14, borderRadius: 10, background: "#080b11", color: "#ff9b9b", border: "1px solid #3a2529" }}>{error?.message || "Unknown runtime error"}</pre>
        {error?.digest && <div style={{ color: "#7f8b9d", fontSize: 12, marginTop: 10 }}>Digest: {error.digest}</div>}
        <button onClick={() => reset()} style={{ marginTop: 18, border: 0, borderRadius: 9, padding: "10px 16px", background: "#e8edf5", color: "#080b11", fontWeight: 700 }}>Try again</button>
      </div>
    </main>
  );
}
