import { useState } from "react";
import { Check, Link2, LogOut, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import {
  AI_PROVIDERS,
  FIRECRAWL_MAX_KEYS,
  useAIManager,
  type AIProvider,
  type ConnectionStatus,
} from "@/lib/ai-manager/store";
import { ProviderIcon } from "./ProviderIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STATUS_META: Record<ConnectionStatus, { label: string; dot: string; text: string }> = {
  active: { label: "Activa", dot: "bg-[color:var(--success)]", text: "text-[color:var(--success)]" },
  pending: { label: "Pendiente", dot: "bg-[color:var(--warning)]", text: "text-[color:var(--warning)]" },
  disconnected: { label: "Desconectada", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

export function ConnectionsPanel() {
  const { connections, activeProvider, connect, disconnect, setActiveProvider } = useAIManager();
  const [open, setOpen] = useState<AIProvider | null>(null);
  const [firecrawlOpen, setFirecrawlOpen] = useState(false);

  const getConn = (id: AIProvider["id"]) => connections.find((c) => c.providerId === id);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Conexiones de IA</h2>
        <p className="text-sm text-muted-foreground">
          Vincula tus apps de IA. Firecrawl admite hasta {FIRECRAWL_MAX_KEYS} API keys con fallback automático por cuota.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {AI_PROVIDERS.map((p) => {
          const conn = getConn(p.id);
          const status: ConnectionStatus = conn?.status ?? "disconnected";
          const meta = STATUS_META[status];
          const isActive = activeProvider === p.id && status === "active";
          const isFirecrawl = p.id === "firecrawl";
          const fcCount = conn?.firecrawlKeys?.length ?? 0;
          return (
            <div
              key={p.id}
              className="group relative rounded-2xl border bg-card p-4 shadow-[var(--shadow-soft)] transition hover:border-primary/40"
            >
              {isActive && (
                <span
                  aria-hidden
                  className="absolute right-3 top-3 inline-flex h-2 w-2 rounded-full bg-primary pulse-ring"
                />
              )}
              <div className="flex items-start gap-3">
                <ProviderIcon id={p.id} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate font-semibold">{p.name}</h3>
                    <span className={`inline-flex items-center gap-1.5 text-xs ${meta.text}`}>
                      <span className={`status-dot ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{p.tagline}</p>
                  {conn && status !== "disconnected" && !isFirecrawl && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {conn.account} · <span className="font-mono">{conn.tokenMask}</span>
                    </p>
                  )}
                  {isFirecrawl && fcCount > 0 && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {fcCount}/{FIRECRAWL_MAX_KEYS} API keys · fallback automático
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {isFirecrawl ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setFirecrawlOpen(true)} className="flex-1">
                      <Link2 className="size-3.5" /> {fcCount > 0 ? "Gestionar API keys" : "Configurar Firecrawl"}
                    </Button>
                    {fcCount > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => disconnect(p.id)} aria-label="Eliminar todas">
                        <LogOut className="size-3.5" />
                      </Button>
                    )}
                  </>
                ) : status === "active" ? (
                  <>
                    <Button
                      size="sm"
                      variant={isActive ? "default" : "outline"}
                      onClick={() => setActiveProvider(p.id)}
                      className="flex-1"
                    >
                      {isActive ? (<><Check className="size-3.5" /> Activo</>) : "Usar"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => disconnect(p.id)} aria-label={`Desconectar ${p.name}`}>
                      <LogOut className="size-3.5" />
                    </Button>
                  </>
                ) : (
                  <Button size="sm" className="flex-1" onClick={() => setOpen(p)}>
                    <Link2 className="size-3.5" /> Conectar
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <ConnectModal
          provider={open}
          onClose={() => setOpen(null)}
          onConfirm={async (account, token) => {
            await connect(open.id, account, token);
            setOpen(null);
          }}
        />
      )}

      {firecrawlOpen && <FirecrawlKeysModal onClose={() => setFirecrawlOpen(false)} />}
    </div>
  );
}

function FirecrawlKeysModal({ onClose }: { onClose: () => void }) {
  const { connections, addFirecrawlKey, removeFirecrawlKey } = useAIManager();
  const conn = connections.find((c) => c.providerId === "firecrawl");
  const keys = conn?.firecrawlKeys ?? [];
  const [account, setAccount] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addFirecrawlKey(account.trim() || `key-${keys.length + 1}`, token.trim());
      setAccount("");
      setToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al añadir la key");
    } finally {
      setBusy(false);
    }
  };

  const atLimit = keys.length >= FIRECRAWL_MAX_KEYS;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl border bg-card p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProviderIcon id="firecrawl" size={36} />
            <div>
              <h3 className="font-semibold">API keys de Firecrawl</h3>
              <p className="text-xs text-muted-foreground">Hasta {FIRECRAWL_MAX_KEYS} keys con fallback automático</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {keys.length === 0 && (
            <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              Aún no hay keys configuradas. Añade la primera para activar búsqueda y scraping en vivo.
            </p>
          )}
          {keys.map((k, idx) => (
            <div key={k.account} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{k.account}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{k.tokenMask}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeFirecrawlKey(k.account)}
                aria-label={`Eliminar ${k.account}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="fc-acc">Etiqueta (opcional)</Label>
            <Input
              id="fc-acc"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="p.ej. cuenta-pro"
              disabled={atLimit}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fc-tok">API key</Label>
            <Input
              id="fc-tok"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="fc-..."
              className="font-mono text-sm"
              disabled={atLimit}
            />
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-[color:var(--success)]" />
            Si una key alcanza su límite, el sistema rota automáticamente a la siguiente.
          </div>

          <Button type="submit" className="w-full" disabled={busy || atLimit || !token.trim()}>
            <Plus className="size-3.5" />
            {atLimit ? `Máximo ${FIRECRAWL_MAX_KEYS} keys` : busy ? "Añadiendo..." : "Añadir API key"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function ConnectModal({
  provider,
  onClose,
  onConfirm,
}: {
  provider: AIProvider;
  onClose: () => void;
  onConfirm: (account: string, token: string) => void | Promise<void>;
}) {
  const [account, setAccount] = useState("demo@user.io");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"creds" | "token">("token");
  const [linking, setLinking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinking(true);
    try {
      await onConfirm(account || "demo@user.io", token || "sk-demo-abcdef1234");
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl border bg-card p-5 shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProviderIcon id={provider.id} size={36} />
            <div>
              <h3 className="font-semibold">Conectar {provider.name}</h3>
              <p className="text-xs text-muted-foreground">Deep-link a la app nativa</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 inline-flex w-full rounded-xl bg-muted p-1 text-xs">
          {(["token", "creds"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg px-3 py-1.5 font-medium transition ${
                mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {m === "token" ? "Token de acceso" : "Usuario y contraseña"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          {mode === "creds" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="acc">Usuario</Label>
                <Input id="acc" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="tu@correo.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pwd">Contraseña</Label>
                <Input id="pwd" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••••••" />
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="tkn">Token de acceso</Label>
              <Input id="tkn" value={token} onChange={(e) => setToken(e.target.value)} placeholder="sk-..." className="font-mono text-sm" />
            </div>
          )}

          <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0 text-[color:var(--success)]" />
            Los datos se almacenan localmente solo con fines de demostración.
          </div>

          <Button type="submit" className="w-full" disabled={linking}>
            {linking ? "Abriendo app nativa..." : "Vincular cuenta"}
          </Button>
        </form>
      </div>
    </div>
  );
}
