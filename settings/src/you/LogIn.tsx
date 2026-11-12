// logging in: paste the key from another computer, see who it's for, and
// this computer becomes them (in a <dialog>, like the cropper)
import { createMemo, createResource, createSignal, onMount } from "solid-js";
import type { AutomergeUrl, Repo } from "@automerge/automerge-repo/slim";
import {
  ACCOUNT_URL_STORAGE_KEY,
  accountUrlFromToken,
  type AccountDoc,
  type ContactDoc,
} from "./contact";

export function LogIn(props: {
  here: AutomergeUrl;
  repo: Repo;
  onCancel: () => void;
}) {
  const [key, setKey] = createSignal("");
  const target = createMemo(() => accountUrlFromToken(key()));
  // the account the key is for, and its name, if it's an account at all
  const [found] = createResource(target, async (url) => {
    try {
      const account = (await props.repo.find<AccountDoc>(url)).doc();
      if (!account?.contactUrl && !account?.rootFolderUrl) return null;
      const contact = account.contactUrl
        ? (await props.repo.find<ContactDoc>(account.contactUrl)).doc()
        : undefined;
      return { url, name: contact?.type === "registered" ? contact.name : "" };
    } catch {
      return null;
    }
  });

  const problem = () => {
    if (!key().trim()) return;
    if (!target()) return "That's not an account key";
    if (target() === props.here) return "That's this account";
    if (found.loading) return;
    if (!found()) return "Couldn't find that account";
  };
  const account = () => {
    const it = found.loading ? undefined : found();
    return it && it.url === target() && !problem() ? it : undefined;
  };

  function logIn(event: SubmitEvent) {
    event.preventDefault();
    const it = account();
    if (!it) return;
    localStorage.setItem(ACCOUNT_URL_STORAGE_KEY, it.url);
    window.location.replace("/");
  }

  let dialog!: HTMLDialogElement;
  onMount(() => dialog.showModal());

  return (
    <dialog
      ref={dialog}
      class="settings-dialog settings-login"
      aria-labelledby="settings-login-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
      onClick={(event) => event.target === dialog && props.onCancel()}
    >
      <form onSubmit={logIn}>
        <h3 id="settings-login-title" class="settings-login-title">
          Log in
        </h3>
        <p class="settings-note">
          Paste your account key. You can copy it from settings on any computer
          you're logged in on.
        </p>
        <input
          class="settings-input settings-code"
          type="password"
          placeholder="account:…"
          aria-label="Account key"
          aria-invalid={!!problem() || undefined}
          autocomplete="off"
          spellcheck={false}
          autofocus
          value={key()}
          onInput={(event) => setKey(event.currentTarget.value)}
        />
        <p class={problem() ? "settings-error" : "settings-note"} role="status">
          {problem() ??
            (found.loading && target() ? "Looking for that account…" : " ")}
        </p>
        <div class="settings-dialog-actions">
          <button
            type="button"
            class="settings-button"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            class="settings-button"
            data-primary
            disabled={!account()}
          >
            {account()?.name ? `Log in as ${account()!.name}` : "Log in"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
