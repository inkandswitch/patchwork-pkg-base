import "./styles.css";
import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { RepoContext, useDocument } from "solid-automerge";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { You } from "./you/You";
import { Theme } from "./theme/Theme";
import { Frame } from "./frame/Frame";
import { Contributed } from "./contributed/Contributed";
import type { AccountDoc } from "./you/contact";

// settings, on the account doc: you, the theme, the frame, and then a
// section for every package that's asked for one (patchwork:settings)
function SettingsPage(props: { handle: DocHandle<AccountDoc>; element: ToolElement }) {
  const [account] = useDocument<AccountDoc>(() => props.handle.url);
  const repo = props.element.repo as unknown as Repo;

  return (
    <div class="settings">
      <div class="settings-page">
        <h1>settings</h1>
        <Show when={account()}>
          <You handle={props.handle} account={account} repo={repo} />
          <Theme element={props.element} account={account} />
          <Frame element={props.element} handle={props.handle} account={account} repo={repo} />
          <Contributed element={props.element} account={account} />
        </Show>
      </div>
    </div>
  );
}

export default function renderSettings(handle: DocHandle<AccountDoc>, element: ToolElement) {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo as any}>
        <SettingsPage handle={handle} element={element} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
}
