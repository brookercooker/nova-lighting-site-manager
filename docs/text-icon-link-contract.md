# Text Icon & Link: public-site companion contract

The Manager mirrors the supplied three-hunk update from Public commit `89e55b8` in `src/lib/inlineEditCore.ts`, retaining before/after placement and restoring hidden/placeholder validation. Icons/links affect the whole selected element, never the highlighted word range. Existing range formatting remains unchanged.

## Stored maps and keys

Pages: `pages.inline_edits`. Objects: `object_registry.inline_edits`. Values are strings. Paths are the original numeric dotted element paths (including the empty root path), not generated icon/wrapper paths.

```json
{
  "icon:0.1": "Mail",
  "icon-position:0.1": "before",
  "link:0.1": "{\"href\":\"/about\",\"target\":\"_blank\"}",
  "fp:0.1": "{\"v\":1,\"tag\":\"h2\",\"t\":\"original-hash\"}"
}
```

- `icon:<path>`: existing Lucide icon name from Manager's `LINK_ICONS`, `material:(outlined|rounded|sharp):<name>` (name matches `[a-z0-9_]{1,100}`), or `none` to hide the original/edited icon.
- `icon-position:<path>` is `before` or `after` only, strictly validated by the shared core. Absent means existing placement; new inserted icons default to after. Manager displays After Text for absent placement.
- `link:<path>`: existing JSON `{ "href": "...", "target": "_blank" }` (target optional) or `{ "unlinked": true }`. Omitted target means same tab. Omitted override restores original destination. Empty URL becomes unlinked, not an empty href.
- Original `fp:<path>` stays unchanged; adornments never enter the text fingerprint or original snapshot.

## Messages (no new message name required)

Existing exact-origin/window-validated `edit-init` and `edit-update` carry the entire maps, including the new position key:

```ts
{ source: "nova-manager", type: "edit-init" | "edit-update",
  edits: Record<string,string>,
  objectEdits: Record<string,Record<string,string>>,
  collapsed: string[], selectedKey: string | null,
  // existing heldBlocks, objectSwaps, activeBlockId fields remain unchanged
}
```

Object-only mode retains `scope:"object"`, its existing object snapshot and `edits` under `object:<id>`. Public `edit-change {source:"nova-site",type:"edit-change",scope,next}` must preserve valid position keys in the whole `next` map, even when another text/style edit changed. Existing `edit-applied` reports should include placement keys and fingerprint/orphan outcomes. `edit-query` with `op:"record"` must record the original element fingerprints for positions too.

No new capability or message is required. Both projects' shared core handles placement in parse/validate/replay/restore, fingerprints and path grouping. Manager's `editMap` uses the core directly for edit-change and record replies; there is no separate placement extension validator. The trusted iconMarkup adapter supplies Lucide SVG or parsed Material spans.

### Hidden/placeholder validation compatibility resolved

Public `89e55b8` restores `hidden:<path>` (only the string `"1"`) and `placeholder:<path>` (strings of at most 300 characters). Saved mixed maps now validate in full through the shared core and Manager's `editMap`; unknown kinds still reject the incoming map. Delete Image retains the same hidden key/value; form hints retain the same placeholder key, slice input to 300 characters and remove the override when cleared. No saved-key migration or message changes are needed.

This closes the old parse/validation gap, not a live rendering check: the supplied shared core has no hidden/placeholder DOM mutation or restoration branches. Its replay can report these keys as applied without changing visibility or the placeholder attribute. Keep the core verbatim; actual public-frame rendering remains separately unverified.

## Rendering and interaction

1. Resolve/fingerprint-check the original selected element before replay. Use the same path for html, icon and position. Do not key against inserted nodes.
2. Compose original or edited sanitized HTML and the selected decorative icon once. Place that icon before/after all the element's text contents, without replacing text or existing range styles. Move the existing icon when a placement-only override is present. Do not accumulate icons on repeated replay, or alter unrelated icons/descendants.
3. Remove overrides/reset/discard/undo by restoring original snapshots exactly; preserve the original icon position and text. `none` hides the owned icon, not all decorative descendants. `Use Original Icon` deletes icon and placement overrides.
4. Existing link replay already handles anchors and nonanchors via capture-phase handlers. Preserve independent ancestor link scopes/paths supplied in `edit-select.selection.link`; absent link metadata means the selected text itself is the link target. Never create nested anchors or wrap native buttons/labels in anchors.
5. For a linked noninteractive element, supply keyboard access (focusability, link role, Enter activation) and restore original attributes/handlers when removed. Preserve native anchor/button keyboard behavior. Do not hijack form-label activation or native interactive descendants. Decorative icons are `aria-hidden="true"`.
6. Disable visitor destination handlers in Manual Edit; allow selection/formatting/scrolling. Same-tab paths use the router; external/mail/telephone destinations follow the existing navigation handler; new-tab links use `noopener noreferrer`, including modifier/middle-click behavior.

## Security

### Original link selection metadata

`edit-select.selection.link` (or the selection itself for a directly selected link) may supply `originalHref: string | null` and `originalTarget: "_blank" | null`, captured before replay. Manager uses this metadata outside the verbatim shared core. For older selection replies it requests the exact editor frame's v1 link inventory, matching both scope and key and reading `originalHref`. Current `attrs.href` is only a display fallback, never restoration authority. Until an original is reported, Restore is disabled; when known, Restore removes only the link override and immediately refreshes Link Address. Public must answer inventories in object-only editor mode too, including shared/header/footer scopes.

- Validate exact origin and frame window, session and scope/key just as existing edit messages do. Preserve current payload caps.
- New UI destinations accept only `https://` with a hostname, nonempty `mailto:`, nonempty telephone `tel:`, or paths beginning with a single `/`. Reject protocol-relative paths, backslashes, whitespace/control characters, javascript/data/http/ftp and other schemes. Never coerce unsafe values into links. Historical overrides continue through existing replay validation; do not broaden it.
- Icons resolve only through the existing trusted Lucide set or parsed Material names. Never render supplied HTML, scripts, SVG event attributes or external icon URLs.
- Validate position strictly as `before|after`; reject malformed paths/values. Keep verification metadata separate from visible edits and restore previous state on fingerprint mismatch.

## Companion checks

Heading/paragraph/button/label: icon before/after + link + new tab; Undo/Redo/Save/reload; original restoration and no-op replay; preserved highlighted-word formatting; keyboard activation; unsafe URL/icon rejection; edits of another style retain the position key. Keep generated icons out of editable wording snapshots, section discovery and path enumeration.