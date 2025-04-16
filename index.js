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
    } else {
      console.error('Error loading sent jobs:', error);
    }
  }
})();

// URL normalization function: Removes query parameters, hash, and trailing slash
function normalizeUrl(url) {
  return url ? url.split('?')[0].split('#')[0].replace(/\/$/, '') : '';
}

// Function to scrape job details from a given URL
async function scrapeJobDetails(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const jobDetails = {};

    // Extract key-value pairs from paragraph elements
    $('p').each((index, element) => {
      const $element = $(element);
      const strong = $element.find('strong');
      if (strong.length) {
        const key = strong.text().trim().replace(':', '').replace(/\s+/g, ' ');
        const value = $element.contents().not(strong).text().trim();
        if (key && value) jobDetails[key] = value;
      }
    });

    // Extract specific information (Apply Link and Company Name)
    jobDetails['Apply Link'] = $('p').filter((i, el) =>
      $(el).find('strong').first().text().trim().toLowerCase().includes('apply link')
    ).find('a').attr('href');

    jobDetails['Company Name'] = $('p').filter((i, el) =>
      $(el).find('strong').first().text().trim().toLowerCase().includes('company website')
    ).find('a').text().trim();
    
    return jobDetails;
  } catch (error) {
    console.error('Error scraping job details:', error);
    return null;
  }
}

// Function to scrape the latest job posting from the target website
async function scrapeLatestJob() {
  try {
    const { data } = await axios.get('https://freshershunt.in/off-campus-drive/');
    const $ = cheerio.load(data);

    // Get the first job element from the list
    const jobElement = $('.entry-title > a').first();
    if (!jobElement.length) return null;

    const title = jobElement.text().trim();
    const rawUrl = jobElement.attr('href');
    const url = normalizeUrl(rawUrl);

    // Scrape detailed job information
    const details = await scrapeJobDetails(rawUrl);
    return details ? { title, url, details } : null;
  } catch (error) {
    console.error('Error scraping latest job:', error);
    return null;
  }
}

// Function to format the job message with Markdown
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

// Bot command: /start registers the user for job alerts.
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  subscribers.add(chatId);
  bot.sendMessage(
    chatId,
    '🌟 Welcome to Job Alerts Bot! 🌟\n\nWe\'ll send you new off-campus drive updates every half hour. Use /latest to get the most recent job posting.',
    { parse_mode: 'Markdown' }
  );
});

// Bot command: /latest sends the most recent job posting immediately.
bot.onText(/\/latest/, async (msg) => {
  const chatId = msg.chat.id;
  const job = await scrapeLatestJob();
  if (job) {
    bot.sendMessage(chatId, formatJobMessage(job), { parse_mode: 'Markdown', disable_web_page_preview: true });
  } else {
    bot.sendMessage(chatId, 'No job postings found at the moment.');
  }
});

// Cron job: Runs every 30 minutes to check for new job postings and sends them to all subscribers if not already sent
cron.schedule('*/30 * * * *', async () => {
  console.log('Checking for new jobs...');
  try {
    const job = await scrapeLatestJob();
    if (!job || sentJobs.has(job.url)) {
      return;
    }

    // Prevent duplicate notifications
    sentJobs.add(job.url);
    await fs.writeFile(SENT_JOBS_FILE, JSON.stringify([...sentJobs]));

    const message = formatJobMessage(job);
    subscribers.forEach(chatId => {
      bot.sendMessage(chatId, message, { parse_mode: 'Markdown', disable_web_page_preview: true })
        .catch(error => {
          if (error.response && error.response.statusCode === 403) {
            subscribers.delete(chatId);
          }
        });
    });
  } catch (error) {
    console.error('Error in cron job:', error);
  }
});

console.log('🤖 Job Alerts Bot is running...');
