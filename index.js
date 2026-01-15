require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');
const fs = require('fs').promises;

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const channelId = '@EngineeringJobUpdates';

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

function normalizeUrl(url) {
  return url ? url.split('?')[0].split('#')[0].replace(/\/$/, '') : '';
}

async function scrapeJobDetails(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const jobDetails = {};

    $('p').each((index, element) => {
      const $element = $(element);
      const strong = $element.find('strong');
      if (strong.length) {
        const key = strong.text().trim().replace(':', '').replace(/\s+/g, ' ');
        const value = $element.contents().not(strong).text().trim();
        if (key && value) jobDetails[key] = value;
      }
    });

    jobDetails['Apply Link'] = $('p').filter((i, el) =>
      $(el).find('strong').first().text().trim().toLowerCase().includes('apply link')
    ).find('a').attr('href');

    jobDetails['Company Name'] = $('p').filter((i, el) =>
      $(el).find('strong').first().text().trim().toLowerCase().includes('company website')
    ).find('a').text().trim();

    return jobDetails;
  } catch (error) {
    console.error(`Error scraping job details for ${url}:`, error.message);
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

// NEW: Function to scrape multiple recent jobs
async function scrapeRecentJobs(limit = 10) {
  try {
    const { data } = await axios.get('https://freshershunt.in/off-campus-drive/');
    const $ = cheerio.load(data);
    
    const jobsToScrape = [];
    
    // Collect the top 'limit' URLs first
    $('.entry-title > a').each((i, el) => {
      if (i < limit) {
        const title = $(el).text().trim();
        const rawUrl = $(el).attr('href');
        const url = normalizeUrl(rawUrl);
        jobsToScrape.push({ title, url, rawUrl });
      }
    });

    const results = [];
    console.log(`Starting scrape for ${jobsToScrape.length} jobs...`);

    // Process sequentially to be polite to the server and avoid timeouts
    for (const job of jobsToScrape) {
      const details = await scrapeJobDetails(job.rawUrl);
      if (details) {
        results.push({ title: job.title, url: job.url, details });
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error scraping recent jobs list:', error);
    return [];
  }
}

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

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  subscribers.add(chatId);
  bot.sendMessage(
    chatId,
    '🌟 Welcome to Job Alerts Bot! 🌟\n\nCommands:\n/latest - Get the most recent job\n/thisweek - Get the last 10 jobs',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/latest/, async (msg) => {
  const chatId = msg.chat.id;
  const job = await scrapeLatestJob();
  if (job) {
    bot.sendMessage(chatId, formatJobMessage(job), { parse_mode: 'Markdown', disable_web_page_preview: true });
  } else {
    bot.sendMessage(chatId, 'No job postings found at the moment.');
  }
});

// NEW: /thisweek command handler
bot.onText(/\/thisweek/, async (msg) => {
  const chatId = msg.chat.id;
  
  // Send a loading message so the user knows it's working
  bot.sendMessage(chatId, '🔍 Fetching the last 10 jobs. This may take a few seconds...');

  const jobs = await scrapeRecentJobs(10);

  if (jobs.length > 0) {
    for (const job of jobs) {
      await bot.sendMessage(chatId, formatJobMessage(job), { parse_mode: 'Markdown', disable_web_page_preview: true });
    }
    bot.sendMessage(chatId, '✅ Done! Here are the last 10 jobs.');
  } else {
    bot.sendMessage(chatId, '⚠️ Could not fetch jobs at this time. Please try again later.');
  }
});

cron.schedule('*/30 * * * *', async () => {
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

    // Post to the channel
    bot.sendMessage(channelId, message, { parse_mode: 'Markdown', disable_web_page_preview: true });

  } catch (error) {
    console.error('Error in cron job:', error);
  }
});

console.log('🤖 Job Alerts Bot is running...');