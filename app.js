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

// ── Get OAuth Token (Resource Owner Grant) ────────────────
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
   params.append('scope', 'urn:opc:idm:__myscopes__');

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

    // Poll for result
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
        console.error('Agent failed:', JSON.stringify(statusRes.data));
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
    // Fallback to direct REST API if agent fails
    return await callDirectAPI(userMessage);
  }
}

// ── Fallback — Direct Oracle REST API ────────────────────
async function callDirectAPI(userMessage) {
  try {
    const msg = userMessage.toLowerCase();
    let queryParams = '';
    let title = 'Latest AP Invoices';

    if (msg.includes('pending') || msg.includes('approval')) {
      queryParams = 'q=ApprovalStatus=Required';
      title = 'AP Invoices Pending Approval';
    } else if (msg.includes('unpaid') || msg.includes('outstanding')) {
      queryParams = 'q=PaidStatus=Unpaid';
      title = 'Unpaid AP Invoices';
    } else if (msg.includes('cancel')) {
      queryParams = 'q=ValidationStatus=Canceled';
      title = 'Canceled AP Invoices';
    } else if (msg.includes('paid')) {
      queryParams = 'q=PaidStatus=Paid';
      title = 'Paid AP Invoices';
    }

    var url = `${FUSION_HOST}/fscmRestApi/resources/11.13.18.05/invoices?limit=5`;
    if (queryParams) url = url + '&' + queryParams;

    const res = await axios.get(url, {
      auth: { username: FUSION_USER, password: FUSION_PASS }
    });

    const invoices = res.data.items || [];
    if (invoices.length === 0) {
      return { reply: 'No invoices found.', conversationId: null };
    }

    let reply = title + '\n\n';
    invoices.forEach((inv, i) => {
      reply += `${i + 1}. Invoice #${inv.InvoiceNumber}\n`;
      reply += `   Supplier: ${inv.Supplier}\n`;
      reply += `   Amount: ${inv.InvoiceCurrency} ${inv.InvoiceAmount}\n`;
      reply += `   Date: ${inv.InvoiceDate}\n`;
      reply += `   Status: ${inv.ValidationStatus}\n\n`;
    });

    reply += 'You can ask:\n';
    reply += '- Show pending approval invoices\n';
    reply += '- Show unpaid invoices\n';
    reply += '- Show latest invoices\n';

    return { reply, conversationId: null };

  } catch (err) {
    console.error('Direct API error:', err.message);
    return {
      reply:          'Error connecting to Oracle. Please try again.',
      conversationId: null
    };
  }
}

// ── Send WhatsApp ─────────────────────────────────────────
async function sendWhatsApp(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to:   to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          'Authorization': `Bearer ${WA_TOKEN}`,
          'Content-Type':  'application/json'
        }
      }
    );
    console.log('WhatsApp sent to:', to);
  } catch (e) {
    console.error('WhatsApp error:', e.message);
  }
}

// ── Health Check ──────────────────────────────────────────
app.get('/', function(req, res) {
  res.send('Oracle AI Agent WhatsApp Bridge is running OK');
});

// ── Debug ─────────────────────────────────────────────────
app.get('/debug', function(req, res) {
  res.json({
    FUSION_HOST:   FUSION_HOST,
    AGENT_CODE:    AGENT_CODE,
    TOKEN_URL:     TOKEN_URL,
    CLIENT_ID:     CLIENT_ID     ? 'SET' : 'NOT SET',
    CLIENT_SECRET: CLIENT_SECRET ? 'SET' : 'NOT SET',
    FUSION_USER:   FUSION_USER   ? 'SET' : 'NOT SET',
    FUSION_PASS:   FUSION_PASS   ? 'SET' : 'NOT SET',
    WA_TOKEN:      WA_TOKEN      ? 'SET' : 'NOT SET',
    PHONE_ID:      PHONE_ID      || 'NOT SET',
    VERIFY_TOKEN:  VERIFY_TOKEN  ? 'SET' : 'NOT SET'
  });
});

// ── Webhook Verify ────────────────────────────────────────
app.get('/webhook', function(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  console.log('Webhook verify - token:', token);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified OK');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── Sessions ──────────────────────────────────────────────
const sessions = {};

// ── Receive WhatsApp Messages ─────────────────────────────
app.post('/webhook', async function(req, res) {
  res.sendStatus(200);
  try {
    const entry   = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = entry?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const userPhone = message.from;
    const userText  = message.text.body;
    const convId    = sessions[userPhone] || null;
    console.log(`Message from ${userPhone}: ${userText}`);

    await sendWhatsApp(userPhone, 'Processing your request, please wait...');

    const { reply, conversationId } = await callOracleAgent(userText, convId);
    sessions[userPhone] = conversationId;

    await sendWhatsApp(userPhone, reply);

  } catch (e) {
    console.error('Webhook error:', e.message);
  }
});

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log(`Server running on port ${PORT}`);
  console.log(`FUSION_HOST   : ${FUSION_HOST}`);
  console.log(`AGENT_CODE    : ${AGENT_CODE}`);
  console.log(`CLIENT_ID set : ${!!CLIENT_ID}`);
  console.log(`FUSION_USER   : ${FUSION_USER ? 'SET' : 'NOT SET'}`);
  console.log(`WA_TOKEN set  : ${!!WA_TOKEN}`);
});
