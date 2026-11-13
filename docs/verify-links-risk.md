# Verify Links risk review

- Domain, spelling, keyword mismatch, duplicate and reciprocal swap rules live in `linkRisk.ts`. `tldts` uses the public suffix list. Warnings are advisory and never approve links or change Submit.
- Confirmation requires opening that exact link first, including mail and telephone links. Missing destinations remain blocked. Trusted domains do not bypass confirmation.
- Ordering snapshots reset on Verify Links opening and link-list/destination changes, not confirmation. Tab-session expansion/completion preferences are separate from fingerprinted decisions; manually opened done groups stay open.
- The database instance belongs to one site. `trusted_review_domains` is shared by its admins: SELECT/INSERT/DELETE use server-validated admin roles; a trigger rejects schemes, paths, ports, www prefixes, uppercase, encoded hosts and malformed domain labels. No anonymous privileges. `created_by` and `created_at` record who added each host.
- Page peeks use a saved image block, else the stored page thumbnail. Coded pages lacking either show title/slug only. No destination crawl, external peek or favicon request.
- Three bounded inventory workers collect known external hosts from the site's registered pages, including rendered shared header/footer links. Unreachable inventories are omitted, not invented; brand and trusted-domain checks still work.

## Public dependency: existing v1 fields, no new protocol

No new message/version is required. Existing `label`/optional `visibleText` should report actual visible linked wording (first nested heading for a card), not generated destination names. Existing optional `image: {alt,src}` supplies image-link display. Existing `originalHref` supplies pre-edit context and swaps; when live inventories are available Manager also derives it from matched live scope/key.

Please confirm Public provides those fields for page and object scopes. Manager never guesses image alt/src, nested headings or missing original addresses. Original context and swap detection cannot be complete without `originalHref` or a reachable live inventory. Page thumbnail availability comes from Manager data, not the Public link inventory.

## Verification

Focused unit/component rules, responsive actual-row fixtures and real authenticated trusted-domain create/read/remove/invalid-host rejection are exercised. A temporary QA domain is removed after verification. No site link is changed and Submit is never pressed. Actual Public navigation remains unavailable in this sandbox (refused frame and design-service connection failure).