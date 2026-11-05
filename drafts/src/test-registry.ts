// A stand-in for `@inkandswitch/patchwork-plugins`' registry in tests, where
// the real one can't load. Mock the module with
//   vi.mock("@inkandswitch/patchwork-plugins", () => import("./test-registry"))
// and it answers `patchwork:children` with a folder plugin shaped like the
// folder package's.
import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

type TestPlugin = {
  id: string;
  type: string;
  name: string;
  datatypes: string[];
  module: (doc: unknown) => { url: AutomergeUrl; type?: string }[];
};

const folderChildren: TestPlugin = {
  id: "folder-children",
  type: "patchwork:children",
  name: "Folder children",
  datatypes: ["folder"],
  module: (doc) =>
    ((doc as { docs?: { url: AutomergeUrl; type?: string }[] })?.docs ?? []).map(
      ({ url, type }) => ({ url, type })
    ),
};

const plugins: TestPlugin[] = [folderChildren];

export function getRegistry(type: string) {
  const all = () => plugins.filter((plugin) => plugin.type === type);
  return {
    all,
    filter: (predicate: (plugin: TestPlugin) => boolean) => all().filter(predicate),
    loadAll: async (list: TestPlugin[]) => list,
    on: () => () => {},
  };
}
