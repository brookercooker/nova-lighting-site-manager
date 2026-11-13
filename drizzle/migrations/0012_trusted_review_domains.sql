CREATE TABLE public.trusted_review_domains (
 domain text PRIMARY KEY,
 created_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.trusted_review_domains TO authenticated;
GRANT ALL ON public.trusted_review_domains TO service_role;
ALTER TABLE public.trusted_review_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read trusted domains" ON public.trusted_review_domains FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins trust domains" ON public.trusted_review_domains FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') AND created_by = auth.uid());
CREATE POLICY "Admins remove trusted domains" ON public.trusted_review_domains FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE FUNCTION public.validate_trusted_review_domain() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF NEW.domain <> lower(NEW.domain) OR length(NEW.domain) > 253 OR NEW.domain LIKE 'www.%' OR NEW.domain LIKE '%xn--%' OR NEW.domain !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$' OR NEW.domain LIKE '%--%' THEN
  RAISE EXCEPTION 'Enter a plain lowercase domain without a scheme, path, port or www.';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER validate_trusted_review_domain BEFORE INSERT OR UPDATE ON public.trusted_review_domains FOR EACH ROW EXECUTE FUNCTION public.validate_trusted_review_domain();