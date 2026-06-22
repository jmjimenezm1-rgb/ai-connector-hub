import { createServerFn } from "@tanstack/react-start";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  /** Cadena de modelos a probar en orden (fallback por 429/402). */
  models: z.array(z.string()).optional(),
});

// ============================================================
// Resolución de keys de Firecrawl con rotación automática.
// ============================================================
let _firecrawlKeysCache: { value: string[]; at: number } | null = null;

async function resolveFirecrawlKeys(): Promise<string[]> {
  if (_firecrawlKeysCache && Date.now() - _firecrawlKeysCache.at < 30_000) {
    return _firecrawlKeysCache.value;
  }
  const keys: string[] = [];
  const envKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (envKey) keys.push(envKey);
  // Variantes opcionales del entorno (conector con múltiples cuentas).
  for (const k of ["FIRECRAWL_API_KEY_2", "FIRECRAWL_API_KEY_3"]) {
    const v = process.env[k]?.trim();
    if (v && !keys.includes(v)) keys.push(v);
  }
  // Lee desde la BD las keys parametrizadas en el panel de Conexiones.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_connections")
      .select("api_key,status")
      .eq("provider_id", "firecrawl")
      .eq("status", "active")
      .maybeSingle();
    const raw = (data?.api_key as string | undefined)?.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const t = typeof item?.token === "string" ? item.token.trim() : "";
            if (t && !keys.includes(t)) keys.push(t);
          }
        } else if (raw && !keys.includes(raw)) {
          keys.push(raw);
        }
      } catch {
        if (!keys.includes(raw)) keys.push(raw);
      }
    }
  } catch { /* ignore */ }
  _firecrawlKeysCache = { value: keys, at: Date.now() };
  return keys;
}

/** Errores que indican agotamiento de cuota / límite de la API key. */
function isQuotaError(status: number, message: string): boolean {
  if (status === 402 || status === 429) return true;
  const m = message.toLowerCase();
  return (
    m.includes("insufficient") ||
    m.includes("quota") ||
    m.includes("rate limit") ||
    m.includes("payment required") ||
    m.includes("credits")
  );
}

type FirecrawlCallResult<T> = { ok: true; data: T; keyIndex: number } | { ok: false; error: string };

/**
 * Ejecuta una llamada a Firecrawl probando las keys disponibles en orden.
 * Si una key devuelve error de cuota (402/429/insufficient credits/quota),
 * se marca como agotada para esta sesión y se reintenta con la siguiente.
 */
async function firecrawlCall<T>(
  exhausted: Set<number>,
  keys: string[],
  fn: (key: string) => Promise<T>,
): Promise<FirecrawlCallResult<T>> {
  if (keys.length === 0) return { ok: false, error: "Firecrawl no está configurado." };
  let lastErr = "no_keys";
  for (let i = 0; i < keys.length; i++) {
    if (exhausted.has(i)) continue;
    try {
      const data = await fn(keys[i]);
      return { ok: true, data, keyIndex: i };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      const status = err.status ?? 0;
      const msg = err.message ?? "error";
      lastErr = msg;
      if (isQuotaError(status, msg)) {
        exhausted.add(i);
        continue; // prueba siguiente key
      }
      // Error no relacionado con cuota: corta y devuelve.
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: `Todas las API keys de Firecrawl agotadas (${lastErr}).` };
}

class FirecrawlHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type SearchOpts = {
  query: string;
  limit?: number;
  tbs?: string;
  lang?: string;
  country?: string;
  scrape?: boolean;
};

async function rawFirecrawlSearch(opts: SearchOpts, key: string) {
  const body: Record<string, unknown> = { query: opts.query, limit: opts.limit ?? 5 };
  if (opts.tbs) body.tbs = opts.tbs;
  if (opts.lang) body.lang = opts.lang;
  if (opts.country) body.country = opts.country;
  if (opts.scrape !== false) {
    body.scrapeOptions = { formats: ["markdown"], onlyMainContent: true };
  }
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new FirecrawlHttpError(res.status, `Firecrawl ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?:
      | Array<{ url?: string; title?: string; description?: string; markdown?: string }>
      | { web?: Array<{ url?: string; title?: string; description?: string; markdown?: string }> };
  };
  const items = Array.isArray(json.data) ? json.data : json.data?.web ?? [];
  return items.slice(0, opts.limit ?? 5).map((r) => ({
    url: r.url,
    title: r.title,
    description: r.description,
    content: (r.markdown ?? "").slice(0, 4000),
  }));
}

async function rawFirecrawlScrape(url: string, key: string, waitFor?: number) {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      url, formats: ["markdown"], onlyMainContent: false,
      maxAge: 0, waitFor: waitFor ?? 2500, timeout: 45000,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new FirecrawlHttpError(res.status, `Firecrawl scrape ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string; statusCode?: number } };
    markdown?: string;
  };
  const md = json.data?.markdown ?? json.markdown ?? "";
  const trimmed = md.trim();
  return {
    url: json.data?.metadata?.sourceURL ?? url,
    title: json.data?.metadata?.title,
    statusCode: json.data?.metadata?.statusCode,
    contentLength: trimmed.length,
    empty: trimmed.length < 500,
    content: md.slice(0, 16000),
  };
}

async function rawFirecrawlMap(url: string, key: string, search?: string, limit = 50) {
  const body: Record<string, unknown> = { url, limit, includeSubdomains: false };
  if (search) body.search = search;
  const res = await fetch("https://api.firecrawl.dev/v2/map", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new FirecrawlHttpError(res.status, `Firecrawl map ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { links?: string[]; data?: { links?: string[] } };
  return { links: (json.links ?? json.data?.links ?? []).slice(0, limit) };
}

export const generateAiResponse = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Falta LOVABLE_API_KEY en el servidor.");
    const firecrawlKeys = await resolveFirecrawlKeys();
    const gateway = createLovableAiGatewayProvider(key);
    const today = new Date().toISOString().slice(0, 10);

    // Tracking
    const calls: Array<{ tool: "search" | "scrape" | "map"; target: string; ok: boolean; bytes?: number; error?: string; keyIndex?: number }> = [];
    const liveScrapedUrls = new Set<string>();
    const searchedQueries = new Set<string>();
    const exhausted = new Set<number>(); // índices de keys agotadas en esta sesión
    const usedKeyIndices = new Set<number>();

    const ensureKeys = () => {
      if (firecrawlKeys.length === 0) {
        throw new Error("Firecrawl no está configurado. Conéctalo en el panel de Conexiones.");
      }
    };

    const system = `Eres un asistente con acceso a búsqueda y scraping web EN VIVO vía Firecrawl. Hoy es ${today}.

REGLAS OBLIGATORIAS:
1. Para cualquier dato externo, actual o verificable DEBES usar las herramientas (web_search, web_map, web_scrape).
2. PROHIBIDO inventar datos. Todo dato concreto debe aparecer literalmente en un web_scrape exitoso de esta respuesta.
3. Si un web_scrape devuelve empty:true o contentLength<500 el scrape FRACASÓ. Reintenta con otra URL o waitFor mayor (5000-10000ms) antes de declarar "sin datos".
4. Para portales con formularios (BOE/subastas, BORME, AEAT, INE): construye la URL con los parámetros en query string y scrapea con waitFor:4000.
5. URL canónica subastas BOE: https://subastas.boe.es/subastas_ava.php?accion=Buscar&dato[codigo_postal]=CP&dato[id_estado_array]=EJ (EJ=activa, CE=cerrada, AN=anunciada).
6. Cierra con "Fuentes" listando solo URLs realmente scrapeadas con contenido > 500 chars.
7. Idioma: español.`;

    // Cadena de modelos: si vienen varios, los probamos en orden ante 429/402.
    const modelChain: string[] = data.models && data.models.length > 0
      ? data.models
      : [data.model ?? "google/gemini-3-flash-preview"];

    const buildTools = () => ({
      web_search: tool({
        description: "Busca en la web en tiempo real vía Firecrawl. Para datos concretos, después haz web_scrape de la URL.",
        inputSchema: z.object({
          query: z.string(),
          limit: z.number().int().min(1).max(10).optional(),
          tbs: z.string().optional(),
          lang: z.string().optional(),
          country: z.string().optional(),
        }),
        execute: async ({ query, limit, tbs, lang, country }) => {
          try {
            ensureKeys();
            searchedQueries.add(query);
            const r = await firecrawlCall(exhausted, firecrawlKeys, (k) =>
              rawFirecrawlSearch({ query, limit, tbs, lang, country }, k),
            );
            if (!r.ok) {
              calls.push({ tool: "search", target: query, ok: false, error: r.error });
              return { error: r.error };
            }
            usedKeyIndices.add(r.keyIndex);
            calls.push({ tool: "search", target: query, ok: true, keyIndex: r.keyIndex });
            return { results: r.data, note: "Para citar datos, scrapea la URL." };
          } catch (e) {
            const msg = e instanceof Error ? e.message : "search_failed";
            calls.push({ tool: "search", target: query, ok: false, error: msg });
            return { error: msg };
          }
        },
      }),
      web_scrape: tool({
        description: "Descarga el contenido de una URL EN VIVO vía Firecrawl. Si empty:true o contentLength<500, reintenta con otra URL o waitFor mayor.",
        inputSchema: z.object({
          url: z.string().url(),
          waitFor: z.number().int().min(0).max(15000).optional(),
        }),
        execute: async ({ url, waitFor }) => {
          try {
            ensureKeys();
            const r = await firecrawlCall(exhausted, firecrawlKeys, (k) => rawFirecrawlScrape(url, k, waitFor));
            if (!r.ok) {
              calls.push({ tool: "scrape", target: url, ok: false, error: r.error });
              return { error: r.error };
            }
            usedKeyIndices.add(r.keyIndex);
            calls.push({ tool: "scrape", target: url, ok: true, bytes: r.data.contentLength, keyIndex: r.keyIndex });
            if (!r.data.empty) liveScrapedUrls.add(r.data.url);
            return r.data;
          } catch (e) {
            const msg = e instanceof Error ? e.message : "scrape_failed";
            calls.push({ tool: "scrape", target: url, ok: false, error: msg });
            return { error: msg };
          }
        },
      }),
      web_map: tool({
        description: "Descubre URLs de un dominio (sitemap rápido) vía Firecrawl.",
        inputSchema: z.object({
          url: z.string().url(),
          search: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        }),
        execute: async ({ url, search, limit }) => {
          try {
            ensureKeys();
            const r = await firecrawlCall(exhausted, firecrawlKeys, (k) => rawFirecrawlMap(k ? url : url, k, search, limit ?? 50));
            if (!r.ok) {
              calls.push({ tool: "map", target: url, ok: false, error: r.error });
              return { error: r.error };
            }
            usedKeyIndices.add(r.keyIndex);
            calls.push({ tool: "map", target: url, ok: true, keyIndex: r.keyIndex });
            return r.data;
          } catch (e) {
            const msg = e instanceof Error ? e.message : "map_failed";
            calls.push({ tool: "map", target: url, ok: false, error: msg });
            return { error: msg };
          }
        },
      }),
    });

    // Itera la cadena de modelos: si uno falla por 429/402 prueba el siguiente.
    let resultText = "";
    let modelUsed = "";
    const modelErrors: Array<{ model: string; error: string }> = [];
    let succeeded = false;
    for (const m of modelChain) {
      try {
        const result = await generateText({
          model: gateway(m),
          system,
          prompt: data.prompt,
          stopWhen: stepCountIs(50),
          tools: buildTools(),
        });
        resultText = result.text;
        modelUsed = m;
        succeeded = true;
        break;
      } catch (err: unknown) {
        const e = err as { statusCode?: number; status?: number; message?: string };
        const status = e.statusCode ?? e.status ?? 0;
        const msg = e.message ?? "error";
        modelErrors.push({ model: m, error: `${status || ""} ${msg}`.trim() });
        if (status === 429 || status === 402 || isQuotaError(status, msg)) {
          continue; // prueba siguiente modelo
        }
        // Error no relacionado con cuota: detener cadena.
        break;
      }
    }
    if (!succeeded) {
      const detail = modelErrors.map((e) => `• ${e.model}: ${e.error}`).join("\n");
      throw new Error(`Todos los proveedores IA configurados fallaron:\n${detail}`);
    }

    // Trazas
    const scrapeCalls = calls.filter((c) => c.tool === "scrape");
    const scrapeOk = scrapeCalls.filter((c) => c.ok);
    const scrapeEmpty = scrapeOk.filter((c) => (c.bytes ?? 0) < 500);
    const scrapeUseful = scrapeOk.length - scrapeEmpty.length;

    let trace = `\n\n---\n🤖 Modelo: ${modelUsed}`;
    if (modelErrors.length > 0) {
      trace += ` (fallback tras: ${modelErrors.map((e) => e.model).join(", ")})`;
    }
    if (firecrawlKeys.length === 0) {
      trace += `\n⚠️ Firecrawl no configurado.`;
    } else {
      trace += `\n🔑 Firecrawl: ${firecrawlKeys.length} key(s) disponibles, ${usedKeyIndices.size} usada(s), ${exhausted.size} agotada(s).`;
    }
    if (calls.length === 0) {
      trace += `\n⚠️ No se invocó ninguna herramienta web. La respuesta NO contiene datos en vivo.`;
    } else {
      const searchN = calls.filter((c) => c.tool === "search").length;
      const mapN = calls.filter((c) => c.tool === "map").length;
      trace += `\n🔎 ${searchN} search · ${mapN} map · ${scrapeCalls.length} scrape (${scrapeUseful} con contenido, ${scrapeEmpty.length} vacíos, ${scrapeCalls.length - scrapeOk.length} error).`;
      if (scrapeCalls.length > 0) {
        const detail = scrapeCalls
          .map((c) => {
            const tag = c.keyIndex != null ? ` [k#${c.keyIndex + 1}]` : "";
            if (!c.ok) return `   ✗${tag} ${c.target} → ${c.error ?? "?"}`;
            const b = c.bytes ?? 0;
            return `   ${b < 500 ? "○" : "●"}${tag} ${c.target} → ${b < 500 ? "⚠ vacío" : `${b} chars`}`;
          })
          .join("\n");
        trace += `\n${detail}`;
      }
      if (scrapeUseful === 0 && scrapeCalls.length > 0) {
        trace += `\n\n⚠️ Ningún scrape devolvió contenido útil.`;
      }
    }

    return { text: resultText + trace, toolCalls: calls, scrapedUrls: [...liveScrapedUrls], modelUsed };
  });
