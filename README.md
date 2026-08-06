# **CekDPT Auto OTP (Baileys + Railway)**
Auto OTP CekDPT menggunakan WhatsApp via **Baileys**, deploy di **Railway**.  
Untuk mode Advanced di UI CekDPT.

---

## **Fitur**

- Pair WhatsApp dengan nomor HP (pairing code)
- Endpoint health check: `/ping`
- Endpoint ambil OTP: `/get-otp/{hp62}`
- OTP valid 2 menit (default), support 2–6 digit

---

## **1) Deploy ke Railway (dari GitHub)**

1. Login ke Railway
2. Klik **New Project**
3. Pilih **Deploy from GitHub repo**
4. Pilih repo `cekdpt-auto`
5. Tunggu build + start selesai

---

## **2) Set Variables (wajib)**

Masuk ke service Railway kamu → tab **Variables**:

- `WA_NUMBER` = `628xxxxxxxxxx`  
  (nomor WhatsApp yang akan dipair)
- `AUTH_DIR` = `/data/auth`
- `OTP_VALID_MS` = `120000` (opsional, default 2 menit)

> Gunakan `PORT` default Railway (8080).

---

## **3) Set Volume (penting)**

Agar sesi WhatsApp tidak hilang saat redeploy:

1. Buka service → **Volumes**
2. Add Volume
3. Mount Path: `/data`

---

## **4) Set Network Domain**

1. Buka service → **Settings / Networking**
2. Klik **Generate Domain** (jika belum ada)
3. Dapat domain contoh:  
   `https://cekdpt-auto-production.up.railway.app`

Input **API Base URL** di popup cekdptonline.

## **5) Pair WhatsApp**

Cek endpoint:
```bash
GET https://<domain-railway>/ping
```
Contoh response:
```{
  "status": "disconnected",
  "paired": false,
  "pairingCode": "ABCD-EFGH",
  "stored": 0
}
```

Masukkan pairing code di WhatsApp:
<li>WhatsApp > Linked Devices > Link with phone number</li>
<li>Setelah sukses pair, /ping:</li>
{
  "status": "connected",
  "paired": true
}

## **6) Integrasi ke UI CekDPT**
Di popup CekDPT (Mode Advance), isi:

BAILEYS API BASE URL
```https://<domain-railway>```

Klik:
1. Simpan Pengaturan
2. Test Read
3. Start

UI akan polling endpoint:
```/ping```
```/get-otp/{hp62}```

## 7) **Troubleshooting**
> Webhook fetch gagal: Failed to fetch
<li>Pastikan domain Railway aktif</li>
<li>Pastikan extension sudah reload setelah update manifest/permission</li>
<li>Cek /ping bisa diakses dari browser</li>


> /ping status disconnected:
<li>Pairing belum sukses / session putus</li>
<li>Ambil pairing code terbaru dari /ping lalu pair ulang</li>


>Pairing sering hilang setelah redeploy
<li>Pastikan volume /data sudah terpasang</li>
<li>AUTH_DIR harus /data/auth</li>


> OTP tidak ditemukan:
<li>Pastikan pesan OTP benar-benar masuk ke nomor WA yang dipair</li>
<li>Cek log server, harus ada [OTP] ✅ ...</li>

## **8) Screenshot**
![Setup Railway](docs/img/setup-railway.png)

![Pairing WhatsApp](docs/img/pairing.gif)

## **9) Endpoint Ringkas**
```GET /ping → status koneksi WA + pairing code```
```GET /get-otp/:hp → ambil OTP untuk nomor hp (format 62xxxx)```


## **License**
Internal / private use.
