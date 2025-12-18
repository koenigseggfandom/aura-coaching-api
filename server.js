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
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB bağlantı hatası:'));
db.once('open', () => {
  console.log('✅ MongoDB bağlantısı başarılı!');
});

// Middleware
app.use(cors());
app.use(express.json());

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
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
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

// Koç Schema'sı
const coachSchema = new mongoose.Schema({
  name: String,
  surname: String,
  email: String,
  discord: String,
  specialization: String,
  createdAt: { type: Date, default: Date.now }
});

const Coach = mongoose.model('Coach', coachSchema);

// Öğrenci Schema'sı - DÜZELTİLDİ
const studentSchema = new mongoose.Schema({
  name: String,
  surname: String,
  age: Number,
  country: String,
  rank: String,
  targetRank: String,
  tracker: String,
  expectations: String,
  introduction: String,
  discord: String,
  profileImage: String, // YENİ: Profil resmi URL'si
  weeklySchedule: {
    type: Map,
    of: new mongoose.Schema({
      time: String,
      duration: String,
      lessonType: String, // YENİ: Ders tipi (Vod, Aim, vb)
      coachId: String // YENİ: Hangi koçun dersi
    }, { _id: false })
  },
  createdAt: { type: Date, default: Date.now }
});

const Student = mongoose.model('Student', studentSchema);

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'AURA Coaching API çalışıyor!',
    timestamp: new Date().toISOString(),
    mongodb: db.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ============ YENİ KOÇ ENDPOINT'LERİ ============

// Tüm koçları getir
app.get('/api/coaches', async (req, res) => {
  try {
    const coaches = await Coach.find().sort({ createdAt: -1 });
    res.json({ success: true, coaches });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni koç ekle
app.post('/api/coaches', async (req, res) => {
  try {
    const coach = new Coach(req.body);
    await coach.save();
    res.json({ success: true, coachId: coach._id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Koç sil
app.delete('/api/coaches/:id', async (req, res) => {
  try {
    await Coach.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Koç güncelle
app.put('/api/coaches/:id', async (req, res) => {
  try {
    await Coach.findByIdAndUpdate(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ BAŞVURULAR ============

// Tüm başvuruları getir
app.get('/api/applications', async (req, res) => {
  try {
    const data = await readData();
    res.json({ success: true, applications: data.applications });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni başvuru ekle (index.html'den gelecek)
app.post('/api/applications', async (req, res) => {
  try {
    const data = await readData();
    const newApplication = {
      id: Date.now(),
      ...req.body,
      date: new Date().toISOString()
    };
    
    data.applications.push(newApplication);
    await writeData(data);
    
    res.json({ success: true, application: newApplication });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Başvuru sil
app.delete('/api/applications/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = parseInt(req.params.id);
    
    data.applications = data.applications.filter(app => app.id !== id);
    await writeData(data);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ ÖĞRENCİLER (MongoDB'ye geçirildi) ============

// Tüm öğrencileri getir
app.get('/api/students', async (req, res) => {
  try {
    const students = await Student.find().sort({ createdAt: -1 });
    res.json({ success: true, students });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni öğrenci ekle
app.post('/api/students', async (req, res) => {
  try {
    const student = new Student(req.body);
    await student.save();
    res.json({ success: true, studentId: student._id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Öğrenci güncelle
app.put('/api/students/:id', async (req, res) => {
  try {
    const updatedStudent = await Student.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!updatedStudent) {
      return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    }
    
    res.json({ success: true, student: updatedStudent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Öğrenci sil
app.delete('/api/students/:id', async (req, res) => {
  try {
    const deletedStudent = await Student.findByIdAndDelete(req.params.id);
    
    if (!deletedStudent) {
      return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    }
    
    res.json({ success: true, message: 'Öğrenci başarıyla silindi' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Öğrenci detaylarını getir
app.get('/api/students/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    
    if (!student) {
      return res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    }
    
    res.json({ success: true, student });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ DERSLER ============

// Tüm dersleri getir
app.get('/api/lessons', async (req, res) => {
  try {
    const data = await readData();
    res.json({ success: true, lessons: data.lessons });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni ders ekle
app.post('/api/lessons', async (req, res) => {
  try {
    const data = await readData();
    const newLesson = {
      id: Date.now(),
      ...req.body
    };
    
    data.lessons.push(newLesson);
    await writeData(data);
    
    res.json({ success: true, lesson: newLesson });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ders sil
app.delete('/api/lessons/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = parseInt(req.params.id);
    
    data.lessons = data.lessons.filter(l => l.id !== id);
    await writeData(data);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============ KOÇ DETAY ENDPOINT'İ ============

// Koç detaylarını getir
app.get('/api/coaches/:id', async (req, res) => {
  try {
    const coach = await Coach.findById(req.params.id);
    
    if (!coach) {
      return res.status(404).json({ success: false, error: 'Koç bulunamadı' });
    }
    
    res.json({ success: true, coach });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Server başlat
app.listen(PORT, async () => {
  await initDataFile();
  console.log(`🚀 AURA Coaching API ${PORT} portunda çalışıyor!`);
});
