const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
require('dotenv').config(); // .env faylini yuklash

// Bot token
const token = process.env.BOT_TOKEN; // .env faylidan o'qiladi
const bot = new TelegramBot(token, { polling: true });

// MongoDB connection
const mongoURI = process.env.MONGO_URI; // .env faylidan o'qiladi
mongoose.connect(mongoURI)
    .then(() => {
        console.log('Connected to MongoDB.');
    })
    .catch((err) => {
        console.error('Error connecting to MongoDB:', err);
    });

// MongoDB schema and model
const postSchema = new mongoose.Schema({
    postId: String,
    fileId: String,
    caption: String,
});

const Post = mongoose.model('Post', postSchema);

// Admin chat ID
const adminChatId = process.env.ADMIN_CHAT_ID; // .env faylidan o'qiladi

// Channel(s) usernames
const channels = [
    { name: 'AsilbekCode', username: process.env.CHANNEL_USERNAME }, // .env faylidan o'qiladi
];

// Instagram profile link
const instagramProfile = process.env.INSTAGRAM_PROFILE; // .env faylidan o'qiladi

// Admin post creation state
let isAdminCreatingPost = false;
let postData = {};

// Start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const startPayload = msg.text.split(' ')[1]; // /start <post_id>

    if (chatId == adminChatId) {
        // Admin starts creating a post
        isAdminCreatingPost = true;
        postData = {}; // Clear post data
        bot.sendMessage(chatId, 'Send a video or photo to create a new post.');
    } else {
        // Regular user subscription check
        if (startPayload) {
            // If /start <post_id> is used
            checkSubscriptionAndSendFile(chatId, startPayload);
        } else {
            // Regular /start command
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Telegram Channel', url: `https://t.me/${channels[0].username.replace('@', '')}` }],
                        [{ text: 'Instagram', url: instagramProfile }],
                        [{ text: 'Get Code', callback_data: 'get_code' }]
                    ]
                }
            };
            bot.sendMessage(chatId, 'Please choose one of the options below:', opts);
        }
    }
});

// Subscription check and file sending
async function checkSubscriptionAndSendFile(chatId, postId) {
    try {
        // Check if user is subscribed to the channel
        let isSubscribed = true;
        for (const channel of channels) {
            try {
                const chatMember = await bot.getChatMember(channel.username, chatId);
                if (chatMember.status === 'left') {
                    isSubscribed = false;
                    break;
                }
            } catch (err) {
                console.error(`Error connecting to channel: ${err.message}`);
                isSubscribed = false;
                break;
            }
        }

        if (!isSubscribed) {
            // If user is not subscribed to all channels
            const opts = {
                reply_markup: {
                    inline_keyboard: [
                        // Subscribe to Telegram channel button
                        [{ text: 'Subscribe to Telegram Channel', url: `https://t.me/${channels[0].username.replace('@', '')}` }],
                        // Instagram profile link
                        [{ text: 'Subscribe to Instagram', url: instagramProfile }],
                        // Check subscription button
                        [{ text: '✅ Check Subscription', callback_data: `check_${postId}` }]
                    ]
                }
            };
            bot.sendMessage(chatId, `Please subscribe to the following channel(s):`, opts);
        } else {
            // If user is subscribed to all channels
            const post = await Post.findOne({ postId });

            if (post) {
                // Send the file
                bot.sendDocument(chatId, post.fileId);
            } else {
                bot.sendMessage(chatId, 'File not found!');
            }
        }
    } catch (err) {
        console.error(`Error occurred: ${err.message}`);
        bot.sendMessage(chatId, 'Error occurred: ' + err.message);
    }
}

// Callback query handling
bot.on('callback_query', async (query) => {
    const data = query.data;

    if (data.startsWith('check_')) {
        const postId = data.split('_')[1]; // Get post ID
        const chatId = query.message.chat.id;

        // Recheck subscription
        checkSubscriptionAndSendFile(chatId, postId);
    } else if (data === 'get_code') {
        try {
            // Get post ID
            const postIdMatch = query.message.caption ? query.message.caption.match(/Post ID: (\w+)/) : null;
            if (!postIdMatch) return;

            const postId = postIdMatch[1];
            const botUsername = 'AsilbekCode_bot'; // Your bot username
            const botUrl = `https://t.me/${botUsername}?start=${postId}`;

            // Redirect user to the bot
            await bot.answerCallbackQuery(query.id, {
                url: botUrl // Redirects user to the bot
            });

        } catch (err) {
            console.error(`Error occurred: ${err.message}`);
        }
    }
});

// Video or photo handling
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (chatId == adminChatId && isAdminCreatingPost) {
        if (msg.video) {
            const videoId = msg.video.file_id;
            const caption = msg.caption || '';

            // Save video
            postData.media = { type: 'video', file_id: videoId };
            postData.caption = caption;
            bot.sendMessage(chatId, 'Video saved. Please send the text for the post.');
        } else if (msg.photo) {
            const photoId = msg.photo[msg.photo.length - 1].file_id;
            const caption = msg.caption || '';

            // Save photo
            postData.media = { type: 'photo', file_id: photoId };
            postData.caption = caption;
            bot.sendMessage(chatId, 'Photo saved. Please send the text for the post.');
        } else if (msg.text && !msg.text.startsWith('/')) {
            // Save text
            postData.caption = msg.text;
            bot.sendMessage(chatId, `Text saved. Now send the file.`);
        } else if (msg.document) {
            const documentId = msg.document.file_id;

            // Save file
            postData.file = { type: 'document', file_id: documentId };
            bot.sendMessage(chatId, 'File saved. Send /sendpost to publish the post to the channel.');
        }
    }
});

// Send post to channel
bot.onText(/\/sendpost/, async (msg) => {
    const chatId = msg.chat.id;

    if (chatId == adminChatId && isAdminCreatingPost) {
        if (postData.media && postData.caption && postData.file) {
            // Generate post ID
            const postId = Math.random().toString(36).substring(7);

            // Save to MongoDB
            const newPost = new Post({
                postId,
                fileId: postData.file.file_id,
                caption: postData.caption,
            });
            await newPost.save();

            // Send video or photo to channel
            const opts = {
                caption: `${postData.caption}\n\nPost ID: ${postId}`,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: 'Get Code', callback_data: 'get_code' }]
                    ]
                }
            };

            if (postData.media.type === 'video') {
                bot.sendVideo(channels[0].username, postData.media.file_id, opts)
                    .then(() => {
                        bot.sendMessage(chatId, 'Post successfully sent to the channel.');
                        isAdminCreatingPost = false; // End post creation state
                        postData = {}; // Clear data
                    })
                    .catch((err) => {
                        bot.sendMessage(chatId, `Error occurred: ${err.message}`);
                    });
            } else if (postData.media.type === 'photo') {
                bot.sendPhoto(channels[0].username, postData.media.file_id, opts)
                    .then(() => {
                        bot.sendMessage(chatId, 'Post successfully sent to the channel.');
                        isAdminCreatingPost = false; // End post creation state
                        postData = {}; // Clear data
                    })
                    .catch((err) => {
                        bot.sendMessage(chatId, `Error occurred: ${err.message}`);
                    });
            }
        } else {
            bot.sendMessage(chatId, 'Media, text, or file not found to send the post.');
        }
    }
});

console.log('Bot started...');