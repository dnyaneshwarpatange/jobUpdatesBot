require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const cron = require('node-cron');

// Replace with your Telegram bot token

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const jobUpdates = new Set(); // To store unique job updates

// Function to scrape job details
async function scrapeJobDetails(url) {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        let jobDetails = '';

        // Extract text from <p> tags
        $('p').each((index, element) => {
            let extractedText = '';
            $(element).contents().each((i, node) => {
                if (node.type === 'text') {
                    extractedText += $(node).text().trim() + ' '.trim();
                }
            });
            jobDetails += extractedText.trim() + '\n';
        });

        // Extract apply link
        const applyLink = $('.job-desc-content p strong a').attr('href');
        if (applyLink) {
            jobDetails += `Apply Link: ${applyLink}\n`.trim();
        }

        return jobDetails.trim();
    } catch (error) {
        console.error('Error scraping job details:', error);
        return null;
    }
}

// Function to scrape the latest job
async function scrapeLatestJob() {
    try {
        const { data } = await axios.get('https://freshershunt.in/');
        const $ = cheerio.load(data);

        const link = $('.entry-title > a').first();
        if (link.length > 0) {
            const text = link.text().trim();
            const href = link.attr('href');

            const jobDetails = await scrapeJobDetails(href);
            if (jobDetails) {
                const jobUpdate = ` ${text}\n\nJob Details:\n\n${jobDetails}`;
                return jobUpdate.trim();
            }
        }       
    } catch (error) {
        console.error('Error scraping latest job:', error);
    }
    return null;
}

// Function to send job updates to all users
async function sendJobUpdates() {
    const jobUpdate = await scrapeLatestJob();
    if (jobUpdate && !jobUpdates.has(jobUpdate)) {
        jobUpdates.add(jobUpdate);
        bot.sendMessage(chatId, jobUpdate);
    }
}

// Greet user when they start the bot
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Welcome to the Job Updates Bot! Use /latest to get the latest job update.');
});

// Provide the latest job when user uses /latest command
bot.onText(/\/latest/, async (msg) => {
    const chatId = msg.chat.id;
    const jobUpdate = await scrapeLatestJob();
    if (jobUpdate) {
        bot.sendMessage(chatId, jobUpdate);
    } else {
        bot.sendMessage(chatId, 'No job updates found.');
    }
});

// Check for new job updates every minute
cron.schedule('0 * * * *', async () => {
    const jobUpdate = await scrapeLatestJob();
    if (jobUpdate && !jobUpdates.has(jobUpdate)) {
        jobUpdates.add(jobUpdate);
        // Send the update to all users (you can store chat IDs in a database for this purpose)
        // For now, it will only send to the last user who interacted with the bot
        bot.sendMessage(chatId, jobUpdate);
    }
});

// Start the bot
console.log('Job Updates Bot is running...');