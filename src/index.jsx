import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";

const API_BASE =
	window.location.port === "1234"
		? `${window.location.protocol}//${window.location.hostname}:8787`
		: "";
const PUBLIC_SUPABASE_URL = process.env.PARCEL_PUBLIC_SUPABASE_URL || "";
const PUBLIC_SUPABASE_ANON_KEY =
	process.env.PARCEL_PUBLIC_SUPABASE_ANON_KEY || "";
const SURVEY_REALTIME_TOPIC =
	process.env.PARCEL_PUBLIC_SUPABASE_REALTIME_TOPIC || "survey-state";
const supabaseRealtimeClient =
	PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_ANON_KEY
		? createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
				auth: {
					autoRefreshToken: false,
					persistSession: false,
					detectSessionInUrl: false,
				},
			})
		: null;

const api = async (path, options = {}) => {
	const headers = {
		...(options.body ? { "Content-Type": "application/json" } : {}),
		...(options.headers || {}),
	};

	const response = await fetch(`${API_BASE}${path}`, {
		credentials: "include",
		headers,
		...options,
	});

	const data = await response.json().catch(() => ({}));

	if (!response.ok) {
		throw new Error(data.error || "Request failed.");
	}

	return data;
};

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const GHOSTS = [
	{ key: "c", name: "Cyan" },
	{ key: "m", name: "Magenta" },
	{ key: "y", name: "Yellow" },
	{ key: "k", name: "Black" },
];

const ghostClassForIndex = (index) => GHOSTS[index % GHOSTS.length]?.key || "k";
const hasAdminQuery = () => /(?:\?|&)admin(?:[=&]|$)/.test(window.location.href);
const isAdminPath = () => window.location.pathname.replace(/\/+$/, "") === "/admin";
const isAdminEntryPoint = () => isAdminPath() || hasAdminQuery();

const defaultAnimation = () => ({
	started: false,
	activeGhostIndex: null,
	consumedIds: [],
	pelletsEaten: 0,
	pacmanBig: false,
	pacmanSweep: false,
	ghostsGone: false,
});

const SURVEY_REFRESH_MS = 10000;
const FINALE_GHOST_STEP_MS = 700;
const FINALE_GHOST_CONSUME_MS = 180;
const FINALE_PACMAN_GROW_MS = 320;
const PELLET_SWEEP_MS = 1300;
const DUPLICATE_NAME_ERROR = "That participant name has already been used.";

const App = () => {
	const [survey, setSurvey] = useState(null);
	const [participant, setParticipant] = useState("");
	const [selectedOption, setSelectedOption] = useState(null);
	const [password, setPassword] = useState("");
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [loadingVote, setLoadingVote] = useState(false);
	const [loadingAdmin, setLoadingAdmin] = useState(false);
	const [animation, setAnimation] = useState(defaultAnimation);
	const [animationRunKey, setAnimationRunKey] = useState(0);
	const [resultsRevealed, setResultsRevealed] = useState(false);
	const previousFinaleKeyRef = useRef("");
	const loadedFinaleKeyRef = useRef("");
	const adminSectionRef = useRef(null);
	const adminPasswordInputRef = useRef(null);
	const adminQueryHandledRef = useRef(false);
	const isAdminEntry = isAdminEntryPoint();

	const loadSurvey = async ({ silent = false } = {}) => {
		try {
			const nextSurvey = await api("/api/survey");
			const nextIsAdminEntry = isAdminEntryPoint();
			const nextFinaleAudience = nextSurvey.isAdmin ? "admin" : "public";
			const nextFinaleKey = `${nextSurvey.createdAt}:${nextFinaleAudience}`;

			if (
				nextSurvey.surveyEnded &&
				!nextIsAdminEntry &&
				loadedFinaleKeyRef.current !== nextFinaleKey
			) {
				previousFinaleKeyRef.current = "";
				loadedFinaleKeyRef.current = nextFinaleKey;
			}

			if (!nextSurvey.surveyEnded || nextIsAdminEntry) {
				loadedFinaleKeyRef.current = "";
			}

			setSurvey(nextSurvey);

			if (!silent) {
				setError("");
			}
		} catch (requestError) {
			setError(requestError.message);
		}
	};

	useEffect(() => {
		if (hasAdminQuery() && !isAdminPath()) {
			window.history.replaceState({}, "", "/admin");
		}
	}, []);

	useEffect(() => {
		loadSurvey();
		const timer = window.setInterval(() => {
			loadSurvey({ silent: true });
		}, SURVEY_REFRESH_MS);

		if (!supabaseRealtimeClient) {
			return () => window.clearInterval(timer);
		}

		let fallbackTimer = null;
		const channel = supabaseRealtimeClient
			.channel(SURVEY_REALTIME_TOPIC)
			.on("broadcast", { event: "state-changed" }, () => {
				loadSurvey({ silent: true });
			})
			.subscribe((status) => {
				if (
					status === "CHANNEL_ERROR" ||
					status === "TIMED_OUT" ||
					status === "CLOSED"
				) {
					if (fallbackTimer) return;

					fallbackTimer = window.setInterval(() => {
						loadSurvey({ silent: true });
					}, SURVEY_REFRESH_MS);
				}

				if (status === "SUBSCRIBED" && fallbackTimer) {
					window.clearInterval(fallbackTimer);
					fallbackTimer = null;
				}
			});

		return () => {
			window.clearInterval(timer);
			if (fallbackTimer) {
				window.clearInterval(fallbackTimer);
			}
			supabaseRealtimeClient.removeChannel(channel);
		};
	}, []);

	useEffect(() => {
		if (!survey || selectedOption === null) return;

		const selectedStillExists = survey.options.some(
			(option) => option.id === selectedOption,
		);

		if (!selectedStillExists) {
			setSelectedOption(null);
		}
	}, [survey, selectedOption]);

	useEffect(() => {
		if (!survey || adminQueryHandledRef.current) return;

		if (!isAdminEntryPoint()) return;

		adminQueryHandledRef.current = true;

		window.requestAnimationFrame(() => {
			adminSectionRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});

			if (!survey.isAdmin) {
				adminPasswordInputRef.current?.focus();
			}
		});
	}, [survey]);

	const ranked = useMemo(() => survey?.rankedOptions || [], [survey]);
	const finaleOrder = useMemo(() => ranked.slice(1).reverse(), [ranked]);
	const pelletCount = useMemo(
		() => Math.max(4, Math.min(12, finaleOrder.length * 2)),
		[finaleOrder.length],
	);
	const leader = ranked[0];
	const maxVotes = Math.max(
		...(survey?.options || []).map((option) => option.votes),
		1,
	);
	const showPublicFinale = survey?.surveyEnded && !isAdminEntry;
	const finaleAudience = survey?.isAdmin ? "admin" : "public";
	const finaleKey = survey ? `${survey.createdAt}:${finaleAudience}` : "";

	useEffect(() => {
		if (!survey) return;

		if (isAdminEntry) {
			previousFinaleKeyRef.current = "";
			setAnimation(defaultAnimation());
			setAnimationRunKey(0);
			setResultsRevealed(false);
			return;
		}

		if (!survey.surveyEnded) {
			previousFinaleKeyRef.current = "";
			setAnimation(defaultAnimation());
			setAnimationRunKey(0);
			setResultsRevealed(false);
			return;
		}

		if (previousFinaleKeyRef.current === finaleKey) return;

		previousFinaleKeyRef.current = finaleKey;
		let cancelled = false;
		const runAnimation = async ({ replay = false } = {}) => {
			setAnimationRunKey((current) => current + 1);
			setAnimation(defaultAnimation());

			if (cancelled) return;

			setAnimation((current) => ({
				...current,
				started: true,
			}));

			for (let index = 0; index < finaleOrder.length; index += 1) {
				if (cancelled) return;

				setAnimation((current) => ({
					...current,
					activeGhostIndex: index,
				}));
				await wait(FINALE_GHOST_STEP_MS);
				if (cancelled) return;

				setAnimation((current) => ({
					...current,
					consumedIds: [
						...current.consumedIds,
						finaleOrder[index].id,
					],
				}));
				await wait(FINALE_GHOST_CONSUME_MS);
			}

			if (cancelled) return;

			setAnimation((current) => ({
				...current,
				activeGhostIndex: null,
				pacmanBig: true,
			}));

			await wait(FINALE_PACMAN_GROW_MS);
			if (cancelled) return;

			setAnimation((current) => ({
				...current,
				pacmanSweep: true,
			}));

			const pelletDelay = Math.floor(PELLET_SWEEP_MS / pelletCount);
			for (let index = 0; index < pelletCount; index += 1) {
				if (cancelled) return;

				await wait(pelletDelay);
				if (cancelled) return;

				setAnimation((current) => ({
					...current,
					pelletsEaten: Math.min(current.pelletsEaten + 1, pelletCount),
				}));
			}

			if (cancelled) return;

			setAnimation((current) => ({
				...current,
				ghostsGone: true,
			}));
			setResultsRevealed(true);

			runAnimation({ replay: true });
		};

		runAnimation();

		return () => {
			cancelled = true;
		};
	}, [
		survey?.surveyEnded,
		finaleKey,
		finaleOrder,
		pelletCount,
		isAdminEntry,
	]);

	const submitVote = async (event) => {
		event.preventDefault();

		if (!participant.trim()) {
			setError("Participant name is required.");
			return;
		}

		if (selectedOption === null) {
			setError("Please select an option before submitting.");
			return;
		}

		setLoadingVote(true);
		setError("");
		setMessage("");

		try {
			const nextSurvey = await api("/api/vote", {
				method: "POST",
				body: JSON.stringify({
					participant: participant.trim(),
					optionId: selectedOption,
				}),
			});

			setSurvey(nextSurvey);
			setParticipant("");
			setSelectedOption(null);
			setMessage("Vote recorded.");
		} catch (requestError) {
			if (requestError.message === DUPLICATE_NAME_ERROR) {
				const suffix = Math.floor(100 + Math.random() * 900);
				setParticipant(`${participant.trim()}-${suffix}`);
			}
			setError(requestError.message);
		} finally {
			setLoadingVote(false);
		}
	};

	const adminLogin = async () => {
		setLoadingAdmin(true);
		setError("");
		setMessage("");

		try {
			await api("/api/admin/login", {
				method: "POST",
				body: JSON.stringify({ password }),
			});
			setPassword("");
			setMessage("Admin unlocked.");
			await loadSurvey();
		} catch (requestError) {
			setError(requestError.message);
		} finally {
			setLoadingAdmin(false);
		}
	};

	const adminLogout = async () => {
		setLoadingAdmin(true);
		setError("");
		setMessage("");

		try {
			await api("/api/admin/logout", {
				method: "POST",
				body: JSON.stringify({}),
			});
			setPassword("");
			setMessage("Admin locked.");
			await loadSurvey();
		} catch (requestError) {
			setError(requestError.message);
		} finally {
			setLoadingAdmin(false);
		}
	};

	const endSurvey = async () => {
		setLoadingAdmin(true);
		setError("");
		setMessage("");

		try {
			const nextSurvey = await api("/api/admin/end", {
				method: "POST",
				body: JSON.stringify({}),
			});
			setSurvey(nextSurvey);
			setMessage("Survey ended. Finale sequence started.");
		} catch (requestError) {
			setError(requestError.message);
		} finally {
			setLoadingAdmin(false);
		}
	};

	const resetSurvey = async () => {
		setLoadingAdmin(true);
		setError("");
		setMessage("");

		try {
			const nextSurvey = await api("/api/admin/reset", {
				method: "POST",
			});
			previousFinaleKeyRef.current = "";
			setAnimation(defaultAnimation());
			setSurvey(nextSurvey);
			setMessage("Survey cleared.");
		} catch (requestError) {
			setError(requestError.message);
		} finally {
			setLoadingAdmin(false);
		}
	};

	if (!survey) {
		return (
			<main className="page">
				{error ? (
					<section className="panel loading-shell">
						<h1>Survey Unavailable</h1>
						<p className="notice error">{error}</p>
					</section>
				) : (
					<div className="loading-shell">
						<div className="loader-orb" />
						<p>Loading survey…</p>
					</div>
				)}
			</main>
		);
	}

	const rankingMarkup = (
		<div className="ranking" key={`ranking-${animationRunKey}`}>
			{ranked.map((option, index) => {
				const width = `${Math.max((option.votes / maxVotes) * 100, option.votes ? 8 : 0)}%`;
				const consumed = animation.consumedIds.includes(option.id);

				return (
					<div
						className={`rank-row ${index === 0 ? "winner" : ""} ${consumed ? "consumed" : ""}`}
						key={option.id}
					>
						<div className="rank-row-top">
							<span className="rank-name">{option.name}</span>
						</div>
						<div className="rank-bar-shell">
							<div className="rank-bar-fill" style={{ width }} />
						</div>
					</div>
				);
			})}
		</div>
	);

	const arcadeMarkup = (
		<div
			key={animationRunKey}
			className={[
				"arcade-stage",
				showPublicFinale ? "public-arcade-stage" : "",
			].join(" ")}
		>
			<div className="ghost-row">
				{finaleOrder.map((option, index) => (
					<div className="ghost-lane" key={option.id}>
						<div
							className={[
								"ghost",
								`ghost-${ghostClassForIndex(index)}`,
								animation.activeGhostIndex === index
									? "active"
									: "",
								animation.ghostsGone ? "gone" : "",
							].join(" ")}
						>
							<span className="eye left" />
							<span className="eye right" />
							<span className="feet">
								<i />
								<i />
								<i />
								<i />
							</span>
						</div>
					</div>
				))}
			</div>

			<div className="pellet-lane" aria-hidden="true">
				{Array.from({ length: pelletCount }).map((_, index) => (
					<span
						className={`pellet ${index < animation.pelletsEaten ? "eaten" : ""}`}
						key={index}
					/>
				))}
			</div>

			<div
				className={[
					"pacman-shell",
					showPublicFinale ? "finale-top" : "",
					animation.pacmanSweep ? "sweep" : "",
				].join(" ")}
				aria-hidden="true"
			>
				<div
					className={[
						"pacman",
						animationRunKey % 2 === 0 ? "chomp-a" : "chomp-b",
						animation.pacmanBig ? "big" : "",
					].join(" ")}
				/>
			</div>
		</div>
	);

	const adminPanelMarkup = (
		<>
			<div className="section-head" ref={adminSectionRef}>
				<h2>Admin</h2>
				{survey.isAdmin ? (
					<span className="pill admin">Unlocked</span>
				) : null}
			</div>

			{!survey.adminPasswordConfigured ? (
				<div className="notice error">
					Admin authentication is currently unavailable on the server.
				</div>
			) : !survey.isAdmin ? (
				<div className="stack">
					<label className="field">
						<span>Password</span>
						<input
							type="password"
							ref={adminPasswordInputRef}
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							placeholder="Admin password"
						/>
					</label>
					<button
						type="button"
						className="btn btn-secondary"
						onClick={adminLogin}
						disabled={loadingAdmin || !password}
					>
						{loadingAdmin ? "Unlocking…" : "Unlock admin"}
					</button>
				</div>
			) : (
				<div className="stack">
					<button
						type="button"
						className="btn btn-secondary"
						onClick={endSurvey}
						disabled={loadingAdmin || survey.surveyEnded}
					>
						{survey.surveyEnded ? "Survey already ended" : "End survey"}
					</button>
					<button
						type="button"
						className="btn btn-accent"
						onClick={resetSurvey}
						disabled={loadingAdmin}
					>
						{loadingAdmin ? "Clearing…" : "Clear results"}
					</button>
					<button
						type="button"
						className="btn btn-ghost"
						onClick={adminLogout}
						disabled={loadingAdmin}
					>
						Lock admin
					</button>
				</div>
			)}
		</>
	);

	if (isAdminEntry) {
		return (
			<main className="page">
				<div className="grid-noise" />
				<section className="panel stack">
					<div>
						<h1>Admin Access</h1>
					</div>
					{message ? <p className="notice success">{message}</p> : null}
					{error ? <p className="notice error">{error}</p> : null}
					{survey.surveyEnded ? (
						<p className="notice">
							The admin entry point stays focused on login and
							controls, even after the public finale starts.
						</p>
					) : null}
					{adminPanelMarkup}
				</section>
			</main>
		);
	}

	if (showPublicFinale) {
		return (
			<main className="page page-finale">
				<div className="grid-noise" />
				<section
					className={[
						"panel",
						"public-finale",
						animation.started ? "started" : "",
						resultsRevealed ? "revealed" : "",
					].join(" ")}
				>
					<div className="public-finale-top">{arcadeMarkup}</div>
					<div className="public-finale-list">
						<div className="section-head">
							<h2>Final results</h2>
							<span className="leader">
								{leader ? `${leader.name} wins` : "No votes yet"}
							</span>
						</div>
						{rankingMarkup}
					</div>
				</section>
			</main>
		);
	}

	return (
		<main className="page">
			<div className="grid-noise" />
			<section className="hero panel">
				<div>
					<h1>Loop Orchestration Engine Naming Survey</h1>
				</div>

				<div className="hero-stats">
					<article className="stat c">
						<span className="label">Votes</span>
						<strong>Live</strong>
					</article>
					<article className="stat m">
						<span className="label">Respondents</span>
						<strong>Open</strong>
					</article>
					<article className="stat y">
						<span className="label">Options</span>
						<strong>Ready</strong>
					</article>
					<article className="stat k">
						<span className="label">Mode</span>
						<strong>{survey.isAdmin ? "Admin" : "Public"}</strong>
					</article>
				</div>
			</section>

			<section className="layout">
				<aside className="panel stack">
					<div className="section-head">
						<h2>{survey.surveyEnded ? "Survey closed" : "Vote once"}</h2>
						<span
							className={`pill ${survey.surveyEnded ? "ended" : "live"}`}
						>
							{survey.surveyEnded
								? "Survey closed"
								: "Survey live"}
						</span>
					</div>

					{survey.surveyEnded ? (
						<p className="notice">
							Voting is closed. Only the final results remain visible.
						</p>
					) : (
						<form className="stack" onSubmit={submitVote}>
							<p className="notice">
								One response is allowed per connection.
							</p>
							<label className="field">
								<span>Participant</span>
								<input
									type="text"
									value={participant}
									disabled={loadingVote}
									onChange={(event) =>
										setParticipant(event.target.value)
									}
									placeholder="Your name"
								/>
							</label>

							<div className="options">
								{survey.options.map((option) => (
									<label
										className={`option-card ${selectedOption === option.id ? "selected" : ""}`}
										key={option.id}
									>
										<input
											type="radio"
											name="option"
											checked={selectedOption === option.id}
											disabled={loadingVote}
											onChange={() =>
												setSelectedOption(option.id)
											}
										/>
										<span>{option.name}</span>
									</label>
								))}
							</div>

							<button
								className="btn btn-primary"
								disabled={loadingVote || selectedOption === null}
							>
								{loadingVote ? "Submitting…" : "Submit vote"}
							</button>
						</form>
					)}

					{message ? (
						<p className="notice success">{message}</p>
					) : null}
					{error ? <p className="notice error">{error}</p> : null}

				</aside>

				<section className="panel results-panel">
					{survey.surveyEnded ? arcadeMarkup : null}

					<div className="section-head">
						<h2>
							{survey.surveyEnded
								? "Final results"
								: "Live ranking"}
						</h2>
						<span className="leader">
							{leader
								? survey.surveyEnded
									? `${leader.name} wins`
									: `${leader.name} leads`
								: "No votes yet"}
						</span>
					</div>

					{survey.surveyEnded ? (
						<p className="notice success">
							Voting is closed. Everyone now sees the final
							ranking and finale sequence.
						</p>
					) : null}

					{rankingMarkup}
				</section>

				<section className="panel ips-panel">
					<div className="section-head">
						<h2>Participants</h2>
						<span className="pill neutral">Responses</span>
					</div>

					<div className="ip-list">
						{survey.participants.length ? (
							survey.participants.map((entry) => (
								<article
									className="ip-card"
									key={`${entry.name}-${entry.votedAt}`}
								>
									<div className="ip-head">
										<strong>{entry.name}</strong>
										<span>{entry.optionName}</span>
									</div>
									<div className="ip-meta">
										<span>Recorded</span>
									</div>
								</article>
							))
						) : (
							<div className="empty-state">No responses yet.</div>
						)}
					</div>
				</section>
			</section>
		</main>
	);
};

const root = createRoot(document.getElementById("root"));

root.render(
	<App />,
);
