require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Your channels
const mainChannelId = process.env.TWITCH_CHANNEL_ID;
const otherChannelId1 = "108098985";

app.use(cors());
app.use(express.static('public'));

let cachedEmotes = [];
let lastUpdated = null;

// --------------------
// Fetch JSON utility
// --------------------
async function fetchJSON(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
        const err = new Error(`Failed to fetch ${url} - ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

// --------------------
// Get Twitch OAuth token
// --------------------
let twitchToken = null;
async function getTwitchToken() {
    const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`, {
        method: 'POST'
    });
    const data = await res.json();
    twitchToken = data.access_token;
}

// --------------------
// Fetch Twitch emotes for a channel
// --------------------
async function fetchTwitchEmotes(channelId) {
    if (!twitchToken) await getTwitchToken();
    try {
        const data = await fetchJSON(`https://api.twitch.tv/helix/chat/emotes?broadcaster_id=${channelId}`, {
            headers: {
                'Client-ID': process.env.TWITCH_CLIENT_ID,
                'Authorization': `Bearer ${twitchToken}`
            }
        });
        return data.data.map(e => ({
            name: e.name,
            link: e.images.url_4x
        }));
    } catch (err) {
        console.log(`❌ Twitch emotes for channel ${channelId} failed: ${err.message}`);
        return [];
    }
}

// --------------------
// Fetch FFZ / 7TV emotes for a channel
// --------------------
async function fetchChannelEmotes(channelId) {
    const emotes = [];

    // 7TV
    try {
        const seven = await fetchJSON(`https://api.7tv.app/v2/users/twitch/${channelId}/emotes?limit=200`);
        seven.forEach(e => emotes.push({ name: e.name, link: e.urls[0][1] }));
    } catch (err) {
        if (err.status !== 404) console.log(`7TV emotes for channel ${channelId} not found`);
    }

    // FFZ
    try {
        const ffz = await fetchJSON(`https://api.frankerfacez.com/v1/room/id/${channelId}`);
        Object.values(ffz.sets).forEach(set =>
            Object.values(set.emoticons).forEach(e =>
                emotes.push({ name: e.name, link: `https:${e.urls['4'] || e.urls['2'] || e.urls['1']}` })
            )
        );
    } catch {
        // Ignore if no FFZ
    }

    return emotes;
}

// --------------------
// Fetch global BTTV + 7TV emotes
// --------------------
async function fetchGlobalEmotes() {
    const emotes = [];

    // BTTV global
    try {
        const bttv = await fetchJSON(`https://api.betterttv.net/3/cached/emotes/global`);
        bttv.forEach(e => emotes.push({ name: e.code, link: `https://cdn.betterttv.net/emote/${e.id}/3x` }));
    } catch {
        console.log("Failed to fetch BTTV global emotes");
    }

    // 7TV global
    try {
        const sevenGlobal = await fetchJSON(`https://api.7tv.app/v2/emotes/global?limit=500`);
        sevenGlobal.forEach(e => emotes.push({ name: e.name, link: e.urls[0][1] }));
    } catch {
        console.log("Failed to fetch 7TV global emotes");
    }

    return emotes;
}

// --------------------
// Load all emotes
// --------------------
async function loadEmotes() {
    console.log("🔄 Fetching all emotes...");

    // Twitch
    const mainTwitch = await fetchTwitchEmotes(mainChannelId);
    const otherTwitch = await fetchTwitchEmotes(otherChannelId1);

    // FFZ + 7TV channel
    const mainExtras = await fetchChannelEmotes(mainChannelId);
    const otherExtras = await fetchChannelEmotes(otherChannelId1);

    // Global BTTV + 7TV
    const globalEmotes = await fetchGlobalEmotes();

    // Merge with priority: main > other > global
    const emoteMap = {};

    for (const e of [...globalEmotes, ...otherExtras, ...otherTwitch, ...mainExtras, ...mainTwitch]) {
        emoteMap[e.name] = e; // main Twitch wins duplicates
    }

    cachedEmotes = Object.values(emoteMap);
    lastUpdated = new Date().toISOString();

    console.log(`🎉 Loaded ${cachedEmotes.length} unique emotes`);
}

// Initial load + refresh every 15 minutes
loadEmotes();
setInterval(loadEmotes, 15 * 60 * 1000);

// --------------------
// API endpoints
// --------------------
app.get('/api/emotes', (req, res) => res.json(cachedEmotes));

app.get('/health', (req, res) => res.json({ status: "OK", emoteCount: cachedEmotes.length, lastUpdated }));

// Start server
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
