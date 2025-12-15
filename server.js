const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Basit database (RAM'de)
let database = {
  applications: [],
  students: [],
  lessons: []
};

// Test endpoint
app.get('/', (req, res) => {
  res.json({ message: 'AURA Coaching API ÇALIŞIYOR!', status: 'OK' });
});

// APPLICATIONS
app.get('/applications', (req, res) => {
  res.json(database.applications);
});

app.post('/applications', (req, res) => {
  const newApp = {
    id: Date.now(),
    ...req.body,
    created_at: new Date().toISOString()
  };
  database.applications.push(newApp);
  res.json(newApp);
});

app.delete('/applications/:id', (req, res) => {
  const id = parseInt(req.params.id);
  database.applications = database.applications.filter(app => app.id !== id);
  res.json({ success: true });
});

// STUDENTS
app.get('/students', (req, res) => {
  res.json(database.students);
});

app.post('/students', (req, res) => {
  const newStudent = {
    id: Date.now(),
    ...req.body,
    registration_date: new Date().toISOString()
  };
  database.students.push(newStudent);
  res.json(newStudent);
});

// LESSONS
app.get('/lessons', (req, res) => {
  res.json(database.lessons);
});

app.post('/lessons', (req, res) => {
  const newLesson = {
    id: Date.now(),
    ...req.body,
    created_at: new Date().toISOString()
  };
  database.lessons.push(newLesson);
  res.json(newLesson);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API ${PORT} portunda çalışıyor!`);
  console.log(`✅ Endpoints:`);
  console.log(`   GET  /applications`);
  console.log(`   POST /applications`);
  console.log(`   GET  /students`);
  console.log(`   POST /students`);
});
