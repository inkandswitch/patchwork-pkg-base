// vendored from @workadventure/noise-suppression@0.2.0 (MIT, ./LICENSE):
// dist/assets/deepfilternet-worklet-processor.js, as it is. DeepFilterNet's
// libDF, compiled to wasm, run in an AudioWorklet
(function() {
	//#region src/audio-worklet-global-scope-shim.ts
	if (!("self" in globalThis)) Object.defineProperty(globalThis, "self", {
		configurable: true,
		value: globalThis
	});
	if (!("location" in globalThis)) Object.defineProperty(globalThis, "location", {
		configurable: true,
		value: { href: "https://audio-worklet.local/audio-worklet-processor.js" }
	});
	if (!("TextDecoder" in globalThis)) {
		class AudioWorkletTextDecoder {
			encoding;
			constructor(label = "utf-8") {
				this.encoding = label.toLowerCase();
			}
			decode(input) {
				const bytes = this.toBytes(input);
				if (this.encoding === "utf-16le" || this.encoding === "utf-16") return this.decodeUtf16Le(bytes);
				return this.decodeUtf8(bytes);
			}
			toBytes(input) {
				if (input === void 0) return new Uint8Array();
				if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
				return new Uint8Array(input);
			}
			decodeUtf16Le(bytes) {
				const codeUnits = [];
				for (let i = 0; i + 1 < bytes.length; i += 2) codeUnits.push(bytes[i] | bytes[i + 1] << 8);
				return String.fromCharCode(...codeUnits);
			}
			decodeUtf8(bytes) {
				const codePoints = [];
				for (let i = 0; i < bytes.length;) {
					const first = bytes[i++];
					if (first < 128) {
						codePoints.push(first);
						continue;
					}
					if ((first & 224) === 192 && i < bytes.length) {
						codePoints.push((first & 31) << 6 | bytes[i++] & 63);
						continue;
					}
					if ((first & 240) === 224 && i + 1 < bytes.length) {
						codePoints.push((first & 15) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63);
						continue;
					}
					if ((first & 248) === 240 && i + 2 < bytes.length) {
						codePoints.push((first & 7) << 18 | (bytes[i++] & 63) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63);
						continue;
					}
					codePoints.push(65533);
				}
				return String.fromCodePoint(...codePoints);
			}
		}
		Object.defineProperty(globalThis, "TextDecoder", {
			configurable: true,
			value: AudioWorkletTextDecoder
		});
	}
	if (!("URL" in globalThis)) {
		class AudioWorkletURL {
			href;
			constructor(url, base) {
				if (base !== void 0 && url === ".") {
					const lastSlash = base.lastIndexOf("/");
					this.href = lastSlash >= 0 ? base.slice(0, lastSlash + 1) : base;
					return;
				}
				this.href = url;
			}
			toString() {
				return this.href;
			}
			static createObjectURL() {
				throw new Error("URL.createObjectURL is not available in AudioWorklet.");
			}
			static revokeObjectURL() {}
		}
		Object.defineProperty(globalThis, "URL", {
			configurable: true,
			value: AudioWorkletURL
		});
	}
	if (!("crypto" in globalThis)) Object.defineProperty(globalThis, "crypto", {
		configurable: true,
		value: { getRandomValues(array) {
			if (array) {
				const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
				for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
			}
			return array;
		} }
	});
	if (!("TextEncoder" in globalThis)) {
		class AudioWorkletTextEncoder {
			encoding = "utf-8";
			encode(input = "") {
				const bytes = [];
				for (const char of input) {
					const code = char.codePointAt(0) ?? 0;
					if (code < 128) bytes.push(code);
					else if (code < 2048) bytes.push(192 | code >> 6, 128 | code & 63);
					else if (code < 65536) bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
					else bytes.push(240 | code >> 18, 128 | code >> 12 & 63, 128 | code >> 6 & 63, 128 | code & 63);
				}
				return Uint8Array.from(bytes);
			}
		}
		Object.defineProperty(globalThis, "TextEncoder", {
			configurable: true,
			value: AudioWorkletTextEncoder
		});
	}
	//#endregion
	//#region forks/deepfilternet/df.js
	var DFState = class {
		__destroy_into_raw() {
			const ptr = this.__wbg_ptr;
			this.__wbg_ptr = 0;
			DFStateFinalization.unregister(this);
			return ptr;
		}
		free() {
			const ptr = this.__destroy_into_raw();
			wasm.__wbg_dfstate_free(ptr, 0);
		}
	};
	if (Symbol.dispose) DFState.prototype[Symbol.dispose] = DFState.prototype.free;
	/**
	* Create a DeepFilterNet Model
	*
	* Args:
	*     - path: File path to a DeepFilterNet tar.gz onnx model
	*     - atten_lim: Attenuation limit in dB.
	*
	* Returns:
	*     - DF state doing the full processing: stft, DNN noise reduction, istft.
	* @param {Uint8Array} model_bytes
	* @param {number} atten_lim
	* @returns {number}
	*/
	function df_create(model_bytes, atten_lim) {
		const ptr0 = passArray8ToWasm0(model_bytes, wasm.__wbindgen_malloc_command_export);
		const len0 = WASM_VECTOR_LEN;
		return wasm.df_create(ptr0, len0, atten_lim) >>> 0;
	}
	/**
	* Get DeepFilterNet frame size in samples.
	* @param {number} st
	* @returns {number}
	*/
	function df_get_frame_length(st) {
		return wasm.df_get_frame_length(st) >>> 0;
	}
	/**
	* Processes a chunk of samples.
	*
	* Args:
	*     - df_state: Created via df_create()
	*     - input: Input buffer of length df_get_frame_length()
	*     - output: Output buffer of length df_get_frame_length()
	*
	* Returns:
	*     - Local SNR of the current frame.
	* @param {number} st
	* @param {Float32Array} input
	* @returns {Float32Array}
	*/
	function df_process_frame(st, input) {
		const ptr0 = passArrayF32ToWasm0(input, wasm.__wbindgen_malloc_command_export);
		const len0 = WASM_VECTOR_LEN;
		return wasm.df_process_frame(st, ptr0, len0);
	}
	function __wbg_get_imports() {
		return {
			__proto__: null,
			"./df_bg.js": {
				__proto__: null,
				__wbg___wbindgen_throw_6b64449b9b9ed33c: function(arg0, arg1) {
					throw new Error(getStringFromWasm0(arg0, arg1));
				},
				__wbg_getRandomValues_cc7f052a444bb2ce: function() {
					return handleError(function(arg0, arg1) {
						globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
					}, arguments);
				},
				__wbg_new_from_slice_b6858b485924da4e: function(arg0, arg1) {
					return new Float32Array(getArrayF32FromWasm0(arg0, arg1));
				},
				__wbindgen_init_externref_table: function() {
					const table = wasm.__wbindgen_externrefs;
					const offset = table.grow(4);
					table.set(0, void 0);
					table.set(offset + 0, void 0);
					table.set(offset + 1, null);
					table.set(offset + 2, true);
					table.set(offset + 3, false);
				}
			}
		};
	}
	var DFStateFinalization = typeof FinalizationRegistry === "undefined" ? {
		register: () => {},
		unregister: () => {}
	} : new FinalizationRegistry((ptr) => wasm.__wbg_dfstate_free(ptr >>> 0, 1));
	function addToExternrefTable0(obj) {
		const idx = wasm.__externref_table_alloc_command_export();
		wasm.__wbindgen_externrefs.set(idx, obj);
		return idx;
	}
	function getArrayF32FromWasm0(ptr, len) {
		ptr = ptr >>> 0;
		return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
	}
	function getArrayU8FromWasm0(ptr, len) {
		ptr = ptr >>> 0;
		return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
	}
	var cachedFloat32ArrayMemory0 = null;
	function getFloat32ArrayMemory0() {
		if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
		return cachedFloat32ArrayMemory0;
	}
	function getStringFromWasm0(ptr, len) {
		ptr = ptr >>> 0;
		return decodeText(ptr, len);
	}
	var cachedUint8ArrayMemory0 = null;
	function getUint8ArrayMemory0() {
		if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
		return cachedUint8ArrayMemory0;
	}
	function handleError(f, args) {
		try {
			return f.apply(this, args);
		} catch (e) {
			const idx = addToExternrefTable0(e);
			wasm.__wbindgen_exn_store_command_export(idx);
		}
	}
	function passArray8ToWasm0(arg, malloc) {
		const ptr = malloc(arg.length * 1, 1) >>> 0;
		getUint8ArrayMemory0().set(arg, ptr / 1);
		WASM_VECTOR_LEN = arg.length;
		return ptr;
	}
	function passArrayF32ToWasm0(arg, malloc) {
		const ptr = malloc(arg.length * 4, 4) >>> 0;
		getFloat32ArrayMemory0().set(arg, ptr / 4);
		WASM_VECTOR_LEN = arg.length;
		return ptr;
	}
	var cachedTextDecoder = new TextDecoder("utf-8", {
		ignoreBOM: true,
		fatal: true
	});
	cachedTextDecoder.decode();
	var MAX_SAFARI_DECODE_BYTES = 2146435072;
	var numBytesDecoded = 0;
	function decodeText(ptr, len) {
		numBytesDecoded += len;
		if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
			cachedTextDecoder = new TextDecoder("utf-8", {
				ignoreBOM: true,
				fatal: true
			});
			cachedTextDecoder.decode();
			numBytesDecoded = len;
		}
		return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
	}
	var WASM_VECTOR_LEN = 0, wasm;
	function __wbg_finalize_init(instance, module) {
		wasm = instance.exports;
		cachedFloat32ArrayMemory0 = null;
		cachedUint8ArrayMemory0 = null;
		wasm.__wbindgen_start();
		return wasm;
	}
	function initSync(module) {
		if (wasm !== void 0) return wasm;
		if (module !== void 0) if (Object.getPrototypeOf(module) === Object.prototype) ({module} = module);
		else console.warn("using deprecated parameters for `initSync()`; pass a single object instead");
		const imports = __wbg_get_imports();
		if (!(module instanceof WebAssembly.Module)) module = new WebAssembly.Module(module);
		return __wbg_finalize_init(new WebAssembly.Instance(module, imports), module);
	}
	//#endregion
	//#region src/float32-ring-buffer.ts
	var Float32RingBuffer = class {
		storage;
		readIndex = 0;
		writeIndex = 0;
		availableSamples = 0;
		constructor(size) {
			this.storage = new Float32Array(size);
		}
		availableRead() {
			return this.availableSamples;
		}
		availableWrite() {
			return this.storage.length - this.availableSamples;
		}
		push(source) {
			if (source.length > this.availableWrite()) throw new Error("AudioWorklet ring buffer overflow.");
			let remaining = source.length;
			let sourceOffset = 0;
			while (remaining > 0) {
				const chunk = Math.min(remaining, this.storage.length - this.writeIndex);
				this.storage.set(source.subarray(sourceOffset, sourceOffset + chunk), this.writeIndex);
				this.writeIndex = (this.writeIndex + chunk) % this.storage.length;
				this.availableSamples += chunk;
				remaining -= chunk;
				sourceOffset += chunk;
			}
		}
		pullInto(target) {
			if (target.length > this.availableSamples) return false;
			let remaining = target.length;
			let targetOffset = 0;
			while (remaining > 0) {
				const chunk = Math.min(remaining, this.storage.length - this.readIndex);
				target.set(this.storage.subarray(this.readIndex, this.readIndex + chunk), targetOffset);
				this.readIndex = (this.readIndex + chunk) % this.storage.length;
				this.availableSamples -= chunk;
				remaining -= chunk;
				targetOffset += chunk;
			}
			return true;
		}
		clear() {
			this.readIndex = 0;
			this.writeIndex = 0;
			this.availableSamples = 0;
		}
	};
	//#endregion
	//#region src/pause-gate.ts
	var INPUT_HISTORY_FRAMES = 4;
	var DIGITAL_SILENCE_DB = -90;
	/**
	* Attenuates the pauses of an already denoised signal, frame by frame.
	*
	* The denoiser runs at a gentle limit so speech keeps no gating artefacts; this gate removes up to
	* `extraAttenuationDb` more in pauses. Speech is detected on the denoised frames, where it stands far above the
	* residual noise whatever the noise type, and which the denoiser kept (so keystrokes and other noise bursts it removes
	* do not count). Output is delayed by `lookaheadFrames`, so the gate ramps open over those
	* frames and is fully open when the first speech frame comes out.
	*/
	var PauseGate = class {
		options;
		queue = [];
		gainDb = 0;
		hangover = 0;
		speechRun = 0;
		floorDb;
		inputLevelsDb = [];
		constructor(options) {
			this.options = options;
		}
		/**
		* Takes one denoised frame and the input frame the denoiser was just given, and returns the gated frame from
		* `lookaheadFrames` earlier (silence at first).
		*/
		process(frame, input) {
			const { extraAttenuationDb, lookaheadFrames, hangoverFrames, releaseDbPerFrame, speechAboveFloorDb, maxSpeechAttenuationDb } = this.options;
			const levelDb = levelOf(frame);
			this.inputLevelsDb.push(levelOf(input));
			if (this.inputLevelsDb.length > INPUT_HISTORY_FRAMES) this.inputLevelsDb.shift();
			const keptByDenoiser = levelDb - Math.max(...this.inputLevelsDb) > -maxSpeechAttenuationDb;
			if (levelDb > DIGITAL_SILENCE_DB) {
				this.floorDb = Math.min(levelDb, (this.floorDb ?? levelDb) + .1);
				const speech = levelDb > this.floorDb + speechAboveFloorDb && keptByDenoiser;
				this.speechRun = speech ? this.speechRun + 1 : 0;
				if (this.speechRun >= (this.options.minSpeechFrames ?? 1)) this.hangover = lookaheadFrames + hangoverFrames;
			} else this.speechRun = 0;
			this.queue.push(frame.slice());
			if (this.queue.length <= lookaheadFrames) return new Float32Array(frame.length);
			const delayed = this.queue.shift();
			const fromDb = this.gainDb;
			if (this.hangover > 0) {
				this.hangover--;
				this.gainDb = Math.min(0, this.gainDb + extraAttenuationDb / Math.max(1, lookaheadFrames));
			} else this.gainDb = Math.max(-extraAttenuationDb, this.gainDb - releaseDbPerFrame);
			for (let i = 0; i < delayed.length; i++) {
				const db = fromDb + (this.gainDb - fromDb) * i / delayed.length;
				delayed[i] *= 10 ** (db / 20);
			}
			return delayed;
		}
	};
	function levelOf(frame) {
		let energy = 0;
		for (const sample of frame) energy += sample * sample;
		return 10 * Math.log10(energy / frame.length + 1e-12);
	}
	//#endregion
	//#region src/post-gain.ts
	var DEFAULT_POST_GAIN = {
		targetDb: -23,
		maxGainDb: 15,
		minGainDb: -10,
		speechThresholdDb: -45,
		adaptDbPerFrame: .05,
		ceiling: .9
	};
	/**
	* Levels the denoised voice, frame by frame, in place of the browser's automatic gain control (which runs before the
	* denoiser and raises the noise along with the voice). The gain only moves on speech frames, and a frame whose peak
	* would exceed the ceiling is scaled down for that frame alone, so nothing clips.
	*/
	var PostGain = class {
		options;
		gainDb = 0;
		constructor(options = DEFAULT_POST_GAIN) {
			this.options = options;
		}
		get currentGainDb() {
			return this.gainDb;
		}
		process(frame) {
			const { targetDb, maxGainDb, minGainDb, speechThresholdDb, adaptDbPerFrame, ceiling } = this.options;
			let energy = 0;
			let peak = 0;
			for (const sample of frame) {
				energy += sample * sample;
				peak = Math.max(peak, Math.abs(sample));
			}
			const levelDb = 10 * Math.log10(energy / frame.length + 1e-12);
			const fromDb = this.gainDb;
			if (levelDb > speechThresholdDb) {
				const wantedDb = Math.min(maxGainDb, Math.max(minGainDb, targetDb - levelDb));
				const step = Math.max(-adaptDbPerFrame, Math.min(adaptDbPerFrame, wantedDb - this.gainDb));
				this.gainDb += step;
			}
			const limit = peak > 0 ? ceiling / peak : Infinity;
			for (let i = 0; i < frame.length; i++) {
				const gain = Math.min(10 ** ((fromDb + (this.gainDb - fromDb) * i / frame.length) / 20), limit);
				frame[i] *= gain;
			}
			return frame;
		}
	};
	//#endregion
	//#region src/load-monitor.ts
	/**
	* Tells whether a real-time loop keeps up: sums the time spent per frame over windows of `windowFrames` frames, and
	* reports once when two windows in a row exceeded `maxLoad` of real time. One slow window is a hiccup (a tab switch,
	* garbage collection); two are a machine that is too slow.
	*/
	var LoadMonitor = class {
		windowFrames;
		frameDurationMs;
		maxLoad;
		framesInWindow = 0;
		busyMs = 0;
		overloadedWindows = 0;
		reported = false;
		constructor(windowFrames, frameDurationMs, maxLoad) {
			this.windowFrames = windowFrames;
			this.frameDurationMs = frameDurationMs;
			this.maxLoad = maxLoad;
		}
		/** Records one frame; returns the load of the window when this frame triggers the report, undefined otherwise. */
		record(elapsedMs) {
			this.busyMs += elapsedMs;
			this.framesInWindow++;
			if (this.framesInWindow < this.windowFrames) return;
			const load = this.busyMs / (this.windowFrames * this.frameDurationMs);
			this.framesInWindow = 0;
			this.busyMs = 0;
			this.overloadedWindows = load > this.maxLoad ? this.overloadedWindows + 1 : 0;
			if (this.overloadedWindows >= 2 && !this.reported) {
				this.reported = true;
				return load;
			}
		}
	};
	/**
	* Collects the per-window load and the slow frames of a real-time loop, and returns a single report after
	* `reportAfterWindows` windows (then nothing). Meant for telemetry: how heavy the denoiser really is on users'
	* machines, where the overload check only says when it is too heavy.
	*/
	var LoadSampler = class {
		windowFrames;
		frameDurationMs;
		reportAfterWindows;
		slowFrameMs;
		windowLoads = [];
		framesInWindow = 0;
		busyMs = 0;
		slowFrames = 0;
		frames = 0;
		reported = false;
		constructor(windowFrames, frameDurationMs, reportAfterWindows, slowFrameMs = 3) {
			this.windowFrames = windowFrames;
			this.frameDurationMs = frameDurationMs;
			this.reportAfterWindows = reportAfterWindows;
			this.slowFrameMs = slowFrameMs;
		}
		record(elapsedMs) {
			if (this.reported) return;
			this.frames++;
			if (elapsedMs >= this.slowFrameMs) this.slowFrames++;
			this.busyMs += elapsedMs;
			this.framesInWindow++;
			if (this.framesInWindow < this.windowFrames) return;
			this.windowLoads.push(this.busyMs / (this.windowFrames * this.frameDurationMs));
			this.framesInWindow = 0;
			this.busyMs = 0;
			if (this.windowLoads.length < this.reportAfterWindows) return;
			this.reported = true;
			const sorted = [...this.windowLoads].sort((a, b) => a - b);
			const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
			return {
				windows: sorted.length,
				medianLoad: at(.5),
				p95Load: at(.95),
				maxLoad: sorted[sorted.length - 1],
				slowFrames: this.slowFrames,
				frames: this.frames
			};
		}
	};
	//#endregion
	//#region src/deepfilternet-shared.ts
	var DEEPFILTERNET_AUDIO_WORKLET_PROCESSOR_NAME = "workadventure-deepfilternet";
	/** DeepFilterNet3 runs at 48 kHz only. */
	var DEEPFILTERNET_SAMPLE_RATE = 48e3;
	//#endregion
	//#region src/deepfilternet-worklet-processor.ts
	var RING_BUFFER_CAPACITY = 4096;
	var now = typeof performance !== "undefined" && typeof performance.now === "function" ? () => performance.now() : () => Date.now();
	var DeepFilterNetProcessor = class extends AudioWorkletProcessor {
		bypassUntilReady;
		state;
		frameSamples = 0;
		frame = new Float32Array(0);
		pauseGate;
		postGain;
		loadMonitor;
		loadSampler;
		inputRing = new Float32RingBuffer(RING_BUFFER_CAPACITY);
		outputRing = new Float32RingBuffer(RING_BUFFER_CAPACITY);
		constructor(options) {
			super();
			const processorOptions = options.processorOptions;
			this.bypassUntilReady = processorOptions.bypassUntilReady;
			this.port.onmessage = (event) => {
				if (event.data.type === "dispose") this.state = void 0;
			};
			try {
				if (sampleRate !== 48e3) throw new Error(`DeepFilterNet3 needs a ${DEEPFILTERNET_SAMPLE_RATE} Hz AudioContext, got ${sampleRate} Hz.`);
				initSync({ module: processorOptions.wasmModule });
				this.state = df_create(new Uint8Array(processorOptions.modelBytes), processorOptions.speechAttenuationDb);
				this.frameSamples = df_get_frame_length(this.state);
				this.frame = new Float32Array(this.frameSamples);
				if (processorOptions.pauseGate) this.pauseGate = new PauseGate(processorOptions.pauseGate);
				if (processorOptions.postGain) this.postGain = new PostGain(processorOptions.postGain);
				if (processorOptions.maxLoad > 0) this.loadMonitor = new LoadMonitor(200, this.frameSamples / sampleRate * 1e3, processorOptions.maxLoad);
				if (processorOptions.loadReportAfterMs > 0) this.loadSampler = new LoadSampler(200, this.frameSamples / sampleRate * 1e3, Math.max(1, Math.round(processorOptions.loadReportAfterMs / 2e3)));
				const ready = {
					type: "ready",
					frameSamples: this.frameSamples
				};
				this.port.postMessage(ready);
			} catch (error) {
				this.fail(error);
			}
		}
		process(inputs, outputs) {
			const input = inputs[0]?.[0];
			const output = outputs[0]?.[0];
			if (!output) return true;
			if (!input) {
				output.fill(0);
				return true;
			}
			if (this.state === void 0) {
				if (this.bypassUntilReady) output.set(input.subarray(0, output.length));
				else output.fill(0);
				return true;
			}
			try {
				this.inputRing.push(input);
				while (this.inputRing.availableRead() >= this.frameSamples) {
					this.inputRing.pullInto(this.frame);
					const startedAt = now();
					const denoised = df_process_frame(this.state, this.frame);
					const gated = this.pauseGate ? this.pauseGate.process(denoised, this.frame) : denoised;
					this.outputRing.push(this.postGain ? this.postGain.process(gated) : gated);
					const elapsedMs = now() - startedAt;
					const overloadLoad = this.loadMonitor?.record(elapsedMs);
					const loadReport = this.loadSampler?.record(elapsedMs);
					if (loadReport) {
						const message = {
							type: "load-report",
							...loadReport
						};
						this.port.postMessage(message);
					}
					if (overloadLoad !== void 0) {
						const overload = {
							type: "overload",
							load: overloadLoad
						};
						this.port.postMessage(overload);
					}
				}
				if (!this.outputRing.pullInto(output)) output.fill(0);
			} catch (error) {
				this.fail(error);
				if (this.bypassUntilReady) output.set(input.subarray(0, output.length));
				else output.fill(0);
			}
			return true;
		}
		fail(error) {
			this.state = void 0;
			const message = {
				type: "error",
				message: error instanceof Error ? error.message : String(error)
			};
			this.port.postMessage(message);
		}
	};
	registerProcessor(DEEPFILTERNET_AUDIO_WORKLET_PROCESSOR_NAME, DeepFilterNetProcessor);
	//#endregion
})();
