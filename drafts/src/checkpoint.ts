import * as Automerge from "@automerge/automerge/slim";
import {
  decodeHeads,
  encodeHeads,
  type AutomergeUrl,
  type Repo,
  type UrlHeads,
} from "@automerge/automerge-repo/slim";

import type { DraftCheckpoint, DraftMemberDoc } from "./draft-types.js";

// One change in a timeline: the member doc it belongs to, its hash and time.
export type ChangeRef = {
  docUrl: AutomergeUrl;
  hash: string;
  time: number;
};

// Diff baseline mode for a checkpoint. `"none"` writes no `from` (no diff);
// `{ beforeTime }` anchors each member's `from` at its state just before that
// absolute time — the draggable baseline handle's position — so everything
// from there up to the head reads as the diff. The baseline is independent of
// the head (see `onScrub`/`onBaselineScrub`): the two are resolved separately
// and only clamped so the baseline stays at or older than the head.
export type CheckpointBase = "none" | { beforeTime: number };

// Build the checkpoint map for a scrub position. Each member's displayed
// version (`to`) is its heads as of `head`: the doc that owns that change is
// pinned exactly to it, every other member to its latest change at or before
// it (approximate but good enough). The diff baseline (`from`) follows
// `base`: omitted for `"none"`, or the member's heads just before
// `beforeTime` (falling back to the fork point — empty heads on main — when
// no post-fork change precedes it). Members with no change at or before
// `head` are omitted entirely: they didn't exist yet, so they fall through to
// live.
export async function computeCheckpoint(
  repo: Repo,
  members: DraftMemberDoc[],
  head: ChangeRef,
  base: CheckpointBase
): Promise<DraftCheckpoint> {
  const checkpoint: DraftCheckpoint = {};
  for (const member of members) {
    try {
      const handle = await repo.find<unknown>(member.cloneUrl ?? member.url);
      const doc = handle.doc();
      if (!doc) continue;
      const since = member.clonedAt ? decodeHeads(member.clonedAt) : [];
      const metas = Automerge.getChangesMetaSince(doc, since);

      // Displayed version: exactly the head change for the doc that owns it,
      // otherwise the member's latest change at or before it.
      let to: UrlHeads;
      if (member.url === head.docUrl) {
        // Pin the head's doc exactly even if it falls outside the metas
        // window (robust against a mismatched fork point).
        to = encodeHeads([head.hash]);
      } else {
        let pinnedIndex = -1;
        let bestTime = -Infinity;
        metas.forEach((m, i) => {
          if (m.time <= head.time && m.time >= bestTime) {
            bestTime = m.time;
            pinnedIndex = i;
          }
        });
        if (pinnedIndex < 0) continue;
        to = encodeHeads([metas[pinnedIndex].hash]);
      }

      if (base === "none") {
        checkpoint[member.url] = { to };
        continue;
      }

      // Diff baseline: the member's newest change strictly before the
      // baseline's time. None post-fork means the baseline sits at or before
      // the start of the member's history in this timeline, so diff against
      // the fork point (empty heads on main — the whole doc reads as added).
      let fromIndex = -1;
      let fromTime = -Infinity;
      metas.forEach((m, i) => {
        if (m.time < base.beforeTime && m.time >= fromTime) {
          fromTime = m.time;
          fromIndex = i;
        }
      });
      const from =
        fromIndex >= 0
          ? encodeHeads([metas[fromIndex].hash])
          : (member.clonedAt ?? encodeHeads([]));
      checkpoint[member.url] = { from, to };
    } catch (err) {
      console.warn(
        "[drafts] failed to compute checkpoint for member:",
        member,
        err
      );
    }
  }
  return checkpoint;
}
