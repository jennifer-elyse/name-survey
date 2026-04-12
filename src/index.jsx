import React, { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const API_BASE =
	window.location.port === "1234"
		? `${window.location.protocol}//${window.location.hostname}:8787`
		: "";

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

const defaultAnimation = () => ({
	started: false,
	activeGhostIndex: null,
	consumedIds: [],
	pelletsEaten: 0,
	pacmanBig: false,
	pacmanSweep: false,
	ghostsGone: false,
});

const formatTimestamp = (value) => {
	if (!value) return "—";
	return new Date(value).toLocaleString();
};

const PELLET_COUNT = 8;
const PELLET_SWEEP_MS = 1300;
const DUPLICATE_NAME_ERROR = "That participant name has already been used.";

const App = () => {
	const [survey, setSurvey] = useState(null);
	const [participant, setParticipant] = useState("");
	const [selectedOption, setSelectedOption] = useState(0);
	const [password, setPassword] = useState("");
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const [loadingVote, setLoadingVote] = useState(false);
	const [loadingAdmin, setLoadingAdmin] = useState(false);
	const [animation, setAnimation] = useState(defaultAnimation);
	const previousEndedRef = useRef(false);

	const loadSurvey = async ({ silent = false } = {}) => {
		try {
			const nextSurvey = await api("/api/survey");
			setSurvey(nextSurvey);

			if (!silent) {
				setError("");
			}
		} catch (requestError) {
			setError(requestError.message);
		}
	};

	useEffect(() => {
		loadSurvey();

		const timer = window.setInterval(() => {
			loadSurvey({ silent: true });
		}, 2000);

		return () => window.clearInterval(timer);
	}, []);

	const ranked = useMemo(() => survey?.rankedOptions || [], [survey]);
	const finaleOrder = useMemo(() => ranked.slice(1, 5).reverse(), [ranked]);
	const finaleRanks = useMemo(
		() => new Map(ranked.map((option, index) => [option.id, index + 1])),
		[ranked],
	);
	const leader = ranked[0];
	const maxVotes = Math.max(
		...(survey?.options || []).map((option) => option.votes),
		1,
	);

	useEffect(() => {
		if (!survey) return;

		if (!survey.surveyEnded) {
			previousEndedRef.current = false;
			setAnimation(defaultAnimation());
			return;
		}

		if (previousEndedRef.current) return;

		previousEndedRef.current = true;

		const runAnimation = async () => {
			setAnimation((current) => ({
				...current,
				started: true,
			}));

			for (let index = 0; index < finaleOrder.length; index += 1) {
				setAnimation((current) => ({
					...current,
					activeGhostIndex: index,
				}));
				await wait(700);
				setAnimation((current) => ({
					...current,
					consumedIds: [
						...current.consumedIds,
						finaleOrder[index].id,
					],
				}));
				await wait(180);
			}

			setAnimation((current) => ({
				...current,
				activeGhostIndex: null,
				pacmanBig: true,
			}));

			await wait(320);

			setAnimation((current) => ({
				...current,
				pacmanSweep: true,
			}));

			const pelletDelay = Math.floor(PELLET_SWEEP_MS / PELLET_COUNT);
			for (let index = 0; index < PELLET_COUNT; index += 1) {
				await wait(pelletDelay);
				setAnimation((current) => ({
					...current,
					pelletsEaten: Math.min(
						current.pelletsEaten + 1,
						PELLET_COUNT,
					),
				}));
			}

			setAnimation((current) => ({
				...current,
				ghostsGone: true,
			}));
		};

		runAnimation();
	}, [survey, finaleOrder]);

	const submitVote = async (event) => {
		event.preventDefault();

		if (!participant.trim()) {
			setError("Participant name is required.");
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
			previousEndedRef.current = false;
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
						<strong>{survey.totalVotes}</strong>
					</article>
					<article className="stat m">
						<span className="label">Respondents</span>
						<strong>{survey.respondentCount}</strong>
					</article>
					<article className="stat y">
						<span className="label">Options</span>
						<strong>{survey.options.length}</strong>
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
						<h2>Vote once</h2>
						<span
							className={`pill ${survey.surveyEnded ? "ended" : "live"}`}
						>
							{survey.surveyEnded
								? "Survey closed"
								: "Survey live"}
						</span>
					</div>

					<form className="stack" onSubmit={submitVote}>
						<p className="notice">
							One response is allowed per connection.
						</p>
						<label className="field">
							<span>Participant</span>
							<input
								type="text"
								value={participant}
								disabled={survey.surveyEnded || loadingVote}
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
										disabled={
											survey.surveyEnded || loadingVote
										}
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
							disabled={survey.surveyEnded || loadingVote}
						>
							{loadingVote ? "Submitting…" : "Submit vote"}
						</button>
					</form>

					{message ? (
						<p className="notice success">{message}</p>
					) : null}
					{error ? <p className="notice error">{error}</p> : null}

					<div className="separator" />

					<div className="section-head">
						<h2>Admin</h2>
						{survey.isAdmin ? (
							<span className="pill admin">Unlocked</span>
						) : null}
					</div>

					{!survey.adminPasswordConfigured ? (
						<div className="notice error">
							Admin authentication is currently unavailable on the
							server.
						</div>
					) : !survey.isAdmin ? (
						<div className="stack">
							<label className="field">
								<span>Password</span>
								<input
									type="password"
									value={password}
									onChange={(event) =>
										setPassword(event.target.value)
									}
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
								{survey.surveyEnded
									? "Survey already ended"
									: "End survey"}
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
				</aside>

				<section className="panel results-panel">
					<div className="section-head">
						<h2>
							{survey.surveyEnded
								? "Final results"
								: "Live ranking"}
						</h2>
						<span className="leader">
							{leader
								? survey.surveyEnded
									? `${leader.name} wins with ${leader.votes}`
									: `${leader.name} leads with ${leader.votes}`
								: "No votes yet"}
						</span>
					</div>

					{survey.surveyEnded ? (
						<p className="notice success">
							Voting is closed. Everyone now sees the final
							ranking and finale sequence.
						</p>
					) : null}

					<div className="ranking">
						{ranked.map((option, index) => {
							const width = `${Math.max((option.votes / maxVotes) * 100, option.votes ? 8 : 0)}%`;
							const consumed = animation.consumedIds.includes(
								option.id,
							);

							return (
								<div
									className={`rank-row ${index === 0 ? "winner" : ""} ${consumed ? "consumed" : ""}`}
									key={option.id}
								>
									<div className="rank-row-top">
										<span className="rank-index">
											#{index + 1}
										</span>
										<span className="rank-name">
											{option.name}
										</span>
										<span className="rank-votes">
											{option.votes}
										</span>
									</div>
									<div className="rank-bar-shell">
										<div
											className="rank-bar-fill"
											style={{ width }}
										/>
									</div>
								</div>
							);
						})}
					</div>

					{survey.surveyEnded ? (
						<div className="arcade-stage">
							<div className="ghost-row">
								{finaleOrder.map((option, index) => (
									<div className="ghost-lane" key={option.id}>
										<div
											className={[
												"ghost",
												`ghost-${GHOSTS[index]?.key || "k"}`,
												animation.activeGhostIndex ===
												index
													? "active"
													: "",
												animation.ghostsGone
													? "gone"
													: "",
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
										<span className="ghost-tag">{`#${finaleRanks.get(option.id)}`}</span>
									</div>
								))}
							</div>

							<div className="pellet-lane" aria-hidden="true">
								{Array.from({ length: PELLET_COUNT }).map(
									(_, index) => (
										<span
											className={`pellet ${index < animation.pelletsEaten ? "eaten" : ""}`}
											key={index}
										/>
									),
								)}
							</div>

							<div
								className={[
									"pacman",
									animation.pacmanBig ? "big" : "",
									animation.pacmanSweep ? "sweep" : "",
								].join(" ")}
								aria-hidden="true"
							>
								<span className="pacman-eye" />
								<span className="pacman-mouth" />
							</div>
						</div>
					) : null}
				</section>

				<section className="panel ips-panel">
					<div className="section-head">
						<h2>Participants</h2>
						<span className="pill neutral">
							{survey.respondentCount} total
						</span>
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
										<span>
											Voted:{" "}
											{formatTimestamp(entry.votedAt)}
										</span>
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
	<StrictMode>
		<App />
	</StrictMode>,
);
