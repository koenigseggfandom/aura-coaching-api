const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB bağlantısı
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aura_coaching';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB bağlantısı başarılı!'))
.catch((err) => console.error('❌ MongoDB bağlantı hatası:', err));

const db = mongoose.connection;

// ============ CORS AYARLARI - ÇOK ÖNEMLİ ============
app.use(cors({
  origin: '*', // Tüm originlere izin ver (production'da belirli domain'lere sınırlayın)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// OPTIONS request'leri için özel handler
app.options('*', cors());

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Veri dosyası yolu
const DATA_FILE = path.join(__dirname, 'data.json');

// Başlangıç verisi
const initialData = {
  applications: [],
  students: [],
  lessons: []
};

// Veri dosyasını başlat
async function initDataFile() {
  try {
    await fs.access(DATA_FILE);
    console.log('✅ data.json dosyası mevcut');
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ data.json dosyası oluşturuldu');
  }
}

// Veriyi oku
async function readData() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Veri okuma hatası:', error);
    return initialData;
  }
}

// Veriyi yaz
async function writeData(data) {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Veri yazma hatası:', error);
    return false;
  }
}

// ============ MONGODB SCHEMAS ============

// Koç Schema'sı
const coachSchema = new mongoose.Schema({
  name: { type: String, required: true },
  surname: { type: String, required: true },
  email: String,
  discord: String,
  specialization: String,
  createdAt: { type: Date, default: Date.now }
});

const Coach = mongoose.model('Coach', coachSchema);

// Öğrenci Schema'sı
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  surname: { type: String, required: true },
  age: Number,
  country: String,
  rank: String,
  targetRank: String,
  tracker: String,
  expectations: String,
  introduction: String,
  discord: String,
  profileImage: String,
  weeklySchedule: {
    type: Map,
    of: new mongoose.Schema({
      time: String,
      duration: String,
      lessonType: String,
      coachId: String
    }, { _id: false })
  },
  createdAt: { type: Date, default: Date.now }
});

const Student = mongoose.model('Student', studentSchema);

// ============ HEALTH CHECK ============
app.get('/', (req, res) => {
  res.json({ 
    status: 'AURA Coaching API çalışıyor!',
    timestamp: new Date().toISOString(),
    mongodb: db.readyState === 1 ? 'connected' : 'disconnected',
    endpoints: {
      applications: '/api/applications',
      students: '/api/students',
      coaches: '/api/coaches',
      lessons: '/api/lessons'
    }
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'API çalışıyor!',
    timestamp: new Date().toISOString()
  });
});

// ============ KOÇ ENDPOINTS ============

// Tüm koçları getir
app.get('/api/coaches', async (req, res) => {
  try {
    const coaches = await Coach.find().sort({ createdAt: -1 });
    res.json({ success: true, coaches });
  } catch (error) {
    console.error('Koç listeleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Koç detayı getir
app.get('/api/coaches/:id', async (req, res) => {
  try {
    const coach = await Coach.findById(req.params.id);
    
    if (!coach) {
      return res.status(404).json({ success: false, error: 'Koç bulunamadı' });
    }
    
    res.json({ success: true, coach });
  } catch (error) {
    console.error('Koç detay hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni koç ekle
app.post('/api/coaches', async (req, res) => {
  try {
    const coach = new Coach(req.body);
    await coach.save();
    console.log('✅ Yeni koç eklendi:', coach.name);
    res.json({ success: true, coachId: coach._id, coach });
  } catch (error) {
    console.error('Koç ekleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Koç güncelle
app.put('/api/coaches/:id', async (req, res) => {
  try {
    const coach = await Coach.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      { new: true, runValidators: true }
    );
    
    if (!coach) {
      return res.status(404).json({ success: false, error: 'Koç bulunamadı' });
    }
    
    console.log('✅ Koç güncellendi:', coach.name);
    res.json({ success: true, coach });
  } catch (error) {
    console.error('Koç güncelleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Koç sil
app.delete('/api/coaches/:id', async (req, res) => {
  try {
    const coach = await Coach.findByIdAndDelete(req.params.id);
    
    if (!coach) {
      return res.status(404).json({ success: false, error: 'Koç bulunamadı' });
    }
    
    console.log('✅ Koç silindi:', coach.name);
    res.json({ success: true, message: 'Koç başarıyla silindi' });
  } catch (error) {
    console.error('Koç silme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ BAŞVURU ENDPOINTS (data.json) ============

// Tüm başvuruları getir
app.get('/api/applications', async (req, res) => {
  try {
    const data = await readData();
    res.json({ success: true, applications: data.applications });
  } catch (error) {
    console.error('Başvuru listeleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni başvuru ekle (index.html'den gelecek)
app.post('/api/applications', async (req, res) => {
  try {
    console.log('📝 Yeni başvuru alındı:', req.body);
    
    const data = await readData();
    const newApplication = {
      id: Date.now(),
      ...req.body,
      date: new Date().toISOString()
    };
    
    data.applications.push(newApplication);
    const saved = await writeData(data);
    
    if (!saved) {
      throw new Error('Veri kaydedilemedi');
    }
    
    console.log('✅ Başvuru kaydedildi:', newApplication.name);
    res.json({ success: true, application: newApplication });
  } catch (error) {
    console.error('Başvuru kaydetme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Başvuru sil
app.delete('/api/applications/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = parseInt(req.params.id);
    
    const initialLength = data.applications.length;
    data.applications = data.applications.filter(app => app.id !== id);
    
    if (data.applications.length === initialLength) {
      return res.status(404).json({ success: false, error: 'Başvuru bulunamadı' });
    }
    
    await writeData(data);
    console.log('✅ Başvuru silindi:', id);
    res.json({ success: true, message: 'Başvuru silindi' });
  } catch (error) {
    console.error('Başvuru silme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ ÖĞRENCİ ENDPOINTS (MongoDB) ============

// Tüm öğrencileri getir
app.get('/api/students', async (req, res) => {
  try {
    const students = await Student.find().sort({ createdAt: -1 });
    res.json({ success: true, students });
  } catch (error) {
    console.error('Öğrenci listeleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Öğrenci detayı getir
app.get('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    
    if (!student) {
      return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    }
    
    res.json({ success: true, student });
  } catch (error) {
    console.error('Öğrenci detay hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni öğrenci ekle
app.post('/api/students', async (req, res) => {
  try {
    console.log('📝 Yeni öğrenci ekleniyor:', req.body);
    
    const student = new Student(req.body);
    await student.save();
    
    console.log('✅ Öğrenci kaydedildi:', student.name);
    res.json({ success: true, studentId: student._id, student });
  } catch (error) {
    console.error('Öğrenci ekleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Öğrenci güncelle
app.put('/api/students/:id', async (req, res) => {
  try {
    console.log('🔄 Öğrenci güncelleniyor:', req.params.id);
    
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!student) {
      return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    }
    
    console.log('✅ Öğrenci güncellendi:', student.name);
    res.json({ success: true, student });
  } catch (error) {
    console.error('Öğrenci güncelleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Öğrenci sil
app.delete('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findByIdAndDelete(req.params.id);
    
    if (!student) {
      return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    }
    
    console.log('✅ Öğrenci silindi:', student.name);
    res.json({ success: true, message: 'Öğrenci başarıyla silindi' });
  } catch (error) {
    console.error('Öğrenci silme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ DERS ENDPOINTS (data.json) ============

// Tüm dersleri getir
app.get('/api/lessons', async (req, res) => {
  try {
    const data = await readData();
    res.json({ success: true, lessons: data.lessons });
  } catch (error) {
    console.error('Ders listeleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni ders ekle
app.post('/api/lessons', async (req, res) => {
  try {
    const data = await readData();
    const newLesson = {
      id: Date.now(),
      ...req.body,
      createdAt: new Date().toISOString()
    };
    
    data.lessons.push(newLesson);
    await writeData(data);
    
    console.log('✅ Ders eklendi:', newLesson);
    res.json({ success: true, lesson: newLesson });
  } catch (error) {
    console.error('Ders ekleme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ders sil
app.delete('/api/lessons/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = parseInt(req.params.id);
    
    const initialLength = data.lessons.length;
    data.lessons = data.lessons.filter(l => l.id !== id);
    
    if (data.lessons.length === initialLength) {
      return res.status(404).json({ success: false, error: 'Ders bulunamadı' });
    }
    
    await writeData(data);
    console.log('✅ Ders silindi:', id);
    res.json({ success: true, message: 'Ders silindi' });
  } catch (error) {
    console.error('Ders silme hatası:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ ERROR HANDLING ============

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Endpoint bulunamadı',
    path: req.path 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Sunucu hatası:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Sunucu hatası',
    message: err.message 
  });
});

// ============ SERVER START ============

async function startServer() {
  try {
    await initDataFile();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log('='.repeat(50));
      console.log('🚀 AURA Coaching API Başlatıldı!');
      console.log('='.repeat(50));
      console.log(`📡 Port: ${PORT}`);
      console.log(`🌐 URL: http://localhost:${PORT}`);
      console.log(`💾 MongoDB: ${db.readyState === 1 ? '✅ Bağlı' : '❌ Bağlı Değil'}`);
      console.log(`📁 Data File: ${DATA_FILE}`);
      console.log('='.repeat(50));
    });
  } catch (error) {
    console.error('❌ Server başlatma hatası:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('⚠️ SIGTERM sinyali alındı, sunucu kapatılıyor...');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⚠️ SIGINT sinyali alındı, sunucu kapatılıyor...');
  await mongoose.connection.close();
  process.exit(0);
});

startServer();
