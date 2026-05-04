const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

console.log("LASTFM KEY EXISTS:", !!process.env.LASTFM_API_KEY);

app.use(
  cors({
    origin: ["https://algorhythm-2.web.app", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
  }),
);
app.use(express.json());

const appleCache = new Map();
const appleRateLimitState = {
  blockedUntil: 0,
};

function parseSongsWithExplanation(text) {
  return text
    .split("\n\n")
    .map((block) => {
      const obj = {};

      block.split("\n").forEach((line) => {
        const cleanLine = line.trim();

        if (cleanLine.toLowerCase().startsWith("song")) {
          obj.song = cleanLine.split(/[:\-]/)[1]?.trim();
        }

        if (cleanLine.toLowerCase().startsWith("artist")) {
          obj.artist = cleanLine.split(/[:\-]/)[1]?.trim();
        }

        if (cleanLine.toLowerCase().startsWith("explanation")) {
          obj.explanation = cleanLine.split(/[:\-]/)[1]?.trim();
        }
      });

      return obj;
    })
    .filter((s) => s.song && s.artist && s.explanation);
}

app.get("/test", (req, res) => {
  console.log("TEST ROUTE HIT");
  res.send("working");
});

async function getApplePreview(song, artist) {
  const cleanSong = (song || "").trim();
  const cleanArtist = (artist || "").trim();
  const term = encodeURIComponent(`${cleanSong} ${cleanArtist}`.trim());
  const cacheKey = `${cleanSong}::${cleanArtist}`.toLowerCase();

  if (appleCache.has(cacheKey)) {
    return appleCache.get(cacheKey);
  }

  const fallbackResult = {
    preview_url: null,
    apple_url: `https://music.apple.com/us/search?term=${term}`,
    artwork_url: null,
  };

  if (Date.now() < appleRateLimitState.blockedUntil) {
    appleCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }

  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`,
    );

    if (res.status === 429) {
      console.error("Apple preview error: 429 rate limit hit");

      appleRateLimitState.blockedUntil = Date.now() + 5 * 60 * 1000;

      appleCache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }

    if (!res.ok) {
      const text = await res.text();
      console.error("Apple preview error:", res.status, text);

      appleCache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }

    const data = await res.json();
    const track = data?.results?.[0];

    if (!track) {
      appleCache.set(cacheKey, fallbackResult);
      return fallbackResult;
    }

    const result = {
      preview_url: track.previewUrl || null,
      apple_url:
        track.trackViewUrl || `https://music.apple.com/us/search?term=${term}`,
      artwork_url: track.artworkUrl100 || track.artworkUrl60 || null,
    };

    appleCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error("Apple preview fetch failed:", err);

    appleCache.set(cacheKey, fallbackResult);
    return fallbackResult;
  }
}

function normalizeGenreTag(genre) {
  const genreMap = {
    indie: "indie",
    pop: "pop",
    rap: "rap",
    rnb: "rnb",
    rock: "rock",
    electronic: "electronic",
    latin: "latin",
    underground: "underground",
    country: "country",
    alternative: "alternative",
    "hip-hop": "hip-hop",
    folk: "folk",
    jazz: "jazz",
    kpop: "k-pop",
  };

  return genreMap[genre?.toLowerCase()] || genre;
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getRandomWindow(items, size = 15) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const shuffled = shuffleArray(items);
  return shuffled.slice(0, Math.min(size, shuffled.length));
}

app.post("/songs", async (req, res) => {
  const song = req.body.song;

  if (!song) {
    return res.status(400).json({ error: "No song provided" });
  }

  try {
    const songs = [
      {
        song: "Dreams",
        artist: "Fleetwood Mac",
        explanation: `Recommended for fans of ${song} because it shares a similar mood, era, and melodic feel.`,
      },
      {
        song: "Running on Empty",
        artist: "Jackson Browne",
        explanation: `This track fits a similar reflective vibe and classic singer-songwriter energy.`,
      },
      {
        song: "Landslide",
        artist: "Fleetwood Mac",
        explanation: `A strong match through emotional tone, soft rock style, and timeless songwriting.`,
      },
      {
        song: "Into the Mystic",
        artist: "Van Morrison",
        explanation: `Recommended because it captures a similarly warm, soulful atmosphere.`,
      },
      {
        song: "Blue Bayou",
        artist: "Linda Ronstadt",
        explanation: `This song connects through a similar nostalgic sound and emotional delivery.`,
      },
    ];

    res.json({ songs });
  } catch (err) {
    console.error("Songs error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/songs-batch", async (req, res) => {
  const tracks = req.body.tracks;
  console.log("BATCH ROUTE HIT");

  if (!tracks || !tracks.length) {
    return res.status(400).json({ error: "No tracks provided" });
  }

  try {
    const results = await Promise.all(
      tracks.map(async (t) => {
        const fallbackSong = {
          input: `${t.name} by ${t.artist}`,
          song: t.name,
          artist: t.artist,
          explanation: `Recommended because it matches the vibe, style, and listener appeal of ${t.name}.`,
        };

        try {
          const apple = await getApplePreview(
            fallbackSong.song,
            fallbackSong.artist,
          );

          return {
            ...fallbackSong,
            preview_url: apple.preview_url,
            apple_url: apple.apple_url,
            artwork_url: apple.artwork_url,
          };
        } catch (e) {
          return {
            ...fallbackSong,
            preview_url: null,
            apple_url: null,
            artwork_url: null,
          };
        }
      }),
    );

    res.json({ results });
  } catch (err) {
    console.error("Batch error:", err);
    res.status(500).json({
      error: "Batch request failed",
      details: err.message,
    });
  }
});

app.get("/search-tracks", async (req, res) => {
  console.log("SEARCH ROUTE HIT");

  const query = req.query.q;
  console.log("QUERY:", query);

  if (!query) {
    return res.status(400).json({ error: "No query provided" });
  }

  try {
    const response = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=track.search&track=${encodeURIComponent(query)}&api_key=${process.env.LASTFM_API_KEY}&format=json`,
    );

    const data = await response.json();
    let tracks = data?.results?.trackmatches?.track || [];

    if (!Array.isArray(tracks)) {
      tracks = [tracks];
    }

    const enrichedTracks = await Promise.all(
      tracks.slice(0, 5).map(async (track) => {
        const artistName =
          typeof track.artist === "string"
            ? track.artist
            : track.artist?.name || "Unknown Artist";

        const apple = await getApplePreview(track.name, artistName);

        return {
          ...track,
          preview_url: apple.preview_url,
          apple_url: apple.apple_url,
          artwork_url: apple.artwork_url,
        };
      }),
    );

    if (data?.results?.trackmatches) {
      data.results.trackmatches.track = enrichedTracks;
    }

    res.json(data);
  } catch (err) {
    console.error("Last.fm error:", err);
    res.status(500).json({ error: "Failed to fetch tracks" });
  }
});

app.get("/trending", async (req, res) => {
  try {
    const artistRes = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=chart.gettopartists&api_key=${process.env.LASTFM_API_KEY}&format=json`,
    );

    const trackRes = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&api_key=${process.env.LASTFM_API_KEY}&format=json`,
    );

    const artistData = await artistRes.json();
    const trackData = await trackRes.json();

    res.json({
      artists: artistData,
      tracks: trackData,
    });
  } catch (err) {
    console.error("Trending error:", err);
    res.status(500).json({ error: "Failed to fetch trending" });
  }
});

app.get("/similar-artists", async (req, res) => {
  const { artist } = req.query;

  if (!artist) {
    return res.status(400).json({ error: "Artist is required" });
  }

  try {
    const lastfmRes = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(
        artist,
      )}&limit=20&api_key=${process.env.LASTFM_API_KEY}&format=json`,
    );

    const data = await lastfmRes.json();
    const topArtists = data?.similarartists?.artist || [];

    const fallbackExplanations = [
      `Recommended because this artist shares a similar style and listener appeal with ${artist}.`,
      `A good fit for fans of ${artist} because of a related sound and audience.`,
      `This artist matches a similar musical direction and overall vibe.`,
      `Recommended for listeners who enjoy a close genre and energy profile.`,
      `A strong match because the sound and appeal feel closely connected.`,
      `This artist fits through a similar mood, style, and listening experience.`,
    ];

    const enriched = topArtists.map((rec, index) => ({
      ...rec,
      ai_explanation: fallbackExplanations[index % fallbackExplanations.length],
    }));

    return res.json({ similarartists: { artist: enriched } });
  } catch (err) {
    console.error("Similar artists error (last.fm):", err);
    res.status(500).json({ error: "Failed to fetch similar artists" });
  }
});

app.get("/artist-top-tracks", async (req, res) => {
  const artist = req.query.artist;

  if (!artist) {
    return res.status(400).json({ error: "No artist provided" });
  }

  try {
    const response = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=${encodeURIComponent(
        artist,
      )}&api_key=${process.env.LASTFM_API_KEY}&format=json`,
    );

    const data = await response.json();
    let tracks = data?.toptracks?.track || [];

    if (!Array.isArray(tracks)) {
      tracks = [tracks];
    }

    const enrichedTracks = await Promise.all(
      tracks.slice(0, 5).map(async (track) => {
        const apple = await getApplePreview(track.name, artist);

        return {
          ...track,
          preview_url: apple.preview_url,
          apple_url: apple.apple_url,
          artwork_url: apple.artwork_url,
        };
      }),
    );

    if (data?.toptracks) {
      data.toptracks.track = enrichedTracks;
    }

    res.json(data);
  } catch (err) {
    console.error("Artist top tracks error:", err);
    res.status(500).json({ error: "Failed to fetch top tracks" });
  }
});

app.get("/similar-tracks", async (req, res) => {
  const { track, artist } = req.query;

  if (!track || !artist) {
    return res.status(400).json({ error: "Track and artist are required" });
  }

  try {
    const lastfmRes = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&track=${encodeURIComponent(
        track,
      )}&artist=${encodeURIComponent(
        artist,
      )}&limit=20&api_key=${process.env.LASTFM_API_KEY}&format=json`,
    );

    const data = await lastfmRes.json();
    const topTracks = data?.similartracks?.track || [];

    const fallbackExplanations = [
      `Recommended because it shares a similar mood and style with ${track}.`,
      `This track fits with a similar energy and overall sound as ${track}.`,
      `A strong match for listeners who like the vibe and production of ${track}.`,
      `This recommendation connects through a similar feel and musical atmosphere.`,
      `A good fit because it carries a related tone, pacing, and style.`,
      `Recommended for its similar genre blend and listening experience.`,
    ];

    const enrichedWithPreview = await Promise.all(
      topTracks.map(async (rec, index) => {
        const recArtist = rec.artist?.name || rec.artist || "Unknown Artist";
        const apple = await getApplePreview(rec.name, recArtist);

        return {
          ...rec,
          preview_url: apple.preview_url,
          apple_url: apple.apple_url,
          artwork_url: apple.artwork_url,
          ai_explanation:
            fallbackExplanations[index % fallbackExplanations.length],
        };
      }),
    );

    return res.json({ similartracks: { track: enrichedWithPreview } });
  } catch (err) {
    console.error("Similar tracks error (last.fm):", err);
    res.status(500).json({ error: "Failed to fetch similar tracks" });
  }
});

app.get("/genre-artists", async (req, res) => {
  const genre = normalizeGenreTag(req.query.genre);

  if (!genre) {
    return res.status(400).json({ error: "Genre is required" });
  }

  try {
    const response = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=tag.gettopartists&tag=${encodeURIComponent(
        genre,
      )}&api_key=${process.env.LASTFM_API_KEY}&format=json&limit=40`,
    );

    const data = await response.json();
    let artists = data?.topartists?.artist || [];

    if (!Array.isArray(artists)) {
      artists = [artists];
    }

    const uniqueArtists = uniqueBy(artists, (artist) =>
      (artist?.name || "unknown-artist").trim().toLowerCase(),
    );

    const randomArtists = getRandomWindow(uniqueArtists, 15).map((artist) => ({
      name: artist.name,
      url: artist.url || null,
      apple_url: `https://music.apple.com/us/search?term=${encodeURIComponent(
        artist.name,
      )}`,
      spotify_url: `https://open.spotify.com/search/${encodeURIComponent(
        artist.name,
      )}`,
    }));

    res.json({ artists: randomArtists });
  } catch (err) {
    console.error("Genre artists error:", err);
    res.status(500).json({ error: "Failed to fetch genre artists" });
  }
});

app.get("/genre-albums", async (req, res) => {
  const genre = normalizeGenreTag(req.query.genre);

  if (!genre) {
    return res.status(400).json({ error: "Genre is required" });
  }

  try {
    const response = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=tag.gettopalbums&tag=${encodeURIComponent(
        genre,
      )}&api_key=${process.env.LASTFM_API_KEY}&format=json&limit=40`,
    );

    const data = await response.json();
    let albums = data?.albums?.album || data?.topalbums?.album || [];

    if (!Array.isArray(albums)) {
      albums = [albums];
    }

    const uniqueAlbums = uniqueBy(albums, (album) => {
      const artistName =
        typeof album.artist === "string"
          ? album.artist
          : album.artist?.name || "Unknown Artist";

      return `${album?.name || "unknown-album"}::${artistName}`
        .trim()
        .toLowerCase();
    });

    const randomAlbums = getRandomWindow(uniqueAlbums, 15).map((album) => {
      const artistName =
        typeof album.artist === "string"
          ? album.artist
          : album.artist?.name || "Unknown Artist";

      return {
        name: album.name,
        artist: artistName,
        url: album.url || null,
        apple_url: `https://music.apple.com/us/search?term=${encodeURIComponent(
          `${album.name} ${artistName}`,
        )}`,
        spotify_url: `https://open.spotify.com/search/${encodeURIComponent(
          `${album.name} ${artistName}`,
        )}`,
      };
    });

    res.json({ albums: randomAlbums });
  } catch (err) {
    console.error("Genre albums error:", err);
    res.status(500).json({ error: "Failed to fetch genre albums" });
  }
});

app.get("/genre-songs", async (req, res) => {
  const genre = normalizeGenreTag(req.query.genre);

  if (!genre) {
    return res.status(400).json({ error: "Genre is required" });
  }

  try {
    const response = await fetch(
      `https://ws.audioscrobbler.com/2.0/?method=tag.gettoptracks&tag=${encodeURIComponent(
        genre,
      )}&api_key=${process.env.LASTFM_API_KEY}&format=json&limit=40`,
    );

    const data = await response.json();
    let tracks = data?.tracks?.track || data?.toptracks?.track || [];

    if (!Array.isArray(tracks)) {
      tracks = [tracks];
    }

    const uniqueTracks = uniqueBy(tracks, (track) => {
      const artistName =
        typeof track.artist === "string"
          ? track.artist
          : track.artist?.name || "Unknown Artist";

      return `${track?.name || "unknown-song"}::${artistName}`
        .trim()
        .toLowerCase();
    });

    const randomPool = getRandomWindow(uniqueTracks, 15);

    const enrichedTracks = await Promise.all(
      randomPool.map(async (track) => {
        const artistName =
          typeof track.artist === "string"
            ? track.artist
            : track.artist?.name || "Unknown Artist";

        const apple = await getApplePreview(track.name, artistName);

        return {
          name: track.name,
          artist: artistName,
          url: track.url || null,
          preview_url: apple.preview_url,
          apple_url:
            apple.apple_url ||
            `https://music.apple.com/us/search?term=${encodeURIComponent(
              `${track.name} ${artistName}`,
            )}`,
          spotify_url: `https://open.spotify.com/search/${encodeURIComponent(
            `${track.name} ${artistName}`,
          )}`,
          artwork_url: apple.artwork_url || null,
        };
      }),
    );

    res.json({ songs: enrichedTracks });
  } catch (err) {
    console.error("Genre songs error:", err);
    res.status(500).json({ error: "Failed to fetch genre songs" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Running on http://localhost:${PORT}`);
});
