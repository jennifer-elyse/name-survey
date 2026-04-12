const fs = require("node:fs");
const path = require("node:path");
const { getStore } = require("@netlify/blobs");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const dotenv = require("dotenv");

dotenv.config();

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGINS = String(
	process.env.ALLOWED_ORIGINS ||
		"http://127.0.0.1:1234,http://localhost:1234",
)
	.split(",")
	.map((origin) => origin.trim())
	.filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-secret";
const TRUST_PROXY =
	String(process.env.TRUST_PROXY || "false").toLowerCase() === "true";
const ADMIN_BCRYPT_ROUNDS = 12;
const NETLIFY_BLOBS_SITE_ID =
	process.env.NETLIFY_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || "";
const NETLIFY_BLOBS_TOKEN =
	process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN || "";

const DIST_DIR = path.join(__dirname, "dist");
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "survey-state.json");
const SURVEY_STATE_KEY = "survey-state";
const IS_NETLIFY =
	process.env.NETLIFY === "true" ||
	Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
const MEMORY_STATE_KEY = "__nameSurveyState";

const DEFAULT_OPTIONS = [
	"Pulse Cannon",
	"Signal Forge",
	"Event Current",
	"Sync Reactor",
	"Nexus Pulse",
];

const ADMIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_MAX_ATTEMPTS = 8;
const adminAttemptStore = new Map();
const ADMIN_PASSWORD = "U0GhUMMIeEBDSpS5nzVDBJa9qdkZCMz-";
const ADMIN_PASSWORD_HASH = bcrypt.hashSync(
	ADMIN_PASSWORD,
	ADMIN_BCRYPT_ROUNDS,
);

const app = express();

if (TRUST_PROXY) {
	app.set("trust proxy", 1);
}

app.use((req, res, next) => {
	const origin = req.headers.origin;

	if (origin && ALLOWED_ORIGINS.includes(origin)) {
		res.setHeader("Access-Control-Allow-Origin", origin);
		res.setHeader("Access-Control-Allow-Credentials", "true");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");
		res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
		res.setHeader("Vary", "Origin");
	}

	if (req.method === "OPTIONS") {
		return res.sendStatus(204);
	}

	return next();
});

app.use(express.json({ limit: "1mb" }));
app.use(
	session({
		name: "name-survey.sid",
		secret: SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		cookie: {
			secure: "auto",
			httpOnly: true,
			sameSite: "lax",
			maxAge: 1000 * 60 * 60 * 6,
		},
	}),
);

const ensureDataDir = () => {
	fs.mkdirSync(DATA_DIR, { recursive: true });
};

const nowIso = () => new Date().toISOString();

const createInitialState = () => ({
	createdAt: nowIso(),
	updatedAt: nowIso(),
	surveyEnded: false,
	options: DEFAULT_OPTIONS.map((name, index) => ({
		id: index,
		name,
		votes: 0,
		firstVoteAt: null,
	})),
	voterRecords: [],
	participantLookup: {},
});

let surveyStateStore = null;
let blobsAvailable = false;

if (IS_NETLIFY) {
	try {
		surveyStateStore = getStore(
			"survey-state",
			NETLIFY_BLOBS_SITE_ID && NETLIFY_BLOBS_TOKEN
				? {
						siteID: NETLIFY_BLOBS_SITE_ID,
						token: NETLIFY_BLOBS_TOKEN,
					}
				: undefined,
		);
		blobsAvailable = true;
	} catch {
		surveyStateStore = null;
		blobsAvailable = false;
	}
}

const loadState = async () => {
	if (surveyStateStore && blobsAvailable) {
		const existingState = await surveyStateStore.get(SURVEY_STATE_KEY, {
			type: "json",
		});

		if (existingState) {
			return existingState;
		}

		const initialState = createInitialState();
		await surveyStateStore.setJSON(SURVEY_STATE_KEY, initialState);
		return initialState;
	}

	if (IS_NETLIFY) {
		if (!globalThis[MEMORY_STATE_KEY]) {
			globalThis[MEMORY_STATE_KEY] = createInitialState();
		}

		return globalThis[MEMORY_STATE_KEY];
	}

	ensureDataDir();

	if (!fs.existsSync(STATE_FILE)) {
		const initialState = createInitialState();
		fs.writeFileSync(STATE_FILE, JSON.stringify(initialState, null, 2));
		return initialState;
	}

	try {
		return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
	} catch {
		const fallbackState = createInitialState();
		fs.writeFileSync(STATE_FILE, JSON.stringify(fallbackState, null, 2));
		return fallbackState;
	}
};

const saveState = async (state) => {
	state.updatedAt = nowIso();

	if (surveyStateStore && blobsAvailable) {
		await surveyStateStore.setJSON(SURVEY_STATE_KEY, state);
		return;
	}

	if (IS_NETLIFY) {
		globalThis[MEMORY_STATE_KEY] = state;
		return;
	}

	fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

const normalizeParticipant = (value = "") => value.trim().toLowerCase();

const getRequesterIp = (req) => {
	const forwardedFor = req.headers["x-forwarded-for"];
	if (typeof forwardedFor === "string" && forwardedFor.trim()) {
		return forwardedFor.split(",")[0].trim();
	}

	const realIp = req.headers["x-real-ip"];
	if (typeof realIp === "string" && realIp.trim()) {
		return realIp.trim();
	}

	return req.socket?.remoteAddress || "unknown";
};

const maskIp = (ip) => {
	if (!ip || ip === "unknown") return "unknown";

	if (ip.includes(":")) {
		const parts = ip.split(":").filter(Boolean);
		if (parts.length <= 2) return `${parts[0] || "::"}:****`;
		return `${parts.slice(0, 2).join(":")}:****`;
	}

	const parts = ip.split(".");
	if (parts.length === 4) {
		return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
	}

	return `${ip.slice(0, 6)}***`;
};

const sortOptions = (options) => {
	return [...options].sort((a, b) => {
		if (b.votes !== a.votes) return b.votes - a.votes;

		if (a.firstVoteAt && b.firstVoteAt) {
			return (
				new Date(a.firstVoteAt).getTime() -
				new Date(b.firstVoteAt).getTime()
			);
		}

		if (a.firstVoteAt && !b.firstVoteAt) return -1;
		if (!a.firstVoteAt && b.firstVoteAt) return 1;

		return a.id - b.id;
	});
};

const summarizeIps = (voterRecords) => {
	const ipMap = new Map();

	voterRecords.forEach((record) => {
		const existing = ipMap.get(record.ip) || {
			ip: record.ip,
			maskedIp: maskIp(record.ip),
			count: 0,
			firstSeenAt: record.votedAt,
			lastSeenAt: record.votedAt,
			participants: [],
		};

		existing.count += 1;
		existing.lastSeenAt = record.votedAt;
		existing.participants.push(record.participant);
		ipMap.set(record.ip, existing);
	});

	return [...ipMap.values()].sort((a, b) => {
		if (b.count !== a.count) return b.count - a.count;
		return (
			new Date(a.firstSeenAt).getTime() -
			new Date(b.firstSeenAt).getTime()
		);
	});
};

const buildPublicState = (state, isAdmin = false) => {
	const rankedOptions = sortOptions(state.options);
	const totalVotes = state.options.reduce(
		(sum, option) => sum + option.votes,
		0,
	);
	const participantEntries = [...state.voterRecords]
		.sort(
			(a, b) =>
				new Date(a.votedAt).getTime() - new Date(b.votedAt).getTime(),
		)
		.map((record) => ({
			name: record.participant,
			optionName: record.optionName,
			votedAt: record.votedAt,
		}));
	const ipSummary = summarizeIps(state.voterRecords).map((item) => ({
		...(isAdmin ? { ip: item.ip } : {}),
		maskedIp: item.maskedIp,
		count: item.count,
		firstSeenAt: item.firstSeenAt,
		lastSeenAt: item.lastSeenAt,
		participants: isAdmin ? item.participants : undefined,
	}));

	return {
		surveyEnded: state.surveyEnded,
		createdAt: state.createdAt,
		updatedAt: state.updatedAt,
		totalVotes,
		respondentCount: state.voterRecords.length,
		ipCount: ipSummary.length,
		participants: participantEntries,
		options: state.options,
		rankedOptions,
		respondedIps: ipSummary,
		isAdmin,
		adminPasswordConfigured: Boolean(ADMIN_PASSWORD_HASH),
	};
};

const requireAdmin = (req, res, next) => {
	if (req.session?.isAdmin) {
		return next();
	}

	return res.status(401).json({ error: "Admin authentication required." });
};

const getAttemptBucket = (scope, ip) => {
	const key = `${scope}:${ip}`;
	const now = Date.now();
	const existing = adminAttemptStore.get(key);

	if (!existing || now - existing.windowStart > ADMIN_WINDOW_MS) {
		const fresh = { count: 0, windowStart: now };
		adminAttemptStore.set(key, fresh);
		return fresh;
	}

	return existing;
};

const isRateLimited = (scope, ip) => {
	const bucket = getAttemptBucket(scope, ip);
	return bucket.count >= ADMIN_MAX_ATTEMPTS;
};

const recordFailure = (scope, ip) => {
	const bucket = getAttemptBucket(scope, ip);
	bucket.count += 1;
};

const clearFailures = (scope, ip) => {
	adminAttemptStore.delete(`${scope}:${ip}`);
};

const ensurePasswordConfigured = (res) => {
	if (ADMIN_PASSWORD_HASH) {
		return true;
	}

	res.status(500).json({
		error: "Admin password hash is not available on the server.",
	});
	return false;
};

const verifyPassword = async (password) => {
	if (!ADMIN_PASSWORD_HASH) return false;
	if (!password) return false;
	return bcrypt.compare(password, ADMIN_PASSWORD_HASH);
};

app.get("/api/survey", async (req, res) => {
	const state = await loadState();
	res.json(buildPublicState(state, Boolean(req.session?.isAdmin)));
});

app.post("/api/vote", async (req, res) => {
	const state = await loadState();

	if (state.surveyEnded) {
		return res.status(409).json({ error: "The survey has ended." });
	}

	const participant = String(req.body?.participant || "").trim();
	const optionId = Number(req.body?.optionId);

	if (!participant) {
		return res.status(400).json({ error: "Participant name is required." });
	}

	if (
		!Number.isInteger(optionId) ||
		!state.options.some((option) => option.id === optionId)
	) {
		return res.status(400).json({ error: "A valid option is required." });
	}

	const normalizedParticipant = normalizeParticipant(participant);
	const ip = getRequesterIp(req);
	const hasSubmittedThisRound =
		Boolean(req.session?.hasVoted) &&
		req.session?.voteStateCreatedAt === state.createdAt;

	if (state.participantLookup[normalizedParticipant]) {
		return res
			.status(409)
			.json({ error: "That participant name has already been used." });
	}

	if (hasSubmittedThisRound) {
		return res.status(409).json({
			error: "Only one response is allowed from the same connection.",
		});
	}

	const option = state.options.find((entry) => entry.id === optionId);
	const votedAt = nowIso();

	option.votes += 1;
	if (!option.firstVoteAt) {
		option.firstVoteAt = votedAt;
	}

	const voteRecord = {
		participant,
		participantKey: normalizedParticipant,
		optionId,
		optionName: option.name,
		ip,
		votedAt,
	};

	state.voterRecords.push(voteRecord);
	state.participantLookup[normalizedParticipant] = {
		optionId,
		ip,
		votedAt,
	};
	req.session.hasVoted = true;
	req.session.voteStateCreatedAt = state.createdAt;

	await saveState(state);
	res.json(buildPublicState(state, Boolean(req.session?.isAdmin)));
});

app.post("/api/admin/login", async (req, res) => {
	if (!ensurePasswordConfigured(res)) {
		return;
	}

	const ip = getRequesterIp(req);
	if (isRateLimited("login", ip)) {
		return res
			.status(429)
			.json({ error: "Too many admin attempts. Try again later." });
	}

	const password = String(req.body?.password || "");
	const isValid = await verifyPassword(password);

	if (!isValid) {
		recordFailure("login", ip);
		return res.status(401).json({ error: "Incorrect password." });
	}

	clearFailures("login", ip);
	req.session.isAdmin = true;
	res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
	req.session.destroy(() => {
		res.json({ ok: true });
	});
});

app.post("/api/admin/end", requireAdmin, async (req, res) => {
	const state = await loadState();

	if (!state.surveyEnded) {
		state.surveyEnded = true;
		await saveState(state);
	}

	res.json(buildPublicState(state, true));
});

app.post("/api/admin/reset", requireAdmin, async (req, res) => {
	if (!ensurePasswordConfigured(res)) {
		return;
	}

	const ip = getRequesterIp(req);
	if (isRateLimited("reset", ip)) {
		return res
			.status(429)
			.json({ error: "Too many reset attempts. Try again later." });
	}

	clearFailures("reset", ip);
	const nextState = createInitialState();
	await saveState(nextState);
	res.json(buildPublicState(nextState, true));
});

app.use(express.static(DIST_DIR));

app.get("*", (req, res, next) => {
	const indexFile = path.join(DIST_DIR, "index.html");

	if (fs.existsSync(indexFile)) {
		return res.sendFile(indexFile);
	}

	if (req.path.startsWith("/api/")) {
		return next();
	}

	return res.status(200).send(`
    <html>
      <head>
        <title>Name Survey</title>
        <style>
          body { font-family: system-ui, sans-serif; padding: 2rem; background: #111827; color: white; }
          code { background: rgba(255,255,255,0.08); padding: 0.2rem 0.4rem; border-radius: 0.3rem; }
        </style>
      </head>
      <body>
        <h1>Name survey server is running</h1>
        <p>Build the frontend with <code>yarn build</code> or use <code>yarn dev</code> for the Parcel client and API together.</p>
      </body>
    </html>
  `);
});

module.exports = { ADMIN_PASSWORD, HOST, IS_NETLIFY, PORT, app };
