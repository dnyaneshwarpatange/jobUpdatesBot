require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Store subscribers and tracked jobs
const subscribers = new Set();
const sentJobs = new Set();

// Improved scraping functions
async function scrapeJobDetails(url) {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const jobDetails = {};

        // Extract key-value pairs from paragraphs with strong tags
        $('p').each((index, element) => {
            const $element = $(element);
            const strong = $element.find('strong');
            if (strong.length) {
                const key = strong.text().trim().replace(':', '');
                const value = $element.contents().not(strong).text().trim();
                if (key && value) jobDetails[key] = value;
            }
        });

        // Extract apply link
        jobDetails['Apply Link'] = $('.job-desc-content p strong a').attr('href');

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
        if (jobElement.length === 0) return null;

        const title = jobElement.text().trim();
        const url = jobElement.attr('href');
        
        // Skip already sent jobs
        if (sentJobs.has(url)) return null;

        const details = await scrapeJobDetails(url);
        if (!details) return null;

        return { title, url, details };
    } catch (error) {
        console.error('Error scraping latest job:', error);
        return null;
    }
}

// Format message with Markdown
function formatJobMessage(job) {
    let message = `🔔 *New Job Alert!* 🔔\n\n`;
    message += `*${job.title}*\n\n`;
    message += `🏢 *Company:* ${job.details['Company Name'] || 'Not specified'}\n`;
    message += `🎯 *Role:* ${job.details['Job Role'] || 'Not specified'}\n`;
    message += `📍 *Location:* ${job.details['Job Location'] || 'Multiple Locations'}\n`;
    message += `🎓 *Qualifications:* ${job.details['Qualifications'] || 'Any Graduate'}\n\n`;
    message += `📝 *Key Details:*\n`;
    message += `• Batch: ${job.details['Batch'] || 'Not specified'}\n`;
    message += `• Experience: ${job.details['Experience'] || 'Freshers'}\n`;
    message += `• Salary: ${job.details['Salary'] || 'Competitive'}\n\n`;
    message += `🔗 *Apply Here:* [Click to Apply](${job.details['Apply Link']})\n`;

    return message;
}

// Handle subscribers
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    subscribers.add(chatId);
    bot.sendMessage(
        chatId,
        '🌟 Welcome to Job Alerts Bot! 🌟\n\nWe\'ll send you new off-campus drive updates automatically. You can also use /latest to get the most recent job posting.',
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    const job = await scrapeLatestJob();
    if (job) {
        bot.sendMessage(chatId, formatJobMessage(job), { 
            parse_mode: 'Markdown',
            disable_web_page_preview: true 
        });
    } else {
        bot.sendMessage(chatId, 'No new job postings found at the moment. Check back later!');
    }
});

// Check for new jobs every 10 minutes
cron.schedule('*/60 * * * *', async () => {
    console.log('Checking for new jobs...');
    const job = await scrapeLatestJob();
    
    if (job) {
        sentJobs.add(job.url);
        const message = formatJobMessage(job);
        
        subscribers.forEach(chatId => {
            bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            }).catch(error => {
                console.error(`Error sending to ${chatId}:`, error);
                // Remove invalid subscribers
                if (error.response?.statusCode === 403) {
                    subscribers.delete(chatId);
                }
            });
        });
    }
});

console.log('🤖 Job Alerts Bot is running...');