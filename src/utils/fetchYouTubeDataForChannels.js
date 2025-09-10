/*
Usage:
const fetch = require('./src/utils/fetchYouTubeDataForChannels');
fetch(['@veritasium', 'https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw'], { limit: 50 })
  .then(console.log)
  .catch(console.error);
Requires: yt-dlp installed and on PATH.
*/

"use strict";

const { execFile } = require("child_process");
const https = require("https");
// No-op: prefer system yt-dlp; if missing we fall back to HTML scraping

// Helper: Simple pLimit implementation
function pLimit(concurrency) {
  const queue = [];
  let active = 0;

  const next = () => {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          active--;
          next();
        });
    }
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

// Helper: Validate channel identifier
function isValidIdentifier(identifier) {
  const patterns = [
    /^UC[0-9A-Za-z_-]{22}$/, // Channel ID
    /^@[\w.-]{3,}$/, // Handle
    /^https?:\/\/(www\.)?youtube\.com\/(channel\/UC[0-9A-Za-z_-]{22}|@[\w.-]{3,}|c\/[A-Za-z0-9_-]+|user\/[A-Za-z0-9_-]+)\/?$/, // URL forms
  ];
  return patterns.some((pattern) => pattern.test(identifier));
}

// Helper: Normalize channel identifiers to a videos listing URL
function toChannelVideosUrl(identifier) {
  const id = identifier.trim();
  if (id.startsWith("@")) {
    return `https://www.youtube.com/${id}/videos`;
  }
  const m = id.match(/^https?:\/\/(www\.)?youtube\.com\/(.+?)\/?$/i);
  if (m) {
    const path = m[2];
    // If already a specific section, keep as is
    if (/\/(videos|shorts|live|streams|playlists)(\/|$)/i.test(path)) {
      return id;
    }
    // If it is a channel/user/custom/handle root, append /videos for stable extraction
    if (/^(channel\/UC[0-9A-Za-z_-]{22}|@[\w.-]{3,}|c\/[A-Za-z0-9_-]+|user\/[A-Za-z0-9_-]+)$/i.test(path)) {
      return id.replace(/\/?$/, "") + "/videos";
    }
  }
  return id;
}

// Helper: simple HTML fetch
function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117 Safari/537.36",
          "accept-language": "en-US,en;q=0.9",
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow simple redirect
          return resolve(fetchHtml(res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, url).toString()));
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk.toString()));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("Request timeout"));
    });
  });
}

// Helper: parse mm:ss or hh:mm:ss to seconds
function parseDurationToSeconds(text) {
  if (!text) return null;
  const parts = text.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return h * 3600 + m * 60 + s;
}

// Helper: extract numeric view count from strings like "123K views"
function parseViewCount(text) {
  if (!text) return null;
  const m = String(text).replace(/[,\s]/g, "").match(/([0-9]*\.?[0-9]+)([KMB])?/i);
  if (!m) return null;
  let num = parseFloat(m[1]);
  const suffix = m[2] ? m[2].toUpperCase() : null;
  if (suffix === "K") num *= 1_000;
  else if (suffix === "M") num *= 1_000_000;
  else if (suffix === "B") num *= 1_000_000_000;
  return Math.round(num);
}

// Fallback: scrape channel videos page to get top N video IDs
async function scrapeChannelVideosList(channelIdentifier, limit) {
  try {
    const url = toChannelVideosUrl(channelIdentifier);
    const html = await fetchHtml(url);
    const match = html.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/);
    if (!match) return [];
    const initial = JSON.parse(match[1]);

    const tabs = initial?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    let videosTab = null;
    for (const t of tabs) {
      const tab = t.tabRenderer;
      if (!tab) continue;
      if (
        tab?.content?.richGridRenderer?.contents ||
        /videos/i.test(tab?.title || "")
      ) {
        videosTab = tab;
        break;
      }
    }
    const contents = videosTab?.content?.richGridRenderer?.contents || [];
    const items = [];
    for (const c of contents) {
      const vr = c?.richItemRenderer?.content?.videoRenderer || c?.videoRenderer;
      if (!vr || !vr.videoId) continue;
      items.push({
        id: vr.videoId,
        title: vr.title?.runs?.[0]?.text || null,
        duration: parseDurationToSeconds(
          vr.lengthText?.simpleText || vr.thumbnailOverlays?.find?.((o) => o.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText
        ),
        viewCount: parseViewCount(vr.viewCountText?.simpleText),
        uploadDate: null,
      });
      if (items.length >= limit) break;
    }
    return items;
  } catch (_) {
    return [];
  }
}

// Helper: Run yt-dlp with JSON output
async function runYtDlp(args) {
  const shouldTimeout = typeof jest === "undefined";

  const execWithBinary = () =>
    new Promise((resolve, reject) => {
      let timeout;
      if (shouldTimeout) {
        timeout = setTimeout(() => {
          reject(new Error("yt-dlp timeout after 60 seconds"));
        }, 60000);
      }

      execFile(
        "yt-dlp",
        args,
        { maxBuffer: 1024 * 1024 * 10 },
        (error, stdout, stderr) => {
          if (timeout) clearTimeout(timeout);
          if (error) {
            const msg = `yt-dlp failed: ${error.message}\nstdout: ${stdout
              .slice(0, 500)
              .toString()}\nstderr: ${stderr.slice(0, 500).toString()}`;
            // Detect missing binary (Windows "not recognized" or ENOENT)
            const missingBinary =
              error.code === "ENOENT" || /not recognized/i.test(error.message);
            if (missingBinary) {
              reject(Object.assign(new Error(msg), { code: "YTDLP_MISSING" }));
            } else {
              reject(new Error(msg));
            }
          } else {
            try {
              const data = JSON.parse(stdout);
              resolve(data);
            } catch (parseError) {
              const message = `JSON parse failed: ${parseError.message}\nstdout: ${stdout
                .slice(0, 500)
                .toString()}\nstderr: ${stderr.slice(0, 500).toString()}`;
              reject(new Error(message));
            }
          }
        }
      );
    });

  return await execWithBinary();
}

// Helper: Map video JSON to expected format
function mapVideo(json) {
  return {
    id: json.id,
    title: json.title || null,
    url: `https://www.youtube.com/watch?v=${json.id}`,
    duration: json.duration || null,
    viewCount: json.view_count ? Number(json.view_count) : null,
    uploadDate: json.upload_date || null,
  };
}

// Main function
async function fetchYouTubeDataForChannels(channelIdsOrUrls = [], opts = {}) {
  // Input validation
  if (!Array.isArray(channelIdsOrUrls)) {
    throw new TypeError("channelIdsOrUrls must be an array");
  }
  if (channelIdsOrUrls.length === 0) {
    throw new Error("Provide at least one channel handle or URL");
  }
  for (const item of channelIdsOrUrls) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new TypeError("All items must be non-empty strings");
    }
    if (!isValidIdentifier(item.trim())) {
      throw new Error(`Invalid channel identifier or URL: ${item}`);
    }
  }

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const debug = opts.debug === true;
  const limitConcurrency = pLimit(5);

  const results = [];

  for (const channel of channelIdsOrUrls) {
    const channelResult = { channel, videos: [] };
    if (debug) channelResult.debug = [];

    try {
      // Step A: Fetch playlist
      const playlistArgs = [
        "-J",
        "--flat-playlist",
        "--playlist-end",
        limit.toString(),
        toChannelVideosUrl(channel),
      ];
      if (debug) channelResult.debug.push(`playlistArgs=${JSON.stringify(playlistArgs)}`);
      let playlistData;
      try {
        playlistData = await runYtDlp(playlistArgs);
      } catch (e) {
        if (debug) channelResult.debug.push(`yt-dlp playlist error: ${e.message}`);
        // Try scrape fallback if yt-dlp missing or failed
        const scraped = await scrapeChannelVideosList(channel, limit);
        if (scraped.length > 0) {
          channelResult.videos = scraped.map((v) => ({
            id: v.id,
            title: v.title,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            duration: v.duration,
            viewCount: v.viewCount,
            uploadDate: v.uploadDate,
          }));
          results.push(channelResult);
          continue;
        }
        throw e;
      }
      if (debug)
        channelResult.debug.push(
          `playlistDataType=${typeof playlistData} keys=${
            playlistData && typeof playlistData === "object"
              ? Object.keys(playlistData).join(",")
              : ""
          }`
        );

      if (!playlistData || !playlistData.entries || !Array.isArray(playlistData.entries)) {
        // Fallback scrape if yt-dlp didn't provide entries
        const scraped = await scrapeChannelVideosList(channel, limit);
        if (scraped.length > 0) {
          channelResult.videos = scraped.map((v) => ({
            id: v.id,
            title: v.title,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            duration: v.duration,
            viewCount: v.viewCount,
            uploadDate: v.uploadDate,
          }));
          results.push(channelResult);
          continue; // proceed to next channel
        }
        throw new Error("No entries found in playlist data");
      }

      // Step B: Fetch per-video metadata concurrently
      const videoPromises = playlistData.entries.slice(0, limit).map((entry) =>
        limitConcurrency(async () => {
          try {
            const videoArgs = [
              "-J",
              "--skip-download",
              `https://www.youtube.com/watch?v=${entry.id}`,
            ];
            const videoData = await runYtDlp(videoArgs);
            return mapVideo(videoData);
          } catch (videoError) {
            if (debug) {
              channelResult.debug.push(
                `Failed to fetch video ${entry.id}: ${videoError.message}`
              );
            }
            return null; // Skip this video
          }
        })
      );

      const videos = await Promise.all(videoPromises);
      channelResult.videos = videos.filter((v) => v !== null);
    } catch (channelError) {
      channelResult.error = {
        message: channelError.message,
        code: "YTDLP_CHANNEL_FETCH_FAILED",
      };
    }

    results.push(channelResult);
  }

  return results;
}

module.exports = fetchYouTubeDataForChannels;
