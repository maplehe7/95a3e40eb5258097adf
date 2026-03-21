import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));
const publicHostname =
	process.env.PUBLIC_HOSTNAME || "nine5a3e40eb5258097adf.onrender.com";
const decoyFaviconMap = {
	smesapp: "https://www.google.com/s2/favicons?domain=smes.myschoolapp.com&sz=64",
	smesorg: "https://www.google.com/s2/favicons?domain=www.smes.org&sz=64",
	docs: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico",
};
const accessCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const manualCodeByDateKey = new Map();
const pstTimeZone = "America/Los_Angeles";

function getZonedParts(date, timeZone) {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const parts = formatter.formatToParts(date);
	const out = {
		year: 0,
		month: 0,
		day: 0,
		hour: 0,
		minute: 0,
		second: 0,
	};

	for (const part of parts) {
		if (part.type === "year") out.year = Number(part.value);
		if (part.type === "month") out.month = Number(part.value);
		if (part.type === "day") out.day = Number(part.value);
		if (part.type === "hour") out.hour = Number(part.value);
		if (part.type === "minute") out.minute = Number(part.value);
		if (part.type === "second") out.second = Number(part.value);
	}

	return out;
}

function getPstDateKey(now = new Date()) {
	const p = getZonedParts(now, pstTimeZone);
	return `${String(p.year)}-${String(p.month).padStart(2, "0")}-${String(
		p.day
	).padStart(2, "0")}`;
}

function getTimeZoneOffsetMillis(date, timeZone) {
	const p = getZonedParts(date, timeZone);
	const asUtc = Date.UTC(
		p.year,
		p.month - 1,
		p.day,
		p.hour,
		p.minute,
		p.second
	);
	return asUtc - date.getTime();
}

function zonedDateTimeToUtc(
	year,
	month,
	day,
	hour,
	minute,
	second,
	timeZone
) {
	const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
	const offset = getTimeZoneOffsetMillis(new Date(utcGuess), timeZone);
	return new Date(utcGuess - offset);
}

function getNextPstMidnightUtc(now = new Date()) {
	const p = getZonedParts(now, pstTimeZone);
	const midnightTodayUtc = zonedDateTimeToUtc(
		p.year,
		p.month,
		p.day,
		0,
		0,
		0,
		pstTimeZone
	);
	const nextMidnightUtc = new Date(midnightTodayUtc.getTime() + 24 * 60 * 60 * 1000);
	if (nextMidnightUtc <= now) {
		return new Date(nextMidnightUtc.getTime() + 24 * 60 * 60 * 1000);
	}
	return nextMidnightUtc;
}

function getSecondsUntilNextPstMidnight(now = new Date()) {
	return Math.max(
		0,
		Math.floor((getNextPstMidnightUtc(now).getTime() - now.getTime()) / 1000)
	);
}

function buildDailyCodeForDate(dateKey) {
	const seed = `${dateKey}|ocean-gate-v1`;
	let hash = 2166136261;

	for (let i = 0; i < seed.length; i += 1) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}

	let state = hash >>> 0;
	let code = "";

	for (let j = 0; j < 5; j += 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		code += accessCodeAlphabet.charAt((state >>> 0) % accessCodeAlphabet.length);
	}

	return code;
}

function normalizeAccessCode(raw) {
	return String(raw || "")
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, 5);
}

function isValidAccessCode(code) {
	if (!code || code.length !== 5) return false;
	for (const ch of code) {
		if (!accessCodeAlphabet.includes(ch)) return false;
	}
	return true;
}

function generateRandomAccessCode() {
	let code = "";
	for (let i = 0; i < 5; i += 1) {
		const idx = Math.floor(Math.random() * accessCodeAlphabet.length);
		code += accessCodeAlphabet[idx];
	}
	return code;
}

function cleanupManualCodeMap() {
	const today = getPstDateKey();
	for (const key of manualCodeByDateKey.keys()) {
		if (key !== today) {
			manualCodeByDateKey.delete(key);
		}
	}
}

function getActiveAccessCodeInfo(now = new Date()) {
	cleanupManualCodeMap();
	const dateKey = getPstDateKey(now);
	const code = manualCodeByDateKey.get(dateKey) || buildDailyCodeForDate(dateKey);
	const secondsUntilChange = getSecondsUntilNextPstMidnight(now);
	const nextChangeIso = new Date(
		now.getTime() + secondsUntilChange * 1000
	).toISOString();
	return { dateKey, code, secondsUntilChange, nextChangeIso };
}

function setManualCodeForToday(code) {
	const dateKey = getPstDateKey();
	manualCodeByDateKey.set(dateKey, code);
}

function resolvePublicHost(request) {
	const xfHost = request.headers["x-forwarded-host"];
	if (xfHost && String(xfHost).trim()) {
		return String(xfHost).split(",")[0].trim();
	}
	if (request.headers.host && String(request.headers.host).trim()) {
		return String(request.headers.host).trim();
	}
	return publicHostname;
}

function resolvePublicProtocol(request) {
	const xfProto = request.headers["x-forwarded-proto"];
	if (xfProto && String(xfProto).trim()) {
		return String(xfProto).split(",")[0].trim();
	}
	return "https";
}

function buildAccessLink(request, code) {
	return `${resolvePublicProtocol(request)}://${resolvePublicHost(
		request
	)}/?=${encodeURIComponent(code)}`;
}

function escapeHtml(input) {
	return String(input ?? "").replace(/[&<>"']/g, (ch) =>
		({
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		})[ch]
	);
}

function renderAccessPage(initialState) {
	const initialJson = JSON.stringify(initialState).replace(/</g, "\\u003c");
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Code Control</title>
  <link rel="icon" href="data:," />
  <link rel="shortcut icon" href="data:," />
  <style>
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 20px;
    }
    .card {
      width: min(860px, 100%);
      background: #111827;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 18px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.35);
    }
    h1 {
      margin: 0 0 10px;
      font-size: 20px;
      color: #f8fafc;
    }
    p {
      margin: 0 0 10px;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .grid {
      display: grid;
      gap: 10px;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    input[type="text"] {
      background: #020617;
      border: 1px solid #334155;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      font-family: "Consolas", "Courier New", monospace;
      letter-spacing: 2px;
      text-transform: uppercase;
      width: 180px;
    }
    button {
      background: #2563eb;
      color: #fff;
      border: 0;
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      font-weight: 600;
    }
    button.secondary {
      background: #0ea5e9;
    }
    button.ghost {
      background: #334155;
    }
    .code {
      font-weight: 700;
      color: #fef08a;
      font-family: "Consolas", "Courier New", monospace;
      letter-spacing: 1px;
    }
    .linkbox {
      margin-top: 12px;
      background: #020617;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 12px;
      word-break: break-all;
      font-family: "Consolas", "Courier New", monospace;
      color: #a5f3fc;
    }
    a {
      color: #a5f3fc;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .muted {
      color: #94a3b8;
      font-size: 13px;
    }
    .status {
      min-height: 20px;
      color: #7dd3fc;
      font-size: 13px;
    }
    .status.error {
      color: #fca5a5;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Ocean Access Control</h1>
    <div class="grid">
      <p>PST date key: <span id="dateKey" class="code">${escapeHtml(
				initialState.dateKey
			)}</span></p>
      <p>Active code: <span id="currentCode" class="code">${escapeHtml(
				initialState.code
			)}</span></p>
      <p>Changes in: <span id="countdown" class="code"></span></p>
      <div class="row">
        <input id="codeInput" type="text" maxlength="5" value="${escapeHtml(
					initialState.code
				)}" />
        <button id="setBtn" type="button">Set Code</button>
        <button id="randBtn" class="secondary" type="button">Generate Random</button>
        <button id="refreshBtn" class="ghost" type="button">Refresh</button>
      </div>
      <div class="status" id="status"></div>
      <div class="linkbox"><a id="fullLink" href="${escapeHtml(
				initialState.fullLink
			)}">${escapeHtml(initialState.fullLink)}</a></div>
      <p class="muted">Use <code>?=CODE</code>, <code>?code=CODE</code>, or <code>?k=CODE</code>.</p>
    </div>
  </main>
  <script>
    (function () {
      var state = ${initialJson};
      var codeInput = document.getElementById("codeInput");
      var fullLink = document.getElementById("fullLink");
      var dateKey = document.getElementById("dateKey");
      var currentCode = document.getElementById("currentCode");
      var countdown = document.getElementById("countdown");
      var status = document.getElementById("status");
      var secondsLeft = Number(state.secondsUntilChange || 0);

      function formatCountdown(totalSeconds) {
        var sec = Math.max(0, Math.floor(totalSeconds || 0));
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return (
          String(h).padStart(2, "0") +
          ":" +
          String(m).padStart(2, "0") +
          ":" +
          String(s).padStart(2, "0")
        );
      }

      function setStatus(text, isError) {
        status.textContent = text || "";
        status.className = isError ? "status error" : "status";
      }

      function render(next) {
        if (!next) return;
        state = next;
        secondsLeft = Number(next.secondsUntilChange || 0);
        dateKey.textContent = next.dateKey || "";
        currentCode.textContent = next.code || "";
        codeInput.value = next.code || "";
        fullLink.textContent = next.fullLink || "";
        fullLink.href = next.fullLink || "#";
        countdown.textContent = formatCountdown(secondsLeft);
      }

      async function fetchState() {
        var response = await fetch("/ctdsc-code", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error("Failed to fetch code state");
        }
        return response.json();
      }

      async function updateState(payload) {
        var response = await fetch("/ctdsc-code", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload || {}),
        });
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok) {
          throw new Error(data.error || "Unable to update code");
        }
        return data;
      }

      document.getElementById("setBtn").addEventListener("click", async function () {
        try {
          setStatus("Updating...");
          var next = await updateState({ code: codeInput.value });
          render(next);
          setStatus("Code updated.");
        } catch (error) {
          setStatus(error.message || "Update failed", true);
        }
      });

      document.getElementById("randBtn").addEventListener("click", async function () {
        try {
          setStatus("Generating random code...");
          var next = await updateState({ action: "random" });
          render(next);
          setStatus("Random code generated.");
        } catch (error) {
          setStatus(error.message || "Random generation failed", true);
        }
      });

      document.getElementById("refreshBtn").addEventListener("click", async function () {
        try {
          setStatus("Refreshing...");
          var next = await fetchState();
          render(next);
          setStatus("Refreshed.");
        } catch (error) {
          setStatus(error.message || "Refresh failed", true);
        }
      });

      codeInput.addEventListener("input", function () {
        codeInput.value = String(codeInput.value || "")
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 5);
      });

      setInterval(function () {
        secondsLeft = Math.max(0, secondsLeft - 1);
        countdown.textContent = formatCountdown(secondsLeft);
      }, 1000);

      setInterval(async function () {
        try {
          var next = await fetchState();
          render(next);
        } catch (error) {
          // ignored
        }
      }, 60000);

      render(state);
    })();
  </script>
</body>
</html>`;
}

// Wisp Configuration: Refer to the documentation at https://www.npmjs.com/package/@mercuryworkshop/wisp-js

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	hostname_blacklist: [/example\.com/],
	dns_servers: ["1.1.1.3", "1.0.0.3"],
});

const fastify = Fastify({
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				if (req.url.endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
				else socket.end();
			});
	},
});

function parseCookies(headerValue) {
	const out = {};
	if (!headerValue) return out;

	const parts = String(headerValue).split(";");
	for (const part of parts) {
		const idx = part.indexOf("=");
		if (idx < 0) continue;
		const key = part.slice(0, idx).trim();
		const value = part.slice(idx + 1).trim();
		try {
			out[key] = decodeURIComponent(value);
		} catch {
			out[key] = value;
		}
	}
	return out;
}

fastify.get("/favicon.ico", (request, reply) => {
	const cookies = parseCookies(request.headers.cookie);
	const decoyKey = cookies.sj_decoy || "";
	const faviconUrl = decoyFaviconMap[decoyKey];

	if (!faviconUrl) {
		return reply.header("Cache-Control", "no-store, max-age=0").code(204).send();
	}

	return reply
		.header("Cache-Control", "no-store, max-age=0")
		.redirect(302, faviconUrl);
});

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

fastify.register(fastifyStatic, {
	root: scramjetPath,
	prefix: "/scram/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

function serializeCodePayload(request) {
	const info = getActiveAccessCodeInfo();
	return {
		...info,
		fullLink: buildAccessLink(request, info.code),
	};
}

function ctdscHandler(request, reply) {
	return reply
		.header("Cache-Control", "no-store, max-age=0")
		.code(200)
		.type("text/html; charset=utf-8")
		.send(renderAccessPage(serializeCodePayload(request)));
}

function ctdscCodeHandler(request, reply) {
	return reply
		.header("Cache-Control", "no-store, max-age=0")
		.code(200)
		.type("application/json; charset=utf-8")
		.send(serializeCodePayload(request));
}

function ctdscCodeUpdateHandler(request, reply) {
	const body =
		request.body && typeof request.body === "object" ? request.body : {};

	let code = "";
	if (body.action === "random") {
		code = generateRandomAccessCode();
	} else {
		code = normalizeAccessCode(body.code || "");
	}

	if (!isValidAccessCode(code)) {
		return reply.code(400).send({
			error: `Code must be 5 characters using ${accessCodeAlphabet}`,
		});
	}

	setManualCodeForToday(code);

	return reply
		.header("Cache-Control", "no-store, max-age=0")
		.code(200)
		.type("application/json; charset=utf-8")
		.send(serializeCodePayload(request));
}

fastify.get("/ctdsc", ctdscHandler);
fastify.get("/ctdsc/", ctdscHandler);
fastify.get("/ctdsc-code", ctdscCodeHandler);
fastify.post("/ctdsc-code", ctdscCodeUpdateHandler);

fastify.setNotFoundHandler((res, reply) => {
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();

	// by default we are listening on 0.0.0.0 (every interface)
	// we just need to list a few
	console.log("Listening on:");
	console.log(`\thttp://localhost:${address.port}`);
	console.log(`\thttp://${hostname()}:${address.port}`);
	console.log(
		`\thttp://${
			address.family === "IPv6" ? `[${address.address}]` : address.address
		}:${address.port}`
	);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("SIGTERM signal received: closing HTTP server");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "");

if (isNaN(port)) port = 8080;

fastify.listen({
	port: port,
	host: "0.0.0.0",
});
