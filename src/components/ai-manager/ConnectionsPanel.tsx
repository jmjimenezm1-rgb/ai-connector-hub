import { useState } from "react";
import { Check, Link2, LogOut, ShieldCheck, X } from "lucide-react";
import { AI_PROVIDERS, useAIManager, type AIProvider, type ConnectionStatus } from "@/lib/ai-manager/store";
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

  const getConn = (id: AIProvider["id"]) => connections.find((c) => c.providerId === id);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Conexiones de IA</h2>
        <p className="text-sm text-muted-foreground">
          Vincula tus apps de IA instaladas mediante deep-link y credenciales.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {AI_PROVIDERS.map((p) => {
          const conn = getConn(p.id);
          const status: ConnectionStatus = conn?.status ?? "disconnected";
          const meta = STATUS_META[status];
          const isActive = activeProvider === p.id && status === "active";
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
                  {conn && status !== "disconnected" && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {conn.account} · <span className="font-mono">{conn.tokenMask}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {status === "active" ? (
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
  onConfirm: (account: string, token: string) => void;
}) {
  const [account, setAccount] = useState("demo@user.io");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"creds" | "token">("token");
  const [linking, setLinking] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinking(true);
    await new Promise((r) => setTimeout(r, 700));
    onConfirm(account || "demo@user.io", token || "sk-demo-abcdef1234");
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
