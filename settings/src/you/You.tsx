// you: your picture, your name, your colour, and which account this is.
// there's no signing up: the first change to any of you makes your contact,
// and a name makes you someone (and not anonymous)
import { createMemo, createSignal, For, Show } from "solid-js";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo/slim";
import { useDocument } from "solid-automerge";
import {
  ACCOUNT_URL_STORAGE_KEY,
  accountToken,
  accountUrlFromToken,
  colorFromString,
  squarePicture,
  USER_COLOR_PALETTE,
  type AccountDoc,
  type ContactDoc,
} from "./contact";

// lattice's pointer: your colour, as people see you
const POINTER_PATH = "M4 1.6v11.6l2.9-2.7 1.9 4.4 2.1-.9-1.9-4.3h4.1z";

export function You(props: {
  handle: DocHandle<AccountDoc>;
  account: () => AccountDoc | undefined;
  repo: Repo;
}) {
  const contactUrl = () => props.account()?.contactUrl;
  const [me, contact] = useDocument<ContactDoc>(contactUrl);

  // your contact, made if you've none yet
  let making: Promise<DocHandle<ContactDoc>> | null = null;
  async function myContact(): Promise<DocHandle<ContactDoc>> {
    const url = contactUrl();
    if (url) return contact() ?? props.repo.find<ContactDoc>(url);
    making ??= props.repo
      .create2<ContactDoc & { "@patchwork": { type: string } }>({
        "@patchwork": { type: "patchwork:contact" },
        type: "anonymous",
      })
      .then((handle) => {
        handle.change((doc) => {
          doc.color = colorFromString(handle.url);
        });
        props.handle.change((doc) => {
          doc.contactUrl = handle.url;
        });
        return handle as unknown as DocHandle<ContactDoc>;
      });
    return making;
  }
  const changeMe = async (fn: (doc: ContactDoc & Record<string, any>) => void) =>
    (await myContact()).change((doc) => fn(doc as ContactDoc & Record<string, any>));

  const name = () => {
    const doc = me();
    return doc?.type === "registered" ? doc.name ?? "" : "";
  };

  function rename(value: string, done: boolean) {
    const next = done ? value.trim() : value;
    changeMe((doc) => {
      if (next.trim() && doc.type !== "registered") (doc as { type: string }).type = "registered";
      if (doc.type === "registered" && (doc.name ?? "") !== next) doc.name = next;
    });
  }

  let pictureInput!: HTMLInputElement;
  const [picturing, setPicturing] = createSignal<string | null>(null);
  async function takePicture(file: File | undefined) {
    if (!file) return;
    setPicturing("uploading…");
    try {
      const content = await squarePicture(file);
      const image = await props.repo.create2<Record<string, unknown>>({
        content,
        mimeType: "image/webp",
        name: file.name,
        extension: "webp",
      });
      await changeMe((doc) => {
        doc.avatarUrl = image.url;
      });
      setPicturing(null);
    } catch (error) {
      console.error("[settings] couldn't use that picture", error);
      setPicturing("couldn't use that picture");
    }
  }

  const myColor = () => me()?.color || (contactUrl() ? colorFromString(contactUrl()!) : undefined);

  return (
    <section class="settings-section" aria-labelledby="settings-you">
      <h2 id="settings-you">you</h2>
      <div class="settings-you">
        <div class="settings-you-face" aria-busy={picturing() === "uploading…"}>
          <button
            type="button"
            class="settings-you-picture"
            title={(me() as any)?.avatarUrl ? "upload another picture" : "upload a picture"}
            disabled={picturing() === "uploading…"}
            onClick={() => pictureInput.click()}
          >
            <Show when={contactUrl()} fallback={<span class="settings-you-nobody">+</span>}>
              {(url) => <patchwork-view doc-url={url()} tool-id="contact-avatar" />}
            </Show>
          </button>
          <Show when={(me() as any)?.avatarUrl}>
            <button
              type="button"
              class="settings-you-unpicture"
              title="remove your picture"
              aria-label="remove your picture"
              onClick={() =>
                changeMe((doc) => {
                  delete doc.avatarUrl;
                })
              }
            >
              ×
            </button>
          </Show>
          <input
            type="file"
            accept="image/*"
            hidden
            ref={pictureInput}
            onChange={(event) => {
              const [file] = event.currentTarget.files ?? [];
              event.currentTarget.value = "";
              takePicture(file);
            }}
          />
        </div>
        <div class="settings-you-says">
          <input
            class="settings-you-name"
            value={name()}
            placeholder="your name"
            aria-label="your name"
            autocomplete="name"
            spellcheck={false}
            onInput={(event) => rename(event.currentTarget.value, false)}
            onChange={(event) => rename(event.currentTarget.value, true)}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
          <Show
            when={picturing()}
            fallback={
              <Show when={!name()}>
                <p class="settings-hint">people see you as anonymous until you've a name</p>
              </Show>
            }
          >
            <p class="settings-hint">{picturing()}</p>
          </Show>
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-label">colour</span>
        <span class="settings-colors" role="radiogroup" aria-label="your colour">
          <For each={USER_COLOR_PALETTE}>
            {(color) => (
              <button
                type="button"
                class="settings-color"
                role="radio"
                style={{ "--settings-color": color.value }}
                aria-checked={myColor() === color.value}
                aria-label={color.name}
                title={color.name}
                onClick={() =>
                  changeMe((doc) => {
                    doc.color = color.value;
                  })
                }
              >
                <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                  <path d={POINTER_PATH} />
                </svg>
              </button>
            )}
          </For>
        </span>
      </div>

      <AccountKey handle={props.handle} name={name} />
    </section>
  );
}

// this account, elsewhere: its key, to use it on another device; someone
// else's key, to use theirs here; and leaving
function AccountKey(props: { handle: DocHandle<AccountDoc>; name: () => string }) {
  const [mode, setMode] = createSignal<"idle" | "using" | "leaving">("idle");
  const [copied, setCopied] = createSignal(false);
  const [token, setToken] = createSignal("");

  const tokenUrl = createMemo(() => accountUrlFromToken(token()));
  const [other] = useDocument<AccountDoc>(tokenUrl);
  const status = () => {
    if (!token().trim()) return null;
    if (!tokenUrl()) return "that isn't an account key";
    if (tokenUrl() === props.handle.url) return "that's this account";
    if (!other()) return "looking for it…";
    if (!other()!.contactUrl) return "that account has nobody in it";
    return null;
  };
  const canUse = () => !!tokenUrl() && tokenUrl() !== props.handle.url && !!other()?.contactUrl;

  function copy() {
    navigator.clipboard.writeText(accountToken(props.handle.url, props.name()));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function switchTo(url: AutomergeUrl | null) {
    if (url) localStorage.setItem(ACCOUNT_URL_STORAGE_KEY, url);
    else localStorage.removeItem(ACCOUNT_URL_STORAGE_KEY);
    window.location.replace("/");
  }

  return (
    <div class="settings-row settings-account">
      <span class="settings-label">account</span>
      <Show when={mode() === "idle"}>
        <span class="settings-cluster">
          <button type="button" class="settings-button" onClick={copy}>
            {copied() ? "copied" : "copy key"}
          </button>
          <button type="button" class="settings-button" onClick={() => setMode("using")}>
            use another…
          </button>
          <button type="button" class="settings-button" onClick={() => setMode("leaving")}>
            sign out
          </button>
        </span>
        <p class="settings-hint settings-row-hint">
          the key is how you use this account on another computer. keep it to yourself
        </p>
      </Show>
      <Show when={mode() === "using"}>
        <form
          class="settings-cluster settings-grow"
          onSubmit={(event) => {
            event.preventDefault();
            if (canUse()) switchTo(tokenUrl()!);
          }}
          onKeyDown={(event) => event.key === "Escape" && setMode("idle")}
        >
          <input
            class="settings-input settings-grow"
            placeholder="account:…"
            aria-label="an account key"
            spellcheck={false}
            value={token()}
            ref={(el) => queueMicrotask(() => el.focus())}
            onInput={(event) => setToken(event.currentTarget.value)}
          />
          <button type="submit" class="settings-button" disabled={!canUse()}>
            use it
          </button>
          <button type="button" class="settings-button" onClick={() => setMode("idle")}>
            cancel
          </button>
        </form>
        <Show when={status()}>
          <p class="settings-hint settings-row-hint" role="status">
            {status()}
          </p>
        </Show>
      </Show>
      <Show when={mode() === "leaving"}>
        <span
          class="settings-cluster"
          role="status"
          onKeyDown={(event) => event.key === "Escape" && setMode("idle")}
        >
          <span>sign out? copy your key first if you want back in</span>
          <button
            type="button"
            class="settings-button"
            ref={(el) => queueMicrotask(() => el.focus())}
            onClick={() => setMode("idle")}
          >
            stay
          </button>
          <button type="button" class="settings-button" data-danger onClick={() => switchTo(null)}>
            sign out
          </button>
        </span>
      </Show>
    </div>
  );
}
