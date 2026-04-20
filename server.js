require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

// ── Database setup ──────────────────────────────────────────────────────────
const db = new Database('./apex.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS food_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    calories INTEGER DEFAULT 0,
    protein REAL DEFAULT 0,
    carbs REAL DEFAULT 0,
    fat REAL DEFAULT 0,
    logged_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS exercise_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sets INTEGER,
    reps INTEGER,
    weight REAL,
    notes TEXT,
    logged_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    target TEXT,
    progress INTEGER DEFAULT 0,
    deadline TEXT,
    completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS daily_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    checkin_date TEXT NOT NULL,
    items TEXT NOT NULL,
    completed_count INTEGER DEFAULT 0,
    total_count INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS body_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    weight REAL,
    body_fat REAL,
    notes TEXT,
    logged_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── Helper: build APEX system prompt with full memory context ────────────────
function buildSystemPrompt(todayStr) {
  // Last 30 messages for conversation context
  const recentMsgs = db.prepare(`
    SELECT role, content, created_at FROM messages
    ORDER BY created_at DESC LIMIT 60
  `).all().reverse();

  // Today's food
  const todayFood = db.prepare(`
    SELECT * FROM food_logs WHERE logged_date = ?
  `).all(todayStr);

  const todayTotals = todayFood.reduce((acc, f) => ({
    calories: acc.calories + (f.calories || 0),
    protein: acc.protein + (f.protein || 0),
    carbs: acc.carbs + (f.carbs || 0),
    fat: acc.fat + (f.fat || 0)
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  // Today's exercise
  const todayExercise = db.prepare(`
    SELECT * FROM exercise_logs WHERE logged_date = ?
  `).all(todayStr);

  // Active goals
  const activeGoals = db.prepare(`
    SELECT * FROM goals WHERE completed = 0 ORDER BY created_at DESC LIMIT 10
  `).all();

  // Last 7 days food summary
  const weekFood = db.prepare(`
    SELECT logged_date,
           SUM(calories) as total_kcal,
           SUM(protein) as total_protein
    FROM food_logs
    WHERE logged_date >= date('now', '-7 days')
    GROUP BY logged_date
    ORDER BY logged_date DESC
  `).all();

  // Last 3 body metrics
  const recentMetrics = db.prepare(`
    SELECT * FROM body_metrics ORDER BY logged_date DESC LIMIT 3
  `).all();

  // Recent chat summary (last 10 exchanges, older ones summarised)
  const chatSummary = recentMsgs.slice(0, 20).map(m =>
    `[${m.created_at.slice(0, 10)}] ${m.role === 'user' ? 'NY' : 'APEX'}: ${m.content.slice(0, 200)}`
  ).join('\n');

  return `You are APEX — an elite AI fitness coach, nutritionist, and accountability partner built exclusively for NY (21M, London, originally from Johannesburg).

## WHO NY IS
- Business Administration student at Hult International Business School, London
- Runs ReliefLab (wellness dropshipping store) while studying
- Tracks fitness with a WHOOP device
- High-protein diet, focused on body composition (lean bulk)
- Direct, no-nonsense personality — hates sugarcoating
- Has a pattern of starting strong then dropping off after 8–14 days

## YOUR PERSONALITY
- Blunt, direct, no fluff. Call NY out when he's slipping.
- Speak like a knowledgeable older brother who's been in the gym 10 years
- Use casual language but back everything with real knowledge
- Don't lecture. Give actionable advice, fast.
- Celebrate wins briefly, then push harder
- If NY hasn't logged in a while — call it out immediately

## TODAY'S DATA (${todayStr})
**Nutrition logged today:**
${todayFood.length === 0 ? '— Nothing logged yet' : todayFood.map(f => `• ${f.name}: ${f.calories}kcal | P:${f.protein}g C:${f.carbs}g F:${f.fat}g`).join('\n')}

**Today's totals:** ${todayTotals.calories}kcal | Protein: ${todayTotals.protein}g | Carbs: ${todayTotals.carbs}g | Fat: ${todayTotals.fat}g

**Exercises today:**
${todayExercise.length === 0 ? '— None logged yet' : todayExercise.map(e => `• ${e.name}${e.sets ? ` — ${e.sets}x${e.reps}` : ''}${e.weight ? ` @ ${e.weight}kg` : ''}${e.notes ? ` (${e.notes})` : ''}`).join('\n')}

## ACTIVE GOALS
${activeGoals.length === 0 ? '— No active goals set' : activeGoals.map(g => `• [${g.category.toUpperCase()}] ${g.title}${g.deadline ? ` — by ${g.deadline}` : ''}${g.target ? ` | Target: ${g.target}` : ''}`).join('\n')}

## LAST 7 DAYS NUTRITION
${weekFood.length === 0 ? '— No data' : weekFood.map(d => `• ${d.logged_date}: ${Math.round(d.total_kcal)}kcal | ${Math.round(d.total_protein)}g protein`).join('\n')}

## BODY METRICS (recent)
${recentMetrics.length === 0 ? '— None logged yet' : recentMetrics.map(m => `• ${m.logged_date}: ${m.weight ? m.weight + 'kg' : ''}${m.body_fat ? ' | ' + m.body_fat + '% BF' : ''}${m.notes ? ' | ' + m.notes : ''}`).join('\n')}

## RECENT CONVERSATION HISTORY
${chatSummary || '— No prior conversation'}

---
Keep responses concise and sharp. Use formatting (bold, bullets) on longer answers. Always end with one actionable next step.`;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Chat
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });

  const todayStr = new Date().toISOString().slice(0, 10);

  // Save user message
  db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run('user', message);

  // Get last 20 messages for Claude context
  const history = db.prepare(`
    SELECT role, content FROM messages ORDER BY created_at DESC LIMIT 40
  `).all().reverse().map(m => ({ role: m.role, content: m.content }));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: buildSystemPrompt(todayStr),
        messages: history
      })
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const reply = data.content?.[0]?.text || 'Say that again.';

    // Save assistant message
    db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)').run('assistant', reply);

    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Food log
app.get('/api/food/:date', (req, res) => {
  const rows = db.prepare('SELECT * FROM food_logs WHERE logged_date = ? ORDER BY created_at ASC').all(req.params.date);
  res.json(rows);
});

app.post('/api/food', (req, res) => {
  const { name, calories, protein, carbs, fat, logged_date } = req.body;
  const result = db.prepare(
    'INSERT INTO food_logs (name, calories, protein, carbs, fat, logged_date) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, calories || 0, protein || 0, carbs || 0, fat || 0, logged_date);
  res.json({ id: result.lastInsertRowid, name, calories, protein, carbs, fat, logged_date });
});

app.delete('/api/food/:id', (req, res) => {
  db.prepare('DELETE FROM food_logs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Exercise log
app.get('/api/exercise/:date', (req, res) => {
  const rows = db.prepare('SELECT * FROM exercise_logs WHERE logged_date = ? ORDER BY created_at ASC').all(req.params.date);
  res.json(rows);
});

app.post('/api/exercise', (req, res) => {
  const { name, sets, reps, weight, notes, logged_date } = req.body;
  const result = db.prepare(
    'INSERT INTO exercise_logs (name, sets, reps, weight, notes, logged_date) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, sets || null, reps || null, weight || null, notes || '', logged_date);
  res.json({ id: result.lastInsertRowid, name, sets, reps, weight, notes, logged_date });
});

app.delete('/api/exercise/:id', (req, res) => {
  db.prepare('DELETE FROM exercise_logs WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Goals
app.get('/api/goals', (req, res) => {
  const rows = db.prepare('SELECT * FROM goals ORDER BY completed ASC, created_at DESC').all();
  res.json(rows);
});

app.post('/api/goals', (req, res) => {
  const { title, category, target, deadline } = req.body;
  const result = db.prepare(
    'INSERT INTO goals (title, category, target, deadline) VALUES (?, ?, ?, ?)'
  ).run(title, category || 'general', target || '', deadline || null);
  res.json({ id: result.lastInsertRowid, title, category, target, deadline, completed: 0, progress: 0 });
});

app.patch('/api/goals/:id', (req, res) => {
  const { progress, completed } = req.body;
  if (progress !== undefined) db.prepare('UPDATE goals SET progress = ? WHERE id = ?').run(progress, req.params.id);
  if (completed !== undefined) db.prepare('UPDATE goals SET completed = ? WHERE id = ?').run(completed ? 1 : 0, req.params.id);
  res.json({ success: true });
});

app.delete('/api/goals/:id', (req, res) => {
  db.prepare('DELETE FROM goals WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Body metrics
app.get('/api/metrics', (req, res) => {
  const rows = db.prepare('SELECT * FROM body_metrics ORDER BY logged_date DESC LIMIT 30').all();
  res.json(rows);
});

app.post('/api/metrics', (req, res) => {
  const { weight, body_fat, notes, logged_date } = req.body;
  const result = db.prepare(
    'INSERT INTO body_metrics (weight, body_fat, notes, logged_date) VALUES (?, ?, ?, ?)'
  ).run(weight || null, body_fat || null, notes || '', logged_date);
  res.json({ id: result.lastInsertRowid, weight, body_fat, notes, logged_date });
});

// Stats summary for dashboard
app.get('/api/summary/:date', (req, res) => {
  const date = req.params.date;
  const food = db.prepare('SELECT * FROM food_logs WHERE logged_date = ?').all(date);
  const exercise = db.prepare('SELECT * FROM exercise_logs WHERE logged_date = ?').all(date);
  const goals = db.prepare('SELECT * FROM goals WHERE completed = 0').all();
  const streak = getStreak();

  const totals = food.reduce((acc, f) => ({
    calories: acc.calories + (f.calories || 0),
    protein: acc.protein + (f.protein || 0),
    carbs: acc.carbs + (f.carbs || 0),
    fat: acc.fat + (f.fat || 0)
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

  res.json({ totals, food, exercise, goals, streak });
});

function getStreak() {
  const days = db.prepare(`
    SELECT DISTINCT logged_date FROM food_logs
    ORDER BY logged_date DESC LIMIT 30
  `).all().map(r => r.logged_date);

  if (!days.length) return 0;
  let streak = 0;
  let current = new Date();
  for (const day of days) {
    const d = new Date(day);
    const diff = Math.round((current - d) / 86400000);
    if (diff <= 1) { streak++; current = d; }
    else break;
  }
  return streak;
}

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`APEX running on port ${PORT}`));
