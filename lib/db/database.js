'use strict';
const Pool = require('pg-pool');
const url = require('url');
//https://www.npmjs.com/package/pg-pool
const params = url.parse(process.env.DATABASE_URL);
const auth = params.auth.split(':');

const config = {
    user: auth[0],
    password: auth[1],
    host: params.hostname,
    port: params.port,
    database: params.pathname.split('/')[1],
    ssl: true
};

class DataBase {
    constructor() {
        this.pool = new Pool(config);
    }
}

module.exports = DataBase;