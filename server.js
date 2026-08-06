const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const fetch = require('node-fetch');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = parseInt(process.env.PORT || '3002', 10);
const AUTH_DIR = process.env.AUTH_DIR || '/data/auth';
const WA_NUMBER = String(process.env.WA_NUMBER || '').trim(); // wajib 62xxxxxxxxxx
const OTP_VALID_MS = parseInt(process.env.OTP_VALID_MS || String(2 * 60 * 1000), 10);

const otpStore = {}; // { latest: {otp, ts, sender}, "628xx": {otp, ts, sender} }
let isConnected = false;
let isBanned = false;
let latestPairingCode = '';

function normalizePhone(raw) {
  let s = String(raw || '').replace(/\D/g, '');
  if (!s) return '';
  if (s.startsWith('0')) s = '62' + s.slice(1);
  return s;
}

function extractText(msgObj) {
  if (!msgObj) return '';
  return (
    msgObj.conversation ||
    msgObj.extendedTextMessage?.text ||
    msgObj.imageMessage?.caption ||
    msgObj.videoMessage?.caption ||
    msgObj.documentMessage?.caption ||
    msgObj.templateMessage?.hydratedTemplate?.hydratedContentText ||
    msgObj.buttonsResponseMessage?.selectedDisplayText ||
    msgObj.listResponseMessage?.title ||
    msgObj.listResponseMessage?.singleSelectReply?.selectedRowId ||
    msgObj.ephemeralMessage?.message?.conversation ||
    msgObj.ephemeralMessage?.message?.extendedTextMessage?.text ||
    msgObj.viewOnceMessage?.message?.conversation ||
    msgObj.viewOnceMessage?.message?.extendedTextMessage?.text ||
    ''
  ).toString().trim();
}

function extractOtp(text) {
  const src = String(text || '');

  // pola umum CekDPT
  let m = src.match(/angka\s+ini[^0-9]{0,40}(\d{2,6})/i);
  if (m && m[1]) return m[1];

  // pola keyword OTP
  m = src.match(/otp[^0-9]{0,24}(\d{2,6})/i);
  if (m && m[1]) return m[1];

  // fallback generic 2-6 digit, ambil yang terakhir
  const all = src.match(/\b(\d{2,6})\b/g);
  if (all && all.length) return all[all.length - 1];

  return '';
}

function saveOtp(senderJid, otp) {
  const sender = normalizePhone((senderJid || '').split('@')[0] || '');
  const entry = { otp, ts: Date.now(), sender };
  otpStore.latest = entry;
  if (sender) otpStore[sender] = entry;
}

function cleanupExpired() {
  const now = Date.now();
  for (const k of Object.keys(otpStore)) {
    const e = otpStore[k];
    if (!e || now - e.ts > OTP_VALID_MS) delete otpStore[k];
  }
}

// ─── Proxy ke KPU (opsional, tetap dipertahankan) ─────────────────────────────
app.post('/proxy-kpu', async (req, res) => {
  try {
    const body = req.body && req.body.body;
    if (!body) return res.status(400).json({ error: 'no body' });

    const r = await fetch('https://cekdptonline.kpu.go.id/v2', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Content-Type': 'application/json;charset=UTF-8',
        Origin: 'https://cekdptonline.kpu.go.id',
        Referer: 'https://cekdptonline.kpu.go.id/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      body
    });

    const data = await r.json();
    console.log('[PROXY]', JSON.stringify(data).slice(0, 140));
    res.json(data);
  } catch (e) {
    console.error('[PROXY] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Poll OTP ───────────────────────────────────────────────────────────────────
app.get('/get-otp/:hp', (req, res) => {
  cleanupExpired();

  if (isBanned) return res.json({ success: false, reason: 'wa_banned' });
  if (!isConnected) return res.json({ success: false, reason: 'wa_disconnected' });

  const hp = normalizePhone(req.params.hp);
  const entry = otpStore[hp] || otpStore.latest;

  if (entry && Date.now() - entry.ts < OTP_VALID_MS) {
    const otp = entry.otp;
    delete otpStore[hp];
    delete otpStore.latest;
    console.log(`[OTP] Delivered: ${otp} for ${hp || 'latest'}`);
    return res.json({ success: true, otp });
  }

  return res.json({ success: false, reason: 'not_yet' });
});

app.get('/ping', (_, res) => {
  cleanupExpired();
  res.json({
    status: isConnected ? 'connected' : 'disconnected',
    banned: isBanned,
    paired: !latestPairingCode,
    pairingCode: latestPairingCode || '',
    stored: Object.keys(otpStore).length
  });
});

app.listen(PORT, () => {
  console.log(`[SERVER] listening on :${PORT}`);
  console.log(`[CFG] AUTH_DIR=${AUTH_DIR}`);
  console.log(`[CFG] WA_NUMBER=${WA_NUMBER || '(empty)'}`);
});

// ─── Baileys ────────────────────────────────────────────────────────────────────
async function startWA() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    if (!WA_NUMBER) {
      console.error('[PAIR] WA_NUMBER kosong. Set env WA_NUMBER=62xxxxxxxxxx');
    } else {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const code = await sock.requestPairingCode(WA_NUMBER);
        latestPairingCode = (code || '').match(/.{1,4}/g)?.join('-') || String(code || '');
        console.log(`\n=== PAIRING CODE: ${latestPairingCode} ===\n`);
      } catch (e) {
        console.error('[PAIR] Error:', e.message);
      }
    }
  } else {
    latestPairingCode = '';
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      isConnected = true;
      latestPairingCode = '';
      console.log(`[WA] ✅ Connected as ${sock.user?.id || '-'}`);
    }

    if (connection === 'close') {
      isConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('[WA] connection closed, code=', code);

      if (code === DisconnectReason.loggedOut) {
		fs.rmSync(AUTH_DIR, { recursive: true, force: true })
		console.log('[WA] logged out — reset auth, retry...')
		setTimeout(startWA, 5000)
		return
		}

      setTimeout(() => {
        startWA().catch((e) => console.error('[WA] restart error:', e.message));
      }, 5000);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages || []) {
      try {
        if (!msg || msg.key?.fromMe) continue;

        const remoteJid = msg.key?.remoteJid || '';
        const text = extractText(msg.message);

        if (!text) continue;

        console.log(`[MSG] ${remoteJid}: ${text.slice(0, 140)}`);

        const otp = extractOtp(text);
        if (otp) {
          saveOtp(remoteJid, otp);
          console.log(`[OTP] ✅ ${otp} from ${remoteJid}`);
        }
      } catch (e) {
        console.error('[UPSERT] item error:', e.message);
      }
    }
  });
}

startWA().catch((e) => console.error('[WA] fatal:', e.message));