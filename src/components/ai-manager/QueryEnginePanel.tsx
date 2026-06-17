import { useState } from "react";
import { Send, Sparkles, Clock, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useAIManager, getProvider } from "@/lib/ai-manager/store";
import { ProviderIcon } from "./ProviderIcon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleDateString();
}

export function QueryEnginePanel() {
  const { runQuery, history, activeProvider, connections } = useAIManager();
  const [module, setModule] = useState("Playground");
  const [prompt, setPrompt] = useState("Resume las novedades de hoy en 3 puntos.");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const activeConn = connections.find((c) => c.providerId === activeProvider && c.status === "active");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setLoading(true);
    setResult(null);
    const res = await runQuery({ module, prompt });
    setResult(res.response);
    setLoading(false);
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Motor de consultas</h2>
        <p className="text-sm text-muted-foreground">
          Orquestador global de llamadas a la IA seleccionada.
        </p>
      </header>

      <div className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Proveedor activo:</span>
            {activeProvider && activeConn ? (
              <span className="inline-flex items-center gap-1.5 font-medium">
                <ProviderIcon id={activeProvider} size={18} />
                {getProvider(activeProvider).name}
              </span>
            ) : (
              <span className="text-[color:var(--warning)]">Ninguno conectado</span>
            )}
          </div>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Módulo</label>
              <Input value={module} onChange={(e) => setModule(e.target.value)} placeholder="Módulo solicitante" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Petición</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="Escribe la petición que enviará el módulo..."
                className="resize-none"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !activeConn}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {loading ? "Pensando..." : "Ejecutar consulta"}
            </Button>
          </div>
        </form>

        {(loading || result) && (
          <div className="mt-4 rounded-xl border bg-[color:var(--surface)] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" /> Respuesta
            </div>
            {loading ? (
              <div className="space-y-2">
                <div className="h-3 w-11/12 rounded shimmer" />
                <div className="h-3 w-9/12 rounded shimmer" />
                <div className="h-3 w-10/12 rounded shimmer" />
              </div>
            ) : (
              <p className="text-sm leading-relaxed">{result}</p>
            )}
          </div>
        )}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Historial rápido</h3>
          <span className="text-xs text-muted-foreground">{history.length} llamadas</span>
        </div>
        <div className="space-y-2">
          {history.length === 0 && (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Sin llamadas todavía.
            </div>
          )}
          {history.slice(0, 8).map((h) => {
            const Icon = h.status === "success" ? CheckCircle2 : h.status === "error" ? AlertCircle : Loader2;
            const color =
              h.status === "success"
                ? "text-[color:var(--success)]"
                : h.status === "error"
                  ? "text-destructive"
                  : "text-[color:var(--warning)]";
            return (
              <div key={h.id} className="flex items-start gap-3 rounded-xl border bg-card p-3 shadow-[var(--shadow-soft)]">
                <ProviderIcon id={h.providerId} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{h.module}</span>
                    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
                      <Icon className={`size-3.5 ${h.status === "pending" ? "animate-spin" : ""}`} />
                      {h.status === "success" ? `${h.durationMs}ms` : h.status}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{h.prompt}</p>
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <Clock className="size-3" /> {timeAgo(h.createdAt)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
