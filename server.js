const express = require('express');
const multer = require('multer');
const fs = require('fs');
const csvParser = require('csv-parser');
const path = require('path');
const db = require('./database');
const http = require('http');
const socketIo = require('socket.io');
const puppeteer = require('puppeteer');
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const port = 3000;

// Multer setup for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// Endpoint to upload CSV
app.post('/upload', upload.single('csv'), async (req, res) => {
  if (!req.file) {
    console.log('No file uploaded');
    return res.status(400).json({ status: 'error', message: 'No file uploaded' });
  }

  console.log('File uploaded:', req.file.path);
  const uploadedPath = req.file.path;

  try {
    io.emit('progress', { status: 'started' });

    await runChecker(uploadedPath, (progress) => {
      io.emit('progress', { status: 'in-progress', progress });
    });

    io.emit('progress', { status: 'completed' });
    res.json({ status: 'success' });
  } catch (err) {
    console.error('❌ Error running checker:', err);
    res.status(500).json({ status: 'error', message: 'Checker failed' });
  }
});
app.get('/api/domains/:status', (req, res) => {
  const status = req.params.status;
  const now = new Date();

  if (status === 'archived') {
    db.getByStatus('archived', (err, archivedDomains) => {
      if (err) return res.status(500).json({ error: err.message });
      return res.json(archivedDomains); // no need to filter further
    });
  } else {
    db.getAllNonArchived((err, allDomains) => {
      if (err) return res.status(500).json({ error: err.message });

      if (status === 'filtered') {
        return res.json(allDomains.filter(d => parseFloat(d.da) >= 15 && new Date(d.endTime) >= now));
      }

      if (status === 'all') {
        return res.json(allDomains.filter(d => new Date(d.endTime) >= now)); // active
      }

      return res.status(400).json({ error: 'Invalid status' });
    });
  }
});






app.post('/api/domains/comment', (req, res) => {
  const { domain, comment } = req.body;
  if (!domain) return res.status(400).json({ error: 'No domain' });

  db.updateComment({ domain, comment }, (err) => {
    if (err) {
      console.error('❌ updateComment error:', err);
      return res.status(500).json({ error: 'Failed to update comment' });
    }
    res.json({ status: 'saved' });
  });
});


app.get('/api/domains/filtered', (req, res) => {
  db.getAllNonArchived((err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const filtered = rows.filter(row => row.da >= 15);
    const sorted = filtered.sort((a, b) => {
      if (b.da === a.da) return a.price - b.price;
      return b.da - a.da;
    });
    res.json(sorted);
  });
});

app.get('/api/domains/non-archived', (req, res) => {
  db.getAllNonArchived((err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/domains/archived', (req, res) => {
  db.getByStatus('archived', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.get('/check-timing', async (req, res) => {
  try {
    const [result] = await connection.query(`
      UPDATE domains
      SET status = 'archived'
      WHERE status = 'active' AND endTime < NOW()
    `);
    res.send(`${result.affectedRows} domains moved to archive.`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Error updating domains');
  }
});

app.get('/api/domains/archive-passed', (req, res) => {
  db.getAllNonArchived((err, domains) => {
    if (err) return res.status(500).json({ error: err.message });

    const now = new Date();
    const expired = domains.filter(domain => new Date(domain.endTime) < now);

    expired.forEach(domain => {
      db.insertOrUpdate({
        domain: domain.domain,
        da: domain.da,
        price: domain.price,
        endTime: domain.endTime,
        status: 'archived'
      });
    });

    res.json({ status: 'success', archivedDomains: expired });
  });
});


app.post('/api/favorite', async (req, res) => {
  const { domain, favorite } = req.body;

  try {
    await db.updateFavorite(domain, favorite);
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating favorite:', err);
    res.status(500).json({ error: 'Failed to update favorite' });
  }
});



const runChecker = async (filePath, progressCallback) => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const csvData = await parseCsv(filePath);
  let progress = 0;
  const totalDomains = csvData.length;
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (let i = 0; i < totalDomains; i++) {
    const domain = csvData[i]['Domain Name'];
    try {
      await page.goto('https://www.semrush.com/free-tools/website-authority-checker/');
      await page.waitForSelector('input[name="website"]', { timeout: 30000 });
      await page.type('input[name="website"]', domain);
      await page.waitForSelector('button[type="submit"]', { timeout: 30000 });
      await page.click('button[type="submit"]');
      await page.waitForSelector('tspan[data-test="Typography"]', { timeout: 30000 });

      const da = await page.evaluate(() => {
        const daElement = document.querySelector('tspan[data-test="Typography"]');
        return daElement ? parseInt(daElement.textContent, 10) : null;
      });

      if (da) {
        console.log(`DA for domain ${domain}: ${da}`);
        await db.insertOrUpdate({
          domain: domain,
          da: da,
          price: csvData[i].Price,
          endTime: csvData[i]["Auction End Time"],
          status: 'active',
          comment: ''
        });
      } else {
        console.log(`DA for domain ${domain} not found`);
      }
    } catch (err) {
      console.log(`Error processing domain ${domain}:`, err);
    }

    progress = ((i + 1) / totalDomains) * 100;
    progressCallback(progress);
    await sleep(2000);
  }

  await browser.close();
};

const parseCsv = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
};

server.listen(port, () => console.log(`🚀 Server running on http://localhost:${port}`));
