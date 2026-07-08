const CLIENT_ID = process.env.CLIENT_ID || '';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';

async function getOAuthToken() {
  try {
    if (cachedToken && Date.now() < tokenExpiresAt) {
      console.log('Using cached token');
      return cachedToken;
    }
    console.log('Fetching OAuth token...');
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('username', FUSION_USER);
    params.append('password', FUSION_PASS);
    params.append('scope', 'urn:opc:resource:fusion:elup:fusion-ai/');
    const res = await axios.post(TOKEN_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      auth: {
        username: CLIENT_ID,
        password: CLIENT_SECRET
      }
    });
    cachedToken = res.data.access_token;
    tokenExpiresAt = Date.now() + ((res.data.expires_in || 3600) - 60) * 1000;
    console.log('Token obtained OK');
    return cachedToken;
  } catch (err) {
    console.error('Token error: ' + JSON.stringify(err.response ? err.response.data : err.message));
    throw new Error('Token failed');
  }
}
