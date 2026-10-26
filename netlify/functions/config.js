// Public runtime config. Secrets stay on the server.
exports.handler = async () => {
  const providers = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY)
  };

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      appName: "CHTAVIED.NDA AI",
      providers,
      anyProviderReady: Object.values(providers).some(Boolean),
      googleClientId: process.env.GOOGLE_CLIENT_ID || ""
    })
  };
};
