'use strict';
const DataBase = require('./database');

class SettingsDB extends DataBase {
    constructor() {
        super();
        this.settingdb = this.db.collection('osudroid_settings')
    }

    setSetting(key, value, group_id = -1) {
        return this.settingdb.findAndModifyOrUpsert({key}, [['key', 1]], {value, key, group_id})
    }

    getSetting(key, group_id = -1) {
        return this.settingdb.findOne({key, group_id}).then((doc) => doc ? doc.value : null)
    }
}

module.exports = SettingsDB;