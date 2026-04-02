exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  var url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true }) };
  try {
    var body = JSON.parse(event.body);
    var resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body.text }) });
    return { statusCode: resp.ok ? 200 : 502, body: JSON.stringify({ ok: resp.ok }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
