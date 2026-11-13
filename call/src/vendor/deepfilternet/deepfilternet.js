// vendored from @workadventure/noise-suppression@0.2.0 (MIT, ./LICENSE):
// dist/deepfilternet.js, as it is, but for the processor's url, which is
// the one beside this. its wasm and model aren't vendored: they're big,
// so ../../call/noise.js downloads them the first time they're wanted
// (and checks and keeps them), and hands their urls in
//#region \0virtual:deepfilternet-audio-worklet-module-url
var e = new URL("./deepfilternet-worklet-processor.js", import.meta.url).href, t = new URL("assets/deepfilternet/df_bg.wasm", import.meta.url).href, n = new URL("assets/deepfilternet/DeepFilterNet3_onnx.tar.gz", import.meta.url).href, r = "workadventure-deepfilternet", i = 48e3, a = {
	targetDb: -23,
	maxGainDb: 15,
	minGainDb: -10,
	speechThresholdDb: -45,
	adaptDbPerFrame: .05,
	ceiling: .9
}, o = 25, s = 45, c = 3e4, l = .7, u = 6e4, d = /* @__PURE__ */ new WeakMap(), f = /* @__PURE__ */ new Map(), p = /* @__PURE__ */ new Map();
function m(e, t, n) {
	let r = e.get(t);
	return r || (r = n().catch((n) => {
		throw e.delete(t), n;
	}), e.set(t, r)), r;
}
async function h(e) {
	let t = await fetch(e);
	if (!t.ok) throw Error(`Failed to load ${e}: ${t.status} ${t.statusText}`);
	return t.arrayBuffer();
}
async function g(e) {
	let t = new Uint8Array(e, 0, 2);
	if (t[0] === 31 && t[1] === 139) return e;
	let n = new Blob([e]).stream().pipeThrough(new CompressionStream("gzip"));
	return new Response(n).arrayBuffer();
}
function _(e, t) {
	let n = d.get(e);
	n || (n = /* @__PURE__ */ new Map(), d.set(e, n));
	let r = n.get(t);
	return r || (r = e.audioWorklet.addModule(t), n.set(t, r)), r;
}
function v(e, t) {
	return new Promise((n, r) => {
		let i = globalThis.setTimeout(() => {
			s(), r(/* @__PURE__ */ Error("Timed out waiting for the DeepFilterNet3 worklet to initialize."));
		}, t), a = (e) => {
			e.data.type === "ready" ? (s(), n(e.data)) : e.data.type === "error" && (s(), r(Error(e.data.message)));
		}, o = () => {
			s(), r(/* @__PURE__ */ Error("The DeepFilterNet3 AudioWorklet processor failed."));
		}, s = () => {
			globalThis.clearTimeout(i), e.port.removeEventListener("message", a), e.removeEventListener("processorerror", o);
		};
		e.port.addEventListener("message", a), e.port.start(), e.addEventListener("processorerror", o);
	});
}
async function y(d, y = {}) {
	if (d.sampleRate !== 48e3) throw Error(`DeepFilterNet3 needs a ${i} Hz AudioContext, got ${d.sampleRate} Hz.`);
	let b = y.moduleUrl ?? e, x = y.wasmUrl ?? t, S = y.modelUrl ?? n, C = y.speechAttenuationDb ?? o, w = y.pauseAttenuationDb ?? s, [, T, E] = await Promise.all([
		_(d, b),
		m(f, x, async () => WebAssembly.compile(await h(x))),
		m(p, S, async () => g(await h(S)))
	]), D = {
		wasmModule: T,
		modelBytes: E,
		speechAttenuationDb: C,
		pauseGate: w > C ? {
			extraAttenuationDb: w - C,
			lookaheadFrames: y.pauseGateLookaheadFrames ?? 3,
			hangoverFrames: 10,
			releaseDbPerFrame: .6,
			speechAboveFloorDb: 10,
			maxSpeechAttenuationDb: Math.min(15, C - 5)
		} : void 0,
		bypassUntilReady: y.bypassUntilReady ?? !0,
		postGain: y.postGain ? {
			...a,
			...y.postGain === !0 ? {} : y.postGain
		} : void 0,
		maxLoad: y.maxLoad ?? l,
		loadReportAfterMs: y.onLoadReport ? y.loadReportAfterMs ?? u : 0
	};
	D.pauseGate && y.minSpeechFrames !== void 0 && (D.pauseGate.minSpeechFrames = y.minSpeechFrames);
	let O = new AudioWorkletNode(d, r, {
		channelCount: 1,
		channelCountMode: "explicit",
		numberOfInputs: 1,
		numberOfOutputs: 1,
		outputChannelCount: [1],
		processorOptions: D
	}), { onOverload: k, onLoadReport: A } = y;
	return (k || A) && O.port.addEventListener("message", (e) => {
		if (e.data.type === "overload") k?.(e.data.load);
		else if (e.data.type === "load-report") {
			let { type: t, ...n } = e.data;
			A?.(n);
		}
	}), {
		node: O,
		ready: v(O, y.readyTimeoutMs ?? c),
		dispose() {
			O.port.postMessage({ type: "dispose" }), O.disconnect();
		}
	};
}
//#endregion
export { i as DEEPFILTERNET_SAMPLE_RATE, a as DEFAULT_POST_GAIN, y as createDeepFilterNetAudioWorklet };

