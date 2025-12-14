const jsonServer = require('json-server')
const server = jsonServer.create()
const middlewares = jsonServer.defaults()

// In-memory database (daha basit)
const db = {
  applications: [],
  students: [],
  lessons: []
}

// Middleware
server.use(middlewares)
server.use(jsonServer.bodyParser)

// Routes
server.get('/applications', (req, res) => {
  res.json(db.applications)
})

server.post('/applications', (req, res) => {
  const newApp = {
    id: Date.now(),
    ...req.body,
    created_at: new Date().toISOString()
  }
  db.applications.push(newApp)
  res.json(newApp)
})

server.delete('/applications/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const index = db.applications.findIndex(app => app.id === id)
  
  if (index !== -1) {
    db.applications.splice(index, 1)
    res.json({ success: true })
  } else {
    res.status(404).json({ error: 'Not found' })
  }
})

// Diğer endpoint'ler için
server.get('/students', (req, res) => {
  res.json(db.students)
})

server.post('/students', (req, res) => {
  const newStudent = {
    id: Date.now(),
    ...req.body,
    registration_date: new Date().toISOString()
  }
  db.students.push(newStudent)
  res.json(newStudent)
})

server.get('/lessons', (req, res) => {
  res.json(db.lessons)
})

server.post('/lessons', (req, res) => {
  const newLesson = {
    id: Date.now(),
    ...req.body,
    created_at: new Date().toISOString()
  }
  db.lessons.push(newLesson)
  res.json(newLesson)
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`API http://localhost:${PORT} adresinde çalışıyor`)
  console.log('Endpoints:')
  console.log(`  GET  /applications`)
  console.log(`  POST /applications`)
  console.log(`  DELETE /applications/:id`)
  console.log(`  GET  /students`)
  console.log(`  POST /students`)
  console.log(`  GET  /lessons`)
  console.log(`  POST /lessons`)
})
