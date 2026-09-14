import type { DocHandle, Repo } from "@automerge/automerge-repo/slim";
import type { ContactDoc } from "../types";
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem";
import { createAvatar, getInitials, setAvatarFallback, setAvatarImage } from "./Avatar";

/**
 * A hover card for a contact: rest the pointer on their avatar and a card
 * with their picture at a readable size and their full name floats up beside
 * it. The small avatars scattered through the app (history rows, review
 * marks, comment authors) are too small to recognise anyone by; this is how
 * they get a name.
 *
 * The card lives on <body>, positioned against the viewport, so no clipping
 * ancestor — a scrolling sidebar, an avatar's own rounded overflow — can cut
 * it off. It takes no pointer events: it is a label, not a target, so it can
 * never sit between the pointer and what is under it.
 */
export function attachContactHoverCard(
  anchor: HTMLElement,
  handle: DocHandle<ContactDoc>,
  repo: Repo
): () => void {
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  let card: HTMLElement | undefined;

  const show = () => {
    hide();
    card = document.createElement("div");
    card.className = "contact-hover-card";
    card.setAttribute("role", "tooltip");
    document.body.appendChild(card);
    void fillCard(card, handle, repo);
    place(card, anchor);
  };

  const hide = () => {
    if (showTimer !== undefined) {
      clearTimeout(showTimer);
      showTimer = undefined;
    }
    card?.remove();
    card = undefined;
  };

  const onEnter = () => {
    if (showTimer !== undefined) clearTimeout(showTimer);
    showTimer = setTimeout(show, HOVER_DELAY_MS);
  };

  // Anything that moves the anchor or takes the pointer away also takes the
  // card: it was placed against a rect that may no longer be true.
  anchor.addEventListener("pointerenter", onEnter);
  anchor.addEventListener("pointerleave", hide);
  anchor.addEventListener("pointerdown", hide);
  window.addEventListener("scroll", hide, { capture: true, passive: true });
  window.addEventListener("blur", hide);

  return () => {
    hide();
    anchor.removeEventListener("pointerenter", onEnter);
    anchor.removeEventListener("pointerleave", hide);
    anchor.removeEventListener("pointerdown", hide);
    window.removeEventListener("scroll", hide, { capture: true });
    window.removeEventListener("blur", hide);
  };
}

// Long enough that sweeping the pointer across a row of avatars doesn't
// flash a card for each; short enough to feel like a response to resting.
const HOVER_DELAY_MS = 350;
const CARD_GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

async function fillCard(
  card: HTMLElement,
  handle: DocHandle<ContactDoc>,
  repo: Repo
) {
  const contact = handle.doc();
  const name = contactDisplayName(contact);

  const avatar = createAvatar("lg");
  card.appendChild(avatar);

  const text = document.createElement("div");
  text.className = "contact-hover-card-text";
  const nameEl = document.createElement("div");
  nameEl.className = "contact-hover-card-name";
  nameEl.textContent = name;
  text.appendChild(nameEl);
  if (contact?.type !== "registered") {
    const meta = document.createElement("div");
    meta.className = "contact-hover-card-meta";
    meta.textContent = "Hasn't set up an account";
    text.appendChild(meta);
  }
  card.appendChild(text);

  if (contact?.type === "registered") {
    setAvatarFallback(avatar, { initials: getInitials(name) });
  } else {
    setAvatarFallback(avatar, { iconSize: 32 });
  }

  const imageUrl = await resolveAvatarImageUrl(contact, repo);
  // The card may have been dismissed while the picture was loading.
  if (!card.isConnected) return;
  setAvatarImage(avatar, imageUrl, name);
}

export function contactDisplayName(contact: ContactDoc | undefined): string {
  return contact?.type === "registered" && contact.name
    ? contact.name
    : "Anonymous";
}

/** The url an <img> can load a contact's picture from, if they have one. */
export async function resolveAvatarImageUrl(
  contact: ContactDoc | undefined,
  repo: Repo
): Promise<string | undefined> {
  if (contact?.type !== "registered" || !contact.avatarUrl) return undefined;
  try {
    const avatarHandle = await repo.find(contact.avatarUrl);
    return automergeUrlToServiceWorkerUrl(avatarHandle.url);
  } catch {
    return undefined; // a missing picture just leaves the initials showing
  }
}

// Below the avatar, centred on it, kept inside the viewport; above it when
// there is no room below.
function place(card: HTMLElement, anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN_PX;
  const left = Math.max(
    VIEWPORT_MARGIN_PX,
    Math.min(rect.left + rect.width / 2 - width / 2, maxLeft)
  );
  const below = rect.bottom + CARD_GAP_PX;
  const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN_PX;
  const top = fitsBelow
    ? below
    : Math.max(VIEWPORT_MARGIN_PX, rect.top - CARD_GAP_PX - height);
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.dataset.side = fitsBelow ? "below" : "above";
}
