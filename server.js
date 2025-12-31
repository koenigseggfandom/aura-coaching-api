const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use((req, res, next) => {
    console.log('📥 Gelen İstek:', {
        method: req.method,
        url: req.url,
        timestamp: new Date().toISOString(),
        ip: req.ip,
        body: req.method === 'POST' || req.method === 'PUT' ? req.body : {}
    });
    next();
});
app.use(express.json());

// Veri dosyası yolu
const DATA_FILE = path.join(__dirname, 'data.json');

// Başlangıç verisi
const initialData = {
  applications: [],
  students: [],
  lessons: [],
  coaches: []
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
    let parsedData = JSON.parse(data);
    
    // Eski veriler için isRead alanını ekle
    parsedData.applications = parsedData.applications.map(app => ({
      ...app,
      isRead: app.isRead !== undefined ? app.isRead : false
    }));
    
    return parsedData;
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

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'AURA Coaching API çalışıyor!',
    timestamp: new Date().toISOString()
  });
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
      isRead: false,
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

// Başvuruyu okundu olarak işaretle
app.put('/api/applications/:id/mark-read', async (req, res) => {
  try {
    const data = await readData();
    const id = parseInt(req.params.id);
    
    const index = data.applications.findIndex(app => app.id === id);
    if (index !== -1) {
      data.applications[index].isRead = true;
      await writeData(data);
      res.json({ success: true, application: data.applications[index] });
    } else {
      res.status(404).json({ success: false, error: 'Başvuru bulunamadı' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// server.js'ye ekleyin
app.get('/admin-view', async (req, res) => {
    try {
        const data = await readData();
        
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>AURA Coaching - Veri Görüntüleme</title>
            <style>
                body { font-family: Arial; padding: 20px; }
                .section { margin-bottom: 30px; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                .count { font-size: 20px; font-weight: bold; color: #4CAF50; }
            </style>
        </head>
        <body>
            <h1>📊 AURA Coaching Veri Görüntüleme</h1>
            <p>Son güncelleme: ${new Date().toLocaleString('tr-TR')}</p>
            
            <div class="section">
                <h2>📈 İstatistikler</h2>
                <p>Toplam Başvuru: <span class="count">${data.applications.length}</span></p>
                <p>Toplam Öğrenci: <span class="count">${data.students.length}</span></p>
                <p>Toplam Koç: <span class="count">${data.coaches.length}</span></p>
            </div>
        `;
        
        // Başvurular
        if (data.applications.length > 0) {
            html += `
            <div class="section">
                <h2>📝 Son Başvurular</h2>
                <table>
                    <tr><th>Ad Soyad</th><th>Yaş</th><th>Ülke</th><th>Rank</th><th>Tarih</th></tr>
                    ${data.applications.slice(-10).reverse().map(app => `
                        <tr>
                            <td>${app.name} ${app.surname}</td>
                            <td>${app.age}</td>
                            <td>${app.country}</td>
                            <td>${app.rank}</td>
                            <td>${new Date(app.date).toLocaleDateString('tr-TR')}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
            `;
        }
        
        // Öğrenciler
        if (data.students.length > 0) {
            html += `
            <div class="section">
                <h2>👨‍🎓 Kayıtlı Öğrenciler</h2>
                <table>
                    <tr><th>Ad Soyad</th><th>Discord</th><th>Ülke</th><th>Rank</th><th>Kayıt Tarihi</th></tr>
                    ${data.students.map(student => `
                        <tr>
                            <td>${student.name} ${student.surname}</td>
                            <td>${student.discord || '-'}</td>
                            <td>${student.country}</td>
                            <td>${student.rank}</td>
                            <td>${new Date(student.registrationDate).toLocaleDateString('tr-TR')}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
            `;
        }
        
        html += `</body></html>`;
        
        res.send(html);
    } catch (error) {
        res.status(500).send(`<h1>Hata:</h1><pre>${error.message}</pre>`);
    }
});
// ============ ÖĞRENCİLER ============

// Tüm öğrencileri getir
app.get('/api/students', async (req, res) => {
  try {
    const data = await readData();
    res.json({ success: true, students: data.students });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni öğrenci ekle
app.post('/api/students', async (req, res) => {
  try {
    const data = await readData();
    const newStudent = {
      id: Date.now(),
      ...req.body,
      registrationDate: new Date().toISOString(),
      weeklySchedule: req.body.weeklySchedule || {}
    };
    
    data.students.push(newStudent);
    await writeData(data);
    
    res.json({ success: true, student: newStudent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Öğrenci güncelle
app.put('/api/students/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = parseInt(req.params.id);
    
    const index = data.students.findIndex(s => s.id === id);
    if (index !== -1) {
      data.students[index] = { 
        ...data.students[index], 
        ...req.body,
        weeklySchedule: req.body.weeklySchedule || data.students[index].weeklySchedule
      };
      await writeData(data);
      res.json({ success: true, student: data.students[index] });
    } else {
      res.status(404).json({ success: false, error: 'Öğrenci bulunamadı' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Öğrenci sil
app.delete('/api/students/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = parseInt(req.params.id);
    
    data.students = data.students.filter(s => s.id !== id);
    await writeData(data);
    
    res.json({ success: true });
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

// ============ KOÇLAR ============

// Tüm koçları getir
app.get('/api/coaches', async (req, res) => {
  try {
    const data = await readData();
    res.json({ success: true, coaches: data.coaches });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Yeni koç ekle
app.post('/api/coaches', async (req, res) => {
  try {
    const data = await readData();
    const newCoach = {
      id: Date.now(),
      ...req.body,
      createdAt: new Date().toISOString()
    };
    
    data.coaches.push(newCoach);
    await writeData(data);
    
    res.json({ success: true, coach: newCoach });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Koç güncelle
app.put('/api/coaches/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = parseInt(req.params.id);
    
    const index = data.coaches.findIndex(c => c.id === id);
    if (index !== -1) {
      data.coaches[index] = { ...data.coaches[index], ...req.body };
      await writeData(data);
      res.json({ success: true, coach: data.coaches[index] });
    } else {
      res.status(404).json({ success: false, error: 'Koç bulunamadı' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Koç sil
app.delete('/api/coaches/:id', async (req, res) => {
  try {
    const data = await readData();
    const id = parseInt(req.params.id);
    
    data.coaches = data.coaches.filter(c => c.id !== id);
    await writeData(data);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Server başlat
app.listen(PORT, async () => {
  await initDataFile();
  console.log(`🚀 AURA Coaching API ${PORT} portunda çalışıyor!`);
});
