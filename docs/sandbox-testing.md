# PayPal Sandbox Testing Guide & Verification Walkthrough

This document outlines the step-by-step procedures for testing NetraBox against the live PayPal Developer Sandbox rails.

---

## 1. Prerequisites & Credentials

1. Go to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox).
2. Create or select a **REST API app** with Sandbox mode enabled.
3. Note your:
   - `Client ID`
   - `Secret Key`
4. In the **Sandbox Accounts** tab, ensure you have:
   - One **Personal (Buyer)** account with mock USD balance.
   - One **Business (Merchant)** account.
5. Create a Webhook pointing to your local tunnel (e.g., ngrok/cloudflared) or Render URL:
   - Webhook URL: `https://<your-host>/api/v1/webhooks/paypal`
   - Subscribed Events:
     - `PAYMENT.AUTHORIZATION.CREATED`
     - `PAYMENT.AUTHORIZATION.VOIDED`
     - `PAYMENT.CAPTURE.COMPLETED`
     - `PAYMENT.CAPTURE.REFUNDED`
     - `CHECKOUT.ORDER.APPROVED`
     - `CUSTOMER.DISPUTE.CREATED`
   - Copy the generated `Webhook ID` to `PAYPAL_WEBHOOK_ID` in `.env`.

---

## 2. Environment Setup

Create `.env` in the repository root:

```env
PORT=4000
PUBLIC_BASE_URL=http://localhost:4000
DASHBOARD_URL=http://localhost:3000
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=your_real_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_real_sandbox_client_secret
PAYPAL_WEBHOOK_ID=your_real_webhook_id
SIGNING_PRIVATE_KEY=your_generated_ed25519_private_key
DATABASE_URL=postgresql://netrabox:netrabox_dev_password@localhost:5432/netrabox
```

---

## 3. Running the Live Sandbox Integration Script

Run the automated sandbox API tester:

```bash
pnpm tsx scripts/paypal-sandbox-integration.ts
```

This verifies:

- OAuth2 token fetch with basic auth
- Orders v2 creation with `intent: "AUTHORIZE"`
- `PayPal-Request-Id` idempotency header generation
- Currency minor unit translation to PayPal decimal values

---

## 4. Manual Buyer Approval Flow (End-to-End)

### Step 1: Create a Purchase

```bash
curl -X POST http://localhost:4000/api/v1/purchases \
  -H "Content-Type: application/json" \
  -d '{
    "buyerId": "user_buyer_01",
    "agentId": "agent_shopper_01",
    "merchantId": "merchant_tech_01",
    "title": "Sony WH-1000XM5 Headphones",
    "amountMinor": 34999,
    "currency": "USD"
  }'
```

_Note the returned `id` (e.g., `pur_01J9...`)._

### Step 2: Propose Cart

```bash
curl -X POST http://localhost:4000/api/v1/purchases/pur_01J9.../cart \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"sku": "SNY-XM5", "name": "Sony XM5", "priceMinor": 34999, "quantity": 1}],
    "merchantQuoteId": "quote_123"
  }'
```

### Step 3: Authorize Order (Get Approval URL)

```bash
curl -X POST http://localhost:4000/api/v1/purchases/pur_01J9.../authorize
```

Response:

```json
{
  "paypalOrderId": "5O190127TN364715T",
  "approvalUrl": "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T"
}
```

### Step 4: Complete Sandbox Approval in Browser

1. Copy the `approvalUrl` and open it in a browser.
2. Sign in with your Sandbox **Personal Buyer** credentials.
3. Click **Continue** to approve the order.
4. PayPal redirects to `http://localhost:4000/api/v1/purchases/pur_01J9.../return?token=...`.
5. NetraBox calls `authorizeOrder`, generates the `PAYPAL_AUTHORIZED` evidence event, and transitions the state machine to `AUTHORIZED`.

### Step 5: Capture Payment (Full or Partial)

```bash
# Full Capture:
curl -X POST http://localhost:4000/api/v1/purchases/pur_01J9.../capture \
  -H "Content-Type: application/json" \
  -d '{"finalCapture": true}'

# Partial Capture ($200.00 of $349.99):
curl -X POST http://localhost:4000/api/v1/purchases/pur_01J9.../capture \
  -H "Content-Type: application/json" \
  -d '{"amountMinor": 20000, "finalCapture": true}'
```

### Step 6: Refund Payment

```bash
# Partial Refund ($50.00):
curl -X POST http://localhost:4000/api/v1/purchases/pur_01J9.../refund \
  -H "Content-Type: application/json" \
  -d '{"amountMinor": 5000, "note": "Defective cable adjustment"}'
```

---

## 5. Webhook Signature Verification Testing

Simulate a PayPal webhook with signature headers:

```bash
curl -X POST http://localhost:4000/api/v1/webhooks/paypal \
  -H "Content-Type: application/json" \
  -H "paypal-auth-algo: SHA256withRSA" \
  -H "paypal-cert-url: https://api.sandbox.paypal.com/v1/notifications/certs/CERT-..." \
  -H "paypal-transmission-id: trans_12345" \
  -H "paypal-transmission-sig: sig_abc123" \
  -H "paypal-transmission-time: 2026-11-04T12:00:00Z" \
  -d '{
    "id": "WH-998811",
    "event_type": "PAYMENT.CAPTURE.COMPLETED",
    "resource": {
      "id": "cap_88123",
      "custom_id": "pur_01J9..."
    }
  }'
```

NetraBox verifies the signature with PayPal's endpoint, updates the state machine, records an immutable evidence event, and acknowledges with HTTP 200. Duplicate calls with the same event ID are acknowledged and ignored.
