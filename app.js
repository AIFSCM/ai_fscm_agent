'use strict';

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const FUSION_HOST = (process.env.FUSION_HOST || 'https://elup.fa.em2.oraclecloud.com').replace(/\/$/, '');
const FUSION_USER = process.env.FUSION_USER || '';
const FUSION_PASS = process.env.FUSION_PASS || '';
const TOKEN_URL = process.env.TOKEN_URL || 'https://idcs-1db6ad5580804382953e5ab516205434.identity.oraclecloud.com/oauth2/v1/token';
const AGENT_CODE = process.env.AGENT_CODE || 'AR_COLLECTIONS_ASSISTANT';
const WA_TOKEN = process.env.WA_TOKEN || '';
const PHONE_ID = process.env.PHONE_ID || '1124786120717706';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mySecret123';

let cachedToken = null;
let tokenExpiresAt = 0;
const sessions = {};

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
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(FUSION_USER + ':' + FUSION_PASS).toString('base64')
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

async function callOracleAgent(userMessage, conversationId) {
  try {
    var token = await getOAuthToken();
    var body = { message: userMessage };
    if (conversationId) {
      body.conversationId = conversationId;
    }
    var invokeURL = FUSION_HOST + '/api/fusion-ai/orchestrator/agent/v2/' + AGENT_CODE + '/invokeAsync';
    console.log('Calling invokeAsync: ' + invokeURL);
    var invokeRes = await axios.post(invokeURL, body, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    });
    var jobId = invokeRes.data.jobId;
    var convId = invokeRes.data.conversationId;
    console.log('Job ID: ' + jobId);
    var statusURL = FUSION_HOST + '/api/fusion-ai/orchestrator/agent/v2/' + AGENT_CODE + '/status/' + jobId;
    console.log('Status URL: ' + statusURL);
    for (var i = 0; i < 20; i++) {
      await new Promise(function(r) { setTimeout(r, 2000); });
      var statusRes = await axios.get(statusURL, {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      var status = statusRes.data.status;
      console.log('Poll ' + (i + 1) + ' status: ' + status);
      if (status === 'COMPLETE') {
        console.log('Full response: ' + JSON.stringify(statusRes.data));
        var reply = '';
        if (statusRes.data.output) {
          reply = statusRes.data.output;
        } else if (statusRes.data.message) {
          reply = statusRes.data.message;
        } else {
          reply = 'Request completed but no response text found.';
        }
        console.log('Agent reply: ' + reply);
        return { reply: reply, conversationId: convId };
      }
      if (status === 'FAILED' || status === 'ERROR') {
        console.error('Agent failed: ' + JSON.stringify(statusRes.data));
        return { reply: 'Sorry, the agent failed to process your request.', conversationId: convId };
      }
    }
    return { reply: 'Agent is taking too long. Please try again.', conversationId: null };
  } catch (err) {
    console.error('Agent error: ' + JSON.stringify(err.response ? err.response.data : err.message));
    return callDirectAPI(userMessage);
  }
}

async function callDirectAPI(userMessage) {
  try {
    console.log('Falling back to direct API for: ' + userMessage);
    return {
      reply: 'I am your AR Collections Assistant. You can ask me:\n\n' +
             '- Outstanding balance for a customer\n' +
             '- Aging analysis for a customer\n' +
             '- Aging report by business unit\n' +
             '- Customer aging summary\n\n' +
             'Please provide a customer name or account number to get started.',
      conversationId: null
    };
  } catch (err) {
    console.error('Direct API error: ' + err.message);
    return {
      reply: 'Sorry, I am unable to process your request right now. Please try again.',
      conversationId: null
    };
  }
}

async function sendWhatsApp(to, text) {
  try {
    var waUrl = 'https://graph.facebook.com/v18.0/' + PHONE_ID + '/messages';
    console.log('WhatsApp URL: ' + waUrl);
    console.log('Sending to: ' + to);
    await axios.post(waUrl, {
      messaging_product: 'whatsapp',
      to: to,
      type: 'text',
      text: { body: text }
    }, {
      headers: {
        'Authorization': 'Bearer ' + WA_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    console.log('WhatsApp sent to: ' + to);
  } catch (e) {
    console.error('WhatsApp error: ' + e.message);
    console.error('WhatsApp details: ' + JSON.stringify(e.response ? e.response.data : 'no response'));
  }
}

app.get('/', function(req, res) {
  res.send('Oracle AR Collections AI Agent WhatsApp Bridge is running OK');
});

app.get('/debug', function(req, res) {
  res.json({
    FUSION_HOST: FUSION_HOST,
    AGENT_CODE: AGENT_CODE,
    TOKEN_URL: TOKEN_URL,
    FUSION_USER: FUSION_USER ? 'SET' : 'NOT SET',
    FUSION_PASS: FUSION_PASS ? 'SET' : 'NOT SET',
    WA_TOKEN: WA_TOKEN ? 'SET' : 'NOT SET',
    PHONE_ID: PHONE_ID,
    VERIFY_TOKEN: VERIFY_TOKEN ? 'SET' : 'NOT SET'
  });
});

app.get('/webhook', function(req, res) {
  var mode = req.query['hub.mode'];
  var token = req.query['hub.verify_token'];
  var challenge = req.query['hub.challenge'];
  console.log('Webhook verify token: ' + token);
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verified OK');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async function(req, res) {
  res.sendStatus(200);
  try {
    var entry = req.body && req.body.entry && req.body.entry[0];
    var change = entry && entry.changes && entry.changes[0];
    var value = change && change.value;
    var message = value && value.messages && value.messages[0];
    if (!message || message.type !== 'text') return;
    var userPhone = message.from;
    var userText = message.text.body;
    var convId = sessions[userPhone] || null;
    console.log('Message from ' + userPhone + ': ' + userText);
    await sendWhatsApp(userPhone, 'Processing your request, please wait...');
    var result = await callOracleAgent(userText, convId);
    sessions[userPhone] = result.conversationId;
    await sendWhatsApp(userPhone, result.reply);
  } catch (e) {
    console.error('Webhook error: ' + e.message);
  }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
  console.log('FUSION_HOST: ' + FUSION_HOST);
  console.log('AGENT_CODE: ' + AGENT_CODE);
  console.log('FUSION_USER: ' + (FUSION_USER ? 'SET' : 'NOT SET'));
  console.log('WA_TOKEN set: ' + !!WA_TOKEN);
  console.log('PHONE_ID: ' + PHONE_ID);
});
