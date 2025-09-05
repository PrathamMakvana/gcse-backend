require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

// ===== Allowed Origins =====
const ALLOW_ORIGINS = [
  'https://uk.tutoh.ai',
  'https://gcse-admin-panel.vercel.app',
  'https://gcseadmin.tutoh.ai',
  'https://node-gcse-backend-157527989777.europe-west2.run.app',
  'http://localhost:3000',
  'http://34.95.123.156:80',
  'http://34.95.123.156'
];

// ===== CORS Setup =====
app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOW_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400
}));

// ✅ Universal preflight handler (Express v4 & v5 safe)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Middleware
app.use(express.json());

// ===== MySQL Connection =====
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

connection.connect((err) => {
  if (err) {
    console.error('❌ MySQL connection failed:', err.message);
  } else {
    console.log('✅ Connected to MySQL database!');
  }
});

// ===== Routes =====
const lessonRoutes = require('./routes/lessonRoutes');
const mockRoutes = require('./routes/mockRoutes');
app.get("/", (req, res) => {
  res.send("Backend is running 🚀");
});
app.use('/api/lesson', lessonRoutes);
app.use('/api/mock', mockRoutes);

// ===== Server =====
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

console.log('=======================> REPLICATE_API_TOKEN ==============> ' + process.env.REPLICATE_API_TOKEN)

// ===== Prevent premature kills on long requests/streams =====
server.requestTimeout   = 0;        // disable per-request timeout
server.keepAliveTimeout = 120000;   // 120s
server.headersTimeout   = 125000;   // must be > keepAliveTimeout
