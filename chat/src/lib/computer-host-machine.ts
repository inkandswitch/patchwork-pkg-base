// The computer-host election as a state machine.
//
// Several tabs can have the same chat open; exactly one of them should answer
// as "computer". The doc holds the claim (computerInstanceId + a heartbeat the
// host rewrites). This module is the pure part: `step(state, event) -> state`
// and `effectsOf(from, to)`. No clocks, no I/O: times arrive in events, and the
// component (ChatRoot) runs the effects and reports back by sending events.
//
//   none ──mounted(host unknown)──> claiming ──claimed──> hosting
//   none ──mounted(host listed)───> pinging ──pong──> watching
//                                      └─ping-timeout──> claiming
//   none ──tick(computer arrived)──> watching (or claiming if nobody holds it)
//   watching ──stale / no host──> claiming
//   watching ──host-silent──> pinging
//   pinging|claiming|watching|hosting ──tick(no computer)──> none
//   hosting ──somebody else holds the claim──> watching
//   any ──unmount──> stopped (releasing the claim if hosting)
//
// "Stale" is judged by the watcher's own clock: it notes when it last SAW the
// host's heartbeat value change. It never compares the host's Date.now() to its
// own, so clock skew between machines can't cause claim fights.

export const STALE_AFTER = 45000

export type HostState =
	| {kind: "none"}
	// another tab hosts; we only watch its heartbeat
	| {kind: "watching"; seenBeat: number | null; seenAt: number}
	// we asked the host if it's alive; epoch identifies this ping
	| {kind: "pinging"; epoch: number}
	// writing our claim to the doc
	| {kind: "claiming"; epoch: number}
	| {kind: "hosting"}
	// unmounted; nothing runs any more
	| {kind: "stopped"}

// What the doc says right now, as the driver read it.
export type DocView = {
	hasComputer: boolean
	hostId: string | null
	heartbeat: number | null
	me: string
	now: number
}

export type HostEvent =
	// onMount: the doc as first seen. `epoch` is used if we start a ping/claim.
	| ({type: "mounted"; epoch: number} & DocView)
	// periodic check or doc change
	| ({type: "tick"; epoch: number} & DocView)
	// a pong arrived from some other tab
	| {type: "pong"; heartbeat: number | null; now: number}
	| {type: "ping-timeout"; epoch: number}
	// an @computer message went unanswered
	| {type: "host-silent"; epoch: number}
	| {type: "claimed"; epoch: number}
	| {type: "claim-failed"; epoch: number; now: number}
	// manual: /computer invite, /computer own
	| {type: "take"; epoch: number}
	// manual: /computer kick, or the doc says there's no computer any more
	| {type: "kicked"}
	| {type: "unmount"}

export type HostEffect =
	| "claim" // write our claim into the doc
	| "release" // clear our claim so another tab can take over
	| "ping" // broadcast computer-ping and start the timeout
	| "start-heartbeat" // heartbeat + staleness timer
	| "stop-heartbeat"
	| "start-listener" // answer messages
	| "stop-listener" // also cancels pending claim waits and listener timers
	| "abort-response" // abort the in-flight LLM response

export function step(state: HostState, event: HostEvent): HostState {
	if (state.kind === "stopped") return state
	switch (event.type) {
		case "unmount":
			return {kind: "stopped"}

		case "kicked":
			return state.kind === "none" ? state : {kind: "none"}

		case "take":
			// already hosting: the driver just rewrites the claim (owner, model)
			if (state.kind === "hosting") return state
			return {kind: "claiming", epoch: event.epoch}

		case "mounted": {
			if (state.kind !== "none") return state
			if (!event.hasComputer) return state
			if (event.hostId === null) return {kind: "claiming", epoch: event.epoch}
			if (event.hostId === event.me) return {kind: "hosting"}
			// Someone is listed. Ask them: we can't judge a heartbeat we've
			// never watched.
			return {kind: "pinging", epoch: event.epoch}
		}

		case "tick": {
			switch (state.kind) {
				case "none": {
					// The computer arrived after we mounted (another tab ran
					// /computer invite): start following it like any watcher.
					if (!event.hasComputer) return state
					if (event.hostId === null) return {kind: "claiming", epoch: event.epoch}
					if (event.hostId === event.me) return {kind: "hosting"}
					return {kind: "watching", seenBeat: event.heartbeat, seenAt: event.now}
				}
				case "pinging":
				case "claiming":
					// A kick lands mid-ping or mid-claim: drop it, or the ping
					// timeout would claim and switch the computer back on.
					return event.hasComputer ? state : {kind: "none"}
				case "watching": {
					if (!event.hasComputer) return {kind: "none"}
					if (event.hostId === null) return {kind: "claiming", epoch: event.epoch}
					if (event.hostId === event.me) return {kind: "hosting"}
					if (event.heartbeat !== state.seenBeat) {
						// heartbeat moved (or the host changed): alive, as of now
						return {kind: "watching", seenBeat: event.heartbeat, seenAt: event.now}
					}
					if (event.now - state.seenAt > STALE_AFTER) {
						return {kind: "claiming", epoch: event.epoch}
					}
					return state
				}
				case "hosting": {
					if (!event.hasComputer) return {kind: "none"}
					if (event.hostId === event.me) return state
					if (event.hostId === null) return {kind: "claiming", epoch: event.epoch}
					// ousted: another tab took the claim
					return {kind: "watching", seenBeat: event.heartbeat, seenAt: event.now}
				}
				default:
					return state
			}
		}

		case "pong":
			if (state.kind !== "pinging") return state
			return {kind: "watching", seenBeat: event.heartbeat, seenAt: event.now}

		case "ping-timeout":
			if (state.kind !== "pinging" || state.epoch !== event.epoch) return state
			return {kind: "claiming", epoch: event.epoch}

		case "host-silent":
			if (state.kind !== "watching") return state
			return {kind: "pinging", epoch: event.epoch}

		case "claimed":
			if (state.kind !== "claiming" || state.epoch !== event.epoch) return state
			return {kind: "hosting"}

		case "claim-failed":
			if (state.kind !== "claiming" || state.epoch !== event.epoch) return state
			return {kind: "watching", seenBeat: null, seenAt: event.now}
	}
	return state
}

// The side effects the component should run when the state moves from -> to.
export function effectsOf(from: HostState, to: HostState): HostEffect[] {
	if (from === to) return []
	const out: HostEffect[] = []
	const wasHosting = from.kind === "hosting"
	const isHosting = to.kind === "hosting"
	if (wasHosting && !isHosting) {
		out.push("abort-response", "stop-listener")
		if (to.kind === "stopped") out.push("release")
	}
	const timed = (s: HostState) => s.kind === "hosting" || s.kind === "watching"
	if (timed(from) && !timed(to)) out.push("stop-heartbeat")
	if (to.kind === "pinging" && from.kind !== "pinging") out.push("ping")
	if (to.kind === "claiming") out.push("claim")
	if (!timed(from) && timed(to)) out.push("start-heartbeat")
	if (!wasHosting && isHosting) out.push("start-listener")
	return out
}
