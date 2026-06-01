import { type AutomergeUrl, type DocHandle } from "@automerge/automerge-repo";
import {
  provide,
  request,
  type RequestEvent,
} from "@inkandswitch/patchwork-providers";

const CONTACT_SELECTOR = "patchwork:contact";

/**
 * Minimal slice of the account doc this provider reads. The frame's full
 * `AccountDoc` carries many more fields; we deliberately read only
 * `contactUrl` so we don't have to keep this type in sync.
 */
type AccountDocLike = {
  contactUrl?: AutomergeUrl;
};

type ContactDoc = {};

export const ContactProvider = (
  handle: DocHandle<ContactDoc>,
  element: HTMLElement
) => {
  const onRequest = (event: RequestEvent) => {
    if (event.detail.type === "patchwork:contact") {
      provide<DocHandle<ContactDoc>>(event, handle);
    }
  };

  element.addEventListener("patchwork:request", onRequest);

  return () => {
    element.removeEventListener("patchwork:request", onRequest);
  };
};

const element: any = true;

const contactHandle = await request<DocHandle<ContactDoc>>(
  element,
  "patchwork:contact"
);

console.log(contactHandle);

/**
 * Account provider component. Answers per-subdoc requests on the booted
 * site's account document so descendant tools don't have to reach for
 * `window.accountDocHandle` directly.
 *
 * Currently answers:
 *
 * - `patchwork:contact` → resolves to a `DocHandle` for the current
 *   user's contact doc (`accountDoc.contactUrl`). If `contactUrl` hasn't
 *   been populated yet (the frame creates it lazily on first mount), the
 *   response is held until the field appears on the account doc.
 *
 * Both the account doc and the contact doc are resolved through the
 * ambient `patchwork:dochandle` provider, so this component never needs a
 * `Repo` of its own.
 *
 * Other account subdocs (`rootFolderUrl`, `moduleSettingsUrl`) are
 * intentionally not exposed — they should be passed explicitly to tools
 * that need them.
 */
export const AccountProvider2 = (element: HTMLElement) => {
  const onRequest = (event: RequestEvent) => {
    if (event.detail.type !== CONTACT_SELECTOR) return;
    provide<DocHandle<unknown>>(event, resolveContactHandle(element));
  };

  element.addEventListener("patchwork:request", onRequest);

  return () => {
    element.removeEventListener("patchwork:request", onRequest);
  };
};

/**
 * Resolve the current contact `DocHandle` by following
 * `accountDoc.contactUrl`. Both hops go through `patchwork:dochandle`:
 * first to load the account doc (its url is the enclosing view's
 * `doc-url`), then to load the contact doc once `contactUrl` is populated.
 */
async function resolveContactHandle(
  element: HTMLElement
): Promise<DocHandle<unknown> | null> {
  const view = element.closest<HTMLElement>("patchwork-view") ?? element;
  const accountDocUrl = view.getAttribute("doc-url") as AutomergeUrl | null;
  if (!accountDocUrl) {
    console.warn(
      "[providers/account] no doc-url on enclosing view; cannot resolve contact doc"
    );
    return null;
  }

  const accountDocHandle = await request<DocHandle<AccountDocLike>>(
    element,
    "patchwork:dochandle",
    { url: accountDocUrl }
  );
  if (!accountDocHandle) {
    console.warn(
      "[providers/account] patchwork:dochandle unanswered; cannot resolve contact doc"
    );
    return null;
  }

  const contactUrl = await waitForContactUrl(accountDocHandle);
  return request<DocHandle<unknown>>(element, "patchwork:dochandle", {
    url: contactUrl,
  });
}

/**
 * Read `contactUrl` off the account doc, waiting for it to appear if it
 * isn't there yet. Each request gets its own change listener that is
 * removed as soon as the field shows up.
 */
function waitForContactUrl(
  accountDocHandle: DocHandle<AccountDocLike>
): AutomergeUrl | Promise<AutomergeUrl> {
  const immediate = accountDocHandle.doc()?.contactUrl;
  if (immediate) return immediate;

  return new Promise<AutomergeUrl>((resolve) => {
    const check = () => {
      const url = accountDocHandle.doc()?.contactUrl;
      if (!url) return;
      accountDocHandle.off("change", check);
      resolve(url);
    };
    accountDocHandle.on("change", check);
  });
}
