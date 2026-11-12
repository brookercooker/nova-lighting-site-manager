-- Run against the application database. All columns must return true.
SELECT
  public.sanitize_media_display_name('   ') = 'upload' AS blank_safe,
  public.sanitize_media_display_name('../../etc/passwd') = 'etcpasswd' AS path_safe,
  public.sanitize_media_display_name('a/b' || chr(92) || 'c') = 'abc' AS separators_safe,
  public.sanitize_media_display_name('<script>') = 'script' AS markup_safe,
  length(public.sanitize_media_display_name(repeat('a', 400))) = 80 AS length_safe,
  public.sanitize_media_display_name('a' || chr(10) || 'b') = 'ab' AS control_safe,
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('sanitize_image_name', 'sanitize_video_name')) = 2 AS triggers_installed;