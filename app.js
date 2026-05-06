const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// ── Credentials from environment variables ────────────────
const FUSION_HOST  = 'https://elup-test.fa.em2.oraclecloud.com';
const FUSION_USER  = process.env.FUSION_USER;
const FUSION_PASS  = process.env.FUSION_PASS;
const AGENT_CODE   = process.env.AGENT_CODE;
const WA_TOKEN     = process.env.WA_TOKEN;
const PHONE_ID     = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Basic Auth header for Oracle Fusion
const basicAuth = () =>
  'Basic ' + Buffer.from(`${FUSION_USER}:${FUSION_PASS}`).toString('base64');

// ── Root route (health check) ─────────────────────────────
app.get('/', (req, res) => {
  res.send('Oracle WhatsApp Bridge is running ✅');
});

// ── Webhook verification (Meta requirement) ───────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Meta verification request received');
  console.log('Mode:', mode);
  console.log('Token received:', token);
  console.log('Token expected:', VERIFY_TOKEN);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('❌ Verification failed - token mismatch');
    res.sendStatus(403);
  }
});

// ── Call Oracle AI Agent ──────────────────────────────────
async function callAgent(userMessage, conversationId = null) {
  try {
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
          Authorization: basicAuth(),
          'Content-Type': 'application/json'
        }
      }
    );

    const jobId  = invokeRes.data.jobId;
    const convId = invokeRes.data.conversationId;
    console.log('Job ID:', jobId);

    // Poll for result every 2 seconds max 15 times (30 seconds)
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const statusRes = await axios.get(
        `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync/${jobId}`,
        { headers: { Authorization: basicAuth() } }
      );

      console.log(`Poll ${i + 1} status:`, statusRes.data.status);

      if (statusRes.data.status === 'COMPLETED') {
        const reply =
          statusRes.data?.message?.content?.[0]?.text ||
          statusRes.data?.output?.content?.[0]?.text ||
          'I received your message but got an empty response.';
        return { reply, conversationId: convId };
      }

      if (statusRes.data.status === 'FAILED') {
        return { reply: 'Sorry, the agent failed to process your request.', conversationId: convId };
      }
    }

    return { reply: 'Agent is taking too long. Please try again.', conversationId: null };

  } catch (err) {
    console.error('Agent error:', err.response?.data || err.message);
    return { reply: 'Error connecting to Oracle. Please try again.', conversationId: null };
  }
}

// ── Send WhatsApp message ─────────────────────────────────
async function sendWhatsApp(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${WA_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('✅ WhatsApp message sent to:', to);
  } catch (err) {
    console.error('WhatsApp send error:', err.response?.data || err.message);
  }
}

// ── Main webhook: receive WhatsApp message ────────────────
const sessions = {};

app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // always respond to Meta immediately

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

    // Send thinking message so user knows it is working
    await sendWhatsApp(userPhone, '⏳ Processing your request, please wait...');

    const { reply, conversationId } = await callAgent(userText, convId);
    sessions[userPhone] = conversationId;

    await sendWhatsApp(userPhone, reply);

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ── Start server ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`VERIFY_TOKEN set: ${!!VERIFY_TOKEN}`);
  console.log(`FUSION_USER set: ${!!FUSION_USER}`);
  console.log(`AGENT_CODE set: ${!!AGENT_CODE}`);
});
