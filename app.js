const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

// ── All credentials from environment variables ────────────
const FUSION_HOST   = process.env.FUSION_HOST   || 'https://elup-test.fa.em2.oraclecloud.com';
const FUSION_USER   = process.env.FUSION_USER;
const FUSION_PASS   = process.env.FUSION_PASS;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const TOKEN_URL     = process.env.TOKEN_URL     || 'https://idcs-1db6ad5580804382953e5ab516205434.identity.oraclecloud.com/oauth2/v1/token';
const AGENT_CODE    = process.env.AGENT_CODE    || 'APINVOICETEAM';
const WA_TOKEN      = process.env.WA_TOKEN;
const PHONE_ID      = process.env.PHONE_ID;
const VERIFY_TOKEN  = process.env.VERIFY_TOKEN  || 'mySecret123';

// ── Token cache ───────────────────────────────────────────
let cachedToken    = null;
let tokenExpiresAt = 0;

// ── Get Oracle OAuth Token (Resource Owner Password Grant) ─
async function getOAuthToken() {
  try {
    if (cachedToken && Date.now() < tokenExpiresAt) {
      console.log('Using cached token');
      return cachedToken;
    }

    console.log('Fetching new OAuth token...');
    console.log('TOKEN_URL:', TOKEN_URL);
    console.log('CLIENT_ID:', CLIENT_ID ? 'SET' : 'NOT SET');
    console.log('FUSION_USER:', FUSION_USER ? 'SET' : 'NOT SET');

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
    console.error('Token fetch error:', JSON.stringify(err.response?.data || err.message));
    throw new Error('Failed to get OAuth token: ' + JSON.stringify(err.response?.data || err.message));
  }
}

// ── Call Oracle AI Agent ──────────────────────────────────
async function callAgent(userMessage, conversationId) {
  try {
    const token = await getOAuthToken();

    const body = {
      message: {
        content: [{ type: 'text', text: userMessage }]
      }
    };
    if (conversationId) {
      body.conversationId = conversationId;
    }

    const invokeURL = `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync`;
    console.log('Calling invokeAsync:', invokeURL);

    const invokeRes = await axios.post(invokeURL, body, {
      headers: {
        'Authorization' : `Bearer ${token}`,
        'Content-Type'  : 'application/json'
      }
    });

    const jobId  = invokeRes.data.jobId;
    const convId = invokeRes.data.conversationId;
    console.log('Job ID received:', jobId);

    // Poll for result
    const statusURL = `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync/${jobId}`;
    console.log('Polling status URL:', statusURL);

    for (let i = 0; i < 15; i++) {
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
        return { reply, conversationId: convId };
      }

      if (status === 'FAILED') {
        return {
          reply         : 'Sorry, the agent failed to process your request.',
          conversationId: convId
        };
      }
    }

    return {
      reply         : 'Agent is taking too long. Please try again.',
      conversationId: null
    };

  } catch (err) {
    console.error('Agent error:', JSON.stringify(err.response?.data || err.message));
    return {
      reply         : 'Error connecting to Oracle. Please try again later.',
      conversationId: null
    };
  }
}

// ── Send WhatsApp message ─────────────────────────────────
async function sendWhatsApp(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
      {
        messaging_product : 'whatsapp',
        to                : to,
        type              : 'text',
        text              : { body: text }
      },
      {
        headers: {
          'Authorization' : `Bearer ${WA_TOKEN}`,
          'Content-Type'  : 'application/json'
        }
      }
    );
    console.log('WhatsApp message sent to:', to);
  } catch (err) {
    console.error('WhatsApp send error:', JSON.stringify(err.response?.data || err.message));
  }
}

// ── Health check ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Oracle WhatsApp Bridge is running OK');
});

// ── Debug route ───────────────────────────────────────────
app.get('/debug', (req, res) => {
  res.json({
    FUSION_HOST   : FUSION_HOST,
    AGENT_CODE    : AGENT_CODE,
    TOKEN_URL     : TOKEN_URL,
    CLIENT_ID     : CLIENT_ID     ? 'SET' : 'NOT SET',
    CLIENT_SECRET : CLIENT_SECRET ? 'SET' : 'NOT SET',
    FUSION_USER   : FUSION_USER   ? 'SET' : 'NOT SET',
    FUSION_PASS   : FUSION_PASS   ? 'SET' : 'NOT SET',
    WA_TOKEN      : WA_TOKEN      ? 'SET' : 'NOT SET',
    PHONE_ID      : PHONE_ID      || 'NOT SET',
    VERIFY_TOKEN  : VERIFY_TOKEN  ? 'SET' : 'NOT SET'
  });
});

// ── Webhook verification ──────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console
