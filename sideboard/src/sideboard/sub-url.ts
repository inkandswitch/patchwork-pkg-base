/** Whether `url` names part of a document (`automerge:<id>/<path>`), not a whole one. */
export const isSubUrl = (url: string) => url.split("#")[0].includes("/");
