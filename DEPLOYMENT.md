# Hybrid setup: local/Replit + Northflank

This project is split into two parts:

- `extension/` — Chrome extension. No Gemini key lives here.
- `backend/` — Express API. This is where `GEMINI_API_KEY` and `AUTH_TOKEN` live.

## Local/Replit development

```bash
cd backend
npm install
cp .env.example .env
```

Fill `.env`:

```env
GEMINI_API_KEY=your_real_gemini_key
AUTH_TOKEN=your_random_token
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*
```

Start backend:

```bash
npm run dev
```

Load the extension from `chrome://extensions` → Developer mode → Load unpacked → select `extension/`.

In extension Settings:

```txt
Backend URL: http://localhost:3000
Auth Token: same value as AUTH_TOKEN
```

For Replit, use the public Replit URL instead of localhost.

## GitHub push

Before pushing, check that no secrets are committed:

```bash
grep -R "AIza" . --exclude-dir=node_modules
grep -R "GEMINI_API_KEY=" . --exclude=.env.example --exclude-dir=node_modules
```

Then:

```bash
git init
git add .
git commit -m "Prepare hybrid deployment setup"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/cv-tailor.git
git push -u origin main
```

## Northflank deployment

Create a Northflank service from the GitHub repo. Use the backend folder as the service root/build context if Northflank asks.

Recommended settings:

```txt
Root directory / build context: backend
Start command: npm start
Port: 3000
```

Environment variables on Northflank:

```env
GEMINI_API_KEY=your_real_gemini_key
AUTH_TOKEN=your_random_token
NODE_ENV=production
CORS_ORIGIN=*
```

Northflank provides its own `PORT` variable. The server already supports `process.env.PORT`.

After deployment, test:

```bash
curl https://YOUR_NORTHFLANK_URL/health
```

Then put the Northflank URL in extension Settings:

```txt
Backend URL: https://YOUR_NORTHFLANK_URL
Auth Token: same value as AUTH_TOKEN on Northflank
```
