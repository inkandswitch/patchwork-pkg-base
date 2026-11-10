// you: your picture (ringed in your colour), your cursor as people see it
// (click it for another colour), your name, and which account this is.
// there's no signing up: the first change to any of you makes your contact,
// and a name makes you someone (and not anonymous)
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo/slim";
import { useDocument } from "solid-automerge";
import {
  ACCOUNT_URL_STORAGE_KEY,
  accountToken,
  accountUrlFromToken,
  colorFromString,
  hexColor,
  squarePicture,
  USER_COLOR_PALETTE,
  type AccountDoc,
  type ContactDoc,
  type Crop,
} from "./contact";
import { Cropper } from "./Cropper";

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

  // a picture: chosen, cropped, then made small and kept
  let pictureInput!: HTMLInputElement;
  const [cropping, setCropping] = createSignal<{ file: File; src: string }>();
  const [busy, setBusy] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const avatarUrl = () => (me() as any)?.avatarUrl as string | undefined;

  function stopCropping() {
    const pending = cropping();
    if (pending) URL.revokeObjectURL(pending.src);
    setCropping(undefined);
  }
  async function keepPicture(file: File, crop: Crop) {
    stopCropping();
    setBusy(true);
    setFailed(false);
    try {
      const content = await squarePicture(file, crop);
      const image = await props.repo.create2<Record<string, unknown>>({
        content,
        mimeType: "image/webp",
        name: file.name,
        extension: "webp",
      });
      await changeMe((doc) => {
        doc.avatarUrl = image.url;
      });
    } catch (error) {
      console.error("[settings] couldn't use that picture", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // contacts without a colour are grey everywhere, so they're grey here too
  const myColor = () => me()?.color || "#888";
  const [choosingColor, setChoosingColor] = createSignal(false);

  return (
    <section class="settings-section" aria-labelledby="settings-you">
      <h2 id="settings-you" class="settings-hidden">
        you
      </h2>
      <div class="settings-you" style={{ "--settings-you-color": myColor() }}>
        <div class="settings-you-face" aria-busy={busy()}>
          <button
            type="button"
            class="settings-you-picture"
            title={avatarUrl() ? "change your picture" : "add a picture"}
            aria-label={avatarUrl() ? "change your picture" : "add a picture"}
            disabled={busy()}
            onClick={() => pictureInput.click()}
          >
            <Show when={contactUrl()} fallback={<span class="settings-you-nobody">+</span>}>
              {(url) => <patchwork-view doc-url={url()} tool-id="contact-avatar" />}
            </Show>
          </button>
          <Show when={avatarUrl()}>
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
              if (file) setCropping({ file, src: URL.createObjectURL(file) });
            }}
          />
          <div class="settings-you-cursor">
            <Pointer
              color={myColor()}
              name={name() || "you"}
              aria-expanded={choosingColor()}
              aria-haspopup="true"
              title="change your colour"
              onClick={() => setChoosingColor((open) => !open)}
            />
            <Show when={choosingColor()}>
              <Colors
                value={me()?.color}
                onChange={(color) =>
                  changeMe((doc) => {
                    doc.color = color;
                  })
                }
                onClose={() => setChoosingColor(false)}
              />
            </Show>
          </div>
        </div>
        <div class="settings-you-says">
          <input
            class="settings-you-name"
            value={name()}
            placeholder="your name"
            aria-label="your name"
            aria-invalid={failed() || undefined}
            autocomplete="name"
            spellcheck={false}
            onInput={(event) => rename(event.currentTarget.value, false)}
            onChange={(event) => rename(event.currentTarget.value, true)}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
          <Show when={failed()}>
            <p class="settings-error" role="alert">
              couldn't read that picture
            </p>
          </Show>
          <AccountKey handle={props.handle} name={name} />
        </div>
      </div>

      <Show when={cropping()}>
        {(pending) => (
          <Cropper
            src={pending().src}
            onCancel={stopCropping}
            onCrop={(crop) => keepPicture(pending().file, crop)}
          />
        )}
      </Show>
    </section>
  );
}

// your cursor and its name tag, in your colour: you as other people see you
function Pointer(props: {
  color: string;
  name: string;
  title: string;
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-haspopup": "true";
}) {
  return (
    <button
      type="button"
      class="settings-pointer"
      title={props.title}
      aria-label={props.title}
      aria-expanded={props["aria-expanded"]}
      aria-haspopup={props["aria-haspopup"]}
      onClick={props.onClick}
    >
      <svg class="settings-pointer-arrow" viewBox="11 7 14 21" aria-hidden="true">
        <g fill="#fff">
          <path d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z" />
          <path d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z" />
        </g>
        <g fill={props.color}>
          <path d="m13 10.814v11.188l2.969-2.866.428-.139h4.768z" />
          <path d="m19.751 24.4155-1.844.774-3.1-7.374 1.841-.775z" />
        </g>
      </svg>
      <span class="settings-pointer-tag" style={{ "background-color": props.color }}>
        {props.name}
      </span>
    </button>
  );
}

// the palette, and any colour you like
function Colors(props: { value?: string; onChange: (color: string) => void; onClose: () => void }) {
  let popup!: HTMLDivElement;
  createEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (popup.contains(target) || target?.closest(".settings-pointer")) return;
      props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && props.onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });
  const custom = () => !!props.value && !USER_COLOR_PALETTE.some((color) => color.value === props.value);

  return (
    <div class="settings-colors" ref={popup} role="radiogroup" aria-label="your colour">
      <For each={USER_COLOR_PALETTE}>
        {(color) => (
          <button
            type="button"
            class="settings-swatch"
            role="radio"
            style={{ "background-color": color.value }}
            aria-checked={props.value === color.value}
            aria-label={color.name}
            title={color.name}
            onClick={() => {
              props.onChange(color.value);
              props.onClose();
            }}
          />
        )}
      </For>
      <label class="settings-swatch settings-swatch-custom" title="any colour" aria-checked={custom()}>
        <input
          type="color"
          aria-label="any colour"
          value={hexColor(props.value || USER_COLOR_PALETTE[0].value)}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

// this account, elsewhere: its key, to use it on another computer; someone
// else's key, to use theirs here; and leaving
function AccountKey(props: { handle: DocHandle<AccountDoc>; name: () => string }) {
  const [mode, setMode] = createSignal<"idle" | "using" | "leaving">("idle");
  const [copied, setCopied] = createSignal(false);
  const [token, setToken] = createSignal("");
  const [showing, setShowing] = createSignal(false);

  const tokenUrl = createMemo(() => accountUrlFromToken(token().trim()));
  const [other] = useDocument<AccountDoc>(tokenUrl);
  const [otherContact] = useDocument<ContactDoc>(() => other()?.contactUrl);
  const otherName = () => {
    const doc = otherContact();
    return doc?.type === "registered" ? doc.name : undefined;
  };
  const error = () => {
    if (!token().trim()) return null;
    if (!tokenUrl()) return "not an account key";
    if (tokenUrl() === props.handle.url) return "that's this account";
    return null;
  };
  const canUse = () => !error() && !!tokenUrl() && !!other()?.contactUrl;

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

  const copyButton = () => (
    <button type="button" class="settings-button" onClick={copy}>
      <CopyIcon />
      {copied() ? "copied" : "copy account key"}
    </button>
  );
  const escape = (event: KeyboardEvent) => event.key === "Escape" && setMode("idle");

  return (
    <div class="settings-account">
      <Show when={mode() === "idle"}>
        <div class="settings-cluster">
          {copyButton()}
          <button type="button" class="settings-button" onClick={() => setMode("using")}>
            use another account
          </button>
          <button type="button" class="settings-button" data-leave onClick={() => setMode("leaving")}>
            sign out
          </button>
        </div>
      </Show>
      <Show when={mode() === "using"}>
        <form
          class="settings-cluster"
          onSubmit={(event) => {
            event.preventDefault();
            if (canUse()) switchTo(tokenUrl()!);
          }}
          onKeyDown={escape}
        >
          <span class="settings-secret">
            <input
              class="settings-input"
              type={showing() ? "text" : "password"}
              placeholder="account:…"
              aria-label="account key"
              aria-invalid={!!error() || undefined}
              autocomplete="off"
              spellcheck={false}
              value={token()}
              ref={(el) => queueMicrotask(() => el.focus())}
              onInput={(event) => setToken(event.currentTarget.value)}
            />
            <button
              type="button"
              class="settings-button settings-icon-button"
              aria-label={showing() ? "hide the key" : "show the key"}
              aria-pressed={showing()}
              onClick={() => setShowing((on) => !on)}
            >
              <EyeIcon off={!showing()} />
            </button>
          </span>
          <button type="submit" class="settings-button" data-primary disabled={!canUse()}>
            {otherName() ? `switch to ${otherName()}` : "switch"}
          </button>
          <button type="button" class="settings-button" onClick={() => setMode("idle")}>
            cancel
          </button>
          <Show when={error()}>
            <p class="settings-error" role="alert">
              {error()}
            </p>
          </Show>
        </form>
      </Show>
      <Show when={mode() === "leaving"}>
        <div class="settings-cluster" onKeyDown={escape}>
          <strong class="settings-ask">sign out?</strong>
          {copyButton()}
          <button
            type="button"
            class="settings-button"
            ref={(el) => queueMicrotask(() => el.focus())}
            onClick={() => setMode("idle")}
          >
            cancel
          </button>
          <button type="button" class="settings-button" data-danger onClick={() => switchTo(null)}>
            sign out
          </button>
        </div>
      </Show>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg class="settings-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function EyeIcon(props: { off: boolean }) {
  return (
    <svg class="settings-icon" viewBox="0 0 24 24" aria-hidden="true">
      <Show
        when={props.off}
        fallback={
          <>
            <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
            <circle cx="12" cy="12" r="3" />
          </>
        }
      >
        <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
        <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
        <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
        <path d="m2 2 20 20" />
      </Show>
    </svg>
  );
}
