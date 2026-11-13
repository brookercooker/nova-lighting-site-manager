# Round 31 companion brief — Nova Lighting Public Site

For project `aeb60cc1-b08d-4938-9d83-88c44335e167`. Read-only source inspected at `f8b39e1d`; this Manager commit does not modify or deploy Public.

## Confirmed source issues

- `src/lib/linkCheckBridge.ts` currently only posts `link-click`; it does not open a tab and reports no element identity or opening result. `ownerOf` chooses the outermost ancestor, and focus finds the first anchor with the same destination. Those rules cannot distinguish a card and its nested overridden links.
- `src/lib/linkInventory.ts` reports coded `originalHref`, not necessarily the published destination. It includes outer navigation owners and independently overridden nested text. Saved Manager Homepage overrides currently include `link:0.5.0.0 → /inspiration-gallery`, `link:0.5.0.0.2.2 → /contact`, and `link:0.5.0.1 → /contact`. The nested span has a stored fingerprint; the last key does not. These records do not establish which live navigation owner each label represents.
- Source Homepage cards link to `/contact` and `/inspiration-gallery`; consultation links point to `/contact`. These are source defaults, **not verified deployed published baselines**. Actual live-versus-draft pairs for the reported “Card link” and “Book a Consultation” cannot currently be established from the available frame.

## Build in Public

1. On trusted `link-check` with `openInFrame:true`, open the effective destination synchronously in the real click/Enter handler, before `postMessage` or any await. Keep preview navigation suppressed. Detect blockers by synchronously opening `about:blank`; if a Window is returned, set `opener=null` before loading content, add a no-referrer policy and navigate that tab using an anchor with `rel="noopener noreferrer"` and no-referrer. Validate protocols; never open Manager/edit/token-bearing URLs, never auto-close. Do not use `window.open(...,'noopener') === null` as proof of blocking: successful noopener opens can return null.
2. Include additive `opened:boolean` in the existing v2 `link-click`, both for changed and unchanged links. Manager honors this result and never makes a second popup. When unsupported, Manager retains its existing parent fallback; a restrictive browser pane can still block it.
3. Determine the exact effective navigation owner using the **same identity resolver as link inventory/manual selection**. A nested independently overridden element must not be rewritten to its outer card. Report `elementKey`, `scope`, and `inventoryIndex` for repeated keys, plus actual page `path`, raw/effective resolved destinations, visible label, kind and existing match. `link-check-focus` now carries the same optional identity; match that before href, never flash the first same-destination link blindly. No changes to inlineEditCore.
4. Supply `publishedHref` only from a real same-page/scope/original-key published baseline. `null` means the element is proven absent from a **complete** published inventory (a new link); omission means unknown, not new. Do not rename coded `originalHref` into publishedHref. Alternatively make both deployed live and draft frames answer inventory so Manager performs the comparison itself. Manager also accepts authoritative `publishedHref` on relay review-link rows.
5. Report a usable original dotted numeric key, explicit target and valid original fingerprint for each editable navigation owner. Investigate the nested span/outer card mismatch and whether `0.5.0.1` is a real saved owner. Never fabricate identities or fingerprints to satisfy Manager.

## Acceptance checks

- In Chromium with popup blocking enabled, and regular Safari/Firefox: click/Enter changed and unchanged links; one safe tab opens, preview stays put, no duplicate parent tab. A blocked result still selects the correct changed tile; its direct opening icon unlocks Approve.
- Three Homepage links sharing `/contact` (card, nested image/text owner, consultation): clicking, focusing and saving choose only the exact owner; preserve other overrides and fingerprints.
- Live/draft inventories show both restored card and consultation destinations equal; only the swapped image pair remains. Unknown comparisons never enter the approval count.
- Same destination on Homepage, Pricing and Contact: click path selects only that page's tile; shared-object scope retains its intentional single identity.