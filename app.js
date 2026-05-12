async function getOAuthToken() {
  try {
    if (cachedToken && Date.now() < tokenExpiresAt) {
      console.log('Using cached token');
      return cachedToken;
    }
    console.log('Fetching new OAuth token...');

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('username',   FUSION_USER);
    params.append('password',   FUSION_PASS);
    params.append('scope',      'urn:opc:resource:fusion:elup-test:fusion-ai/');

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
    tokenExpiresAt = Date.now() + ((response.data.expires_in || 3600) - 60) * 1000;
    console.log('OAuth token obtained successfully');
    return cachedToken;

  } catch (err) {
    console.error('Token error:', JSON.stringify(err.response?.data || err.message));
    throw new Error('Token failed');
  }
}
