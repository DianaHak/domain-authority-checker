const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',       // Leave blank if using OpenServer defaults
  database: 'da-checker'
});

db.connect((err) => {
  if (err) throw err;
  console.log('✅ Connected to MySQL!');
});

module.exports = db;
