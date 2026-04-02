exports.handler = async function(event, context) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  var key = process.env.PANDADOC_API_KEY;
  if (!key) return { statusCode: 500, body: JSON.stringify({ error: "PandaDoc not configured" }) };
  try {
    var email = event.queryStringParameters && event.queryStringParameters.email;
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: "Email required" }) };
    var resp = await fetch("https://api.pandadoc.com/public/v1/documents?q=" + encodeURIComponent(email) + "&status=2,5,11,12", { headers: { "Authorization": "API-Key " + key } });
    if (resp.ok) {
      var data = await resp.json();
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ results: data.results || [] }) };
    }
    return { statusCode: 502, body: JSON.stringify({ error: "PandaDoc error" }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
