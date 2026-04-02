exports.handler = async function(event, context) {
  var clientId = process.env.GOOGLE_CLIENT_ID;
  var siteUrl = process.env.URL || "https://filtercrm.netlify.app";
  var redirectUri = siteUrl + "/api/auth/callback";

  if (!clientId) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: "<h2>Error: GOOGLE_CLIENT_ID not set</h2><p>Add it in Netlify Dashboard > Site configuration > Environment variables</p>"
    };
  }

  var params = [
    "client_id=" + encodeURIComponent(clientId),
    "redirect_uri=" + encodeURIComponent(redirectUri),
    "response_type=code",
    "scope=" + encodeURIComponent("openid email profile"),
    "access_type=online",
    "prompt=select_account",
    "hd=filterbaby.com"
  ].join("&");

  return {
    statusCode: 302,
    headers: { "Location": "https://accounts.google.com/o/oauth2/v2/auth?" + params },
    body: ""
  };
};
