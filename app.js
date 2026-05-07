const express = require('express');
const axios   = require('axios');

const app = express();
app.use(express.json());

// ── Credentials ───────────────────────────────────────────
const FUSION_HOST  = process.env.FUSION_HOST  || 'https://elup-test.fa.em2.oraclecloud.com';
const FUSION_USER  = process.env.FUSION_USER  || '';
const FUSION_PASS  = process.env.FUSION_PASS  || '';
const AGENT_CODE   = process.env.AGENT_CODE   || 'APINVOICETEAM';
const WA_TOKEN     = process.env.WA_TOKEN     || '';
const PHONE_ID     = process.env.PHONE_ID     || '';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mySecret123';

// ── Send WhatsApp ─────────────────────────────────────────
async function sendWhatsApp(to, text) {
  try {
    await axios.post(
      'https://graph.facebook.com/v18.0/' + PHONE_ID + '/messages',
      {
        messaging_product: 'whatsapp',
        to:   to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          'Authorization': 'Bearer ' + WA_TOKEN,
          'Content-Type':  'application/json'
        }
      }
    );
    console.log('WhatsApp sent to ' + to);
  } catch (e) {
    console.error('WhatsApp error: ' + e.message);
  }
}

// ── Get AP Invoices ───────────────────────────────────────
async function getInvoices(filter) {
  try {
    var url = FUSION_HOST + '/fscmRestApi/resources/11.13.18.05/invoices?limit=5';
    if (filter) url = url + '&' + filter;
    console.log('Calling: ' + url);
    var res = await axios.get(url, {
      auth: {
        username: FUSION_USER,
        password: FUSION_PASS
      }
    });
    return res.data.items || [];
  } catch (e) {
    console.error('Fusion error: ' + (e.response ? JSON.stringify(e.response.data) : e.message));
    return null;
  }
}

// ── Format Invoice List ───────────────────────────────────
function formatInvoices(invoices, title) {
  if (!invoices) return 'Error connecting to Oracle. Please try again.';
  if (invoices.length === 0) return 'No invoices found.';
  var reply = title + '\n\n';
  for (var i = 0; i < invoices.length; i++) {
    var inv = invoices[i];
    reply += (i + 1) + '. Invoice #' + inv.InvoiceNumber + '\n';
    reply += '   Supplier: ' + inv.Supplier + '\n';
    reply += '   Amount: ' + inv.InvoiceCurrency + ' ' + inv.InvoiceAmount + '\n';
    reply += '   Date: ' + inv.InvoiceDate + '\n';
    reply += '   Status: ' + inv.ValidationStatus + '\n\n';
  }
  return reply;
}

// ── Health Check ──────────────────────────────────────────
app.get('/', function(req, res) {
  res.send('Oracle WhatsApp Bridge is running OK');
});

// ── Debug ─────────────────────────────────────────────────
app.get('/debug', function(req, res) {
  res.json({
    FUSION_HOST:  FUSION_HOST,
    FUSION_USER:  FUSION_USER  ? 'SET' : 'NOT SET',
    FUSION_PASS:  FUSION_PASS  ? 'SET' : 'NOT SET',
    AGENT_CODE:   AGENT_CODE,
    WA_TOKEN:     WA_TOKEN     ? 'SET' : 'NOT SET',
    PHONE_ID:     PHONE_ID     || 'NOT SET',
    VERIFY_TOKEN: VERIFY_TOKEN ? 'SET' : 'NOT SET'
  });
});

// ── Webhook Verify ────────────────────────────────────────
app.get('/webhook', function(req, res) {
  var mode      = req.query['hub.mode'];
  var token     = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];
  console.log('Webhook verify attempt - token: ' + token);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified OK');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ── Receive WhatsApp Messages ─────────────────────────────
app.post('/webhook', async function(req, res) {
  res.sendStatus(200);
  try {
    var entry   = req.body && req.body.entry && req.body.entry[0];
    var change  = entry && entry.changes && entry.changes[0];
    var value   = change && change.value;
    var message = value && value.messages && value.messages[0];

    if (!message || message.type !== 'text') return;

    var userPhone = message.from;
    var userText  = message.text.body.toLowerCase();
    console.log('Message from ' + userPhone + ': ' + userText);

    await sendWhatsApp(userPhone, 'Processing your request, please wait...');

    var invoices;
    var reply;

    if (userText.includes('pending') || userText.includes('approval')) {
      invoices = await getInvoices('q=ApprovalStatus=Required');
      reply    = formatInvoices(invoices, 'AP Invoices Pending Approval');

    } else if (userText.includes('unpaid') || userText.includes('outstanding')) {
      invoices = await getInvoices('q=PaidStatus=Unpaid');
      reply    = formatInvoices(invoices, 'Unpaid AP Invoices');

    } else if (userText.includes('cancel')) {
      invoices = await getInvoices('q=ValidationStatus=Canceled');
      reply    = formatInvoices(invoices, 'Canceled AP Invoices');

    } else {
      invoices = await getInvoices('');
      reply    = formatInvoices(invoices, 'Latest AP Invoices');
      reply   += 'You can ask:\n';
      reply   += '- Show pending approval invoices\n';
      reply   += '- Show unpaid invoices\n';
      reply   += '- Show canceled invoices\n';
      reply   += '- Show latest invoices\n';
    }

    await sendWhatsApp(userPhone, reply);

  } catch (e) {
    console.error('Webhook error: ' + e.message);
  }
});

// ── Start ─────────────────────────────────────────────────
var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
  console.log('FUSION_HOST  : ' + FUSION_HOST);
  console.log('FUSION_USER  : ' + (FUSION_USER ? 'SET' : 'NOT SET'));
  console.log('WA_TOKEN     : ' + (WA_TOKEN    ? 'SET' : 'NOT SET'));
  console.log('PHONE_ID     : ' + PHONE_ID);
});
