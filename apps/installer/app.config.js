// app.json plus build-time settings. EXPO_BASE_URL serves the web build from
// a sub-path (the console hosts it at /app); native builds ignore it.
module.exports = ({ config }) => ({
  ...config,
  experiments: { ...(config.experiments ?? {}), ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}) },
});
