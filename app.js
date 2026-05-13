const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

// ── Credentials ───────────────────────────────────────────
const FUSION_HOST   = process.env.FUSION_HOST   || 'https://elup-test.fa.em2.oraclecloud.com';
const FUSION_USER   = process.env.FUSION_USER   || '';
const FUSION_PASS   = process.env.FUSION_PASS   || '';
const CLIENT_ID     = process.env.CLIENT_ID     || '';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const TOKEN_URL     = process.env.TOKEN_URL     || 'https://idcs-1db6ad5580804382953e5ab516205434.identity.oraclecloud.com/oauth2/v1/token';
const AGENT_CODE    = process.env.AGENT_CODE    || 'APINVOICETEAM';
const WA_TOKEN      = process.env.WA_TOKEN      || '';
const PHONE_ID      = process.env.PHONE_ID      || '';
const VERIFY_TOKEN  = process.env.VERIFY_TOKEN  || 'mySecret123';

// ── Token Cache ───────────────────────────────────────────
let cachedToken    = null;
let tokenExpiresAt = 0;

// ── Get OAuth Token ───────────────────────────────────────
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
    throw new Error('Token failed: ' + JSON.stringify(err.response?.data || err.message));
  }
}

// ── Call Oracle AI Agent invokeAsync ──────────────────────
async function callOracleAgent(userMessage, conversationId) {
  try {
    const token = await getOAuthToken();

    const body = {
      message: {
        content: [{ type: 'text', text: userMessage }]
      }
    };
    if (conversationId) body.conversationId = conversationId;

    const invokeURL = `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync`;
    console.log('Calling invokeAsync:', invokeURL);

    const invokeRes = await axios.post(invokeURL, body, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json'
      }
    });

    const jobId  = invokeRes.data.jobId;
    const convId = invokeRes.data.conversationId;
    console.log('Job ID:', jobId);

    const statusURL = `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync/${jobId}`;

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const statusRes = await axios.get(statusURL, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const status = statusRes.data.status;
      console.log(`Poll ${i + 1} status: ${status}`);

      if (status === 'COMPLETED') {
        const reply =
          statusRes.data?.message?.content?.[0]?.text ||
          statusRes.data?.output?.content?.[0]?.text  ||
          'Request completed but no response text found.';
        console.log('Agent reply received');
        return { reply, conversationId: convId };
      }

      if (status === 'FAILED') {
        console.error('Agent failed');
        return {
          reply:          'Sorry, the agent failed to process your request.',
          conversationId: convId
        };
      }
    }

    return {
      reply:          'Agent is taking too long. Please try again.',
      conversationId: null
    };

  } catch (err) {
    console.error('Agent error:', JSON.stringify(err.response?.data || err.message));
    return await callDirectAPI(userMessage);
  }
}

// ── Fallback Direct Oracle REST API ──────────────────────
async function callDirectAPI(userMessage) {
  try {
    const msg = userMessage.toLowerCase();
    let queryParams = '';
    let title = 'Latest AP Invoices';

    if (msg.includes('pending') || msg.includes('approval')) {
      queryParams = 'q=ApprovalStatus=Requ
