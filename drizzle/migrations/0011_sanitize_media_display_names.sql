CREATE OR REPLACE FUNCTION public.sanitize_media_display_name(value text, fallback text DEFAULT 'upload') RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE cleaned text;
BEGIN
  cleaned := btrim(regexp_replace(coalesce(value, ''), '[[:cntrl:]<>/\\]', '', 'g'));
  cleaned := btrim(regexp_replace(cleaned, '^\.+', ''));
  IF cleaned = '' THEN cleaned := btrim(regexp_replace(coalesce(fallback, 'upload'), '[[:cntrl:]<>/\\]', '', 'g')); cleaned := btrim(regexp_replace(cleaned, '^\.+', '')); END IF;
  IF cleaned = '' THEN cleaned := 'upload'; END IF;
  RETURN left(cleaned, 80);
END;
$$;
CREATE OR REPLACE FUNCTION public.sanitize_media_name_on_write() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'images' THEN NEW.filename := public.sanitize_media_display_name(NEW.filename);
  ELSE NEW.name := public.sanitize_media_display_name(NEW.name); END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sanitize_image_name BEFORE INSERT OR UPDATE OF filename ON public.images FOR EACH ROW EXECUTE FUNCTION public.sanitize_media_name_on_write();
CREATE TRIGGER sanitize_video_name BEFORE INSERT OR UPDATE OF name ON public.videos FOR EACH ROW EXECUTE FUNCTION public.sanitize_media_name_on_write();