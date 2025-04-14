const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const HTML_FILE = 'domain_report.html';
const FILTERED_HTML = 'filtered_domains.html';
const ARCHIVE_HTML = 'archived_domains.html';
const FILTERED_CSV = 'filtered_domains.csv';
const ARCHIVE_CSV = 'archived_domains.csv';

const parseDate = (str) => {
  if (!str) return new Date();

  // Match format: 11-04-2025  7:23:00 PM
  const match = str.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return new Date();

  let [, day, month, year, hour, minute, second, ampm] = match;
  hour = parseInt(hour);
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;

  // Return properly constructed date
  return new Date(`${year}-${month}-${day}T${hour.toString().padStart(2, '0')}:${minute}:${second}`);
};
function parseEndTime(str) {
  const match = str.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return null;

  let [, day, month, year, hour, minute, second, ampm] = match;
  hour = parseInt(hour, 10);
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;

  return new Date(`${year}-${month}-${day}T${hour.toString().padStart(2, '0')}:${minute}:${second}`);
}


const getDomainsFromCSV = (csvPath) => {
  return new Promise((resolve) => {
    const results = [];
    fs.createReadStream(csvPath)
      .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
      .on('data', (row) => {
        console.log("📥 Row:", row);
        const domain = row['domain name'];
        const price = row['price'];
        const endTime = parseEndTime(row['auction end time']); // ✅ now parsed properly

        if (domain && price && endTime) {
          results.push({ domain: domain.trim(), price, endTime });
        }
      })
      .on('end', () => {
        console.log("✅ Parsed CSV domains:", results.map(d => d.domain));
        resolve(results);
      });
  });
};

const writeCSV = (file, data) => {
  const csv = ['Domain Name,DA,Price,Auction End Time', ...data.map(d => `${d.domain},${d.da},${d.price},${d.endTime}`)].join("\n");
  fs.writeFileSync(file, csv);
};

const writeHTML = (file, title, rows) => {
  const body = rows.map(r => `<tr><td>${r.domain}</td><td>${r.da}</td><td>${r.price}</td><td>${r.endTime}</td></tr>`).join("\n");
  const html = `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1><table border="1"><tr><th>Domain</th><th>DA</th><th>Price</th><th>Auction End Time</th></tr>${body}</table></body></html>`;
  fs.writeFileSync(file, html);
};

const getDomainAuthority = async (domain, page) => {
  try {
    console.log(`🔍 Checking: ${domain}`);
    await page.goto('https://www.semrush.com/free-tools/website-authority-checker/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for the input field and clear it if already filled
    await page.waitForSelector('input[name="website"]', { timeout: 15000 });
    await page.click('input[name="website"]', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type('input[name="website"]', domain, { delay: 100 });

    console.log(`📤 Entered domain: ${domain}`);

    // Wait for the "See Website Authority" button to be clickable and click it
    await page.waitForSelector('button[type="submit"]', { timeout: 15000 });
    await page.click('button[type="submit"]');
    console.log('🔘 Clicked "See Website Authority" button');

    // Wait for the result (DA value) to appear
    await page.waitForSelector('tspan[data-test="Typography"]', { timeout: 20000 });

    const authority = await page.evaluate(() => {
      const el = document.querySelector('tspan[data-test="Typography"]');
      return el ? el.textContent.trim() : 'N/A';
    });

    console.log(`✅ Got DA for ${domain}: ${authority}`);
    return authority;
  } catch (err) {
    console.error(`❌ Error checking ${domain}:`, err.message);
    return 'N/A';
  }
};

async function runChecker(filePath, progressCallback) {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // Parse the CSV data
  const csvData = await getDomainsFromCSV(filePath);
  let progress = 0;
  const totalDomains = csvData.length;

  console.log('Parsed CSV Data:', csvData);

  for (let i = 0; i < csvData.length; i++) {
    const domain = csvData[i].domain; // Ensure you're using the correct field name from CSV
    console.log(`Processing domain: ${domain}`);

    try {
      // Get DA from SEMrush for each domain
      const da = await getDomainAuthority(domain, page);

      // Here you would insert/update the data in your database, if applicable
      // e.g., await db.insertOrUpdate({ domain, da, status: 'active' });
      await db.insertOrUpdate({
        domain: domain,
        da: da,
        price: csvData[i].Price,
        endTime: new Date(csvData[i]["Auction End Time"]),
        status: 'active'
      });
      
      // Optional: log the domain and its DA
      console.log(`Domain: ${domain}, DA: ${da}`);

    } catch (err) {
      console.error(`Error processing domain ${domain}:`, err);
    }

    // Update progress
    progress = ((i + 1) / totalDomains) * 100;
    progressCallback(progress);

    // Optional: Sleep for a short time between requests to avoid rate-limiting
    await sleep(2000); // Sleep for 2 seconds
  }

  await browser.close();
}

module.exports = { runChecker };
