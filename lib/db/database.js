'use strict';
const pg = require('pg');
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
    ssl: true,
    idleTimeoutMillis: 1000
};

class DataBase {
    constructor() {
        this.pool = new pg.Pool(config);
        this.pool.on('error', function (err, client) {
            console.error('idle client error', err.message, err.stack);
        });
    }
}

module.exports = DataBase;