import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import type { ContactDoc } from "../types";
import { createAvatar, setAvatarImage, setAvatarFallback, getInitials } from "./Avatar";
import {
  attachContactHoverCard,
  contactDisplayName,
  resolveAvatarImageUrl,
} from "./HoverCard";

export function renderInlineContactAvatar(
  handle: DocHandle<ContactDoc>,
  element: ToolElement
) {
  const avatar = createAvatar("sm");
  element.appendChild(avatar);
  // The hover card names the person; a native title tooltip on top of it
  // would say the same thing twice.
  const detachHoverCard = attachContactHoverCard(avatar, handle, element.repo);

  async function update() {
    const contact = handle.doc();
    if (!contact) {
      avatar.style.display = "none";
      return;
    }
    avatar.style.display = "";

    const isRegistered = contact.type === "registered";
    const name = contactDisplayName(contact);
    avatar.setAttribute("aria-label", name);

    setAvatarImage(avatar, await resolveAvatarImageUrl(contact, element.repo), name);

    // fallback
    if (isRegistered && name) {
      setAvatarFallback(avatar, { initials: getInitials(name) });
    } else {
      setAvatarFallback(avatar, { iconSize: 16 });
    }
  }

  handle.on("change", update);
  update();

  return () => {
    handle.off("change", update);
    detachHoverCard();
  };
}
