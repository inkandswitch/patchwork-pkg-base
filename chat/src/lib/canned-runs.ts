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
//
// Disjoint from run 1 by construction: run 1 splices the two small-order
// arrival kernels (transitions "Receive a … order (small)"); this run never
// touches those. It appends to parameters/places/transitions/metrics, splices
// the fulfilment, cancellation and two metric codes, and renames one
// transition — none of which run 1 reads or writes.

const PARTIAL_FULFILMENT: CannedRun = {
	round(n, doc) {
		if (n > 0) {
			return {
				text:
					"Done. Orders can now be served in pieces.\n\n" +
					"**New:** *Fulfil an order partially* ships a finished-goods crate that covers at least `partial_min_share` of the order (25%), books the units as a sale, charges `partial_shipment_cost` (EUR 150) to a new `PartialShipmentCosts` place, and puts the remainder back in the backlog tagged `/partial`, still waiting. *Consolidate short finished-goods crates* merges two small Sonic Flow crates so the leftovers from full deliveries stop stranding units.\n\n" +
					"**Changed:** *Fulfil an order in full* gives tagged remainders `remainder_priority` (2×) so a split order is closed out first, and records the sale under the plain segment; *Cancel a spot order* keeps its patience hazard but halves it (`partial_patience_factor`) once a customer has received part of the order; *Orders fulfilled* and the lead-time sum count only the closing delivery, so a split order is still one order. Four new metrics track partial shipments, units, costs and open remainders.",
				toolCalls: null,
			}
		}
		const net = petriNet(doc)
		const fulfil = transitionIndex(net, (t) => t.name.startsWith("Fulfil an order"))
		const cancel = transitionIndex(net, (t) => t.name.startsWith("Cancel a spot order"))
		const fulfilled = metricIndex(net, "metric__fulfilled")
		const leadTime = metricIndex(net, "metric__lead_time_sum")
		const policyCost = metricIndex(net, "metric__policy_cost")
		const full = net.transitions[fulfil]
		const fgPlace = net.places.find((pl) => pl.name === "FinishedGoods")
		const kernel = (index: number) => ["petriNetDefinition", "transitions", index, "transitionKernelCode"]
		const lambda = (index: number) => ["petriNetDefinition", "transitions", index, "lambdaCode"]
		const metricCode = (index: number) => ["petriNetDefinition", "metrics", index, "code"]
		let k = 0
		const call = (name: string, args: Record<string, unknown>): CannedToolCall => ({
			id: `canned-partial-${String(++k)}`,
			name,
			args,
		})
		const splice = (path: unknown[], find: string, replace: string) => call("replace_text", {path, find, replace})
		const append = (list: string, length: number, value: unknown[]) =>
			call("automerge_op", {path: ["petriNetDefinition", list], range: [length, length], value})
		return {
			text:
				"Today an order ships only once a single crate covers it whole, so a short crate sits idle while the order waits. Partial fulfilment needs four things: a way to ship the crate and keep the rest of the order open, a tag on the remainder so the rest of the net can tell a split order from a fresh one, priority for closing split orders out, and metrics that still count one order once. Making those edits now.",
			toolCalls: [
				append("parameters", net.parameters.length, [
					param("partial_fulfil_rate", "Partial-shipment rate when a crate is short of the order (per week; POLICY)", "3.5"),
					param("partial_min_share", "Smallest share of an order a crate must cover to ship partially (fraction; POLICY)", "0.25"),
					param("partial_shipment_cost", "Extra handling and freight per partial shipment (EUR; ASSUMED)", "150"),
					param("partial_patience_factor", "Spot cancellation hazard multiplier once part of the order has been delivered (dimensionless; ASSUMED)", "0.5"),
					param("remainder_priority", "Fulfilment rate multiplier for the remainder of a split order (dimensionless; POLICY)", "2.0"),
				]),
				append("places", net.places.length, [
					{
						id: "place__partial_costs",
						name: "PartialShipmentCosts",
						colorId: "type__record",
						dynamicsEnabled: false,
						differentialEquationId: null,
						showAsInitialState: false,
						x: 2100,
						y: -240,
					},
				]),
				append("transitions", net.transitions.length, [
					{
						id: "transition__fulfil_partial",
						name: "Fulfil an order partially (ship the crate, keep the rest open)",
						inputArcs: [
							{placeId: "place__backlog", weight: 1, type: "standard"},
							{placeId: "place__fg", weight: 1, type: "standard"},
						],
						outputArcs: [
							{placeId: "place__backlog", weight: 1},
							{placeId: "place__sales", weight: 1},
							{placeId: "place__partial_costs", weight: 1},
						],
						lambdaType: "stochastic",
						lambdaCode: PARTIAL_LAMBDA,
						transitionKernelCode: PARTIAL_KERNEL,
						x: full?.x ?? 1815,
						y: (full?.y ?? -420) + 120,
					},
					{
						id: "transition__consolidate_fg",
						name: "Consolidate short finished-goods crates (Sonic Flow)",
						inputArcs: [{placeId: "place__fg", weight: 2, type: "standard"}],
						outputArcs: [{placeId: "place__fg", weight: 1}],
						lambdaType: "stochastic",
						lambdaCode: CONSOLIDATE_LAMBDA,
						transitionKernelCode: CONSOLIDATE_KERNEL,
						x: (fgPlace?.x ?? 1455) - 180,
						y: fgPlace?.y ?? -90,
					},
				]),
				// Full fulfilment: remainders first, and the sale keeps the plain
				// segment so the segment metrics don't see the tag.
				call("automerge_op", {
					path: ["petriNetDefinition", "transitions", fulfil],
					range: "name",
					value: "Fulfil an order in full (its recorded-size qty; remainders of split orders first)",
				}),
				splice(
					lambda(fulfil),
					"? parameters.fulfil_rate * Math.exp(",
					'? (input["Backlog"][0].kind.endsWith("/partial") ? parameters.remainder_priority : 1) * parameters.fulfil_rate * Math.exp('
				),
				splice(kernel(fulfil), "kind: o.kind, qty: oq", 'kind: o.kind.split("/")[0], qty: oq'),
				splice(kernel(fulfil), 'tardiness: o.kind === "contract"', 'tardiness: o.kind.startsWith("contract")'),
				// Cancellation: a customer holding part of the order is more patient.
				splice(
					lambda(cancel),
					'return input["Backlog"][0].kind === "spot" ? parameters.cancel_rate *',
					'return input["Backlog"][0].kind.startsWith("spot") ? (input["Backlog"][0].kind === "spot" ? 1 : parameters.partial_patience_factor) * parameters.cancel_rate *'
				),
				splice(kernel(cancel), '"LostSales": [{ kind: "spot", value:', '"LostSales": [{ kind: input["Backlog"][0].kind, value:'),
				// Metrics: one order is still one order.
				splice(metricCode(fulfilled), "tokens.length;", 'tokens.filter((t) => !t.kind.endsWith("/partial")).length;'),
				splice(metricCode(leadTime), "n + t.lead_time", 'n + (t.kind.endsWith("/partial") ? 0 : t.lead_time)'),
				splice(
					metricCode(policyCost),
					'.concat(state.places["SwitchFees"].tokens)',
					'.concat(state.places["SwitchFees"].tokens).concat(state.places["PartialShipmentCosts"].tokens)'
				),
				append("metrics", net.metrics.length, [
					metric("metric__partial_shipments", "Partial shipments", "Deliveries that shipped a crate short of the order and left a remainder open.", 'return state.places["FulfilledOrders"].tokens.reduce((n, t) => n + (t.kind.endsWith("/partial") ? 1 : 0), 0);'),
					metric("metric__partial_units", "Units shipped partially", "Units delivered ahead of the rest of their order.", 'return state.places["FulfilledOrders"].tokens.reduce((n, t) => n + (t.kind.endsWith("/partial") ? t.qty : 0), 0);'),
					metric("metric__partial_costs", "Partial-shipment costs (EUR)", "Extra handling and freight from splitting deliveries; included in Policy cost.", 'return state.places["PartialShipmentCosts"].tokens.reduce((n, t) => n + t.value, 0);'),
					metric("metric__split_backlog", "Split orders waiting (remainders)", "Orders partly delivered whose remainder is still in the backlog.", 'return state.places["Backlog"].tokens.reduce((n, t) => n + (t.kind.endsWith("/partial") ? 1 : 0), 0);'),
				]),
			],
		}
	},
}

const PARTIAL_LAMBDA = `export default Lambda((input, parameters) => {
  const fg = input["FinishedGoods"][0];
  const o = input["Backlog"][0];
  // Only when the crate is short of the order but worth a shipment; the
  // whole-order case is "Fulfil an order in full".
  return fg.qty > 0 && fg.qty < o.qty && fg.qty >= parameters.partial_min_share * o.qty && fg.remaining_life > 0
    ? parameters.partial_fulfil_rate * Math.exp(parameters.fefo_strength * (1 - fg.remaining_life / 52))
    : 0.0;
});`

const PARTIAL_KERNEL = `export default TransitionKernel((input, parameters) => {
  const fg = input["FinishedGoods"][0];
  const o = input["Backlog"][0];
  const segment = o.kind.split("/")[0];
  // The crate ships whole. The remainder returns to the backlog as the same
  // order, tagged "/partial" so fulfilment, cancellation and the metrics can
  // tell it from a fresh order; tardiness is settled on the closing delivery.
  return {
    "Backlog": [{ kind: segment + "/partial", waited: o.waited, patience: o.patience, qty: o.qty - fg.qty }],
    "FulfilledOrders": [{ kind: segment + "/partial", qty: fg.qty, lead_time: o.waited, tardiness: 0 }],
    "PartialShipmentCosts": [{ kind: "partial", value: parameters.partial_shipment_cost }],
  };
});`

const CONSOLIDATE_LAMBDA = `export default Lambda((input, parameters) => {
  const a = input["FinishedGoods"][0];
  const b = input["FinishedGoods"][1];
  // Two crates each smaller than half a scheduled batch: leftovers.
  const short = parameters.batch_qty_mean / 2;
  return a.qty > 0.5 && a.qty < short && b.qty > 0.5 && b.qty < short ? parameters.handling_rate : 0.0;
});`

const CONSOLIDATE_KERNEL = `export default TransitionKernel((input, parameters) => {
  const a = input["FinishedGoods"][0];
  const b = input["FinishedGoods"][1];
  return {
    "FinishedGoods": [{ material: a.material, vendor: a.vendor, qty: a.qty + b.qty, remaining_life: Math.min(a.remaining_life, b.remaining_life), holding_eur: a.holding_eur + b.holding_eur, unit_price: (a.qty * a.unit_price + b.qty * b.unit_price) / (a.qty + b.qty), dispatch_clock: 0, transit_clock: 0 }],
  };
});`

// ---- helpers ----------------------------------------------------------------

const PETRINAUT_TYPE = "petrinaut-petrinet"

type Net = {
	parameters: unknown[]
	places: {name: string; x?: number; y?: number}[]
	transitions: {name: string; x?: number; y?: number}[]
	metrics: {id?: string}[]
}

function petriNet(doc: unknown): Net {
	const net = (doc as {petriNetDefinition?: Partial<Net>} | undefined)?.petriNetDefinition
	return {
		parameters: net?.parameters ?? [],
		places: net?.places ?? [],
		transitions: net?.transitions ?? [],
		metrics: net?.metrics ?? [],
	}
}

function transitionIndex(net: Net, match: string | ((t: Net["transitions"][number]) => boolean)): number {
	const i = net.transitions.findIndex(typeof match === "string" ? (t) => t.name === match : match)
	if (i < 0) throw new Error(`canned run: no transition matching ${String(match)} in this net`)
	return i
}

function metricIndex(net: Net, id: string): number {
	const i = net.metrics.findIndex((m) => m.id === id)
	if (i < 0) throw new Error(`canned run: no metric "${id}" in this net`)
	return i
}

function param(variableName: string, name: string, defaultValue: string) {
	return {id: `param__${variableName}`, name, variableName, type: "real", defaultValue}
}

function metric(id: string, name: string, description: string, code: string) {
	return {id, name, description, code}
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
