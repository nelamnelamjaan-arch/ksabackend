# KSA Store — unified environment template

Copy values into **repo root `.env`** (Vite + server load via `loadRootEnv.js`) and/or **`server/.env`** for server-only overrides.

**Never commit real secrets.** Use placeholders like `YOUR_PAYPAL_CLIENT_ID`.

---

## Core / runtime

```env
NODE_ENV=production
PORT=5000
VERCEL_ENV=production
```

---

## MongoDB

```env
MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/ksa-store
```

---

## JWT & admin (Kiran)

```env
JWT_SECRET=YOUR_LONG_RANDOM_JWT_SECRET
ADMIN_USERNAME=YOUR_ADMIN_USERNAME
ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD
KIRAN_ADMIN_PASSWORD=YOUR_KIRAN_PASSWORD
ADMIN_DASHBOARD_URL=https://YOUR_CLIENT_HOST/admin
```

---

## CORS & public URLs

```env
CLIENT_ORIGIN=https://YOUR_CLIENT_HOST,http://localhost:5173
PUBLIC_SITE_URL=https://YOUR_CLIENT_HOST
# Client (Vite)
VITE_PUBLIC_SITE_URL=https://YOUR_CLIENT_HOST
VITE_API_URL=https://YOUR_API_HOST
```

---

## PayPal (live checkout)

Production forces **live** API (`paypalConfig.js`); set live credentials only in deployment secrets.

```env
PAYPAL_CLIENT_ID=YOUR_PAYPAL_LIVE_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_PAYPAL_LIVE_CLIENT_SECRET
# PAYPAL_SECRET_KEY=YOUR_PAYPAL_LIVE_CLIENT_SECRET
PAYPAL_MODE=live
PAYPAL_CHECKOUT_CURRENCY=USD
PAYPAL_DEFAULT_AMOUNT=100.00
PAYPAL_PROFIT_RECEIVER_EMAIL=YOUR_PAYPAL_BUSINESS_EMAIL
# PAYPAL_PAYOUT_EMAIL=YOUR_PAYPAL_BUSINESS_EMAIL
PAYPAL_PAYOUTS_ENABLED=true
PAYPAL_WEBHOOK_ID=YOUR_PAYPAL_WEBHOOK_ID
# PAYPAL_WEBHOOK_SKIP_VERIFY=true
VITE_PAYPAL_CLIENT_ID=YOUR_PAYPAL_LIVE_CLIENT_ID
VITE_PAYPAL_MODE=live
```

---

## Stripe (optional)

```env
STRIPE_SECRET_KEY=sk_live_YOUR_STRIPE_SECRET
STRIPE_PUBLISHABLE_KEY=pk_live_YOUR_STRIPE_PUBLISHABLE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_STRIPE_WEBHOOK_SECRET
```

---

## Supplier automation (Puppeteer fulfillment)

**Risks:** `SUPPLIER_AUTO_PAY=true` submits real payment on supplier sites. Amazon/Noon may show **CAPTCHA/OTP**; automation stops and alerts admin. DOM selectors break when sites change. May violate supplier ToS — use at your own risk.

```env
ENABLE_AUTOMATED_FULFILLMENT=false
SUPPLIER_AMAZON_EMAIL=YOUR_SUPPLIER_AMAZON_EMAIL
SUPPLIER_AMAZON_PASSWORD=YOUR_SUPPLIER_AMAZON_PASSWORD
SUPPLIER_NOON_EMAIL=YOUR_SUPPLIER_NOON_EMAIL
SUPPLIER_NOON_PASSWORD=YOUR_SUPPLIER_NOON_PASSWORD
# SUPPLIER_AUTO_PAY=false
# FULFILLMENT_ALERT_EMAIL=ops@yourdomain.com
# AMAZON_SESSION_COOKIES=
# NOON_SESSION_COOKIES=
# Legacy aliases (optional):
# AMAZON_BUYER_EMAIL=
# AMAZON_BUYER_PASSWORD=
# NOON_BUYER_EMAIL=
# NOON_BUYER_PASSWORD=
# AMAZON_AUTO_SUBMIT_PAYMENT=false
# NOON_AUTO_SUBMIT_PAYMENT=false
ENABLE_SOURCE_BUY_ASSIST=false
BANK_DETAILS_PK=YOUR_PK_BANK_DETAILS
BANK_DETAILS_SA=YOUR_SA_BANK_DETAILS
```


## Go-live (real catalogue only)

```env
# Skip DummyJSON / FakeStore; production NODE_ENV also enforces real-only unless set false
ENTERPRISE_USE_REAL_ONLY=true
# OPEN_API_SKIP_MOCK_PROVIDERS=true
# DIRECT_SCRAPE_ONLY=true
```

Food & drink aisles (after purge):

```bash
npm run sync:food-pipeline
# npm run sync:food-pipeline -- fast-food desi-food drinks --limit 12
```

Verification (no secrets printed):

```bash
npm run go-live:verify
npm run purge:demo-products:dry
```

Local CAPTCHA OCR (Amazon/Noon fulfillment � no paid APIs):

```env
# ENABLE_LOCAL_CAPTCHA_SOLVER=true
# LOCAL_CAPTCHA_MAX_RETRIES=4
```


---

## Catalogue sync & scraping

```env
RAINFOREST_API_KEY=YOUR_RAINFOREST_API_KEY
SERPAPI_API_KEY=YOUR_SERPAPI_KEY
SERP_API_KEY=YOUR_SERPAPI_KEY
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
# GOOGLE_AI_API_KEY=
FIXER_API_KEY=YOUR_FIXER_KEY
EXCHANGERATE_API_KEY=YOUR_EXCHANGERATE_API_KEY
AFTERSHIP_API_KEY=YOUR_AFTERSHIP_KEY
CATALOG_SYNC_MARGIN_PERCENT=30
# CATALOG_SYNC_USE_PLATFORM_MARGIN=true
# DIRECT_SCRAPE_ENTERPRISE=true
# DIRECT_SCRAPE_BULK=true
# DIRECT_SCRAPE_MAX_PAGES=8
# SCRAPE_PLATFORMS=amazon,noon,ebay,aliexpress
# SCRAPE_REGIONS=SA,US,UK,UAE
# SCRAPE_PROXY_URLS=
# SCRAPE_UA_ROTATION=true
GLOBAL_SCRAPE_AUTO_APPROVE=true
STOREFRONT_SYNC_COUNTRY=SA
```

---

## Amazon PA-API & AliExpress (Tier 1 hybrid)

```env
AMAZON_ASSOCIATE_TAG=YOUR_AMAZON_ASSOCIATE_TAG
AMAZON_ACCESS_KEY=YOUR_AMAZON_PAAPI_ACCESS_KEY
AMAZON_SECRET_KEY=YOUR_AMAZON_PAAPI_SECRET_KEY
ALIEXPRESS_APP_KEY=YOUR_ALIEXPRESS_APP_KEY
ALIEXPRESS_APP_SECRET=YOUR_ALIEXPRESS_APP_SECRET
# ALIEXPRESS_TRACKING_ID=
```

---

## Cron & Auto-Pilot

```env
ENABLE_CRON_AUTOPILOT=true
CRON_AUTOPILOT_RUN_ON_BOOT=true
ENABLE_LIVE_PRICE_SYNC_CRON=true
# LIVE_PRICE_SYNC_LIMIT=500
ENABLE_CRON_MIDNIGHT_PIPELINE=true
CRON_TIMEZONE=Asia/Riyadh
ENABLE_DAILY_PROFIT_REPORT=true
DAILY_PROFIT_REPORT_TO=reports@yourdomain.com
# DAILY_PROFIT_REPORT_CC=
ENABLE_CRON_TOP_SELLERS_PRICE_REFRESH=false
CRON_TOP_SELLERS_SCHEDULE=0 4 * * *
ENABLE_SCRAPE_CRON=false
ENABLE_AI_SCRAPE_CRON=false
ENABLE_GLOBAL_SCRAPE_CRON=false
```

---

## Email (Resend + SMTP fallback)

```env
RESEND_API_KEY=re_YOUR_RESEND_KEY
RESEND_FROM="KSA Store <orders@yourdomain.com>"
# KSA_STORE_LOGO_URL=https://YOUR_CLIENT_HOST/favicon.svg
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=YOUR_SMTP_USER
SMTP_PASS=YOUR_SMTP_PASSWORD
SMTP_FROM="KSA Store <noreply@yourdomain.com>"
```

---

## Media (Cloudinary + Shotstack)

```env
CLOUDINARY_CLOUD_NAME=YOUR_CLOUD_NAME
CLOUDINARY_API_KEY=YOUR_CLOUDINARY_KEY
CLOUDINARY_API_SECRET=YOUR_CLOUDINARY_SECRET
# CLOUDINARY_URL=cloudinary://KEY:SECRET@cloud_name
SHOTSTACK_API_KEY=YOUR_SHOTSTACK_API_KEY
SHOTSTACK_API_VERSION=v1
# SHOTSTACK_ENV=stage
SHOTSTACK_SOUNDTRACK_URL=https://YOUR_CDN/audio.mp3
VIDEO_GENERATOR_ENABLED=true
PRODUCT_VIDEO_DURATION_SEC=15
```

---

## SEO (client — Vite `VITE_*`)

```env
VITE_SEO_SITE_NAME=KSA Store
VITE_SEO_DEFAULT_TITLE=KSA Store — Premium Online Shopping in Saudi Arabia
VITE_SEO_DEFAULT_DESCRIPTION=Shop groceries, pharmacy, jewellery & global brands with fast KSA delivery.
VITE_SEO_KEYWORDS=KSA Store, Saudi online shopping, Riyadh delivery
VITE_SEO_OG_IMAGE=/favicon.svg
# VITE_SEO_HEADINGS={"home":"Discover premium shopping","browse_default":"Browse catalogue"}
```

Server serves `GET /sitemap.xml` and `GET /robots.txt` using `PUBLIC_SITE_URL`.

---

## Open Shop (seller storefronts)

```env
ENABLE_OPEN_SHOP=true
VITE_ENABLE_OPEN_SHOP=true
```

---

## Geo & misc integrations

```env
GEO_USE_IPAPI=true
GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
REDIS_URL=redis://YOUR_REDIS_HOST:6379
# RAINFOREST_FULFILLMENT_WEBHOOK_URL=https://YOUR_OPS_HOST/webhooks/dropship
```

---

## Enterprise scale (optional CLI)

```env
# ENTERPRISE_SYNC_TARGET=5000
# ENTERPRISE_USE_REAL_ONLY=true
# npm run sync:global-markets
# npm run sync:enterprise-scale
```

---

## Food & drink pipeline

See **FOOD_PIPELINE_ENV.md** at repo root.

```env
FOOD_PIPELINE_KEYS=fast-food,desi-food,drinks
FOOD_PIPELINE_LIMIT=12
FOOD_PIPELINE_USE_DIRECT_SCRAPE=true
FOOD_PIPELINE_USE_GOOGLE_SHOPPING=false
CATALOG_SYNC_MARGIN_PERCENT=30
# npm run sync:food-pipeline --workspace=server
```

---

## Open Shop / seeded seller (local)

```env
ENABLE_OPEN_SHOP=true
VITE_ENABLE_OPEN_SHOP=true
SEED_APPROVED_SELLER=false
SEED_SELLER_USERNAME=seller
SEED_SELLER_EMAIL=seller@ksa.store
SEED_SELLER_PASSWORD=change-me
SEED_DEMO=false
SEED_DEMO_SELLER_PASSWORD=seller123
```
