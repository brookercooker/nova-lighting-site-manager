REVOKE ALL ON public.admin_audit_log FROM authenticated;
GRANT SELECT ON public.admin_audit_log TO authenticated;