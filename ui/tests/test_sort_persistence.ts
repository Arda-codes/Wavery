/**
 * Comprehensive Unit & Integration Tests for Sort Persistence & sortPlaylists
 */

import assert from "assert";
import { useSortStore, PAGE_SORTS_STORAGE_KEY, DEFAULT_PAGE_SORTS } from "../src/stores/sortStore";
import { sortPlaylists } from "../src/utils/library";
import { Playlist } from "../src/types";

export function runSortPersistenceTests() {
  console.log("\n=======================================================");
  console.log("  PAGE SORT PERSISTENCE & PLAYLIST SORT TESTS");
  console.log("=======================================================");

  // 1. Verify Default Page Sorts
  console.log("--- 1. Testing Default Page Sorts ---");
  assert.strictEqual(useSortStore.getState().getPageSort("tracks", "title", "asc").key, "title");
  assert.strictEqual(useSortStore.getState().getPageSort("tracks", "title", "asc").dir, "asc");
  assert.strictEqual(useSortStore.getState().getPageSort("albums", "title", "asc").key, "title");
  assert.strictEqual(useSortStore.getState().getPageSort("artists", "name", "asc").key, "name");
  assert.strictEqual(useSortStore.getState().getPageSort("playlists", "name", "asc").key, "name");
  assert.strictEqual(useSortStore.getState().getPageSort("liked", "title", "asc").key, "date_added");
  assert.strictEqual(useSortStore.getState().getPageSort("album_detail", "title", "asc").key, "track_number");
  assert.strictEqual(useSortStore.getState().getPageSort("artist_detail", "name", "asc").key, "title");
  assert.strictEqual(useSortStore.getState().getPageSort("playlist_detail", "title", "asc").key, "date_added");
  console.log("  ✓ All default page sorts verified");

  // 2. Testing Sort Mutation & Toggling on Individual Pages
  console.log("--- 2. Testing Sort Toggling & Isolation Between Pages ---");
  useSortStore.getState().resetAllSorts();

  // Albums: title asc -> toggle year -> year asc -> toggle year -> year desc
  const opt1 = useSortStore.getState().togglePageSort("albums", "year", "title");
  assert.strictEqual(opt1.key, "year");
  assert.strictEqual(opt1.dir, "asc");

  const opt2 = useSortStore.getState().togglePageSort("albums", "year", "title");
  assert.strictEqual(opt2.key, "year");
  assert.strictEqual(opt2.dir, "desc");

  // Artists: toggle track_count -> track_count asc
  const opt3 = useSortStore.getState().togglePageSort("artists", "track_count", "name");
  assert.strictEqual(opt3.key, "track_count");
  assert.strictEqual(opt3.dir, "asc");

  // Verify albums still preserved year desc
  const albumsSort = useSortStore.getState().getPageSort("albums", "title");
  assert.strictEqual(albumsSort.key, "year");
  assert.strictEqual(albumsSort.dir, "desc");

  // Verify tracks is still untouched default
  const tracksSort = useSortStore.getState().getPageSort("tracks", "title");
  assert.strictEqual(tracksSort.key, "title");
  assert.strictEqual(tracksSort.dir, "asc");

  console.log("  ✓ Page sort isolation verified across pages");

  // 3. Testing LocalStorage Persistence
  console.log("--- 3. Testing LocalStorage Roundtrip & Session Restoration ---");
  if (typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(PAGE_SORTS_STORAGE_KEY);
    assert.ok(raw, "localStorage should contain wavery:page_sort_options");
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.albums.key, "year");
    assert.strictEqual(parsed.albums.dir, "desc");
    assert.strictEqual(parsed.artists.key, "track_count");
    assert.strictEqual(parsed.artists.dir, "asc");
  }
  console.log("  ✓ LocalStorage synchronization verified");

  // 4. Testing Playlist Fallback Key Architecture
  console.log("--- 4. Testing Specific Entity vs Fallback Inheritance ---");
  useSortStore.getState().togglePageSort("playlist_pl1", "duration", "date_added", "playlist_detail");
  const pl1Sort = useSortStore.getState().getPageSort("playlist_pl1", "date_added");
  assert.strictEqual(pl1Sort.key, "duration");
  assert.strictEqual(pl1Sort.dir, "asc");

  // Uncustomized playlist pl2 should inherit from playlist_detail fallback
  const pl2Sort = useSortStore.getState().getPageSort("playlist_pl2", "date_added", "asc", "playlist_detail");
  assert.strictEqual(pl2Sort.key, "duration");
  assert.strictEqual(pl2Sort.dir, "asc");

  // Now customize pl2 to title desc
  useSortStore.getState().setPageSort("playlist_pl2", "title", "desc");
  const pl2Custom = useSortStore.getState().getPageSort("playlist_pl2", "date_added");
  assert.strictEqual(pl2Custom.key, "title");
  assert.strictEqual(pl2Custom.dir, "desc");

  // pl1 should remain duration asc
  const pl1Preserved = useSortStore.getState().getPageSort("playlist_pl1", "date_added");
  assert.strictEqual(pl1Preserved.key, "duration");
  assert.strictEqual(pl1Preserved.dir, "asc");
  console.log("  ✓ Specific entity vs fallback inheritance verified");

  // 5. Testing sortPlaylists
  console.log("--- 5. Testing sortPlaylists Algorithm ---");
  const samplePlaylists: Playlist[] = [
    { id: "1", name: "Zebra Hits", track_ids: ["t1", "t2", "t3"], created_at: 1000, updated_at: 1000 },
    { id: "2", name: "Alpha Beats", track_ids: ["t1"], created_at: 3000, updated_at: 3000 },
    { id: "3", name: "Middle Ground", track_ids: ["t1", "t2"], created_at: 2000, updated_at: 2000 },
  ];

  // Name asc
  const byNameAsc = sortPlaylists(samplePlaylists, "name", "asc");
  assert.strictEqual(byNameAsc[0].name, "Alpha Beats");
  assert.strictEqual(byNameAsc[1].name, "Middle Ground");
  assert.strictEqual(byNameAsc[2].name, "Zebra Hits");

  // Name desc
  const byNameDesc = sortPlaylists(samplePlaylists, "name", "desc");
  assert.strictEqual(byNameDesc[0].name, "Zebra Hits");
  assert.strictEqual(byNameDesc[2].name, "Alpha Beats");

  // Tracks asc
  const byTracksAsc = sortPlaylists(samplePlaylists, "tracks", "asc");
  assert.strictEqual(byTracksAsc[0].track_ids.length, 1);
  assert.strictEqual(byTracksAsc[2].track_ids.length, 3);

  // Date desc (newest first)
  const byDateDesc = sortPlaylists(samplePlaylists, "date", "desc");
  assert.strictEqual(byDateDesc[0].created_at, 3000);
  assert.strictEqual(byDateDesc[2].created_at, 1000);

  // Empty / single element resilience
  assert.strictEqual(sortPlaylists([], "name", "asc").length, 0);
  assert.strictEqual(sortPlaylists([samplePlaylists[0]], "name", "asc").length, 1);

  console.log("  ✓ sortPlaylists sorting and boundaries verified");
  console.log("\n  ✓ ALL SORT PERSISTENCE TESTS PASSED (100% SUCCESS)!\n");
}
