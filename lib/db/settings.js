'use strict';
const DataBase = require('./database');

class SettingDB extends DataBase {
    setSetting(key, value, group_id = -1) {
        return this.pool.query('select value from settings where key = $1 and group_id = $2', [key, group_id]).then(res => {
            if (res.rows.length > 0) {
                return this.pool.query('update settings set value = $2 where key = $1 and group_id = $3;', [key, value, group_id]).then(() => {
                    console.log(`update group ${group_id} setting ${key}=${value}`);
                    return true
                })
            } else {
                return this.pool.query('insert into settings (key, value, group_id) values ($1, $2, $3);', [key, value, group_id]).then(() => {
                    console.log(`insert group ${group_id} setting ${key}=${value}`);
                    return true
                })
            }
        }).catch((err) => {
            console.error(`key=${key}, value=${value}, group_id=${group_id}`);
            console.error('query error', err.message, err.stack)
            return false
        })
    }

    getSetting(key, group_id = -1) {
        return this.pool.query('select value from settings where key = $1 and group_id = $2', [key, group_id]).then(res => {
            let value = res.rows.length > 0 ? res.rows[0].value : null;
            console.log(`query group ${group_id} setting ${key}=${value}`);
            return value
        }).catch((err) => {
            console.error('query error', err.message, err.stack);
            return null
        })
    }
}

module.exports = SettingDB;