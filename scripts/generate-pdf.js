import puppeteer from 'puppeteer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const htmlPath = path.join(root, 'docs', 'AgentDesk_QuickStart_Guide.html');
const pdfPath = path.join(root, 'docs', 'AgentDesk_QuickStart_Guide.pdf');

// Ensure docs folder exists
const docsDir = path.dirname(htmlPath);
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

async function run() {
  console.log('Starting PDF generation with Puppeteer...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // Open the local HTML file
  const url = `file://${htmlPath}`;
  console.log(`Loading HTML from: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle0' });
  
  console.log('Rendering to PDF...');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: {
      top: '15mm',
      bottom: '15mm',
      left: '15mm',
      right: '15mm'
    }
  });
  
  console.log(`PDF successfully created at: ${pdfPath}`);
  await browser.close();
}

run().catch((error) => {
  console.error('Failed to generate PDF:', error);
  process.exit(1);
});
