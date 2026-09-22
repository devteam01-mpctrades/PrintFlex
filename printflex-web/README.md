# printflex-web

Marketing site for **PrintFlex**, a Shopify app (in development) that prints bulk invoices,
packing slips and pick lists with a QR code and barcode on every document for scan-to-pack.
Made by MPC Trades, Phnom Penh.

This is a static site: plain HTML, one CSS file, one JS file. No build step, no npm, no framework.
The only external resource is Google Fonts.

The Shopify app itself lives in `../printflex-app` and is not part of this folder.

## Files

```
index.html        landing page (problem, how it works, features, comparison, scan mode, pricing, FAQ, contact)
privacy.html      privacy policy — DRAFT, pending legal review
terms.html        terms of service — DRAFT, pending legal review
support.html      support page
assets/styles.css all styles, shared by the four pages
assets/site.js    all scripts, shared by the four pages
assets/favicon.svg
BUILD-PROMPT.md   the spec this site was built from
```

Header nav and footer markup are duplicated byte-for-byte across the four pages (there is no
templating). If you change one, change all four — a quick way to check:

```sh
for f in index privacy terms support; do sed -n '/<header/,/<\/header>/p' $f.html | md5; done
```

## Preview locally

Open `index.html` directly in a browser (`file://` works), or serve the folder:

```sh
cd printflex-web
python3 -m http.server 8080
# then open http://localhost:8080
```

## Deploy to Nginx

The site is intended to live on its own subdomain alongside `shuffly.mpctrades.com`
(for example `printflex.mpctrades.com`). It is a static root, nothing to run.

1. Copy the folder to the server:

   ```sh
   rsync -av --delete ./ user@server:/var/www/printflex-web/
   ```

2. Add a server block (adjust the domain and certificate paths):

   ```nginx
   server {
       listen 80;
       listen [::]:80;
       server_name printflex.mpctrades.com;
       return 301 https://$host$request_uri;
   }

   server {
       listen 443 ssl http2;
       listen [::]:443 ssl http2;
       server_name printflex.mpctrades.com;

       ssl_certificate     /etc/letsencrypt/live/printflex.mpctrades.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/printflex.mpctrades.com/privkey.pem;

       root /var/www/printflex-web;
       index index.html;

       location / {
           try_files $uri $uri/ $uri.html =404;
       }

       # Contact form -> shared contact relay (same origin, no CORS)
       location = /api/contact {
           proxy_pass http://127.0.0.1:3002;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           add_header Cache-Control "no-store" always;
       }

       location /assets/ {
           expires 7d;
           add_header Cache-Control "public";
       }

       gzip on;
       gzip_types text/css application/javascript image/svg+xml;
   }
   ```

3. Reload:

   ```sh
   sudo nginx -t && sudo systemctl reload nginx
   ```

`try_files ... $uri.html` lets `/privacy` resolve to `privacy.html`, so the privacy policy URL
submitted to the Shopify App Store can be either form.

## Before App Store submission

- `privacy.html` and `terms.html` carry a visible "Draft — pending legal review" banner and
  `TODO:` HTML comments where the legal entity name, hosting region and governing law need
  filling in. Search for `TODO:` and resolve each one, then remove the banners.
- The contact form posts JSON to `/api/contact`, which Nginx proxies to the shared MPC Trades
  contact relay on the server (port 3002, the same one Shuffly uses). The relay emails
  team@mpctrades.com and brands the message from the Host header. Locally there is no relay, so
  the form falls back to opening a pre-filled email; on the live site it sends directly.
