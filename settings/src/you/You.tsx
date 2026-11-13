// you: your picture (ringed in your colour), your cursor as people see it
// (click it for another colour), your name, and which account this is.
// until you're someone there's none of that, just two ways in: make an
// account here, or log in with the key from another computer
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import { useDocument } from "solid-automerge";
import {
  ACCOUNT_URL_STORAGE_KEY,
  accountToken,
  colorFromString,
  hexColor,
  squarePicture,
  USER_COLOR_PALETTE,
  type AccountDoc,
  type ContactDoc,
  type Crop,
} from "./contact";
import { Cropper } from "./Cropper";
import { LogIn } from "./LogIn";

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
  const changeMe = async (
    fn: (doc: ContactDoc & Record<string, any>) => void
  ) =>
    (await myContact()).change((doc) =>
      fn(doc as ContactDoc & Record<string, any>)
    );

  // someone: you've made an account, or been given a name. until then you
  // can make one or log in to one, and that's all
  const someone = () => me()?.type === "registered";
  // (and while your contact's still coming, neither, so nothing flashes)
  const known = () => !contactUrl() || me() !== undefined;
  const [joining, setJoining] = createSignal(false);
  // you only arrive (and get the little entrance) if we saw you as nobody
  const [wasNobody, setWasNobody] = createSignal(false);
  createEffect(() => known() && !someone() && setWasNobody(true));
  let justMade = false;
  // making: you've pressed create account but not yet given a name, and can
  // still back out. a name settles it; after that it's sign out or nothing
  const [making, setMaking] = createSignal(false);
  async function makeAccount() {
    justMade = true;
    setMaking(true);
    await changeMe((doc) => {
      if (doc.type !== "registered") {
        (doc as { type: string }).type = "registered";
        doc.name = "";
      }
    });
  }
  function unmakeAccount() {
    setMaking(false);
    changeMe((doc) => {
      (doc as { type: string }).type = "anonymous";
      delete doc.name;
      delete doc.avatarUrl;
    });
  }

  const name = () => {
    const doc = me();
    return doc?.type === "registered" ? (doc.name ?? "") : "";
  };
  createEffect(() => name().trim() && setMaking(false));

  function rename(value: string, done: boolean) {
    const next = done ? value.trim() : value;
    changeMe((doc) => {
      if (next.trim() && doc.type !== "registered")
        (doc as { type: string }).type = "registered";
      if (doc.type === "registered" && (doc.name ?? "") !== next)
        doc.name = next;
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
      <Show when={known()}>
        <Show
          when={someone()}
          fallback={
            <div class="settings-cluster settings-ways-in">
              <button
                type="button"
                class="settings-button"
                data-primary
                onClick={makeAccount}
              >
                Create account
              </button>
              <button
                type="button"
                class="settings-button"
                onClick={() => setJoining(true)}
              >
                Log in
              </button>
            </div>
          }
        >
          <div
            class="settings-you"
            classList={{ "settings-arriving": wasNobody() }}
            style={{ "--settings-you-color": myColor() }}
          >
            <div class="settings-you-face" aria-busy={busy()}>
              <button
                type="button"
                class="settings-you-picture"
                title={avatarUrl() ? "Change picture" : "Add a picture"}
                aria-label={avatarUrl() ? "Change picture" : "Add a picture"}
                disabled={busy()}
                onClick={() => pictureInput.click()}
              >
                <Show
                  when={contactUrl()}
                  fallback={<span class="settings-you-nobody">+</span>}
                >
                  {(url) => (
                    <patchwork-view doc-url={url()} tool-id="contact-avatar" />
                  )}
                </Show>
              </button>
              <Show when={avatarUrl()}>
                <button
                  type="button"
                  class="settings-you-unpicture"
                  title="Remove picture"
                  aria-label="Remove picture"
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
                  if (file)
                    setCropping({ file, src: URL.createObjectURL(file) });
                }}
              />
              <div class="settings-you-cursor">
                <Pointer
                  color={myColor()}
                  name={name() || "You"}
                  aria-expanded={choosingColor()}
                  aria-haspopup="true"
                  title="Change colour"
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
                placeholder="Your name"
                aria-label="Your name"
                aria-invalid={failed() || undefined}
                autocomplete="name"
                spellcheck={false}
                ref={(el) => {
                  if (justMade) queueMicrotask(() => el.focus());
                  justMade = false;
                }}
                onInput={(event) => rename(event.currentTarget.value, false)}
                onChange={(event) => rename(event.currentTarget.value, true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape" && making()) unmakeAccount();
                }}
              />
              <Show when={failed()}>
                <p class="settings-error" role="alert">
                  Couldn't read that picture
                </p>
              </Show>
            </div>
          </div>
          <Show
            when={!making()}
            fallback={
              <div class="settings-account settings-arriving">
                <div class="settings-cluster">
                  <button
                    type="button"
                    class="settings-button"
                    onClick={unmakeAccount}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            }
          >
            <AccountKey
              handle={props.handle}
              name={name}
              arriving={wasNobody()}
            />
          </Show>
        </Show>
      </Show>

      <Show when={joining()}>
        <LogIn
          here={props.handle.url}
          repo={props.repo}
          onCancel={() => setJoining(false)}
        />
      </Show>

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
      <svg
        class="settings-pointer-arrow"
        viewBox="11 7 14 21"
        aria-hidden="true"
      >
        <g fill="#fff">
          <path d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z" />
          <path d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z" />
        </g>
        <g fill={props.color}>
          <path d="m13 10.814v11.188l2.969-2.866.428-.139h4.768z" />
          <path d="m19.751 24.4155-1.844.774-3.1-7.374 1.841-.775z" />
        </g>
      </svg>
      <span
        class="settings-pointer-tag"
        style={{ "background-color": props.color }}
      >
        {props.name}
      </span>
    </button>
  );
}

// the palette, and any colour you like
function Colors(props: {
  value?: string;
  onChange: (color: string) => void;
  onClose: () => void;
}) {
  let popup!: HTMLDivElement;
  createEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (popup.contains(target) || target?.closest(".settings-pointer"))
        return;
      props.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) =>
      event.key === "Escape" && props.onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    });
  });
  const custom = () =>
    !!props.value &&
    !USER_COLOR_PALETTE.some((color) => color.value === props.value);

  return (
    <div
      class="settings-colors"
      ref={popup}
      role="radiogroup"
      aria-label="Colour"
    >
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
      <label
        class="settings-swatch settings-swatch-custom"
        title="Any colour"
        aria-checked={custom()}
      >
        <input
          type="color"
          aria-label="Any colour"
          value={hexColor(props.value || USER_COLOR_PALETTE[0].value)}
          onInput={(event) => props.onChange(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}

// this account, elsewhere: its key, to use it on another computer; and leaving
function AccountKey(props: {
  handle: DocHandle<AccountDoc>;
  name: () => string;
  arriving: boolean;
}) {
  const [leaving, setLeaving] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  function copy() {
    navigator.clipboard.writeText(accountToken(props.handle.url, props.name()));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function signOut() {
    localStorage.removeItem(ACCOUNT_URL_STORAGE_KEY);
    window.location.replace("/");
  }

  const copyButton = () => (
    <button
      type="button"
      class="settings-button"
      data-copied={copied() || undefined}
      onClick={copy}
    >
      <Show when={copied()} fallback={<CopyIcon />}>
        <CheckIcon />
      </Show>
      {copied() ? "Copied" : "Copy account key"}
    </button>
  );
  const escape = (event: KeyboardEvent) =>
    event.key === "Escape" && setLeaving(false);

  return (
    <div
      class="settings-account"
      classList={{ "settings-arriving": props.arriving }}
    >
      <Show when={!leaving()}>
        <div class="settings-cluster">
          {copyButton()}
          <button
            type="button"
            class="settings-button"
            data-leave
            onClick={() => setLeaving(true)}
          >
            Sign out
          </button>
        </div>
      </Show>
      <Show when={leaving()}>
        <div class="settings-cluster" onKeyDown={escape}>
          <strong class="settings-ask">Sign out?</strong>
          {copyButton()}
          <button
            type="button"
            class="settings-button"
            ref={(el) => queueMicrotask(() => el.focus())}
            onClick={() => setLeaving(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            class="settings-button"
            data-danger
            onClick={signOut}
          >
            Sign out
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

function CheckIcon() {
  return (
    <svg class="settings-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
