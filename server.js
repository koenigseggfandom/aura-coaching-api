const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL bağlantısı
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use((req, res, next) => {
  console.log('🔥 Gelen İstek:', {
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });
  next();
});
app.use(express.json());

// Email yapılandırması
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'basvurukocluk@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Veritabanı tablolarını oluştur
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
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

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
        specialty TEXT,
        contact TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Veritabanı tabloları hazır!');
  } catch (error) {
    console.error('❌ Veritabanı oluşturma hatası:', error);
  } finally {
    client.release();
  }
}

// Email raporu gönder
async function sendDataReport() {
  try {
    const client = await pool.connect();
    
    const applicationsResult = await client.query('SELECT * FROM applications ORDER BY created_at DESC');
    const studentsResult = await client.query('SELECT * FROM students ORDER BY created_at DESC');
    const coachesResult = await client.query('SELECT * FROM coaches ORDER BY created_at DESC');
    
    client.release();

    const applications = applicationsResult.rows;
    const students = studentsResult.rows;
    const coaches = coachesResult.rows;

    const emailContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1200px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #6366f1, #ec4899); color: white; padding: 30px; text-align: center; border-radius: 10px; margin-bottom: 20px; }
          .section { margin: 20px 0; padding: 20px; border: 2px solid #e0e0e0; border-radius: 8px; background: #f9f9f9; }
          .stat-container { display: flex; justify-content: space-around; margin: 20px 0; }
          .stat { text-align: center; padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); flex: 1; margin: 0 10px; }
          .stat-number { font-size: 36px; font-weight: bold; color: #6366f1; margin: 10px 0; }
          .stat-label { font-size: 14px; color: #666; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; margin: 15px 0; background: white; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background-color: #6366f1; color: white; font-weight: 600; }
          tr:hover { background-color: #f5f5f5; }
          .footer { margin-top: 30px; padding: 20px; background: #f0f0f0; text-align: center; border-radius: 8px; }
          .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
          .badge-rank { background: #e3f2fd; color: #1976d2; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>🎮 AURA COACHING</h1>
          <h2>3 Günlük Veri Raporu</h2>
          <p style="font-size: 16px; margin: 10px 0;">${new Date().toLocaleDateString('tr-TR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        
        <div class="section">
          <h2 style="color: #6366f1; margin-bottom: 20px;">📊 Genel İstatistikler</h2>
          <div class="stat-container">
            <div class="stat">
              <div class="stat-label">Toplam Başvuru</div>
              <div class="stat-number">${applications.length}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Toplam Öğrenci</div>
              <div class="stat-number">${students.length}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Toplam Koç</div>
              <div class="stat-number">${coaches.length}</div>
            </div>
          </div>
        </div>
        
        ${applications.length > 0 ? `
        <div class="section">
          <h2 style="color: #6366f1;">📝 Tüm Başvurular (${applications.length})</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Ad Soyad</th>
                <th>Yaş</th>
                <th>Ülke</th>
                <th>Mevcut Rank</th>
                <th>Hedef Rank</th>
                <th>Discord</th>
                <th>Durum</th>
                <th>Tarih</th>
              </tr>
            </thead>
            <tbody>
              ${applications.map(app => `
                <tr>
                  <td>#${app.id}</td>
                  <td><strong>${app.name} ${app.surname}</strong></td>
                  <td>${app.age}</td>
                  <td>${app.country}</td>
                  <td><span class="badge badge-rank">${app.rank}</span></td>
                  <td><span class="badge badge-rank">${app.target_rank}</span></td>
                  <td>${app.discord || '-'}</td>
                  <td>${app.is_read ? '✓ Okundu' : '● Yeni'}</td>
                  <td>${new Date(app.created_at).toLocaleDateString('tr-TR')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : '<div class="section"><p>Henüz başvuru yok.</p></div>'}
        
        ${students.length > 0 ? `
        <div class="section">
          <h2 style="color: #6366f1;">👨‍🎓 Kayıtlı Öğrenciler (${students.length})</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Ad Soyad</th>
                <th>Yaş</th>
                <th>Ülke</th>
                <th>Mevcut Rank</th>
                <th>Hedef Rank</th>
                <th>Discord</th>
                <th>Haftalık Ders</th>
                <th>Kayıt Tarihi</th>
              </tr>
            </thead>
            <tbody>
              ${students.map(student => {
                let totalLessons = 0;
                if (student.weekly_schedule) {
                  Object.keys(student.weekly_schedule).forEach(day => {
                    const lessons = student.weekly_schedule[day];
                    if (Array.isArray(lessons)) {
                      totalLessons += lessons.filter(l => l && l.time).length;
                    } else if (lessons && lessons.time) {
                      totalLessons += 1;
                    }
                  });
                }
                return `
                  <tr>
                    <td>#${student.id}</td>
                    <td><strong>${student.name} ${student.surname}</strong></td>
                    <td>${student.age}</td>
                    <td>${student.country}</td>
                    <td><span class="badge badge-rank">${student.rank}</span></td>
                    <td><span class="badge badge-rank">${student.target_rank}</span></td>
                    <td>${student.discord || '-'}</td>
                    <td>${totalLessons} ders/hafta</td>
                    <td>${new Date(student.created_at).toLocaleDateString('tr-TR')}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        ` : '<div class="section"><p>Henüz kayıtlı öğrenci yok.</p></div>'}
        
        ${coaches.length > 0 ? `
        <div class="section">
          <h2 style="color: #6366f1;">🎯 Koçlar (${coaches.length})</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Ad Soyad</th>
                <th>Uzmanlık</th>
                <th>İletişim</th>
                <th>Kayıt Tarihi</th>
              </tr>
            </thead>
            <tbody>
              ${coaches.map(coach => `
                <tr>
                  <td>#${coach.id}</td>
                  <td><strong>${coach.name} ${coach.surname}</strong></td>
                  <td>${coach.specialty}</td>
                  <td>${coach.contact}</td>
                  <td>${new Date(coach.created_at).toLocaleDateString('tr-TR')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ` : '<div class="section"><p>Henüz koç eklenmemiş.</p></div>'}
        
        <div class="footer">
          <p><strong>AURA Coaching</strong> - Profesyonel Valorant Koçluk Sistemi</p>
          <p>Bu rapor otomatik olarak her 3 günde bir gönderilmektedir.</p>
          <p>📅 ${new Date().toLocaleString('tr-TR')}</p>
        </div>
      </body>
      </html>
    `;
    
    await transporter.sendMail({
      from: 'AURA Coaching <basvurukocluk@gmail.com>',
      to: 'basvurukocluk@gmail.com',
      subject: `📊 AURA Coaching - 3 Günlük Veri Raporu - ${new Date().toLocaleDateString('tr-TR')}`,
      html: emailContent
    });
    
    console.log('✅ Email raporu başarıyla gönderildi!', new Date().toLocaleString('tr-TR'));
    
  } catch (error) {
    console.error('❌ Email gönderme hatası:', error);
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'AURA Coaching API çalışıyor! (PostgreSQL)',
    timestamp: new Date().toISOString()
  });
});

// ============ BAŞVURULAR ============

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
    const { name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord } = req.body;
    
    const result = await pool.query(
      `INSERT INTO applications (name, surname, age, country, rank, target_rank, tracker, expectations, introduction, discord) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [name, surname, age, country, rank, targetRank, tracker, expectations, introduction, discord]
    );
    
    res.json({ success: true, application: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/applications/:id/mark-read', async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE applications SET is_read = true WHERE id = $1 RETURNING *',
      [req.params.id]
    );
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

// ============ ÖĞRENCİLER ============

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
    
    const result = await pool.query(
      'UPDATE students SET weekly_schedule = $1 WHERE id = $2 RETURNING *',
      [JSON.stringify(weeklySchedule), req.params.id]
    );
    
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

// ============ KOÇLAR ============

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
    const { name, surname, specialty, contact } = req.body;
    
    const result = await pool.query(
      'INSERT INTO coaches (name, surname, specialty, contact) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, surname, specialty, contact]
    );
    
    res.json({ success: true, coach: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/coaches/:id', async (req, res) => {
  try {
    const { name, surname, specialty, contact } = req.body;
    
    const result = await pool.query(
      'UPDATE coaches SET name = $1, surname = $2, specialty = $3, contact = $4 WHERE id = $5 RETURNING *',
      [name, surname, specialty, contact, req.params.id]
    );
    
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

// Her 3 günde bir rapor gönder (00:00'da)
cron.schedule('0 0 */3 * *', () => {
  console.log('🔔 3 günlük rapor gönderme zamanı!', new Date().toLocaleString('tr-TR'));
  sendDataReport();
});

// İLK TEST RAPORU (5 saniye sonra) - İsterseniz kaldırabilirsiniz
setTimeout(() => {
  console.log('📧 İlk test raporu gönderiliyor...');
  sendDataReport();
}, 5000);

// Server başlat
app.listen(PORT, async () => {
  await initDatabase();
  console.log(`🚀 AURA Coaching API ${PORT} portunda çalışıyor! (PostgreSQL)`);
});
