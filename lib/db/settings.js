'use strict';
const DataBase = require('./database');

class SettingDB extends DataBase {
    setSetting(key, value, group_id = -1) {
        this.pool.connect().then((client) => {
            client.query('select value from settings where key = $1 and group_id = $2', [key, group_id]).then(res => {
                if (res.rows.length > 0) {
                    return client.query('update set value = $2 where key = $1 and group_id = $3;', [key, value, group_id]).then(() => {
                        client.release();
                        console.log(`update group ${group_id} setting ${key}=${value}`)
                    })
                } else {
                    return client.query('insert into settings (key, value, group_id) values ($1, $2, $3);', [key, value, group_id]).then(() => {
                        client.release();
                        console.log(`insert group ${group_id} setting ${key}=${value}`)
                    })
                }
            }).catch((err) => {
                client.release();
                console.error('query error', err.message, err.stack)
            })
        })
    }

    getSetting(key, group_id = -1) {
        let self = this;
        return new Promise((resolve) => {
            self.pool.connect().then((client) => {
                client.query('select value from settings where key = $1 and group_id = $2', [key, group_id]).then(res => {
                    let value = res.rows.length > 0 ? res.rows[0].value : null;
                    console.log(`query group ${group_id} setting ${key}=${value}`);
                    resolve(value)
                }).catch((err) => {
                    console.error('query error', err.message, err.stack);
                    resolve(null)
                })
            })
        })
    }
}

module.exports = SettingDB;