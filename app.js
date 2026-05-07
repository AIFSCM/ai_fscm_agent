const express = require('express');
const axios   = require('axios');
const qs      = require('querystring');
const app     = express();
app.use(express.json());

// ── Credentials ───────────────────────────────────────────
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const TOKEN_URL     = process.env.TOKEN_URL;
const FUSION_HOST   = process.env.FUSION_HOST;
const AGENT_CODE    = process.env.AGENT_CODE;
const WA_TOKEN      = process.env.WA_TOKEN;
const PHONE_ID      = process.env.PHONE_ID;
const VERIFY_TOKEN  = process.env.VERIFY_TOKEN;

// ── Get Oracle OAuth Token ────────────────────────────────
let cachedToken    = null;
let tokenExpiresAt = 0;

async function getOAuthToken() {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  console.log('🔑 Fetching new OAuth token...');

  const response = await axios.post(
    TOKEN_URL,
    qs.stringify({
      grant_type : 'client_credentials',
      scope      : `urn:opc:resource:fusion:elup-test:fusion-ai/`
    }),
    {
      auth: {
        username: CLIENT_ID,
        password: CLIENT_SECRET
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );

  cachedToken    = response.data.access_token;
  tokenExpiresAt = Date.now() + (response.data.expires_in - 60) * 1000;
  console.log('✅ OAuth token obtained');
  return cachedToken;
}

// ── Call Oracle AI Agent ──────────────────────────────────
async function callAgent(userMessage, conversationId = null) {
  try {
    const token = await getOAuthToken();

    const body = {
      message: {
        content: [{ type: 'text', text: userMessage }]
      }
    };
    if (conversationId) body.conversationId = conversationId;

    // Invoke agent
    const invokeRes = await axios.post(
      `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync`,
      body,
      {
        headers: {
          Authorization : `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const jobId  = invokeRes.data.jobId;
    const convId = invokeRes.data.conversationId;
    console.log('📋 Job ID:', jobId);

    // Poll for result every 2 seconds max 15 times
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const statusRes = await axios.get(
        `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync/${jobId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      console.log(`Poll ${i + 1} status:`, statusRes.data.status);

      if (statusRes.data.status === 'COMPLETED') {
        const reply =
          statusRes.data?.message?.content?.[0]?.text ||
          statusRes.data?.output?.content?.[0]?.text  ||
          'Request completed but no response text found.';
        return { reply, conversationId: convId };
      }

      if (statusRes.data.status === 'FAILED') {
        return {
          reply: 'Sorry, the agent failed to process your request.',
          conversationId: convId
        };
      }
    }

    return {
      reply: 'Agent is taking too long. Please try again.',
      conversationId: null
    };

  } catch (err) {
    console.error('❌ Agent error:', err.response?.data || err.message);
    return {
      reply: 'Error connecting to Oracle. Please try again later.',
      conversationId: null
    };
  }
}

// ── Send WhatsApp message ─────────────────────────────────
async function sendWhatsApp(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to  : to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          Authorization : `Bearer ${WA_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ WhatsApp message sent to:', to);
  } catch (err) {
    console.error('❌ WhatsApp error:', err.response?.data || err.message);
  }
}

// ── Health check ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Oracle WhatsApp Bridge is running ✅');
});

// ── Webhook verification ──────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Meta verification attempt - token received:', token);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Verification failed');
    res.sendStatus(403);
  }
});

// ── Receive WhatsApp messages ─────────────────────────────
const sessions = {};

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const entry   = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message) return;

    if (message.type !== 'text') {
      await sendWhatsApp(message.from, 'Sorry, I can only process text messages.');
      return;
    }

    const userPhone = message.from;
    const userText  = message.text.body;
    const convId    = sessions[userPhone] || null;

    console.log(`📱 Message from ${userPhone}: ${userText}`);

    await sendWhatsApp(userPhone, '⏳ Processing your request, please wait...');

    const { reply, conversationId } = await callAgent(userText, convId);
    sessions[userPhone] = conversationId;

    await sendWhatsApp(userPhone, reply);

  } catch (err) {
    console.error('❌ Webhook error:', err.message);
  }
});

// ── Start server ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`CLIENT_ID set    : ${!!CLIENT_ID}`);
  console.log(`AGENT_CODE set   : ${!!AGENT_CODE}`);
  console.log(`VERIFY_TOKEN set : ${!!VERIFY_TOKEN}`);
});

app.get('/debug', (req, res) => {
  res.json({
    FUSION_HOST   : process.env.FUSION_HOST   || 'NOT SET',
    AGENT_CODE    : process.env.AGENT_CODE    || 'NOT SET',
    TOKEN_URL     : process.env.TOKEN_URL     || 'NOT SET',
    CLIENT_ID     : process.env.CLIENT_ID     ? 'SET' : 'NOT SET',
    CLIENT_SECRET : process.env.CLIENT_SECRET ? 'SET' : 'NOT SET',
    WA_TOKEN      : process.env.WA_TOKEN      ? 'SET' : 'NOT SET',
    PHONE_ID      : process.env.PHONE_ID      || 'NOT SET',
    VERIFY_TOKEN  : process.env.VERIFY_TOKEN  || 'NOT SET'
  });
});
