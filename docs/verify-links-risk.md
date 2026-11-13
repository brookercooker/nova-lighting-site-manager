# Verify Changed Links risk review

- Domain, spelling, keyword mismatch, duplicate and reciprocal swap rules live in `linkRisk.ts`. `tldts` uses the public suffix list. Warnings are advisory and never approve links or change Submit.
- Confirmation requires opening that exact link first, including mail and telephone links. Missing destinations remain blocked. Trusted domains do not bypass confirmation.
- Ordering snapshots reset on Verify Changed Links opening and link-list/destination changes, not confirmation. Tab-session expansion/completion preferences are separate from fingerprinted decisions; manually opened done groups stay open.
- The database instance belongs to one site. `trusted_review_domains` is shared by its admins: SELECT/INSERT/DELETE use server-validated admin roles; a trigger rejects schemes, paths, ports, www prefixes, uppercase, encoded hosts and malformed domain labels. No anonymous privileges. `created_by` and `created_at` record who added each host.
- Compact review tiles show linked wording (or Image) and the destination; page peeks and Page found badges are omitted. Missing-page and advisory risk context remain.
- Three bounded inventory workers collect known external hosts from the site's registered pages, including rendered shared header/footer links. Unreachable inventories are omitted, not invented; brand and trusted-domain checks still work.

## Public dependency: existing v1 fields, no new protocol

No new message/version is required. Existing `label`/optional `visibleText` should report actual visible linked wording (first nested heading for a card), not generated destination names. Existing optional `image: {alt,src}` supplies image-link display. Existing `originalHref` supplies pre-edit context and swaps; when live inventories are available Manager also derives it from matched live scope/key.

Public source snapshot a17a666b confirms `src/lib/linkInventory.ts` selects the first visible nested h1–h6 into `label`; it does not send a separate heading or visibleText field. It sends `image:{alt,src}` when the first visible content is an img (currentSrc/src resolved absolute); text-first/background-image links return image:null. Page and object scopes share the producer. This is source confirmation, not evidence that every deployed frame runs that snapshot. Manager never guesses missing metadata. Page peek thumbnails are separate Manager saved-image/page-thumbnail data, not link inventory images; coded hero imports are not available from that data.

## QA polish

Single strongest risk summaries expand secondary reasons. Destination typing uses the same host warnings. Trusted Domains UI and all review consumers are removed; the table/data is untouched. Inventory display caches persist across review reopening per origin/page; requests show Checking links, failures retain known metadata and expose Retry. Cached metadata never authorizes saves or supplies published-baseline counts. Unavailable originals hide Restore and its dependent Remove action. Verification uses safe icon links and never auto-closes tabs. Phone preview checking hides rather than unmounts the list; focus/reconnect do not refetch review queries.

## Verification

Focused unit/component rules, responsive actual-row fixtures and real authenticated trusted-domain create/read/remove/invalid-host rejection are exercised. A temporary QA domain is removed after verification. No site link is changed and Submit is never pressed. Actual Public navigation remains unavailable in this sandbox (refused frame and design-service connection failure).
Signed-in QA on Nov 13 confirms Contact and Inspiration Gallery have build_status Ready, legacy status Draft, no saved image blocks and no stored thumbnail. The old peek incorrectly treated the legacy status as publication. Title-only peeks are therefore correct; extracting coded hero images would require authoritative page-media data not supplied here. The live Public preview still refuses its frame connection; responsive checks use controlled data with the real review UI and no site writes.
