var crypto = require("crypto");

exports.handler = async function(event, context) {
  var sessionSecret = process.env.SESSION_SECRET || "fb-crm-default-secret-2025";
  var cookies = (event.headers && event.headers.cookie) || "";
  var match = cookies.match(/fb_session=([^;]+)/);

  if (!match) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authenticated: false })
    };
  }

  try {
    var raw = match[1];
    var idx = raw.lastIndexOf(".");
    if (idx < 1) throw new Error("bad cookie");

    var data = raw.substring(0, idx);
    var sig = raw.substring(idx + 1);
    var expected = crypto.createHmac("sha256", sessionSecret).update(data).digest("base64url");

    if (sig !== expected) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authenticated: false, error: "invalid" })
      };
    }

    var session = JSON.parse(Buffer.from(data, "base64").toString("utf8"));

    // Expire after 7 days
    if (Date.now() - session.loggedInAt > 604800000) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authenticated: false, error: "expired" })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authenticated: true,
        user: { email: session.email, name: session.name, picture: session.picture }
      })
    };
  } catch (e) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authenticated: false, error: "parse_error" })
    };
  }
};
