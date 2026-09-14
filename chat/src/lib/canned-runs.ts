// Scripted agent runs for demos: a user message that matches a trigger gets a
// pre-written answer — tool calls and prose — instead of a model call. The
// tool calls go through the ordinary `runToolByName` path, so the edits are
// real (and land in the agent's draft like any other), and the prose is
// streamed word by word with small delays so the turn reads like generation.
//
// The two runs below target the "Inventory purchasing SDCPN" Petrinaut net and
// are written so their edits never touch the same field: run 1 splices two
// existing arrival kernels and appends a parameter; run 2 appends a parameter
// and a transition. Both append to `parameters`, which is safe — concurrent
// list inserts are both kept by Automerge, and Petrinaut reaches parameters by
// `variableName`, not index — so the two can be made on separate drafts and
// merged in either order.

export type CannedToolCall = {id: string; name: string; args: Record<string, unknown>}

export type CannedRound = {
	text: string
	toolCalls: CannedToolCall[] | null
}

export type CannedRun = {
	// Round 0 is the plan plus the tool calls; every later round is the
	// closing summary (no calls), so the agent loop ends there.
	round(n: number, doc: unknown): CannedRound
}

/** The scripted run a user message triggers, if any. Only for Petrinaut nets. */
export function matchCannedRun(userText: string, docType: string | undefined): CannedRun | null {
	if (docType !== PETRINAUT_TYPE) return null
	const text = userText.trim()
	if (/\bminimum\s+orders?\b/i.test(text)) return MINIMUM_ORDERS
	if (/\bpartial(ly)?[\s-]*fulfil?l?(ment|ments|ed)?\b/i.test(text)) return PARTIAL_FULFILMENT
	return null
}

/** Feed `text` to `onToken` a word at a time, at a pace that reads as a model
 * streaming: a beat before the first word, then ~40 words a second with some
 * jitter, plus a pause at sentence ends. Resolves when the whole text is out
 * (or the run was aborted). */
export async function streamCanned(
	text: string,
	onToken: (fullText: string) => void,
	onStatus: (status: string) => void,
	signal?: AbortSignal,
	options: {leadInMs?: number} = {}
): Promise<void> {
	onStatus("computing…")
	await sleep(options.leadInMs ?? 900, signal)
	const words = text.split(/(\s+)/)
	let out = ""
	for (const word of words) {
		if (signal?.aborted) return
		out += word
		if (!/^\s+$/.test(word)) {
			onToken(out)
			await sleep(/[.!:]$/.test(word) ? 140 : 18 + Math.random() * 30, signal)
		}
	}
}

// ---- Run 1: minimum customer order quantity ---------------------------------

const MINIMUM_ORDERS: CannedRun = {
	round(n, doc) {
		if (n > 0) {
			return {
				text:
					"Done. There is a new policy parameter, `min_order_qty` (25 units), and both small-order arrivals — contract and spot — now lift any quantity below it to the minimum instead of the hard-coded floor of 5. Bulk orders are untouched; the supplier-side MOQs (`moq_chinese`, `moq_indian`) already existed and are unchanged.",
				toolCalls: null,
			}
		}
		const net = petriNet(doc)
		const contract = transitionIndex(net, "Receive a contract order (small)")
		const spot = transitionIndex(net, "Receive a spot order (small)")
		const swap = (index: number, id: string): CannedToolCall => ({
			id,
			name: "replace_text",
			args: {
				path: ["petriNetDefinition", "transitions", index, "transitionKernelCode"],
				find: ".map((v) => Math.max(v, 5))",
				replace: ".map((v) => Math.max(v, parameters.min_order_qty))",
			},
		})
		return {
			text:
				"The net already has supplier MOQs, so this is a customer-side minimum: a policy parameter for the smallest order the plant accepts, applied where small orders arrive. Adding the parameter and lifting both small-order kernels to it.",
			toolCalls: [
				{
					id: "canned-min-1",
					name: "automerge_op",
					args: {
						path: ["petriNetDefinition", "parameters"],
						range: [net.parameters.length, net.parameters.length],
						value: [
							{
								id: "param__min_order_qty",
								name: "Minimum customer order quantity (units; POLICY — small orders below this are lifted to it)",
								variableName: "min_order_qty",
								type: "real",
								defaultValue: "25",
							},
						],
					},
				},
				swap(contract, "canned-min-2"),
				swap(spot, "canned-min-3"),
			],
		}
	},
}

// ---- Run 2: partial fulfilment ----------------------------------------------

const PARTIAL_FULFILMENT: CannedRun = {
	round(n, doc) {
		if (n > 0) {
			return {
				text:
					"Done. A new transition, *Fulfil an order partially (ship what's on hand)*, fires when the finished-goods crate is smaller than the waiting order: it ships the whole crate as a sale and returns the remainder to the backlog with its waiting time and patience intact, so lateness penalties and spot cancellations still apply to what's left. Its rate is the new `partial_fulfil_rate` parameter (3.5 per week), FEFO-biased like the full fulfilment. The existing *Fulfil an order* transition is unchanged.",
				toolCalls: null,
			}
		}
		const net = petriNet(doc)
		const full = net.transitions.find((t) => t.name.startsWith("Fulfil an order"))
		return {
			text:
				"Today an order only ships once a crate covers it whole. Adding a sibling transition that ships a short crate and puts the remainder back in the backlog, with its own rate parameter.",
			toolCalls: [
				{
					id: "canned-partial-1",
					name: "automerge_op",
					args: {
						path: ["petriNetDefinition", "parameters"],
						range: [net.parameters.length, net.parameters.length],
						value: [
							{
								id: "param__partial_fulfil_rate",
								name: "Partial-shipment rate when on-hand stock is short of the order (per week; POLICY)",
								variableName: "partial_fulfil_rate",
								type: "real",
								defaultValue: "3.5",
							},
						],
					},
				},
				{
					id: "canned-partial-2",
					name: "automerge_op",
					args: {
						path: ["petriNetDefinition", "transitions"],
						range: [net.transitions.length, net.transitions.length],
						value: [
							{
								id: "transition__fulfil_partial",
								name: "Fulfil an order partially (ship what's on hand)",
								inputArcs: [
									{placeId: "place__backlog", weight: 1, type: "standard"},
									{placeId: "place__fg", weight: 1, type: "standard"},
								],
								outputArcs: [{placeId: "place__backlog", weight: 1}, {placeId: "place__sales", weight: 1}],
								lambdaType: "stochastic",
								lambdaCode: PARTIAL_LAMBDA,
								transitionKernelCode: PARTIAL_KERNEL,
								x: full?.x ?? 1815,
								y: (full?.y ?? -420) + 120,
							},
						],
					},
				},
			],
		}
	},
}

const PARTIAL_LAMBDA = `export default Lambda((input, parameters) => {
  const fg = input["FinishedGoods"][0];
  const o = input["Backlog"][0];
  // Only when the crate is short of the order: the whole-order case is the
  // existing "Fulfil an order" transition.
  return fg.qty > 0 && fg.qty < o.qty && fg.remaining_life > 0
    ? parameters.partial_fulfil_rate * Math.exp(parameters.fefo_strength * (1 - fg.remaining_life / 52))
    : 0.0;
});`

const PARTIAL_KERNEL = `export default TransitionKernel((input, parameters) => {
  const fg = input["FinishedGoods"][0];
  const o = input["Backlog"][0];
  // The crate ships whole; the remainder goes back to the backlog as the
  // same order, still waiting.
  return {
    "Backlog": [{ kind: o.kind, waited: o.waited, patience: o.patience, qty: o.qty - fg.qty }],
    "FulfilledOrders": [{ kind: o.kind, qty: fg.qty, lead_time: o.waited,
      tardiness: o.kind === "contract"
        ? Math.max(0, o.waited - parameters.delivery_window) : 0 }],
  };
});`

// ---- helpers ----------------------------------------------------------------

const PETRINAUT_TYPE = "petrinaut-petrinet"

type Net = {
	parameters: unknown[]
	transitions: {name: string; x?: number; y?: number}[]
}

function petriNet(doc: unknown): Net {
	const net = (doc as {petriNetDefinition?: Partial<Net>} | undefined)?.petriNetDefinition
	return {
		parameters: net?.parameters ?? [],
		transitions: net?.transitions ?? [],
	}
}

function transitionIndex(net: Net, name: string): number {
	const i = net.transitions.findIndex((t) => t.name === name)
	if (i < 0) throw new Error(`canned run: no transition named "${name}" in this net`)
	return i
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const t = setTimeout(done, ms)
		function done() {
			signal?.removeEventListener("abort", done)
			clearTimeout(t)
			resolve()
		}
		signal?.addEventListener("abort", done, {once: true})
	})
}
