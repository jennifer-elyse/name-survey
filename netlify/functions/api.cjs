let cachedHandler;
const serverless = require("serverless-http");

exports.handler = async (event, context) => {
	if (!cachedHandler) {
		const appModule = require("../../app.cjs");
		const app =
			appModule.app ||
			appModule.default?.app ||
			appModule.default ||
			appModule;

		if (!app) {
			throw new Error("Netlify function could not load the Express app.");
		}

		cachedHandler = serverless(app);
	}

	return cachedHandler(event, context);
};
