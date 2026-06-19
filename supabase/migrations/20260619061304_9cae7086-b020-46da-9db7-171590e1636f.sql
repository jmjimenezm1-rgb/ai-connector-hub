
CREATE TABLE public.ai_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  module TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_prompts TO anon, authenticated;
GRANT ALL ON public.ai_prompts TO service_role;
ALTER TABLE public.ai_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_prompts open read" ON public.ai_prompts FOR SELECT USING (true);
CREATE POLICY "ai_prompts open insert" ON public.ai_prompts FOR INSERT WITH CHECK (true);
CREATE POLICY "ai_prompts open update" ON public.ai_prompts FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "ai_prompts open delete" ON public.ai_prompts FOR DELETE USING (true);

CREATE TABLE public.ai_connections (
  provider_id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  api_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_connections TO anon, authenticated;
GRANT ALL ON public.ai_connections TO service_role;
ALTER TABLE public.ai_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_connections open read" ON public.ai_connections FOR SELECT USING (true);
CREATE POLICY "ai_connections open insert" ON public.ai_connections FOR INSERT WITH CHECK (true);
CREATE POLICY "ai_connections open update" ON public.ai_connections FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "ai_connections open delete" ON public.ai_connections FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_ai_prompts_updated BEFORE UPDATE ON public.ai_prompts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_ai_connections_updated BEFORE UPDATE ON public.ai_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
