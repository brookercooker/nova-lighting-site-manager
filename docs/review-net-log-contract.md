# Published-baseline change log

The Manager groups repeated plain link-save descriptions for compact presentation only. Descriptions lack element identity, original published values and target changes; “restored the original” can restore a coded draft original that is not live. They must not authorize hiding edits or subtracting counts.

The service may add `draft.netChanges = {baseline:"published", items:[{id,summary,changed,requestIds}]}` to its existing state reply. This must be the complete current pending inventory, with stable page/object + element identities and values compared to the published version (including href/target/unlinked, text, styles and content). Include chat/developer items and reverted items. `changed:false` means proven published equivalence, not a restore action or equality with the opening draft.

Manager validates the entire inventory, shares its changed-item count across Status and All Changes, hides reverted items by default, and offers Show N Reverted Edits. Missing/invalid inventory retains the authoritative pending-request count, never an invented net count. Submit and publish gates continue using their existing service rules unchanged.

Text changed and restored is net zero only when its current text/formatting equals the published baseline; later chat wording and duplicate labels require authoritative element identity. Restore descriptions alone are insufficient.