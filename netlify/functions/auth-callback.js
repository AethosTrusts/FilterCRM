var crypto = require("crypto");

exports.handler = async function(event, context) {
  var clientId = process.env.GOOGLE_CLIENT_ID;
  var clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  var sessionSecret = process.env.SESSION_SECRET || "fb-crm-default-secret-2025";
  var siteUrl = process.env.URL || "https://filtercrm.netlify.app";
  var redirectUri = siteUrl + "/api/auth/callback";

  var qs = event.queryStringParameters || {};
  var code = qs.code;
  var error = qs.error;

  if (error || !code) {
    return {
      statusCode: 302,
      headers: { "Location": "/?auth_error=" + (error || "no_code") },
      body: ""
    };
  }

  try {
    // Exchange code for tokens
    var tokenBody = [
      "code=" + encodeURIComponent(code),
      "client_id=" + encodeURIComponent(clientId),
      "client_secret=" + encodeURIComponent(clientSecret),
      "redirect_uri=" + encodeURIComponent(redirectUri),
      "grant_type=authorization_code"
    ].join("&");

    var tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody
    });

    if (!tokenResp.ok) {
      var errText = await tokenResp.text();
      console.log("Token exchange failed:", errText);
      return {
        statusCode: 302,
        headers: { "Location": "/?auth_error=token_failed" },
        body: ""
      };
    }

    var tokens = await tokenResp.json();

    // Decode JWT id_token payload
    var parts = tokens.id_token.split(".");
    var b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

    // Domain check
    if (payload.hd !== "filterbaby.com") {
      return {
        statusCode: 302,
        headers: { "Location": "/?auth_error=domain_restricted" },
        body: ""
      };
    }

    // Build session cookie
    var session = JSON.stringify({
      email: payload.email || "",
      name: payload.name || "",
      picture: payload.picture || "",
      hd: payload.hd,
      loggedInAt: Date.now()
    });

    var sessionB64 = Buffer.from(session).toString("base64");
    var sig = crypto.createHmac("sha256", sessionSecret).update(sessionB64).digest("base64url");
    var cookie = sessionB64 + "." + sig;

    var secure = siteUrl.indexOf("https") === 0;
    var cookieStr = "fb_session=" + cookie + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800" + (secure ? "; Secure" : "");

    return {
      statusCode: 302,
      headers: { "Location": "/", "Set-Cookie": cookieStr },
      body: ""
    };

  } catch (err) {
    console.log("Auth error:", err);
    return {
      statusCode: 302,
      headers: { "Location": "/?auth_error=" + encodeURIComponent(err.message) },
      body: ""
    };
  }
};
