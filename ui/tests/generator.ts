/**
 * Synthetic Track Generator for Empirical UI Benchmarking
 */

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  album_artist?: string;
  track_number?: number;
  disc_number?: number;
  year?: number;
  genre?: string;
  duration?: { secs: number; nanos: number };
  bitrate?: number;
  format?: string;
  channels?: number;
  sample_rate?: number;
}

export interface Track {
  id: string;
  path: string;
  date_added: number;
  metadata: TrackMetadata;
}

const ARTIST_NAMES = [
  "Pink Floyd", "Radiohead", "Daft Punk", "Led Zeppelin", "The Beatles",
  "Queen", "David Bowie", "Miles Davis", "John Coltrane", "Hans Zimmer",
  "Kendrick Lamar", "Fleetwood Mac", "Nirvana", "Steely Dan", "Chopin",
  "Beethoven", "Aphex Twin", "Boards of Canada", "Tame Impala", "Gorillaz",
  "Björk", "Portishead", "Massive Attack", "The Chemical Brothers", "Kraftwerk"
];

const ALBUM_PREFIXES = [
  "The Dark Side of", "OK", "Discovery", "Physical", "Abbey",
  "A Night at the", "The Rise and Fall of", "Kind of", "Giant", "Interstellar",
  "To Pimp a", "Rumours", "Nevermind", "Aja", "Nocturnes",
  "Symphony No.", "Selected Ambient Works", "Music Has the Right to", "Currents", "Demon"
];

const ALBUM_SUFFIXES = [
  "the Moon", "Computer", "Alive", "Graffiti", "Road",
  "Opera", "Ziggy Stardust", "Blue", "Steps", "Soundtrack",
  "Butterfly", "Deluxe", "Unplugged", "Sessions", "Opus",
  "5 in C Minor", "85-92", "Children", "Days", "Days Live"
];

const TRACK_TITLES = [
  "Speak to Me", "Breathe", "Time", "Money", "Us and Them",
  "Airbag", "Paranoid Android", "Subterranean Homesick Alien", "Exit Music", "Karma Police",
  "One More Time", "Aerodynamic", "Digital Love", "Harder Better Faster Stronger", "Crescendolls",
  "Custard Pie", "The Rover", "In My Time of Dying", "Houses of the Holy", "Trampled Under Foot",
  "Come Together", "Something", "Maxwell's Silver Hammer", "Oh! Darling", "Octopus's Garden",
  "Bohemian Rhapsody", "Somebody to Love", "Don't Stop Me Now", "Under Pressure", "Radio Ga Ga"
];

const FORMATS = ["FLAC", "MP3", "AAC", "ALAC", "Opus", "WAV", "OGG"];

export function generateSyntheticTracks(count: number): Track[] {
  const tracks: Track[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const artistIndex = i % ARTIST_NAMES.length;
    const albumIndex = (Math.floor(i / 10)) % ALBUM_PREFIXES.length;
    const titleIndex = i % TRACK_TITLES.length;
    const formatIndex = i % FORMATS.length;

    const artist = ARTIST_NAMES[artistIndex];
    const album = `${ALBUM_PREFIXES[albumIndex]} ${ALBUM_SUFFIXES[albumIndex]}`;
    const title = `${TRACK_TITLES[titleIndex]} (Vol. ${Math.floor(i / 100) + 1})`;
    const trackNum = (i % 12) + 1;
    const discNum = Math.floor((i % 24) / 12) + 1;
    const year = 1970 + (i % 54);
    const durationSecs = 120 + (i % 300);

    tracks[i] = {
      id: `track-${i.toString().padStart(6, "0")}`,
      path: `/music/${artist}/${album}/${trackNum.toString().padStart(2, "0")} - ${title}.${FORMATS[formatIndex].toLowerCase()}`,
      date_added: 1600000000 + i * 3600,
      metadata: {
        title,
        artist,
        album,
        album_artist: artist,
        track_number: trackNum,
        disc_number: discNum,
        year,
        genre: "Rock/Electronic",
        duration: { secs: durationSecs, nanos: 0 },
        bitrate: 320,
        format: FORMATS[formatIndex],
        channels: 2,
        sample_rate: 44100,
      },
    };
  }

  return tracks;
}
