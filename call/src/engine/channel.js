// what a call's said over, in a room: a doc's ephemeral messages. a key's
// would be subduction's ephemeral topics, which the repo can't hand us yet
// (it routes every inbound ephemeral by the doc id inside it), so a key
// room has no channel, for now
import { isKeyRoom, pageRepo } from "./room.js";

const found = new Map(); // room id → Promise<channel | null>

/**
 * the channel for room `id`: {id, on(listener), off(listener), send(message)},
 * listeners hearing {message, senderId}. null when there isn't one
 */
export function openChannel(id) {
  if (isKeyRoom(id)) return Promise.resolve(null);
  const repo = pageRepo();
  if (!repo) return Promise.resolve(null);
  if (!found.has(id)) {
    const finding = Promise.resolve()
      .then(() => repo.find(id))
      .then((handle) => docChannel(handle, id), (error) => {
        console.warn(`[call] couldn't find ${id}`, error);
        found.delete(id);
        return null;
      });
    found.set(id, finding);
  }
  return found.get(id);
}

function docChannel(handle, id) {
  const wrapped = new Map();
  return {
    id,
    on(listener) {
      if (wrapped.has(listener)) return;
      const wrapper = (event) => listener({ message: event.message, senderId: String(event.senderId) });
      wrapped.set(listener, wrapper);
      handle.on("ephemeral-message", wrapper);
    },
    off(listener) {
      const wrapper = wrapped.get(listener);
      if (!wrapper) return;
      wrapped.delete(listener);
      handle.off("ephemeral-message", wrapper);
    },
    send(message) {
      handle.broadcast(message);
    },
  };
}
