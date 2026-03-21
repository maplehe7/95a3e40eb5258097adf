"use strict";
/**
 * @type {HTMLFormElement}
 */
const form = document.getElementById("sj-form");
/**
 * @type {HTMLInputElement}
 */
const address = document.getElementById("sj-address");
/**
 * @type {HTMLInputElement}
 */
const searchEngine = document.getElementById("sj-search-engine");
/**
 * @type {HTMLParagraphElement}
 */
const error = document.getElementById("sj-error");
/**
 * @type {HTMLPreElement}
 */
const errorCode = document.getElementById("sj-error-code");

const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
	files: {
		wasm: "/scram/scramjet.wasm.wasm",
		all: "/scram/scramjet.all.js",
		sync: "/scram/scramjet.sync.js",
	},
});

scramjet.init();

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

function patchGoogleSitesCustomEmbeds(doc) {
	if (!doc || !doc.querySelectorAll) return 0;

	let patchedCount = 0;
	const containers = doc.querySelectorAll("div[jsname='jkaScf'][data-code]");
	for (const container of containers) {
		const code = container.getAttribute("data-code");
		if (!code) continue;

		const iframe = container.querySelector("iframe[jsname='WMhH6e']");
		if (!iframe || iframe.dataset.sjEmbedPatched === "1") continue;

		const src = iframe.getAttribute("src") || "";
		if (
			!src.includes("/atari/embeds/") ||
			!src.includes("intermediate-frame-minified.html")
		) {
			continue;
		}

		iframe.removeAttribute("src");
		iframe.srcdoc = '<base target="_blank">' + code;
		iframe.style.pointerEvents = "auto";
		iframe.style.overflow = "auto";
		iframe.dataset.sjEmbedPatched = "1";

		const spinner = container.querySelector(".EmVfjc");
		if (spinner) {
			spinner.style.display = "none";
		}
		patchedCount++;
	}

	return patchedCount;
}

function patchGoogleSitesUrlEmbeds(doc) {
	if (!doc || !doc.querySelectorAll) return 0;

	function stretchWholePageEmbed(container, iframe) {
		const win = doc.defaultView || window;
		const rect = container.getBoundingClientRect();
		const viewportHeight = win.innerHeight || 800;
		const top = Number.isFinite(rect.top) ? Math.max(0, rect.top) : 0;
		const targetHeight = Math.max(520, viewportHeight - top - 8);

		container.style.position = "relative";
		container.style.display = "block";
		container.style.width = "100%";
		container.style.height = targetHeight + "px";
		container.style.minHeight = targetHeight + "px";
		container.style.overflow = "hidden";

		iframe.style.position = "absolute";
		iframe.style.inset = "0";
		iframe.style.width = "100%";
		iframe.style.height = "100%";

		const frameRoot = container.closest(".WIdY2d");
		if (frameRoot) {
			frameRoot.style.position = "relative";
			frameRoot.style.height = targetHeight + "px";
			frameRoot.style.minHeight = targetHeight + "px";

			const ratioSpacer = frameRoot.querySelector("div[jsname='WXxXjd']");
			if (ratioSpacer) {
				ratioSpacer.style.display = "none";
				ratioSpacer.style.paddingTop = "0";
				ratioSpacer.style.height = "0";
			}

			for (const layer of frameRoot.querySelectorAll(".YMEQtf")) {
				layer.style.height = "100%";
				layer.style.minHeight = targetHeight + "px";
			}
		}
	}

	let patchedCount = 0;
	const containers = doc.querySelectorAll(
		"div[jsname='jkaScf'][data-url]:not([data-code])"
	);
	for (const container of containers) {
		const rawUrl = container.getAttribute("data-url");
		if (!rawUrl) continue;
		const label = (container.getAttribute("aria-label") || "").toLowerCase();
		const isWholePageEmbed = label.includes("whole page embed");

		let resolvedUrl;
		try {
			resolvedUrl = new URL(rawUrl, doc.baseURI || location.href).href;
		} catch {
			continue;
		}

		let iframe = container.querySelector("iframe[data-sj-url-embed='1']");
		if (!iframe && container.dataset.sjUrlEmbedPatched === "1") {
			// A previous patched iframe was removed/replaced; allow patching again.
			container.dataset.sjUrlEmbedPatched = "0";
		}

		if (container.dataset.sjUrlEmbedPatched === "1" && iframe) {
			if (iframe.getAttribute("src") !== resolvedUrl) {
				iframe.setAttribute("src", resolvedUrl);
			}
			if (isWholePageEmbed) {
				stretchWholePageEmbed(container, iframe);
			}
			continue;
		}

		if (!iframe) {
			iframe = doc.createElement("iframe");
			iframe.dataset.sjUrlEmbed = "1";
			iframe.title = container.getAttribute("aria-label") || "Embedded content";
			iframe.setAttribute(
				"allow",
				"clipboard-read; clipboard-write; fullscreen; autoplay"
			);
			iframe.setAttribute("referrerpolicy", "no-referrer");
			iframe.setAttribute("loading", "lazy");
			iframe.style.border = "0";
			iframe.style.display = "block";
			iframe.style.width = "100%";
			iframe.style.height = "100%";
			iframe.style.background = "transparent";

			// Replace Google Sites placeholder internals with a direct iframe fallback.
			container.replaceChildren(iframe);
		}

		if (iframe.getAttribute("src") !== resolvedUrl) {
			iframe.setAttribute("src", resolvedUrl);
		}

		if (isWholePageEmbed) {
			stretchWholePageEmbed(container, iframe);
		} else {
			const rect = container.getBoundingClientRect();
			if (rect.height < 80) {
				container.style.minHeight = "80vh";
				container.style.height = "80vh";
			}
		}

		container.style.width = "100%";
		container.style.display = "block";
		container.style.overflow = "hidden";
		container.dataset.sjUrlEmbedPatched = "1";
		patchedCount++;
	}

	return patchedCount;
}

function walkFrameTree(win, seenWindows) {
	if (!win || seenWindows.has(win)) return;
	seenWindows.add(win);

	let doc;
	try {
		doc = win.document;
	} catch {
		return;
	}
	if (!doc) return;

	patchGoogleSitesCustomEmbeds(doc);
	patchGoogleSitesUrlEmbeds(doc);

	const iframes = doc.querySelectorAll("iframe");
	for (const iframe of iframes) {
		try {
			if (iframe.contentWindow) {
				walkFrameTree(iframe.contentWindow, seenWindows);
			}
		} catch {
			// cross-origin frame access can fail; ignore and continue
		}
	}
}

function installGoogleSitesEmbedFallback(frameHandle) {
	const tick = () => {
		const seenWindows = new Set();
		try {
			if (frameHandle.frame.contentWindow) {
				walkFrameTree(frameHandle.frame.contentWindow, seenWindows);
			}
		} catch {
			// frame may not be fully initialized yet
		}
	};

	frameHandle.frame.addEventListener("load", tick);

	const intervalId = setInterval(() => {
		if (!document.body.contains(frameHandle.frame)) {
			clearInterval(intervalId);
			return;
		}
		tick();
	}, 900);
}

async function launchTarget(input) {
	try {
		await registerSW();
	} catch (err) {
		error.textContent = "Failed to register service worker.";
		errorCode.textContent = err.toString();
		throw err;
	}

	const url = search(input, searchEngine.value);

	let wispUrl =
		(location.protocol === "https:" ? "wss" : "ws") +
		"://" +
		location.host +
		"/wisp/";
	if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
		await connection.setTransport("/libcurl/index.mjs", [
			{ websocket: wispUrl },
		]);
	}
	const frame = scramjet.createFrame();
	frame.frame.id = "sj-frame";
	document.body.appendChild(frame.frame);
	installGoogleSitesEmbedFallback(frame);
	frame.go(url);
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	await launchTarget(address.value);
});

const params = new URLSearchParams(location.search);
const autoUrl = params.get("url") || params.get("target");
if (autoUrl) {
	address.value = autoUrl;
	launchTarget(autoUrl).catch((err) => {
		error.textContent = "Failed to open requested URL.";
		errorCode.textContent = err.toString();
	});
}
