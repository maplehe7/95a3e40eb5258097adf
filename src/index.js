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

function getPstDateKey() {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Los_Angeles",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	const parts = formatter.formatToParts(new Date());
	let year = "0000";
	let month = "00";
	let day = "00";

	for (const part of parts) {
		if (part.type === "year") year = part.value;
		if (part.type === "month") month = part.value;
		if (part.type === "day") day = part.value;
	}

	return `${year}-${month}-${day}`;
}

function buildDailyCode() {
	const seed = `${getPstDateKey()}|ocean-gate-v1`;
	let hash = 2166136261;

	for (let i = 0; i < seed.length; i += 1) {
		hash ^= seed.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}

	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
	let state = hash >>> 0;
	let code = "";

	for (let j = 0; j < 5; j += 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		code += alphabet.charAt((state >>> 0) % alphabet.length);
	}

	return code;
}

function renderAccessPage(fullLink, code, pstDate) {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Access Link</title>
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
    .code {
      font-weight: 700;
      color: #fef08a;
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
  </style>
</head>
<body>
  <main class="card">
    <h1>Today&apos;s Working Link</h1>
    <p>PST date key: <span class="code">${pstDate}</span></p>
    <p>Daily code: <span class="code">${code}</span></p>
    <div class="linkbox"><a href="${fullLink}">${fullLink}</a></div>
  </main>
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

function ctdscHandler(_request, reply) {
	const code = buildDailyCode();
	const pstDate = getPstDateKey();
	const fullLink = `https://${publicHostname}/?=${code}`;
	return reply
		.code(200)
		.type("text/html; charset=utf-8")
		.send(renderAccessPage(fullLink, code, pstDate));
}

fastify.get("/ctdsc", ctdscHandler);
fastify.get("/ctdsc/", ctdscHandler);

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
