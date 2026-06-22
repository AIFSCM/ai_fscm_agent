'use strict';

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const FUSION_HOST = process.env.FUSION_HOST || 'https://elup-test.fa.em2.oraclecloud.com';
const FUSION_USER = process.env.FUSION_USER || '';
const FUSION_PASS = process.env.FUSION_PASS || '';
const CLIENT_ID = process.env.CLIENT_ID || '';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const TOKEN_URL = process.env.TOKEN_URL || 'https://idcs-1db6ad5580804382953e5ab516205434.identity.oraclecloud.com/oauth2/v1/token';
const AGENT_CODE = process.env.AGENT_CODE || 'AR_COLLECTIONS_ASSISTANT';
const WA_TOKEN = process.env.WA_TOKEN || '';
const PHONE_ID = process.env.PHONE_ID || '1086132367916692';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mySecret123';

// ⚠️ In-memory session (works only single instance)
// For production upgrade → Redis recommended
const sessions = {};

let cachedToken = null;
let tokenExpiresAt = 0;

/* =========================
   AUTH TOKEN
========================= */
async function getOAuthToken() {
  try {
    if (cachedToken && Date.now() < tokenExpiresAt) {
      return cachedToken;
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('username', FUSION_USER);
    params.append('password', FUSION_PASS);
    params.append('scope', `urn:opc:resource:fusion:${FUSION_HOST.split('//')[1].split('.')[0]}:fusion-ai/`);

    const res = await axios.post(TOKEN_URL, params.toString(), {
      auth: { username: CLIENT_ID, password: CLIENT_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    cachedToken = res.data.access_token;
    tokenExpiresAt = Date.now() + ((res.data.expires_in || 3600) - 60) * 1000;

    return cachedToken;
  } catch (err) {
    console.error('Token error:', err.response?.data || err.message);
    throw new Error('Token failed');
  }
}

/* =========================
   ORACLE AGENT CALL
========================= */
async function callOracleAgent(userMessage, conversationId) {
  try {
    const token = await getOAuthToken();

    const body = {
      message: userMessage,
      ...(conversationId ? { conversationId } : {})
    };

    const invokeURL = `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync`;

    const invokeRes = await axios.post(invokeURL, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const jobId = invokeRes.data.jobId;
    let convId = invokeRes.data.conversationId || conversationId || null;

    const statusURL = `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/status/${jobId}`;

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const statusRes = await axios.get(statusURL, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const status = statusRes.data.status;

      if (status === 'COMPLETE') {

        let reply =
          statusRes.data.output ||
          statusRes.data.message ||
          'Request completed but no response found';

        // 🔥 CRITICAL FIX: ALWAYS extract latest conversationId
        const finalConvId =
          statusRes.data.conversationId ||
          convId ||
          conversationId ||
          null;

        return {
          reply,
          conversationId: finalConvId
        };
      }

      if (status === 'FAILED' || status === 'ERROR') {
        return {
          reply: 'Agent failed to process request.',
          conversationId: convId
        };
      }
    }

    return {
      reply: 'Agent timeout. Please try again.',
      conversationId: conversationId || null
    };

  } catch (err) {
    console.error('Agent error:', err.response?.data || err.message);
    return {
      reply: 'Error calling Oracle Agent.',
      conversationId: conversationId || null
    };
  }
}

/* =========================
   WHATSAPP SEND
========================= */
async function sendWhatsApp(to, text) {
  try {
    const url = `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`;

    await axios.post(url, {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    }, {
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

  } catch (err) {
    console.error('WhatsApp error:', err.response?.data || err.message);
  }
}

/* =========================
   WEBHOOK
========================= */
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message || message.type !== 'text') return;

    const userPhone = message.from;
    const userText = message.text.body;

    // 🔥 GET SESSION
    let convId = sessions[userPhone] || null;

    console.log('User:', userPhone, 'Message:', userText);
    console.log('Conversation ID used:', convId);

    await sendWhatsApp(userPhone, 'Processing your request...');

    const result = await callOracleAgent(userText, convId);

    // 🔥 CRITICAL FIX: persist ONLY if valid
    if (result.conversationId) {
      sessions[userPhone] = result.conversationId;
    }

    await sendWhatsApp(userPhone, result.reply);

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

/* =========================
   VERIFY WEBHOOK
========================= */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

/* =========================
   HEALTH CHECK
========================= */
app.get('/', (req, res) => {
  res.send('Oracle WhatsApp Agent Running');
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Server running on port', PORT);
});
