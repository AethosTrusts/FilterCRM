exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }) };

  try {
    var input = JSON.parse(event.body);
    if (!input.contact && !input.firm) {
      return { statusCode: 400, body: JSON.stringify({ error: "Contact name or firm name required" }) };
    }

    var prompt = 'Find the professional email address for ' +
      (input.contact ? '"' + input.contact + '"' : 'the primary investment contact') +
      ' at the venture capital / investment firm "' + input.firm + '". ' +
      (input.website ? 'Firm website: ' + input.website + '. ' : '') +
      (input.linkedin ? 'LinkedIn: ' + input.linkedin + '. ' : '') +
      '\n\nSearch the web thoroughly. Check the firm website team page, Crunchbase profiles, LinkedIn, PitchBook, press releases, conference speaker bios, and any public directories. ' +
      'Many VC partners list their emails on their firm websites or in press/media contact sections. Also check for common VC email patterns like firstname@firmname.com or first.last@firmname.com.' +
      '\n\nReturn ONLY a JSON object (no markdown, no backticks, no explanation) with these fields:' +
      '\n{"email":"the email if found or empty string","confidence":"HIGH if found on official source, MEDIUM if pattern-inferred, LOW if guessed","source":"where you found it","alternateEmails":["any other possible emails"],"contactTitle":"their title/role if found","notes":"any relevant context"}';

    var resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!resp.ok) {
      var err = await resp.json().catch(function() { return {}; });
      return { statusCode: 502, body: JSON.stringify({ error: (err.error && err.error.message) || "API error" }) };
    }

    var data = await resp.json();
    var texts = (data.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; });
    var raw = texts.join("\n").trim().replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    var result;
    try { result = JSON.parse(raw); }
    catch (e) { return { statusCode: 502, body: JSON.stringify({ error: "Parse failed", raw: raw.substring(0, 500) }) }; }

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
