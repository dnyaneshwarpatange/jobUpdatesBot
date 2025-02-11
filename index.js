require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const fs = require('fs').promises;

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Persistent storage setup
const SENT_JOBS_FILE = 'sentJobs.json';
const subscribers = new Set();
const sentJobs = new Set();

// Load previously sent jobs on startup
(async () => {
  try {
    const data = await fs.readFile(SENT_JOBS_FILE, 'utf8');
    JSON.parse(data).forEach(url => sentJobs.add(url));
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.writeFile(SENT_JOBS_FILE, '[]');
    }
  }
})();

// URL normalization function
function normalizeUrl(url) {
  return url ? url.split('?')[0].split('#')[0].replace(/\/$/, '') : '';
}

// Improved scraping functions
async function scrapeJobDetails(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const jobDetails = {};

    // Extract key-value pairs
    $('p').each((index, element) => {
      const $element = $(element);
      const strong = $element.find('strong');
      if (strong.length) {
        const key = strong.text().trim().replace(':', '').replace(/\s+/g, ' ');
        const value = $element.contents().not(strong).text().trim();
        if (key && value) jobDetails[key] = value;
      }
    });

    // Extract apply link
    jobDetails['Apply Link'] = $('p:nth-child(23) > a').attr('href');
    jobDetails['Company Name'] = $('p:nth-child(7) > strong > a').text().trim();

    return jobDetails;
  } catch (error) {
    console.error('Error scraping job details:', error);
    return null;
  }
}

async function scrapeLatestJob() {
  try {
    const { data } = await axios.get('https://freshershunt.in/off-campus-drive/');
    const $ = cheerio.load(data);

    const jobElement = $('.entry-title > a').first();
    if (!jobElement.length) return null;

    const title = jobElement.text().trim();
    const rawUrl = jobElement.attr('href');
    const url = normalizeUrl(rawUrl);

    const details = await scrapeJobDetails(rawUrl);
    return details ? { title, url, details } : null;
  } catch (error) {
    console.error('Error scraping latest job:', error);
    return null;
  }
}

// Format message with Markdown
function formatJobMessage(job) {
  return `🔔 *New Job Alert!* 🔔\n\n` +
    `*${job.title}*\n\n` +
    `🏢 *Company:* ${job.details['Company'] || job.details['Company Name'] || 'Not specified'}\n` +
    `🎯 *Role:* ${job.details['Job Role'] || 'Not specified'}\n` +
    `📍 *Location:* ${job.details['Job Location'] || 'Multiple Locations'}\n` +
    `🎓 *Qualifications:* ${job.details['Qualifications'] || 'Any Graduate'}\n\n` +
    `📝 *Key Details:*\n` +
    `• Batch: ${job.details['Batch'] || 'Not specified'}\n` +
    `• Experience: ${job.details['Experience'] || 'Freshers'}\n` +
    `• Salary: ${job.details['Salary'] || 'Competitive'}\n\n` +
    `🔗 *Apply Here:* [Click to Apply](${job.details['Apply Link']})\n`;
}

// Bot commands
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  subscribers.add(chatId);
  bot.sendMessage(
    chatId,
    '🌟 Welcome to Job Alerts Bot! 🌟\n\nWe\'ll send you new off-campus drive updates hourly. Use /latest to get the most recent job posting.',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/latest/, async (msg) => {
  const chatId = msg.chat.id;
  const job = await scrapeLatestJob();
  job ? bot.sendMessage(chatId, formatJobMessage(job), { parse_mode: 'Markdown', disable_web_page_preview: true })
      : bot.sendMessage(chatId, 'No job postings found at the moment.');
});

// Hourly job check with duplicate prevention
cron.schedule('0 * * * *', async () => {
  console.log('Checking for new jobs...');
  try {
    const job = await scrapeLatestJob();
    if (!job || sentJobs.has(job.url)) return;

    sentJobs.add(job.url);
    await fs.writeFile(SENT_JOBS_FILE, JSON.stringify([...sentJobs]));

    const message = formatJobMessage(job);
    subscribers.forEach(chatId => {
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true })
        .catch(error => error.response?.statusCode === 403 && subscribers.delete(chatId));
    });
  } catch (error) {
    console.error('Error in cron job:', error);
  }
});

console.log('🤖 Job Alerts Bot is running...');