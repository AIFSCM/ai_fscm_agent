const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

// ── Credentials ───────────────────────────────────────────
const FUSION_HOST  = process.env.FUSION_HOST  || 'https://elup-test.fa.em2.oraclecloud.com';
const FUSION_USER  = process.env.FUSION_USER;
const FUSION_PASS  = process.env.FUSION_PASS;
const AGENT_CODE   = process.env.AGENT_CODE   || 'APINVOICETEAM';
const WA_TOKEN     = process.env.WA_TOKEN;
const PHONE_ID     = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mySecret123';

// ── Basic Auth header ─────────────────────────────────────
function getBasicAuth() {
  const credentials = Buffer.from(`${FUSION_USER}:${FUSION_PASS}`).toString('base64');
  return `Basic ${credentials}`;
}

// ── Call Oracle AI Agent ──────────────────────────────────
async function callAgent(userMessage, conversationId) {
  try {
    const body = {
      message: {
        content: [{ type: 'text', text: userMessage }]
      }
    };
    if (conversationId) {
      body.conversationId = conversationId;
    }

    const invokeURL = `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync`;
    console.log('Calling:', invokeURL);

    const invokeRes = await axios.post(invokeURL, body, {
      headers: {
        'Authorization' : getBasicAuth(),
        'Content-Type'  : 'application/json'
      }
    });

    const jobId  = invokeRes.data.jobId;
    const convId = invokeRes.data.conversationId;
    console.log('Job ID received:', jobId);

    // Poll for result every 2 seconds
    const statusURL = `${FUSION_HOST}/api/fusion-ai/orchestrator/agent/v2/${AGENT_CODE}/invokeAsync/${jobId}`;

    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const statusRes = await axios.get(statusURL, {
        headers: { 'Authorization': getBasicAuth() }
      });

      const status = statusRes.data.status;
      console.log(`Poll ${i + 1} status: ${status}`);

      if (status === 'COMPLETED') {
        const reply =
          statusRes.data?.message?.content?.[0]?.text ||
          statusRes.data?.output?.content?.[0]?.text  ||
          'Request completed but no response text found.';
        console.log('Agent reply:', reply);
        return { reply, conversationId: convId };
      }

      if (status === 'FAILED') {
        console.error('Agent failed:', JSON.stringify(statusRes.data));
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
    console.error('WhatsApp error:', JSON.stringify(err.response?.data || err.message));
  }
}

// ── Health check ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Oracle WhatsApp Bridge is running OK');
});

// ── Debug route ───────────────────────────────────────────
app.get('/debug', (req, res) => {
  res.json({
    FUSION_HOST  : FUSION_HOST,
    AGENT_CODE   : AGENT_CODE,
    FUSION_USER  : FUSION_USER  ? 'SET' : 'NOT SET',
    FUSION_PASS  : FUSION_PASS  ? 'SET' : 'NOT SET',
    WA_TOKEN     : WA_TOKEN     ? 'SET' : 'NOT SET',
    PHONE_ID     : PHONE_ID     || 'NOT SET',
    VERIFY_TOKEN : VERIFY_TOKEN ? 'SET' : 'NOT SET'
  });
});

// ── Webhook verification ──────────────────────────────────
app.get('/webhook', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('Webhook verification, token received:', token);

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    console.log('Webhook verification failed');
    res.sendStatus(403);
  }
});

// ── Conversation sessions ─────────────────────────────────
const sessions = {};

// ── Receive WhatsApp messages ─────────────────────────────
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

    console.log(`Message from ${userPhone}: ${userText}`);
    await sendWhatsApp(userPhone, 'Processing your request, please wait...');

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
  console.log(`Server running on port ${PORT}`);
  console.log(`FUSION_HOST  : ${FUSION_HOST}`);
  console.log(`AGENT_CODE   : ${AGENT_CODE}`);
  console.log(`FUSION_USER  : ${FUSION_USER ? 'SET' : 'NOT SET'}`);
  console.log(`WA_TOKEN set : ${!!WA_TOKEN}`);
  console.log(`PHONE_ID     : ${PHONE_ID}`);
});
