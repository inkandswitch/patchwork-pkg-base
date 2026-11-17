// who's speaking: how loud each stream's sound is, a few times a second,
// and whether that's speaking (sizes.js says when it is). one AudioContext
// for the page; a stream from a peer is heard here while its <audio> plays
// it too (chrome only lets it through to one then)
import { levelOf, speakingStep } from "./sizes.js";
import { lasting } from "./lasting.js";

const EVERY = 100;
// the page's (../lasting.js): a dev server's changes swap in a new copy of
// this, while the call it's hearing carries on. the context, and what's
// heard, by who: "me", or a peer's id (for the wiggle round a floating face)
const page = lasting("patchwork-call:hearing", () => ({ context: null, heard: new Map() }));
const heard = page.heard;

/** the analyser hearing `id` ("me" for you), or null */
export const hearing = (id) => heard.get(id) ?? null;

/**
 * hear `stream`'s sound: `onChange(speaking)` as it starts and stops. `id`
 * keeps its analyser for hearing(id). returns a way to stop
 */
export function listen(stream, onChange, id) {
  if (!stream?.getAudioTracks().length) return () => {};
  let source;
  let analyser;
  try {
    const context = (page.context ??= new AudioContext());
    if (context.state === "suspended") context.resume().catch(() => {});
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    // enough of their sound to draw round a face (wiggle.js), from a point
    // where it goes up through silence
    analyser.fftSize = 2048;
    source.connect(analyser);
    if (id != null) heard.set(id, analyser);
  } catch (error) {
    console.warn("[call] can't hear who's speaking", error);
    return () => {};
  }
  const samples = new Uint8Array(analyser.fftSize);
  let state = { speaking: false, loudSince: null, quietSince: null };
  const timer = setInterval(() => {
    // a page that's not been touched yet has its sound held back
    const context = page.context;
    if (context.state === "suspended") return void context.resume().catch(() => {});
    analyser.getByteTimeDomainData(samples);
    const was = state.speaking;
    state = speakingStep(state, levelOf(samples), Date.now());
    if (state.speaking !== was) onChange(state.speaking);
  }, EVERY);
  return () => {
    clearInterval(timer);
    if (id != null && heard.get(id) === analyser) heard.delete(id);
    try {
      source.disconnect();
    } catch {}
  };
}
