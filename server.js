const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const cron = require('node-cron');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL bağlantısı
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - ${new Date().toISOString()}`);
  next();
});

// ============================================================
// MONGODB (BOT VERİLERİ)
// ============================================================
let mongoConnected = false;

async function connectMongo() {
  const url = process.env.MONGODB_URL;
  if (!url) { console.log('⚠️ MONGODB_URL yok, bot verileri devre dışı'); return; }
  try {
    await mongoose.connect(url);
    mongoConnected = true;
    console.log('✅ MongoDB (Bot) bağlantısı kuruldu!');
  } catch (e) {
    console.error('❌ MongoDB bağlantı hatası:', e.message);
  }
}

const studentSchema = new mongoose.Schema({
  name: String,
  discordId: { type: String, unique: true },
  registeredBy: String,
  registeredAt: Date,
  totalLessons: { type: Number, default: 0 },
  lastLessonDate: { type: String, default: null },
}, { timestamps: true });

const lessonSchema = new mongoose.Schema({
  studentId: String,
  studentName: String,
  date: String,
  timestamp: { type: Date, default: Date.now },
  instructorId: String,
  category: { type: String, default: null },
  lessonNumber: Number,
  lessonSequence: { type: Number, default: 1 },
}, { timestamps: true });

const BotStudent = mongoose.model('Student', studentSchema);
const BotLesson = mongoose.model('Lesson', lessonSchema);

// ============================================================
// POSTGRESQL TABLOLARI
// ============================================================
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS applications (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        surname VARCHAR(100) NOT NULL,
        age INTEGER NOT NULL,
        country VARCHAR(100) NOT NULL,
        rank VARCHAR(50) NOT NULL,
        target_rank VARCHAR(50) NOT NULL,
        tracker TEXT,
        expectations TEXT,
        introduction TEXT,
        discord VARCHAR(100),
        availability TEXT,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS availability TEXT;`).catch(() => {});
    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        surname VARCHAR(100) NOT NULL,
        age INTEGER NOT NULL,
        country VARCHAR(100) NOT NULL,
        rank VARCHAR(50) NOT NULL,
        target_rank VARCHAR(50) NOT NULL,
        tracker TEXT,
        expectations TEXT,
        introduction TEXT,
        discord VARCHAR(100),
        weekly_schedule JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS coaches (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        surname VARCHAR(100) NOT NULL,
        username VARCHAR(100),
        specialty TEXT,
        contact TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE coaches ADD COLUMN IF NOT EXISTS username VARCHAR(100);`).catch(() => {});
    console.log('✅ PostgreSQL tabloları hazır!');
  } catch (error) {
    console.error('❌ Veritabanı hatası:', error);
  } finally {
    client.release();
  }
}

// ============================================================
// EMAIL
// ============================================================
async function sendDataReport() {
  try {
    console.log('📧 Email raporu hazırlanıyor...', new Date().toLocaleString('tr-TR'));
    const client = await pool.connect();
    const [apps, studs, coachs] = await Promise.all([
      client.query('SELECT * FROM applications ORDER BY created_at DESC'),
      client.query('SELECT * FROM students ORDER BY created_at DESC'),
      client.query('SELECT * FROM coaches ORDER BY created_at DESC')
    ]);
    client.release();
    const applications = apps.rows;
    const students = studs.rows;
    const coaches = coachs.rows;
    const emailHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:1200px;margin:0 auto;background:#f5f5f5;padding:20px}.header{background:linear-gradient(135deg,#6366f1,#ec4899);color:#fff;padding:40px;text-align:center;border-radius:10px;margin-bottom:30px}.header h1{margin:0 0 10px;font-size:42px}.stat{background:#fff;padding:30px;border-radius:12px;text-align:center;flex:1;box-shadow:0 2px 8px rgba(0,0,0,.1)}.stat-number{font-size:48px;font-weight:700;color:#6366f1}.footer{text-align:center;padding:30px;background:#fff;border-radius:12px;margin-top:30px;color:#666}</style></head><body>
    <div class="header"><h1>🎮 AURA COACHING</h1><p>3 Günlük Veri Raporu - ${new Date().toLocaleDateString('tr-TR')}</p></div>
    <div style="display:flex;gap:20px;margin:30px 0">
      <div class="stat"><div class="stat-number">${applications.length}</div><div>Toplam Başvuru</div></div>
      <div class="stat"><div class="stat-number">${students.length}</div><div>Toplam Öğrenci</div></div>
      <div class="stat"><div class="stat-number">${coaches.length}</div><div>Toplam Koç</div></div>
    </div>
    <div class="footer"><p><strong>AURA Coaching</strong> - Profesyonel Valorant Koçluk Sistemi</p></div>
    </body></html>`;
    const formData = new URLSearchParams({
      '_subject': `📊 AURA Coaching - 3 Günlük Rapor - ${new Date().toLocaleDateString('tr-TR')}`,
      '_template': 'box', '_captcha': 'false', '_html': emailHTML,
      'toplam_basvuru': applications.length, 'toplam_ogrenci': students.length, 'toplam_koc': coaches.length
    });
    const response = await fetch('https://formsubmit.co/basvurukocluk@gmail.com', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData
    });
    if (response.ok) console.log('✅ Email gönderildi!');
    else console.error('❌ Email hatası:', response.statusText);
  } catch (error) {
    console.error('❌ Email gönderme hatası:', error);
  }
}

// ============================================================
// POSTGRESQL API ENDPOINTS
// ============================================================
app.get('/', (req, res) => {
  res.json({ status: '🚀 AURA Coaching API çalışıyor!', mongodb: mongoConnected ? '✅ Bağlı' : '❌ Bağlı değil', timestamp: new Date().toISOString() });
});

app.post('/api/send-test-report', async (req, res) => {
  try { await sendDataReport(); res.json({ success: true, message: 'Test emaili gönderildi!' }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/applications', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM applications ORDER BY created_at DESC'); res.json({ success: true, applications: result.rows }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/applications', async (req, res) => {
  try {
    const { name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, availability } = req.body;
    const result = await pool.query(`INSERT INTO applications (name, surname, age, country, rank, target_rank, tracker, expectations, introduction, discord, availability) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, availability]);
    res.json({ success: true, application: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.put('/api/applications/:id/mark-read', async (req, res) => {
  try { const result = await pool.query('UPDATE applications SET is_read = true WHERE id = $1 RETURNING *', [req.params.id]); res.json({ success: true, application: result.rows[0] }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.delete('/api/applications/:id', async (req, res) => {
  try { await pool.query('DELETE FROM applications WHERE id = $1', [req.params.id]); res.json({ success: true }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/students', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM students ORDER BY created_at DESC'); res.json({ success: true, students: result.rows }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/students', async (req, res) => {
  try {
    const { name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, weeklySchedule } = req.body;
    const result = await pool.query(`INSERT INTO students (name, surname, age, country, rank, target_rank, tracker, expectations, introduction, discord, weekly_schedule) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, JSON.stringify(weeklySchedule || {})]);
    res.json({ success: true, student: result.rows[0], studentId: result.rows[0].id });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.put('/api/students/:id', async (req, res) => {
  try {
    const { weeklySchedule } = req.body;
    const result = await pool.query('UPDATE students SET weekly_schedule = $1 WHERE id = $2 RETURNING *', [JSON.stringify(weeklySchedule), req.params.id]);
    res.json({ success: true, student: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.delete('/api/students/:id', async (req, res) => {
  try { await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]); res.json({ success: true }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/coaches', async (req, res) => {
  try { const result = await pool.query('SELECT * FROM coaches ORDER BY created_at DESC'); res.json({ success: true, coaches: result.rows }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/coaches', async (req, res) => {
  try {
    const { name, surname, username, specialty, contact } = req.body;
    const result = await pool.query('INSERT INTO coaches (name, surname, username, specialty, contact) VALUES ($1,$2,$3,$4,$5) RETURNING *', [name, surname, username, specialty, contact]);
    res.json({ success: true, coach: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.put('/api/coaches/:id', async (req, res) => {
  try {
    const { name, surname, username, specialty, contact } = req.body;
    const result = await pool.query('UPDATE coaches SET name=$1, surname=$2, username=$3, specialty=$4, contact=$5 WHERE id=$6 RETURNING *', [name, surname, username, specialty, contact, req.params.id]);
    res.json({ success: true, coach: result.rows[0] });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.delete('/api/coaches/:id', async (req, res) => {
  try { await pool.query('DELETE FROM coaches WHERE id = $1', [req.params.id]); res.json({ success: true }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ============================================================
// MONGODB (BOT) API ENDPOINTS
// ============================================================
app.get('/api/bot/students', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const students = await BotStudent.find({}).sort({ totalLessons: -1 });
    res.json({ success: true, students });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/bot/students/:discordId', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const student = await BotStudent.findOne({ discordId: req.params.discordId });
    if (!student) return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    const lessons = await BotLesson.find({ studentId: req.params.discordId }).sort({ date: -1, lessonSequence: -1 });
    res.json({ success: true, student, lessons });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/bot/lessons', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const total = await BotLesson.countDocuments({});
    const lessons = await BotLesson.find({}).sort({ timestamp: -1 }).skip(skip).limit(limit);
    res.json({ success: true, lessons, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/bot/stats', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const today = new Date().toISOString().split('T')[0];
    const [totalStudents, totalLessons, todayLessons, topStudent] = await Promise.all([
      BotStudent.countDocuments({}),
      BotLesson.countDocuments({}),
      BotLesson.countDocuments({ date: today }),
      BotStudent.findOne({}).sort({ totalLessons: -1 }),
    ]);
    const dates = [];
    for (let i = 6; i >= 0; i--) dates.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0]);
    const recentLessons = await BotLesson.find({ date: { $gte: dates[0] } }, { date: 1, instructorId: 1, category: 1 });
    const last7Map = new Map(dates.map(d => [d, 0]));
    const instructorMap = new Map();
    const categoryMap = new Map();
    for (const l of recentLessons) {
      if (last7Map.has(l.date)) last7Map.set(l.date, last7Map.get(l.date) + 1);
      instructorMap.set(l.instructorId, (instructorMap.get(l.instructorId) || 0) + 1);
      if (l.category) categoryMap.set(l.category, (categoryMap.get(l.category) || 0) + 1);
    }
    const last7Days = dates.map(d => ({ date: d, count: last7Map.get(d) || 0 }));
    const topInstructors = [...instructorMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count]) => ({ id, count }));
    const topCategories = [...categoryMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, count]) => ({ cat, count }));
    res.json({ success: true, stats: { totalStudents, totalLessons, todayLessons, topStudent: topStudent ? { name: topStudent.name, totalLessons: topStudent.totalLessons } : null, last7Days, topInstructors, topCategories } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================
// CRON & SERVER
// ============================================================
cron.schedule('0 0 */3 * *', () => {
  console.log('🔔 3 günlük rapor zamanı!');
  sendDataReport();
});

app.listen(PORT, async () => {
  await initDatabase();
  await connectMongo();
  console.log(`🚀 AURA Coaching API çalışıyor! Port: ${PORT}`);
});
