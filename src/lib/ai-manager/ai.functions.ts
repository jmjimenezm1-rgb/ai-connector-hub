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
      onlyMainContent: false,
      maxAge: 0,
      waitFor: waitFor ?? 2500,
      timeout: 45000,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firecrawl scrape ${res.status}: ${text.slice(0, 200)}`);
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
    const calls: Array<{ tool: "search" | "scrape" | "map"; target: string; ok: boolean; bytes?: number; error?: string }> = [];
    const liveScrapedUrls = new Set<string>(); // SOLO scrapes reales (no resultados de search)
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

REGLAS OBLIGATORIAS (incumplirlas = respuesta inválida):
1. Para cualquier dato externo, actual o verificable DEBES usar las herramientas (web_search, web_map, web_scrape). Nada de memoria.
2. PROHIBIDO inventar cifras, totales, listados, fechas, nombres, precios o URLs. Todo dato concreto en tu respuesta debe aparecer literalmente en el "content" devuelto por al menos un web_scrape de esta misma respuesta. Si no lo tienes en un scrape, NO LO ESCRIBAS.
3. Si un web_scrape devuelve "empty: true" o "contentLength" < 500, el scrape FRACASÓ (página vacía, JS no renderizado, login, error). NO lo trates como "0 resultados". Reintenta con otra URL/parámetros o con waitFor mayor (5000-10000 ms). Solo después de 2-3 intentos fallidos puedes declarar que no hay datos accesibles, y debes listar cada URL probada con su contentLength.
4. Protocolo para portales con formularios (BOE/subastas BOE, BORME, AEAT, INE, sedes electrónicas):
   a) Identifica el dominio oficial.
   b) Construye la URL del buscador con los parámetros REALES del formulario en la query string.
   c) Llama web_scrape con waitFor: 4000 sobre esa URL.
   d) Para cada resultado, extrae el href de la ficha y haz web_scrape de la ficha individual.
5. URL canónica del buscador del Portal de Subastas del BOE (subastas.boe.es):
   https://subastas.boe.es/subastas_ava.php?accion=Buscar&dato[direccion]=&dato[localidad]=&dato[coddir3]=&dato[id_estado_array]=EJ&dato[id_tipo_subasta]=&dato[codigo_postal]=CP_AQUI&campo[0]=BIEN.LOCALIDAD&dato[0]=&campo[1]=BIEN.CODPOSTAL&dato[1]=CP_AQUI&campo[2]=SUBASTA.ESTADO&dato[2]=EJ&page_hits=50&sort_field[0]=SUBASTA.FECHA_FIN_YMD&sort_order[0]=desc
   Estados: EJ = celebrándose, CE = celebrada/cerrada, AN = anunciada.
   Sustituye CP_AQUI por el código postal. Si el primer intento devuelve poco contenido, prueba la versión simplificada: https://subastas.boe.es/subastas_ava.php?accion=Buscar&dato[codigo_postal]=CP_AQUI&dato[id_estado_array]=EJ
6. Cierra con sección "Fuentes" listando solo las URLs que realmente scrapeaste con contenido > 500 chars.
7. Idioma: español por defecto.`;

    try {
      const result = await generateText({
        model: gateway(data.model ?? "google/gemini-3-flash-preview"),
        system,
        prompt: data.prompt,
        stopWhen: stepCountIs(50),
        tools: {
          web_search: tool({
            description:
              "Busca en la web en tiempo real vía Firecrawl. Acepta operadores site:, comillas, -excluir. Usa tbs (qdr:h|d|w|m|y) para frescura. NOTA: los resultados de search NO equivalen a datos verificados; para usarlos en la respuesta debes después hacer web_scrape de la URL.",
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
                return { results, note: "Estos snippets son referenciales. Para citar datos concretos, scrapea la URL." };
              } catch (e) {
                const msg = e instanceof Error ? e.message : "search_failed";
                calls.push({ tool: "search", target: query, ok: false, error: msg });
                return { error: msg };
              }
            },
          }),
          web_scrape: tool({
            description:
              "Descarga el contenido de una URL EN VIVO (sin caché) vía Firecrawl. Devuelve content, contentLength y empty. Si empty=true o contentLength<500, considera que el scrape FRACASÓ y reintenta con otra URL o waitFor mayor.",
            inputSchema: z.object({
              url: z.string().url(),
              waitFor: z.number().int().min(0).max(15000).optional(),
            }),
            execute: async ({ url, waitFor }) => {
              try {
                const k = ensureKey();
                const out = await firecrawlScrape(url, k, waitFor);
                calls.push({ tool: "scrape", target: url, ok: true, bytes: out.contentLength });
                if (!out.empty) liveScrapedUrls.add(out.url);
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
              "Descubre URLs reales dentro de un dominio (sitemap rápido) vía Firecrawl. Útil antes de scrape.",
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

      // Anexar trazas REALES (solo scrapes con contenido cuentan como datos en vivo).
      const scrapeCalls = calls.filter((c) => c.tool === "scrape");
      const scrapeOk = scrapeCalls.filter((c) => c.ok);
      const scrapeEmpty = scrapeOk.filter((c) => (c.bytes ?? 0) < 500);
      const scrapeUseful = scrapeOk.length - scrapeEmpty.length;

      let trace = "";
      if (calls.length === 0) {
        trace = firecrawlKey
          ? "\n\n---\n⚠️ El modelo no invocó ninguna herramienta web. La respuesta NO contiene datos en vivo."
          : "\n\n---\n⚠️ Firecrawl no está configurado. Conéctalo en Conexiones.";
      } else {
        const searchN = calls.filter((c) => c.tool === "search").length;
        const mapN = calls.filter((c) => c.tool === "map").length;
        trace = `\n\n---\n🔎 Firecrawl: ${searchN} search · ${mapN} map · ${scrapeCalls.length} scrape (${scrapeUseful} con contenido, ${scrapeEmpty.length} vacíos, ${scrapeCalls.length - scrapeOk.length} error).`;
        if (scrapeCalls.length > 0) {
          const detail = scrapeCalls
            .map((c) => {
              if (!c.ok) return `   ✗ ${c.target} → error: ${c.error ?? "?"}`;
              const b = c.bytes ?? 0;
              const flag = b < 500 ? "⚠ vacío" : `${b} chars`;
              return `   ${b < 500 ? "○" : "●"} ${c.target} → ${flag}`;
            })
            .join("\n");
          trace += `\n${detail}`;
        }
        if (scrapeUseful === 0 && scrapeCalls.length > 0) {
          trace += `\n\n⚠️ Ningún scrape devolvió contenido útil. Cualquier dato concreto en la respuesta NO está verificado.`;
        }
      }

      return { text: result.text + trace, toolCalls: calls, scrapedUrls: [...liveScrapedUrls] };
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
