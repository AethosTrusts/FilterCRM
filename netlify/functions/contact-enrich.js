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
      'Also check for common VC email patterns like firstname@firmname.com or first.last@firmname.com.' +
      '\n\nAfter searching, respond with ONLY a JSON object — no markdown fences, no preamble, no explanation:' +
      '\n{"email":"the email if found or empty string","confidence":"HIGH/MEDIUM/LOW","source":"where found","alternateEmails":["other possible emails"],"contactTitle":"title if found","notes":"context"}';

    var messages = [{ role: "user", content: prompt }];
    var finalTexts = [];

    for (var loop = 0; loop < 6; loop++) {
      var resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: messages
        })
      });

      if (!resp.ok) {
        var err = await resp.json().catch(function() { return {}; });
        return { statusCode: 502, body: JSON.stringify({ error: (err.error && err.error.message) || "API error " + resp.status }) };
      }

      var data = await resp.json();
      var content = data.content || [];

      content.forEach(function(b) {
        if (b.type === "text" && b.text) finalTexts.push(b.text);
      });

      if (data.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: content });
      var toolResults = [];
      content.forEach(function(b) {
        if (b.type === "tool_use") {
          toolResults.push({ type: "tool_result", tool_use_id: b.id, content: "Done. Now return the JSON result." });
        }
      });
      if (toolResults.length > 0) messages.push({ role: "user", content: toolResults });
      else break;
    }

    var raw = finalTexts.join("\n").trim();
    var result = extractJSON(raw);
    if (!result) {
      return { statusCode: 502, body: JSON.stringify({ error: "Parse failed", raw: raw.substring(0, 800) }) };
    }
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

function extractJSON(text) {
  if (!text) return null;
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try { return JSON.parse(text); } catch(e) {}
  var first = text.indexOf("{");
  var last = text.lastIndexOf("}");
  if (first !== -1 && last > first) {
    var chunk = text.substring(first, last + 1);
    try { return JSON.parse(chunk); } catch(e) {}
    try { return JSON.parse(chunk.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")); } catch(e) {}
  }
  return null;
}
