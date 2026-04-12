import appModule from "./app.cjs";

const { ADMIN_PASSWORD, HOST, IS_NETLIFY, PORT, app } = appModule;

if (!IS_NETLIFY) {
	app.listen(PORT, HOST, () => {
		console.log(`Name Survey API/server listening on http://${HOST}:${PORT}`);
		console.log("Ephemeral admin password generated for this server run only.");
		console.log(`Admin password: ${ADMIN_PASSWORD}`);
	});
}
