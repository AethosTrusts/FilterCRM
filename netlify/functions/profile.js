exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }) };

  try {
    var input = JSON.parse(event.body);
    if (!input.firm) return { statusCode: 400, body: JSON.stringify({ error: "Firm name required" }) };

    var prompt = 'Research the investment firm "' + input.firm + '". ' +
      (input.website ? 'Website: ' + input.website + '. ' : '') +
      (input.linkedin ? 'LinkedIn: ' + input.linkedin + '. ' : '') +
      'Build a comprehensive investor profile using web search. ' +
      'After searching, respond with ONLY a JSON object — no markdown fences, no preamble text, no explanation. ' +
      'The JSON must have these exact keys: ' +
      '{"thesis":"2-4 sentences","portfolio":"comma-separated notable companies","stage":"typical stage","checkSize":"range",' +
      '"keyPeople":"key partners","founded":"year or empty","aum":"fund size or empty","recentActivity":"last 12-18 months",' +
      '"beautyRelevance":"HIGH/MEDIUM/LOW with explanation for DTC water filtration beauty brand","waterConflict":"YES or NO"}';

    var messages = [{ role: "user", content: prompt }];
    var finalTexts = [];

    for (var loop = 0; loop < 6; loop++) {
      var resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
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
          toolResults.push({ type: "tool_result", tool_use_id: b.id, content: "Done. Now return the JSON profile." });
        }
      });
      if (toolResults.length > 0) messages.push({ role: "user", content: toolResults });
      else break;
    }

    var raw = finalTexts.join("\n").trim();
    var profile = extractJSON(raw);
    if (!profile) {
      return { statusCode: 502, body: JSON.stringify({ error: "Parse failed", raw: raw.substring(0, 800) }) };
    }
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) };
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
