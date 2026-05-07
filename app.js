async function getOAuthToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  console.log('Fetching new OAuth token...');

  const params = new URLSearchParams();
  params.append('grant_type', 'password');
  params.append('username', process.env.FUSION_USER);
  params.append('password', process.env.FUSION_PASS);
  params.append('scope', 'urn:opc:resource:fusion:elup-test:fusion-ai/');

  try {
    const response = await axios.post(
      TOKEN_URL,
      params.toString(),
      {
        auth: {
          username: CLIENT_ID,
          password: CLIENT_SECRET
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    cachedToken    = response.data.access_token;
    tokenExpiresAt = Date.now() + (response.data.expires_in - 60) * 1000;
    console.log('OAuth token obtained successfully');
    return cachedToken;
  } catch (err) {
    console.error('Token error:', JSON.stringify(err.response?.data));
    throw err;
  }
}

app.get('/debug', (req, res) => {
  res.json({
    FUSION_HOST   : process.env.FUSION_HOST   || 'NOT SET',
    FUSION_USER   : process.env.FUSION_USER   ? 'SET' : 'NOT SET',
    FUSION_PASS   : process.env.FUSION_PASS   ? 'SET' : 'NOT SET',
    AGENT_CODE    : process.env.AGENT_CODE    || 'NOT SET',
    TOKEN_URL     : process.env.TOKEN_URL     || 'NOT SET',
    CLIENT_ID     : process.env.CLIENT_ID     ? 'SET' : 'NOT SET',
    CLIENT_SECRET : process.env.CLIENT_SECRET ? 'SET' : 'NOT SET',
    WA_TOKEN      : process.env.WA_TOKEN      ? 'SET' : 'NOT SET',
    PHONE_ID      : process.env.PHONE_ID      || 'NOT SET',
    VERIFY_TOKEN  : process.env.VERIFY_TOKEN  || 'NOT SET'
  });
});
