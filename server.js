const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ PostgreSQL bağlantısı - DATABASE_URL Railway tarafından otomatik verilir
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

// ✅ Veritabanı tablolarını oluştur (ilk çalıştırmada)
async function initDatabase() {
  const client = await pool.connect();
  try {
    // Başvurular tablosu
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

    // Mevcut tablolara yeni kolonları ekle (zaten varsa hata vermesin)
    await client.query(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS availability TEXT;`).catch(() => {});

    // Öğrenciler tablosu
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

    // Koçlar tablosu
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

    // Mevcut coaches tablosuna username kolonunu ekle (zaten varsa hata vermesin)
    await client.query(`ALTER TABLE coaches ADD COLUMN IF NOT EXISTS username VARCHAR(100);`).catch(() => {});

    console.log('✅ PostgreSQL tabloları hazır!');
  } catch (error) {
    console.error('❌ Veritabanı hatası:', error);
  } finally {
    client.release();
  }
}

// ✅ FormSubmit ile Email Gönder
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

    // HTML Email İçeriği
    const emailHTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:1200px;margin:0 auto;background:#f5f5f5;padding:20px}
.header{background:linear-gradient(135deg,#6366f1,#ec4899);color:#fff;padding:40px;text-align:center;border-radius:10px;margin-bottom:30px}
.header h1{margin:0 0 10px;font-size:42px}.header p{margin:0;font-size:16px;opacity:.9}
.stats{display:flex;justify-content:space-around;margin:30px 0;gap:20px}
.stat{background:#fff;padding:30px;border-radius:12px;text-align:center;flex:1;box-shadow:0 2px 8px rgba(0,0,0,.1)}
.stat-number{font-size:48px;font-weight:700;color:#6366f1;margin-bottom:10px}
.stat-label{font-size:14px;color:#666;text-transform:uppercase;letter-spacing:1px}
.section{background:#fff;padding:30px;border-radius:12px;margin-bottom:30px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
.section-title{font-size:24px;font-weight:600;color:#6366f1;margin-bottom:20px;padding-bottom:10px;border-bottom:2px solid #e0e0e0}
table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #e0e0e0}
th{background:#f8f9fa;color:#6366f1;font-weight:600;font-size:13px;text-transform:uppercase}
tr:hover{background:#f8f9fa}.badge{display:inline-block;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600}
.badge-rank{background:#e3f2fd;color:#1976d2}.badge-new{background:#e8f5e9;color:#388e3c}.badge-read{background:#f5f5f5;color:#666}
.empty{text-align:center;padding:40px;color:#999;font-style:italic}
.footer{text-align:center;padding:30px;background:#fff;border-radius:12px;margin-top:30px;color:#666}
</style></head><body>
<div class="header"><h1>🎮 AURA COACHING</h1>
<p>3 Günlük Veri Raporu - ${new Date().toLocaleDateString('tr-TR',{weekday:'long',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p></div>
<div class="stats">
<div class="stat"><div class="stat-number">${applications.length}</div><div class="stat-label">Toplam Başvuru</div></div>
<div class="stat"><div class="stat-number">${students.length}</div><div class="stat-label">Toplam Öğrenci</div></div>
<div class="stat"><div class="stat-number">${coaches.length}</div><div class="stat-label">Toplam Koç</div></div>
</div>
${applications.length>0?`<div class="section"><h2 class="section-title">📝 Tüm Başvurular (${applications.length})</h2><table><thead><tr><th>ID</th><th>Ad Soyad</th><th>Yaş</th><th>Ülke</th><th>Mevcut Rank</th><th>Hedef Rank</th><th>Discord</th><th>Durum</th><th>Tarih</th></tr></thead><tbody>${applications.map(a=>`<tr><td>#${a.id}</td><td><strong>${a.name} ${a.surname}</strong></td><td>${a.age}</td><td>${a.country}</td><td><span class="badge badge-rank">${a.rank}</span></td><td><span class="badge badge-rank">${a.target_rank}</span></td><td>${a.discord||'-'}</td><td><span class="badge ${a.is_read?'badge-read':'badge-new'}">${a.is_read?'✓ Okundu':'● Yeni'}</span></td><td>${new Date(a.created_at).toLocaleDateString('tr-TR')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="section"><div class="empty">Henüz başvuru yok</div></div>'}
${students.length>0?`<div class="section"><h2 class="section-title">👨‍🎓 Kayıtlı Öğrenciler (${students.length})</h2><table><thead><tr><th>ID</th><th>Ad Soyad</th><th>Yaş</th><th>Ülke</th><th>Mevcut Rank</th><th>Hedef Rank</th><th>Discord</th><th>Haftalık Ders</th><th>Kayıt</th></tr></thead><tbody>${students.map(s=>{let t=0;if(s.weekly_schedule)Object.keys(s.weekly_schedule).forEach(d=>{const l=s.weekly_schedule[d];if(Array.isArray(l))t+=l.filter(x=>x&&x.time).length;else if(l&&l.time)t+=1});return`<tr><td>#${s.id}</td><td><strong>${s.name} ${s.surname}</strong></td><td>${s.age}</td><td>${s.country}</td><td><span class="badge badge-rank">${s.rank}</span></td><td><span class="badge badge-rank">${s.target_rank}</span></td><td>${s.discord||'-'}</td><td>${t} ders</td><td>${new Date(s.created_at).toLocaleDateString('tr-TR')}</td></tr>`}).join('')}</tbody></table></div>`:'<div class="section"><div class="empty">Henüz öğrenci yok</div></div>'}
${coaches.length>0?`<div class="section"><h2 class="section-title">🎯 Koçlar (${coaches.length})</h2><table><thead><tr><th>ID</th><th>Ad Soyad</th><th>Uzmanlık</th><th>İletişim</th><th>Kayıt</th></tr></thead><tbody>${coaches.map(c=>`<tr><td>#${c.id}</td><td><strong>${c.name} ${c.surname}</strong></td><td>${c.specialty}</td><td>${c.contact}</td><td>${new Date(c.created_at).toLocaleDateString('tr-TR')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="section"><div class="empty">Henüz koç yok</div></div>'}
<div class="footer"><p><strong>AURA Coaching</strong> - Profesyonel Valorant Koçluk Sistemi</p>
<p>Bu rapor otomatik olarak her 3 günde bir gönderilmektedir.</p>
<p>📅 ${new Date().toLocaleString('tr-TR')}</p></div>
</body></html>`;

    // FormSubmit'e gönder
    const formData = new URLSearchParams({
      '_subject': `📊 AURA Coaching - 3 Günlük Rapor - ${new Date().toLocaleDateString('tr-TR')}`,
      '_template': 'box',
      '_captcha': 'false',
      '_html': emailHTML,
      'toplam_basvuru': applications.length,
      'toplam_ogrenci': students.length,
      'toplam_koc': coaches.length
    });

    const response = await fetch('https://formsubmit.co/basvurukocluk@gmail.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData
    });

    if (response.ok) {
      console.log('✅ Email başarıyla gönderildi!', new Date().toLocaleString('tr-TR'));
    } else {
      console.error('❌ Email hatası:', response.statusText);
    }
  } catch (error) {
    console.error('❌ Email gönderme hatası:', error);
  }
}

// ============ API ENDPOINTS ============

app.get('/', (req, res) => {
  res.json({ 
    status: '🚀 AURA Coaching API çalışıyor!',
    database: 'PostgreSQL',
    email: 'FormSubmit (Her 3 günde bir)',
    timestamp: new Date().toISOString()
  });
});

// TEST EMAIL
app.post('/api/send-test-report', async (req, res) => {
  try {
    await sendDataReport();
    res.json({ success: true, message: 'Test emaili gönderildi!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// BAŞVURULAR
app.get('/api/applications', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM applications ORDER BY created_at DESC');
    res.json({ success: true, applications: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/applications', async (req, res) => {
  try {
    const { name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, availability } = req.body;
    const result = await pool.query(
      `INSERT INTO applications (name, surname, age, country, rank, target_rank, tracker, expectations, introduction, discord, availability) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, availability]
    );
    res.json({ success: true, application: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/applications/:id/mark-read', async (req, res) => {
  try {
    const result = await pool.query('UPDATE applications SET is_read = true WHERE id = $1 RETURNING *', [req.params.id]);
    res.json({ success: true, application: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/applications/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM applications WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ÖĞRENCİLER
app.get('/api/students', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM students ORDER BY created_at DESC');
    res.json({ success: true, students: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/students', async (req, res) => {
  try {
    const { name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, weeklySchedule } = req.body;
    const result = await pool.query(
      `INSERT INTO students (name, surname, age, country, rank, target_rank, tracker, expectations, introduction, discord, weekly_schedule) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord, JSON.stringify(weeklySchedule || {})]
    );
    res.json({ success: true, student: result.rows[0], studentId: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/students/:id', async (req, res) => {
  try {
    const { weeklySchedule } = req.body;
    const result = await pool.query('UPDATE students SET weekly_schedule = $1 WHERE id = $2 RETURNING *', [JSON.stringify(weeklySchedule), req.params.id]);
    res.json({ success: true, student: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// KOÇLAR
app.get('/api/coaches', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM coaches ORDER BY created_at DESC');
    res.json({ success: true, coaches: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/coaches', async (req, res) => {
  try {
    const { name, surname, username, specialty, contact } = req.body;
    const result = await pool.query('INSERT INTO coaches (name, surname, username, specialty, contact) VALUES ($1, $2, $3, $4, $5) RETURNING *', [name, surname, username, specialty, contact]);
    res.json({ success: true, coach: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/coaches/:id', async (req, res) => {
  try {
    const { name, surname, username, specialty, contact } = req.body;
    const result = await pool.query('UPDATE coaches SET name=$1, surname=$2, username=$3, specialty=$4, contact=$5 WHERE id=$6 RETURNING *', [name, surname, username, specialty, contact, req.params.id]);
    res.json({ success: true, coach: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/coaches/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM coaches WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ✅ HER 3 GÜNDE BİR OTOMATİK EMAİL (Gece 00:00'da)
cron.schedule('0 0 */3 * *', () => {
  console.log('🔔 3 günlük rapor zamanı!', new Date().toLocaleString('tr-TR'));
  sendDataReport();
});

// ✅ İLK TEST EMAİLİ (5 saniye sonra) - İsterseniz kaldırabilirsiniz
setTimeout(() => {
  console.log('📧 İlk test raporu gönderiliyor...');
  sendDataReport();
}, 5000);

// ✅ SERVER BAŞLAT
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`🚀 AURA Coaching API çalışıyor! Port: ${PORT}`);
  console.log(`📊 PostgreSQL: Bağlı`);
  console.log(`📧 Email: Her 3 günde bir otomatik`);
});
