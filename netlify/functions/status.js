exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      working: true,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      slack: !!process.env.SLACK_WEBHOOK_URL,
      pandadoc: !!process.env.PANDADOC_API_KEY,
      supabase: !!process.env.SUPABASE_URL && !!process.env.SUPABASE_KEY,
      auth: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET,
      timestamp: new Date().toISOString()
    })
  };
};
