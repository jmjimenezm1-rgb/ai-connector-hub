import { useMemo, useState } from "react";
import {
  Send,
  Sparkles,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  Radio,
  FlaskConical,
  BookmarkPlus,
} from "lucide-react";
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

type Mode = "test" | "external";
const NEW_MODULE = "__new__";

export function QueryEnginePanel() {
  const { runModule, history, activeProvider, connections, prompts } = useAIManager();

  const moduleOptions = useMemo(() => {
    const seen = new Set<string>();
    return prompts.filter((p) => {
      const key = p.module.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [prompts]);

  const [selectedModule, setSelectedModule] = useState<string>(
    () => moduleOptions[0]?.module ?? NEW_MODULE,
  );
  const [newModuleName, setNewModuleName] = useState("");
  const [input, setInput] = useState("Resume las novedades de hoy en 3 puntos.");
  const [fallbackPrompt, setFallbackPrompt] = useState(
    "Eres un asistente experto. Responde de forma concisa:\n\n{{input}}",
  );
  const [mode, setMode] = useState<Mode>("test");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    response: string;
    registered: boolean;
    module: string;
  } | null>(null);

  const activeConn = connections.find(
    (c) => c.providerId === activeProvider && c.status === "active",
  );

  const isNewModule = selectedModule === NEW_MODULE;
  const effectiveModule = isNewModule ? newModuleName.trim() : selectedModule;
  const existingPrompt = !isNewModule
    ? prompts.find((p) => p.module === selectedModule)
    : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveModule || !input.trim()) return;
    setLoading(true);
    setResult(null);
    const res = await runModule({
      module: effectiveModule,
      input,
      fallbackPrompt: isNewModule ? fallbackPrompt : undefined,
      external: mode === "external",
    });
    setResult({ response: res.response, registered: res.registered, module: effectiveModule });
    if (isNewModule) {
      setSelectedModule(effectiveModule);
      setNewModuleName("");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Motor de consultas</h2>
        <p className="text-sm text-muted-foreground">
          Orquestador global. Selecciona un módulo registrado o registra uno nuevo al vuelo.
        </p>
      </header>

      <div className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
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

          <div className="inline-flex rounded-lg bg-muted p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode("test")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                mode === "test" ? "bg-card shadow-sm" : "text-muted-foreground"
              }`}
            >
              <FlaskConical className="size-3.5" /> Prueba
            </button>
            <button
              type="button"
              onClick={() => setMode("external")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
                mode === "external" ? "bg-card shadow-sm" : "text-muted-foreground"
              }`}
            >
              <Radio className="size-3.5" /> Llamada externa
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Módulo
              </label>
              <select
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm transition focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {moduleOptions.map((p) => (
                  <option key={p.id} value={p.module}>
                    {p.module}
                  </option>
                ))}
                <option value={NEW_MODULE}>+ Registrar nuevo módulo…</option>
              </select>
              {!isNewModule && existingPrompt && (
                <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                  Prompt vinculado: <span className="font-medium">{existingPrompt.title}</span>
                </p>
              )}
            </div>

            {isNewModule ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Nombre del nuevo módulo
                </label>
                <Input
                  value={newModuleName}
                  onChange={(e) => setNewModuleName(e.target.value)}
                  placeholder="Ej. Facturación"
                />
              </div>
            ) : (
              <div className="flex items-end">
                <p className="rounded-md bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
                  Se ejecutará el prompt registrado, reemplazando{" "}
                  <code className="font-mono">{"{{input}}"}</code> con tu entrada.
                </p>
              </div>
            )}
          </div>

          {isNewModule && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <BookmarkPlus className="size-3.5" />
                Prompt a registrar para este módulo
              </label>
              <Textarea
                value={fallbackPrompt}
                onChange={(e) => setFallbackPrompt(e.target.value)}
                rows={3}
                className="resize-none font-mono text-xs"
                placeholder="Usa {{input}} como variable"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {mode === "external" ? "Carga útil de la llamada" : "Entrada de prueba"}
            </label>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              placeholder="Texto que sustituye {{input}} del prompt..."
              className="resize-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {mode === "external"
                ? "Simula una llamada externa: usa el prompt registrado del módulo."
                : "Modo prueba: ejecuta el flujo completo igual que una llamada real."}
            </p>
            <Button
              type="submit"
              disabled={loading || !activeConn || !effectiveModule || !input.trim()}
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isNewModule ? (
                <Plus className="size-3.5" />
              ) : (
                <Send className="size-3.5" />
              )}
              {loading
                ? "Procesando..."
                : isNewModule
                  ? "Registrar y ejecutar"
                  : "Ejecutar consulta"}
            </Button>
          </div>
        </form>

        {(loading || result) && (
          <div className="mt-4 rounded-xl border bg-[color:var(--surface)] p-4">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" /> Respuesta de la IA
              </span>
              {result?.registered && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--success)]/10 px-2 py-0.5 text-[10px] font-medium text-[color:var(--success)]">
                  <BookmarkPlus className="size-3" /> Módulo «{result.module}» registrado
                </span>
              )}
            </div>
            {loading ? (
              <div className="space-y-2">
                <div className="h-3 w-11/12 rounded shimmer" />
                <div className="h-3 w-9/12 rounded shimmer" />
                <div className="h-3 w-10/12 rounded shimmer" />
              </div>
            ) : (
              <p className="text-sm leading-relaxed">{result?.response}</p>
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
            const Icon =
              h.status === "success"
                ? CheckCircle2
                : h.status === "error"
                  ? AlertCircle
                  : Loader2;
            const color =
              h.status === "success"
                ? "text-[color:var(--success)]"
                : h.status === "error"
                  ? "text-destructive"
                  : "text-[color:var(--warning)]";
            return (
              <div
                key={h.id}
                className="flex items-start gap-3 rounded-xl border bg-card p-3 shadow-[var(--shadow-soft)]"
              >
                <ProviderIcon id={h.providerId} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{h.module}</span>
                    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
                      <Icon
                        className={`size-3.5 ${h.status === "pending" ? "animate-spin" : ""}`}
                      />
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
