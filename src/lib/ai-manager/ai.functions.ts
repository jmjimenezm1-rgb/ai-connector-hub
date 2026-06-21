import { createServerFn } from "@tanstack/react-start";
import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
});

// Resuelve la API key de Firecrawl: 1) env (connector), 2) ai_connections en BD.
let _firecrawlKeyCache: { value: string | null; at: number } | null = null;
async function resolveFirecrawlKey(): Promise<string | null> {
  const envKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (envKey) return envKey;
  // Cache 30s para no golpear BD en cada tool call.
  if (_firecrawlKeyCache && Date.now() - _firecrawlKeyCache.at < 30_000) {
    return _firecrawlKeyCache.value;
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_connections")
      .select("api_key,status")
      .eq("provider_id", "firecrawl")
      .eq("status", "active")
      .maybeSingle();
    const value = (data?.api_key as string | undefined)?.trim() || null;
    _firecrawlKeyCache = { value, at: Date.now() };
    return value;
  } catch {
    _firecrawlKeyCache = { value: null, at: Date.now() };
    return null;
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

async function firecrawlSearch(opts: SearchOpts, key: string) {
  const body: Record<string, unknown> = {
    query: opts.query,
    limit: opts.limit ?? 5,
  };
  if (opts.tbs) body.tbs = opts.tbs;
  if (opts.lang) body.lang = opts.lang;
  if (opts.country) body.country = opts.country;
  if (opts.scrape !== false) {
    body.scrapeOptions = { formats: ["markdown"], onlyMainContent: true };
  }
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 200)}`);
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

async function firecrawlScrape(url: string, key: string, waitFor?: number) {
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      maxAge: 0,
      waitFor: waitFor ?? 0,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl scrape ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string } };
    markdown?: string;
  };
  const md = json.data?.markdown ?? json.markdown ?? "";
  return {
    url: json.data?.metadata?.sourceURL ?? url,
    title: json.data?.metadata?.title,
    content: md.slice(0, 12000),
  };
}

async function firecrawlMap(url: string, key: string, search?: string, limit = 50) {
  const body: Record<string, unknown> = { url, limit, includeSubdomains: false };
  if (search) body.search = search;
  const res = await fetch("https://api.firecrawl.dev/v2/map", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl map ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { links?: string[]; data?: { links?: string[] } };
  return { links: (json.links ?? json.data?.links ?? []).slice(0, limit) };
}

export const generateAiResponse = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      throw new Error("Falta LOVABLE_API_KEY en el servidor.");
    }
    const firecrawlKey = await resolveFirecrawlKey();
    const gateway = createLovableAiGatewayProvider(key);
    const today = new Date().toISOString().slice(0, 10);

    // Instrumentación: registramos todas las llamadas reales a Firecrawl.
    const calls: Array<{ tool: "search" | "scrape" | "map"; target: string; ok: boolean; error?: string }> = [];
    const scrapedUrls = new Set<string>();
    const searchedQueries = new Set<string>();

    const ensureKey = () => {
      if (!firecrawlKey) {
        throw new Error(
          "Firecrawl no está configurado. Conéctalo en el panel de Conexiones para habilitar la búsqueda y scraping en vivo.",
        );
      }
      return firecrawlKey;
    };

    const system = `Eres un asistente con acceso a búsqueda y scraping web EN VIVO vía Firecrawl. Hoy es ${today}.

REGLAS OBLIGATORIAS:
1. Si la respuesta depende de información actual, externa, verificable o que pueda haber cambiado, DEBES usar las herramientas web (web_search, web_map, web_scrape). No respondas de memoria.
2. Nunca describas lo que harías: ejecuta la herramienta. Cada afirmación factual debe estar respaldada por al menos un resultado real (search o scrape) de esta misma respuesta.
3. Protocolo para portales con filtros (BOE/subastas BOE, BORME, AEAT, INE, sedes electrónicas, etc.):
   a) Identifica el dominio oficial (p. ej. subastas.boe.es).
   b) web_search con "site:dominio" + términos + tbs="qdr:w|d" si la consulta implica novedades.
   c) web_map sobre el dominio con un "search" relevante para descubrir páginas reales.
   d) Construye la URL del formulario con sus parámetros en query string y haz web_scrape directamente sobre esa URL.
   e) web_scrape sobre cada URL prometedora (datos en vivo, sin caché).
4. Si tras buscar no encuentras información válida, dilo explícitamente e indica qué URLs intentaste. Nunca inventes datos.
5. Cita SIEMPRE las URLs reales consultadas al final en una sección "Fuentes" con enlaces. Si no usaste herramientas, indícalo explícitamente.
6. Idioma de la respuesta: el del usuario (por defecto español).`;

    try {
      const result = await generateText({
        model: gateway(data.model ?? "google/gemini-3-flash-preview"),
        system,
        prompt: data.prompt,
        stopWhen: stepCountIs(50),
        tools: {
          web_search: tool({
            description:
              "Busca en la web en tiempo real vía Firecrawl. Acepta operadores: site:, comillas, -excluir. Usa tbs para frescura: qdr:h|d|w|m|y.",
            inputSchema: z.object({
              query: z.string(),
              limit: z.number().int().min(1).max(10).optional(),
              tbs: z.string().optional(),
              lang: z.string().optional(),
              country: z.string().optional(),
            }),
            execute: async ({ query, limit, tbs, lang, country }) => {
              try {
                const k = ensureKey();
                searchedQueries.add(query);
                const results = await firecrawlSearch({ query, limit, tbs, lang, country }, k);
                calls.push({ tool: "search", target: query, ok: true });
                results.forEach((r) => r.url && scrapedUrls.add(r.url));
                return { results };
              } catch (e) {
                const msg = e instanceof Error ? e.message : "search_failed";
                calls.push({ tool: "search", target: query, ok: false, error: msg });
                return { error: msg };
              }
            },
          }),
          web_scrape: tool({
            description:
              "Descarga el contenido principal de una URL EN VIVO (sin caché) vía Firecrawl. Úsala para portales con filtros: monta la URL con los parámetros en la query string y pásala aquí.",
            inputSchema: z.object({
              url: z.string().url(),
              waitFor: z.number().int().min(0).max(15000).optional(),
            }),
            execute: async ({ url, waitFor }) => {
              try {
                const k = ensureKey();
                const out = await firecrawlScrape(url, k, waitFor);
                calls.push({ tool: "scrape", target: url, ok: true });
                scrapedUrls.add(out.url);
                return out;
              } catch (e) {
                const msg = e instanceof Error ? e.message : "scrape_failed";
                calls.push({ tool: "scrape", target: url, ok: false, error: msg });
                return { error: msg };
              }
            },
          }),
          web_map: tool({
            description:
              "Descubre URLs reales dentro de un dominio (sitemap rápido) vía Firecrawl. Útil antes de hacer scrape.",
            inputSchema: z.object({
              url: z.string().url(),
              search: z.string().optional(),
              limit: z.number().int().min(1).max(200).optional(),
            }),
            execute: async ({ url, search, limit }) => {
              try {
                const k = ensureKey();
                const out = await firecrawlMap(url, k, search, limit ?? 50);
                calls.push({ tool: "map", target: url, ok: true });
                return out;
              } catch (e) {
                const msg = e instanceof Error ? e.message : "map_failed";
                calls.push({ tool: "map", target: url, ok: false, error: msg });
                return { error: msg };
              }
            },
          }),
        },
      });

      // Anexar trazas de uso real de Firecrawl para que el usuario pueda verificar.
      let trace = "";
      if (calls.length === 0) {
        trace = firecrawlKey
          ? "\n\n---\n⚠️ El modelo no invocó ninguna herramienta web en esta respuesta."
          : "\n\n---\n⚠️ Firecrawl no está configurado: la respuesta no incluye datos en vivo. Conéctalo en Conexiones.";
      } else {
        const ok = calls.filter((c) => c.ok).length;
        const fail = calls.length - ok;
        trace = `\n\n---\n🔎 Firecrawl: ${calls.length} llamada(s) (${ok} OK, ${fail} error). ${
          searchedQueries.size
        } búsqueda(s), ${scrapedUrls.size} URL(s) recuperadas en vivo.`;
      }

      return { text: result.text + trace, toolCalls: calls, scrapedUrls: [...scrapedUrls] };
    } catch (err: unknown) {
      const e = err as { statusCode?: number; status?: number; message?: string };
      const status = e.statusCode ?? e.status;
      if (status === 429) {
        throw new Error("Límite de peticiones alcanzado. Inténtalo en unos segundos.");
      }
      if (status === 402) {
        throw new Error("Sin créditos de IA. Añade créditos en el workspace para continuar.");
      }
      throw new Error(e.message ?? "Error al llamar a la IA.");
    }
  });
