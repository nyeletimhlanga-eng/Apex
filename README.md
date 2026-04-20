# APEX v3 — AI Fitness Coach

Running 24/7 on Railway with full persistent memory.

## Stack
- **Backend**: Node.js + Express
- **Database**: SQLite (via better-sqlite3)
- **AI**: Claude Sonnet via Anthropic API
- **Frontend**: Mobile-first PWA
- **Hosting**: Railway (auto-deploy from GitHub)

## What APEX remembers
- Every conversation you've had
- Every food item and macro logged
- Every exercise session
- All your goals (fitness, business, academic)
- Body weight & body fat metrics over time

---

## Deploy to Railway via GitHub

### Step 1 — Push to GitHub
```bash
cd apex-v3
git init
git add .
git commit -m "APEX v3 initial"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/apex-v3.git
git push -u origin main
```

### Step 2 — Create Railway project
1. Go to **railway.app** → New Project
2. Select **Deploy from GitHub repo**
3. Choose `apex-v3`
4. Railway auto-detects Node.js and deploys

### Step 3 — Add environment variable
In Railway → your project → **Variables**:
- `ANTHROPIC_API_KEY` = your key from console.anthropic.com

### Step 4 — Get your URL
Railway gives you a URL like `apex-v3.up.railway.app`

### Step 5 — Install on your phone
1. Open the URL in **Safari** (iPhone) or **Chrome** (Android)
2. Tap **Share → Add to Home Screen**
3. APEX installs like a native app, full screen, no browser UI

---

## Auto-deploy
Every time you push to `main` on GitHub, Railway automatically redeploys. Zero manual work.

## Local dev
```bash
npm install
cp .env.example .env
# Add your API key to .env
npm start
```
