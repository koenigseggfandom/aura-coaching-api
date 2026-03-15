const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const cron = require('node-cron');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── ORTAM DEĞİŞKENLERİ ──────────────────────────────────────────────────────
// Railway'de şunları env olarak eklemen lazım:
//   DATABASE_URL   → PostgreSQL bağlantı string'i (zaten var)
//   MONGODB_URL    → MongoDB bağlantı string'i (zaten var)
//   DISCORD_BOT_TOKEN → Botun token'ı (YENİ — aşağıda açıklandı)
//   DISCORD_GUILD_ID  → Sunucunun ID'si (YENİ — aşağıda açıklandı)
//   DISCORD_ROLE_ID   → Atanacak rolün ID'si (YENİ — aşağıda açıklandı)
// ─────────────────────────────────────────────────────────────────────────────

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_GUILD_ID  = process.env.DISCORD_GUILD_ID  || '';
const DISCORD_ROLE_ID   = process.env.DISCORD_ROLE_ID   || '';
const DISCORD_API       = 'https://discord.com/api/v10';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - ${new Date().toISOString()}`);
  next();
});

let mongoConnected = false;

async function connectMongo() {
  const url = process.env.MONGODB_URL;
  if (!url) { console.log('⚠️ MONGODB_URL yok'); return; }
  try {
    await mongoose.connect(url);
    mongoConnected = true;
    console.log('✅ MongoDB bağlantısı kuruldu!');
  } catch (e) {
    console.error('❌ MongoDB hatası:', e.message);
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
const BotLesson  = mongoose.model('Lesson', lessonSchema);

// ─── VERİTABANI KURULUM ───────────────────────────────────────────────────────
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
        is_active BOOLEAN DEFAULT true,
        total_lessons INTEGER DEFAULT 0,
        remaining_lessons INTEGER DEFAULT 0,
        weekly_lessons INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Mevcut kolonları kontrol et, yoksa ekle
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`).catch(() => {});
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS total_lessons INTEGER DEFAULT 0;`).catch(() => {});
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS remaining_lessons INTEGER DEFAULT 0;`).catch(() => {});
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS weekly_lessons INTEGER DEFAULT 1;`).catch(() => {});

    // ── YENİ: Arşiv kolonları ─────────────────────────────────────────────────
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;`).catch(() => {});
    await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;`).catch(() => {});
    // ─────────────────────────────────────────────────────────────────────────

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

    await client.query(`
      CREATE TABLE IF NOT EXISTS lesson_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        color VARCHAR(50) DEFAULT '#6366f1',
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      INSERT INTO lesson_types (name, color, is_default) VALUES
        ('Aim', '#10b981', true),
        ('Movement', '#ec4899', true),
        ('VOD', '#6366f1', true),
        ('Gamesense', '#8b5cf6', true)
      ON CONFLICT (name) DO NOTHING;
    `).catch(() => {});

    console.log('✅ PostgreSQL tabloları hazır!');
  } catch (error) {
    console.error('❌ Veritabanı hatası:', error);
  } finally {
    client.release();
  }
}

// ─── DISCORD YARDIMCI FONKSİYONLARI ──────────────────────────────────────────

/**
 * Discord API'ye bot token ile istek gönderir.
 * method: 'GET' | 'PUT' | 'DELETE' | 'POST'
 * path:   '/guilds/123/members/456/roles/789' gibi
 * body:   isteğe bağlı JSON objesi
 */
async function discordRequest(method, path, body = null) {
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN env değişkeni eksik');
  const opts = {
    method,
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${DISCORD_API}${path}`, opts);
  if (res.status === 204) return { success: true }; // Discord boş 204 döner (rol atama vs.)
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Discord API hatası: ${res.status}`);
  return data;
}

// ─── DISCORD ENDPOINTLERİ ────────────────────────────────────────────────────

/**
 * POST /api/discord/assign-role
 * Body: { discordId, studentName }
 *
 * Kullanıcıya Discord sunucusunda öğrenci rolünü atar.
 * DISCORD_GUILD_ID + DISCORD_ROLE_ID env'de tanımlı olmalı.
 *
 * Bot'un sunucuda "Rolleri Yönet" iznine sahip olması VE
 * atanacak rolün bot rolünün ALTINDA olması gerekiyor.
 */
app.post('/api/discord/assign-role', async (req, res) => {
  try {
    const { discordId, studentName } = req.body;
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId gerekli' });
    if (!DISCORD_GUILD_ID || !DISCORD_ROLE_ID) {
      return res.status(500).json({ success: false, error: 'DISCORD_GUILD_ID veya DISCORD_ROLE_ID env eksik' });
    }

    // PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}
    await discordRequest('PUT', `/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${DISCORD_ROLE_ID}`);

    console.log(`✅ Rol atandı: ${studentName} (${discordId})`);
    res.json({ success: true, message: `Rol atandı: ${studentName}` });
  } catch (e) {
    console.error('❌ Rol atama hatası:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/discord/register
 * Body: { discordId, studentName }
 *
 * Bot'un kayıt kanalına bildirim gönderir.
 * Botun kayıt mantığı MongoDB'deyse oraya da yazar.
 *
 * DISCORD_LOG_CHANNEL_ID env'de tanımlıysa o kanala mesaj atar.
 * Yoksa sadece MongoDB'ye kaydeder (eğer bot öğrencisi olarak izleniyorsa).
 */
app.post('/api/discord/register', async (req, res) => {
  try {
    const { discordId, studentName } = req.body;
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId gerekli' });

    const results = { logged: false, notified: false };

    // İsteğe bağlı: log kanalına bildirim gönder
    const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
    if (logChannelId && DISCORD_BOT_TOKEN) {
      try {
        await discordRequest('POST', `/channels/${logChannelId}/messages`, {
          content: `✅ **Yeni öğrenci kaydedildi!**\n👤 İsim: ${studentName}\n🆔 Discord ID: ${discordId}\n📅 Tarih: ${new Date().toLocaleDateString('tr-TR')}`
        });
        results.notified = true;
      } catch (e) {
        console.warn('⚠️ Kanal bildirimi başarısız:', e.message);
      }
    }

    results.logged = true;
    console.log(`✅ Discord kayıt: ${studentName} (${discordId})`);
    res.json({ success: true, results });
  } catch (e) {
    console.error('❌ Discord kayıt hatası:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/discord/user/:discordId
 *
 * Discord kullanıcısının global kullanıcı adını döner.
 * Yanıt: { success: true, username: "kullaniciadi", globalName: "Görünen Ad" }
 *
 * Bot token gerektirir.
 * Rate limit: Discord API 5 istek/5sn — önbellek kullanılıyor.
 */
const discordUsernameCache = new Map(); // { discordId -> { username, cachedAt } }
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 saat

app.get('/api/discord/user/:discordId', async (req, res) => {
  try {
    const { discordId } = req.params;
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId gerekli' });

    // Önbellekte varsa döndür
    const cached = discordUsernameCache.get(discordId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return res.json({ success: true, username: cached.username, globalName: cached.globalName, fromCache: true });
    }

    if (!DISCORD_BOT_TOKEN) {
      return res.status(500).json({ success: false, error: 'DISCORD_BOT_TOKEN env eksik' });
    }

    // GET /users/:id
    const user = await discordRequest('GET', `/users/${discordId}`);

    // Discord'un yeni kullanıcı adı sistemi:
    // - user.username: benzersiz kullanıcı adı (örn: "ahmet" veya "ahmet#1234" eski sistem)
    // - user.global_name: görünen ad (görünen isim, null olabilir)
    const username = user.username || discordId;
    const globalName = user.global_name || user.username || null;

    discordUsernameCache.set(discordId, { username, globalName, cachedAt: Date.now() });

    res.json({ success: true, username, globalName, id: user.id });
  } catch (e) {
    console.error('❌ Discord kullanıcı adı hatası:', e.message);
    // Hata durumunda başarısız döndür ama frontend sessizce geçer
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── APPLICATIONS ─────────────────────────────────────────────────────────────
app.get('/api/applications', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM applications ORDER BY created_at DESC'); res.json({ success: true, applications: r.rows }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/applications', async (req, res) => {
  try {
    const { name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, availability } = req.body;
    const r = await pool.query(
      `INSERT INTO applications (name,surname,age,country,rank,target_rank,tracker,expectations,introduction,discord,availability) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name,surname,age,country,rank,targetRank,tracker,expectations,introduction,discord,availability]
    );
    res.json({ success: true, application: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.put('/api/applications/:id/mark-read', async (req, res) => {
  try { const r = await pool.query('UPDATE applications SET is_read=true WHERE id=$1 RETURNING *',[req.params.id]); res.json({ success: true, application: r.rows[0] }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.delete('/api/applications/:id', async (req, res) => {
  try { await pool.query('DELETE FROM applications WHERE id=$1',[req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── STUDENTS ─────────────────────────────────────────────────────────────────
app.get('/api/students', async (req, res) => {
  try {
    // archived kolonu da dahil edildi
    const r = await pool.query('SELECT * FROM students ORDER BY is_active DESC, created_at DESC');
    res.json({ success: true, students: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/students', async (req, res) => {
  try {
    const { name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, weeklySchedule, totalLessons, weeklyLessons } = req.body;
    const tl = parseInt(totalLessons) || 0;
    const wl = parseInt(weeklyLessons) || 1;
    const r = await pool.query(
      `INSERT INTO students (name,surname,age,country,rank,target_rank,tracker,expectations,introduction,discord,weekly_schedule,is_active,total_lessons,remaining_lessons,weekly_lessons,archived) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$12,$13,false) RETURNING *`,
      [name,surname,age,country,rank,targetRank,tracker,expectations,introduction,discord,JSON.stringify(weeklySchedule||{}),tl,wl]
    );
    res.json({ success: true, student: r.rows[0], studentId: r.rows[0].id });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.put('/api/students/:id', async (req, res) => {
  try {
    const { weeklySchedule, totalLessons, remainingLessons, weeklyLessons, isActive, archived } = req.body;
    let updates = [], values = [], idx = 1;
    if (weeklySchedule  !== undefined) { updates.push(`weekly_schedule=$${idx++}`);  values.push(JSON.stringify(weeklySchedule)); }
    if (totalLessons    !== undefined) { updates.push(`total_lessons=$${idx++}`);    values.push(parseInt(totalLessons)); }
    if (remainingLessons !== undefined) {
      updates.push(`remaining_lessons=$${idx++}`);
      values.push(parseInt(remainingLessons));
      if (parseInt(remainingLessons) <= 0) updates.push(`is_active=false`);
    }
    if (weeklyLessons   !== undefined) { updates.push(`weekly_lessons=$${idx++}`);  values.push(parseInt(weeklyLessons)); }
    if (isActive        !== undefined) { updates.push(`is_active=$${idx++}`);       values.push(isActive); }
    // YENİ: arşivleme desteği
    if (archived !== undefined) {
      updates.push(`archived=$${idx++}`);
      values.push(archived);
      if (archived === true) {
        updates.push(`archived_at=NOW()`);
        // Arşivlenince otomatik pasife al
        if (!updates.includes('is_active=false')) updates.push(`is_active=false`);
      } else {
        updates.push(`archived_at=NULL`);
      }
    }
    if (!updates.length) return res.json({ success: false, error: 'Güncellenecek alan yok' });
    values.push(req.params.id);
    const r = await pool.query(`UPDATE students SET ${updates.join(',')} WHERE id=$${idx} RETURNING *`, values);
    res.json({ success: true, student: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.put('/api/students/:id/toggle-active', async (req, res) => {
  try {
    const { isActive, totalLessons, weeklyLessons } = req.body;
    let r;
    if (isActive && totalLessons !== undefined) {
      r = await pool.query(
        `UPDATE students SET is_active=true,total_lessons=$1,remaining_lessons=$1,weekly_lessons=$2,archived=false,archived_at=NULL WHERE id=$3 RETURNING *`,
        [parseInt(totalLessons), parseInt(weeklyLessons)||1, req.params.id]
      );
    } else {
      r = await pool.query(`UPDATE students SET is_active=$1 WHERE id=$2 RETURNING *`, [isActive, req.params.id]);
    }
    res.json({ success: true, student: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.delete('/api/students/:id', async (req, res) => {
  // Artık gerçekten silmek yerine arşivlemeyi öneriyoruz.
  // Ama endpoint korunuyor — frontend artık PUT /archived:true kullanıyor.
  try { await pool.query('DELETE FROM students WHERE id=$1',[req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── COACHES ──────────────────────────────────────────────────────────────────
app.get('/api/coaches', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM coaches ORDER BY created_at DESC'); res.json({ success: true, coaches: r.rows }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/coaches', async (req, res) => {
  try {
    const { name, surname, username, specialty, contact } = req.body;
    const r = await pool.query('INSERT INTO coaches (name,surname,username,specialty,contact) VALUES ($1,$2,$3,$4,$5) RETURNING *',[name,surname,username,specialty,contact]);
    res.json({ success: true, coach: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.put('/api/coaches/:id', async (req, res) => {
  try {
    const { name, surname, username, specialty, contact } = req.body;
    const r = await pool.query('UPDATE coaches SET name=$1,surname=$2,username=$3,specialty=$4,contact=$5 WHERE id=$6 RETURNING *',[name,surname,username,specialty,contact,req.params.id]);
    res.json({ success: true, coach: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.delete('/api/coaches/:id', async (req, res) => {
  try { await pool.query('DELETE FROM coaches WHERE id=$1',[req.params.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── LESSON TYPES ─────────────────────────────────────────────────────────────
app.get('/api/lesson-types', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM lesson_types ORDER BY is_default DESC, name ASC');
    res.json({ success: true, lessonTypes: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.post('/api/lesson-types', async (req, res) => {
  try {
    const { name, color } = req.body;
    const r = await pool.query('INSERT INTO lesson_types (name,color,is_default) VALUES ($1,$2,false) RETURNING *',[name, color||'#6366f1']);
    res.json({ success: true, lessonType: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') res.status(400).json({ success: false, error: 'Bu ders türü zaten var!' });
    else res.status(500).json({ success: false, error: e.message });
  }
});
app.delete('/api/lesson-types/:id', async (req, res) => {
  try {
    const check = await pool.query('SELECT is_default FROM lesson_types WHERE id=$1',[req.params.id]);
    if (check.rows[0]?.is_default) return res.status(400).json({ success: false, error: 'Varsayılan ders türleri silinemez!' });
    await pool.query('DELETE FROM lesson_types WHERE id=$1',[req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── BOT API (sadece MongoDB — değişiklik yok) ────────────────────────────────
app.get('/api/bot/students', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try { const s = await BotStudent.find({}).sort({ totalLessons: -1 }); res.json({ success: true, students: s }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/bot/students/:discordId', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const s = await BotStudent.findOne({ discordId: req.params.discordId });
    if (!s) return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    const l = await BotLesson.find({ studentId: req.params.discordId }).sort({ date: -1, lessonSequence: -1 });
    res.json({ success: true, student: s, lessons: l });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/bot/lessons', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip  = (page - 1) * limit;
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
      BotStudent.countDocuments({}), BotLesson.countDocuments({}),
      BotLesson.countDocuments({ date: today }), BotStudent.findOne({}).sort({ totalLessons: -1 }),
    ]);
    const dates = [];
    for (let i = 6; i >= 0; i--) dates.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0]);
    const recentLessons = await BotLesson.find({ date: { $gte: dates[0] } }, { date: 1, instructorId: 1, category: 1 });
    const last7Map      = new Map(dates.map(d => [d, 0]));
    const instructorMap = new Map();
    const categoryMap   = new Map();
    for (const l of recentLessons) {
      if (last7Map.has(l.date)) last7Map.set(l.date, last7Map.get(l.date) + 1);
      instructorMap.set(l.instructorId, (instructorMap.get(l.instructorId) || 0) + 1);
      if (l.category) categoryMap.set(l.category, (categoryMap.get(l.category) || 0) + 1);
    }
    const last7Days     = dates.map(d => ({ date: d, count: last7Map.get(d) || 0 }));
    const topInstructors = [...instructorMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,count])=>({id,count}));
    const topCategories  = [...categoryMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([cat,count])=>({cat,count}));
    res.json({ success: true, stats: { totalStudents, totalLessons, todayLessons, topStudent: topStudent ? { name: topStudent.name, totalLessons: topStudent.totalLessons } : null, last7Days, topInstructors, topCategories } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
app.get('/api/bot/match/:discord', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const s = await BotStudent.findOne({
      $or: [{ discordId: req.params.discord }, { name: { $regex: req.params.discord, $options: 'i' } }]
    });
    if (!s) return res.json({ success: false, error: 'Bulunamadı' });
    const l = await BotLesson.find({ studentId: s.discordId }).sort({ timestamp: -1 }).limit(20);
    res.json({ success: true, student: s, lessons: l });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── DİĞER ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: '🚀 AURA Coaching API çalışıyor!', mongodb: mongoConnected ? '✅ Bağlı' : '❌ Bağlı değil', timestamp: new Date().toISOString() });
});
app.post('/api/send-test-report', async (req, res) => {
  try { await sendDataReport(); res.json({ success: true }); }
  catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

async function sendDataReport() {
  try {
    const client = await pool.connect();
    const [apps, studs, coachs] = await Promise.all([
      client.query('SELECT * FROM applications ORDER BY created_at DESC'),
      client.query('SELECT * FROM students ORDER BY created_at DESC'),
      client.query('SELECT * FROM coaches ORDER BY created_at DESC')
    ]);
    client.release();
    const emailHTML = `<!DOCTYPE html><html><body><h1>AURA Raporu</h1><p>Aktif: ${studs.rows.filter(s=>s.is_active).length} / Toplam: ${studs.rows.length}</p></body></html>`;
    const formData = new URLSearchParams({
      '_subject': `AURA Coaching Rapor - ${new Date().toLocaleDateString('tr-TR')}`,
      '_template': 'box', '_captcha': 'false', '_html': emailHTML
    });
    await fetch('https://formsubmit.co/basvurukocluk@gmail.com', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData
    });
  } catch (error) {
    console.error('❌ Email hatası:', error);
  }
}

cron.schedule('0 0 */3 * *', () => sendDataReport());

app.listen(PORT, async () => {
  await initDatabase();
  await connectMongo();
  console.log(`🚀 AURA Coaching API çalışıyor! Port: ${PORT}`);
});
