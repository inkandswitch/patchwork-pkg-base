import { render } from "solid-js/web";
import { RepoContext } from "solid-automerge";
import type { ToolImplementation } from "@inkandswitch/patchwork-plugins";
import { DraftsSidebar } from "./DraftsSidebar";
import { baseRepo } from "./draft-repo";

// The sidebar renders inside the drafts overlay but manages it, so it works
// against the repo beneath it.
export const renderDraftsSidebar: ToolImplementation = (_handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={baseRepo(element.repo)}>
        <DraftsSidebar element={element} />
      </RepoContext.Provider>
    ),
    element
  );
};
