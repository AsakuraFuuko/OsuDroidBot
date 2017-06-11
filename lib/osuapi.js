'use strict';
const debug = require('debug')('osuapi');
const request = require('request-promise-native');

class OsuApi {
    constructor() {
        this.url = 'http://bloodcat.com/osu/';
        this.osu_url = 'https://osu.ppy.sh/';
        this.osu_thumb_url = 'https://b.ppy.sh/thumb/';
    }

    /**
     * q - query
     * c - Role when the query is numeric //b = Bitmap ID, s = mapset ID, u = producer ID, o = no role
     * s - State filter // 0 = Unranked (other), 1 = Ranked, 2 = Approved, 3 = Qualified
     * m - mode filter // 0 = Standard, 1 = Taiko, 2 = Catch the Beat, 3 = Mania
     * p - Page
     **/

    search(keywords, role = 'o', state = null, mode = null, page = 1) {
        let options = {
            url: this.url,
            qs: {
                mod: 'json',
                q: keywords,
                c: role,
                s: state,
                m: mode,
                p: page
            }
        };
        return request(options).then((body) => {
            debug(body);
            let json = JSON.parse(body);
            return json.map((set) => {
                return {
                    id: set.id,
                    artist: set.artist,
                    artistU: set.artistU,
                    title: set.title,
                    titleU: set.titleU,
                    creator: set.creator,
                    creatorUrl: `${this.osu_url}u/${set.creatorId}`,
                    status: parseStatus(set.status),
                    thumb: `${this.osu_thumb_url}${set.id}l.jpg`,
                    modes: parseMode(set.beatmaps)
                }
            })
        })
    }
}

function parseStatus(status) {
    // State filter // 0 = Unranked (other), 1 = Ranked, 2 = Approved, 3 = Qualified
    switch (status) {
        case '0':
            return 'Unranked';
        case '1':
            return 'Ranked';
        case '2':
            return 'Approved';
        case '3':
            return 'Qualified';
    }
}

function parseMode(beatmaps) {
    // mode filter // 0 = Standard, 1 = Taiko, 2 = Catch the Beat, 3 = Mania
    let modes = {};
    for (let beatmap of beatmaps) {
        switch (beatmap.mode) {
            case '0':
                modes['S'] ? modes['S'] += 1 : modes['S'] = 1;
                break;
            case '1':
                modes['T'] ? modes['T'] += 1 : modes['T'] = 1;
                break;
            case '2':
                modes['C'] ? modes['C'] += 1 : modes['C'] = 1;
                break;
            case '3':
                modes['M'] ? modes['M'] += 1 : modes['M'] = 1;
        }
    }
    return Object.keys(modes).map((key) => {
        return modes[key] + key
    }).join()
}

module.exports = OsuApi;