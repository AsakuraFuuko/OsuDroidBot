'use strict';
const debug = require('debug')('osudroidbot');
const TelegramBot = require('node-telegram-bot-api');
const request = require('request-promise-native');

const OsuApi = new (require('./lib/osuapi'))();

let isLocal = process.env.LOCAL === 'true';
console.log('isLocal=', isLocal);

let SettingDB, Config;
if (!isLocal) {
    Config = require('./config.json');
    SettingDB = new (require('./lib/db/settings'))();
}

const TOKEN = process.env.TELEGRAM_TOKEN;
const options = {
    webHook: {
        port: process.env.PORT || 5000
    }
};

if (isLocal) {
    options.webHook.key = `${__dirname}/private.key`;  // Path to file with PEM private key
    options.webHook.cert = `${__dirname}/cert.pem`  // Path to file with PEM certificate
}

let botname = '@bot_name';
const url = process.env.APP_URL;
const bot = new TelegramBot(TOKEN, options);

if (isLocal) {
    bot.setWebHook(`${url}/bot${TOKEN}`, {
        certificate: options.webHook.cert,
    });
} else {
    bot.setWebHook(`${url}/bot${TOKEN}`);
}

bot.getMe().then((msg) => {
    botname = '@' + msg.username;
});

bot.onText(/\/id(@\w+)?(?: )?(\d+)/, (msg, match) => {
    let chat_id = msg.chat.id;
    let bot_name = match[1];
    if (bot_name && bot_name !== botname) {
        return;
    }
    let id = match[2];

    return OsuApi.search(id, 's').then((sets) => {
        let set = sets[0];
        if (set) {
            return bot.sendChatAction(chat_id, 'typing').then(() => {
                return sendBeatmapInfo(chat_id, set).then(() => null)
            })
        } else {
            return id
        }
    }).then((id) => {
        if (id) {
            return OsuApi.search(id, 'b').then((sets) => {
                let set = sets[0];
                if (set) {
                    return bot.sendChatAction(chat_id, 'typing').then(() => {
                        return sendBeatmapInfo(chat_id, set)
                    })
                } else {
                    return bot.sendMessage(chat_id, 'not found')
                }
            })
        }
    })
});

bot.onText(/\/search(@\w+)?(?: )?(.+)/, (msg, match) => {
    let chat_id = msg.chat.id;
    let bot_name = match[1];
    if (bot_name && bot_name !== botname) {
        return;
    }
    let keywords = match[2];

    return OsuApi.search(keywords).then((sets) => {
        let set = sets[0];
        if (set) {
            return sendBeatmapInfo(chat_id, set)
        } else {
            return bot.sendChatAction(chat_id, 'typing').then(() => {
                return bot.sendMessage(chat_id, 'not found')
            })
        }
    });
});

bot.onText(/([sb]+)\/(\d+)/, (msg, match) => {
    let chat_id = msg.chat.id;
    let mode = match[1];
    let id = match[2];

    return OsuApi.search(id, mode).then((sets) => {
        let set = sets[0];
        if (set) {
            return sendBeatmapInfo(chat_id, set)
        } else {
            return bot.sendChatAction(chat_id, 'typing').then(() => {
                return bot.sendMessage(chat_id, 'not found')
            })
        }
    })
});

function sendBeatmapInfo(chat_id, set) {
    return bot.sendChatAction(chat_id, 'typing').then(() => {
        return bot.sendMessage(chat_id, `Title: ${set.titleU ? set.titleU : set.title} <a href="${set.thumb}">[P]</a>\nArtist: ${set.artistU ? set.artistU : set.artist}\nCreator: <a href="${set.creatorUrl}">${set.creator}</a>\nStatus: ${set.status}\nModes: ${set.modes}`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{
                    text: '⏬ Download',
                    callback_data: `osu‼︎${set.id}`
                }, {
                    text: '🔎 Detail',
                    url: `${OsuApi.osu_url}s/${set.id}`
                }]]
            }
        })
    })
}

bot.on('callback_query', (callbackQuery) => {
    const action = callbackQuery.data;
    const msg = callbackQuery.message;
    const opts = {
        user_id: callbackQuery.from.id,
        chat_id: msg.chat.id,
        msg_id: msg.message_id,
        callback_id: callbackQuery.id
    };

    return handleCallbackQuery(action, opts, msg)
});

function handleCallbackQuery(action, opts, msg) {
    debug(action);
    debug(msg);
    debug(opts);

    let args = action.split('‼︎');
    switch (args[0]) {
        case 'osu': {
            let regexp = /filename="(.*)"/gi;
            let cookiePromise;
            if (isLocal) {
                cookiePromise = Promise.resolve()
            } else {
                cookiePromise = SettingDB.getSetting('bloodcat_cookie', -1)
            }
            return cookiePromise.then((cookies) => {
                return {
                    url: `${OsuApi.url}s/${args[1]}`,
                    headers: {
                        cookie: process.env.LOCAL === 'true' ? Config.bloodcat.cookie : cookies
                    },
                    encoding: null,
                    resolveWithFullResponse: true
                }
            }).then((options) => {
                return request(options).then((res) => {
                    let filename = regexp.exec(res.headers['content-disposition'])[1] || `${args[1]}.osz`;
                    return bot.sendChatAction(opts.chat_id, 'upload_document').then(() => {
                        return bot.sendDocument(opts.chat_id, res.body, {}, {filename})
                    })
                })
            }).catch((err) => {
                if (err.statusCode && err.statusCode === 401) {
                    console.error(err.error.toString());
                    return bot.answerCallbackQuery(opts.callback_id, 'cookie expired', false)
                }
            })
        }
    }
}

bot.onText(/\/setBloodCatCookie(@\w+)?/, (msg, match) => {
    let chat_id = msg.chat.id;
    let bot_name = match[1];
    if (bot_name && bot_name !== botname) {
        return;
    }
    return bot.sendMessage(chat_id, '请输入bloodcat的cookies', {
        reply_markup: {
            force_reply: true
        }
    }).then((sended) => {
        return bot.onReplyToMessage(chat_id, sended.message_id, (replyMessage) => {
            let value = replyMessage.text.trim();
            if (isLocal) {
                Config.bloodcat.cookie = value
            } else {
                SettingDB.setSetting('bloodcat_cookie', value, -1)
            }
            return bot.sendMessage(chat_id, '设置成功~')
        });
    })
});
