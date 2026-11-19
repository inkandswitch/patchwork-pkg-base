// A row's pill of who's there (presence.ts): a phone and the faces of
// whoever's in a call there, then the faces of whoever's looking at it.
// `mine`: your own call's here (a phone even with nobody else in it).
// `inside`: a closed folder, so everyone anywhere in it. the faces scroll
// along if there are more than fit
import { createMemo, For, Show } from "solid-js";
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem";
import { PhoneIcon } from "../icons.tsx";
import { peopleAt, type Who } from "./presence.ts";

const initial = (name: string) => (name[0] ?? "?").toUpperCase();
const picture = (avatar: string) => {
  try {
    return avatar ? automergeUrlToServiceWorkerUrl(avatar as never) : null;
  } catch {
    return null;
  }
};

// "ana", "ana and mimi", "ana, mimi and agnes"
const names = (list: Who[]) => {
  const all = list.map((who) => who.name);
  return all.length < 2 ? all.join("") : `${all.slice(0, -1).join(", ")} and ${all.at(-1)}`;
};

function Face(props: { who: Who; calling: boolean }) {
  const src = () => picture(props.who.avatar);
  return (
    <span
      class="document-list-presence__face"
      data-calling={props.calling ? "" : undefined}
      style={{
        "--face": props.who.colour || null,
        "background-image": src() ? `url("${src()}")` : null,
      }}
    >
      {src() ? "" : initial(props.who.name)}
    </span>
  );
}

export function Presence(props: { url: string; inside: boolean; mine: boolean }) {
  const people = createMemo(() => peopleAt(props.url, { inside: props.inside }));
  const calling = () => props.mine || people().calling.length > 0;
  const title = () => {
    const { calling: on, looking } = people();
    const said = [];
    if (props.mine) said.push("you're in a call here");
    if (on.length) said.push(`${names(on)} ${on.length > 1 ? "are" : "is"} in a call${props.inside ? " in here" : " here"}`);
    if (looking.length) said.push(`${names(looking)} ${looking.length > 1 ? "are" : "is"} looking${props.inside ? " in here" : ""}`);
    return said.join(" · ");
  };
  return (
    <Show when={calling() || people().looking.length > 0}>
      <span
        class="document-list-presence"
        data-calling={calling() ? "" : undefined}
        data-mine={props.mine ? "" : undefined}
        title={title()}
      >
        <Show when={calling()}>
          <span class="document-list-presence__phone">
            <PhoneIcon />
          </span>
        </Show>
        <Show when={people().calling.length + people().looking.length > 0}>
          <span class="document-list-presence__faces">
            <For each={people().calling}>{(who) => <Face who={who} calling />}</For>
            <For each={people().looking}>{(who) => <Face who={who} calling={false} />}</For>
          </span>
        </Show>
      </span>
    </Show>
  );
}
