# Edge Function Security
- Admin-only CORS and thumbnail destinations share the explicit embed/Manager origin allow-list; never infer trusted hosts from a hosting suffix.
- Admin-email lookups use normalized exact equality and database normalization, never wildcard matching, to prevent unintended privilege matches.- Admin-users writes best-effort admin_audit_log rows after each successful action; storage moves (publish-assets) verify gate removal from the public bucket before updating rows.
