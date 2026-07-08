'use strict';

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const FUSION_HOST = (process.env.FUSION_HOST 
  || 'https://elup.fa.em2.oraclecloud.com').replace(/\/$/, '');
const FUSION_USER = process.env.FUSION_USER || '';
const FUSION_PASS = process.env.FUSION_PASS || '';
const TOKEN_URL = process.env.TOKEN_URL 
  || 'https://idcs-1db6ad5580804382953e5ab516205434.identity.oraclecloud.com/oauth2/v1/token';
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
        'Authorization': 'Basic ' + Buffer.from(
          FUSION_USER + ':' + FUSION_PASS
        ).toString('base64')
      }
    });
    cachedToken = res.data.access_token;
    tokenExpiresAt = Date.now() 
      + ((res.data.expires_in || 3600) - 60) * 1000;
    console.log('Token obtained OK');
    return cachedToken;
  } catch (err) {
    console.error('Token error: ' 
      + JSON.stringify(err.response 
        ? err.response.data : err.message));
    throw new Error('Token failed');
  }
}
