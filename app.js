'use strict';
const debug = require('debug')('osudroidbot');
const TelegramBot = require('node-telegram-bot-api');
const request = require('request');
const express = require('express');
const bodyParser = require('body-parser');
const https = require('https');
const fs = require("fs");
const del = require('del');
const cheerio = require('cheerio');
const dataUriToBuffer = require('data-uri-to-buffer');

const OsuApi = new (require('./lib/osuapi'))();

let isLocal = process.env.LOCAL === 'true';
console.log('isLocal =', isLocal);

let TOKEN = process.env.TELEGRAM_TOKEN;
let PORT = process.env.PORT || 5000;
let URL = process.env.APP_URL;

let SettingDB = new (require('./lib/db/mongo/settings'))();

// express
const app = express();

app.use(bodyParser.json());

app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

if (isLocal) {
    https.createServer({
        key: fs.readFileSync(`${__dirname}/private.key`),
        cert: fs.readFileSync(`${__dirname}/cert.pem`)
    }, app).listen(PORT, '0.0.0.0', null, function () {
        console.log(`Server listening on port ${this.address().port} in ${app.settings.env} mode`);
    });
} else {
    app.listen(PORT, () => {
        console.log(`Express server is listening on ${PORT}`);
    });
}
// express

// telegram
let tg_options = {};
if (isLocal) {
    tg_options.request = {proxy: 'http://127.0.0.1:9090'};
}
let botname = '@bot_name';
const bot = new TelegramBot(TOKEN, tg_options);
let _ = bot.setWebHook(`${URL}/bot${TOKEN}`);

bot.getMe().then((msg) => {
    botname = '@' + msg.username;

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

    bot.onText(/(?:osu\.ppy\.sh|bloodcat\.com|osu\.uu\.gl)(?:.*?)([sb]+)\/(\d+)/, (msg, match) => {
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

async function sendBeatmapOszHandler(args) {
    debug(args);
    let {callback_id, chat_id, msg_id, set_id, sync, hash, response} = args;
    let regexp = /filename="(.*)"/gi;
    return SettingDB.getSetting('bloodcat_cookie', -1).then((cookies) => {
        let options = {
            url: `${OsuApi.url}s/${set_id}`,
            headers: {
                cookie: cookies
            },
            encoding: null,
            resolveWithFullResponse: true
        };
        if (sync) {
            options.form = {sync, hash, response}
        }
        return options;
    }).then((options) => {
        return new Promise((resolve, reject) => {
            let filename, stream, cookies;
            request.post(options).on('error', (err) => {
                reject(err)
            }).on('response', async (res) => {
                if (res.statusCode === 200) {
                    if (callback_id) {
                        await bot.answerCallbackQuery(callback_id, 'downloading...', false);
                    }
                    filename = regexp.exec(res.headers['content-disposition'])[1] || `${args[1]}.osz`;
                    cookies = res.headers['set-cookie'] && res.headers['set-cookie'].length > 0 &&
                        res.headers['set-cookie'][0].split(';')[0];
                    if (cookies) {
                        SettingDB.setSetting('bloodcat_cookie', cookies + ';', -1)
                    }
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
                    let body = '';
                    res.on('data', function (chunk) {
                        body += chunk;
                    });
                    res.on('end', function () {
                        return reject({
                            statusCode: res.statusCode,
                            html: cheerio.load(body)
                        })
                    });
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
                        console.log(`Delete file ${filename}`);
                        return bot.editMessageReplyMarkup({
                            inline_keyboard: [[{
                                text: '🔎 Detail',
                                url: `${OsuApi.osu_url}s/${set_id}`
                            }]]
                        }, {
                            chat_id: chat_id,
                            message_id: msg_id
                        })
                    }
                });
            })
        })
    }).catch(async (err) => {
        if (err.statusCode && err.statusCode === 401) {
            let {html} = err;
            let image = html('#captcha > div.modal-body > div:nth-child(1) > div > img').attr('src');
            let sync = html('#captcha > input[type="hidden"]:nth-child(3)').attr('value');
            let hash = html('#captcha > input[type="hidden"]:nth-child(4)').attr('value');
            let image_buffer = dataUriToBuffer(image);
            await bot.sendPhoto(chat_id, image_buffer);
            let sended = await bot.sendMessage(chat_id, 'Enter the verification code');
            return bot.onReplyToMessage(chat_id, sended.message_id, (replyMessage) => {
                let value = replyMessage.text.trim();
                return sendBeatmapOszHandler(Object.assign(args, {sync, hash, response: value, callback_id: null}))
            });
        } else {
            return bot.sendMessage(chat_id, 'download failed, please retry')
        }
    })
}

process.on('unhandledRejection', (reason) => {
    console.error(reason);
    //   process.exit(1);
});

// require('heroku-self-ping')(url, {interval: 25 * 60 * 1000});

// empty osz folder
del(['./download/osz/*.osz']).then(paths => {
    console.log('Deleted files and folders:\n', paths.join('\n'));
});
