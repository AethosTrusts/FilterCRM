exports.handler = async function(event, context) {
  return {
    statusCode: 302,
    headers: {
      "Location": "/",
      "Set-Cookie": "fb_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    },
    body: ""
  };
};
