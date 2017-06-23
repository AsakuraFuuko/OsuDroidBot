'use strict';
const debug = require('debug')('osudroidbot');
const TelegramBot = require('node-telegram-bot-api');
const request = require('request');
const fs = require("fs");
const del = require('del');

const OsuApi = new (require('./lib/osuapi'))();

let isLocal = process.env.LOCAL === 'true';
console.log('isLocal =', isLocal);

let SettingDB, Config;
if (isLocal) {
    Config = require('./config.json');
} else {
    SettingDB = new (require('./lib/db/mongo/settings'))();
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
        return bot.sendMessage(chat_id, `Title: ${set.titleU ? set.title + ' (' + set.titleU + ')' : set.title} <a href="${set.thumb}">[P]</a>\nArtist: ${set.artistU ? set.artist + ' (' + set.artistU + ')' : set.artist}\nCreator: <a href="${set.creatorUrl}">${set.creator}</a>\nStatus: ${set.status}\nModes: ${set.modes}`, {
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
            let set_id = parseInt(args[1]);
            opts = Object.assign(opts, {set_id, trash: true});
            return sendBeatmapOszHandler(opts);
        }
    }
}

function sendBeatmapOszHandler(args) {
    debug(args);
    let {callback_id, chat_id, msg_id, set_id} = args;
    let regexp = /filename="(.*)"/gi;
    let cookiePromise;
    if (isLocal) {
        cookiePromise = Promise.resolve()
    } else {
        cookiePromise = SettingDB.getSetting('bloodcat_cookie', -1)
    }
    return bot.editMessageReplyMarkup({
        inline_keyboard: [[{
            text: '🔎 Detail',
            url: `${OsuApi.osu_url}s/${set_id}`
        }]]
    }, {
        chat_id: chat_id,
        message_id: msg_id
    }).then(() => {
        return bot.answerCallbackQuery(callback_id, 'downloading...', false).then(() => {
            return cookiePromise.then((cookies) => {
                return {
                    url: `${OsuApi.url}s/${set_id}`,
                    headers: {
                        cookie: process.env.LOCAL === 'true' ? Config.bloodcat.cookie : cookies
                    },
                    encoding: null,
                    resolveWithFullResponse: true
                }
            })
        })
    }).then((options) => {
        return new Promise((resolve, reject) => {
            let filename, stream;
            request.get(options).on('error', (err) => {
                reject(err)
            }).on('response', (res) => {
                if (res.statusCode === 200) {
                    filename = regexp.exec(res.headers['content-disposition'])[1] || `${args[1]}.osz`;
                    console.log(`downloading ${filename}`);
                    stream = fs.createWriteStream(`./download/osz/${filename}`);
                    stream.on('finish', () => {
                        console.log(`${filename} downloaded`);
                        resolve({
                            data: fs.createReadStream(`./download/osz/${filename}`),
                            name: filename
                        })
                    });
                    res.pipe(stream)
                } else {
                    return reject(res)
                }
            })
        })
    }).then((data) => {
        let filename = `./download/osz/${data.name}`;
        console.log(`sending ${filename}`);
        return bot.sendChatAction(chat_id, 'upload_document').then(() => {
            return bot.sendDocument(chat_id, data.data, {}, {
                filename: data.name
            }).then(() => {
                console.log(`${filename} send`);
                fs.unlink(filename, (err) => {
                    data = null;
                    if (err) {
                        console.error(err)
                    } else {
                        console.log(`Delete file ${filename}`)
                    }
                });
            })
        })
    }).catch((err) => {
        if (err.statusCode && err.statusCode === 401) {
            console.error(err.statusMessage);
            return bot.sendMessage(chat_id, 'bloodcat cookie expired\nclick /setcookies to update')
        }
    })
}

bot.onText(/\/setcookie(@\w+)?/, (msg, match) => {
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

bot.on('inline_query', (msg) => {
    let inline_id = msg.id;
    let query = msg.query || '';
    let queryArgs = query.split(' ');
    debug(queryArgs);
    let offset = msg.offset ? msg.offset : 1;

    /*
     in  out
     1 => 1
     2 => 1
     3 => 2
     4 => 2
     5 => 3
     6 => 3
     */
    console.log('page', Math.ceil(offset / 2));
    return OsuApi.search(query, 'o', null, null, Math.ceil(offset / 2)).then((sets) => {
        if (sets.length > 0) {
            const results = sets
                .map((set) => {
                    return {
                        id: set.id,
                        type: 'article',
                        title: set.titleU ? `${set.title} (${set.titleU})` : set.title,
                        description: (set.artistU ? `${set.artist} (${set.artistU})` : set.artist) + '\n' + set.creator,
                        input_message_content: {message_text: `${OsuApi.osu_url}s/${set.id}`},
                        thumb_url: set.thumb
                    }
                }).filter((element, index) => ((offset % 2) === 0 ? index >= 30 : index < 30));
            return bot.answerInlineQuery(inline_id, results, {
                next_offset: parseInt(offset) + 1,
                cache_time: 0
            })
        } else {
            return bot.answerInlineQuery(inline_id, [], {
                cache_time: 0
            })
        }
    })
});

process.on('unhandledRejection', (reason) => {
    console.error(reason);
    //   process.exit(1);
});

// require('heroku-self-ping')(url, {interval: 25 * 60 * 1000});

// empty osz folder
del(['./download/osz/*.osz']).then(paths => {
    console.log('Deleted files and folders:\n', paths.join('\n'));
});
