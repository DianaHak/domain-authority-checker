const mysql = require('mysql2');
const moment = require('moment'); // install if not already: npm i moment

const db = mysql.createConnection({
  host: '127.127.126.26', // or try 127.127.126.50 if needed
  user: 'root',
  password: '',
  database: 'da-checker',
  port: 3306
});


module.exports = {
  insertOrUpdate: function (domainData, callback) {
    const {
      domain,
      da,
      price = 0,
      endTime = null,
      status = 'active',
      comment = ''
    } = domainData;

    const parsedEndTime = endTime
      ? moment(endTime, 'DD.MM.YYYY HH:mm').toDate()
      : null;

    // Step 1: Check if domain already exists
    const checkQuery = 'SELECT 1 FROM domains WHERE domain = ? LIMIT 1';

    db.query(checkQuery, [domain], (err, results) => {
      if (err) return callback?.(err);

      if (results.length > 0) {
        // Domain exists, update instead
        const updateQuery = `
          UPDATE domains
          SET da = ?, price = ?, endTime = ?, status = ?, comment = ?
          WHERE domain = ?
        `;
        return db.query(updateQuery, [da, price, parsedEndTime, status, comment, domain], callback);
      }
      
      

      // Step 2: If not exists, insert it
      const insertQuery = `
        INSERT INTO domains (domain, da, price, endTime, status, comment)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      db.query(insertQuery, [domain, da, price, parsedEndTime, status, comment], callback || (() => { }));
    });
  }
  ,




  getAll: function (callback) {
    const query = 'SELECT * FROM domains';
    db.query(query, (err, rows) => {
      if (err) return callback(err);

      rows.forEach(r => {
        console.log('Raw endTime from DB:', r.endTime); // 🔍
      });

      const formatted = rows.map(row => ({
        ...row,
        endTime: row.endTime ? moment(row.endTime).format('YYYY-MM-DD HH:mm') : null
      }));
      callback(null, formatted);
    });
  },




  getAllNonArchived: (callback) => {
    db.query('SELECT * FROM domains WHERE status != "archived"', (err, results) => {
      if (err) {
        console.error('Error fetching non-archived domains:', err.message);
        callback(err, null);
      } else {
        const formatted = results.map(row => ({
          ...row,
          endTime: row.endTime ? moment(row.endTime).format('YYYY-MM-DD HH:mm:ss') : null
        }));
        callback(null, formatted);
      }
    });
  },


  getByStatus: (status, callback) => {
    db.query('SELECT * FROM domains WHERE status = ?', [status], (err, results) => {
      if (err) return callback(err);
      const formatted = results.map(row => ({
        ...row,
        endTime: row.endTime ? moment(row.endTime).format('YYYY-MM-DD HH:mm:ss') : null
      }));
      callback(null, formatted);
    });
  },


  getComment: (domain, callback) => {
    db.query('SELECT comment FROM domains WHERE domain = ?', [domain], (err, results) => {
      if (err) {
        console.error('❌ getComment error:', err.message);
        callback(null);
      } else {
        callback(results.length ? results[0].comment : ''); // Return empty string if no comment found
      }
    });
  },

  updateComment: function ({ domain, comment }, callback) {
    const query = `UPDATE domains SET comment = ? WHERE domain = ?`;
    db.query(query, [comment, domain], (err, result) => {
      if (err) {
        console.error('❌ Error updating comment:', err.message);
        callback(err);
      } else {
        callback(null, result);
      }
    });
  },
  updateFavorite(domain, favorite) {
    return new Promise((resolve, reject) => {
      db.query(
        'UPDATE domains SET favorite = ? WHERE domain = ?',
        [favorite, domain],
        (err, result) => {
          if (err) return reject(err);
          resolve(result);
        }
      );
    });
  }



  ,

  clearAll: () => {
    db.query('DELETE FROM domains', (err, result) => {
      if (err) {
        console.error('❌ Error clearing all domains:', err.message);
      } else {
        console.log('All domains cleared');
      }
    });
  }

};
