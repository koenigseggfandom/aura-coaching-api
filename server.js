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
//   DATABASE_URL        → PostgreSQL bağlantı string'i
//   MONGODB_URL         → MongoDB bağlantı string'i
//   DISCORD_BOT_TOKEN   → Botun token'ı
//   DISCORD_GUILD_ID    → Sunucunun ID'si
//   DISCORD_ROLE_ID     → Atanacak öğrenci rolünün ID'si
//   DISCORD_LOG_CHANNEL_ID → (opsiyonel) Kayıt bildirimlerinin gönderileceği kanal ID'si
// ─────────────────────────────────────────────────────────────────────────────

const DISCORD_BOT_TOKEN    = process.env.DISCORD_BOT_TOKEN    || '';
const DISCORD_GUILD_ID     = process.env.DISCORD_GUILD_ID     || '';
const DISCORD_ROLE_ID      = process.env.DISCORD_ROLE_ID      || '';
const DISCORD_API          = 'https://discord.com/api/v10';

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

// ─── MONGODB BAĞLANTISI ───────────────────────────────────────────────────────
let mongoConnected = false;

async function connectMongo() {
  const url = process.env.MONGODB_URL;
  if (!url) { console.log('⚠️  MONGODB_URL yok, bot verileri devre dışı'); return; }
  try {
    await mongoose.connect(url);
    mongoConnected = true;
    console.log('✅ MongoDB bağlantısı kuruldu!');
  } catch (e) {
    console.error('❌ MongoDB hatası:', e.message);
  }
}

// ─── MONGOOSE MODELLERİ ───────────────────────────────────────────────────────
const studentSchema = new mongoose.Schema({
  name:         String,
  discordId:    { type: String, unique: true },
  registeredBy: String,
  registeredAt: Date,
  totalLessons: { type: Number, default: 0 },
  lastLessonDate: { type: String, default: null },
}, { timestamps: true });

const lessonSchema = new mongoose.Schema({
  studentId:      String,
  studentName:    String,
  date:           String,
  timestamp:      { type: Date, default: Date.now },
  instructorId:   String,
  category:       { type: String, default: null },
  lessonNumber:   Number,
  lessonSequence: { type: Number, default: 1 },
}, { timestamps: true });

const BotStudent = mongoose.model('Student', studentSchema);
const BotLesson  = mongoose.model('Lesson',  lessonSchema);

// ─── VERİTABANI KURULUM ───────────────────────────────────────────────────────
async function initDatabase() {
  const client = await pool.connect();
  try {
    // ── applications tablosu ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS applications (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(100) NOT NULL,
        surname      VARCHAR(100) NOT NULL,
        age          INTEGER NOT NULL,
        country      VARCHAR(100) NOT NULL,
        rank         VARCHAR(50)  NOT NULL,
        target_rank  VARCHAR(50)  NOT NULL,
        tracker      TEXT,
        expectations TEXT,
        introduction TEXT,
        discord      VARCHAR(100),
        availability TEXT,
        is_read      BOOLEAN DEFAULT false,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS availability TEXT;`).catch(() => {});

    // ── students tablosu ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id                SERIAL PRIMARY KEY,
        name              VARCHAR(100) NOT NULL,
        surname           VARCHAR(100) NOT NULL,
        age               INTEGER NOT NULL,
        country           VARCHAR(100) NOT NULL,
        rank              VARCHAR(50)  NOT NULL,
        target_rank       VARCHAR(50)  NOT NULL,
        tracker           TEXT,
        expectations      TEXT,
        introduction      TEXT,
        discord           VARCHAR(100),
        weekly_schedule   JSONB DEFAULT '{}'::jsonb,
        is_active         BOOLEAN   DEFAULT true,
        total_lessons     INTEGER   DEFAULT 0,
        remaining_lessons INTEGER   DEFAULT 0,
        weekly_lessons    INTEGER   DEFAULT 1,
        archived          BOOLEAN   DEFAULT false,
        archived_at       TIMESTAMP,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Mevcut tabloya eksik kolonları ekle (migration)
    const studentCols = [
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS is_active         BOOLEAN   DEFAULT true`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS total_lessons     INTEGER   DEFAULT 0`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS remaining_lessons INTEGER   DEFAULT 0`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS weekly_lessons    INTEGER   DEFAULT 1`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS archived          BOOLEAN   DEFAULT false`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_at       TIMESTAMP`,
    ];
    for (const q of studentCols) await client.query(q + ';').catch(() => {});

    // ── coaches tablosu ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS coaches (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        surname    VARCHAR(100) NOT NULL,
        username   VARCHAR(100),
        specialty  TEXT,
        contact    TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`ALTER TABLE coaches ADD COLUMN IF NOT EXISTS username VARCHAR(100);`).catch(() => {});

    // ── lesson_types tablosu ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS lesson_types (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL UNIQUE,
        color      VARCHAR(50)  DEFAULT '#6366f1',
        is_default BOOLEAN      DEFAULT false,
        created_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      INSERT INTO lesson_types (name, color, is_default) VALUES
        ('Aim',      '#10b981', true),
        ('Movement', '#ec4899', true),
        ('VOD',      '#6366f1', true),
        ('Gamesense','#8b5cf6', true)
      ON CONFLICT (name) DO NOTHING;
    `).catch(() => {});

    console.log('✅ PostgreSQL tabloları hazır!');
  } catch (error) {
    console.error('❌ Veritabanı kurulum hatası:', error);
  } finally {
    client.release();
  }
}

// ─── DISCORD YARDIMCI ─────────────────────────────────────────────────────────
/**
 * Discord REST API'ye bot token ile istek gönderir.
 * 204 No Content → { success: true }
 * 4xx/5xx        → hata fırlatır
 */
async function discordRequest(method, path, body = null) {
  if (!DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN env değişkeni eksik');
  const opts = {
    method,
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type':  'application/json',
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${DISCORD_API}${path}`, opts);
  if (res.status === 204) return { success: true };
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `Discord API ${res.status}`);
  return data;
}

// ─── DISCORD ENDPOINTLERİ ────────────────────────────────────────────────────

/**
 * POST /api/discord/assign-role
 * Body: { discordId, studentName }
 *
 * Sunucudaki kullanıcıya DISCORD_ROLE_ID rolünü atar.
 * Gerekli bot izni: Manage Roles
 * Rol, bot rolünün hiyerarşide ALTINDA olmalıdır.
 */
app.post('/api/discord/assign-role', async (req, res) => {
  try {
    const { discordId, studentName } = req.body;
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId gerekli' });

    if (!DISCORD_GUILD_ID || !DISCORD_ROLE_ID) {
      return res.status(500).json({
        success: false,
        error: 'DISCORD_GUILD_ID veya DISCORD_ROLE_ID env değişkeni eksik'
      });
    }

    // PUT /guilds/{guild}/members/{user}/roles/{role}  →  204 No Content
    await discordRequest(
      'PUT',
      `/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${DISCORD_ROLE_ID}`
    );

    console.log(`✅ Rol atandı: ${studentName || discordId} (${discordId})`);
    res.json({ success: true, message: `Rol atandı: ${studentName || discordId}` });
  } catch (e) {
    console.error('❌ Rol atama hatası:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/discord/register
 * Body: { discordId, studentName }
 *
 * İsteğe bağlı: DISCORD_LOG_CHANNEL_ID env'de tanımlıysa log kanalına bildirim gönderir.
 * Her durumda success döner (bildirim opsiyoneldir).
 */
app.post('/api/discord/register', async (req, res) => {
  try {
    const { discordId, studentName } = req.body;
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId gerekli' });

    const result = { logged: true, notified: false };

    const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
    if (logChannelId && DISCORD_BOT_TOKEN) {
      try {
        await discordRequest('POST', `/channels/${logChannelId}/messages`, {
          content: [
            `✅ **Yeni öğrenci kaydedildi!**`,
            `👤 İsim: ${studentName || 'Bilinmiyor'}`,
            `🆔 Discord ID: ${discordId}`,
            `📅 Tarih: ${new Date().toLocaleDateString('tr-TR')}`
          ].join('\n')
        });
        result.notified = true;
      } catch (e) {
        console.warn('⚠️  Kanal bildirimi başarısız:', e.message);
      }
    }

    console.log(`✅ Discord kayıt: ${studentName} (${discordId})`);
    res.json({ success: true, result });
  } catch (e) {
    console.error('❌ Discord kayıt hatası:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/discord/user/:discordId
 *
 * Discord kullanıcısının kullanıcı adını ve görünen adını döner.
 * 1 saatlik sunucu taraflı önbellek (rate limit koruması).
 * Yanıt: { success, username, globalName, id }
 */
const discordUsernameCache = new Map();
const DISCORD_CACHE_TTL = 60 * 60 * 1000; // 1 saat

app.get('/api/discord/user/:discordId', async (req, res) => {
  try {
    const { discordId } = req.params;
    if (!discordId) return res.status(400).json({ success: false, error: 'discordId gerekli' });

    // Önbellek kontrolü
    const cached = discordUsernameCache.get(discordId);
    if (cached && Date.now() - cached.cachedAt < DISCORD_CACHE_TTL) {
      return res.json({
        success:    true,
        username:   cached.username,
        globalName: cached.globalName,
        id:         discordId,
        fromCache:  true
      });
    }

    if (!DISCORD_BOT_TOKEN) {
      return res.status(500).json({ success: false, error: 'DISCORD_BOT_TOKEN env eksik' });
    }

    // GET /users/:id
    const user = await discordRequest('GET', `/users/${discordId}`);

    const username   = user.username   || discordId;
    const globalName = user.global_name || user.username || null;

    discordUsernameCache.set(discordId, { username, globalName, cachedAt: Date.now() });

    res.json({ success: true, username, globalName, id: user.id });
  } catch (e) {
    console.error('❌ Discord kullanıcı adı hatası:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── APPLICATIONS ─────────────────────────────────────────────────────────────
app.get('/api/applications', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM applications ORDER BY created_at DESC');
    res.json({ success: true, applications: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/applications', async (req, res) => {
  try {
    const {
      name, surname, age, country, rank, targetRank,
      tracker, expectations, introduction, discord, availability
    } = req.body;
    const r = await pool.query(
      `INSERT INTO applications
         (name,surname,age,country,rank,target_rank,tracker,expectations,introduction,discord,availability)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, availability]
    );
    res.json({ success: true, application: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/applications/:id/mark-read', async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE applications SET is_read=true WHERE id=$1 RETURNING *',
      [req.params.id]
    );
    res.json({ success: true, application: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/applications/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM applications WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── STUDENTS ─────────────────────────────────────────────────────────────────

/**
 * GET /api/students
 * Query: ?archived=true  → sadece arşivlenmiş öğrenciler
 *        (parametre yok) → archived=false olanlar (normal liste)
 */
app.get('/api/students', async (req, res) => {
  try {
    const showArchived = req.query.archived === 'true';
    const r = await pool.query(
      `SELECT * FROM students
       WHERE archived = $1
       ORDER BY is_active DESC, created_at DESC`,
      [showArchived]
    );
    res.json({ success: true, students: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * POST /api/students
 * Yeni öğrenci ekler.
 * remaining_lessons, total_lessons ile aynı başlar.
 * archived = false (varsayılan)
 */
app.post('/api/students', async (req, res) => {
  try {
    const {
      name, surname, age, country, rank, targetRank,
      tracker, expectations, introduction, discord,
      weeklySchedule, totalLessons, weeklyLessons
    } = req.body;

    const tl = parseInt(totalLessons)  || 0;
    const wl = parseInt(weeklyLessons) || 1;

    const r = await pool.query(
      `INSERT INTO students
         (name, surname, age, country, rank, target_rank,
          tracker, expectations, introduction, discord,
          weekly_schedule, is_active,
          total_lessons, remaining_lessons, weekly_lessons,
          archived)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12,$12,$13,false)
       RETURNING *`,
      [
        name, surname, age, country, rank, targetRank,
        tracker, expectations, introduction, discord,
        JSON.stringify(weeklySchedule || {}),
        tl, wl
      ]
    );
    res.json({ success: true, student: r.rows[0], studentId: r.rows[0].id });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * PUT /api/students/:id
 * Kısmi güncelleme: sadece gönderilen alanlar güncellenir.
 * archived=true  → archived_at=NOW(), is_active=false
 * archived=false → archived_at=NULL
 * remaining_lessons <= 0 → is_active=false (otomatik pasife alma)
 */
app.put('/api/students/:id', async (req, res) => {
  try {
    const {
      weeklySchedule, totalLessons, remainingLessons,
      weeklyLessons, isActive, archived
    } = req.body;

    const updates = [];
    const values  = [];
    let idx = 1;

    if (weeklySchedule   !== undefined) {
      updates.push(`weekly_schedule=$${idx++}`);
      values.push(JSON.stringify(weeklySchedule));
    }
    if (totalLessons     !== undefined) {
      updates.push(`total_lessons=$${idx++}`);
      values.push(parseInt(totalLessons));
    }
    if (remainingLessons !== undefined) {
      const rl = parseInt(remainingLessons);
      updates.push(`remaining_lessons=$${idx++}`);
      values.push(rl);
      // Kalan ders sıfırlanırsa otomatik pasife al (isActive override edilmezse)
      if (rl <= 0 && isActive === undefined) {
        updates.push(`is_active=false`);
      }
    }
    if (weeklyLessons    !== undefined) {
      updates.push(`weekly_lessons=$${idx++}`);
      values.push(parseInt(weeklyLessons));
    }
    if (isActive         !== undefined) {
      updates.push(`is_active=$${idx++}`);
      values.push(Boolean(isActive));
    }
    if (archived         !== undefined) {
      updates.push(`archived=$${idx++}`);
      values.push(Boolean(archived));
      if (archived === true) {
        updates.push(`archived_at=NOW()`);
        // Arşivlenince pasife al (is_active zaten false olacak)
        if (isActive === undefined) updates.push(`is_active=false`);
      } else {
        updates.push(`archived_at=NULL`);
      }
    }

    if (!updates.length) {
      return res.json({ success: false, error: 'Güncellenecek alan yok' });
    }

    values.push(req.params.id);
    const r = await pool.query(
      `UPDATE students SET ${updates.join(', ')} WHERE id=$${idx} RETURNING *`,
      values
    );

    if (!r.rows.length) {
      return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    }
    res.json({ success: true, student: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * PUT /api/students/:id/toggle-active
 * is_active durumunu değiştirir.
 * Aktifleştirirken ders paketi de güncellenir.
 */
app.put('/api/students/:id/toggle-active', async (req, res) => {
  try {
    const { isActive, totalLessons, weeklyLessons } = req.body;
    let r;

    if (isActive && totalLessons !== undefined) {
      // Yeniden aktifleştirme — yeni ders paketi ile
      r = await pool.query(
        `UPDATE students
         SET is_active=true,
             total_lessons=$1, remaining_lessons=$1,
             weekly_lessons=$2,
             archived=false, archived_at=NULL
         WHERE id=$3 RETURNING *`,
        [parseInt(totalLessons), parseInt(weeklyLessons) || 1, req.params.id]
      );
    } else {
      r = await pool.query(
        `UPDATE students SET is_active=$1 WHERE id=$2 RETURNING *`,
        [Boolean(isActive), req.params.id]
      );
    }

    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    res.json({ success: true, student: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * DELETE /api/students/:id
 * Kalıcı silme — frontend artık arşivleme kullanıyor.
 * Sadece "Arşiv" ekranındaki "Kalıcı Sil" butonu bu endpoint'i çağırır.
 */
app.delete('/api/students/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── COACHES ──────────────────────────────────────────────────────────────────
app.get('/api/coaches', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM coaches ORDER BY created_at DESC');
    res.json({ success: true, coaches: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/coaches', async (req, res) => {
  try {
    const { name, surname, username, specialty, contact } = req.body;
    const r = await pool.query(
      `INSERT INTO coaches (name, surname, username, specialty, contact)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, surname, username, specialty, contact]
    );
    res.json({ success: true, coach: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/api/coaches/:id', async (req, res) => {
  try {
    const { name, surname, username, specialty, contact } = req.body;
    const r = await pool.query(
      `UPDATE coaches SET name=$1, surname=$2, username=$3, specialty=$4, contact=$5
       WHERE id=$6 RETURNING *`,
      [name, surname, username, specialty, contact, req.params.id]
    );
    res.json({ success: true, coach: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/coaches/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM coaches WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── LESSON TYPES ─────────────────────────────────────────────────────────────
app.get('/api/lesson-types', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM lesson_types ORDER BY is_default DESC, name ASC'
    );
    res.json({ success: true, lessonTypes: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/lesson-types', async (req, res) => {
  try {
    const { name, color } = req.body;
    const r = await pool.query(
      `INSERT INTO lesson_types (name, color, is_default) VALUES ($1, $2, false) RETURNING *`,
      [name, color || '#6366f1']
    );
    res.json({ success: true, lessonType: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') {
      res.status(400).json({ success: false, error: 'Bu ders türü zaten var!' });
    } else {
      res.status(500).json({ success: false, error: e.message });
    }
  }
});

app.delete('/api/lesson-types/:id', async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT is_default FROM lesson_types WHERE id=$1', [req.params.id]
    );
    if (!check.rows.length) return res.status(404).json({ success: false, error: 'Ders türü bulunamadı' });
    if (check.rows[0].is_default) {
      return res.status(400).json({ success: false, error: 'Varsayılan ders türleri silinemez!' });
    }
    await pool.query('DELETE FROM lesson_types WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── BOT API — MongoDB (salt okunur) ─────────────────────────────────────────

app.get('/api/bot/students', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const s = await BotStudent.find({}).sort({ totalLessons: -1 });
    res.json({ success: true, students: s });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/bot/students/:discordId', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const s = await BotStudent.findOne({ discordId: req.params.discordId });
    if (!s) return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    const l = await BotLesson
      .find({ studentId: req.params.discordId })
      .sort({ date: -1, lessonSequence: -1 })
      .limit(20);
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
      BotStudent.countDocuments({}),
      BotLesson.countDocuments({}),
      BotLesson.countDocuments({ date: today }),
      BotStudent.findOne({}).sort({ totalLessons: -1 }),
    ]);

    // Son 7 günün tarihlerini oluştur
    const dates = [];
    for (let i = 6; i >= 0; i--) {
      dates.push(new Date(Date.now() - i * 86400000).toISOString().split('T')[0]);
    }

    const recentLessons = await BotLesson.find(
      { date: { $gte: dates[0] } },
      { date: 1, instructorId: 1, category: 1 }
    );

    const last7Map      = new Map(dates.map(d => [d, 0]));
    const instructorMap = new Map();
    const categoryMap   = new Map();

    for (const l of recentLessons) {
      if (last7Map.has(l.date)) last7Map.set(l.date, last7Map.get(l.date) + 1);
      instructorMap.set(l.instructorId, (instructorMap.get(l.instructorId) || 0) + 1);
      if (l.category) categoryMap.set(l.category, (categoryMap.get(l.category) || 0) + 1);
    }

    const last7Days      = dates.map(d => ({ date: d, count: last7Map.get(d) || 0 }));
    const topInstructors = [...instructorMap.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([id, count]) => ({ id, count }));
    const topCategories  = [...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([cat, count]) => ({ cat, count }));

    res.json({
      success: true,
      stats: {
        totalStudents, totalLessons, todayLessons,
        topStudent: topStudent
          ? { name: topStudent.name, totalLessons: topStudent.totalLessons }
          : null,
        last7Days, topInstructors, topCategories
      }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/bot/match/:discord', async (req, res) => {
  if (!mongoConnected) return res.status(503).json({ success: false, error: 'MongoDB bağlı değil' });
  try {
    const s = await BotStudent.findOne({
      $or: [
        { discordId: req.params.discord },
        { name: { $regex: req.params.discord, $options: 'i' } }
      ]
    });
    if (!s) return res.json({ success: false, error: 'Bulunamadı' });
    const l = await BotLesson
      .find({ studentId: s.discordId })
      .sort({ timestamp: -1 })
      .limit(20);
    res.json({ success: true, student: s, lessons: l });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ─── GENEL ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:    '🚀 AURA Coaching API çalışıyor!',
    mongodb:   mongoConnected ? '✅ Bağlı' : '❌ Bağlı değil',
    timestamp: new Date().toISOString()
  });
});

// Manuel rapor tetikleyici (test için)
app.post('/api/send-test-report', async (req, res) => {
  try {
    await sendDataReport();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── OTOMATİK RAPOR (her 3 günde bir) ────────────────────────────────────────
async function sendDataReport() {
  try {
    const client = await pool.connect();
    const [apps, studs, coachs] = await Promise.all([
      client.query('SELECT * FROM applications ORDER BY created_at DESC'),
      client.query('SELECT * FROM students     ORDER BY created_at DESC'),
      client.query('SELECT * FROM coaches      ORDER BY created_at DESC'),
    ]);
    client.release();

    const activeCount   = studs.rows.filter(s => s.is_active && !s.archived).length;
    const archivedCount = studs.rows.filter(s => s.archived).length;
    const totalWeekly   = studs.rows
      .filter(s => s.is_active && !s.archived)
      .reduce((sum, s) => sum + (parseInt(s.weekly_lessons) || 0), 0);

    const emailHTML = `
      <!DOCTYPE html>
      <html>
      <body style="font-family:sans-serif;background:#0a0e27;color:#fff;padding:30px;">
        <h1 style="color:#6366f1;">AURA Coaching — Özet Rapor</h1>
        <p>Tarih: ${new Date().toLocaleDateString('tr-TR')}</p>
        <ul>
          <li>Aktif Öğrenci: <strong>${activeCount}</strong></li>
          <li>Arşivlenen: <strong>${archivedCount}</strong></li>
          <li>Bekleyen Başvuru: <strong>${apps.rows.length}</strong></li>
          <li>Koç Sayısı: <strong>${coachs.rows.length}</strong></li>
          <li>Toplam Haftalık Ders: <strong>${totalWeekly}</strong></li>
        </ul>
      </body>
      </html>
    `;

    const formData = new URLSearchParams({
      '_subject':  `AURA Coaching Rapor — ${new Date().toLocaleDateString('tr-TR')}`,
      '_template': 'box',
      '_captcha':  'false',
      '_html':     emailHTML
    });

    await fetch('https://formsubmit.co/basvurukocluk@gmail.com', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    formData
    });

    console.log('✅ Otomatik rapor gönderildi.');
  } catch (e) {
    console.error('❌ Rapor gönderme hatası:', e.message);
  }
}

// Her 3 günde bir gece yarısı çalışır
cron.schedule('0 0 */3 * *', () => sendDataReport());

// ─── SUNUCU BAŞLAT ────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  await initDatabase();
  await connectMongo();
  console.log(`🚀 AURA Coaching API çalışıyor! Port: ${PORT}`);
});
