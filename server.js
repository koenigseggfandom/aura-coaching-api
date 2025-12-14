const jsonServer = require('json-server');
const server = jsonServer.create();
const router = jsonServer.router('db.json');
const middlewares = jsonServer.defaults();
const cors = require('cors');

server.use(cors());
server.use(middlewares);
server.use(jsonServer.bodyParser);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`API ${PORT} portunda çalışıyor`);
});

server.use(router);