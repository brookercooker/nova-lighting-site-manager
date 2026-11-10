CREATE OR REPLACE FUNCTION public.admin_emails_normalize_email()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.email := lower(btrim(NEW.email));
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_emails_normalize_email
BEFORE INSERT OR UPDATE OF email ON public.admin_emails
FOR EACH ROW EXECUTE FUNCTION public.admin_emails_normalize_email();
UPDATE public.admin_emails SET email = lower(btrim(email));
ALTER TABLE public.admin_emails ADD CONSTRAINT admin_emails_email_normalized CHECK (email = lower(btrim(email)));
REVOKE ALL ON public.chat_requests, public.collection_mappings, public.design_messages, public.product_mappings, public.render_tokens, public.sync_logs, public.sync_runs, public.wishlists, public.wishlist_items FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;